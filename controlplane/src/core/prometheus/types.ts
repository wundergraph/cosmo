export interface QueryRequestParams {
  time?: string;
  timeout?: string;
  query: string;
}

export interface QueryRangeRequestParams {
  start: string;
  end: string;
  step: string;
  timeout?: string;
  query: string;
}

export enum QueryResultType {
  Matrix = 'matrix',
  Vector = 'vector',
  Scalar = 'scalar',
  String = 'string',
}

export interface QueryResultValue {
  metric: { [key: string]: string };
  values: [number, string][];
  value: [number, string];
}

export interface ResponseData<ResultType extends QueryResultType> {
  resultType: ResultType;
  result: QueryResultValue[];
}

export interface Response<ResultType extends QueryResultType> {
  status: string;
  data: ResponseData<ResultType>;
  errorType?: string;
  error?: string;
  warnings?: string[];
}
