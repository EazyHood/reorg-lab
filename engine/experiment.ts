import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createChain } from './chain.ts';
import { clone, digest, emptyIndex, JsonFileStore, MemoryStore, project, readRows, syncIndex, taskProjector } from './indexer.ts';
import { completionCounter } from '../examples/completion-counter.ts';
import type { BlockHeader, CheckResult, EventRow, IndexSnapshot, LabReport, ProjectionResult } from './types.ts';

const taskIds = [7, 9, 42, 99];
const tasksOf = (rows: EventRow[]) => {
  const values = project(taskProjector, rows);
  return Object.fromEntries(taskIds.map(id => [id, values[id] ?? false]));
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function compareRows(actual: EventRow[], expected: EventRow[]) {
  const expectedKeys = new Set(expected.map(row => row.key));
  const actualKeys = new Set(actual.map(row => row.key));
  const seen = new Set<string>(); const duplicateKeys: string[] = [];
  for (const row of actual) { if (seen.has(row.key)) duplicateKeys.push(row.key); seen.add(row.key); }
  return {
    orphanKeys: actual.filter(row => !expectedKeys.has(row.key)).map(row => row.key),
    missingKeys: expected.filter(row => !actualKeys.has(row.key)).map(row => row.key), duplicateKeys,
  };
}
function result(id: string, label: string, snapshot: IndexSnapshot, truth: LabReport['truth'], explanation: string): ProjectionResult {
  const tasks = tasksOf(snapshot.rows);
  const completedCount = project(completionCounter, snapshot.rows);
  const diff = compareRows(snapshot.rows, truth.rows);
  const rowsMatch = !diff.orphanKeys.length && !diff.missingKeys.length && !diff.duplicateKeys.length;
  const stateMatches = same(tasks, truth.tasks) && completedCount === truth.completedCount;
  return { id, label, outcome: rowsMatch && stateMatches ? 'matched' : 'diverged', tasks, completedCount, rows: snapshot.rows, ...diff, stateMatches, rowsMatch, digest: digest({ tasks, keys: snapshot.rows.map(row => row.key) }), explanation };
}
export async function runExperiment(outputDirectory: string): Promise<LabReport> {
  await mkdir(outputDirectory, { recursive: true });
  const chain = await createChain();
  const checks: CheckResult[] = [];
  const check = (id: string, name: string, ok: boolean, detail: string) => checks.push({ id, name, status: ok ? 'pass' : 'fail', expected: 'pass', expectationMet: ok, detail });
  const trace: LabReport['trace'] = [];
  const sourcePaths = ['contracts/TaskBoard.sol', 'engine/chain.ts', 'engine/indexer.ts', 'engine/experiment.ts', 'examples/completion-counter.ts'];
  // Git checkouts may use CRLF on Windows. Hash logical source text consistently.
  const sourceDigest = digest(await Promise.all(sourcePaths.map(async path => ({ path, source: (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n') }))));
  const readTruth = async (head: BlockHeader, rows: EventRow[]): Promise<LabReport['truth']> => {
    if ((await chain.header(head.number)).hash !== head.hash) throw new Error('Truth target is no longer canonical');
    const tasks = Object.fromEntries(await Promise.all(taskIds.map(async id => [id, Boolean(await chain.call('completed', [id], head))])));
    const completedCount = Number(await chain.call('completedCount', [], head));
    if ((await chain.header(head.number)).hash !== head.hash) throw new Error('Truth changed while reading');
    return { head, tasks, completedCount, rows, digest: digest({ tasks, keys: rows.map(row => row.key) }), source: 'TaskBoard storage via eth_call with EIP-1898 blockHash + requireCanonical; eth_getLogs pinned to each canonical blockHash. Target hash checked before and after.' };
  };
  try {
    const baseline = await chain.header();
    const snapshotId = await chain.rpc('evm_snapshot');
    const initial = emptyIndex(chain.address, baseline);
    trace.push({ step: '01 / Anchor', detail: `Deploy TaskBoard at block ${baseline.number}; snapshot the node before any task event.` });
    await chain.transact(42, true); const a1 = await chain.header();
    await chain.transact(99, true); const a2 = await chain.header();
    const branchA = [a1, a2];
    const branchAStore = new MemoryStore(initial);
    const normal = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: branchAStore, mode: 'recovering' });
    const independentlyReadA = (await Promise.all(branchA.map(block => readRows(chain.rpc, chain.abi, chain.address, block)))).flat();
    const truthA = await readTruth(a2, independentlyReadA);
    check('normal', 'Normal indexing', normal.status === 'complete' && result('normal', '', normal.snapshot, truthA, '').outcome === 'matched', 'Before the branch switch, the projection agrees with contract storage and canonical event identities.');
    const savedA = await branchAStore.load();
    const flawedStore = new JsonFileStore(resolve(outputDirectory, 'height-only.json'));
    const recoveringStore = new JsonFileStore(resolve(outputDirectory, 'recovering.json'));
    const restartPath = resolve(outputDirectory, 'restart-from-a.json');
    await flawedStore.save(savedA); await recoveringStore.save(savedA); await new JsonFileStore(restartPath).save(savedA);
    const databaseDigestBefore = digest(await readFile(recoveringStore.path, 'utf8'));
    trace.push({ step: '02 / Branch A', detail: 'Complete tasks #42 and #99. Persist both indexers at A’s head, including row identities and block checkpoints.' });
    const snapshotRestored: boolean = await chain.rpc('evm_revert', [snapshotId]);
    const databaseDigestAfterNodeRevert = digest(await readFile(recoveringStore.path, 'utf8'));
    const databasePreserved = databaseDigestBefore === databaseDigestAfterNodeRevert;
    await chain.transact(7, true); const b1 = await chain.header();
    await chain.transact(9, true); const b2 = await chain.header();
    const branchB = [b1, b2];
    const sameHeight = a2.number === b2.number;
    const differentHash = a2.hash !== b2.hash && a1.hash !== b1.hash;
    check('branch-switch', 'Branch replacement exercised', snapshotRestored && sameHeight && differentHash && databasePreserved, 'Node restore returned true; A/B reach the same height with distinct block hashes. The on-disk index stayed byte-for-byte unchanged when only the node reverted.');
    trace.push({ step: '03 / Replace history', detail: 'Restore only the node. Complete #7 and #9 on branch B; keep A’s persisted index untouched. Both heads are block 3.' });
    const canonicalRows = (await Promise.all(branchB.map(block => readRows(chain.rpc, chain.abi, chain.address, block)))).flat();
    const truth = await readTruth(b2, canonicalRows);
    const flawed = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: flawedStore, mode: 'height-only' });
    const recovered = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: recoveringStore, mode: 'recovering' });
    const rebuilt = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: new MemoryStore(initial), mode: 'recovering' });
    const projections = [
      result('height-only', 'Height-only cursor', flawed.snapshot, truth, 'The head number did not increase, so this deliberately flawed adapter fetched no new rows. It retained branch A.'),
      result('recovering', 'Rollback + replay', recovered.snapshot, truth, 'Compare stored block hashes, find the common ancestor, remove orphaned rows, replay branch B, then commit the complete snapshot.'),
      result('rebuild', 'Clean rebuild', rebuilt.snapshot, truth, 'A new index starts at the pre-event anchor and independently scans canonical block hashes. It is a reference reconstruction, not the recovery path.'),
    ];
    check('detect', 'Expose the flawed projection', flawed.status === 'complete' && projections[0].outcome === 'diverged' && projections[0].orphanKeys.length === 2 && projections[0].missingKeys.length === 2, 'Height-only indexing retains two orphaned rows and misses two canonical rows, despite the same completed-task total.');
    check('recover', 'Recover state and exact rows', recovered.status === 'complete' && rebuilt.status === 'complete' && projections[1].outcome === 'matched' && projections[2].outcome === 'matched' && projections[1].digest === projections[2].digest, 'Recovered task state and row identities match both pinned contract truth and a clean rebuild.');
    trace.push({ step: '04 / Reconcile', detail: `Locate the common ancestor at block ${recovered.ancestor?.number ?? '?'}. Remove ${recovered.removed} A rows and replay ${recovered.replayed} B rows.` });
    const beforeReplay = digest(await recoveringStore.load());
    const replay = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: recoveringStore, mode: 'recovering' });
    check('replay', 'Replay is idempotent', replay.status === 'complete' && beforeReplay === digest(await recoveringStore.load()) && replay.replayed === 0, 'A second sync at the same canonical head preserves the complete persisted snapshot and adds zero rows.');
    // Instantiate a new store and a new sync invocation using only the saved A checkpoint.
    const restarted = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: new JsonFileStore(restartPath), mode: 'recovering' });
    check('restart', 'Restart from the stale disk index', restarted.status === 'complete' && result('restart', '', restarted.snapshot, truth, '').digest === projections[1].digest, 'A fresh adapter instance loads A from JSON on disk and recovers to the same B state and rows; no in-memory recovery state is carried over.');
    const shallowStore = new MemoryStore(savedA);
    const shallow = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: shallowStore, mode: 'recovering', maxRollback: 1 });
    checks.push({ id: 'depth', name: 'Insufficient rollback depth', status: shallow.status === 'inconclusive' ? 'inconclusive' : 'fail', expected: 'inconclusive', expectationMet: shallow.status === 'inconclusive' && digest(await shallowStore.load()) === digest(savedA), detail: `${shallow.reason}. The old index must remain unchanged; no claim of recovery.` });
    const failedStore = new MemoryStore(savedA);
    const failed = await syncIndex({ rpc: async (method, params) => { if (method === 'eth_getLogs') throw new Error('Injected RPC failure while reading canonical logs'); return chain.rpc(method, params); }, abi: chain.abi, store: failedStore, mode: 'recovering' });
    checks.push({ id: 'rpc', name: 'Interrupted RPC read', status: failed.status === 'inconclusive' ? 'inconclusive' : 'fail', expected: 'inconclusive', expectationMet: failed.status === 'inconclusive' && digest(await failedStore.load()) === digest(savedA), detail: `${failed.reason}. The candidate snapshot is discarded; the persisted index stays unchanged.` });
    // A later normal transition exercises a different projector through the exported interface.
    await chain.transact(7, false);
    const counterHead = await chain.header();
    const counterSync = await syncIndex({ rpc: chain.rpc, abi: chain.abi, store: new MemoryStore(clone(recovered.snapshot)), mode: 'recovering' });
    const value = project(completionCounter, counterSync.snapshot.rows);
    const contractValue = Number(await chain.call('completedCount', [], counterHead));
    const secondExample = { name: completionCounter.name, description: `A separate delta-based projector consumes the canonical stream and then a new #7 → open transition at block ${counterHead.number}. The contract counter is read at that exact block hash.`, value, contractValue, matches: counterSync.status === 'complete' && value === contractValue && value === 1 };
    check('adapter', 'Second projector example', secondExample.matches, 'The exported Projector interface runs an independent transition counter: after reopening #7, the result is 1 and agrees with contract storage.');
    trace.push({ step: '05 / Challenge the conclusion', detail: 'Run replay, stale-disk restart, shallow-history and interrupted-RPC controls. Exercise a separate completion-count projector on a subsequent block.' });
    return {
      schemaVersion: 1, runId: `rl-${digest({ a2, b2, sourceDigest }).slice(0, 12)}`, generatedAt: new Date().toISOString(), title: 'Same height. Different history.',
      environment: { engine: 'Hardhat 3.16.0 / EDR', compiler: chain.compiler, node: process.version, chainId: 31337, network: 'Fresh, in-process local EVM; no public RPC or fork', pinning: 'EIP-1898 blockHash + requireCanonical' },
      sourceDigest, contract: { name: 'TaskBoard', address: chain.address, taskIds },
      experiment: { baseline, branchA, branchB, snapshotRestored, sameHeight, differentHash, databasePreserved, databaseDigestBefore, databaseDigestAfterNodeRevert, commonAncestor: recovered.ancestor ?? baseline, removedRows: recovered.removed, replayedRows: recovered.replayed },
      truth, projections, checks, secondExample, trace,
      limitations: [
        'This is controlled branch replacement using snapshot/revert on one local EVM. It does not test consensus, network propagation, public-chain finality or a live reorg.',
        'The reference indexers cover TaskBoard event streams and JSON-file persistence. The adapter interface is not a universal repair layer for arbitrary databases.',
        'The browser displays a saved execution. It cannot execute the Node/EDR runner; run the documented local command and import its JSON to inspect your own result.',
        'Negative controls deliberately produce inconclusive results. A shallow rollback window or failed RPC read cannot establish recovery.',
        'Contract truth covers the four known task IDs and completedCount. Row comparison additionally checks missing, orphaned and duplicate event identities.',
      ],
      artifacts: { json: 'reports/latest.json', html: 'reports/latest.html', database: '.runs/latest/' },
    };
  } finally { await chain.close(); }
}
