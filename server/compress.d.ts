/** Types for the static-file compression, for the tests. */
export type Encoding = "br" | "gzip";
export declare const MIN_COMPRESS_BYTES: number;
export declare function pickEncoding(acceptEncoding: string | undefined | null): Encoding | null;
export declare function isCompressible(filePath: string, size: number): boolean;
export declare function compressedBody(
  filePath: string, mtimeMs: number, encoding: Encoding, raw?: Buffer,
): Promise<Buffer>;
export declare function warmCompressedCache(dir: string): Promise<number>;
