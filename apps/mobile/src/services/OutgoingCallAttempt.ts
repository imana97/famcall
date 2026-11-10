import { isTerminal, type CallRecord } from "@famcall/core";

type Hooks = {
  isCurrent: () => boolean;
  hasEndedLocally: () => boolean;
  nativeEnded: (id: string) => boolean;
  preflight?: () => Promise<boolean>;
  create: () => Promise<CallRecord>;
  startNative: (call: CallRecord) => Promise<string>;
  endNative: (id: string) => Promise<void>;
  persistEnd: () => Promise<void>;
  record: (call: CallRecord) => void;
  ready: (call: CallRecord, nativeId: string) => void;
  cancelled: () => void;
  error: (error: unknown) => void;
};

/** Owns one request UUID across both asynchronous call-creation steps. */
export class OutgoingCallAttempt {
  private cancelled = false;
  private endWrite?: Promise<void>;
  private createStarted = false;

  constructor(readonly id: string, private hooks: Hooks) {}

  get active() {
    return !this.cancelled && this.hooks.isCurrent() && !this.hooks.hasEndedLocally();
  }

  private persistEnd() {
    // Failed storage writes may be retried; a successful write is sufficient
    // because the durable outbox retries server delivery independently.
    return this.endWrite ??= this.hooks.persistEnd().catch(error => {
      this.endWrite = undefined;
      throw error;
    });
  }

  cancel() {
    this.cancelled = true;
    return this.createStarted ? this.persistEnd() : Promise.resolve();
  }

  async run() {
    try {
      if (this.hooks.preflight && !await this.hooks.preflight()) {
        this.cancelled = true;
        if (this.hooks.isCurrent()) this.hooks.cancelled();
        return;
      }
      if (!this.active) return;
      this.createStarted = true;
      const call = await this.hooks.create();
      if (!this.active) {
        await this.persistEnd();
        return;
      }
      this.hooks.record(call);
      if (isTerminal(call.status)) return;
      const nativeId = await this.hooks.startNative(call);
      if (this.hooks.nativeEnded(nativeId)) {
        this.cancelled = true;
        if (this.hooks.isCurrent()) this.hooks.cancelled();
      }
      if (!this.active) {
        // Close only the native UUID returned to this attempt, never a newer one.
        try { await this.hooks.endNative(nativeId); }
        finally { await this.persistEnd(); }
        return;
      }
      this.hooks.ready(call, nativeId);
    } catch (error) {
      const report = this.active;
      // A failed/timeout response does not prove the server failed to create it.
      try { if (this.createStarted) await this.persistEnd(); }
      catch (storageError) {
        if (this.hooks.isCurrent()) this.hooks.error(storageError);
      }
      if (report && this.hooks.isCurrent()) this.hooks.error(error);
    }
  }
}
