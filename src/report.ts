import type { LabReport } from '../engine/types.ts';
// Report imports are data only. Validate every field used by the viewer before rendering.
export function parseReport(input: unknown): LabReport {
  const fail = () => { throw new Error('This file is not a supported Reorg Lab v1 report. Export JSON with npm run lab and try again.'); };
  const object = (value: any) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); };
  const strings = (value: any, keys: string[]) => { object(value); for (const key of keys) if (typeof value[key] !== 'string' || value[key].length > 10000) fail(); };
  const numbers = (value: any, keys: string[]) => { for (const key of keys) if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail(); };
  const bools = (value: any, keys: string[]) => { for (const key of keys) if (typeof value[key] !== 'boolean') fail(); };
  const array = (value: any, visit: (item: any) => void) => { if (!Array.isArray(value) || value.length > 1000) fail(); value.forEach(visit); };
  const text = (value: any) => { if (typeof value !== 'string' || value.length > 10000) fail(); };
  const header = (value: any) => { strings(value, ['hash', 'parentHash']); numbers(value, ['number']); };
  const tasks = (value: any) => { object(value); Object.values(value).forEach(v => { if (typeof v !== 'boolean') fail(); }); };
  const row = (value: any) => { strings(value, ['key', 'blockHash', 'parentHash', 'transactionHash']); numbers(value, ['blockNumber', 'logIndex', 'taskId']); bools(value, ['wasCompleted', 'isCompleted']); };
  const r = input as any;
  strings(r, ['runId', 'generatedAt', 'title', 'sourceDigest']);
  if (r.schemaVersion !== 1 || Number.isNaN(Date.parse(r.generatedAt))) fail();
  strings(r.environment, ['engine', 'compiler', 'node', 'network', 'pinning']); numbers(r.environment, ['chainId']);
  strings(r.contract, ['name', 'address']); array(r.contract.taskIds, id => { if (!Number.isSafeInteger(id) || id < 0) fail(); });
  const e = r.experiment; object(e); header(e.baseline); header(e.commonAncestor); array(e.branchA, header); array(e.branchB, header);
  if (!e.branchA.length || !e.branchB.length) fail();
  bools(e, ['snapshotRestored', 'sameHeight', 'differentHash', 'databasePreserved']);
  strings(e, ['databaseDigestBefore', 'databaseDigestAfterNodeRevert']); numbers(e, ['removedRows', 'replayedRows']);
  strings(r.truth, ['digest', 'source']); header(r.truth.head); tasks(r.truth.tasks); numbers(r.truth, ['completedCount']); array(r.truth.rows, row);
  array(r.projections, p => { strings(p, ['id', 'label', 'digest', 'explanation']); if (!['matched', 'diverged'].includes(p.outcome)) fail(); tasks(p.tasks); numbers(p, ['completedCount']); bools(p, ['stateMatches', 'rowsMatch']); array(p.rows, row); for (const key of ['orphanKeys', 'missingKeys', 'duplicateKeys']) array(p[key], text); });
  if (!r.projections.length || !r.checks?.length || new Set(r.projections.map((p: any) => p.id)).size !== r.projections.length) fail();
  array(r.checks, c => { strings(c, ['id', 'name', 'detail']); bools(c, ['expectationMet']); if (!['pass', 'fail', 'inconclusive'].includes(c.status) || !['pass', 'inconclusive'].includes(c.expected)) fail(); });
  strings(r.secondExample, ['name', 'description']); numbers(r.secondExample, ['value', 'contractValue']); bools(r.secondExample, ['matches']);
  array(r.trace, t => strings(t, ['step', 'detail'])); array(r.limitations, text); strings(r.artifacts, ['json', 'html', 'database']);
  // A file is not authenticated, but its own verdicts must agree with its evidence.
  const equalList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const canonicalKeys = new Set<string>(r.truth.rows.map((event: any) => event.key));
  for (const p of r.projections) {
    const keys = new Set<string>(p.rows.map((event: any) => event.key));
    const seen = new Set<string>(); const duplicates: string[] = [];
    const derivedTasks: Record<string, boolean> = {}; let derivedTotal = 0;
    for (const event of p.rows) {
      if (seen.has(event.key)) duplicates.push(event.key);
      seen.add(event.key); derivedTasks[event.taskId] = event.isCompleted;
      derivedTotal += Number(event.isCompleted) - Number(event.wasCompleted);
    }
    const orphans = p.rows.filter((event: any) => !canonicalKeys.has(event.key)).map((event: any) => event.key);
    const missing = r.truth.rows.filter((event: any) => !keys.has(event.key)).map((event: any) => event.key);
    const rowsMatch = !orphans.length && !missing.length && !duplicates.length;
    const stateMatches = r.contract.taskIds.every((id: number) => (p.tasks[id] ?? false) === (r.truth.tasks[id] ?? false)) && p.completedCount === r.truth.completedCount;
    if (!equalList(p.orphanKeys, orphans) || !equalList(p.missingKeys, missing) || !equalList(p.duplicateKeys, duplicates)) fail();
    if (p.rowsMatch !== rowsMatch || p.stateMatches !== stateMatches || p.outcome !== (rowsMatch && stateMatches ? 'matched' : 'diverged')) fail();
    if (p.completedCount !== derivedTotal || !r.contract.taskIds.every((id: number) => (p.tasks[id] ?? false) === (derivedTasks[id] ?? false))) fail();
  }
  if (r.secondExample.matches && r.secondExample.value !== r.secondExample.contractValue) fail();
  if (r.checks.some((c: any) => c.expectationMet && c.status !== c.expected)) fail();
  return r;
}
