// Offline A/B benchmark of slider-like control chains; never starts the app.
// Usage: node scripts/benchmark-control-cache.mjs before.wasm after.wasm
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = process.argv.slice(2);
assert.equal(files.length, 2, 'Provide baseline and candidate single-mode WASM files.');
const engines = await Promise.all(files.map(async file => (await WebAssembly.instantiate(fs.readFileSync(file))).instance.exports));
const frames = 128;
const blocks = Number(process.env.BENCHMARK_BLOCKS) || 400;
const trials = Number(process.env.BENCHMARK_TRIALS) || 7;
const chains = 24;

function prepare(wasm) {
  wasm.clearDspProgram();
  let nextRegister = 0;
  let nextValue = 0;
  const values = [];
  const op = (opcode, out = -1, a = -1, b = -1, c = -1, d = -1, e = -1, value = 0) => {
    assert(wasm.addDspOp(opcode, out, a, b, c, d, e, -1, value, 0, 0, 0) >= 0);
  };
  const literal = number => {
    const register = nextRegister++;
    wasm.setDspValue(nextValue, number);
    op(0, register, nextValue++);
    return register;
  };
  const binary = (opcode, a, b) => {
    const out = nextRegister++;
    op(opcode, out, a, b);
    return out;
  };
  const fn = (kind, x, y, z) => {
    const out = nextRegister++;
    op(26, out, kind, x, y, z);
    return out;
  };
  let total = literal(0);
  for (let chain = 0; chain < chains; chain++) {
    const unit = literal(0.25 + chain / (chains * 2));
    const curve = literal(0.3 + chain / chains);
    values.push({ unit: nextValue - 2, curve: nextValue - 1 });
    const zero = literal(0);
    const one = literal(1);
    const minEight = literal(-8);
    const eight = literal(8);
    const two = literal(2);
    const clamped = fn(8, unit, zero, one);
    const boundedCurve = fn(8, curve, minEight, eight);
    const negative = nextRegister++;
    op(18, negative, boundedCurve);
    const exponent = fn(9, two, negative, zero);
    const mapped = fn(9, clamped, exponent, zero);
    const scaled = binary(2, mapped, literal(0.03));
    total = binary(1, total, scaled);
  }
  op(5, -1, total, total);
  return values;
}

function render(wasm, count, change, bindings) {
  let block;
  for (let index = 0; index < count; index++) {
    if (change === 'ramp' && index % 8 === 0) {
      for (const binding of bindings) wasm.setDspValue(binding.unit, index % 16 ? 0.2 : 0.8);
    } else if (change === 'immediate') {
      for (const binding of bindings) wasm.setDspValueImmediate(binding.curve, index % 2 ? 0.2 : 0.9);
    }
    wasm.clear(frames);
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(frames, 48_000);
    if (index === count - 1) block = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames).slice();
  }
  return block;
}

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`24 slider curves; 128 frames at 48 kHz; ${blocks} blocks × ${trials} trials; median ms/block`);
for (const scenario of ['stable', 'ramp', 'immediate']) {
  const times = [[], []];
  for (let trial = 0; trial < trials; trial++) {
    const outputs = [];
    for (let index = 0; index < 2; index++) {
      const wasm = engines[index];
      const bindings = prepare(wasm);
      render(wasm, 32, scenario, bindings);
      const start = performance.now();
      outputs.push(render(wasm, blocks, scenario, bindings));
      times[index].push((performance.now() - start) / blocks);
    }
    assert.deepEqual(outputs[0], outputs[1], `${scenario}: outputs differ`);
  }
  console.log(`${scenario}: ${times.map(values => median(values).toFixed(6)).join(' / ')}`);
}

let bindings = engines.map(prepare);
const compareBlock = label => {
  const outputs = engines.map((wasm, index) => render(wasm, 1, 'stable', bindings[index]));
  assert.deepEqual(outputs[0], outputs[1], `${label}: outputs differ`);
};
compareBlock('first render');
for (let index = 0; index < 256; index++) {
  if (index === 1 || index === 3 || index === 64) {
    engines.forEach((wasm, engine) => bindings[engine].forEach(binding => wasm.setDspValue(binding.unit, index === 64 ? 0.4 : 0.8)));
  }
  if (index === 2 || index === 32) {
    engines.forEach((wasm, engine) => bindings[engine].forEach(binding => wasm.setDspValueImmediate(binding.curve, index === 2 ? 0.6 : 0.1)));
  }
  compareBlock(`transition block ${index}`);
}
engines.forEach(wasm => wasm.resetDspRuntimeState());
compareBlock('transport reset');
bindings = engines.map(prepare);
compareBlock('program replacement');
console.log('Exact output match across 256 transition blocks, reset, and program replacement.');

for (const wasm of engines) {
  wasm.clearDspProgram();
  wasm.setDspValue(0, 440);
  wasm.setDspValue(1, 2);
  assert(wasm.addDspOp(0, 0, 0, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
  assert(wasm.addDspOp(3, 1, 0, 0, -1, -1, -1, 0, 0, 0, 0, 0) >= 0);
  assert(wasm.addDspOp(0, 2, 1, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
  assert(wasm.addDspOp(26, 3, 9, 1, 2, 2, -1, -1, 2, 0, 0, 0) >= 0);
  assert(wasm.addDspOp(5, -1, 3, 3, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
}
for (let block = 0; block < 64; block++) {
  const outputs = engines.map(wasm => render(wasm, 1, 'stable', []));
  assert.deepEqual(outputs[0], outputs[1], `audio-rate block ${block}: outputs differ`);
}
console.log('Exact output match across 64 audio-rate oscillator-modulated blocks.');
