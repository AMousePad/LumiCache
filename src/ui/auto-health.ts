import type { AuditInput, HealthReport } from "../health/types";
export const healthKey = (input: AuditInput | null) => input ? JSON.stringify([input.chatId, input.connectionId ?? ""]) : "";
export class AutoHealth {
  private version = 0;
  private key = "";
  private dirty = false;
  private blocked = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  constructor(private options: {
    input(): AuditInput | null;
    check(input: AuditInput): Promise<HealthReport>;
    result(report: HealthReport, input: AuditInput): void;
    error(error: unknown): void;
    changed(): void;
    delay?: number;
  }) {}
  get running() { return !!this.pending; }
  get stale() { return this.dirty || this.running; }
  sync() {
    const key = healthKey(this.options.input());
    if (key === this.key) return;
    this.key = key; this.version++; this.dirty = !!key; this.schedule(); this.options.changed();
  }
  invalidate() { this.version++; this.dirty = !!healthKey(this.options.input()); this.schedule(); this.options.changed(); }
  refresh() { this.version++; this.dirty = true; this.schedule(0); this.options.changed(); }
  suspend(blocked: boolean) { this.blocked = blocked; if (!blocked) this.schedule(); }
  accept(report: HealthReport, input: AuditInput) {
    if (healthKey(input) !== healthKey(this.options.input())) return;
    this.version++; this.dirty = false; clearTimeout(this.timer); this.options.result(report, input); this.options.changed();
  }
  idle() { return this.pending ?? Promise.resolve(); }
  private schedule(delay = this.options.delay ?? 800) {
    clearTimeout(this.timer);
    if (this.disposed || this.blocked || this.pending || !this.dirty || !this.options.input()) return;
    this.timer = setTimeout(() => { void this.run(); }, delay);
  }
  private async run() {
    const input = this.options.input();
    if (this.disposed || this.blocked || this.pending || !input) return;
    const version = this.version, key = healthKey(input); this.dirty = false;
    const task = Promise.resolve().then(async () => {
      try {
        const report = await this.options.check(input);
        if (!this.disposed && version === this.version && key === healthKey(this.options.input())) this.options.result(report, input);
      } catch (error) {
        if (!this.disposed && version === this.version && key === healthKey(this.options.input())) this.options.error(error);
      }
    });
    this.pending = task; this.options.changed();
    await task; this.pending = undefined;
    if (!this.disposed) { this.options.changed(); this.schedule(); }
  }
  dispose() { this.disposed = true; this.version++; clearTimeout(this.timer); }
}
