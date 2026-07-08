import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';

const sampleRate = 48000;
const blockSize = 128;
const seconds = Number(process.argv[2] ?? 5);
const resendEveryBlock = process.argv.includes('--resend-every-block');
const legacyGraph = process.argv.includes('--legacy-graph');
const modulated = process.argv.includes('--modulated');
const compiled = !legacyGraph;
const scope = process.argv.includes('--scope');
const feedback = process.argv.includes('--feedback');
const newNodes = process.argv.includes('--new-nodes');
const effects = process.argv.includes('--effects');
const controlNodes = process.argv.includes('--control-nodes');
const filtersDistortions = process.argv.includes('--filters-distortions');
const samplePlayer = process.argv.includes('--sample-player');
const audioInput = process.argv.includes('--audio-input');
const midiNote = process.argv.includes('--midi-note');
const modeArg = argValue('--mode') ?? 'multiply';
const sampleModeArg = argValue('--sample-mode');
const amountArg = Number(argValue('--amount'));
const weightArg = Number(argValue('--weight'));
const targetArg = argValue('--target') ?? 'frequency';
const printGraph = process.argv.includes('--print-graph');
const keepalive = process.argv.includes('--keepalive');
const internalOutputTarget = process.argv.includes('--internal-output-target');
const sampleModes = ['one-shot', 'loop', 'ping-pong'];
const sampleModeParams = new Map(sampleModes.map((mode, index) => [mode, index]));
let activeSampleMode = normalizeSampleMode(sampleModeArg ?? 'one-shot');

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

if (compiled && samplePlayer && !sampleModeArg) {
  await runSamplePlayerModeSmoke();
  process.exit(0);
}

if (compiled && midiNote) {
  await runMidiNoteSmoke();
  process.exit(0);
}

const graph = compiled ? await compileVisiblePatch() : {
  nodes: modulated
    ? [
      { id: 'tri', wave: 'triangle', frequencyMode: 'fixed', frequency: 1 },
      { id: 'sine', wave: 'sine', frequencyMode: 'fixed', frequency: 61.4288 },
    ]
    : [
      { id: 'sine', wave: 'sine', frequencyMode: 'fixed', frequency: 61.4288 },
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

configureProcessorGraph(graph);
const windows = renderAudioWindows(graph, seconds);
printWindows(windows);

if (scope) {
  const scopeMessages = outboundMessages.filter((message) => message.type === 'linkScope' && message.payload?.id === 'scope');
  const latest = scopeMessages.at(-1)?.payload?.samples || [];
  const peak = latest.reduce((max, sample) => Math.max(max, Math.abs(Number(sample) || 0)), 0);
  console.log(`scope messages=${scopeMessages.length} samples=${latest.length} peak=${peak.toFixed(6)}`);
}

async function runSamplePlayerModeSmoke() {
  const results = [];
  const renderSeconds = Math.max(seconds, 1);

  for (const mode of sampleModes) {
    activeSampleMode = mode;
    outboundMessages.length = 0;
    const graph = await compileVisiblePatch();
    configureProcessorGraph(graph);
    rearmSampleTrigger(graph);
    const windows = renderAudioWindows(graph, renderSeconds);
    printWindows(windows, `[${mode}] `);
    const peak = windows.reduce((max, row) => Math.max(max, row.peak), 0);
    const tailRms = windows.at(-1)?.rms ?? 0;
    results.push({ mode, peak, tailRms });
  }

  const oneShot = results.find((result) => result.mode === 'one-shot');
  const loop = results.find((result) => result.mode === 'loop');
  const pingPong = results.find((result) => result.mode === 'ping-pong');
  if (!oneShot || !loop || !pingPong) {
    throw new Error('SamplePlayer mode smoke did not render all modes.');
  }
  if (oneShot.peak <= 0.01 || loop.peak <= 0.01 || pingPong.peak <= 0.01) {
    throw new Error(`SamplePlayer mode smoke rendered silence: ${JSON.stringify(results)}`);
  }
  if (oneShot.tailRms >= oneShot.peak * 0.1) {
    throw new Error(`SamplePlayer one-shot tail should decay after the sample: ${JSON.stringify(oneShot)}`);
  }
  if (loop.tailRms <= loop.peak * 0.1) {
    throw new Error(`SamplePlayer loop tail should continue playing: ${JSON.stringify(loop)}`);
  }
  if (pingPong.tailRms <= pingPong.peak * 0.1) {
    throw new Error(`SamplePlayer ping-pong tail should continue playing: ${JSON.stringify(pingPong)}`);
  }

  console.log(`sample-player modes ok ${results.map((result) => `${result.mode}:peak=${result.peak.toFixed(6)} tail=${result.tailRms.toFixed(6)}`).join(' ')}`);
}

async function runMidiNoteSmoke() {
  const graph = await compileVisiblePatch();
  if (!graph.usesMidiNote || graph.maxVoices !== 2) {
    throw new Error(`MidiNote smoke compiled unexpected MIDI metadata: ${JSON.stringify({ usesMidiNote: graph.usesMidiNote, maxVoices: graph.maxVoices })}`);
  }

  processor.port.onmessage({ data: { type: 'panic' } });
  configureProcessorGraph(graph);
  processor.port.onmessage({ data: { type: 'noteOn', payload: { note: 69, velocity: 1 } } });
  const windows = renderAudioWindows(graph, 0.75);
  printWindows(windows, '[midi 69] ');
  const voicedWindow = windows.findLast((row) => row.peak > 0.01 && Number.isFinite(row.hz));
  if (!voicedWindow || voicedWindow.peak <= 0.01) {
    throw new Error(`MidiNote smoke rendered silence after noteOn: ${JSON.stringify(windows)}`);
  }
  if (Math.abs(voicedWindow.hz - 440) > 12) {
    throw new Error(`MidiNote.frequency did not drive oscillator near A4: ${JSON.stringify(voicedWindow)}`);
  }

  processor.port.onmessage({ data: { type: 'noteOff', payload: { note: 69 } } });
  const releasedVoice = [...processor.voices.values()].find((voice) => voice.note === 69 && voice.releasedAt !== null);
  if (!releasedVoice || processor.activeVoicesByNote.has(69)) {
    throw new Error('MidiNote noteOff did not release the active A4 voice.');
  }
  renderAudioWindows(graph, 0.5);
  if ([...processor.voices.values()].some((voice) => voice.note === 69 && voice.releasedAt === null && voice.stolenAt === null)) {
    throw new Error('MidiNote A4 voice remained active after release tail.');
  }

  processor.port.onmessage({ data: { type: 'panic' } });
  configureProcessorGraph(graph);
  for (const note of [60, 64, 67]) {
    processor.port.onmessage({ data: { type: 'noteOn', payload: { note, velocity: 0.9 } } });
    renderAudioWindows(graph, 0.04);
  }
  renderAudioWindows(graph, 0.12);
  const liveVoices = [...processor.voices.values()].filter((voice) => voice.releasedAt === null && voice.stolenAt === null);
  const stolenVoices = [...processor.voices.values()].filter((voice) => voice.stolenAt !== null);
  if (liveVoices.length > 2) {
    throw new Error(`MidiNote voices limit allowed too many live voices: ${liveVoices.length}`);
  }
  if (stolenVoices.length === 0 && processor.activeVoicesByNote.has(60)) {
    throw new Error('MidiNote voice stealing did not retire the oldest note under a 2 voice limit.');
  }

  console.log(`midi-note ok hz=${voicedWindow.hz.toFixed(2)} live=${liveVoices.length} stolen=${stolenVoices.length}`);
}

function configureProcessorGraph(graph) {
  processor.port.onmessage({ data: { type: graph?.ops ? 'dspProgram' : 'graph', payload: graph } });
  if (samplePlayer) {
    const data = syntheticSampleData(sampleRate);
    processor.port.onmessage({
      data: {
        type: 'sampleData',
        payload: {
          nodeId: 'sample',
          data,
          sampleRate,
          name: 'synthetic.wav',
          storageKey: 'synthetic://sample',
        },
      },
    });
  }
  if (scope) {
    processor.port.onmessage({
      data: {
        type: 'setLinkScopes',
        payload: { linkIds: ['scope'], mode: 'zero-crossing', points: 256, displayPoints: 128, seconds: 0.08 },
      },
    });
  }
}

function renderAudioWindows(graph, renderSeconds) {
  const windowFrames = Math.round(sampleRate * 0.25);
  const totalBlocks = Math.ceil((renderSeconds * sampleRate) / blockSize);
  let windowSum = 0;
  let windowPeak = 0;
  let windowCount = 0;
  let previousSample = 0;
  let zeroCrossings = 0;
  const windows = [];

  for (let block = 0; block < totalBlocks; block += 1) {
    if (resendEveryBlock) {
      processor.port.onmessage({ data: { type: graph?.ops ? 'dspProgram' : 'graph', payload: graph } });
    }

    const left = new Float32Array(blockSize);
    const right = new Float32Array(blockSize);
    processor.process(audioInput ? [syntheticInputBlock(block)] : [], [[left, right]]);

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

  return windows;
}

function rearmSampleTrigger(graph) {
  const triggerBinding = graph.valueBindings?.find((binding) => (
    binding.kind === 'node-param'
    && binding.nodeId === 'sample'
    && binding.port === 'trigger'
  ));
  if (!triggerBinding) return;

  const values = [...graph.values];
  values[triggerBinding.valueIndex] = 0;
  processor.port.onmessage({ data: { type: 'dspValues', payload: { values } } });
  const resetBlocks = Math.ceil((sampleRate * 0.05) / blockSize);
  for (let block = 0; block < resetBlocks; block += 1) {
    processor.process([], [[new Float32Array(blockSize), new Float32Array(blockSize)]]);
  }
  values[triggerBinding.valueIndex] = 1;
  processor.port.onmessage({ data: { type: 'dspValues', payload: { values } } });
}

function printWindows(windows, prefix = '') {
  for (const row of windows) {
    console.log(`${prefix}${row.t.toFixed(2)}s rms=${row.rms.toFixed(6)} peak=${row.peak.toFixed(6)} hz=${row.hz.toFixed(2)}`);
  }
}

if (newNodes || effects || samplePlayer || audioInput || midiNote) {
  const meterMessages = outboundMessages.filter((message) => message.type === 'linkMeters');
  const latestLevels = meterMessages.at(-1)?.payload?.levels || [];
  const meter = latestLevels.find((level) => level[0] === 'meter') || [];
  console.log(`meter messages=${meterMessages.length} meter=${Number(meter[2] || 0).toFixed(6)}`);
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
  writeTranspiledModule('web/src/graph/customWave.ts', `${moduleDir}/customWave.mjs`);
  writeTranspiledModule('web/src/graph/subpatch.ts', `${moduleDir}/subpatch.mjs`, (source) => (
    source.replaceAll("'./customWave'", "'./customWave.mjs'")
  ));
  writeTranspiledModule('web/src/graph/migrations.ts', `${moduleDir}/migrations.mjs`, (source) => (
    source.replaceAll("'./customWave'", "'./customWave.mjs'")
  ));
  writeTranspiledModule('web/src/graph/nodeTypes.ts', `${moduleDir}/nodeTypes.mjs`);
  writeTranspiledModule('web/src/audio/dspProgram.ts', `${moduleDir}/dspProgram.mjs`, (source) => (
    source
      .replaceAll("'../graph/subpatch'", "'./subpatch.mjs'")
      .replaceAll("'../graph/customWave'", "'./customWave.mjs'")
      .replaceAll("'../graph/migrations'", "'./migrations.mjs'")
      .replaceAll("'../graph/nodeTypes'", "'./nodeTypes.mjs'")
  ));
  const compiler = await import(`file://${moduleDir}/dspProgram.mjs`);
  const patch = {
    nodes: midiNote
      ? [
        { id: 'midi', type: 'MidiNote', params: { voices: 2 } },
        { id: 'sine', type: 'SineOsc', params: { frequency: 220 } },
        { id: 'out', type: 'AudioOut', params: { level: 0.7 } },
      ]
      : audioInput
      ? [
        { id: 'input', type: 'AudioInput', params: { gain: 1, level: 0.8 } },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.8 } },
      ]
      : samplePlayer
      ? [
        { id: 'sample', type: 'SamplePlayer', sample: { name: 'synthetic.wav', url: 'synthetic://sample' }, params: { frequency: 440, trigger: 1, start: 0, end: 1, stretch: 1, cycleLength: 1024, overlapRatio: 0.09, originalPitch: 69, mode: sampleModeParams.get(activeSampleMode) ?? 0, level: 0.85 } },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.7 } },
      ]
      : filtersDistortions
      ? [
        { id: 'source', type: 'SineOsc', params: { frequency: 180 } },
        { id: 'formant', type: 'FormantFilter', params: { morph: 0.35, intensity: 10 } },
        { id: 'comb', type: 'CombFilter', params: { frequency: 440, feedback: 0.36 } },
        { id: 'notch', type: 'CombNotchFilter', params: { frequency: 660, feedback: 0.48 } },
        { id: 'hard', type: 'HardClipDistortion', params: { drive: 1.6 } },
        { id: 'soft', type: 'SoftClipDistortion', params: { drive: 1.8 } },
        { id: 'fuzz', type: 'FuzzDistortion', params: { drive: 2.2 } },
        { id: 'saturate', type: 'SaturateDistortion', params: { drive: 1.5 } },
        { id: 'wavefold', type: 'WavefoldDistortion', params: { drive: 2.4 } },
        { id: 'distortion', type: 'Distortion', params: { type: 4, drive: 1.2 } },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.45 } },
      ]
      : controlNodes
      ? [
        { id: 'carrier', type: 'SineOsc', params: { frequency: 180 } },
        { id: 'mod', type: 'TriangleOsc', params: { frequency: 0.75 } },
        {
          id: 'expr',
          type: 'Expression',
          expression: 'tanh(carrier * (0.65 + max(mod, 0.0) * 0.25))',
          inputs: [
            { name: 'carrier', defaultValue: 0 },
            { name: 'mod', defaultValue: 0 },
          ],
          params: { carrier: 0, mod: 0 },
        },
        { id: 'hard', type: 'HardClipDistortion', params: { drive: 1.4 } },
        { id: 'soft', type: 'SoftClipDistortion', params: { drive: 1.8 } },
        { id: 'gate', type: 'SquareOsc', params: { frequency: 3 } },
        { id: 'env', type: 'Envelope', params: { attack: 0.006, decay: 0.04, sustain: 0.45, release: 0.08 } },
        { id: 'follower', type: 'Follower', params: { attack: 0.004, release: 0.08 } },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.65 } },
      ]
      : effects
      ? [
        { id: 'sine', type: 'SineOsc', params: { frequency: 110 } },
        { id: 'ring', type: 'RingMod', params: { amount: 0.85 } },
        { id: 'fold', type: 'Fold', params: { amount: 0.8 } },
        { id: 'delay', type: 'Delay', params: { time: 0.06, feedback: 0.24, mix: 0.35 } },
        { id: 'chorus', type: 'Chorus', params: { rate: 1.1, depth: 0.006, mix: 0.28 } },
        { id: 'reverb', type: 'Reverb', params: { size: 0.5, decay: 0.32, mix: 0.22 } },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.6 } },
      ]
      : newNodes
      ? [
        { id: 'holdSource', type: 'SineOsc', params: { frequency: 0.75 } },
        { id: 'holdTrigger', type: 'SquareOsc', params: { frequency: 14 } },
        { id: 'sampleHold', type: 'SampleHoldOsc', params: { trigger: 0 } },
        { id: 'perlin', type: 'PerlinNoise', params: { speed: 5 } },
        { id: 'noise', type: 'Noise', params: {} },
        { id: 'input', type: 'AudioInput', params: { gain: 1, level: 0.5 } },
        {
          id: 'selector',
          type: 'Selector',
          params: { select: 1, slide: 0.005, 0: 0, 1: 0, 2: 0, 3: 0 },
          inputs: [
            { name: 'select', defaultValue: 0, min: 0, integer: true },
            { name: 'slide', defaultValue: 0, min: 0 },
            { name: '0', defaultValue: 0 },
            { name: '1', defaultValue: 0 },
            { name: '2', defaultValue: 0 },
            { name: '3', defaultValue: 0 },
          ],
        },
        { id: 'meter', type: 'Meter', params: { range: 1 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: { range: 1 } }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.5 } },
      ]
      : feedback
      ? [
        { id: 'tri', type: 'TriangleOsc', params: { frequency: 220 } },
        { id: 'sine', type: 'SineOsc', params: { frequency: 200 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.45 } },
      ]
      : modulated
      ? [
        { id: 'tri', type: 'TriangleOsc', params: { frequency: 1 } },
        { id: 'sine', type: 'SineOsc', params: { frequency: 61.4288 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.75 } },
      ]
      : [
        { id: 'sine', type: 'SineOsc', params: { frequency: 61.4288 } },
        ...(scope ? [{ id: 'scope', type: 'Scope', params: {} }] : []),
        { id: 'out', type: 'AudioOut', params: { level: 0.75 } },
      ],
    links: [
      ...(midiNote
        ? [
          { from: { node: 'midi', port: 'frequency' }, to: { node: 'sine', port: 'frequency' }, weight: 1, mode: 'set' },
          { from: { node: 'sine', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
        ]
        : []),
      ...(samplePlayer
        ? [
          { from: { node: 'sample', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 1, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(audioInput
        ? [
          { from: { node: 'input', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 1, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(filtersDistortions
        ? [
          { from: { node: 'source', port: 'signal' }, to: { node: 'formant', port: 'signal' }, weight: 0.55, mode: 'set' },
          { from: { node: 'formant', port: 'signal' }, to: { node: 'comb', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'comb', port: 'signal' }, to: { node: 'notch', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'notch', port: 'signal' }, to: { node: 'hard', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'hard', port: 'signal' }, to: { node: 'soft', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'soft', port: 'signal' }, to: { node: 'fuzz', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'fuzz', port: 'signal' }, to: { node: 'saturate', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'saturate', port: 'signal' }, to: { node: 'wavefold', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'wavefold', port: 'signal' }, to: { node: 'distortion', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'distortion', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 1, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(controlNodes
        ? [
          { from: { node: 'carrier', port: 'signal' }, to: { node: 'expr', port: 'carrier' }, weight: 0.75, mode: 'set' },
          { from: { node: 'mod', port: 'signal' }, to: { node: 'expr', port: 'mod' }, weight: 0.45, mode: 'set' },
          { from: { node: 'expr', port: 'value' }, to: { node: 'hard', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'hard', port: 'signal' }, to: { node: 'soft', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'soft', port: 'signal' }, to: { node: 'env', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'gate', port: 'signal' }, to: { node: 'env', port: 'trigger' }, weight: 1, mode: 'set' },
          { from: { node: 'env', port: 'signal' }, to: { node: 'follower', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'follower', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 1, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(effects
        ? [
          { from: { node: 'sine', port: 'signal' }, to: { node: 'ring', port: 'signal' }, weight: 0.6, mode: 'set' },
          { from: { node: 'ring', port: 'signal' }, to: { node: 'fold', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'fold', port: 'signal' }, to: { node: 'delay', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'delay', port: 'signal' }, to: { node: 'chorus', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'chorus', port: 'signal' }, to: { node: 'reverb', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'reverb', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 0.9, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(newNodes
        ? [
          { from: { node: 'holdSource', port: 'signal' }, to: { node: 'sampleHold', port: 'signal' }, weight: 1, mode: 'set' },
          { from: { node: 'holdTrigger', port: 'signal' }, to: { node: 'sampleHold', port: 'trigger' }, weight: 1, mode: 'set' },
          { from: { node: 'sampleHold', port: 'signal' }, to: { node: 'selector', port: '0' }, weight: 0.6, mode: 'set' },
          { from: { node: 'perlin', port: 'signal' }, to: { node: 'selector', port: '1' }, weight: 0.7, mode: 'set' },
          { from: { node: 'noise', port: 'signal' }, to: { node: 'selector', port: '2' }, weight: 0.2, mode: 'set' },
          { from: { node: 'input', port: 'signal' }, to: { node: 'selector', port: '3' }, weight: 1, mode: 'set' },
          { from: { node: 'selector', port: 'signal' }, to: { node: 'meter', port: 'signal' }, weight: 1, mode: 'set' },
          ...(scope
            ? [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: 1, mode: 'set' },
              { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]
            : [
              { from: { node: 'meter', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
            ]),
        ]
        : []),
      ...(feedback
        ? [
          { from: { node: 'tri', port: 'signal' }, to: { node: 'sine', port: 'frequency' }, weight: 24.5, mode: 'add' },
          { from: { node: 'sine', port: 'signal' }, to: { node: 'tri', port: 'frequency' }, weight: 22.5, mode: 'add' },
        ]
        : []),
      ...(modulated
        ? [{
          from: { node: 'tri', port: 'signal' },
          to: { node: 'sine', port: 'frequency' },
          weight: Number.isFinite(weightArg) ? weightArg : 0.7,
          mode: modeArg,
        }]
        : []),
      ...(scope && !newNodes && !effects && !controlNodes && !filtersDistortions && !samplePlayer && !audioInput && !midiNote
        ? [
          { from: { node: feedback ? 'tri' : 'sine', port: 'signal' }, to: { node: 'scope', port: 'signal' }, weight: feedback ? 0.7 : 1.3672, mode: 'set' },
          { from: { node: 'scope', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1, mode: 'set' },
        ]
        : newNodes || effects || controlNodes || filtersDistortions || samplePlayer || audioInput || midiNote
        ? []
        : [
          ...(feedback
            ? [
              { from: { node: 'tri', port: 'signal' }, to: { node: 'out', port: 'left' }, weight: 0.7, mode: 'set' },
              { from: { node: 'sine', port: 'signal' }, to: { node: 'out', port: 'right' }, weight: 0.75, mode: 'set' },
            ]
            : [
              { from: { node: 'sine', port: 'signal' }, to: { node: 'out', port: 'both' }, weight: 1.3672, mode: 'set' },
            ]),
        ]),
    ],
  };
  return compiler.compilePatchToDspProgram(patch);
}

function syntheticSampleData(rate) {
  const length = Math.round(rate * 0.25);
  const data = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / rate;
    const edge = Math.min(1, index / 128, (length - index - 1) / 128);
    data[index] = Math.sin(2 * Math.PI * 440 * t) * edge * 0.65;
  }
  return data;
}

function syntheticInputBlock(block) {
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    const t = (block * blockSize + index) / sampleRate;
    left[index] = Math.sin(2 * Math.PI * 220 * t) * 0.5;
    right[index] = Math.sin(2 * Math.PI * 330 * t) * 0.35;
  }
  return [left, right];
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

function normalizeSampleMode(mode) {
  return sampleModeParams.has(mode) ? mode : 'one-shot';
}
