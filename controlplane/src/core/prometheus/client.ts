import axios, { AxiosHeaders, AxiosRequestConfig } from 'axios';
import { QueryResultType, Response, QueryRangeRequestParams, QueryRequestParams } from './types.js';

export interface Options {
  /**
   * Base URL of the Prometheus API.
   * @example http://localhost:9090/api/v1
   */
  apiUrl: string;
  /**
   * Timeout for the request in milliseconds.
   * @default 10000
   */
  timeout?: number;
}

export default class PrometheusClient {
  private readonly requestTimeout: number;
  private baseHeaders: AxiosHeaders = new AxiosHeaders();

  constructor(private options: Options) {
    this.requestTimeout = options.timeout || 10_000;

    this.baseHeaders.set('Content-Type', 'application/json');
  }

  /**
   * Query Prometheus API. Evaluate a single instant query.
   * @param params
   */
  async query(params: QueryRequestParams) {
    const url = `${this.options.apiUrl}/query`;
    const config: AxiosRequestConfig = {
      url,
      params,
      method: 'GET',
      timeout: this.requestTimeout,
      headers: this.baseHeaders,
    };
    const resp = await axios<Response<QueryResultType.Scalar>>(config);

    return resp.data;
  }

  /**
   * Range Query Prometheus API. Evaluate a query over a range of time.
   * @param params
   */
  async queryRange(params: QueryRangeRequestParams) {
    const url = `${this.options.apiUrl}/query_range`;
    const config: AxiosRequestConfig = {
      url,
      params,
      method: 'GET',
      timeout: this.requestTimeout,
      headers: this.baseHeaders,
    };
    const resp = await axios<Response<QueryResultType.Matrix>>(config);

    return resp.data;
  }
}
