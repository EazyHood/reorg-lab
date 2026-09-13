import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runExperiment } from './experiment.ts';
import { renderHtml } from './html.ts';

try {
  const report = await runExperiment(resolve('.runs/latest'));
  await mkdir('public/reports', { recursive: true });
  await writeFile('public/reports/latest.json', `${JSON.stringify(report, null, 2)}\n`);
  await writeFile('public/reports/latest.html', renderHtml(report));
  console.log(`Reorg Lab ${report.runId}\n${report.environment.engine} · ${report.environment.network}`);
  console.table(report.checks.map(check => ({ control: check.name, observed: check.status, expected: check.expected, expectationMet: check.expectationMet })));
  console.log('JSON: public/reports/latest.json\nStandalone HTML: public/reports/latest.html\nPersisted indexes: .runs/latest/');
  if (report.checks.some(check => !check.expectationMet)) process.exitCode = 1;
} catch (error) {
  console.error(`Experiment or artifact publication did not complete: ${error instanceof Error ? error.message : String(error)}\nLatest files may belong to an earlier run or an incomplete write. Check their timestamps and rerun before relying on them.`);
  process.exitCode = 1;
}
