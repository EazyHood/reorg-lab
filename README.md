# Reorg Lab

**Same height. Different history.** A reproducible local EVM experiment for developers with a small event indexer.

Reorg Lab replaces a two-block branch while keeping the indexer’s JSON database intact. A deliberately flawed height-only cursor keeps the old events. A recovering adapter checks block hashes, finds the common ancestor and replays canonical rows. The report compares both with contract storage and a clean rebuild.

The web interface is a **saved-run viewer**, not an EVM in your browser. You can inspect block hashes, switch projections, expand event identities, read controls and import a report from your own execution.

[Open the interactive viewer](https://eazyhood.github.io/reorg-lab/) · [Read the six-page pitch](https://eazyhood.github.io/reorg-lab/reorg-lab-pitch.pdf) · [Source repository](https://github.com/EazyHood/reorg-lab)

## Run the real experiment

Prerequisite: **Node.js 24** (developed on 24.16.0) with npm. From this directory:

```sh
npm ci
npm run lab
```

The locked dependencies include Hardhat 3.16.0, its EDR runtime, ethers 6.17.0 and solc 0.8.37. Solidity compiles using the installed solc package; the runner does not download a compiler or contact a public RPC. Dependency installation needs the npm registry. The execution itself needs no API key, wallet, paid account or funds.

The command creates a new in-process EVM and writes:

- `public/reports/latest.json` — full evidence consumed by the viewer.
- `public/reports/latest.html` — standalone, portable HTML report; open it directly in a browser.
- `.runs/latest/` — the flawed, recovered and restarted JSON index snapshots. Re-running overwrites these latest artifacts.

A nonzero exit means the experiment could not finish, artifact publication failed or an expected control outcome was not met. The CLI warns when latest files could belong to an earlier run or an incomplete write. Check `generatedAt` and `runId` before interpreting saved evidence. The engine source digest normalizes CRLF to LF for consistent checkout identity across Windows and Linux.

## Inspect the interface

```sh
npm run dev
```

Open the local URL printed by Vite. After generating a new report, reload the viewer or choose **Import run JSON**. Imports are read locally, validated and never uploaded. An imported file’s origin and stated outcomes are not authenticated. The viewer can download the currently displayed JSON.

```sh
npm test
npm run build
npm run preview
```

`dist/` is a static site with relative asset paths, suitable for a GitHub Pages subpath. It contains the last generated JSON/HTML. Build after running the lab to publish a fresh execution. GitHub Actions runs the tests and builds the committed saved run before deploying the viewer.

## The controlled failure

1. Deploy the original `TaskBoard` contract at block 1 and snapshot the node.
2. Branch A completes tasks **42 and 99**, reaching block 3. Persist both indexers.
3. Revert **only the node**, verify `true`, then complete **7 and 9** on branch B. Verify equal height, different A/B hashes and unchanged index-file digest.
4. The height-only cursor fetches nothing because the head number did not increase. Its two stored rows are orphaned; two canonical rows are missing.
5. Recovery finds block 1, removes A’s rows and replays B. Compare exact row identities and task state with a fresh reconstruction and pinned contract reads.

Both branches report **two completed tasks**. That aggregate alone would miss the error. The report audits identities `(blockHash, transactionHash, logIndex)`, missing/orphaned/duplicate rows, the four task states and the contract’s counter.

`eth_call` uses EIP-1898 `{ blockHash, requireCanonical: true }`. `eth_getLogs` is pinned to each block hash. The target hash is checked before/after truth reads and again before committing an index snapshot. Recovery assembles a candidate in memory and atomically replaces the JSON file only after every read succeeds.

## Controls and adapters

The saved run records **nine control outcomes**: normal indexing, actual branch replacement, exposed flawed projection, exact recovery, idempotent replay, stale-disk restart, shallow rollback history, interrupted RPC read and a second projector. The shallow-history/RPC cases are expected to be **inconclusive** with unchanged stores. They do not count as demonstrated recovery.

The test suite also injects missing blocks, a changed final head, mismatched log hashes and duplicate logs. These must fail closed before commit. Tests run newly created local EVMs.

`engine/indexer.ts` exports `Store`, `Projector<T>`, `project` and `syncIndex`. `MemoryStore` and `JsonFileStore` share the storage interface. To try another projection, implement `initial()` and `apply(state, row)` and pass canonical rows to `project`. The separate `examples/completion-counter.ts` uses event deltas instead of per-task state; the experiment reopens task 7 in a subsequent block and checks its result against `completedCount` at that block hash.

This reference supports TaskBoard’s event schema. It does not claim to repair an arbitrary database or replace a full indexing framework.

## What is different, and what is not claimed

[Ponder](https://github.com/ponder-sh/ponder/blob/main/packages/core/src/runtime/realtime.ts) and [SQD](https://docs.sqd.dev/en/sdk/pipes-sdk/evm/guides/architecture-deep-dives/fork-handling) already handle reorganizations. [portal-ponder](https://github.com/subsquid-labs/portal-ponder/blob/main/VALIDATION.md) documents consistency testing. Reorg Lab’s narrower contribution is an inspectable, portable failure experiment for a small `getLogs` projection, without migrating the application to a framework. It is not a first-ever or production-safety claim.

Snapshot/revert creates a controlled branch replacement on **one local EVM**. It does not reproduce consensus, peer propagation, public-chain finality or a live network reorganization. All balances are development balances. The contract is an experiment fixture, not a production service.

Implementation follows the official [programmatic Hardhat environment](https://hardhat.org/docs/cookbook/programmatic-hre), [network manager](https://hardhat.org/docs/reference/network-manager), [Ethereum JSON-RPC](https://ethereum.org/en/developers/docs/apis/json-rpc/) and [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).

## Authorship and license

Created for 3rd-Web-Hack by **Jhonatan del rio mejia**, with **OpenAI Codex assistance** in research, design, implementation, tests and documentation. The TaskBoard contract, experiment and interface are new work for this entry. Dependencies retain their own licenses. Reorg Lab source is **MIT**; see `LICENSE`. No user study, external adoption or benchmark is claimed.
