// Offline A/B benchmark for a high-count, stateless Spread template.
// Usage: node scripts/benchmark-repeat-template.mjs baseline.wasm candidate.wasm
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const [baselinePath, candidatePath] = process.argv.slice(2);
const oscillatorMode = process.argv.includes('--osc');
const spawnMode = process.argv.includes('--spawn');
if (!baselinePath || !candidatePath) throw new Error('Provide baseline and candidate WASM paths.');
const frames = 128;
const blocks = Number(process.env.BENCHMARK_BLOCKS) || 400;
const trials = Number(process.env.BENCHMARK_TRIALS) || 7;
const baseline = (await WebAssembly.instantiate(fs.readFileSync(baselinePath))).instance.exports;
const parallelModule = await WebAssembly.compile(fs.readFileSync(candidatePath));
const memory = new WebAssembly.Memory({ initial: 512, maximum: 32768, shared: true });
const controls = [];
const candidate = (await WebAssembly.instantiate(parallelModule, {
  env: { memory }, parallel: { now: () => performance.now(), wake: () => controls.forEach(control => Atomics.notify(control, 0, 1)) },
})).exports;
candidate.__wasm_init_tls(candidate.dspParallelTlsPtr(1));
const workerSource = fs.readFileSync(path.join(import.meta.dirname, '../editor/public/audio/dsp-parallel-worker.js'), 'utf8');
const workerWrapper = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
${workerSource}
parentPort.on('message', data => self.onmessage({ data }));`;
const helpers = await Promise.all(Array.from({ length: 2 }, (_, index) => new Promise((resolve, reject) => {
  const helper = new Worker(workerWrapper, { eval: true });
  controls.push(new Int32Array(memory.buffer, candidate.dspParallelControlPtr(index), 3));
  helper.once('error', reject);
  helper.once('message', message => message.type === 'ready' ? resolve(helper) : reject(new Error(message.message)));
  helper.postMessage({ module: parallelModule, memory, worker: index,
    stackTop: candidate.dspParallelStackTop(index), controlPointer: candidate.dspParallelControlPtr(index) });
})));
candidate.configureDspParallel(helpers.length);
const engines = [baseline, candidate];

function add(wasm, opcode, out = -1, a = -1, b = -1, state = -1, value = 0, value2 = 0) {
  assert(wasm.addDspOp(opcode, out, a, b, -1, -1, -1, state, value, value2, 0, 0) >= 0);
}
function prepare(wasm, count) {
  wasm.clearDspProgram();
  wasm.clearGraph();
  wasm.resetPhases();
  wasm.setDspValue(0, count);
  if (spawnMode) {
    const values = [0, 440, 0, 0.01, 0.16, 0.72, 0.24, 0];
    values.forEach((value, index) => wasm.setDspValueImmediate(index, value));
    add(wasm, 0, 0, 0, -1, -1, 1); // trigger
    add(wasm, 0, 14, 7, -1, -1, 1); // release trigger
    assert(wasm.addDspOp(46, 15, 0, 15, 13, 14, -1, 0, 0, 9, 0, 0) >= 0);
    add(wasm, 50, 1); // instance gate
    add(wasm, 0, 2, 1); // frequency
    add(wasm, 3, 3, 0, 2, 0); // oscillator
    add(wasm, 0, 4, 2); // delay
    add(wasm, 0, 5, 3); // attack
    add(wasm, 0, 6, 4); // decay
    add(wasm, 0, 7, 5); // sustain
    add(wasm, 0, 9, 6); // release
    assert(wasm.addDspOp(19, 10, 1, 1, 4, 5, 6, 1, 9 * 4096 + 7, 0, 0, 0) >= 0);
    add(wasm, 2, 11, 3, 10);
    add(wasm, 44, 12, 11, 0);
    add(wasm, 48, 13, 1, -1, 8);
    add(wasm, 47);
    add(wasm, 5, -1, 12, 0);
    wasm.compileDspParallelPlan?.();
    for (let index = 0; index < count; index += 1) {
      wasm.setDspValueImmediate(0, 1);
      render(wasm, 1);
      wasm.setDspValueImmediate(0, 0);
      render(wasm, 1);
    }
    return;
  }
  wasm.setDspValue(1, oscillatorMode ? 440 : 0.0001);
  if (oscillatorMode) wasm.setDspValue(2, 0.0001);
  add(wasm, 0, 0, 0); // count
  if (oscillatorMode) {
    add(wasm, 42, -1, 0, 9, 0, 0, 1); // spread begin, one state per item
    add(wasm, 43, 1); // item index
    add(wasm, 0, 2, 1); // frequency
    add(wasm, 3, 3, 0, 2, 0); // sine oscillator with item-local phase
    add(wasm, 0, 4, 2); // index scale
    add(wasm, 2, 5, 1, 4);
    add(wasm, 1, 6, 3, 5);
    add(wasm, 44, 7, 6, 0);
    add(wasm, 45);
    add(wasm, 5, -1, 7, 0);
  } else {
    add(wasm, 42, -1, 0, 7, -1, 0, 0); // spread begin
    add(wasm, 43, 1); // item index
    add(wasm, 0, 2, 1); // scale
    add(wasm, 2, 3, 1, 2); // multiply
    add(wasm, 1, 4, 3, 2); // add
    add(wasm, 44, 5, 4, 0); // collect
    add(wasm, 45); // spread end
    add(wasm, 5, -1, 5, 0); // output
  }
  wasm.compileDspParallelPlan?.();
}
function render(wasm, count) {
  let last;
  for (let i = 0; i < count; i += 1) {
    wasm.clear(frames);
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(frames, 48000);
    assert.equal(wasm.dspParallelFault?.() ?? 0, 0);
    last = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames);
  }
  return last.slice();
}
function median(values) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
for (const count of spawnMode ? [8, 16, 32, 96, 128] : [8, 16, 32, 64, 96, 128, 256]) {
  const times = [[], []];
  for (let trial = 0; trial < trials; trial += 1) {
    const outputs = [];
    for (let index = 0; index < engines.length; index += 1) {
      const wasm = engines[index];
      prepare(wasm, count);
      render(wasm, 32);
      const start = performance.now();
      outputs.push(render(wasm, blocks));
      times[index].push((performance.now() - start) / blocks);
    }
    for (let frame = 0; frame < frames; frame += 1) {
      assert.equal(outputs[0][frame], outputs[1][frame], `Output diverged at frame ${frame}`);
    }
  }
  const baseline = median(times[0]);
  const candidate = median(times[1]);
  console.log(`${count} items: baseline ${baseline.toFixed(3)} ms/block, candidate ${candidate.toFixed(3)} ms/block, ${((1 - candidate / baseline) * 100).toFixed(1)}% change`);
}
if (spawnMode) {
  engines.forEach(wasm => wasm.setDspValueImmediate(7, 1));
  let finalOutput;
  for (let block = 0; block < 128; block += 1) {
    const baselineOutput = render(engines[0], 1);
    const candidateOutput = render(engines[1], 1);
    assert.deepEqual(candidateOutput, baselineOutput, `Spawn release diverged at block ${block}`);
    finalOutput = baselineOutput;
  }
  assert(finalOutput.every(sample => sample === 0), 'Released Spawn instances were not killed.');
  console.log('Spawn release and kill: exact output match through 128 blocks; all instances ended.');
}
await Promise.all(helpers.map(helper => helper.terminate()));
