// Offline benchmark for saved patches. It never starts a browser or server.
// It compares the same compiled patch in separate single and shared-memory
// kernels, validates block output equality, and prints median render time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import ts from '../node_modules/typescript/lib/typescript.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = path.join(root, 'editor/src');
const frames = 128;
const sampleRate = positiveInteger(process.env.BENCHMARK_SAMPLE_RATE, 48_000);
// Keep defaults below the real watchdog's limit on slower developer machines.
// Longer exploratory runs are available through the environment overrides.
const warmupBlocks = positiveInteger(process.env.BENCHMARK_WARMUP_BLOCKS, 32);
const measuredBlocks = positiveInteger(process.env.BENCHMARK_MEASURED_BLOCKS, 64);
const trials = positiveInteger(process.env.BENCHMARK_TRIALS, 3);
if (process.env.BENCHMARK_EXERCISE_RINGING_CONTROLS === '1') {
  assert(warmupBlocks + measuredBlocks >= 257,
    'Ringing control verification needs at least 257 blocks to include its transport reset.');
}
if (process.env.BENCHMARK_FORCE_BLOCK_CANDIDATE === '1') {
  assert(process.env.BENCHMARK_BLOCK_PLAN === '1' && process.env.BENCHMARK_COMPARISON_WASM,
    'Forcing the candidate block path requires BENCHMARK_BLOCK_PLAN=1 and BENCHMARK_COMPARISON_WASM.');
}
const workers = Math.max(1, Math.min(4, Number(process.argv[2]) || 2));
const patchFiles = process.env.BENCHMARK_PATCH_FILES?.split(',').filter(Boolean) ?? [
  'patches/dirty-saw/2026-10-07T13-01-07.047Z.json',
  'patches/ear-confusion/2026-09-23T22-47-05.833Z.json',
  'patches/lyra-esque/2026-08-14T21-34-08.161Z.json',
  'patches/karplus-strong/2026-08-25T15-28-53.635Z.json',
  'patches/beats-sequencer/2026-09-26T22-42-03.878Z.json',
];

const compiler = compilePatchCompiler();
const workerSource = fs.readFileSync(path.join(root, 'editor/public/audio/dsp-parallel-worker.js'), 'utf8');
const workerWrapper = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: data => parentPort.postMessage(data) };
${workerSource}
parentPort.on('message', data => self.onmessage({ data }));`;
const singleBytes = fs.readFileSync(process.env.BENCHMARK_BASELINE_WASM || path.join(root, 'editor/public/audio/teia-kernel.wasm'));
const comparisonBytes = process.env.BENCHMARK_COMPARISON_WASM && fs.readFileSync(process.env.BENCHMARK_COMPARISON_WASM);
const parallelModule = comparisonBytes ? null : await WebAssembly.compile(fs.readFileSync(path.join(root, 'editor/public/audio/teia-kernel-parallel.wasm')));

console.log(`Saved-patch benchmark: ${frames} frames/block at ${sampleRate} Hz; ${warmupBlocks} warmup + ${measuredBlocks} measured blocks × ${trials} trials; ${comparisonBytes ? 'two single kernels' : `multi uses ${workers} helpers`}.`);
console.log(`Times are offline Node timings, useful for ${comparisonBytes ? 'WASM A/B' : 'single/multi'} comparison; browser AudioWorklet CPU remains the final real-time check.`);

for (const file of patchFiles) {
  const patch = file === '@group-spread' ? groupSpreadPatch()
    : file === '@group-spawn' ? groupSpawnPatch()
    : file === '@simple-block' ? simpleBlockPatch()
    : JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const program = compiler.compilePatchToDspProgram(patch);
  if (program.errors.length) {
    console.log(`${patch.name ?? file}: skipped (${program.errors.join('; ')})`);
    continue;
  }
  const profileVariant = process.env.BENCHMARK_PROFILE_VARIANT;
  if (profileVariant) {
    assert(['kink-sine', 'power-min', 'both'].includes(profileVariant), 'Unknown profile variant.');
    assert(patch.name === 'ringing-drone', 'Profiling ablations are defined only for ringing-drone.');
    // Timing-only ablations: keep operation positions and the surrounding
    // saved patch, but substitute cheaper exact DSP operations. Their output
    // is intentionally different and is never used as a correctness oracle.
    for (const op of program.ops) {
      if ((profileVariant === 'kink-sine' || profileVariant === 'both') && op.opcode === 3 && op.a === 12) op.a = 0;
      if ((profileVariant === 'power-min' || profileVariant === 'both') && op.opcode === 26 && op.a === 9) op.a = 6;
    }
  }
  const result = await benchmark(patch.name ?? file, program);
  const saving = (1 - result.multiMs / result.singleMs) * 100;
  console.log(`${result.name}${profileVariant ? ` [${profileVariant}]` : ''}: ${result.ops} ops${comparisonBytes ? '' : `, ${result.parallelRepeats} eligible repeats`}${process.env.BENCHMARK_BLOCK_PLAN === '1' ? `, block plan ${result.blockPlan ?? 'n/a'}, automatic rendering ${result.automaticRendering ? 'block' : 'scalar'}, scratch ${result.blockBytes} bytes` : ''}${process.env.BENCHMARK_VERIFY_ALL_BLOCKS === '1' ? `, verified peak ${result.verifiedPeak.toFixed(6)}` : ''}; ${comparisonBytes ? 'baseline' : 'single'} ${result.singleMs.toFixed(3)} ms, ${comparisonBytes ? 'candidate' : 'multi'} ${result.multiMs.toFixed(3)} ms, ${saving >= 0 ? '+' : ''}${saving.toFixed(1)}% (${result.deadlinePercent.toFixed(1)}% of a ${result.deadlineMs.toFixed(3)} ms callback deadline).`);
}

function simpleBlockPatch() {
  return {
    name: 'Simple compiled sine',
    nodes: [
      { id: 'osc', type: 'SineOsc', params: { frequency: 440 } },
      { id: 'output', type: 'AudioOut', params: { level: 0.1 } },
    ],
    links: [{ from: { node: 'osc', port: 'signal' }, to: { node: 'output', port: 'both' }, mode: 'set', weight: 1 }],
  };
}

function groupSpawnPatch() {
  return {
    name: 'Group inside Spawn (128 sine/envelope voices)',
    nodes: [
      { id: 'spawn', type: 'Spawn', params: { trigger: 0, 'release trigger': 0 }, spreadNodeIds: ['group'] },
      { id: 'group', type: 'Group', params: {}, inputs: [{ name: 'gate' }],
        outputs: [{ name: 'signal' }, { name: 'end trigger' }],
        subpatch: {
          nodes: [
            { id: 'ins', type: 'Ins', params: {}, outputs: [{ name: 'gate' }] },
            { id: 'osc', type: 'SineOsc', params: { frequency: 440 } },
            { id: 'env', type: 'Envelope', params: { attack: 0.01, decay: 0.16, sustain: 0.72, release: 0.24 } },
            { id: 'outs', type: 'Outs', params: {}, inputs: [{ name: 'signal' }, { name: 'end trigger' }] },
          ],
          links: [
            { from: { node: 'ins', port: 'gate' }, to: { node: 'env', port: 'gate' }, mode: 'set', weight: 1 },
            { from: { node: 'osc', port: 'signal' }, to: { node: 'env', port: 'signal' }, mode: 'set', weight: 1 },
            { from: { node: 'env', port: 'signal' }, to: { node: 'outs', port: 'signal' }, mode: 'set', weight: 1 },
            { from: { node: 'env', port: 'end trigger' }, to: { node: 'outs', port: 'end trigger' }, mode: 'set', weight: 1 },
          ],
        } },
      { id: 'output', type: 'AudioOut', params: { level: 0.01 } },
    ],
    links: [
      { from: { node: 'spawn', port: 'instance gate' }, to: { node: 'group', port: 'gate' }, mode: 'set', weight: 1 },
      { from: { node: 'group', port: 'signal' }, to: { node: 'output', port: 'both' }, mode: 'set', weight: 1 },
      { from: { node: 'group', port: 'end trigger' }, to: { node: 'spawn', port: 'kill trigger' }, mode: 'set', weight: 1 },
    ],
  };
}

function groupSpreadPatch() {
  const envelope = process.env.BENCHMARK_GROUP_ENVELOPE === '1';
  const count = Number(process.env.BENCHMARK_GROUP_COUNT) || 128;
  return {
    name: `Group inside Spread (${count} sine oscillators${envelope ? ' with envelopes' : ''})`,
    nodes: [
      { id: 'spread', type: 'Spread', params: { count }, spreadNodeIds: ['group'] },
      { id: 'group', type: 'Group', params: {}, inputs: envelope ? [{ name: 'gate' }] : [], outputs: [{ name: 'signal' }],
        subpatch: {
          nodes: [
            { id: 'osc', type: 'SineOsc', params: { frequency: 440 } },
            ...(envelope ? [
              { id: 'ins', type: 'Ins', params: {}, outputs: [{ name: 'gate' }] },
              { id: 'env', type: 'Envelope', params: { attack: 0.01, decay: 0.16, sustain: 0.72, release: 0.24 } },
            ] : []),
            { id: 'outs', type: 'Outs', params: {}, inputs: [{ name: 'signal' }], outputs: [] },
          ],
          links: envelope ? [
            { from: { node: 'osc', port: 'signal' }, to: { node: 'env', port: 'signal' }, mode: 'set', weight: 1 },
            { from: { node: 'ins', port: 'gate' }, to: { node: 'env', port: 'gate' }, mode: 'set', weight: 1 },
            { from: { node: 'env', port: 'signal' }, to: { node: 'outs', port: 'signal' }, mode: 'set', weight: 1 },
          ] : [{ from: { node: 'osc', port: 'signal' }, to: { node: 'outs', port: 'signal' }, mode: 'set', weight: 1 }],
        } },
      { id: 'output', type: 'AudioOut', params: { level: 0.01 } },
    ],
    links: [
      ...(envelope ? [{ from: { node: 'spread', port: 'item index' }, to: { node: 'group', port: 'gate' }, mode: 'set', weight: 1 }] : []),
      { from: { node: 'group', port: 'signal' }, to: { node: 'output', port: 'both' }, mode: 'set', weight: 1 },
    ],
  };
}

function compilePatchCompiler() {
  const temporaryOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'teia-saved-patch-benchmark-'));
  try {
    const program = ts.createProgram({
      rootNames: [path.join(sourceRoot, 'audio/dspProgram.ts')],
      options: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10, rootDir: sourceRoot,
        outDir: temporaryOutput, strict: true, skipLibCheck: true, esModuleInterop: true,
      },
    });
    const emitted = program.emit();
    const errors = ts.getPreEmitDiagnostics(program).concat(emitted.diagnostics)
      .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: fileName => fileName, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    return createRequire(import.meta.url)(path.join(temporaryOutput, 'audio/dspProgram.js'));
  } finally {
    fs.rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

async function benchmark(name, program) {
  const pair = await enginePair(workers);
  try {
    upload(pair.single, program);
    upload(pair.multi, program);
    if (process.env.BENCHMARK_SCALAR_BASELINE === '1') pair.single.setDspBlockRendering(0);
    const blockPlan = comparisonBytes && process.env.BENCHMARK_BLOCK_PLAN === '1'
      ? pair.multi.compileDspBlockPlan() : undefined;
    const automaticRendering = pair.multi.dspBlockRenderingEnabled?.() ?? 0;
    if (process.env.BENCHMARK_FORCE_BLOCK_CANDIDATE === '1') pair.multi.setDspBlockRendering(1);
    let verifiedPeak = 0;
    if (process.env.BENCHMARK_VERIFY_ALL_BLOCKS === '1') {
      resetAndUpload(pair.single, program);
      resetAndUpload(pair.multi, program);
      for (let block = 0; block < warmupBlocks + measuredBlocks; block += 1) {
        if (process.env.BENCHMARK_EXERCISE_RINGING_CONTROLS === '1' && name === 'ringing-drone') {
          exerciseRingingControls(pair.single, program, block);
          exerciseRingingControls(pair.multi, program, block);
        }
        renderBlocks(pair.single, 1);
        renderBlocks(pair.multi, 1);
        for (const [channel, pointer] of [['left', 'leftPtr'], ['right', 'rightPtr']]) {
          const reference = new Float32Array(pair.single.memory.buffer, pair.single[pointer](), frames);
          const candidate = new Float32Array(pair.multi.memory.buffer, pair.multi[pointer](), frames);
          for (let frame = 0; frame < frames; frame += 1) {
            assert(Number.isFinite(reference[frame]) && Number.isFinite(candidate[frame]),
              `${name}: non-finite ${channel} output at block ${block}, frame ${frame}`);
            assert(Object.is(reference[frame], candidate[frame]),
              `${name}: ${channel} differs at block ${block}, frame ${frame}: ${reference[frame]} != ${candidate[frame]}`);
            verifiedPeak = Math.max(verifiedPeak, Math.abs(reference[frame]));
          }
        }
        for (const binding of program.stateBindings) {
          for (let offset = 0; offset < binding.count; offset += 1) {
            const state = binding.state + offset;
            assert(Object.is(pair.single.getDspState(state), pair.multi.getDspState(state)),
              `${name}: state ${state} differs after block ${block}`);
          }
        }
        if (process.env.BENCHMARK_MONITORS === '1') {
          for (let slot = 0; slot < Object.keys(program.monitorIds).length; slot += 1) {
            assert(Object.is(pair.single.dspMeterLevel(slot), pair.multi.dspMeterLevel(slot)),
              `${name}: meter ${slot} differs after block ${block}`);
          }
          if (program.monitorIds.scope_1 !== undefined) {
            const count = pair.single.dspScopeCount(0);
            assert.equal(pair.multi.dspScopeCount(0), count, `${name}: scope count differs`);
            const reference = new Float32Array(pair.single.memory.buffer, pair.single.dspScopePtr(0), count);
            const candidate = new Float32Array(pair.multi.memory.buffer, pair.multi.dspScopePtr(0), count);
            for (let sample = 0; sample < count; sample += 1) {
              assert(Object.is(reference[sample], candidate[sample]),
                `${name}: scope differs after block ${block}, sample ${sample}`);
            }
          }
        }
      }
      for (const op of program.ops.filter(entry => entry.opcode === 12)) {
        const referenceSlot = pair.single.dspEffectSlotForState(op.state);
        const candidateSlot = pair.multi.dspEffectSlotForState(op.state);
        assert(referenceSlot >= 0 && candidateSlot >= 0, `${name}: missing delay slot`);
        assert.equal(pair.single.getDspEffectIndex(referenceSlot), pair.multi.getDspEffectIndex(candidateSlot),
          `${name}: delay write index differs at state ${op.state}`);
        const length = pair.single.dspEffectBufferLength();
        assert.equal(pair.multi.dspEffectBufferLength(), length);
        const reference = new Float32Array(pair.single.memory.buffer, pair.single.dspEffectBufferPtr(referenceSlot), length);
        const candidate = new Float32Array(pair.multi.memory.buffer, pair.multi.dspEffectBufferPtr(candidateSlot), length);
        for (let sample = 0; sample < length; sample += 1) {
          assert(Object.is(reference[sample], candidate[sample]),
            `${name}: delay state ${op.state} differs at buffer sample ${sample}`);
        }
      }
    }
    const parallelRepeats = pair.multi.dspParallelRepeatCount?.() ?? 0;
    const singleTimes = [];
    const multiTimes = [];
    for (let trial = 0; trial < trials; trial += 1) {
      resetAndUpload(pair.single, program);
      resetAndUpload(pair.multi, program);
      if (name.startsWith('Group inside Spawn')) {
        createSpawnInstances(pair.single, program, 128);
        createSpawnInstances(pair.multi, program, 128);
      }
      renderBlocks(pair.single, warmupBlocks);
      renderBlocks(pair.multi, warmupBlocks);
      let single;
      let multi;
      if (trial % 2 === 0) {
        single = timedRender(pair.single, measuredBlocks);
        multi = timedRender(pair.multi, measuredBlocks);
      } else {
        multi = timedRender(pair.multi, measuredBlocks);
        single = timedRender(pair.single, measuredBlocks);
      }
      singleTimes.push(single.elapsed);
      multiTimes.push(multi.elapsed);
      assertEqualBlocks(name, single.lastBlock, multi.lastBlock);
    }
    if (name.startsWith('Group inside Spawn')) verifyCompiledSpawnRelease(pair, program, name);
    const singleMs = median(singleTimes) / measuredBlocks;
    const multiMs = median(multiTimes) / measuredBlocks;
    return {
      name, ops: program.ops.length, parallelRepeats, singleMs, multiMs, blockPlan, automaticRendering, verifiedPeak,
      blockBytes: (comparisonBytes ? pair.multi : pair.single).dspBlockPlanBytes?.() ?? 0,
      deadlineMs: frames / sampleRate * 1000, deadlinePercent: multiMs / (frames / sampleRate * 1000) * 100,
    };
  } finally {
    await pair.dispose();
  }
}

function exerciseRingingControls(wasm, program, block) {
  const update = (nodeId, port, value, immediate = false) => {
    const binding = program.valueBindings.find(entry => entry.nodeId === nodeId && entry.port === port);
    assert(binding, `Missing ${nodeId}.${port} binding`);
    (immediate ? wasm.setDspValueImmediate : wasm.setDspValue)(binding.valueIndex, value);
  };
  if (block === 64) {
    update('sine_1', 'shape', -0.6);
    update('sine_1', 'squareness', -0.8);
    update('kinkosc_1', 'shape', 0.25);
    update('kinkosc_1', 'squareness', 0.9);
    update('delay_2', 'time', 0.005);
    update('delay_2', 'feedback', 0.3);
    update('delay_2', 'mix', 0.45);
  }
  if (block === 128) update('delay_2', 'time', 0.001, true);
  if (block === 192) {
    update('sine_1', 'shape', 0.8, true);
    update('kinkosc_1', 'squareness', -0.4, true);
  }
  if (block === 256) wasm.resetDspRuntimeState();
}

function verifyCompiledSpawnRelease(pair, program, name) {
  const releaseIndex = program.valueBindings.find(binding => binding.nodeId === 'spawn' && binding.port === 'release trigger')?.valueIndex;
  assert.notEqual(releaseIndex, undefined, 'Spawn release value binding was not compiled.');
  pair.single.setDspValueImmediate(releaseIndex, 1);
  pair.multi.setDspValueImmediate(releaseIndex, 1);
  let last;
  for (let block = 0; block < 128; block += 1) {
    const single = renderBlocks(pair.single, 1);
    const multi = renderBlocks(pair.multi, 1);
    assertEqualBlocks(name, single, multi);
    last = single;
  }
  assert(last.every(sample => sample === 0), 'Compiled Spawn voices did not end after release.');
}

function createSpawnInstances(wasm, program, count) {
  const triggerIndex = program.valueBindings.find(binding => binding.nodeId === 'spawn' && binding.port === 'trigger')?.valueIndex;
  assert.notEqual(triggerIndex, undefined, 'Spawn trigger value binding was not compiled.');
  for (let index = 0; index < count; index += 1) {
    wasm.setDspValueImmediate(triggerIndex, 1);
    renderBlocks(wasm, 1);
    wasm.setDspValueImmediate(triggerIndex, 0);
    renderBlocks(wasm, 1);
  }
}

async function enginePair(count) {
  const single = (await WebAssembly.instantiate(singleBytes)).instance.exports;
  if (comparisonBytes) {
    const multi = (await WebAssembly.instantiate(comparisonBytes)).instance.exports;
    return { single, multi, dispose: async () => {} };
  }
  const memory = new WebAssembly.Memory({ initial: 512, maximum: 32768, shared: true });
  const controls = [];
  const multi = (await WebAssembly.instantiate(parallelModule, {
    env: { memory }, parallel: { now: () => performance.now(), wake: () => controls.forEach(control => Atomics.notify(control, 0, 1)) },
  })).exports;
  assert(multi.__tls_size.value <= 65536 && multi.__tls_align.value <= 65536, 'Parallel TLS reservation is too small.');
  multi.__wasm_init_tls(multi.dspParallelTlsPtr(1));
  const helpers = [];
  try {
    await Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
      const helper = new Worker(workerWrapper, { eval: true });
      helpers.push(helper);
      const controlPointer = multi.dspParallelControlPtr(index);
      controls.push(new Int32Array(memory.buffer, controlPointer, 3));
      const timeout = setTimeout(() => reject(new Error('Parallel helper startup timed out.')), 10_000);
      helper.once('error', error => { clearTimeout(timeout); reject(error); });
      helper.once('message', message => {
        clearTimeout(timeout);
        message.type === 'ready' ? resolve() : reject(new Error(message.message));
      });
      helper.postMessage({ module: parallelModule, memory, worker: index, stackTop: multi.dspParallelStackTop(index), controlPointer });
    })));
    multi.configureDspParallel(count);
    return { single, multi, dispose: () => Promise.all(helpers.map(helper => helper.terminate())) };
  } catch (error) {
    await Promise.all(helpers.map(helper => helper.terminate()));
    throw error;
  }
}

function resetAndUpload(wasm, program) {
  wasm.resetPhases();
  wasm.clearDspProgram();
  wasm.clearGraph();
  wasm.seedDspRandom(0x2457_8193);
  upload(wasm, program);
}

function upload(wasm, program) {
  program.values.forEach((value, index) => wasm.setDspValue(index, value));
  for (const op of program.ops) {
    assert(wasm.addDspOp(op.opcode, op.out ?? -1, op.a ?? -1, op.b ?? -1, op.c ?? -1,
      op.d ?? -1, op.e ?? -1, op.state ?? -1, op.value ?? 0, op.value2 ?? 0,
      op.value3 ?? 0, op.value4 ?? 0) >= 0, `Kernel rejected an op in ${program.name ?? 'saved patch'}.`);
  }
  if (process.env.BENCHMARK_MONITORS === '1') {
    wasm.clearDspMeters();
    Object.values(program.monitorIds).slice(0, 128).forEach((register, slot) => {
      assert(wasm.setDspMeter(slot, register) >= 0);
    });
    wasm.clearDspScopes();
    if (program.monitorIds.scope_1 !== undefined) {
      assert(wasm.setDspScope(0, program.monitorIds.scope_1, 0.012, 512, sampleRate) >= 0);
    }
  }
  wasm.compileDspParallelPlan?.();
  if (process.env.BENCHMARK_BLOCK_PLAN === '1') wasm.compileDspBlockPlan?.();
}

function timedRender(wasm, count) {
  const started = performance.now();
  const lastBlock = renderBlocks(wasm, count);
  return { elapsed: performance.now() - started, lastBlock };
}

function renderBlocks(wasm, count) {
  let block = null;
  for (let index = 0; index < count; index += 1) {
    wasm.clear(frames);
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(frames, sampleRate);
    assert.equal(wasm.dspParallelFault?.() || 0, 0, 'Parallel helper stalled.');
    block = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), frames).slice();
  }
  return block;
}

function assertEqualBlocks(name, single, multi) {
  const exact = process.env.BENCHMARK_EXACT === '1'
    || name.startsWith('Group inside Spread') || name.startsWith('Group inside Spawn');
  for (let index = 0; index < frames; index += 1) {
    assert(Number.isFinite(multi[index]) && (exact ? single[index] === multi[index]
      : Math.abs(single[index] - multi[index]) <= 1e-6),
      `${name}: mode output diverged at frame ${index}: ${single[index]} != ${multi[index]}`);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
