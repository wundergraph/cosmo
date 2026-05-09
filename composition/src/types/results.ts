export interface ExecutionFailure {
  success: false;
}

export interface ExecutionMultiFailure extends ExecutionFailure {
  errors: Array<Error>;
}

export interface ExecutionSingleFailure extends ExecutionFailure {
  error: Error;
}

export interface ExecutionSuccess {
  success: true;
}

export type ExecutionMultiResult = ExecutionMultiFailure | ExecutionSuccess;

export type ExecutionSingleFailureResult = ExecutionSingleFailure | ExecutionSuccess;
