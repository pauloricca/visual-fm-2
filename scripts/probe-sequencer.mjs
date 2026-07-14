import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from '../node_modules/typescript/lib/typescript.js';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = path.join(repoRoot, 'web/src');
const outputRoot = path.join(os.tmpdir(), 'visual-fm-sequencer-probe');

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

const patch = {
  nodes: [
    node('gate', 'Constant', { value: 0 }),
    node('reset', 'Constant', { value: 0 }),
    node('seq', 'Sequencer', { steps: 4, rows: 1, 'cell:0:0': 1, 'cell:0:2': 1 }),
    node('scope', 'Scope', { range: 1 }),
  ],
  links: [
    link('gate', 'signal', 'seq', 'signal'),
    link('reset', 'signal', 'seq', 'reset'),
    link('seq', '1', 'scope', 'signal'),
  ],
};

const dspProgram = compilePatchToDspProgram(patch);
assert(dspProgram.errors.length === 0, `DSP compile failed: ${dspProgram.errors.join('; ')}`);
const state = dspProgram.stateBindings.find((binding) => binding.id === 'seq:sequencer')?.state;
assert(Number.isInteger(state), 'Sequencer state binding was not emitted.');
assert(
  dspProgram.stateBindings.find((binding) => binding.id === 'seq:sequencer')?.count === 6,
  'Sequencer state binding should include reset trigger memory.',
);
const gateValue = dspProgram.valueBindings.find((binding) => binding.id === 'gate.value')?.valueIndex;
const resetValue = dspProgram.valueBindings.find((binding) => binding.id === 'reset.value')?.valueIndex;
assert(Number.isInteger(gateValue), 'Gate value binding was not emitted.');
assert(Number.isInteger(resetValue), 'Reset value binding was not emitted.');

const widePatch = {
  nodes: [
    node('gate', 'Constant', { value: 0 }),
    node('seq', 'Sequencer', {
      steps: 128,
      rows: 1,
      'cell:0:0': 1,
      'cell:0:2': 1,
      'cell:0:64': 1,
      'cell:0:127': 1,
    }),
    node('scope', 'Scope', { range: 1 }),
  ],
  links: [
    link('gate', 'signal', 'seq', 'signal'),
    link('seq', '1', 'scope', 'signal'),
  ],
};
const wideDspProgram = compilePatchToDspProgram(widePatch);
assert(wideDspProgram.errors.length === 0, `Wide DSP compile failed: ${wideDspProgram.errors.join('; ')}`);
const widePatternOp = wideDspProgram.ops.find((op) => op.opcode === 35 && op.value4);
assert(widePatternOp?.value === 5, `Wide sequencer lane 1 was not packed correctly: ${widePatternOp?.value}`);
assert(widePatternOp?.value2 === 0, `Wide sequencer lane 2 should be empty: ${widePatternOp?.value2}`);
assert(widePatternOp?.value3 === 1, `Wide sequencer lane 3 was not packed correctly: ${widePatternOp?.value3}`);
assert(widePatternOp?.value4 === 2147483648, `Wide sequencer lane 4 was not packed correctly: ${widePatternOp?.value4}`);

const wasmBytes = fs.readFileSync(path.join(repoRoot, 'web/public/audio/visual-fm-kernel.wasm'));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const wasm = instance.exports;

wasm.clearDspProgram();
wasm.resetDspRuntimeState();
for (let index = 0; index < dspProgram.values.length; index += 1) {
  wasm.setDspValue(index, dspProgram.values[index]);
}
for (const op of dspProgram.ops) {
  wasm.addDspOp(
    op.opcode ?? -1,
    op.out ?? -1,
    op.a ?? -1,
    op.b ?? -1,
    op.c ?? -1,
    op.d ?? -1,
    op.e ?? -1,
    op.state ?? -1,
    op.value ?? 0,
    op.value2 ?? 0,
    op.value3 ?? 0,
    op.value4 ?? 0,
  );
}

function renderFrames(count) {
  for (let frame = 0; frame < count; frame += 1) {
    wasm.beginDspRenderQuantum();
    wasm.renderDspProgram(1, 48000);
  }
}

function pulse(valueIndex) {
  wasm.setDspValue(valueIndex, 1);
  renderFrames(1000);
  const step = wasm.getDspState(state);
  wasm.setDspValue(valueIndex, 0);
  renderFrames(1000);
  return step;
}

const advanced = [
  pulse(gateValue),
  pulse(gateValue),
  pulse(gateValue),
  pulse(gateValue),
  pulse(gateValue),
  pulse(gateValue),
];
assert(advanced.join(',') === '0,1,2,3,0,1', `Sequencer did not advance as expected: ${advanced.join(',')}`);

const beforeReset = [pulse(gateValue), pulse(gateValue)];
assert(beforeReset.join(',') === '2,3', `Sequencer did not reach the reset setup steps: ${beforeReset.join(',')}`);
pulse(resetValue);
const afterReset = pulse(gateValue);
assert(afterReset === 0, `Sequencer reset did not restart at step 0: ${afterReset}`);

const indexPatch = {
  nodes: [
    node('gate', 'Constant', { value: 0 }),
    node('seq', 'Sequencer', {
      steps: 2,
      rows: 3,
      'cell:0:0': 1,
      'cell:1:0': 1,
      'cell:2:1': 1,
    }),
    node('out', 'AudioOut', { level: 1 }),
  ],
  links: [
    link('gate', 'signal', 'seq', 'signal'),
    link('seq', 'trigger index', 'out', 'both'),
  ],
};
const indexDspProgram = compilePatchToDspProgram(indexPatch);
assert(indexDspProgram.errors.length === 0, `Index DSP compile failed: ${indexDspProgram.errors.join('; ')}`);
const indexGateValue = indexDspProgram.valueBindings.find((binding) => binding.id === 'gate.value')?.valueIndex;
assert(Number.isInteger(indexGateValue), 'Index gate value binding was not emitted.');

wasm.clearDspProgram();
wasm.resetDspRuntimeState();
for (let index = 0; index < indexDspProgram.values.length; index += 1) {
  wasm.setDspValue(index, indexDspProgram.values[index]);
}
for (const op of indexDspProgram.ops) {
  wasm.addDspOp(
    op.opcode ?? -1,
    op.out ?? -1,
    op.a ?? -1,
    op.b ?? -1,
    op.c ?? -1,
    op.d ?? -1,
    op.e ?? -1,
    op.state ?? -1,
    op.value ?? 0,
    op.value2 ?? 0,
    op.value3 ?? 0,
    op.value4 ?? 0,
  );
}

const indexRenderFrames = 1000;
const leftOutput = new Float32Array(wasm.memory.buffer, wasm.leftPtr(), indexRenderFrames);
function renderIndexFrames() {
  wasm.clear(indexRenderFrames);
  wasm.beginDspRenderQuantum();
  wasm.renderDspProgram(indexRenderFrames, 48000);
  return Math.max(...leftOutput);
}

function indexPulse() {
  wasm.setDspValue(indexGateValue, 1);
  const output = renderIndexFrames();
  wasm.setDspValue(indexGateValue, 0);
  assert(renderIndexFrames() === 0, 'Sequencer index should return to zero after its trigger pulse.');
  return output;
}

const indexOutputs = [indexPulse(), indexPulse()];
assert(
  indexOutputs.join(',') === '1,3',
  `Sequencer index should select the first triggered row: ${indexOutputs.join(',')}`,
);

console.log(`Sequencer probe passed: advance ${advanced.join(',')}; reset next step ${afterReset}; index ${indexOutputs.join(',')}`);

function node(id, type, params) {
  return { id, type, params };
}

function link(fromNode, fromPort, toNode, toPort) {
  return { from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
