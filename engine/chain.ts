import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { Interface } from 'ethers';
import solc from 'solc';
import { readFile } from 'node:fs/promises';

export type Rpc = (method: string, params?: unknown[]) => Promise<any>;
export interface Header { number: number; hash: string; parentHash: string }
export const hex = (n: number) => `0x${n.toString(16)}`;
export async function createChain() {
  const source = await readFile(new URL('../contracts/TaskBoard.sol', import.meta.url), 'utf8');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'TaskBoard.sol': { content: source } }, settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (compiled.errors ?? []).filter((item: any) => item.severity === 'error');
  if (errors.length) throw new Error(errors.map((item: any) => item.formattedMessage).join('\n'));
  const artifact = compiled.contracts['TaskBoard.sol'].TaskBoard;
  const abi = new Interface(artifact.abi);
  const hre = await createHardhatRuntimeEnvironment({ networks: { local: { type: 'edr-simulated', chainType: 'l1', chainId: 31337, initialDate: '2026-09-13T00:00:00.000Z' } } });
  const connection = await hre.network.create('local');
  const rpc: Rpc = (method, params = []) => connection.provider.request({ method, params });
  const [account] = await rpc('eth_accounts');
  const deployment = await rpc('eth_sendTransaction', [{ from: account, data: `0x${artifact.evm.bytecode.object}`, gas: '0x4c4b40' }]);
  const receipt = await rpc('eth_getTransactionReceipt', [deployment]);
  if (receipt?.status !== '0x1' || !receipt.contractAddress) throw new Error('TaskBoard deployment failed');
  const address: string = receipt.contractAddress;
  const header = async (number: number | 'latest' = 'latest'): Promise<Header> => {
    const block = await rpc('eth_getBlockByNumber', [number === 'latest' ? number : hex(number), false]);
    if (!block) throw new Error(`Missing block ${number}`);
    return { number: Number(BigInt(block.number)), hash: block.hash, parentHash: block.parentHash };
  };
  const transact = async (id: number, value: boolean) => {
    const transactionHash = await rpc('eth_sendTransaction', [{ from: account, to: address, data: abi.encodeFunctionData('setCompleted', [id, value]), gas: '0x493e0' }]);
    const result = await rpc('eth_getTransactionReceipt', [transactionHash]);
    if (result?.status !== '0x1') throw new Error('Task transaction failed');
    return result;
  };
  const call = async (name: string, args: unknown[], block: Header) => {
    const data = await rpc('eth_call', [{ to: address, data: abi.encodeFunctionData(name, args) }, { blockHash: block.hash, requireCanonical: true }]);
    return abi.decodeFunctionResult(name, data)[0];
  };
  return { rpc, abi, address, header, transact, call, compiler: solc.version(), close: () => connection.close() };
}
