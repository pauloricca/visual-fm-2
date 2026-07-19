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
  Buffer: ['signal', 'playhead', 'recordHead', 'length'],
  Playhead: ['start', 'speed'],
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
    node('playhead', 'Playhead', { start: 0, speed: 1 }),
    node('time', 'Time'),
    node('buffer', 'Buffer', { playhead: 0, recordHead: 0.5, length: 1 }),
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

const timeProgram = compilePatchToDspProgram({
  nodes: [
    node('time', 'Time'),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [link('time', 'seconds', 'out', 'both')],
});
assert(timeProgram.errors.length === 0, `Time DSP compile failed: ${timeProgram.errors.join('; ')}`);

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
  dspProgram.stateBindings.some((binding) => binding.id === 'playhead:playhead' && binding.count === 1)
    && dspProgram.ops.some((op) => op.opcode === 33),
  'Playhead should compile with one relative-position state slot.',
);
assert(
  timeProgram.stateBindings.some((binding) => binding.id === 'time:time' && binding.count === 1)
    && timeProgram.ops.some((op) => op.opcode === 37),
  'Time should compile with one elapsed-seconds state slot.',
);
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'buffer:buffer' && binding.count === 1)
    && dspProgram.ops.some((op) => op.opcode === 34),
  'Buffer should compile with one buffer storage state slot.',
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
