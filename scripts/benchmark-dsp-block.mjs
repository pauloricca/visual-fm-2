// Offline scalar/block comparison; no browser, server, or audio device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const bytes = fs.readFileSync(new URL('../web/public/audio/visual-fm-kernel.wasm', import.meta.url));
const simdBytes = fs.readFileSync(new URL('../web/public/audio/visual-fm-kernel-simd.wasm', import.meta.url));
assert(WebAssembly.validate(simdBytes), 'This benchmark host does not support WASM SIMD.');
const sampleRate = 48_000;
const cases = [
  { name: 'one oscillator', voices: 1, filter: false },
  { name: '16 oscillators', voices: 16, filter: false },
  { name: 'audio-rate modulation', voices: 8, filter: false, modulate: true },
  { name: '32 oscillators and filter', voices: 32, filter: true },
];
for (const test of cases) {
  const scalar = (await WebAssembly.instantiate(bytes)).instance.exports;
  const block = (await WebAssembly.instantiate(bytes)).instance.exports;
  const simd = (await WebAssembly.instantiate(simdBytes)).instance.exports;
  const program = makeProgram(test);
  const monitorRegister = program.find((op) => op.opcode === 3).out;
  for (const wasm of [scalar, block, simd]) {
    wasm.resetPhases();
    wasm.clearDspProgram();
    wasm.clearGraph();
    for (const [index, value] of [440, 0.025, 1800, 0.6, 220].entries()) wasm.setDspValue(index, value);
    for (const op of program) {
      assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1, op.b ?? -1,
        op.c ?? -1, op.d ?? -1, op.e ?? -1, op.state ?? -1,
        op.value ?? 0, op.value2 ?? 0, op.value3 ?? 0, op.value4 ?? 0) >= 0);
    }
    assert.equal(wasm.compileDspBlockPlan(), 1, `${test.name}: not eligible`);
    assert.equal(wasm.dspBlockRenderingEnabled(), 1, `${test.name}: ordinary block path should remain automatic`);
    wasm.clearDspMeters();
    wasm.setDspMeter(0, monitorRegister);
    wasm.clearDspScopes();
    wasm.setDspScope(0, monitorRegister, 0.01, 32, sampleRate);
    assert.equal(wasm.compileDspBlockPlan(), 1, `${test.name}: monitored plan not eligible`);
  }
  scalar.setDspBlockRendering(0);
  block.setDspBlockRendering(1);
  const check = (frames, label) => {
    const before = render(scalar, frames);
    const after = render(block, frames);
    assert.deepEqual(after, before, `${test.name}: ${label}`);
    assert.deepEqual(render(simd, frames), before, `${test.name}: SIMD ${label}`);
    assert.equal(block.dspMeterLevel(0), scalar.dspMeterLevel(0), `${test.name}: meter ${label}`);
    assert.equal(simd.dspMeterLevel(0), scalar.dspMeterLevel(0), `${test.name}: SIMD meter ${label}`);
    assert.equal(block.dspScopeCount(0), scalar.dspScopeCount(0), `${test.name}: scope count ${label}`);
    assert.equal(simd.dspScopeCount(0), scalar.dspScopeCount(0), `${test.name}: SIMD scope count ${label}`);
    const count = block.dspScopeCount(0);
    const scope = (wasm) => new Float32Array(wasm.memory.buffer, wasm.dspScopePtr(0), 1024).slice(0, count);
    assert.deepEqual(scope(block), scope(scalar), `${test.name}: scope samples ${label}`);
    assert.deepEqual(scope(simd), scope(scalar), `${test.name}: SIMD scope samples ${label}`);
    assert.equal(block.dspBlockPlanBytes() > 0, true);
  };
  for (const frames of [1, 17, 128, 300, 2048]) check(frames, `partial ${frames}`);
  for (const wasm of [scalar, block, simd]) wasm.setDspValue(0, 880);
  for (let index = 0; index < 12; index++) check(128, `smoothing ${index}`);
  for (const wasm of [scalar, block, simd]) wasm.setDspValueImmediate(0, 110);
  check(128, 'immediate');
  for (const wasm of [scalar, block, simd]) wasm.resetPhases();
  check(128, 'reset');

  const setupTimes = [];
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    assert.equal(block.compileDspBlockPlan(), 1);
    setupTimes.push(performance.now() - started);
  }

  for (let index = 0; index < 16; index++) { render(scalar, 128); render(block, 128); render(simd, 128); }
  const trials = 7;
  const measuredBlocks = 256;
  const results = [[], [], []];
  for (let trial = 0; trial < trials; trial++) {
    for (const wasm of trial % 2 ? [simd, block, scalar] : [scalar, block, simd]) {
      const started = performance.now();
      for (let blockIndex = 0; blockIndex < measuredBlocks; blockIndex++) render(wasm, 128, false);
      const elapsed = (performance.now() - started) / measuredBlocks;
      results[wasm === scalar ? 0 : wasm === block ? 1 : 2].push(elapsed);
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const scalarMs = median(results[0]);
  const blockMs = median(results[1]);
  const simdMs = median(results[2]);
  console.log(`${test.name}: ${program.length} ops, ${block.dspBlockPlanBytes()} scratch bytes, plan setup ${median(setupTimes).toFixed(4)} ms; scalar ${scalarMs.toFixed(4)} ms, block ${blockMs.toFixed(4)} ms, SIMD ${simdMs.toFixed(4)} ms per 128 frames. Exact output and state-transition cases passed.`);
}

// Exercise the extended scalar helpers with audio-rate KinkOsc modulation,
// reset fade and range mapping, a cached Function, short-delay feedback,
// a DC blocker, smoothed controls, immediate changes, and transport reset.
const extendedOps = Array.from({ length: 10 }, (_, index) => ({ opcode: 0, out: index, a: index }));
extendedOps.push(
  { opcode: 3, out: 10, a: 12, b: 0, c: 2, d: 3, e: 4, state: 0, value: 1, value2: 5, value3: 6, value4: 1 },
  { opcode: 26, out: 11, a: 8, b: 10, c: 5, d: 6 },
  { opcode: 26, out: 12, a: 9, b: 11, c: 2, d: 5 },
  { opcode: 26, out: 13, a: 9, b: 1, c: 2, d: 3 },
  { opcode: 2, out: 14, a: 12, b: 13 },
  { opcode: 12, out: 15, a: 14, b: 7, c: 8, d: 9, state: 4 },
  { opcode: 51, out: 16, a: 15, state: 5 },
  { opcode: 5, a: 16, b: 0 },
  { opcode: 5, a: 16, b: 1 },
);
const extendedEngines = await Promise.all([WebAssembly.instantiate(bytes), WebAssembly.instantiate(bytes), WebAssembly.instantiate(simdBytes)]);
const [extendedScalar, extendedBlock, extendedSimd] = extendedEngines.map(({ instance }) => instance.exports);
for (const wasm of [extendedScalar, extendedBlock, extendedSimd]) {
  wasm.clearDspProgram();
  [310, 0.3, 0.2, 0.05, 0, -0.5, 0.7, 0.001, 0.5, 0.4].forEach((value, index) => wasm.setDspValue(index, value));
  for (const op of extendedOps) assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1,
    op.b ?? -1, op.c ?? -1, op.d ?? -1, op.e ?? -1, op.state ?? -1,
    op.value ?? 0, op.value2 ?? 0, op.value3 ?? 0, op.value4 ?? 0) >= 0);
  assert.equal(wasm.compileDspBlockPlan(), 1);
}
assert.equal(extendedBlock.dspBlockRenderingEnabled(), 0, 'ordinary kernel should automatically retain scalar for KinkOsc/power');
assert.equal(extendedSimd.dspBlockRenderingEnabled(), 1, 'SIMD kernel should automatically use the block plan');
extendedScalar.setDspBlockRendering(0);
extendedBlock.setDspBlockRendering(1);
for (let blockIndex = 0; blockIndex < 320; blockIndex++) {
  for (const wasm of [extendedScalar, extendedBlock, extendedSimd]) {
    if (blockIndex === 32) wasm.setDspValue(1, -0.9);
    if (blockIndex === 64) wasm.setDspValueImmediate(4, 1);
    if (blockIndex === 65) wasm.setDspValueImmediate(4, 0);
    if (blockIndex === 96) wasm.setDspValue(7, 0.0005);
    if (blockIndex === 160) wasm.resetDspRuntimeState();
  }
  const expected = render(extendedScalar, 128);
  assert.deepEqual(render(extendedBlock, 128), expected, `extended block ${blockIndex}`);
  assert.deepEqual(render(extendedSimd, 128), expected, `extended SIMD ${blockIndex}`);
  for (const wasm of [extendedBlock, extendedSimd]) {
    for (let state = 0; state < 7; state++) {
      assert(Object.is(wasm.getDspState(state), extendedScalar.getDspState(state)),
        `extended state ${state} at block ${blockIndex}`);
    }
    const slot = wasm.dspEffectSlotForState(4);
    assert.equal(wasm.getDspEffectIndex(slot), extendedScalar.getDspEffectIndex(extendedScalar.dspEffectSlotForState(4)));
  }
}
const extendedDelayBuffer = (wasm) => new Float32Array(wasm.memory.buffer,
  wasm.dspEffectBufferPtr(wasm.dspEffectSlotForState(4)), wasm.dspEffectBufferLength());
assert.deepEqual(extendedDelayBuffer(extendedBlock), extendedDelayBuffer(extendedScalar));
assert.deepEqual(extendedDelayBuffer(extendedSimd), extendedDelayBuffer(extendedScalar));
console.log('Extended KinkOsc, Function, delay, and DC-block output and state passed.');

const feedbackOps = [];
let nextFeedbackRegister = 0;
const feedbackValue = (index) => {
  const out = nextFeedbackRegister++;
  feedbackOps.push({ opcode: 0, out, a: index });
  return out;
};
const feedbackFrequency = feedbackValue(0);
const feedbackAmplitude = feedbackValue(1);
let upstream = -1;
for (let voice = 0; voice < 16; voice++) {
  const oscillator = nextFeedbackRegister++;
  feedbackOps.push({ opcode: 3, out: oscillator, a: 0, b: feedbackFrequency, state: voice * 4, value: 0.5 });
  const scaled = nextFeedbackRegister++;
  feedbackOps.push({ opcode: 2, out: scaled, a: oscillator, b: feedbackAmplitude });
  if (upstream < 0) upstream = scaled;
  else {
    const combined = nextFeedbackRegister++;
    feedbackOps.push({ opcode: 1, out: combined, a: upstream, b: scaled });
    upstream = combined;
  }
}
const feedbackRead = nextFeedbackRegister++;
feedbackOps.push({ opcode: 8, out: feedbackRead, state: 100 });
const feedbackSum = nextFeedbackRegister++;
feedbackOps.push({ opcode: 1, out: feedbackSum, a: upstream, b: feedbackRead });
const feedbackGain = feedbackValue(2);
const feedbackWriteValue = nextFeedbackRegister++;
feedbackOps.push({ opcode: 2, out: feedbackWriteValue, a: feedbackSum, b: feedbackGain });
feedbackOps.push({ opcode: 9, a: feedbackWriteValue, state: 100 });
const feedbackOutput = nextFeedbackRegister++;
feedbackOps.push({ opcode: 1, out: feedbackOutput, a: feedbackWriteValue, b: upstream });
feedbackOps.push({ opcode: 5, a: feedbackOutput, b: 0 });
feedbackOps.push({ opcode: 5, a: feedbackOutput, b: 1 });
const feedbackEngines = await Promise.all([WebAssembly.instantiate(bytes), WebAssembly.instantiate(bytes), WebAssembly.instantiate(simdBytes)]);
const [feedbackScalar, feedbackMixed, feedbackSimd] = feedbackEngines.map(({ instance }) => instance.exports);
for (const wasm of [feedbackScalar, feedbackMixed, feedbackSimd]) {
  wasm.resetPhases();
  wasm.clearDspProgram();
  wasm.setDspValue(0, 440);
  wasm.setDspValue(1, 0.025);
  wasm.setDspValue(2, 0.6);
  for (const op of feedbackOps) {
    assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1, op.b ?? -1,
      op.c ?? -1, op.d ?? -1, op.e ?? -1, op.state ?? -1,
      op.value ?? 0, 0, 0, 0) >= 0);
  }
  wasm.clearDspMeters();
  wasm.setDspMeter(0, feedbackOutput);
  wasm.clearDspScopes();
  wasm.setDspScope(0, feedbackOutput, 0.01, 32, sampleRate);
  assert.equal(wasm.compileDspBlockPlan(), 2, 'feedback program should use mixed rendering');
}
feedbackScalar.setDspBlockRendering(0);
const checkFeedbackMonitors = () => {
  const scope = (wasm) => new Float32Array(wasm.memory.buffer, wasm.dspScopePtr(0), 1024).slice(0, wasm.dspScopeCount(0));
  for (const wasm of [feedbackMixed, feedbackSimd]) {
    assert.equal(wasm.dspMeterLevel(0), feedbackScalar.dspMeterLevel(0));
    assert.equal(wasm.dspScopeCount(0), feedbackScalar.dspScopeCount(0));
    assert.deepEqual(scope(wasm), scope(feedbackScalar));
  }
};
for (const frames of [1, 17, 128, 300, 2048]) {
  const expected = render(feedbackScalar, frames);
  assert.deepEqual(render(feedbackMixed, frames), expected, `mixed feedback ${frames}`);
  assert.deepEqual(render(feedbackSimd, frames), expected, `SIMD feedback ${frames}`);
  checkFeedbackMonitors();
}
for (const wasm of [feedbackScalar, feedbackMixed, feedbackSimd]) wasm.setDspValue(2, 0.3);
for (let index = 0; index < 32; index++) {
  const expected = render(feedbackScalar, 128);
  assert.deepEqual(render(feedbackMixed, 128), expected, `mixed feedback ramp ${index}`);
  assert.deepEqual(render(feedbackSimd, 128), expected, `SIMD feedback ramp ${index}`);
  checkFeedbackMonitors();
}
const mixedSetupTimes = [];
for (let index = 0; index < 100; index++) {
  const started = performance.now();
  assert.equal(feedbackMixed.compileDspBlockPlan(), 2);
  mixedSetupTimes.push(performance.now() - started);
}
const mixedTimes = [[], [], []];
for (let trial = 0; trial < 7; trial++) {
  for (const wasm of trial % 2 ? [feedbackSimd, feedbackMixed, feedbackScalar] : [feedbackScalar, feedbackMixed, feedbackSimd]) {
    const started = performance.now();
    for (let index = 0; index < 256; index++) render(wasm, 128, false);
    mixedTimes[wasm === feedbackScalar ? 0 : wasm === feedbackMixed ? 1 : 2].push((performance.now() - started) / 256);
  }
}
const mixedMedian = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`Mixed feedback: ${feedbackMixed.dspBlockPlanBytes()} scratch bytes, plan setup ${mixedMedian(mixedSetupTimes).toFixed(4)} ms; scalar ${mixedMedian(mixedTimes[0]).toFixed(4)} ms, mixed ${mixedMedian(mixedTimes[1]).toFixed(4)} ms, mixed SIMD ${mixedMedian(mixedTimes[2]).toFixed(4)} ms per 128 frames. Exact output passed.`);

const twoCycles = [
  ...feedbackOps.slice(0, -2),
  { opcode: 8, out: nextFeedbackRegister, state: 120 },
  { opcode: 1, out: nextFeedbackRegister + 1, a: feedbackOutput, b: nextFeedbackRegister },
  { opcode: 2, out: nextFeedbackRegister + 2, a: nextFeedbackRegister + 1, b: feedbackGain },
  { opcode: 9, a: nextFeedbackRegister + 2, state: 120 },
  { opcode: 5, a: nextFeedbackRegister + 2, b: 0 },
];
const twoCycleEngines = await Promise.all([WebAssembly.instantiate(bytes), WebAssembly.instantiate(bytes)]);
const [twoScalar, twoMixed] = twoCycleEngines.map(({ instance }) => instance.exports);
for (const wasm of [twoScalar, twoMixed]) {
  wasm.clearDspProgram();
  [440, 0.025, 0.6].forEach((value, index) => wasm.setDspValue(index, value));
  for (const op of twoCycles) assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1,
    op.b ?? -1, op.c ?? -1, op.d ?? -1, op.e ?? -1, op.state ?? -1,
    op.value ?? 0, 0, 0, 0) >= 0);
  assert.equal(wasm.compileDspBlockPlan(), 2);
}
twoScalar.setDspBlockRendering(0);
for (let index = 0; index < 32; index++) {
  assert.deepEqual(render(twoMixed, index % 2 ? 128 : 17), render(twoScalar, index % 2 ? 128 : 17), `two feedback cycles ${index}`);
}
console.log('Two feedback cycles passed.');

const tinyFeedback = (await WebAssembly.instantiate(bytes)).instance.exports;
tinyFeedback.clearDspProgram();
tinyFeedback.setDspValue(0, 0.1);
for (const op of [
  { opcode: 8, out: 0, state: 0 },
  { opcode: 0, out: 1, a: 0 },
  { opcode: 1, out: 2, a: 0, b: 1 },
  { opcode: 9, a: 2, state: 0 },
  { opcode: 5, a: 2, b: 0 },
]) assert(tinyFeedback.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1,
  op.b ?? -1, -1, -1, -1, op.state ?? -1, 0, 0, 0, 0) >= 0);
assert.equal(tinyFeedback.compileDspBlockPlan(), 0, 'small feedback graph should retain scalar path');
console.log('Small-feedback scalar fallback passed.');

const fallback = (await WebAssembly.instantiate(bytes)).instance.exports;
fallback.clearDspProgram();
assert(fallback.addDspOp(11, 0, 1, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
assert(fallback.addDspOp(5, -1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
assert.equal(fallback.compileDspBlockPlan(), 0, 'resource operation must use scalar rendering');
console.log('Resource fallback passed.');

const sharedDelay = (await WebAssembly.instantiate(bytes)).instance.exports;
sharedDelay.clearDspProgram();
sharedDelay.setDspValue(0, 0.1);
assert(sharedDelay.addDspOp(0, 0, 0, -1, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
assert(sharedDelay.addDspOp(12, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0) >= 0);
assert(sharedDelay.addDspOp(12, 2, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0) >= 0);
assert(sharedDelay.addDspOp(5, -1, 2, 0, -1, -1, -1, -1, 0, 0, 0, 0) >= 0);
assert.equal(sharedDelay.compileDspBlockPlan(), 0, 'shared delay buffer must retain scalar order');
console.log('Shared-delay scalar fallback passed.');

function makeProgram({ voices, filter, modulate }) {
  const ops = [];
  let next = 0;
  const value = (index) => { const out = next++; ops.push({ opcode: 0, out, a: index }); return out; };
  const freq = value(0);
  const amplitude = value(1);
  let frequencySignal = freq;
  if (modulate) {
    const depth = value(4);
    const modulator = next++;
    ops.push({ opcode: 3, out: modulator, a: 0, b: freq, state: 400, value: 0.5 });
    const deviation = next++;
    ops.push({ opcode: 2, out: deviation, a: modulator, b: depth });
    frequencySignal = next++;
    ops.push({ opcode: 1, out: frequencySignal, a: freq, b: deviation });
  }
  let total = -1;
  for (let voice = 0; voice < voices; voice++) {
    const oscillator = next++;
    ops.push({ opcode: 3, out: oscillator, a: 0, b: frequencySignal, state: voice * 4, value: 0.5 });
    const scaled = next++;
    ops.push({ opcode: 2, out: scaled, a: oscillator, b: amplitude });
    if (total < 0) total = scaled;
    else { const combined = next++; ops.push({ opcode: 1, out: combined, a: total, b: scaled }); total = combined; }
  }
  if (filter) {
    const cutoff = value(2);
    const resonance = value(3);
    const output = next++;
    ops.push({ opcode: 4, out: output, a: 1, b: total, c: cutoff, d: resonance, state: 512 });
    total = output;
  }
  ops.push({ opcode: 5, a: total, b: 0 });
  ops.push({ opcode: 5, a: total, b: 1 });
  return ops;
}

function render(wasm, frames, capture = true) {
  wasm.clear(frames);
  wasm.beginDspRenderQuantum();
  wasm.renderDspProgram(frames, sampleRate);
  return capture ? new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames).slice() : null;
}
