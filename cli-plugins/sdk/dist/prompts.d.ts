export interface Prompts {
    /** False when the caller cannot be asked; callers then take the default or require a flag. */
    readonly canPrompt: boolean;
    confirm(question: string, defaultAnswer: boolean): Promise<boolean>;
    text(question: string, defaultAnswer?: string): Promise<string>;
}
export declare const createPrompts: ({ canPrompt, input, output, }: {
    canPrompt: boolean;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
}) => Prompts;
