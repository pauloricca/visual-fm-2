// Persistent helper: one private WASM stack, shared DSP data, no audio APIs.
// The worklet publishes a quantum epoch and wakes us once. Rust executes the
// fixed per-sample jobs; this worker sleeps between quanta and while stopped.
self.onmessage = async ({ data }) => {
  const { module, memory, worker, stackTop, controlPointer } = data;
  try {
    const instance = await WebAssembly.instantiate(module, {
      env: { memory },
      parallel: { now: () => performance.now(), wake: () => {} },
    });
    instance.exports.__stack_pointer.value = stackTop;
    if (instance.exports.__tls_size.value > 65536 || instance.exports.__tls_align.value > 65536) {
      throw new Error('Parallel WASM thread-local storage is too large.');
    }
    instance.exports.__wasm_init_tls(instance.exports.dspParallelTlsPtr(worker + 2));
    const control = new Int32Array(memory.buffer, controlPointer, 3);
    self.postMessage({ type: 'ready' });
    let previous = 0;
    for (;;) {
      const epoch = Atomics.load(control, 0);
      if (epoch === previous) {
        Atomics.wait(control, 0, previous);
        continue;
      }
      previous = epoch;
      instance.exports.runDspParallelWorker(worker, epoch >>> 0);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
