// Offline WASM benchmark for DSP value smoothing. Never starts the app.
// Usage: node scripts/benchmark-dsp-values.mjs before.wasm [after.wasm]
import assert from 'node:assert/strict';
import fs from 'node:fs';

const paths = process.argv.slice(2);
assert(paths.length >= 1 && paths.length <= 2, 'Provide one or two single-mode WASM files.');
const engines = await Promise.all(paths.map(async file => (await WebAssembly.instantiate(fs.readFileSync(file))).instance.exports));
const frames = 128;
const blocks = Number(process.env.BENCHMARK_BLOCKS) || 800;
const trials = Number(process.env.BENCHMARK_TRIALS) || 9;
const cases = [
  { name: 'settled high index', initialized: 2048, moving: 0 },
  { name: 'one moving value', initialized: 2048, moving: 1 },
  { name: '64 moving values', initialized: 2048, moving: 64 },
  { name: 'all moving values', initialized: 2048, moving: 2048 },
];

function prepare(wasm, test) {
  wasm.clearDspProgram();
  for (let index = 0; index < test.initialized; index++) wasm.setDspValue(index, index / 2048);
  // Keep a real program output reading the highest initialized value.
  assert(wasm.addDspOp(0, 0, test.initialized - 1, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
  assert(wasm.addDspOp(5, -1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
}

function render(wasm, count, test) {
  for (let block = 0; block < count; block++) {
    if (test.moving && block % 16 === 0) {
      const target = block % 32 === 0 ? 0.25 : 0.75;
      for (let index = 0; index < test.moving; index++) {
        wasm.setDspValue(test.initialized - 1 - index, target);
      }
    }
    wasm.clear(frames);
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(frames, 48_000);
  }
  return new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames).slice();
}

function median(values) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

console.log(`128 frames at 48 kHz; ${blocks} measured blocks, ${trials} trials per case; ms/block median`);
for (const test of cases) {
  const times = engines.map(() => []);
  for (let trial = 0; trial < trials; trial++) {
    const outputs = [];
    for (let index = 0; index < engines.length; index++) {
      const wasm = engines[index];
      prepare(wasm, test);
      render(wasm, 32, test);
      const start = performance.now();
      outputs.push(render(wasm, blocks, test));
      times[index].push((performance.now() - start) / blocks);
    }
    if (outputs.length === 2) assert.deepEqual(outputs[1], outputs[0], `${test.name}: output differs`);
  }
  console.log(`${test.name}: ${times.map(samples => median(samples).toFixed(6)).join(' / ')}`);
}

if (engines.length === 2) {
  const [before, after] = engines;
  const check = label => {
    const outputs = [before, after].map(wasm => render(wasm, 1, { moving: 0 }));
    assert.deepEqual(outputs[1], outputs[0], `${label}: output differs`);
  };
  for (const wasm of engines) {
    wasm.clearDspProgram();
    assert(wasm.addDspOp(0, 0, 2047, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
    assert(wasm.addDspOp(5, -1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
    wasm.setDspValue(2047, 0.6);
  }
  check('first assignment');
  for (const wasm of engines) wasm.setDspValue(2047, 0.2);
  check('ramp start');
  for (const wasm of engines) wasm.setDspValue(2047, 0.2);
  check('repeated target');
  for (const wasm of engines) wasm.setDspValue(2047, 0.8);
  check('mid-ramp retarget');
  for (const wasm of engines) wasm.setDspValueImmediate(2047, 0.3);
  check('immediate assignment');
  for (const wasm of engines) wasm.setDspValue(2047, 0.3);
  check('target equals current');
  for (const wasm of engines) wasm.setDspValue(2047, 0.7);
  for (let block = 0; block < 160; block++) check('settling');
  for (const wasm of engines) wasm.resetDspRuntimeState();
  check('runtime reset');
  for (const wasm of engines) {
    wasm.clearDspProgram();
    assert(wasm.addDspOp(0, 0, 2047, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
    assert(wasm.addDspOp(5, -1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
    wasm.setDspValue(2047, 0.4);
  }
  check('program replacement');
  console.log('Exact output match: first assignment, repeated target, retarget, immediate, settled, reset, program replacement.');
}
