import { IncomingMessage } from 'node:http';
import axios, { AxiosError, AxiosRequestConfig, isAxiosError } from 'axios';
import Pick from 'stream-json/filters/Pick.js';
import StreamArray from 'stream-json/streamers/StreamArray.js';

import pkg from 'stream-json';

import { Observable, Subscriber } from 'rxjs';

import { traced } from '../../tracing.js';
import { ClickHouseUnavailableError } from '../../errors/errors.js';
import { pollWithBackoff } from '../../util/poll-with-backoff.js';
import { ClickHouseCompressionMethod, ClickHouseDataFormat } from './enums/index.js';

import { ClickHouseClientOptions } from './interfaces/index.js';
const { Parser } = pkg;

type ClickHouseClientEventMap = {
  ping: CustomEvent<{ error: Error; attempt: number } | Record<string, never>>;
};

/**
 * ClickHouse Client
 * Most of the code is taken from https://github.com/depyronick/clickhouse-client
 */
@traced
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
   * Event emitter
   */
  private emitter = new EventTarget();
  private pingStopController?: AbortController;
  private pingFailedAttempts = 0;

  /**
   * Advisory hint reflecting the healthcheck loop's view: true until consecutive ping failures are observed.
   * Intended for metrics, logs, and retry decisions only — do NOT use it to decide whether a specific request
   * failure is a transport/unavailability error; inspect the caught AxiosError shape for that.
   */
  public get isAvailable(): boolean {
    return this.pingFailedAttempts === 0;
  }

  /**
   * Returns true when an axios error indicates the request never received an HTTP response —
   * i.e. ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNABORTED, network drop, etc.
   * Anything with an `error.response` is a server-side error (HTTP/SQL) and must be propagated unchanged.
   */
  private static isTransportFailure(error: unknown): error is AxiosError {
    return isAxiosError(error) && !error.response;
  }

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
    // get database from query or path. Query has precedence over path
    this.database = url.searchParams.get('database') || url.pathname.replace('/', '') || '';
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
    queryParams: Record<string, string | number | boolean> = {},
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

    return {
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
  private _queryPromise<T = string>(query: string, params?: Record<string, string | number | boolean>) {
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
          this._handlePromiseError<T>(reason);
          if (ClickHouseClient.isTransportFailure(reason)) {
            return reject(new ClickHouseUnavailableError(reason));
          }
          return reject(reason);
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
  public queryPromise<T = any>(query: string, params?: Record<string, string | number | boolean>) {
    this._validateQuery<T>(query);

    return this._queryPromise<T>(query, params);
  }

  /**
   * Promise based query with fallback. Returns data or falls back to empty array on ClickHouseUnavailableError.
   * Type T is inferred from the defaultValue parameter (a sample/default element).
   * The API for querying is same as [queryPromise].
   */
  public async queryPromiseWithDefault<T = any>(
    query: string,
    options: {
      params?: Record<string, string | number | boolean>;
      defaultValue?: T extends string ? string | T[] : T[];
    },
  ) {
    this._validateQuery<T>(query);

    try {
      const maybeData = await this._queryPromise<T>(query, options.params);

      return {
        data: maybeData,
        ok: true,
      };
    } catch (err) {
      if (err instanceof ClickHouseUnavailableError) {
        this.options?.logger?.warn(
          { err },
          'ClickHouse unavailable, returning default value from queryPromiseWithDefault',
        );
        return {
          data: options.defaultValue ?? [],
          ok: false,
        };
      }

      throw err;
    }
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
          if (ClickHouseClient.isTransportFailure(error)) {
            return reject(new ClickHouseUnavailableError(error));
          }
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
   * Starts pinging the clickhouse server with exponential backoff between attempts.
   *
   * @param baseInterval base delay between pings when healthy (ms), defaults to 5000.
   * @param maxInterval maximum delay after consecutive failures (ms), defaults to 3 minutes.
   * @param timeout per-request timeout (ms).
   */
  public async ping(baseInterval = 5000, maxInterval = 3 * 60_000, timeout?: number) {
    this.pingStopController = new AbortController();

    try {
      await pollWithBackoff(
        async (signal) => {
          const ok = await this.pingRequest(timeout, signal);
          if (!ok) {
            throw new Error('Failed to ping ClickHouse server');
          }
        },
        {
          baseInterval,
          maxInterval,
          signal: this.pingStopController.signal,
          onSuccess: () => {
            this.pingFailedAttempts = 0;
            this.emitter.dispatchEvent(new CustomEvent('ping', { detail: {} }));
          },
          onFailure: (error, attempt) => {
            this.pingFailedAttempts = attempt;
            this.emitter.dispatchEvent(
              new CustomEvent('ping', {
                detail: { error, attempt },
              }),
            );
          },
          jitter: true,
          leading: true,
        },
      );
    } catch (err) {
      this.options?.logger?.error(err);
    }
  }

  /**
   * Stops the ping loop and cancels any in-flight ping request.
   */
  public close() {
    this.pingStopController?.abort();
    this.pingStopController = undefined;
  }

  /**
   * Pings the clickhouse server
   *
   * @param timeout timeout in milliseconds, defaults to 30000.
   */
  private pingRequest(timeout = 30_000, signal?: AbortSignal) {
    return new Promise<boolean>((resolve, reject) => {
      axios
        .get(`${this.endpoint}/ping`, {
          timeout,
          signal,
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

  public addEventListener<K extends keyof ClickHouseClientEventMap>(
    type: K,
    listener: (event: ClickHouseClientEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    this.emitter.addEventListener(type, listener as EventListener, options);
  }

  public removeEventListener<K extends keyof ClickHouseClientEventMap>(
    type: K,
    listener: (event: ClickHouseClientEventMap[K]) => void,
  ): void {
    this.emitter.removeEventListener(type, listener as EventListener);
  }
}
