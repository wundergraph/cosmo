export interface Writable {
    write(chunk: string): unknown;
}
/** A failure the caller can act on: what went wrong, which input caused it, and how to correct it. */
export interface Failure {
    message: string;
    input?: string;
    fix?: string;
}
/** One step of a long operation, e.g. `{ step: 'compile', subject: 'router', message: 'Compiling router' }`. */
export interface ProgressEvent {
    step: string;
    message: string;
    subject?: string;
}
export interface Output {
    readonly json: boolean;
    /**
     * Reports one step of a long operation. People see a line on stderr; JSON callers get an NDJSON
     * `{"event":"progress",…}` line on stderr, so stdout carries only the final result.
     */
    progress(event: ProgressEvent): void;
    /** Prints the outcome: JSON for machines, the rendered text for people. */
    result<T extends object>(data: T, render: (data: T) => string): void;
    /** Prints the failure in the caller's format and sets a non-zero exit code. */
    fail(failure: Failure): void;
}
export declare const createOutput: ({ json, stdout, stderr, }: {
    json: boolean;
    stdout?: Writable;
    stderr?: Writable;
}) => Output;
