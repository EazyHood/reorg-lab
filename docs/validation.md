# Validation record

Date: **2026-09-13**. Local Windows environment: Node **24.16.0**, npm **11.13.0**. No public network or external RPC was used by the experiment.

## Frozen saved execution

- Run ID: `rl-1e4e5f8aae75`
- Generated: `2026-09-13T17:00:22.645Z`
- Engine source SHA-256: `16f7135f19cf96ed4a3a9330f93d1e950fa16c93f287ea372047baf7c817e098`
- Saved `public/reports/latest.json` SHA-256: `61f033f5843b8d5d74d84bd3773d3e1296a5fa8f0ed84c421fbae3ca305d827f`

Source text is normalized from CRLF to LF before hashing. The run ID incorporates the controlled branch heads and source digest. Regenerated executions have a new observation timestamp even if those inputs and the run ID are identical.

`npm run lab` completed successfully: **nine expected control outcomes observed**, comprising seven `pass` results and two deliberate `inconclusive` results (shallow history and interrupted RPC). An inconclusive result establishes that recovery was not claimed, not that recovery succeeded.

Both branches reached block 3 with distinct hashes. The persisted index file stayed byte-for-byte unchanged across node-only revert. Height-only indexing retained two orphaned events and missed two canonical events; rollback/replay and clean reconstruction agreed on task state and exact rows. EIP-1898 canonical block-hash reads succeeded against EDR. The separate transition counter returned 1 after reopening task 7 and matched contract storage.

## Automated checks

After the final source normalization, `npm test`: **17 passed, 0 failed, 0 skipped**. The suite covers the real branch experiment, preserved persistence, exact row identities, idempotence, stale-disk restart, second projection, insufficient history, missing blocks, interrupted RPC, changed final head, mismatched log hash, duplicate logs, invalid report structure, contradictory green flags, counter mismatch and escaped/accurate standalone HTML.

`npm run build`: TypeScript validation and Vite production build passed. The static build includes the frozen JSON and standalone HTML. No server-side runtime is needed for the viewer.

## Browser checks

Observed in Edge through the supported browser UI:

- Bundled report loaded with **SAVED RUN** and its observation time.
- Selecting **Rollback + replay** changed the comparison to four matching task states, zero orphan/missing/duplicate rows and the canonical B events.
- Block selection revealed its full hash and parent hash.
- Importing the actual generated JSON succeeded and showed **Imported file** with an unauthenticated-origin notice.
- An edited JSON declaring `matched` over a divergent projection was rejected visibly; the previous report remained available.
- An edited second-example JSON with `value=99`, `contractValue=1`, `matches=false` displayed **99 ≠ 1** and an accessible “Does not match” label.
- Enter activated an adapter. Tab moved to the next control with a visible blue focus outline.
- Requested viewport sizes **375×812**, **768×1024** and **1280×900** were inspected. At each, document scroll width equaled client width; no page-level horizontal overflow was observed. Branch cards and the task comparison remained available. The temporary viewport override was reset.
- Reduced-motion behavior is implemented through a CSS media rule that disables animation/transitions and smooth scrolling; a separate OS preference change was not performed.

The local preview runs at `http://127.0.0.1:4174/` for the working session. This record does not claim a public deployment, user study, external adoption, public-chain reorganization or production-security certification. Publication and contest submission are separate steps.
