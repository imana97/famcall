import type { CallSession, CallEndedEvent, SetMutedActionEvent } from "expo-callkit-telecom";
import type { NativeEvent } from "./nativeEvents";

type Hooks = {
  ready: Promise<unknown>;
  getActive: () => Promise<CallSession | null>;
  getActiveId: () => string | null;
  hasEndedLocally: (id: string) => boolean;
  adopt: (session: CallSession) => void;
  mute: (event: SetMutedActionEvent) => void;
  answer: (session: CallSession, requestId: string) => void;
  end: (event: CallEndedEvent) => void;
  dismiss: (id: string) => void;
  error: (error: unknown) => void;
};

/** Reconcile native actions with startup reads without waiting on server requests. */
export class NativeCallCoordinator {
  private disposed = false;
  private ready = false;
  private revision = 0;
  private latestSessionId: string | null = null;
  private waiting: NativeEvent[] = [];
  private muted = new Map<string, boolean>();
  private ended = new Set<string>();

  constructor(private hooks: Hooks) {}

  async start() {
    try {
      await this.hooks.ready;
      if (this.disposed) return;
      this.ready = true;
      this.waiting.splice(0).forEach(event => this.dispatch(event));
      if (this.hooks.getActiveId()) return;
      const session = await this.lookup();
      if (session && this.usable(session))
        this.hooks.adopt(this.withMute(session));
    } catch (error) {
      if (!this.disposed) this.hooks.error(error);
    }
  }

  handle(event: NativeEvent) {
    if (this.disposed) return;
    if (event.kind === "end") {
      this.revision++;
      this.ended.add(event.event.id);
      this.muted.delete(event.event.id);
      if (this.latestSessionId === event.event.id) this.latestSessionId = null;
      // End actions must not wait for storage restoration or a native lookup.
      this.hooks.end(event.event);
      return;
    }
    if (event.kind === "session") {
      this.revision++;
      if (event.event.session.status === "ended") {
        this.ended.add(event.event.session.id);
        this.muted.delete(event.event.session.id);
        if (this.latestSessionId === event.event.session.id) this.latestSessionId = null;
        return;
      }
      const active = this.hooks.getActiveId();
      if (this.ended.has(event.event.session.id) || (active && active !== event.event.session.id)) return;
      this.latestSessionId = event.event.session.id;
    } else if (event.kind === "mute" && !this.ended.has(event.event.id)) {
      this.muted.set(event.event.id, event.event.isMuted);
    }
    if (this.ready) this.dispatch(event);
    else this.waiting.push(event);
  }

  private dispatch(event: NativeEvent) {
    if (this.disposed) return;
    if (event.kind === "session") {
      if (event.event.session.id === this.latestSessionId && this.usable(event.event.session))
        this.hooks.adopt(this.withMute(event.event.session));
    } else if (event.kind === "mute") {
      if (!this.ended.has(event.event.id) && event.event.id === this.hooks.getActiveId())
        this.hooks.mute(event.event);
    } else if (event.kind === "answer") {
      void this.answer(event.event.id, event.event.requestId);
    }
  }

  private async answer(id: string, requestId: string) {
    if (this.ended.has(id)) return;
    try {
      const session = await this.lookup(id);
      // An answer request belongs to this native UUID, never whichever call
      // happens to be active when the asynchronous read finally returns.
      if (!session || session.id !== id || !this.usable(session)) return;
      const current = this.withMute(session);
      this.hooks.adopt(current);
      this.hooks.answer(current, requestId);
    } catch (error) {
      if (!this.disposed && !this.ended.has(id) &&
          (!this.hooks.getActiveId() || this.hooks.getActiveId() === id))
        this.hooks.error(error);
    }
  }

  private async lookup(expectedId?: string): Promise<CallSession | null> {
    while (!this.disposed) {
      if (expectedId && this.ended.has(expectedId)) return null;
      const active = this.hooks.getActiveId();
      if (active && active !== expectedId) return null;
      const revision = this.revision;
      try {
        const session = await this.hooks.getActive();
        if (this.disposed) return null;
        if (revision === this.revision) return session;
      } catch (error) {
        if (this.disposed) return null;
        if (revision === this.revision) throw error;
      }
      // A call changed during the read. Ask the native store again instead of
      // reviving the old snapshot or suppressing a still-valid incoming call.
    }
    return null;
  }

  private usable(session: CallSession) {
    if (this.disposed || session.status === "ended" || this.ended.has(session.id)) return false;
    const id = session.incomingCallEvent?.serverCallId;
    if (!id) return false;
    if (this.hooks.hasEndedLocally(id)) {
      this.hooks.dismiss(session.id);
      return false;
    }
    const active = this.hooks.getActiveId();
    return !active || active === session.id;
  }

  private withMute(session: CallSession): CallSession {
    return { ...session, isMuted: this.muted.get(session.id) ?? session.isMuted };
  }

  dispose() {
    this.disposed = true;
    this.waiting = [];
    this.muted.clear();
    this.ended.clear();
  }
}
