export interface CactusWasmModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _cactus_load(ptr: number, size: bigint): number;
  _cactus_models(): number;
  _cactus_reset(): void;
  _cactus_last_error(): number;
  UTF8ToString(ptr: number): string;
  ccall(
    ident: string,
    returnType: 'number' | 'string' | 'boolean' | null,
    argTypes: Array<'number' | 'string' | 'boolean' | 'array'>,
    args: Array<unknown>
  ): unknown;
}

export default function createCactus(moduleArg?: {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string) => string;
}): Promise<CactusWasmModule>;
