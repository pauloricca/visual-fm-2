import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';

const sampleRate = 48000;
const blockSize = 128;
const seconds = Number(process.argv[2] ?? 5);
const resendEveryBlock = process.argv.includes('--resend-every-block');
const modulated = process.argv.includes('--modulated');
const compiled = process.argv.includes('--compiled');
const scope = process.argv.includes('--scope');
const feedback = process.argv.includes('--feedback');
const modeArg = argValue('--mode') ?? 'multiply';
const amountArg = Number(argValue('--amount'));
const weightArg = Number(argValue('--weight'));
const targetArg = argValue('--target') ?? 'frequency';
const printGraph = process.argv.includes('--print-graph');
const keepalive = process.argv.includes('--keepalive');
const internalOutputTarget = process.argv.includes('--internal-output-target');

let ProcessorClass = null;
const outboundMessages = [];

class FakeAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage(message) {
        outboundMessages.push(message);
      },
    };
  }
}

globalThis.sampleRate = sampleRate;
globalThis.AudioWorkletProcessor = FakeAudioWorkletProcessor;
globalThis.registerProcessor = (_name, klass) => {
  ProcessorClass = klass;
};

vm.runInThisContext(fs.readFileSync('web/public/audio/audio-worklet-wasm.js', 'utf8'), {
  filename: 'audio-worklet-wasm.js',
});

if (!ProcessorClass) {
  throw new Error('Worklet processor was not registered.');
}

const wasmBytes = fs.readFileSync('web/public/audio/visual-fm-kernel.wasm');
const processor = new ProcessorClass({
  processorOptions: {
    wasmBytes: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
  },
});

await waitForReady();

const graph = compiled ? await compileVisiblePatch() : {
  nodes: modulated
    ? [
      { id: 'tri', wave: 'triangle', frequencyMode: 'fixed', ratio: 1, frequency: 1 },
      { id: 'sine', wave: 'sine', frequencyMode: 'fixed', ratio: 1, frequency: 61.4288 },
    ]
    : [
      { id: 'sine', wave: 'sine', frequencyMode: 'fixed', ratio: 1, frequency: 61.4288 },
    ],
  links: [
    ...(modulated
      ? [{
        id: 'tri:signal->sine:frequency',
        from: 'tri',
        to: internalOutputTarget ? 'sine:signal->out:both' : 'sine',
        amount: Number.isFinite(amountArg) ? amountArg : 0.7,
        modulationTarget: targetArg,
        ...(internalOutputTarget ? { internalTarget: true } : {}),
      }]
      : []),
    ...(modulated && keepalive
      ? [{
        id: 'tri:signal->audio:keepalive',
        from: 'tri',
        to: 'audio',
        amount: 0,
        modulationTarget: 'amplitude',
        pan: 0,
        drone: true,
      }]
      : []),
    {
      id: 'sine:signal->out:both',
      from: 'sine',
      to: 'audio',
      amount: 1.0254,
      modulationTarget: 'amplitude',
      pan: 0,
      drone: true,
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.86, release: 0.18 },
    },
  ],
  maxVoices: 8,
  tempo: 120,
  masterEffects: {
    chorus: { enabled: false },
    delay: { enabled: false },
    reverb: { enabled: false },
  },
};

if (printGraph) {
  console.log(JSON.stringify(graph, null, 2));
}

processor.port.onmessage({ data: { type: graph?.ops ? 'dspProgram' : 'graph', payload: graph } });
if (scope) {
  processor.port.onmessage({
    data: {
      type: 'setLinkScopes',
      payload: { linkIds: ['scope'], mode: 'zero-crossing', points: 256, displayPoints: 128, seconds: 0.08 },
    },
  });
}

const windowFrames = Math.round(sampleRate * 0.25);
const totalBlocks = Math.ceil((seconds * sampleRate) / blockSize);
let windowSum = 0;
let windowPeak = 0;
let windowCount = 0;
let previousSample = 0;
let zeroCrossings = 0;
const windows = [];

for (let block = 0; block < totalBlocks; block += 1) {
  if (resendEveryBlock) {
    processor.port.onmessage({ data: { type: 'graph', payload: graph } });
  }

  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  processor.process([], [[left, right]]);

  for (const sample of left) {
    const abs = Math.abs(sample);
    windowSum += sample * sample;
    windowPeak = Math.max(windowPeak, abs);
    if (previousSample < 0 && sample >= 0) {
      zeroCrossings += 1;
    }
    previousSample = sample;
    windowCount += 1;
    if (windowCount >= windowFrames) {
      windows.push({
        t: Number(((windows.length + 1) * windowFrames / sampleRate).toFixed(2)),
        rms: Math.sqrt(windowSum / windowCount),
        peak: windowPeak,
        hz: zeroCrossings / (windowCount / sampleRate),
      });
      windowSum = 0;
      windowPeak = 0;
      windowCount = 0;
      zeroCrossings = 0;
    }
  }
}

for (const row of windows) {
  console.log(`${row.t.toFixed(2)}s rms=${row.rms.toFixed(6)} peak=${row.peak.toFixed(6)} hz=${row.hz.toFixed(2)}`);
}

if (scope) {
  const scopeMessages = outboundMessages.filter((message) => message.type === 'linkScope' && message.payload?.id === 'scope');
  const latest = scopeMessages.at(-1)?.payload?.samples || [];
  const peak = latest.reduce((max, sample) => Math.max(max, Math.abs(Number(sample) || 0)), 0);
  console.log(`scope messages=${scopeMessages.length} samples=${latest.length} peak=${peak.toFixed(6)}`);
}

async function waitForReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    if (outboundMessages.some((message) => message.type === 'backendStatus' && message.payload?.ready)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for WASM backend readiness.');
}

async function compileVisiblePatch() {
  const moduleDir = fs.mkdtempSync('/tmp/visual-fm-compiler-');
  writeTranspiledModule('web/src/graph/expression.ts', `${moduleDir}/expression.mjs`);
  writeTranspiledModule('web/src/graph/subpatch.ts', `${moduleDir}/subpatch.mjs`);
  writeTranspiledModule('web/src/graph/nodeTypes.ts', `${moduleDir}/nodeTypes.mjs`);
  writeTranspiledModule('web/src/audio/dspProgram.ts', `${moduleDir}/dspProgram.mjs`, (source) => (
    source
      .replaceAll("'../graph/subpatch'", "'./subpatch.mjs'")
      .replaceAll("'../graph/nodeTypes'", "'./nodeTypes.mjs'")
  ));
  const compiler = await import(`file://${moduleDir}/dspProgram.mjs`);
  const patch = {
    nodes: feedback
      ? [
        { id: 'tri', type: 'TriangleOsc', params: { frequency: 220, ratio: 1, phase: 0, phaseReset: 0, level: 0.7 } },
        { id: 'sine', type: 'SineOsc', params: { frequency: 200, ratio: 1, phase: 0, phaseReset: 0, level: 0.75 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.45 } },
      ]
      : modulated
      ? [
        { id: 'tri', type: 'TriangleOsc', params: { frequency: 1, ratio: 1, phase: 0, phaseReset: 0, level: 0.7 } },
        { id: 'sine', type: 'SineOsc', params: { frequency: 61.4288, ratio: 1, phase: 0, phaseReset: 0, level: 1.3672 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.75 } },
      ]
      : [
        { id: 'sine', type: 'SineOsc', params: { frequency: 61.4288, ratio: 1, phase: 0, phaseReset: 0, level: 1.3672 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.75 } },
      ],
    links: [
      ...(feedback
        ? [
          { from: { node: 'tri', port: 'signal' }, to: { node: 'sine', port: 'frequency' }, weight: 35, mode: 'add' },
          { from: { node: 'sine', port: 'signal' }, to: { node: 'tri', port: 'frequency' }, weight: 30, mode: 'add' },
        ]
        : []),
      ...(modulated
        ? [{
          from: { node: 'tri', port: 'signal' },
          to: { node: 'sine', port: 'frequency' },
          weight: Number.isFinite(weightArg) ? weightArg : 1,
          mode: modeArg,
        }]
        : []),
      ...(scope
        ? [
          { from: { node: feedback ? 'tri' : 'sine', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
        ]
        : [
          ...(feedback
            ? [
              { from: { node: 'tri', port: 'signal' }, to: { node: 'out', port: 'left' }, weight: 1, mode: 'set' },
              { from: { node: 'sine', port: 'signal' }, to: { node: 'out', port: 'right' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'sine', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]),
    ],
  };
  return compiler.compilePatchToDspProgram(patch);
}

function writeTranspiledModule(sourcePath, outputPath, transform = (source) => source) {
  const source = transform(fs.readFileSync(sourcePath, 'utf8'));
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  fs.writeFileSync(outputPath, js);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
