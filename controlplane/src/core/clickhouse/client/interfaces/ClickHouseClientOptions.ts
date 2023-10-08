import * as http from 'node:http';
import * as https from 'node:https';
import { BaseLogger } from 'pino';
import { ClickHouseCompressionMethod, ClickHouseConnectionProtocol, ClickHouseDataFormat } from '../enums/index.js';

export class ClickHouseSettings {
  /**
   * Enables or disables X-ClickHouse-Progress HTTP response headers in clickhouse-server responses.
   *
   * Default: 0
   */
  public send_progress_in_http_headers?: 0 | 1 = 0;

  /**
   * You can enable response buffering on the server-side. The buffer_size and wait_end_of_query URL parameters are provided for this purpose.
   * buffer_size determines the number of bytes in the result to buffer in the server memory.
   *
   * If a result body is larger than this threshold, the buffer is written to the HTTP channel, and the remaining data is sent directly to the HTTP channel.
   * To ensure that the entire response is buffered, set wait_end_of_query=1. In this case, the data that is not stored in memory will be buffered in a temporary server file.
   *
   * Default: 1
   */
  public wait_end_of_query?: 0 | 1 = 1;

  /**
   * You can enable response buffering on the server-side. The buffer_size and wait_end_of_query URL parameters are provided for this purpose.
   * buffer_size determines the number of bytes in the result to buffer in the server memory.
   *
   * If a result body is larger than this threshold, the buffer is written to the HTTP channel, and the remaining data is sent directly to the HTTP channel.
   * To ensure that the entire response is buffered, set wait_end_of_query=1. In this case, the data that is not stored in memory will be buffered in a temporary server file.
   *
   * Default: 1048576
   */
  public buffer_size?: number = 1_048_576;
}

export class ClickHouseHttpConfig {
  /**
   * HTTP Interface Protocol
   *
   * Default: HTTP
   */
  public protocol?: ClickHouseConnectionProtocol = ClickHouseConnectionProtocol.HTTP;

  /**
   * Request Timeout
   */
  public timeout?: number = 30_000;

  /**
   * HTTP Agent
   *
   * `httpAgent` define a custom agent to be used when performing http requests, in node.js.
   * This allows options to be added like `keepAlive` that are not enabled by default.
   *
   * Default: `undefined`
   */
  public httpAgent?: http.Agent;

  /**
   * HTTPS Agent
   *
   * `httpsAgent` define a custom agent to be used when performing https requests in node.js
   * This allows options to be added like `keepAlive` that are not enabled by default.
   *
   * Default: `undefined`
   */
  public httpsAgent?: https.Agent;

  /**
   * Maximum Body Length
   * (Node only option)
   *
   * Defines the max size of the http request content in bytes allowed
   *
   * Default: `Infinity`
   */
  public maxBodyLength?: number = Number.POSITIVE_INFINITY;

  /**
   * Maximum Content Length
   *
   * Defines the max size of the http response content in bytes allowed in node.js
   *
   * Default: `Infinity`
   */
  public maxContentLength?: number = Number.POSITIVE_INFINITY;

  /**
   * ClickHouse HTTP Interface Compression Method
   *
   * Default: BROTLI
   */
  public compression?: ClickHouseCompressionMethod = ClickHouseCompressionMethod.BROTLI;
}

export class ClickHouseClientOptions {
  /**
   * ClickHouse Server Identifier
   *
   * Default: CLICKHOUSE_DEFAULT
   */
  public name?: string = 'CLICKHOUSE_DEFAULT';

  /**
   * ClickHouse DSN
   */
  public dsn = 'http://localhost:8123';

  /**
   * ClickHouse Input & Output Data Format
   *
   * Default: JSON
   */
  public format?: ClickHouseDataFormat = ClickHouseDataFormat.JSON;

  /**
   * Axios HTTP Request / Response Configuration
   */
  public httpConfig?: ClickHouseHttpConfig = new ClickHouseHttpConfig();

  /**
   * ClickHouse HTTP Interface Connection Settings
   */
  public settings?: ClickHouseSettings = new ClickHouseSettings();

  /**
   * Logger Instance
   *
   */
  public logger?: BaseLogger;

  /**
   * ClickHouse Connection Options
   */
  constructor() {
    if (this.settings) {
      this.settings = Object.assign(new ClickHouseSettings(), this.settings);
    }

    if (this.httpConfig) {
      this.httpConfig = Object.assign(new ClickHouseHttpConfig(), this.httpConfig);
    }
  }
}
