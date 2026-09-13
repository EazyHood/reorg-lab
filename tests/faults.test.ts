import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChain } from '../engine/chain.ts';
import { digest, emptyIndex, MemoryStore, syncIndex } from '../engine/indexer.ts';

test('a missing block during reconciliation is inconclusive and does not commit', async () => {
  const chain = await createChain();
  try {
    const anchor = await chain.header(); const store = new MemoryStore(emptyIndex(chain.address, anchor));
    await chain.transact(42, true); const before = digest(await store.load());
    const sync = await syncIndex({ rpc: async (method, params) => method === 'eth_getBlockByNumber' && params?.[0] === '0x2' ? null : chain.rpc(method, params), abi: chain.abi, store, mode: 'recovering' });
    assert.equal(sync.status, 'inconclusive'); assert.match(sync.reason, /omitted block/); assert.equal(digest(await store.load()), before);
  } finally { await chain.close(); }
});
test('an inconsistent canonical head at final verification prevents a partial commit', async () => {
  const chain = await createChain();
  try {
    const anchor = await chain.header(); const store = new MemoryStore(emptyIndex(chain.address, anchor));
    await chain.transact(42, true); let headReads = 0; const before = digest(await store.load());
    const sync = await syncIndex({ rpc: async (method, params) => {
      const response = await chain.rpc(method, params);
      if (method === 'eth_getBlockByNumber' && params?.[0] === '0x2' && ++headReads === 2) return { ...response, hash: `0x${'0'.repeat(64)}` };
      return response;
    }, abi: chain.abi, store, mode: 'recovering' });
    assert.equal(sync.status, 'inconclusive'); assert.match(sync.reason, /changed before commit/); assert.equal(digest(await store.load()), before);
  } finally { await chain.close(); }
});
test('wrong blockHash in an RPC log is rejected instead of silently accepted', async () => {
  const chain = await createChain();
  try {
    const anchor = await chain.header(); const store = new MemoryStore(emptyIndex(chain.address, anchor));
    await chain.transact(7, true); const before = digest(await store.load());
    const sync = await syncIndex({ rpc: async (method, params) => {
      const response = await chain.rpc(method, params);
      return method === 'eth_getLogs' ? response.map((row: any) => ({ ...row, blockHash: anchor.hash })) : response;
    }, abi: chain.abi, store, mode: 'recovering' });
    assert.equal(sync.status, 'inconclusive'); assert.match(sync.reason, /mismatched log/); assert.equal(digest(await store.load()), before);
  } finally { await chain.close(); }
});
test('duplicate logs returned by RPC cannot become duplicate persisted rows', async () => {
  const chain = await createChain();
  try {
    const anchor = await chain.header(); const store = new MemoryStore(emptyIndex(chain.address, anchor));
    await chain.transact(7, true); const before = digest(await store.load());
    const sync = await syncIndex({ rpc: async (method, params) => {
      const response = await chain.rpc(method, params); return method === 'eth_getLogs' ? [...response, ...response] : response;
    }, abi: chain.abi, store, mode: 'recovering' });
    assert.equal(sync.status, 'inconclusive'); assert.match(sync.reason, /Duplicate event/); assert.equal(digest(await store.load()), before);
  } finally { await chain.close(); }
});
