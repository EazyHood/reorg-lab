import { useEffect, useRef, useState } from 'react';
import type { BlockHeader, EventRow, LabReport } from '../engine/types.ts';
import { parseReport } from './report.ts';

const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-5)}`;
const base = import.meta.env.BASE_URL;
function Mark() { return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 18h9m0 0L29 5M14 18l15 13"/><circle cx="5" cy="18" r="3"/><circle cx="29" cy="5" r="3"/><circle cx="29" cy="31" r="3"/></svg>; }
function Status({ complete }: { complete: boolean }) { return <span className={`task-status ${complete ? 'complete' : 'open'}`}><span aria-hidden="true">{complete ? '●' : '○'}</span> {complete ? 'Complete' : 'Open'}</span>; }
function Rows({ rows, canonical }: { rows: EventRow[]; canonical: Set<string> }) {
  return <div className="event-list">{rows.length ? rows.map(row => <details className="event-row" key={row.key}>
    <summary><span className="mono">#{row.blockNumber}</span><span>Task <strong>#{row.taskId}</strong> → {row.isCompleted ? 'complete' : 'open'}</span><span className={`tag ${canonical.has(row.key) ? 'good' : 'bad'}`}>{canonical.has(row.key) ? 'Canonical' : 'Orphaned'}</span></summary>
    <dl className="hash-list"><dt>Block hash</dt><dd>{row.blockHash}</dd><dt>Transaction</dt><dd>{row.transactionHash}</dd><dt>Log index</dt><dd>{row.logIndex}</dd><dt>Event identity</dt><dd>{row.key}</dd></dl>
  </details>) : <p className="muted">No event rows in this projection.</p>}</div>;
}
export default function App() {
  const [report, setReport] = useState<LabReport | null>(null);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('Bundled saved run');
  const [selected, setSelected] = useState('height-only');
  const [block, setBlock] = useState<{ branch: string; header: BlockHeader } | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${base}reports/latest.json`);
      if (!response.ok) throw new Error(`The saved report could not be loaded (HTTP ${response.status}).`);
      const data = parseReport(await response.json());
      setReport(data); setOrigin('Bundled saved run'); setSelected(data.projections[0].id); setBlock(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'The saved report could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function importFile(file?: File) {
    if (!file) return;
    setImportError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a Reorg Lab JSON report smaller than 2 MB.');
      const data = parseReport(JSON.parse(await file.text()));
      setReport(data); setSelected(data.projections[0].id); setBlock(null); setOrigin(`Imported file: ${file.name}`);
    } catch (err) { setImportError(err instanceof Error ? err.message : 'Unable to read this file.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${report.runId.replace(/[^a-z0-9-]/gi, '-')}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function copyCommands() {
    try { await navigator.clipboard.writeText('npm ci\nnpm run lab'); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); setImportError('Clipboard access is unavailable. Select the commands below and copy them manually.'); }
  }
  const projection = report?.projections.find(p => p.id === selected) ?? report?.projections[0];
  const canonical = new Set(report?.truth.rows.map(row => row.key));
  const failures = report?.checks.filter(check => !check.expectationMet).length ?? 0;
  return <>
    <a className="skip" href="#main">Skip to experiment</a>
    <header className="topbar"><a href="#" className="wordmark" aria-label="Reorg Lab home"><Mark /><span>reorg<span className="light">lab</span><sup>01</sup></span></a><nav aria-label="Main navigation"><a href="#experiment">Experiment</a><a href="#evidence">Evidence</a><a href="#reproduce">Run locally <span aria-hidden="true">↗</span></a></nav><span className="local-tag"><span/>LOCAL EVM</span></header>
    <main id="main">
      <section className="hero"><div><p className="eyebrow">AN INDEXER FAILURE, MADE VISIBLE</p><h1>Same height.<br/><em>Different history.</em></h1><p className="hero-description">A chain can move on while your database stays behind. Follow one branch switch, find the orphaned events, and inspect the recovery.</p><div className="hero-actions"><a className="button primary" href="#experiment">Inspect the experiment <span aria-hidden="true">↓</span></a><a className="text-link" href="#reproduce">Run it yourself <span aria-hidden="true">↗</span></a></div></div><aside className="hero-note"><span className="note-number">A → B</span><p><strong>Real EVM execution.<br/>A controlled local fork.</strong></p><p>No wallet. No funds.<br/>No public network.</p><span className="tiny-rule"/><p className="small">Built for developers with a small event indexer and a big assumption.</p></aside></section>
      {loading ? <section className="loading" aria-live="polite" aria-busy="true"><span className="loading-dot"/> Reading the saved execution…</section> : error ? <section className="error-panel" role="alert"><h2>The report is unavailable.</h2><p>{error}</p><button className="button primary" onClick={() => void load()}>Try again</button></section> : report && projection && <>
        <section className="run-strip" aria-label="Report origin"><div><span className="tag neutral">SAVED RUN</span><span className="mono">{report.runId}</span><span className="run-date">{new Date(report.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span></div><p>{origin} · this page is a viewer</p></section>
        {failures > 0 && <div className="error-panel" role="alert">{failures} control expectation(s) were not met in this report. Inspect the controls before drawing a conclusion.</div>}
        {origin.startsWith('Imported') && <p className="import-notice">Loaded locally in your browser. The file’s origin and reported outcomes are not independently authenticated.</p>}
        <section id="experiment" className="section experiment"><div className="section-heading"><div><p className="eyebrow">01 / THE BRANCH SWITCH</p><h2>One height. Two versions.</h2></div><p>Only the node rolls back.<br/>The indexer keeps its memory of A.</p></div>
          <div className="experiment-board"><div className="anchor-cell"><span className="tag neutral">COMMON ANCESTOR</span><button className={`block anchor ${block?.branch === 'Anchor' ? 'selected' : ''}`} onClick={() => setBlock({ branch: 'Anchor', header: report.experiment.baseline })}><small>TaskBoard deployed</small><strong>Block {report.experiment.baseline.number}</strong><code>{short(report.experiment.baseline.hash)}</code><span className="block-arrow" aria-hidden="true">↗</span></button><span className="anchor-note">Snapshot taken here</span></div>
          <div className="branches"><div className="branch-line a"><div className="branch-label"><strong>A</strong><div><b>Original history</b><small>Persisted in the indexer</small></div><span className="tag bad">REPLACED</span></div><div className="blocks">{report.experiment.branchA.map((header, i) => <button key={header.hash} className={`block ${block?.header.hash === header.hash ? 'selected' : ''}`} onClick={() => setBlock({ branch: 'A', header })}><small>Branch A / {i + 1}</small><strong>Block {header.number}</strong><code>{short(header.hash)}</code><span className="block-arrow" aria-hidden="true">↗</span></button>)}</div></div>
          <div className="branch-line b"><div className="branch-label"><strong>B</strong><div><b>Canonical history</b><small>Read from the local EVM</small></div><span className="tag good">CURRENT</span></div><div className="blocks">{report.experiment.branchB.map((header, i) => <button key={header.hash} className={`block ${block?.header.hash === header.hash ? 'selected' : ''}`} onClick={() => setBlock({ branch: 'B', header })}><small>Branch B / {i + 1}</small><strong>Block {header.number}</strong><code>{short(header.hash)}</code><span className="block-arrow" aria-hidden="true">↗</span></button>)}</div></div></div></div>
          <div className="board-footer"><span><i className={report.experiment.sameHeight ? 'good' : 'bad'}>↔</i> Same head height: <strong>{report.experiment.sameHeight ? `#${report.truth.head.number}` : 'No'}</strong></span><span><i className={report.experiment.differentHash ? 'good' : 'bad'}>≠</i> Different hashes: <strong>{report.experiment.differentHash ? 'Confirmed' : 'Not confirmed'}</strong></span><span><i className={report.experiment.databasePreserved ? 'good' : 'bad'}>▣</i> Index on disk: <strong>{report.experiment.databasePreserved ? 'Preserved' : 'Changed'}</strong></span></div>
          {block ? <div className="block-detail" aria-live="polite"><div><strong>Branch {block.branch} · block {block.header.number}</strong><button className="icon-button" aria-label="Close block details" onClick={() => setBlock(null)}>×</button></div><dl className="hash-list"><dt>Block hash</dt><dd>{block.header.hash}</dd><dt>Parent hash</dt><dd>{block.header.parentHash}</dd></dl></div> : <p className="hint">Select a block to inspect its full hash and parent.</p>}
        </section>
        <section id="evidence" className="section"><div className="section-heading"><div><p className="eyebrow">02 / WHAT THE DATABASE BELIEVES</p><h2>A clean count can hide<br/>a dirty index.</h2></div><p>Both branches complete two tasks.<br/>They are not the same two tasks.</p></div>
          <div className="comparison"><div className="adapter-tabs" aria-label="Choose an indexer">{report.projections.map((p, i) => <button key={p.id} aria-pressed={p.id === projection.id} onClick={() => setSelected(p.id)}><span className="tab-number">0{i + 1}</span>{p.label}<span className={`tab-symbol ${p.outcome === 'matched' ? 'good' : 'bad'}`} aria-hidden="true">{p.outcome === 'matched' ? '✓' : '×'}</span></button>)}</div>
          <div className="projection-top"><div><span className={`tag ${projection.outcome === 'matched' ? 'good' : 'bad'}`}>{projection.outcome === 'matched' ? 'STATE + ROWS MATCH' : 'PROJECTION DIVERGED'}</span><h3>{projection.label}</h3><p>{projection.explanation}</p></div><div className="row-stat"><strong className={projection.orphanKeys.length ? 'bad' : 'good'}>{projection.orphanKeys.length}</strong><span>orphaned rows</span></div></div>
          <div className="table-wrap"><table className="task-table"><caption className="sr-only">Task state in the selected indexer compared with pinned canonical contract storage</caption><thead><tr><th>Task</th><th>{projection.label}</th><th>Contract truth <span className="table-sub">pinned to B</span></th><th>Comparison</th></tr></thead><tbody>{report.contract.taskIds.map(id => { const actual = projection.tasks[id] ?? false; const expected = report.truth.tasks[id] ?? false; return <tr key={id}><th><span className="mono">#{id.toString().padStart(2, '0')}</span></th><td className={actual !== expected ? 'mismatch' : ''}><Status complete={actual}/></td><td><Status complete={expected}/></td><td><span className={actual === expected ? 'match-label' : 'diff-label'}>{actual === expected ? '✓ Match' : '≠ Different'}</span></td></tr>; })}<tr className="total-row"><th>Total complete</th><td>{projection.completedCount}</td><td>{report.truth.completedCount}</td><td>{projection.completedCount === report.truth.completedCount ? 'Count agrees' : 'Count differs'}</td></tr></tbody></table></div>
          <div className="comparison-foot"><p><span aria-hidden="true">↳</span> State alone is not enough. Check the row identities too.</p><div><span><b>{projection.missingKeys.length}</b> missing</span><span><b>{projection.duplicateKeys.length}</b> duplicates</span><span><b>{projection.rows.length}</b> stored rows</span></div></div></div>
          <div className="ledger-grid"><div><div className="ledger-heading"><h3>Inside this projection</h3><span className="mono">{projection.rows.length} ROWS</span></div><Rows rows={projection.rows} canonical={canonical}/></div><div><div className="ledger-heading"><h3>Canonical event stream</h3><span className="mono">{report.truth.rows.length} ROWS</span></div><Rows rows={report.truth.rows} canonical={canonical}/></div></div>
          <details className="method"><summary>How contract truth is pinned <span aria-hidden="true">+</span></summary><p>{report.truth.source}</p><dl className="hash-list"><dt>Canonical head</dt><dd>{report.truth.head.hash}</dd><dt>State + row digest</dt><dd>{report.truth.digest}</dd><dt>Database before node revert</dt><dd>{report.experiment.databaseDigestBefore}</dd><dt>Database after node revert</dt><dd>{report.experiment.databaseDigestAfterNodeRevert}</dd></dl></details>
        </section>
        <section className="section controls"><div className="section-heading"><div><p className="eyebrow">03 / TEST THE CONCLUSION</p><h2>Recovery needs controls.</h2></div><p>{report.checks.filter(c => c.status === 'pass').length} passed · {report.checks.filter(c => c.status === 'inconclusive').length} intentionally inconclusive<br/>{failures === 0 ? 'All expected outcomes observed.' : `${failures} unmet expectations.`}</p></div>
          <div className="control-list">{report.checks.map((check, i) => <details key={check.id} className={`control ${check.status}`}><summary><span className="control-index">{String(i + 1).padStart(2, '0')}</span><span className="control-name">{check.name}</span><span className={`tag ${check.status === 'pass' ? 'good' : check.status === 'inconclusive' ? 'caution' : 'bad'}`}>{check.status}</span><span className="expand" aria-hidden="true">+</span></summary><div><p>{check.detail}</p><small>Expected: {check.expected}. Expectation {check.expectationMet ? 'met' : 'not met'}.</small></div></details>)}</div>
          <aside className="counter-example"><span className="eyebrow">A SECOND ADAPTER, SAME STREAM</span><div><h3>{report.secondExample.name}</h3><p>{report.secondExample.description}</p></div><div className="counter-values"><span><b>{report.secondExample.value}</b>Projection</span><i className={report.secondExample.matches && report.secondExample.value === report.secondExample.contractValue ? 'good' : 'bad'} aria-label={report.secondExample.matches && report.secondExample.value === report.secondExample.contractValue ? 'Matches' : 'Does not match'}>{report.secondExample.matches && report.secondExample.value === report.secondExample.contractValue ? '=' : '≠'}</i><span><b>{report.secondExample.contractValue}</b>Contract</span></div></aside>
        </section>
        <section id="reproduce" className="section reproduce"><div className="reproduce-copy"><p className="eyebrow">04 / MAKE IT YOUR EXPERIMENT</p><h2>Run it locally.<br/><em>Keep the evidence.</em></h2><p>From the project folder, Node.js 24 runs a fresh TaskBoard contract on Hardhat’s local EVM. A new JSON report, standalone HTML and index snapshots are written to disk.</p><p className="small">The saved report above came from this runner. Import your generated JSON to inspect your own execution. Files stay in your browser.</p></div><div className="command-panel"><div className="command-header"><span>TERMINAL / PROJECT ROOT</span><button onClick={() => void copyCommands()} aria-label="Copy local run commands">{copied ? 'Copied ✓' : 'Copy commands'}</button></div><pre><code><span className="command-comment"># Install the locked dependencies</span>{'\n'}npm ci{'\n\n'}<span className="command-comment"># Execute the branch switch and controls</span>{'\n'}npm run lab</code></pre><p>Node 24 · {report.environment.engine}<br/>No API key, wallet or funded account.</p></div></section>
        <div className="artifact-bar"><div><h3>Your evidence, portable.</h3><p>Inspect the exact rows, hashes and control outcomes.</p></div><div className="artifact-actions"><button className="button secondary" onClick={download}>Download this JSON <span aria-hidden="true">↓</span></button><button className="button primary" onClick={() => fileInput.current?.click()}>Import run JSON <span aria-hidden="true">↑</span></button><input className="sr-only" ref={fileInput} type="file" accept=".json,application/json" aria-label="Import Reorg Lab JSON report" onChange={event => void importFile(event.target.files?.[0])}/></div></div>
        {importError && <p className="error-message" role="alert">{importError}</p>}
        <div className="artifact-secondary"><a href={`${base}reports/latest.html`} target="_blank" rel="noreferrer">Open bundled standalone HTML ↗</a><a href={`${base}reorg-lab-pitch.pdf`} target="_blank" rel="noreferrer">Read the six-page pitch ↗</a>{origin.startsWith('Imported') && <button className="text-link" onClick={() => void load()}>Restore bundled saved run</button>}</div>
        <section className="limitations"><h3>The boundary of this experiment</h3><div>{report.limitations.map(limit => <p key={limit}>{limit}</p>)}</div></section>
        <details className="method provenance"><summary>Execution provenance <span aria-hidden="true">+</span></summary><dl className="hash-list"><dt>Engine</dt><dd>{report.environment.engine}</dd><dt>Solidity compiler</dt><dd>{report.environment.compiler}</dd><dt>Contract address (local)</dt><dd>{report.contract.address}</dd><dt>Engine source SHA-256</dt><dd>{report.sourceDigest}</dd><dt>Network</dt><dd>{report.environment.network}</dd></dl></details>
      </>}
    </main>
    <footer><a href="#" className="wordmark"><Mark/><span>reorg<span className="light">lab</span></span></a><p>Inspect the history behind the height.</p><small>Jhonatan del rio mejia · Built with Codex assistance · MIT</small></footer>
  </>;
}
