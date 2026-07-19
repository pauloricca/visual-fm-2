import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIB = 1024 * 1024;
const wasmUrl = new URL('../web/public/audio/visual-fm-kernel.wasm', import.meta.url);
const { instance } = await WebAssembly.instantiate(await readFile(wasmUrl), {});
const wasm = instance.exports;
const memoryStages = [];

function recordMemory(name) {
  memoryStages.push({
    name,
    bytes: wasm.memory.buffer.byteLength,
    lazyBufferBytes: Number(wasm.lazyBufferBytes()),
  });
}

recordMemory('initial');
assert.ok(wasm.memory.buffer.byteLength < 16 * MIB, 'initial WASM memory must stay below 16 MiB');
assert.equal(wasm.lazyBufferBytes(), 0, 'lazy buffers must be empty at startup');

wasm.clearDspProgram();
assert.ok(wasm.addDspOp(12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) >= 0, 'DSP delay op failed');
recordMemory('dsp-delay');
assert.ok(wasm.addDspOp(34, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0) >= 0, 'DSP buffer op failed');
recordMemory('dsp-buffer');

const imageLength = 256 * 256 * 4;
assert.equal(wasm.setImageData(0, 256, 256, imageLength), 0, 'image allocation failed');
const imageData = new Uint8Array(wasm.memory.buffer, wasm.imageDataPtr(0), imageLength);
imageData.fill(127);
assert.equal(imageData[imageData.length - 1], 127, 'image upload failed');
recordMemory('image');

wasm.clearGraph();
const node = wasm.addNode(
  0, 0, 1, 440, 1, 0, 0, 0, 0, 8, 1, 0, 0.5, 0.75, 0, 0, 1, 1, 4096, 0.09, 440, 0, 0,
);
assert.ok(node >= 0, 'test node allocation failed');
const sampleLength = 600_000;
assert.ok(wasm.maxSampleFrames() >= sampleLength, 'kernel must accept samples longer than the old 524,288-frame limit');
const sampleSlot = wasm.setSampleData(node, 48_000, sampleLength);
assert.ok(sampleSlot >= 0, 'sample allocation failed');
const sampleData = new Float32Array(wasm.memory.buffer, wasm.sampleDataPtr(sampleSlot), sampleLength);
sampleData.fill(0.25);
assert.equal(sampleData[sampleData.length - 1], 0.25, 'sample upload failed');
assert.equal(
  wasm.setSampleData(node, 48_000, wasm.maxSampleFrames() + 1),
  -2,
  'oversized samples must be rejected instead of truncated',
);
recordMemory('sample');

const link = wasm.addLink(
  node, -1, 1, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.1, 5, 440, 0.7, 0, 1,
  0, 0.01, 0.1, 0.7, 0.2, 0, 1, 0, 1,
);
assert.ok(link >= 0, 'delayed comb link allocation failed');
recordMemory('link-delay-and-comb');

wasm.resetPhases();
wasm.clear(128);
wasm.renderVoiceGraph(16, 128, 48_000, 440, 1, 1, 0, -1, -1);
const output = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), 128);
assert.ok(output.every(Number.isFinite), 'render output contains non-finite samples');
assert.ok(wasm.memory.buffer.byteLength < 32 * MIB, 'representative graph exceeded 32 MiB');
assert.ok(wasm.lazyBufferBytes() > 0, 'representative graph did not allocate lazy buffers');

console.log(JSON.stringify({ memoryStages }, null, 2));
