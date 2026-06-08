import type {
  NormalizedEvent,
  ReconciledIssue,
  ReconcilerResult,
  IssueClassification,
  ReasoningEntry,
} from '../types/index.js';

// ── Shift helpers ─────────────────────────────────────────────────────────────
// Shift label = "YYYY-MM-DD→YYYY-MM-DD"; second date = morning the shift ends.

function buildTargetShift(targetMorningDate: string): string {
  const d = new Date(targetMorningDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const prevDate = d.toISOString().slice(0, 10);
  return `${prevDate}→${targetMorningDate}`;
}

function shiftStartDate(shift: string): string {
  return shift.split('→')[0] ?? shift;
}

function shiftIsBeforeOrEqual(a: string, b: string): boolean {
  return shiftStartDate(a) <= shiftStartDate(b);
}

function shiftIsBefore(a: string, b: string): boolean {
  return shiftStartDate(a) < shiftStartDate(b);
}

// ── Issue key ─────────────────────────────────────────────────────────────────

function makeIssueKey(room: string | null, type: string): string {
  return room ? `${room}:${type}` : type;
}

// ── Contradiction detection ───────────────────────────────────────────────────

function hasContradiction(events: NormalizedEvent[]): boolean {
  return events.some(
    (e) =>
      e.flags.includes('contradictory') || e.flags.includes('needs_verification')
  );
}

// ── Compliance deadline check ─────────────────────────────────────────────────
// True if a compliance event is older than 48h before shift end (07:00 target morning).

function isDeadlineRisk(events: NormalizedEvent[], targetMorningDate: string): boolean {
  const deadline = new Date(targetMorningDate + 'T07:00:00+08:00');
  const cutoff = new Date(deadline.getTime() - 48 * 60 * 60 * 1000);

  return events.some((e) => {
    if (e.timestamp === 'UNKNOWN') return false;
    const ts = new Date(e.timestamp);
    return ts <= cutoff;
  });
}

// ── Checkout urgency ──────────────────────────────────────────────────────────
// Urgent if any event description mentions imminent checkout.

const CHECKOUT_URGENCY_PATTERNS = [
  /check[s\s-]*out\s+(tomorrow|today|morning|in\s+\d+\s+hour)/i,
  /leaving\s+(tomorrow|today|05[:h]30|at\s+\d)/i,
  /before\s+checkout/i,
  /flag\s+to\s+finance\s+before\s+checkout/i,
];

function isCheckoutUrgent(events: NormalizedEvent[]): boolean {
  return events.some((e) =>
    CHECKOUT_URGENCY_PATTERNS.some((re) => re.test(e.description))
  );
}

// ── Safety / security urgency ───────────────────────────────────────────────
// High-precision only: guest valuables trapped in a stuck safe, or a physical
// hazard. Deliberately NO medical keywords — evt_0016 ("declined ambulance, said
// she was okay") proves those over-fire on non-urgent awareness logs.

const SAFE_STUCK_PATTERN =
  /\b(safe|safe[\s-]?box|locker|deposit\s+box)\b[^.]*\b(jam|stuck|won'?t\s+open|can'?t\s+open|cannot\s+open|locked\s+in|fail|broken)/i;
const VALUABLES_PATTERN = /\b(passport|cash|money|valuables?|documents?|wallet)\b/i;
const HAZARD_PATTERN = /\b(fire|gas\s*leak|burst\s+pipe|flood(ing)?|electrical\s+fault)\b/i;

function safetyUrgentEvent(events: NormalizedEvent[]): NormalizedEvent | undefined {
  return events.find((e) => {
    const d = e.description;
    return (SAFE_STUCK_PATTERN.test(d) && VALUABLES_PATTERN.test(d)) || HAZARD_PATTERN.test(d);
  });
}

// ── Extended ReconciledIssue with escalation fields ───────────────────────────

export interface EscalatedIssue extends ReconciledIssue {
  severity?: 'urgent' | 'high' | 'normal';
  escalationReason?: string;
}

// ── Core reconcile function ───────────────────────────────────────────────────

export function reconcile(
  events: NormalizedEvent[],
  targetMorningDate: string
): ReconcilerResult & { reasoningEntries: ReasoningEntry[] } {
  const targetShift = buildTargetShift(targetMorningDate);

  const flagged: NormalizedEvent[] = [];
  const safeEvents: NormalizedEvent[] = [];

  for (const evt of events) {
    if (evt.flags.includes('suspicious')) {
      flagged.push(evt);
    } else {
      safeEvents.push(evt);
    }
  }

  const threads = new Map<string, NormalizedEvent[]>();

  for (const evt of safeEvents) {
    // Only consider events up to and including the target shift
    if (shiftIsBeforeOrEqual(evt.shift, targetShift) || evt.shift === 'UNKNOWN→UNKNOWN') {
      const key = makeIssueKey(evt.room, evt.type);
      const existing = threads.get(key) ?? [];
      existing.push(evt);
      threads.set(key, existing);
    }
  }

  for (const [, threadEvents] of threads) {
    threadEvents.sort((a, b) => {
      if (a.timestamp === 'UNKNOWN') return 1;
      if (b.timestamp === 'UNKNOWN') return -1;
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  const stillOpen: EscalatedIssue[] = [];
  const newlyResolved: EscalatedIssue[] = [];
  const newTonight: EscalatedIssue[] = [];
  const reasoningEntries: ReasoningEntry[] = [];

  for (const [key, threadEvents] of threads) {
    // Contradictory threads: flag AND classify — they surface in both places.
    const hasContra = hasContradiction(threadEvents);
    if (hasContra) {
      for (const e of threadEvents) {
        if (!flagged.includes(e)) flagged.push(e);
      }
    }

    const priorShiftEvents = threadEvents.filter((e) =>
      e.shift !== 'UNKNOWN→UNKNOWN' && shiftIsBefore(e.shift, targetShift)
    );
    const targetShiftEvents = threadEvents.filter((e) => e.shift === targetShift);
    const unknownShiftEvents = threadEvents.filter((e) => e.shift === 'UNKNOWN→UNKNOWN');

    const hasAnyPrior = priorShiftEvents.length > 0;
    const hasAnyTarget = targetShiftEvents.length > 0 || unknownShiftEvents.length > 0;

    const allRelevant = [...priorShiftEvents, ...targetShiftEvents, ...unknownShiftEvents];
    const lastStatus = allRelevant[allRelevant.length - 1]?.status ?? 'unresolved';

    const resolvedInTarget = targetShiftEvents.some((e) => e.status === 'resolved');
    const unresolvedInPrior = priorShiftEvents.some(
      (e) => e.status === 'unresolved' || e.status === 'pending'
    );
    // Tells us if the issue was already closed before the target shift
    const lastPriorStatus = priorShiftEvents[priorShiftEvents.length - 1]?.status;
    const firstEvent = allRelevant[0];
    const firstShift = firstEvent?.shift ?? targetShift;

    let classification: IssueClassification;
    let reasoning: string;
    const supportingIds = allRelevant.map((e) => e.id);

    if (!hasAnyTarget && !hasAnyPrior) continue;

    // Closed before tonight = last prior-shift event was 'resolved'.
    const alreadyResolvedBeforeTarget =
      hasAnyPrior && lastPriorStatus === 'resolved';

    if (!hasAnyPrior && hasAnyTarget) {
      classification = 'newTonight';
      reasoning = `Thread "${key}" first appeared in target shift ${targetShift}. ` +
        `First event: ${firstEvent?.id ?? 'unknown'} (status: ${lastStatus}). ` +
        `No prior-shift history. Supporting events: [${supportingIds.join(', ')}].`;
    } else if (alreadyResolvedBeforeTarget && !hasAnyTarget) {
      continue;
    } else if (alreadyResolvedBeforeTarget && hasAnyTarget) {
      // Re-opened: resolved in prior shift but new events appeared tonight
      classification = 'newTonight';
      reasoning = `Thread "${key}" was resolved in a prior shift before ${targetShift}. ` +
        `New event(s) re-opened/noted in target shift: [${targetShiftEvents.map((e) => e.id).join(', ')}]. ` +
        `Supporting events: [${supportingIds.join(', ')}].`;
    } else if (hasAnyPrior && unresolvedInPrior && resolvedInTarget) {
      // Was unresolved in a prior shift, resolution event appeared in target shift
      classification = 'newlyResolved';
      const resolutionEvent = targetShiftEvents.find((e) => e.status === 'resolved');
      reasoning = `Thread "${key}" was unresolved in prior shifts (first opened: ${firstShift}). ` +
        `Resolution event in target shift ${targetShift}: ${resolutionEvent?.id ?? 'unknown'}. ` +
        `Supporting events: [${supportingIds.join(', ')}].`;
    } else if (hasAnyPrior && unresolvedInPrior && !resolvedInTarget) {
      // Carried forward from prior shift, still not resolved in target
      classification = 'stillOpen';
      reasoning = `Thread "${key}" was unresolved in prior shifts (first opened: ${firstShift}). ` +
        `No resolution event found in target shift ${targetShift}. ` +
        `Last known status: ${lastStatus}. Supporting events: [${supportingIds.join(', ')}].`;
    } else if (hasAnyPrior && !unresolvedInPrior && !hasAnyTarget) {
      continue;
    } else {
      // Fallback: ambiguous thread treated as stillOpen
      classification = 'stillOpen';
      reasoning = `Thread "${key}" classification ambiguous. ` +
        `Has prior events: ${hasAnyPrior}, has target events: ${hasAnyTarget}, ` +
        `lastStatus: ${lastStatus}. Supporting events: [${supportingIds.join(', ')}].`;
    }

    const issue: EscalatedIssue = {
      issueKey: key,
      classification,
      reasoning,
      events: allRelevant,
      carryOverFrom: classification !== 'newTonight' ? firstShift : undefined,
    };

    // Passport compliance: escalate if 48h window may be exceeded
    if (
      classification === 'stillOpen' &&
      allRelevant[0]?.type === 'compliance' &&
      isDeadlineRisk(allRelevant, targetMorningDate)
    ) {
      issue.severity = 'urgent';
      issue.escalationReason =
        'Passport/immigration compliance: 48-hour reporting window may be exceeded. ' +
        `Oldest unresolved event: ${allRelevant[0].id} (${allRelevant[0].timestamp}).`;
    }

    // Deposit still open with imminent checkout: escalate
    if (
      classification === 'stillOpen' &&
      allRelevant[0]?.type === 'deposit_issue' &&
      isCheckoutUrgent(allRelevant)
    ) {
      issue.severity = 'urgent';
      issue.escalationReason =
        'Deposit unresolved and guest is checking out imminently. Must be settled before departure.';
    }

    // Trapped valuables or physical hazard: urgent whether new or carried.
    if (classification === 'stillOpen' || classification === 'newTonight') {
      const hazardEvent = safetyUrgentEvent(allRelevant);
      if (hazardEvent) {
        issue.severity = 'urgent';
        issue.escalationReason =
          'Safety/security risk — physical hazard or guest valuables trapped; needs immediate attention. ' +
          `Source: ${hazardEvent.id}.`;
      }
    }

    switch (classification) {
      case 'stillOpen':
        stillOpen.push(issue);
        break;
      case 'newlyResolved':
        newlyResolved.push(issue);
        break;
      case 'newTonight':
        newTonight.push(issue);
        break;
    }

    reasoningEntries.push({ issueKey: key, classification, reasoning });
  }

  return {
    hotel: '',          // filled in by caller
    targetShift,
    stillOpen,
    newlyResolved,
    newTonight,
    flagged,
    reasoningEntries,
  };
}
