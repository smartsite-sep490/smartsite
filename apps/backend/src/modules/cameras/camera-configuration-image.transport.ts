/** Purpose-specific JSON budget; no producer/camera lifecycle side effects. */
export async function fetchConfigurationImageJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<unknown> {
  const { signal } = init;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Configuration image request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // A custom fetcher may abort and throw synchronously before Promise.race is attached.
  void aborted.catch(() => {});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) throw new Error('Configuration image request cancelled');
    const pending = fetcher(url, init);
    // A transport which ignores AbortSignal must not leave a late response open.
    void pending.then(
      (response) => {
        if (signal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, aborted]);
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Configuration image request cancelled');
    }
    const length = response.headers.get('content-length');
    if (
      !response.ok ||
      !response.body ||
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
        'application/json' ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > 1_500_000))
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Configuration image response refused');
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1_500_000) throw new Error('Configuration image response refused');
      chunks.push(next.value);
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader?.cancel().catch(() => {});
  }
}
