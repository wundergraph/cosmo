import { IncomingMessage } from 'node:http';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Pick from 'stream-json/filters/Pick.js';
import StreamArray from 'stream-json/streamers/StreamArray.js';

import pkg from 'stream-json';

import { Observable, Subscriber } from 'rxjs';

import { ClickHouseCompressionMethod, ClickHouseDataFormat } from './enums/index.js';

import { ClickHouseClientOptions } from './interfaces/index.js';
const { Parser } = pkg;

/**
 * ClickHouse Client
 * Most of the code is taken from https://github.com/depyronick/clickhouse-client
 */
export class ClickHouseClient {
  /**
   * ClickHouse Endpoint without path and query
   * @private
   */
  private endpoint = '';
  /**
   * ClickHouse Database
   */
  public database = '';
  /**
   * ClickHouse Service
   */
  constructor(private options?: ClickHouseClientOptions) {
    this.options = this.options
      ? Object.assign(new ClickHouseClientOptions(), this.options)
      : new ClickHouseClientOptions();

    if (!this.options.dsn) {
      throw new Error('ClickHouse DSN is required');
    }

    const url = new URL(this.options.dsn);
    this.database = url.searchParams.get('database') || '';
    this.endpoint = url.origin;
  }

  /**
   * Validate insert parameters
   */
  private _validateInsert<T = any>(table: string, data: T[]) {
    // validate table
    if (!table || table.trim() === '') {
      throw new Error('Table name is required');
    }

    // validate data array
    if (!Array.isArray(data)) {
      throw new TypeError('Data must be an array');
    }

    if (Array.isArray(data) && data.length === 0) {
      throw new Error('Data is empty');
    }
  }

  /**
   * Validate query parameters
   */
  private _validateQuery<T = any>(query: string) {
    if (this.options?.format && !Object.values(ClickHouseDataFormat).includes(this.options.format)) {
      throw new Error(`${this.options?.format} is not supported.`);
    }

    // validate query
    if (!query || query.trim() === '') {
      throw new Error('Query is required');
    }
  }

  /**
   * Handle ClickHouse HTTP errors (for Observable)
   */
  private _handleObservableError<T>(reason: AxiosError<any>, subscriber?: Subscriber<T>) {
    if (reason && reason.response) {
      let err = '';

      reason.response.data
        .on('data', (chunk: any) => {
          err += chunk.toString('utf8');
        })
        .on('end', () => {
          this.options?.logger?.error(err.trim());

          if (subscriber) {
            subscriber?.error(err.trim());
          }

          err = '';
        });
    } else {
      this.options?.logger?.error(reason);

      if (subscriber) {
        subscriber?.error(reason);
      }
    }
  }

  /**
   * Handle ClickHouse HTTP errors (for Promise)
   */
  private _handlePromiseError<T>(reason: AxiosError<any>) {
    if (reason && reason.response) {
      this.options?.logger?.error(reason.response.data);
    } else {
      this.options?.logger?.error(reason);
    }
  }

  /**
   * Prepare request options
   */
  private _getRequestOptions(
    query: string,
    queryParams: Record<string, string | number> = {},
    withoutFormat = false,
  ): AxiosRequestConfig<any> {
    if (!withoutFormat) {
      query = `${query.trimEnd()} FORMAT ${this.options?.format}`;
    }

    const rawParams: Record<string, string> = {
      ...Object.fromEntries(Object.entries(queryParams).map(([key, value]) => [`param_${key}`, value.toString()])),
    };

    if (this.options?.httpConfig?.compression !== ClickHouseCompressionMethod.NONE) {
      rawParams.enable_http_compression = '1';
    }

    const params = new URLSearchParams(rawParams);

    const requestOptions: AxiosRequestConfig = {
      url: this.options?.dsn,
      params,
      responseType: 'stream',
      method: 'POST',
      data: query,
      httpAgent: this.options?.httpConfig?.httpAgent,
      httpsAgent: this.options?.httpConfig?.httpsAgent,
      maxBodyLength: this.options?.httpConfig?.maxBodyLength,
      maxContentLength: this.options?.httpConfig?.maxContentLength,
      timeout: this.options?.httpConfig?.timeout,
      headers: this._getHeaders(),
    };

    return requestOptions;
  }

  /**
   * Prepare headers for request
   */
  private _getHeaders() {
    const headers: { 'Accept-Encoding'?: 'gzip' | 'deflate' | 'br' } = {};

    switch (this.options?.httpConfig?.compression) {
      case ClickHouseCompressionMethod.GZIP: {
        headers['Accept-Encoding'] = 'gzip';
        break;
      }
      case ClickHouseCompressionMethod.DEFLATE: {
        headers['Accept-Encoding'] = 'deflate';
        break;
      }
      case ClickHouseCompressionMethod.BROTLI: {
        headers['Accept-Encoding'] = 'br';
      }
    }

    return headers;
  }

  /**
   * Promise based query
   * @private
   */
  private _queryPromise<T = string>(query: string, params?: Record<string, string | number>) {
    return new Promise<T extends string ? string | T[] : T[]>((resolve, reject) => {
      axios
        .request({
          ...this._getRequestOptions(query, params),
          responseType: 'text',
        })
        .then((response) => response.data)
        .then((data) => {
          switch (this.options?.format) {
            case ClickHouseDataFormat.JSON:
            case ClickHouseDataFormat.JSONCompact:
            case ClickHouseDataFormat.JSONCompactStrings:
            case ClickHouseDataFormat.JSONStrings: {
              return resolve(JSON.parse(data).data);
            }
            default: {
              return resolve(data);
            }
          }
        })
        .catch((reason: AxiosError) => {
          return reject(this._handlePromiseError<T>(reason));
        });
    });
  }

  /**
   * Observable based query
   * @private
   */
  private _queryObservable<T = any>(query: string, params?: Record<string, string | number>) {
    return new Observable<T | string>((subscriber) => {
      axios
        .request(this._getRequestOptions(query, params))
        .then((response) => {
          const stream: IncomingMessage = response.data;

          switch (this.options?.format) {
            case ClickHouseDataFormat.JSON:
            case ClickHouseDataFormat.JSONCompact:
            case ClickHouseDataFormat.JSONCompactStrings:
            case ClickHouseDataFormat.JSONStrings: {
              const pipeline = stream
                .pipe(
                  new Parser({
                    jsonStreaming: true,
                  }),
                )
                .pipe(
                  new Pick({
                    filter: 'data',
                  }),
                )
                .pipe(new StreamArray());

              pipeline
                .on('data', (row) => {
                  subscriber.next(row.value as T);
                })
                .on('end', () => {
                  subscriber.complete();
                });
              break;
            }
            default: {
              stream
                .on('data', (chunk: Buffer) => {
                  subscriber.next(chunk.toString('utf8'));
                })
                .on('end', () => {
                  subscriber.complete();
                });
              break;
            }
          }
        })
        .catch((reason: AxiosError) => this._handleObservableError<T>(reason, subscriber));
    });
  }

  /**
   * Observable based query
   */
  public query<T = any>(query: string, params?: Record<string, string | number>) {
    this._validateQuery<T>(query);

    return this._queryObservable<T>(query, params);
  }

  /**
   * Promise based query
   */
  public queryPromise<T = any>(query: string, params?: Record<string, string | number>) {
    this._validateQuery<T>(query);

    return this._queryPromise<T>(query, params);
  }

  /**
   * Insert data to table (Observable)
   */
  public insert<T = any>(table: string, data: T[]) {
    this._validateInsert<T>(table, data);

    return new Observable<void>((subscriber) => {
      let query = `INSERT INTO ${table}`;

      /**
       * @todo: data type should not be `any`
       */
      let _data: any;

      switch (this.options?.format) {
        case ClickHouseDataFormat.JSON: {
          query += ` FORMAT JSONEachRow `;
          _data = data.map((d) => JSON.stringify(d)).join('\n');
          break;
        }
      }

      axios
        .request(
          Object.assign(this._getRequestOptions(query, {}, true), <AxiosRequestConfig>{
            responseType: 'stream',
            method: 'POST',
            data: `${query}${_data}`,
            httpAgent: this.options?.httpConfig?.httpAgent,
            httpsAgent: this.options?.httpConfig?.httpsAgent,
          }),
        )
        .then((response) => {
          const stream: IncomingMessage = response.data;

          stream
            .on('data', (data) => {
              // currently nothing to do here
              // clickhouse http interface returns an empty response
              // with inserts
            })
            .on('end', () => {
              subscriber.complete();
            });
        })
        .catch((reason: AxiosError) => this._handleObservableError(reason, subscriber));
    });
  }

  /**
   * Insert data to table (Promise)
   */
  public insertPromise<T = any>(table: string, data: T[]) {
    this._validateInsert<T>(table, data);

    return new Promise<void>((resolve, reject) => {
      this.insert<T>(table, data).subscribe({
        error: (error) => {
          return reject(error);
        },
        next: (row) => {
          // currently nothing to do here
          // clickhouse http interface returns an empty response
          // with inserts
        },
        complete: () => {
          return resolve();
        },
      });
    });
  }

  /**
   * Pings the clickhouse server
   *
   * @param timeout timeout in milliseconds, defaults to 30000.
   */
  public ping(timeout = 30_000) {
    return new Promise<boolean>((resolve, reject) => {
      axios
        .get(`${this.endpoint}/ping`, {
          timeout,
          httpAgent: this.options?.httpConfig?.httpAgent,
          httpsAgent: this.options?.httpConfig?.httpsAgent,
        })
        .then((response) => {
          if (response && response.data && response.data === 'Ok.\n') {
            return resolve(true);
          }

          return resolve(false);
        })
        .catch((reason) => {
          return reject(reason);
        });
    });
  }
}
