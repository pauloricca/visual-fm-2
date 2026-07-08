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
  rootNames: [path.join(sourceRoot, 'audio/dspProgram.ts')],
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
const { getDefinition } = require(path.join(outputRoot, 'graph/nodeTypes.js'));

const auditedPorts = {
  Delay: ['time', 'feedback', 'mix'],
  Chorus: ['rate', 'depth', 'mix'],
  Reverb: ['size', 'decay', 'mix'],
  LowpassFilter: ['cutoff', 'resonance'],
  SamplePlayer: ['start', 'end', 'stretch', 'cycleLength', 'overlapRatio', 'originalPitch'],
  Slider: ['signal'],
  Clamp: ['min', 'max'],
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
      stretch: 1,
      cycleLength: 4096,
      overlapRatio: 0.09,
      originalPitch: 60,
      level: 0.7,
    }),
    node('slider', 'Slider', { value: 0.25, min: 10, max: 20, direction: 0 }),
    node('clamp', 'Clamp', { min: -0.5, max: 0.5 }),
    node('button', 'Button', { mode: 1, pressed: 0, clicks: 0 }),
    node('meter', 'Meter', { range: 1 }),
    node('scope', 'Scope', { range: 1 }),
    node('out', 'AudioOut', { level: 0.75 }),
  ],
  links: [
    link('source', 'signal', 'delay', 'signal'),
    link('delay', 'signal', 'chorus', 'signal'),
    link('chorus', 'signal', 'reverb', 'signal'),
    link('reverb', 'signal', 'filter', 'signal'),
    link('filter', 'signal', 'meter', 'signal'),
    link('filter', 'signal', 'scope', 'signal'),
    link('source', 'signal', 'clamp', 'signal'),
    link('clamp', 'signal', 'out', 'both'),
    link('meter', 'signal', 'out', 'left'),
    link('scope', 'signal', 'out', 'right'),
    link('sample', 'signal', 'out', 'both'),
    link('slider', 'signal', 'out', 'both'),
    link('button', 'signal', 'out', 'both'),
    ...Object.entries(auditedPorts).flatMap(([type, ports]) => {
      const nodeId = type === 'LowpassFilter' ? 'filter' : type === 'SamplePlayer' ? 'sample' : type.toLowerCase();
      return ports.map((port) => link('control', 'signal', nodeId, port));
    }),
  ],
};

const dspProgram = compilePatchToDspProgram(patch);
assert(dspProgram.errors.length === 0, `DSP compile failed: ${dspProgram.errors.join('; ')}`);

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
assert(
  dspProgram.stateBindings.some((binding) => binding.id === 'button:button' && binding.count === 3),
  'Button should compile with click edge state.',
);
assert(
  ['pressed', 'mode', 'clicks'].every((port) => dspProgram.valueBindings.some((binding) => (
    binding.kind === 'node-param'
    && binding.nodeId === 'button'
    && binding.port === port
  ))),
  'Button should compile pressed, mode, and clicks value bindings.',
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
