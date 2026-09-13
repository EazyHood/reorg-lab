import { createChain } from './chain.ts';
const chain = await createChain();
try {
  const baseline = await chain.header();
  const snapshot = await chain.rpc('evm_snapshot');
  await chain.transact(42, true);
  const branchA = await chain.header();
  const persistedIndexA = { hash: branchA.hash, task42: true };
  const restored = await chain.rpc('evm_revert', [snapshot]);
  await chain.transact(7, true);
  const branchB = await chain.header();
  const truth = { task42: await chain.call('completed', [42], branchB), task7: await chain.call('completed', [7], branchB) };
  const logs = await chain.rpc('eth_getLogs', [{ address: chain.address, blockHash: branchB.hash }]);
  if (!restored || branchA.number !== branchB.number || branchA.hash === branchB.hash || truth.task42 || !truth.task7 || logs.length !== 1 || !persistedIndexA.task42) throw new Error('Central proof failed');
  console.log(JSON.stringify({ passed: true, baseline, branchA, branchB, restored, persistedIndexA, truth, canonicalLogs: logs.length, pinning: 'EIP-1898 blockHash + requireCanonical' }, null, 2));
} finally { await chain.close(); }
