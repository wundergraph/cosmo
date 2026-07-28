declare module '@xhmikosr/decompress' {
  interface File {
    data: Buffer;
    mode: number;
    mtime: string;
    path: string;
    type: string;
  }

  interface DecompressOptions {
    filter?: (file: File) => boolean;
    map?: (file: File) => File;
    plugins?: unknown[];
    strip?: number;
  }

  export default function decompress(
    input: Buffer | string,
    output?: string,
    opts?: DecompressOptions,
  ): Promise<File[]>;
}
