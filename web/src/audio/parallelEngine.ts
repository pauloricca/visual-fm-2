import { AUDIO_PARALLEL_WASM_ASSET_VERSION, AUDIO_PARALLEL_WORKER_ASSET_VERSION } from 'virtual:audio-engine-assets';

export interface ParallelEngine {
  processorOptions: { module: WebAssembly.Module; memory: WebAssembly.Memory; workers: number };
  dispose: () => void;
}

/** Prepare all helper instances before attaching the audio processor. Only the
 * worklet may call the shared kernel after this function returns. */
export async function createParallelEngine(
  count: number,
  signal: AbortSignal,
  onFailure: (message: string) => void,
): Promise<ParallelEngine> {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('Multi mode requires cross-origin isolation and shared memory.');
  }
  const workers: Worker[] = [];
  const pending = new Set<() => void>();
  const dispose = () => {
    for (const worker of workers) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const cancel of [...pending]) cancel();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const response = await fetch(`/audio/teia-kernel-parallel.wasm?v=${AUDIO_PARALLEL_WASM_ASSET_VERSION}`, { signal });
    if (!response.ok) throw new Error(`Could not load parallel WASM kernel (${response.status}).`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    // These limits match the parallel build's linker flags (32 MiB / 2 GiB).
    const memory = new WebAssembly.Memory({ initial: 512, maximum: 32768, shared: true });
    const instance = await WebAssembly.instantiate(module, {
      env: { memory },
      parallel: { now: () => performance.now(), wake: () => {} },
    });
    const tlsSize = instance.exports.__tls_size as WebAssembly.Global;
    const tlsAlign = instance.exports.__tls_align as WebAssembly.Global;
    if (Number(tlsSize.value) > 65536 || Number(tlsAlign.value) > 65536) {
      throw new Error('Parallel WASM thread-local storage exceeds its reserved space.');
    }
    const tlsPointer = instance.exports.dspParallelTlsPtr as (thread: number) => number;
    (instance.exports.__wasm_init_tls as (pointer: number) => void)(tlsPointer(0));
    const stackTop = instance.exports.dspParallelStackTop as (worker: number) => number;
    const controlPointer = instance.exports.dspParallelControlPtr as (worker: number) => number;
    await Promise.all(Array.from({ length: count }, (_, index) => new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const worker = new Worker(`/audio/dsp-parallel-worker.js?v=${AUDIO_PARALLEL_WORKER_ASSET_VERSION}`);
      workers.push(worker);
      let ready = false;
      const abort = () => fail('Parallel engine startup was cancelled.');
      const timeout = window.setTimeout(() => fail('Parallel audio worker startup timed out.'), 10000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        pending.delete(abort);
      };
      const fail = (message: string) => {
        cleanup();
        if (ready) onFailure(message);
        else reject(new Error(message));
      };
      pending.add(abort);
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = (event) => fail(event.message || 'Parallel audio worker failed.');
      worker.onmessageerror = () => fail('Parallel audio worker could not receive its shared memory.');
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { ready = true; cleanup(); resolve(); }
        else if (data.type === 'error') fail(data.message || 'Parallel audio worker failed.');
      };
      worker.postMessage({ module, memory, worker: index, stackTop: stackTop(index), controlPointer: controlPointer(index) });
    })));
    signal.throwIfAborted();
    return { processorOptions: { module, memory, workers: count }, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener('abort', dispose);
  }
}
