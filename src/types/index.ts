// Shared TypeScript types — derived from actual events.json shape

// ── Raw data shape (events.json top-level) ──────────────────────────────────

export interface HotelMeta {
  id: string;
  name: string;
  rooms: number;
  timezone: string;
}

export interface EventsFile {
  hotel: HotelMeta;
  note: string;
  events: RawEvent[];
}

// event types seen in data: check_in, maintenance, compliance, complaint,
// lost_keycard, check_in_issue, deposit_issue, facilities, no_show, walk_in,
// finance_note, incident, early_checkout_request, damage_report, note,
// guest_message — kept as loose string to handle future types without breaking.
export type RawEventType = string;

// status values in data: resolved, unresolved, pending
export type RawEventStatus = 'resolved' | 'unresolved' | 'pending';

export interface RawEvent {
  id: string;
  timestamp: string;           // ISO 8601 with tz offset
  type: RawEventType;
  room: string | null;
  guest: string | null;
  description: string;
  status: RawEventStatus;
}

// ── Normalized (post-ingest) ─────────────────────────────────────────────────

export interface NormalizedEvent extends RawEvent {
  shift: string;
  source: 'json' | 'freetext';
  flags: NormalizedEventFlag[];
}

export type NormalizedEventFlag =
  | 'incomplete'
  | 'contradictory'
  | 'suspicious'
  | 'ambiguous'
  | 'needs_verification';

// ── Reconciler ───────────────────────────────────────────────────────────────

// Per-issue classification with mandatory reasoning (required by brief for logging)
export interface ReconciledIssue {
  issueKey: string;            // "{room}:{type}" or "{type}" if room is null
  classification: IssueClassification;
  reasoning: string;           // why this classification was assigned
  events: NormalizedEvent[];   // all events contributing to this issue
  carryOverFrom?: string;      // shift label when issue first opened (if carry-over)
}

export type IssueClassification =
  | 'stillOpen'
  | 'newlyResolved'
  | 'newTonight';

export interface ReconcilerResult {
  hotel: string;
  targetShift: string;
  stillOpen: ReconciledIssue[];
  newlyResolved: ReconciledIssue[];
  newTonight: ReconciledIssue[];
  flagged: NormalizedEvent[];    // suspicious/contradictory events, not carried into content
}

// ── Generator / Output ───────────────────────────────────────────────────────

export interface HandoverItem {
  title: string;
  detail: string;
  sourceIds: string[];          // non-optional — every item must trace to event IDs
  carryOverFrom?: string;       // shift label when issue first opened
  reasoning?: string;           // reconciler reasoning, passed through for log
}

export interface HandoverOutput {
  hotel: string;
  night: string;                // shift label, e.g. "2026-05-29→2026-05-30"
  generatedAt: string;          // ISO timestamp
  sections: {
    actNow: HandoverItem[];
    pending: HandoverItem[];
    fyi: HandoverItem[];
    flagged: HandoverItem[];
  };
}

// ── Logger shape ─────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';
export type LogStage = 'ingestor' | 'reconciler' | 'generator' | 'handler' | 'request';

export interface LogEntry {
  level: LogLevel;
  hotel: string;
  night: string;
  stage: LogStage;
  eventsIngested: number;
  flagged: string[];            // event IDs flagged (suspicious/contradictory)
  resolutionReasoning?: ReasoningEntry[];
  durationMs: number;
  error: string | null;
}

export interface ReasoningEntry {
  issueKey: string;
  classification: IssueClassification;
  reasoning: string;
}
