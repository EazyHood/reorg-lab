export interface BlockHeader { number: number; hash: string; parentHash: string }
export interface EventRow {
  key: string; blockNumber: number; blockHash: string; parentHash: string;
  transactionHash: string; logIndex: number; taskId: number; wasCompleted: boolean; isCompleted: boolean;
}
export interface IndexSnapshot {
  schemaVersion: 1; contract: string; anchor: BlockHeader; checkpoints: BlockHeader[]; rows: EventRow[];
}
export interface ProjectionResult {
  id: string; label: string; outcome: 'diverged' | 'matched';
  tasks: Record<string, boolean>; completedCount: number;
  rows: EventRow[]; orphanKeys: string[]; missingKeys: string[]; duplicateKeys: string[];
  stateMatches: boolean; rowsMatch: boolean; digest: string; explanation: string;
}
export interface CheckResult {
  id: string; name: string; status: 'pass' | 'fail' | 'inconclusive'; expected: 'pass' | 'inconclusive';
  expectationMet: boolean; detail: string;
}
export interface LabReport {
  schemaVersion: 1; runId: string; generatedAt: string; title: string;
  environment: { engine: string; compiler: string; node: string; chainId: number; network: string; pinning: string };
  sourceDigest: string; contract: { name: string; address: string; taskIds: number[] };
  experiment: {
    baseline: BlockHeader; branchA: BlockHeader[]; branchB: BlockHeader[]; snapshotRestored: boolean;
    sameHeight: boolean; differentHash: boolean; databasePreserved: boolean; databaseDigestBefore: string; databaseDigestAfterNodeRevert: string;
    commonAncestor: BlockHeader; removedRows: number; replayedRows: number;
  };
  truth: { head: BlockHeader; tasks: Record<string, boolean>; completedCount: number; rows: EventRow[]; digest: string; source: string };
  projections: ProjectionResult[]; checks: CheckResult[];
  secondExample: { name: string; description: string; value: number; contractValue: number; matches: boolean };
  trace: { step: string; detail: string }[]; limitations: string[];
  artifacts: { json: string; html: string; database: string };
}
