import type { LogEntry, LogLevel, LogStage, ReasoningEntry } from '../types/index.js';

export function emitLog(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export class RequestLogger {
  private hotel: string;
  private night: string;
  private stage: LogStage;
  private eventsIngested = 0;
  private flagged: string[] = [];
  private resolutionReasoning: ReasoningEntry[] = [];
  private startMs: number;
  private error: string | null = null;

  constructor(hotel: string, night: string) {
    this.hotel = hotel;
    this.night = night;
    this.stage = 'request';
    this.startMs = Date.now();
  }

  setStage(stage: LogStage): this {
    this.stage = stage;
    return this;
  }

  setEventsIngested(count: number): this {
    this.eventsIngested = count;
    return this;
  }

  addFlagged(eventId: string): this {
    this.flagged.push(eventId);
    return this;
  }

  addReasoning(entry: ReasoningEntry): this {
    this.resolutionReasoning.push(entry);
    return this;
  }

  setError(err: unknown): this {
    this.error = err instanceof Error ? err.message : String(err);
    return this;
  }

  emit(level: LogLevel = 'info'): void {
    const entry: LogEntry = {
      level,
      hotel: this.hotel,
      night: this.night,
      stage: this.stage,
      eventsIngested: this.eventsIngested,
      flagged: this.flagged,
      resolutionReasoning: this.resolutionReasoning.length > 0
        ? this.resolutionReasoning
        : undefined,
      durationMs: Date.now() - this.startMs,
      error: this.error,
    };
    emitLog(entry);
  }
}
