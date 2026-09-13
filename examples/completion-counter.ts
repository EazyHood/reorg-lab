import type { Projector } from '../engine/indexer.ts';

/** An independent projection plugged into the same canonical event stream.
 * It consumes transition deltas rather than retaining per-task state. */
export const completionCounter: Projector<number> = {
  name: 'Completed task total',
  initial: () => 0,
  apply: (total, row) => total + Number(row.isCompleted) - Number(row.wasCompleted),
};
