export interface PushToken {
  token: string;
  type: "FCM" | "APNS_VOIP";
}

interface Dependencies {
  current: () => boolean;
  registerNative: () => void;
  readToken: () => PushToken | null;
  prepare: () => Promise<{ installationId: string; sequence: number }>;
  send: (data: PushToken & { userId: string; installationId: string; sequence: number }) => Promise<unknown>;
  error: (error: unknown) => void;
}

const retryDelays = [5_000, 15_000, 30_000, 60_000];
const tokenKey = (token: PushToken | null) => token ? token.type + ":" + token.token : null;

/** One registration in flight, with the latest native token winning after a retry. */
export class DeviceRegistration {
  private enabled = false;
  private disposed = false;
  private token: PushToken | null = null;
  private revision = 0;
  private prepared: { installationId: string; sequence: number } | undefined;
  private delivered: string | null = null;
  private running = false;
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly userId: string, private readonly deps: Dependencies) {}

  private live() {
    return this.enabled && !this.disposed && this.deps.current();
  }

  start() {
    if (this.disposed || this.enabled) return;
    this.enabled = true;
    this.refresh();
  }

  /** Recheck the native token after foregrounding or a connection becoming usable. */
  refresh() {
    if (!this.live()) return;
    this.clearTimer();
    this.retries = 0;
    this.read();
  }

  update(token: PushToken | null) {
    if (this.disposed || !this.deps.current()) return;
    if (tokenKey(token) === tokenKey(this.token)) return;
    this.token = token ? { ...token } : null;
    this.revision++;
    this.prepared = undefined;
    this.retries = 0;
    this.clearTimer();
    this.pump();
  }

  private read() {
    if (!this.live()) return;
    try {
      this.deps.registerNative();
      this.update(this.deps.readToken());
      this.pump();
    } catch (error) {
      this.deps.error(error);
      this.retry();
    }
  }

  private pump() {
    if (!this.live() || this.running) return;
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      // A native event can arrive after a synchronous no-token return but
      // before this continuation releases the flight.
      if (this.live() && this.token && tokenKey(this.token) !== this.delivered && this.retries === 0)
        this.pump();
    });
  }

  private async drain() {
    while (this.live()) {
      const token = this.token;
      if (!token) {
        this.retry();
        return;
      }
      if (tokenKey(token) === this.delivered) return;
      const revision = this.revision;
      try {
        const prepared = this.prepared ?? await this.deps.prepare();
        if (!this.live()) return;
        if (revision !== this.revision) continue;
        this.prepared = prepared;
        await this.deps.send({ userId: this.userId, ...prepared, ...token });
        if (!this.live()) return;
        if (revision !== this.revision) continue;
        this.delivered = tokenKey(token);
        this.retries = 0;
        this.clearTimer();
        return;
      } catch (error) {
        if (!this.live()) return;
        if (revision !== this.revision) continue;
        this.deps.error(error);
        this.retry();
        return;
      }
    }
  }

  private retry() {
    if (!this.live() || this.timer || this.retries >= retryDelays.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.read();
    }, retryDelays[this.retries++]);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.token = null;
  }
}
