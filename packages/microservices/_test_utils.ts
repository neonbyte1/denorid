export type RestoreFn = () => void;

export function mockStdWrite(
  original: typeof Deno.stdout | typeof Deno.stderr,
): RestoreFn {
  const originalWriteSync = original.writeSync;
  const originalWrite = original.write;

  original.writeSync = (buf: Uint8Array): number => buf.byteLength;
  original.write = (buf: Uint8Array): Promise<number> =>
    Promise.resolve(buf.byteLength);

  return () => {
    original.writeSync = originalWriteSync;
    original.write = originalWrite;
  };
}
