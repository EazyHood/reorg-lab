import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Interface } from 'ethers';
import type { Rpc } from './chain.ts';
import { hex } from './chain.ts';
import type { BlockHeader, EventRow, IndexSnapshot } from './types.ts';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const clone = <T>(value: T): T => structuredClone(value);
export interface Store { load(): Promise<IndexSnapshot>; save(snapshot: IndexSnapshot): Promise<void> }
export class MemoryStore implements Store {
  constructor(private snapshot: IndexSnapshot) { this.snapshot = clone(snapshot); }
  async load() { return clone(this.snapshot); }
  async save(snapshot: IndexSnapshot) { this.snapshot = clone(snapshot); }
}
export class JsonFileStore implements Store {
  constructor(readonly path: string) {}
  async load(): Promise<IndexSnapshot> {
    const value = JSON.parse(await readFile(this.path, 'utf8'));
    if (value.schemaVersion !== 1 || !Array.isArray(value.rows) || !Array.isArray(value.checkpoints)) throw new Error('Unsupported persisted index');
    return value;
  }
  async save(snapshot: IndexSnapshot) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(snapshot, null, 2));
    await rename(`${this.path}.tmp`, this.path);
  }
}
export interface Projector<T> { name: string; initial(): T; apply(state: T, row: EventRow): T }
export function project<T>(projector: Projector<T>, rows: EventRow[]): T {
  return rows.reduce((state, row) => projector.apply(state, row), projector.initial());
}
export const taskProjector: Projector<Record<string, boolean>> = {
  name: 'Task status', initial: () => ({}), apply: (state, row) => ({ ...state, [row.taskId]: row.isCompleted }),
};
export const emptyIndex = (contract: string, anchor: BlockHeader): IndexSnapshot => ({ schemaVersion: 1, contract, anchor, checkpoints: [anchor], rows: [] });
export async function getHeader(rpc: Rpc, number: number | 'latest'): Promise<BlockHeader> {
  const raw = await rpc('eth_getBlockByNumber', [number === 'latest' ? number : hex(number), false]);
  if (!raw) throw new Error(`RPC omitted block ${number}`);
  return { number: Number(BigInt(raw.number)), hash: raw.hash, parentHash: raw.parentHash };
}
export async function readRows(rpc: Rpc, abi: Interface, address: string, header: BlockHeader): Promise<EventRow[]> {
  const logs = await rpc('eth_getLogs', [{ address, blockHash: header.hash, topics: [abi.getEvent('TaskChanged')!.topicHash] }]);
  return logs.map((log: any) => {
    if (log.blockHash !== header.hash || Number(BigInt(log.blockNumber)) !== header.number || log.removed) throw new Error('RPC returned a noncanonical or mismatched log');
    const parsed = abi.parseLog(log);
    if (!parsed) throw new Error('Unexpected TaskBoard event');
    return {
      key: `${log.blockHash}:${log.transactionHash}:${Number(BigInt(log.logIndex))}`,
      blockNumber: header.number, blockHash: header.hash, parentHash: header.parentHash,
      transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)),
      taskId: Number(parsed.args.taskId), wasCompleted: parsed.args.wasCompleted, isCompleted: parsed.args.isCompleted,
    };
  });
}
export interface SyncResult {
  status: 'complete' | 'inconclusive'; reason: string; removed: number; replayed: number;
  ancestor?: BlockHeader; head?: BlockHeader; snapshot: IndexSnapshot;
}
export async function syncIndex(options: { rpc: Rpc; abi: Interface; store: Store; mode: 'height-only' | 'recovering'; maxRollback?: number }): Promise<SyncResult> {
  const { rpc, abi, store, mode, maxRollback = 16 } = options;
  const original = await store.load();
  // Build the whole next snapshot separately; a failed read never partially commits it.
  try {
    const head = await getHeader(rpc, 'latest');
    const cursor = original.checkpoints.at(-1)!;
    let ancestor = cursor;
    if (mode === 'recovering') {
      let found = false;
      for (let i = original.checkpoints.length - 1; i >= 0; i--) {
        const candidate = original.checkpoints[i];
        if (cursor.number - candidate.number > maxRollback) break;
        if (candidate.number > head.number) continue;
        const current = await getHeader(rpc, candidate.number);
        if (current.hash === candidate.hash) { ancestor = candidate; found = true; break; }
      }
      if (!found) throw new Error(`No common ancestor within ${maxRollback} block(s); full reconstruction required`);
    }
    const next = clone(original);
    next.checkpoints = next.checkpoints.filter(block => block.number <= ancestor.number);
    next.rows = next.rows.filter(row => row.blockNumber <= ancestor.number);
    const removed = original.rows.length - next.rows.length;
    let replayed = 0;
    let previous = ancestor;
    for (let height = ancestor.number + 1; height <= head.number; height++) {
      const block = await getHeader(rpc, height);
      if (mode === 'recovering' && block.parentHash !== previous.hash) throw new Error('Chain changed during scan');
      const rows = await readRows(rpc, abi, original.contract, block);
      next.rows.push(...rows); next.checkpoints.push(block); replayed += rows.length; previous = block;
    }
    if ((await getHeader(rpc, head.number)).hash !== head.hash) throw new Error('Pinned canonical block changed before commit');
    if (new Set(next.rows.map(row => row.key)).size !== next.rows.length) throw new Error('Duplicate event identity');
    await store.save(next);
    return { status: 'complete', reason: mode === 'height-only' ? 'Height cursor only; existing block hashes were not reconciled' : 'Common ancestor checked; canonical rows replayed atomically', removed, replayed, ancestor, head, snapshot: next };
  } catch (error) {
    return { status: 'inconclusive', reason: error instanceof Error ? error.message : String(error), removed: 0, replayed: 0, snapshot: original };
  }
}
