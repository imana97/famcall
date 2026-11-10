type SessionUser = { uid: string };
type Dependencies<User extends SessionUser> = {
  current: () => User | null;
  reload: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const invalidSessionCodes = new Set([
  "auth/user-not-found",
  "auth/user-disabled",
  "auth/user-token-expired",
  "auth/invalid-user-token",
]);

/** Check persisted credentials without making connectivity a requirement to open the app. */
export class SessionValidation<User extends SessionUser> {
  private disposed = false;
  private active: User | null = null;
  private queued: User | null = null;
  private running: Promise<void> | null = null;

  constructor(private deps: Dependencies<User>) {}

  validate(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const current = this.deps.current();
    if (!current) this.queued = null;
    else if (current !== this.active) this.queued = current;
    if (!this.queued || this.running) return this.running ?? Promise.resolve();
    this.running = Promise.resolve().then(() => this.drain()).finally(() => {
      this.running = null;
      if (this.queued && !this.disposed) return this.validate();
    });
    return this.running;
  }

  private async drain() {
    while (!this.disposed && this.queued) {
      const user = this.queued;
      this.queued = null;
      if (this.deps.current() !== user) continue;
      this.active = user;
      try {
        await this.deps.reload(user);
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        // Native Firebase can already sign out during reload. Also protect a
        // replacement session, including a fresh sign-in with the same UID.
        if (!this.disposed && this.deps.current() === user && code && invalidSessionCodes.has(code)) {
          try { await this.deps.signOut(); }
          catch { /* Retry validation later if local sign-out failed. */ }
        }
        // Offline, App Check, and other failures do not establish an invalid user.
      } finally {
        this.active = null;
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.queued = null;
  }
}
