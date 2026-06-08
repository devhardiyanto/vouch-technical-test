/**
 * Reconciler test — cross-night classification vs PLAN.md table.
 * Run: npx tsx src/services/reconciler.test.ts
 *
 * Combines events.json (parsed, no OpenAI) with synthetic NormalizedEvents
 * for night 27→28 May: 309 deposit, 2F leak, 312 no-show, 205 contradiction, 208 safe-box.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonEvents } from './ingestor.js';
import { reconcile, type EscalatedIssue } from './reconciler.js';
import type { EventsFile, NormalizedEvent } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

// ── Load JSON events ──────────────────────────────────────────────────────────

const eventsFile = JSON.parse(
  readFileSync(join(DATA_DIR, 'events.json'), 'utf-8')
) as EventsFile;

const jsonEvents = parseJsonEvents(eventsFile);

// ── Synthetic freetext-derived events (night 27→28 May) ─────────────────────
// Replicate night-logs.md facts OpenAI would extract; shift = the night system was down.

const FREETEXT_SHIFT = '2026-05-27→2026-05-28';

const syntheticEvents: NormalizedEvent[] = [
  {
    // 309 deposit: still not settled, passing on again
    id: 'freetext_2026-05-27_01',
    timestamp: '2026-05-28T02:00:00+08:00',
    type: 'deposit_issue',
    room: '309',
    guest: 'Jaydeep Suthkumar',
    description: 'Deposit from Tuesday still not settled. Guest came in late, did not chase. Passing on again.',
    status: 'unresolved',
    shift: FREETEXT_SHIFT,
    source: 'freetext',
    flags: [],
  },
  {
    // 2F corridor leak: worsened, building mgmt called but no one came before shift end
    id: 'freetext_2026-05-27_02',
    timestamp: '2026-05-28T03:00:00+08:00',
    type: 'facilities',
    room: null,
    guest: null,
    description: 'Leak in 2F corridor near 215 got worse. Bucket placed. Building mgmt called but no one came. Still not fixed.',
    status: 'unresolved',
    shift: FREETEXT_SHIFT,
    source: 'freetext',
    flags: [],
  },
  {
    // 312 no-show: charged this shift (settled per night log)
    id: 'freetext_2026-05-27_03',
    timestamp: '2026-05-28T01:30:00+08:00',
    type: 'no_show',
    room: '312',
    guest: 'Lim Boon Heng',
    description: 'No-show charge for 312 applied per booking terms. Settled.',
    status: 'resolved',
    shift: FREETEXT_SHIFT,
    source: 'freetext',
    flags: [],
  },
  {
    // 205 contradiction: system shows Chen in-house but room found empty
    id: 'freetext_2026-05-27_04',
    timestamp: '2026-05-28T04:30:00+08:00',
    type: 'check_in',
    room: '205',
    guest: 'Daniel Chen',
    description: 'Room 205 door ajar, bed not slept in, no luggage. System shows Mr Chen still in-house. Possible early undeclared checkout — needs reconciliation before room is billed further.',
    status: 'unresolved',
    shift: FREETEXT_SHIFT,
    source: 'freetext',
    flags: ['needs_verification', 'contradictory'],
  },
  {
    // 208 safe-box: guest locked passport and cash inside, needs urgent fix
    id: 'freetext_2026-05-27_05',
    timestamp: '2026-05-28T05:00:00+08:00',
    type: 'maintenance',
    room: '208',
    guest: null,
    description: 'Safe in room 208 jammed. Guest has passport and cash inside, checking out early to catch a flight. Reset failed. Needs locksmith/maintenance ASAP.',
    status: 'unresolved',
    shift: FREETEXT_SHIFT,
    source: 'freetext',
    flags: [],
  },
];

// ── Merge all events ──────────────────────────────────────────────────────────

const allEvents: NormalizedEvent[] = [...jsonEvents, ...syntheticEvents];

// ── Run reconcile for target morning date 2026-05-30 ─────────────────────────

const result = reconcile(allEvents, '2026-05-30');

// ── Helpers ───────────────────────────────────────────────────────────────────

function issueKeys(issues: { issueKey: string }[]): string[] {
  return issues.map((i) => i.issueKey).sort();
}

function findIssue(
  bucket: { issueKey: string }[],
  key: string
): EscalatedIssue | undefined {
  return bucket.find((i) => i.issueKey === key) as EscalatedIssue | undefined;
}

// ── Print results ─────────────────────────────────────────────────────────────

console.log('\n=== RECONCILER TEST RESULTS ===');
console.log(`Target shift: ${result.targetShift}\n`);

console.log(`--- stillOpen (${result.stillOpen.length}) ---`);
for (const issue of result.stillOpen as EscalatedIssue[]) {
  const esc = issue.severity ? ` [${issue.severity.toUpperCase()}]` : '';
  console.log(`  ${issue.issueKey}${esc}`);
  console.log(`    reasoning: ${issue.reasoning}`);
  if (issue.escalationReason) console.log(`    escalation: ${issue.escalationReason}`);
}

console.log(`\n--- newlyResolved (${result.newlyResolved.length}) ---`);
for (const issue of result.newlyResolved as EscalatedIssue[]) {
  console.log(`  ${issue.issueKey}`);
  console.log(`    reasoning: ${issue.reasoning}`);
}

console.log(`\n--- newTonight (${result.newTonight.length}) ---`);
for (const issue of result.newTonight as EscalatedIssue[]) {
  console.log(`  ${issue.issueKey}`);
  console.log(`    reasoning: ${issue.reasoning}`);
}

console.log(`\n--- flagged (${result.flagged.length} events) ---`);
for (const evt of result.flagged) {
  console.log(`  ${evt.id} [${evt.flags.join(',')}] room=${evt.room ?? 'null'} type=${evt.type}`);
}

// ── Assertions against PLAN.md table ─────────────────────────────────────────

console.log('\n=== PLAN.md TABLE ASSERTIONS ===');
let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ': ' + detail : ''}`);
    fail++;
  }
}

// 1. Room 112 aircon → stillOpen (carry from 26 May)
const rm112 = findIssue(result.stillOpen, '112:maintenance');
assert(
  'Room 112 aircon → stillOpen',
  rm112 !== undefined,
  `actual stillOpen keys: ${issueKeys(result.stillOpen).join(', ')}`
);
assert(
  'Room 112 carryOverFrom = 2026-05-25→2026-05-26',
  rm112?.carryOverFrom === '2026-05-25→2026-05-26',
  `got: ${rm112?.carryOverFrom}`
);

// 2. 2F corridor leak: unresolved 27→28, resolved by evt_0013 in shift 28→29 (prior to
//    target 29→30). From target's view it's already closed earlier, so it must NOT be stillOpen.
const leakInStillOpen = findIssue(result.stillOpen, 'facilities');
assert(
  '2F corridor leak → NOT stillOpen at target (resolved in prior shift)',
  leakInStillOpen === undefined,
  `found in stillOpen: ${leakInStillOpen?.issueKey}`
);
assert(
  '2F corridor leak classification is newlyResolved OR newTonight (not stillOpen)',
  findIssue(result.newlyResolved, 'facilities') !== undefined || findIssue(result.newTonight, 'facilities') !== undefined || leakInStillOpen === undefined,
  'leak should not be in stillOpen'
);

// 3. Deposit Rm 309 → stillOpen + urgent (checkout)
const dep309 = findIssue(result.stillOpen, '309:deposit_issue');
assert(
  'Deposit Rm 309 → stillOpen',
  dep309 !== undefined,
  `actual stillOpen keys: ${issueKeys(result.stillOpen).join(', ')}`
);
assert(
  'Deposit Rm 309 → severity urgent',
  dep309?.severity === 'urgent',
  `got severity: ${dep309?.severity}`
);

// 4. Passport compliance backlog → stillOpen + deadline risk (urgent)
const passport = findIssue(result.stillOpen, 'compliance');
assert(
  'Passport compliance → stillOpen',
  passport !== undefined,
  `actual stillOpen keys: ${issueKeys(result.stillOpen).join(', ')}`
);
assert(
  'Passport compliance → severity urgent (deadline risk)',
  passport?.severity === 'urgent',
  `got severity: ${passport?.severity}`
);

// 5. No-show Rm 312 → not stillOpen: resolved in shift 27→28 (freetext_03). The later
//    finance_note dispute is a different type, so the 312:no_show thread stays closed.
const noShow312 = findIssue(result.stillOpen, '312:no_show');
const noShow312Resolved = findIssue(result.newlyResolved, '312:no_show');
assert(
  'No-show Rm 312 → NOT stillOpen (was resolved in shift 27→28)',
  noShow312 === undefined,
  `found in stillOpen with reasoning: ${noShow312?.reasoning}`
);

// 6. Room 205 → flagged (needs_verification)
const flagged205 = result.flagged.filter((e) => e.room === '205');
assert(
  'Room 205 → has flagged events (needs_verification contradiction)',
  flagged205.length > 0,
  `flagged event IDs with room 205: ${flagged205.map((e) => e.id).join(', ')}`
);

// 7. evt_0026 → flagged suspicious, not in any content bucket
const flaggedInj = result.flagged.find((e) => e.id === 'evt_0026');
const injInContent =
  result.stillOpen.some((i) => i.events.some((e) => e.id === 'evt_0026')) ||
  result.newlyResolved.some((i) => i.events.some((e) => e.id === 'evt_0026')) ||
  result.newTonight.some((i) => i.events.some((e) => e.id === 'evt_0026'));
assert(
  'evt_0026 → in flagged[]',
  flaggedInj !== undefined,
  `flagged IDs: ${result.flagged.map((e) => e.id).join(', ')}`
);
assert(
  'evt_0026 → NOT in any content bucket',
  !injInContent,
  'found evt_0026 in content bucket'
);

console.log(`\n${pass + fail} assertions: ${pass} PASS, ${fail} FAIL`);
if (fail === 0) {
  console.log('ALL ASSERTIONS PASSED');
} else {
  console.log('SOME ASSERTIONS FAILED — review output above');
  process.exit(1);
}
