import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from '../node_modules/typescript/lib/typescript.js';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = path.join(repoRoot, 'web/src');
const outputRoot = path.join(os.tmpdir(), 'visual-fm-dsp-port-smoke');

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const program = ts.createProgram({
  rootNames: [
    path.join(sourceRoot, 'audio/dspProgram.ts'),
    path.join(sourceRoot, 'editor/dspNodeScope.ts'),
  ],
  options: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    rootDir: sourceRoot,
    outDir: outputRoot,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
  },
});

const emit = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length > 0) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => '\n',
  }));
}

const require = createRequire(import.meta.url);
const { compilePatchToDspProgram } = require(path.join(outputRoot, 'audio/dspProgram.js'));
const { getDefinition, getNodeDefinition } = require(path.join(outputRoot, 'graph/nodeTypes.js'));
const { expandGroups } = require(path.join(outputRoot, 'graph/subpatch.js'));
const { scopedDspNodeId } = require(path.join(outputRoot, 'editor/dspNodeScope.js'));

assert(scopedDspNodeId('accumulator', []) === 'accumulator', 'Root DSP node IDs should remain local.');
assert(
  scopedDspNodeId('accumulator', ['outer', 'inner']) === 'outer__inner__accumulator',
  'Nested subpatch DSP node IDs should include every containing group.',
);

const auditedPorts = {
  Delay: ['time', 'feedback', 'mix'],
  Chorus: ['rate', 'depth', 'mix'],
  Reverb: ['size', 'decay', 'mix'],
  LowpassFilter: ['cutoff', 'resonance'],
  SamplePlayer: ['start', 'end', 'attack', 'release', 'stretch', 'cycleLength', 'overlapRatio', 'originalFrequency', 'voices'],
  Buffer: ['signal', 'playhead', 'playhead speed', 'record head', 'record head speed', 'length'],
  Playhead: ['start', 'speed', 'length', 'reset trigger'],
  Time: [],
  Slider: ['signal'],
  Button: ['signal'],
  Accumulator: ['increment'],
  Clamp: ['min', 'max'],
  Pan: ['pan'],
  Pow: ['exponent'],
  Meter: ['range'],
  Scope: ['range'],
};

for (const [type, ports] of Object.entries(auditedPorts)) {
  const definition = getDefinition(type);
  for (const port of ports) {
    const input = definition.inputs.find((entry) => entry.name === port);
    assert(input, `${type}.${port} is missing from node metadata.`);
    assert(input.connectable !== false, `${type}.${port} should be connectable.`);
  }
}

const accumulatorIncrement = getDefinition('Accumulator').inputs.find((entry) => entry.name === 'increment');
assert(accumulatorIncrement?.defaultValue === 1, 'Accumulator.increment should default to 1.');
assert(accumulatorIncrement.integer !== true, 'Accumulator.increment should accept floating-point values.');
const accumulatorMode = getDefinition('Accumulator').inputs.find((entry) => entry.name === 'mode');
assert(accumulatorMode?.defaultValue === 0, 'Accumulator.mode should default to trigger mode.');
assert(accumulatorMode.connectable === false, 'Accumulator.mode should be selected locally.');
const bufferResetMode = getDefinition('Buffer').inputs.find((entry) => entry.name === 'on reset');
assert(bufferResetMode?.defaultValue === 0, 'Buffer.on reset should default to clear.');
assert(bufferResetMode.connectable === false, 'Buffer.on reset should be selected locally.');
const compressorSidechain = getDefinition('Compress').inputs.find((entry) => entry.name === 'sidechain');
assert(compressorSidechain, 'Compress.sidechain is missing from node metadata.');
assert(compressorSidechain.connectable !== false, 'Compress.sidechain should be connectable.');
assert(compressorSidechain.valueEditor === false, 'Compress.sidechain should only accept a linked signal.');
const spawnDefinition = getDefinition('Spawn');
assert(
  spawnDefinition.outputs.map((output) => output.name).join(',') === 'instance gate',
  'Spawn should expose its internal instance gate output.',
);
assert(
  spawnDefinition.inputs.map((input) => input.name).join(',') === 'trigger,release trigger,kill trigger',
  'Spawn should expose trigger, external release trigger, and internal kill trigger inputs.',
);
const midiNoteDefinition = getDefinition('MidiNote');
assert(
  midiNoteDefinition.inputs.map((input) => input.name).join(',') === 'channel',
  'MIDI Note should be monophonic and expose only its channel input.',
);
assert(
  midiNoteDefinition.outputs.map((output) => output.name).join(',') === 'note,frequency,velocity,gate,trigger',
  'MIDI Note should expose held monophonic note state.',
);
assert(
  getDefinition('MidiNoteOn').outputs.map((output) => output.name).join(',') === 'note,frequency,velocity',
  'MIDI Note On should expose queued note-on payload outputs.',
);
assert(
  getDefinition('MidiNoteOff').outputs.map((output) => output.name).join(',') === 'note,frequency',
  'MIDI Note Off should expose queued note-off payload outputs.',
);
for (const port of ['inputGain', 'ceiling', 'release', 'lookahead']) {
  const input = getDefinition('Limiter').inputs.find((entry) => entry.name === port);
  assert(input, `Limiter.${port} is missing from node metadata.`);
  assert(input.connectable !== false, `Limiter.${port} should be connectable.`);
}
assert(
  getNodeDefinition({
    ...node('legacy_accumulator', 'Accumulator'),
    inputs: [
      { name: 'trigger', defaultValue: 0 },
      { name: 'reset', defaultValue: 0, valueEditor: false },
      { name: 'min', defaultValue: 0 },
      { name: 'max', defaultValue: 1 },
    ],
  }).inputs.filter((entry) => entry.name === 'increment' || entry.name === 'mode').length === 2
    && getNodeDefinition({
      ...node('legacy_accumulator_order', 'Accumulator'),
      inputs: [
        { name: 'trigger', defaultValue: 0 },
        { name: 'mode', defaultValue: 0 },
        { name: 'reset', defaultValue: 0, valueEditor: false },
      ],
    }).inputs[0]?.name === 'mode',
  'Accumulator.increment and mode should be normalized in saved custom input layouts.',
);

const patch = {
  nodes: [
    node('control', 'Constant', { value: 0.42 }),
    node('source', 'Constant', { value: 0.2 }),
    node('delay', 'Delay', { time: 0.28, feedback: 0.35, mix: 0.25 }),
    node('chorus', 'Chorus', { rate: 0.8, depth: 0.012, mix: 0.25 }),
    node('reverb', 'Reverb', { size: 0.55, decay: 0.45, mix: 0.25 }),
    node('filter', 'LowpassFilter', { cutoff: 1200, resonance: 0.7 }),
    node('sample', 'SamplePlayer', {
      frequency: 220,
      trigger: 1,
      start: 0,
      end: 1,
      attack: 0.03,
      release: 0.2,
      stretch: 1,
      cycleLength: 4096,
      overlapRatio: 0.09,
      originalFrequency: 261.6255653005986,
      level: 0.7,
    }),
    node('playhead', 'Playhead', { start: 0, speed: 1, length: 1, 'reset trigger': 0 }),
    node('time', 'Time'),
    node('buffer', 'Buffer', { playhead: 0, 'playhead speed': 1, 'record head': 0.5, 'record head speed': 1, length: 1, 'on reset': 0 }),
    node('slider', 'Slider', { value: 0.25, min: 10, max: 20, direction: 0 }),
    node('clamp', 'Clamp', { min: -0.5, max: 0.5 }),
    node('pow', 'Pow', { exponent: 0.5 }),
    node('pan', 'Pan', { pan: 0 }),
    node('button', 'Button', { mode: 1, pressed: 0, clicks: 0 }),
    node('accumulator', 'Accumulator', { trigger: 0, reset: 0, increment: 0.25, mode: 1, min: 0, max: 1 }),
    node('meter', 'Meter', { range: 1 }),
    node('scope', 'Scope', { range: 1 }),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('source', 'signal', 'delay', 'signal'),
    link('delay', 'signal', 'chorus', 'signal'),
    link('chorus', 'signal', 'reverb', 'signal'),
    link('reverb', 'left', 'filter', 'signal'),
    link('reverb', 'left', 'out', 'left'),
    link('reverb', 'right', 'out', 'right'),
    link('filter', 'signal', 'meter', 'signal'),
    link('filter', 'signal', 'scope', 'signal'),
    link('source', 'signal', 'clamp', 'signal'),
    link('source', 'signal', 'pow', 'signal'),
    link('source', 'signal', 'pan', 'signal'),
    link('pan', 'left', 'out', 'left'),
    link('pan', 'right', 'out', 'right'),
    link('clamp', 'signal', 'out', 'both'),
    link('pow', 'signal', 'out', 'both'),
    link('meter', 'signal', 'out', 'left'),
    link('scope', 'signal', 'out', 'right'),
    link('sample', 'signal', 'out', 'both'),
    link('playhead', 'playhead', 'buffer', 'playhead'),
    link('source', 'signal', 'buffer', 'signal'),
    link('buffer', 'signal', 'out', 'both'),
    link('buffer', 'record head out', 'out', 'both'),
    link('slider', 'signal', 'out', 'both'),
    link('button', 'signal', 'out', 'both'),
    link('accumulator', 'signal', 'out', 'both'),
    ...Object.entries(auditedPorts).flatMap(([type, ports]) => {
      const nodeId = type === 'LowpassFilter' ? 'filter' : type === 'SamplePlayer' ? 'sample' : type.toLowerCase();
      return ports.map((port) => link('control', 'signal', nodeId, port));
    }),
  ],
};

const dspProgram = compilePatchToDspProgram(patch);
assert(dspProgram.errors.length === 0, `DSP compile failed: ${dspProgram.errors.join('; ')}`);
assert(
  dspProgram.ops.some((op) => op.opcode === 29 && op.value === 1),
  'Accumulator continuous mode should be encoded in the DSP operation.',
);

const idleEnvelopeProgram = compilePatchToDspProgram({
  nodes: [
    node('source', 'Constant', { value: 1 }),
    node('envelope', 'Envelope', {
      trigger: 1,
      gate: 1,
      delay: 0,
      attack: 0.01,
      decay: 0.16,
      sustain: 0.72,
      gateLength: 0,
      release: 0.24,
    }),
    node('out', 'AudioOut', { level: 1 }),
  ],
  links: [
    link('source', 'signal', 'envelope', 'signal'),
    link('envelope', 'signal', 'out', 'both'),
  ],
});
assert(
  idleEnvelopeProgram.errors.length === 0,
  `Idle Envelope DSP compile failed: ${idleEnvelopeProgram.errors.join('; ')}`,
);
const idleEnvelopeOp = idleEnvelopeProgram.ops.find((op) => op.opcode === 19);
assert(idleEnvelopeOp, 'Envelope should compile an Envelope operation.');
for (const register of [idleEnvelopeOp.a, idleEnvelopeOp.b]) {
  const valueOp = idleEnvelopeProgram.ops.find((op) => op.opcode === 0 && op.out === register);
  assert(
    valueOp && idleEnvelopeProgram.values[valueOp.a] === 0,
    'Unconnected Envelope trigger and gate ports should compile as zero even when stale saved values are present.',
  );
}

const spawnProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('spawn', 'Spawn', { trigger: 0 }), position: { x: 0, y: 0 }, scopeSize: { width: 320, height: 220 } },
    { ...node('spawn_trigger', 'Constant', { value: 0 }), position: { x: -140, y: 0 } },
    { ...node('spawn_release', 'Constant', { value: 0 }), position: { x: -140, y: 60 } },
    { ...node('voice', 'Constant', { value: 0.25 }), position: { x: 20, y: 110 } },
    { ...node('gate', 'Pass', { signal: 0 }), position: { x: 20, y: 160 } },
    { ...node('voice_out', 'AudioOut', { level: 1 }), position: { x: 140, y: 110 } },
  ],
  links: [
    link('spawn_trigger', 'signal', 'spawn', 'trigger'),
    link('spawn_release', 'signal', 'spawn', 'release trigger'),
    link('spawn', 'instance gate', 'gate', 'signal'),
    link('gate', 'signal', 'voice_out', 'level'),
    link('voice', 'signal', 'voice_out', 'both'),
    link('voice', 'signal', 'spawn', 'kill trigger'),
  ],
});
assert(spawnProgram.errors.length === 0, `Spawn DSP compile failed: ${spawnProgram.errors.join('; ')}`);
const spawnBeginIndex = spawnProgram.ops.findIndex((op) => op.opcode === 46);
assert(spawnBeginIndex >= 0, 'Spawn should compile a SpawnBegin operation.');
const spawnBegin = spawnProgram.ops[spawnBeginIndex];
assert(spawnBegin.c >= 0, 'Spawn should compile its internal kill trigger register.');
assert(spawnBegin.d >= 0, 'Spawn should compile its external release trigger register.');
assert(
  spawnProgram.ops.some((op) => op.opcode === 50),
  'Spawn should compile its internal instance gate signal.',
);
assert(
  spawnProgram.ops[spawnBegin.b]?.opcode === 47,
  'SpawnBegin should point to its matching SpawnEnd operation.',
);
const invalidSpawnKillProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('spawn', 'Spawn', { trigger: 0 }), position: { x: 0, y: 0 }, scopeSize: { width: 320, height: 220 } },
    { ...node('external_kill', 'Constant', { value: 1 }), position: { x: -140, y: 80 } },
    { ...node('out', 'AudioOut', { level: 1 }), position: { x: 400, y: 0 } },
  ],
  links: [
    link('external_kill', 'signal', 'spawn', 'kill trigger'),
    link('external_kill', 'signal', 'out', 'both'),
  ],
});
assert(
  invalidSpawnKillProgram.errors.some((error) => error.includes('kill trigger can only be driven by a node inside that Spawn')),
  `External Spawn kill trigger error missing: ${invalidSpawnKillProgram.errors.join('; ')}`,
);
const invalidInternalSpawnReleaseProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('spawn', 'Spawn', { trigger: 0 }), position: { x: 0, y: 0 }, scopeSize: { width: 480, height: 220 } },
    { ...node('internal_release', 'Constant', { value: 35 }), position: { x: 20, y: 110 } },
  ],
  links: [
    link('internal_release', 'signal', 'spawn', 'release trigger'),
  ],
});
assert(
  invalidInternalSpawnReleaseProgram.errors.some((error) => error.includes('release trigger cannot be driven by a node inside the same Spawn')),
  `Internal Spawn release trigger error missing: ${invalidInternalSpawnReleaseProgram.errors.join('; ')}`,
);
const invalidSpawnGateProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('spawn', 'Spawn', { trigger: 0 }), position: { x: 0, y: 0 }, scopeSize: { width: 320, height: 220 } },
    { ...node('external_gate', 'Pass', { signal: 0 }), position: { x: 400, y: 0 } },
  ],
  links: [
    link('spawn', 'instance gate', 'external_gate', 'signal'),
  ],
});
assert(
  invalidSpawnGateProgram.errors.some((error) => error.includes('instance gate can only link to nodes inside that Spawn')),
  `External Spawn instance gate error missing: ${invalidSpawnGateProgram.errors.join('; ')}`,
);

const midiEventProgram = compilePatchToDspProgram({
  nodes: [
    node('midi_mono', 'MidiNote', { channel: 0 }),
    node('midi_on', 'MidiNoteOn', { channel: 0 }),
    node('midi_off', 'MidiNoteOff', { channel: 0 }),
    node('midi_out', 'AudioOut', { level: 1 }),
  ],
  links: [
    link('midi_mono', 'gate', 'midi_out', 'left'),
    link('midi_on', 'velocity', 'midi_out', 'right'),
    link('midi_off', 'note', 'midi_out', 'both'),
  ],
});
assert(midiEventProgram.errors.length === 0, `MIDI event DSP compile failed: ${midiEventProgram.errors.join('; ')}`);
assert(!midiEventProgram.usesMidiNote, 'MIDI nodes should not enable whole-program voice rendering.');
assert(midiEventProgram.maxVoices === 1, 'MIDI nodes should not allocate legacy graph voices.');
const midiOutputKinds = new Set(
  midiEventProgram.ops.filter((op) => op.opcode === 27).map((op) => op.a),
);
for (const kind of [3, 7, 8]) {
  assert(midiOutputKinds.has(kind), `MIDI output kind ${kind} was not compiled.`);
}

const timeProgram = compilePatchToDspProgram({
  nodes: [
    node('time', 'Time'),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [link('time', 'seconds', 'out', 'both')],
});
assert(timeProgram.errors.length === 0, `Time DSP compile failed: ${timeProgram.errors.join('; ')}`);

const sidechainProgram = compilePatchToDspProgram({
  nodes: [
    node('main_signal', 'Constant', { value: 0.25 }),
    node('kick', 'Constant', { value: 1 }),
    node('compressor', 'Compress', {
      threshold: -24,
      ratio: 4,
      attack: 0.01,
      release: 0.1,
      knee: 6,
      makeup: 0,
    }),
    node('out', 'AudioOut', { level: 1 }),
  ],
  links: [
    link('main_signal', 'signal', 'compressor', 'signal'),
    link('kick', 'signal', 'compressor', 'sidechain'),
    link('compressor', 'signal', 'out', 'both'),
  ],
});
assert(sidechainProgram.errors.length === 0, `Compressor sidechain DSP compile failed: ${sidechainProgram.errors.join('; ')}`);
const compressorOp = sidechainProgram.ops.find((op) => op.opcode === 38);
assert(compressorOp, 'Linked compressor should emit a Compress DSP operation.');
assert(
  Number.isInteger(compressorOp.value2) && compressorOp.value2 >= 0,
  'Linked compressor should pass its sidechain detector register to the WASM operation.',
);
const compressorOpIndex = sidechainProgram.ops.indexOf(compressorOp);
assert(
  sidechainProgram.ops.slice(0, compressorOpIndex).some((op) => op.out === compressorOp.value2),
  'The sidechain detector register should be populated before the compressor runs.',
);
assert(
  !sidechainProgram.valueBindings.some((binding) => (
    binding.kind === 'node-param'
    && binding.nodeId === 'compressor'
    && binding.port === 'sidechain'
  )),
  'A linked compressor sidechain should not compile as a static parameter.',
);

const limiterProgram = compilePatchToDspProgram({
  nodes: [
    node('signal', 'Constant', { value: 2 }),
    node('limiter', 'Limiter', { inputGain: 0, ceiling: -1, release: 0.05, lookahead: 0.005 }),
    node('out', 'AudioOut', { level: 1 }),
  ],
  links: [
    link('signal', 'signal', 'limiter', 'signal'),
    link('limiter', 'signal', 'out', 'both'),
  ],
});
assert(limiterProgram.errors.length === 0, `Limiter DSP compile failed: ${limiterProgram.errors.join('; ')}`);
assert(limiterProgram.ops.some((op) => op.opcode === 39), 'Limiter should emit a Limiter DSP operation.');

for (const [type, ports] of Object.entries(auditedPorts)) {
  const nodeId = type === 'LowpassFilter' ? 'filter' : type === 'SamplePlayer' ? 'sample' : type.toLowerCase();
  for (const port of ports) {
    const staticBinding = dspProgram.valueBindings.find((binding) => (
      binding.kind === 'node-param'
      && binding.nodeId === nodeId
      && binding.port === port
    ));
    assert(!staticBinding, `${type}.${port} compiled as a static node param despite an incoming link.`);
  }
}

assert(
  ['left', 'right'].every((port) => getDefinition('Pan').outputs.some((output) => output.name === port)),
  'Pan should expose left and right outputs.',
);

assert(
  ['left', 'right'].every((port) => getDefinition('Reverb').outputs.some((output) => output.name === port))
    && !getDefinition('Reverb').outputs.some((output) => output.name === 'signal'),
  'Reverb should expose only left and right outputs.',
);

for (const ignoredPort of ['min', 'max']) {
  const staticBinding = dspProgram.valueBindings.find((binding) => (
    binding.kind === 'node-param'
    && binding.nodeId === 'slider'
    && binding.port === ignoredPort
  ));
  assert(!staticBinding, `Slider.${ignoredPort} compiled despite linked signal input.`);
}

assert(Object.hasOwn(dspProgram.monitorIds, 'meter'), 'Meter signal should be monitored.');
assert(Object.hasOwn(dspProgram.monitorIds, 'scope'), 'Scope signal should be monitored.');
for (const port of ['start', 'end', 'attack', 'release']) {
  const monitorId = `sample:sample-${port}`;
  assert(Object.hasOwn(dspProgram.monitorIds, monitorId), `SamplePlayer.${port} should expose its resolved input for visualization.`);
  assert(dspProgram.signedMeterIds.includes(monitorId), `SamplePlayer.${port} visualization should preserve signed values before display clamping.`);
}

const unroutedSampleProgram = compilePatchToDspProgram({
  nodes: [
    node('control', 'Constant', { value: 0.25 }),
    node('sample', 'SamplePlayer', { start: 0, end: 1, attack: 0, release: 0 }),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [link('control', 'signal', 'sample', 'start')],
});
assert(
  Object.hasOwn(unroutedSampleProgram.monitorIds, 'sample:sample-start'),
  'An unrouted SamplePlayer should still compile linked controls for its preview.',
);
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'button:button' && binding.count === 3),
  'Button should compile with click edge state.',
);
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'button:button-gate-slew' && binding.count === 1)
    && dspProgram.ops.some((op) => op.opcode === 31),
  'Button signal gating should compile with a declick slew.',
);
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'playhead:playhead' && binding.count === 2)
    && dspProgram.ops.some((op) => op.opcode === 33 && Number.isInteger(op.c) && Number.isInteger(op.e)),
  'Playhead should compile with relative-position and reset-edge state slots.',
);
assert(
  timeProgram.stateBindings.some((binding) => binding.id === 'time:time' && binding.count === 1)
    && timeProgram.ops.some((op) => op.opcode === 37),
  'Time should compile with one elapsed-seconds state slot.',
);
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'buffer:buffer' && binding.count === 7)
    && dspProgram.ops.filter((op) => op.opcode === 34).length === 1
    && dspProgram.ops.some((op) => op.opcode === 34
      && Number.isInteger(op.e)
      && Number.isInteger(op.value2)
      && Number.isInteger(op.value3)
      && op.value4 === 3
      && op.value === 0),
  `Buffer should compile storage plus visualization state and a record-head output register: ${JSON.stringify({
    binding: dspProgram.stateBindings.find((binding) => binding.id === 'buffer:buffer'),
    ops: dspProgram.ops.filter((op) => op.opcode === 34),
  })}`,
);
assert(
  ['pressed', 'mode', 'clicks'].every((port) => dspProgram.valueBindings.some((binding) => (
    binding.kind === 'node-param'
    && binding.nodeId === 'button'
    && binding.port === port
  ))),
  'Button should compile pressed, mode, and clicks value bindings.',
);

const midiControlProgram = compilePatchToDspProgram({
  nodes: [
    node('midi_slider', 'Slider', { value: 0.25, min: 0, max: 1, direction: 0, midiChannel: 2, midiCc: 74 }),
    node('midi_button', 'Button', { mode: 1, pressed: 0, clicks: 0, midiChannel: 3, midiCc: 75 }),
    node('midi_scope_slider', 'Scope', { range: 1 }),
    node('midi_scope_button', 'Scope', { range: 1 }),
  ],
  links: [
    link('midi_slider', 'signal', 'midi_scope_slider', 'signal'),
    link('midi_button', 'signal', 'midi_scope_button', 'signal'),
  ],
});
assert(
  midiControlProgram.midiControlBindings.some((binding) => (
    binding.kind === 'slider' &&
    binding.nodeId === 'midi_slider' &&
    binding.channel === 2 &&
    binding.cc === 74
  )),
  'Slider should compile an enabled MIDI CC control binding.',
);
assert(
  midiControlProgram.midiControlBindings.some((binding) => (
    binding.kind === 'button' &&
    binding.nodeId === 'midi_button' &&
    binding.channel === 3 &&
    binding.cc === 75 &&
    Number.isInteger(binding.modeValueIndex) &&
    Number.isInteger(binding.clicksValueIndex)
  )),
  'Button should compile an enabled MIDI CC control binding with mode and click indexes.',
);
assert(
  !dspProgram.midiControlBindings.some((binding) => binding.nodeId === 'slider' || binding.nodeId === 'button'),
  'MIDI control bindings should stay disabled until midiChannel is set.',
);

const terminalScopeProgram = compilePatchToDspProgram({
  nodes: [
    node('button_scope_source', 'Button', { mode: 0, pressed: 1, clicks: 0 }),
    node('button_scope', 'Scope', { range: 1 }),
  ],
  links: [
    link('button_scope_source', 'signal', 'button_scope', 'signal'),
  ],
});
assert(
  terminalScopeProgram.errors.length === 0,
  `Terminal Scope compile failed: ${terminalScopeProgram.errors.join('; ')}`,
);
assert(Object.hasOwn(terminalScopeProgram.monitorIds, 'button_scope'), 'Terminal Scope signal should be monitored.');
assert(
  terminalScopeProgram.ops.some((op) => op.opcode === 30),
  'Terminal Button -> Scope patch should compile the Button op.',
);

const terminalFftProgram = compilePatchToDspProgram({
  nodes: [
    node('fft_source', 'Constant', { value: 0.5 }),
    node('fft', 'FFT'),
    node('fft_frequency_meter', 'Meter', { range: 20000 }),
    node('fft_amplitude_meter', 'Meter', { range: 1 }),
  ],
  links: [
    link('fft_source', 'signal', 'fft', 'signal'),
    link('fft', 'frequency', 'fft_frequency_meter', 'signal'),
    link('fft', 'amplitude', 'fft_amplitude_meter', 'signal'),
  ],
});
assert(
  terminalFftProgram.errors.length === 0,
  `Terminal FFT compile failed: ${terminalFftProgram.errors.join('; ')}`,
);
assert(Object.hasOwn(terminalFftProgram.monitorIds, 'fft'), 'Terminal FFT signal should be monitored.');
assert(
  getDefinition('FFT').outputs.map((output) => output.name).join(',') === 'frequency,amplitude',
  'FFT should expose dominant frequency and amplitude outputs.',
);
assert(terminalFftProgram.fftBindings.length === 1, 'FFT should compile one analyser binding.');
assert(
  terminalFftProgram.ops.filter((op) => (
    op.opcode === 0
    && (
      op.a === terminalFftProgram.fftBindings[0].frequencyValueIndex
      || op.a === terminalFftProgram.fftBindings[0].amplitudeValueIndex
    )
    && op.value === 1
  )).length === 2,
  'Linked FFT outputs should compile as immediate live analyser values.',
);
for (const [port, defaultValue] of [['minFreq', 20], ['maxFreq', 20000]]) {
  const input = getDefinition('FFT').inputs.find((entry) => entry.name === port);
  assert(input?.defaultValue === defaultValue, `FFT.${port} should default to ${defaultValue}.`);
  assert(input?.connectable === false, `FFT.${port} should remain a local display control.`);
}

const keysProgram = compilePatchToDspProgram({
  nodes: [
    node('keys', 'Keys', { note: 0, frequency: 0, size: 12, startNote: 60 }),
    node('note_meter', 'Meter', { range: 127 }),
    node('frequency_meter', 'Meter', { range: 2000 }),
  ],
  links: [
    link('keys', 'midi note', 'note_meter', 'signal'),
    link('keys', 'frequency', 'frequency_meter', 'signal'),
  ],
});
assert(keysProgram.errors.length === 0, `Keys compile failed: ${keysProgram.errors.join('; ')}`);
for (const port of ['note', 'frequency']) {
  const binding = keysProgram.valueBindings.find((entry) => (
    entry.kind === 'node-param' && entry.nodeId === 'keys' && entry.port === port
  ));
  assert(binding, `Keys.${port} value binding is missing.`);
  assert(
    keysProgram.ops.some((op) => op.opcode === 0 && op.a === binding.valueIndex && op.value === 1),
    `Keys.${port} should compile as an immediate value.`,
  );
}

const boundaryPatch = {
  nodes: [
    node('external', 'Constant', { value: 2 }),
    {
      ...node('group', 'Group', { control: 5 }),
      inputs: [{ name: 'control', defaultValue: 5 }],
      outputs: [{ name: 'result' }],
      subpatch: {
        nodes: [
          { ...node('ins', 'Ins', { control: 5 }), outputs: [{ name: 'control', defaultValue: 5 }] },
          node('inner_control', 'Pass'),
          { ...node('outs', 'Outs'), inputs: [{ name: 'result', defaultValue: 2 }] },
        ],
        links: [
          { ...link('ins', 'control', 'inner_control', 'signal'), weight: 0.0001, mode: 'set' },
          { ...link('inner_control', 'signal', 'outs', 'result'), weight: 0.25, mode: 'multiply' },
        ],
      },
    },
    node('meter', 'Meter', { range: 100 }),
  ],
  links: [
    { ...link('external', 'signal', 'group', 'control'), weight: 3, mode: 'add' },
    { ...link('group', 'result', 'meter', 'signal'), weight: 4, mode: 'multiply' },
  ],
};
const expandedBoundaryPatch = expandGroups(boundaryPatch);
const inputOuterLink = expandedBoundaryPatch.links.find((entry) => entry.from.node === 'external');
const inputInnerLink = expandedBoundaryPatch.links.find((entry) => entry.to.node === 'group__inner_control');
assert(inputOuterLink?.weight === 3 && inputOuterLink.mode === 'add', 'Group input edge should retain its outer weight and mode.');
assert(
  inputInnerLink?.from.node === inputOuterLink?.to.node
    && inputInnerLink?.weight === 0.0001
    && inputInnerLink.mode === 'set',
  'Ins should expand to a pass stage followed by the independently weighted inner edge.',
);
const outputOuterLink = expandedBoundaryPatch.links.find((entry) => entry.to.node === 'meter');
const outputInnerLink = expandedBoundaryPatch.links.find((entry) => entry.to.node === outputOuterLink?.from.node);
assert(outputInnerLink?.weight === 0.25 && outputInnerLink.mode === 'multiply', 'Outs should retain the inner edge weight and mode.');
assert(
  outputOuterLink?.from.node === outputInnerLink?.to.node
    && outputOuterLink?.weight === 4
    && outputOuterLink.mode === 'multiply',
  'Group output should expand from a pass stage onto the independently weighted outer edge.',
);
const boundaryProgram = compilePatchToDspProgram(boundaryPatch);
assert(boundaryProgram.errors.length === 0, `Subpatch boundary compile failed: ${boundaryProgram.errors.join('; ')}`);
for (const expectedWeight of [0.0001, 0.25, 3, 4]) {
  assert(
    boundaryProgram.valueBindings.some((binding) => binding.kind === 'link-weight' && boundaryProgram.values[binding.valueIndex] === expectedWeight),
    `Subpatch boundary link weight ${expectedWeight} should survive DSP expansion.`,
  );
}

const invalidExpressionProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('expr_bad', 'Expression', {}), expression: 'spline(a)' },
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('expr_bad', 'value', 'out', 'both'),
  ],
});
assert(
  invalidExpressionProgram.errors.some((error) => error.includes('Expression node "expr_bad" uses unsupported function "spline"')),
  `Invalid expression error missing: ${invalidExpressionProgram.errors.join('; ')}`,
);

const logicalExpressionProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('expr_logic', 'Expression', { a: 0, b: 0 }), expression: 'a > 0.5 && (b <= 1 || !false)' },
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('expr_logic', 'value', 'out', 'both'),
  ],
});
assert(
  logicalExpressionProgram.errors.length === 0,
  `Logical expression compile failed: ${logicalExpressionProgram.errors.join('; ')}`,
);
for (const functionId of [20, 21, 26, 27, 25]) {
  assert(
    logicalExpressionProgram.ops.some((op) => op.opcode === 26 && op.a === functionId),
    `Logical expression should emit function ${functionId}.`,
  );
}

const invalidOperatorProgram = compilePatchToDspProgram({
  nodes: [
    { ...node('expr_invalid_operator', 'Expression', { a: 0 }), expression: 'a = 0.5' },
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('expr_invalid_operator', 'value', 'out', 'both'),
  ],
});
assert(
  invalidOperatorProgram.errors.some((error) => error.includes('unsupported syntax near "="')),
  `Invalid operator should not be converted to addition: ${invalidOperatorProgram.errors.join('; ')}`,
);

const badLinkProgram = compilePatchToDspProgram({
  nodes: [
    node('source', 'Constant', { value: 1 }),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('source', 'missing', 'out', 'both'),
    link('source', 'signal', 'out', 'center'),
  ],
});
assert(
  badLinkProgram.errors.some((error) => error.includes('invalid output port "missing" on node "source"')),
  `Bad source port error missing: ${badLinkProgram.errors.join('; ')}`,
);
assert(
  badLinkProgram.errors.some((error) => error.includes('invalid input port "center" on node "out"')),
  `Bad target port error missing: ${badLinkProgram.errors.join('; ')}`,
);

const missingOutputProgram = compilePatchToDspProgram({
  nodes: [
    node('source', 'Constant', { value: 1 }),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('source', 'signal', 'out', 'center'),
  ],
});
assert(
  missingOutputProgram.errors.some((error) => error.includes('Audio Out node "out" has no connected audio signal.')),
  `Missing output error missing: ${missingOutputProgram.errors.join('; ')}`,
);

console.log('DSP port link smoke passed.');

function node(id, type, params = {}) {
  return { id, type, params };
}

function link(fromNode, fromPort, toNode, toPort) {
  return {
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
    weight: 1,
    mode: 'set',
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
