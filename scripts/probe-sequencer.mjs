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

console.log(`Sequencer probe passed: advance ${advanced.join(',')}; reset next step ${afterReset}`);

function node(id, type, params) {
  return { id, type, params };
}

function link(fromNode, fromPort, toNode, toPort) {
  return { from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
