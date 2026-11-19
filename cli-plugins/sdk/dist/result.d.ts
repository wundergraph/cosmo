export type Result<T> = {
    success: true;
    data: T;
} | {
    success: false;
    errors: Error[];
};
export declare const ok: <T>(data: T) => Result<T>;
export declare const failure: <T>(message: string, cause?: Error) => Result<T>;
export declare const errorMessage: (result: {
    success: false;
    errors: Error[];
}) => string;
