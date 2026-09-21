import { EXECUTION_STATE_TRANSITIONS, type ExecutionState } from "@trustrail/contracts";

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return EXECUTION_STATE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ExecutionState,
    public readonly to: ExecutionState
  ) {
    super(`illegal execution state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}
