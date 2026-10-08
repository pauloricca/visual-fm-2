// Offline compiler/WASM A/B benchmark. It does not start the app.
// With no argument, compare against the same compiler with all passes disabled.
// To compare against an older build, pass a prefix for saved baseline programs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const prefix = process.argv[2];
const root = path.resolve(new URL('..', import.meta.url).pathname);
const compilerFile = '/tmp/teia-task3-benchmark-compiler.cjs';
buildSync({ entryPoints: [path.join(root, 'web/src/audio/dspProgram.ts')], outfile: compilerFile,
  bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const { compilePatchToDspProgram } = createRequire(import.meta.url)(compilerFile);
const wasmBytes = fs.readFileSync(path.join(root, 'web/public/audio/teia-kernel.wasm'));
const cases = [
  ['dirty-saw', 'patches/dirty-saw/2026-10-07T13-01-07.047Z.json'],
  ['ear-confusion', 'patches/ear-confusion/2026-09-23T22-47-05.833Z.json'],
  ['lyra-esque', 'patches/lyra-esque/2026-08-14T21-34-08.161Z.json'],
  ['karplus-strong', 'patches/karplus-strong/2026-08-25T15-28-53.635Z.json'],
  ['beats-sequencer', 'patches/beats-sequencer/2026-09-26T22-42-03.878Z.json'],
];
const frames = 128;
const blocks = Number(process.env.BENCHMARK_BLOCKS) || 200;
const trials = Number(process.env.BENCHMARK_TRIALS) || 7;
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

function upload(wasm, program) {
  wasm.clearDspProgram();
  wasm.clearGraph();
  wasm.resetPhases();
  wasm.seedDspRandom(0x2457_8193);
  program.values.forEach((value, index) => wasm.setDspValue(index, value));
  for (const op of program.ops) assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1,
    op.b ?? -1, op.c ?? -1, op.d ?? -1, op.e ?? -1, op.state ?? -1,
    op.value ?? 0, op.value2 ?? 0, op.value3 ?? 0, op.value4 ?? 0) >= 0);
}

function render(wasm, count, capture = false) {
  let last;
  for (let block = 0; block < count; block++) {
    wasm.clear(frames);
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(frames, 48_000);
    if (capture) last = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames).slice();
  }
  return last;
}

console.log(`128 frames at 48 kHz, ${blocks} measured blocks × ${trials} trials, median ms/block`);
for (const [name, file] of cases) {
  const patch = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const before = prefix
    ? JSON.parse(fs.readFileSync(`${prefix}-${name}.json`, 'utf8'))
    : compilePatchToDspProgram(patch, {
      deduplicateLoads: false, foldConstants: false, eliminateDeadPureOps: false,
    });
  let after;
  for (let index = 0; index < 10; index++) after = compilePatchToDspProgram(patch);
  assert.deepEqual(after.errors, []);
  const compileTimes = [];
  for (let index = 0; index < 50; index++) {
    const started = performance.now();
    compilePatchToDspProgram(patch);
    compileTimes.push(performance.now() - started);
  }
  const engines = await Promise.all([before, after].map(async () =>
    (await WebAssembly.instantiate(wasmBytes)).instance.exports));
  const times = [[], []];
  for (let trial = 0; trial < trials; trial++) {
    const outputs = [];
    for (let variant = 0; variant < 2; variant++) {
      const wasm = engines[variant];
      upload(wasm, variant === 0 ? before : after);
      render(wasm, 40);
      const started = performance.now();
      render(wasm, blocks);
      times[variant].push((performance.now() - started) / blocks);
      outputs.push(render(wasm, 1, true));
    }
    assert.deepEqual(outputs[0], outputs[1], `${name}: final block differs`);
  }
  // Exercise changing external controls and the moving-value path too.
  for (let step = 0; step < 32; step++) {
    const binding = before.valueBindings.find(item => item.kind === 'node-param');
    if (binding && step % 4 === 0) engines.forEach(wasm => wasm.setDspValue(binding.valueIndex, step % 8 ? 0.2 : 0.8));
    const outputs = engines.map(wasm => render(wasm, 1, true));
    assert.deepEqual(outputs[0], outputs[1], `${name}: transition ${step} differs`);
  }
  console.log(JSON.stringify({ name, beforeOps: before.ops.length, afterOps: after.ops.length,
    beforeRegisters: before.registerCount, afterRegisters: after.registerCount,
    beforeMs: median(times[0]), afterMs: median(times[1]),
    afterCompileMs: median(compileTimes), reasons: after.optimization.reasons }));
}
