import { z } from 'zod';
import { Bearer } from './credentials.js';
import { Result } from './result.js';
export type ToolArgument = string | number | boolean | null | ToolArgument[] | {
    [key: string]: ToolArgument;
};
export interface SchemaPushRequest {
    sandboxYaml: string;
    subgraphs: Array<{
        name: string;
        sdl: string;
    }>;
    sha: string;
}
export interface HubClient {
    /** Calls one tool on Hub's MCP endpoint and validates its structured result. */
    callTool<T>(name: string, args: Record<string, ToolArgument>, schema: z.ZodType<T>): Promise<Result<T>>;
    /** Posts a schema push from CI to `POST /ci/schema-push`. */
    pushSchema<T>(request: SchemaPushRequest, schema: z.ZodType<T>): Promise<Result<T>>;
}
export declare const createHubClient: ({ baseUrl, bearer, clientVersion, fetchImpl, }: {
    baseUrl: string;
    bearer: () => Promise<Result<Bearer>>;
    clientVersion: string;
    fetchImpl?: typeof fetch;
}) => HubClient;
