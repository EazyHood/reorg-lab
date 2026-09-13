import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runExperiment, compareRows } from '../engine/experiment.ts';
import { renderHtml } from '../engine/html.ts';
import { parseReport } from '../src/report.ts';
import type { LabReport } from '../engine/types.ts';

let report: LabReport;
before(async () => { await mkdir('.runs', { recursive: true }); report = await runExperiment(resolve('.runs/test-main')); });

test('real local EVM reaches distinct A/B hashes at the same height while preserving disk state', () => {
  const e = report.experiment;
  assert.equal(e.snapshotRestored, true);
  assert.equal(e.branchA.at(-1)!.number, e.branchB.at(-1)!.number);
  assert.notEqual(e.branchA.at(-1)!.hash, e.branchB.at(-1)!.hash);
  assert.equal(e.databaseDigestBefore, e.databaseDigestAfterNodeRevert);
  assert.equal(e.databasePreserved, true);
  assert.equal(e.branchA[0].parentHash, e.baseline.hash);
  assert.equal(e.branchB[0].parentHash, e.baseline.hash);
});
test('contract storage is pinned to B and distinguishes the tasks despite identical totals', () => {
  assert.deepEqual(report.truth.tasks, { '7': true, '9': true, '42': false, '99': false });
  assert.match(report.environment.pinning, /EIP-1898/);
  assert.equal(report.truth.completedCount, 2);
  const flawed = report.projections[0];
  assert.equal(flawed.completedCount, report.truth.completedCount);
  assert.equal(flawed.stateMatches, false);
  assert.equal(flawed.rowsMatch, false);
  assert.equal(flawed.orphanKeys.length, 2);
  assert.equal(flawed.missingKeys.length, 2);
});
test('recovery removes exact orphan rows and equals a clean canonical reconstruction', () => {
  const recovered = report.projections[1], rebuilt = report.projections[2];
  assert.equal(recovered.outcome, 'matched');
  assert.equal(rebuilt.outcome, 'matched');
  assert.equal(recovered.digest, rebuilt.digest);
  assert.equal(recovered.digest, report.truth.digest);
  assert.equal(report.experiment.removedRows, 2);
  assert.equal(report.experiment.replayedRows, 2);
  assert.deepEqual(recovered.rows.map(r => r.key), report.truth.rows.map(r => r.key));
});
test('replay and restart recover without duplicates or hidden in-memory state', () => {
  for (const id of ['replay', 'restart']) assert.equal(report.checks.find(c => c.id === id)?.status, 'pass');
  assert.deepEqual(report.projections[1].duplicateKeys, []);
});
test('negative controls remain inconclusive and their expected result is explicit', () => {
  for (const id of ['depth', 'rpc']) {
    const check = report.checks.find(c => c.id === id)!;
    assert.equal(check.status, 'inconclusive'); assert.equal(check.expected, 'inconclusive'); assert.equal(check.expectationMet, true);
  }
  assert.equal(report.checks.length, 9);
  assert.ok(report.checks.every(c => c.expectationMet));
});
test('second projector handles a reversing transition and independently checks storage', () => {
  assert.equal(report.secondExample.value, 1); assert.equal(report.secondExample.contractValue, 1); assert.equal(report.secondExample.matches, true);
});
test('row audit catches duplicate identities even when aggregate state could agree', () => {
  const canonical = report.truth.rows;
  const diff = compareRows([...canonical, canonical[0]], canonical);
  assert.deepEqual(diff.duplicateKeys, [canonical[0].key]);
  assert.deepEqual(diff.orphanKeys, []); assert.deepEqual(diff.missingKeys, []);
});
test('viewer accepts runner data but rejects incompatible and structurally invalid imports', () => {
  assert.equal(parseReport(JSON.parse(JSON.stringify(report))).runId, report.runId);
  assert.throws(() => parseReport(null));
  assert.throws(() => parseReport({ ...report, schemaVersion: 2 }));
  assert.throws(() => parseReport({ ...report, projections: [] }));
  assert.throws(() => parseReport({ ...report, truth: { ...report.truth, rows: [null] } }));
  assert.throws(() => parseReport({ ...report, checks: [{ ...report.checks[0], status: 'green' }] }));
  assert.throws(() => parseReport({ ...report, generatedAt: 'not-a-date' }));
});
test('standalone HTML keeps evidence and escapes report text', () => {
  const html = renderHtml({ ...report, title: '<img src=x onerror=alert(1)>' });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes(report.truth.head.hash));
  assert.ok(html.includes('INCONCLUSIVE')); assert.ok(html.includes('SAVED LOCAL EXECUTION'));
});
test('a mutated report cannot declare a green outcome over divergent state and orphan rows', () => {
  const mutatedJson = JSON.parse(JSON.stringify(report));
  mutatedJson.projections[0].outcome = 'matched';
  assert.equal(mutatedJson.projections[0].stateMatches, false);
  assert.equal(mutatedJson.projections[0].orphanKeys.length, 2);
  assert.throws(() => parseReport(mutatedJson));
});
test('a mutated second-example result is displayed as a mismatch; a false green claim is rejected', () => {
  const mutatedJson = JSON.parse(JSON.stringify(report));
  mutatedJson.secondExample = { ...mutatedJson.secondExample, value: 99, contractValue: 1, matches: false };
  assert.equal(parseReport(mutatedJson).secondExample.matches, false);
  mutatedJson.secondExample.matches = true;
  assert.throws(() => parseReport(mutatedJson));
});
test('mutating projection flags, row summaries or derived states is rejected', () => {
  for (const mutate of [
    (r: LabReport) => { r.projections[1].stateMatches = false; },
    (r: LabReport) => { r.projections[0].orphanKeys = []; },
    (r: LabReport) => { r.projections[1].tasks['7'] = false; },
    (r: LabReport) => { r.projections[1].completedCount = 99; },
  ]) { const modified = structuredClone(report); mutate(modified); assert.throws(() => parseReport(modified)); }
});
test('HTML reports failed branch preconditions as false instead of claiming the fork succeeded', () => {
  const failed = structuredClone(report);
  failed.experiment.sameHeight = false; failed.experiment.differentHash = false; failed.experiment.databasePreserved = false;
  const html = renderHtml(failed);
  assert.ok(html.includes('Same height: <strong>false</strong>'));
  assert.ok(html.includes('Different hashes: <strong>false</strong>'));
  assert.ok(html.includes('Index unchanged after node-only revert: <strong>false</strong>'));
  assert.ok(!html.includes('with different hashes'));
});
