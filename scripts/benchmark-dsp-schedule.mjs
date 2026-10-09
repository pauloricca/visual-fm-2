// Offline compiler benchmark and graph-analysis checks; never starts the app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import ts from '../node_modules/typescript/lib/typescript.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'teia-schedule-'));
try {
  const program = ts.createProgram({
    rootNames: [path.join(root, 'editor/src/audio/dspProgram.ts')],
    options: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      rootDir: path.join(root, 'editor/src'), outDir: output,
      strict: true, skipLibCheck: true, esModuleInterop: true,
    },
  });
  const emitted = program.emit();
  const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnostics(errors, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const { compilePatchToDspProgram } = createRequire(import.meta.url)(path.join(output, 'audio/dspProgram.js'));
  const { analyzeDspSchedule } = createRequire(import.meta.url)(path.join(output, 'audio/dspSchedule.js'));
  checkCases(analyzeDspSchedule);
  const files = [
    'patches/dirty-saw/2026-10-07T13-01-07.047Z.json',
    'patches/karplus-strong/2026-08-25T15-28-53.635Z.json',
    'patches/beats-sequencer/2026-09-26T22-42-03.878Z.json',
  ];
  for (const file of files) {
    const patch = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const runs = 100;
    for (let i = 0; i < 10; i++) compilePatchToDspProgram(patch, { analyzeSchedule: true });
    const off = [];
    const on = [];
    for (let i = 0; i < runs; i++) {
      for (const [enabled, samples] of i % 2 ? [[true, on], [false, off]] : [[false, off], [true, on]]) {
        const start = performance.now();
        const compiled = compilePatchToDspProgram(patch, { analyzeSchedule: enabled });
        samples.push(performance.now() - start);
        assert.equal(compiled.errors.length, 0, compiled.errors.join('; '));
        assert.equal(compiled.schedule !== undefined, enabled);
      }
    }
    const normalProgram = compilePatchToDspProgram(patch);
    const analyzedProgram = compilePatchToDspProgram(patch, { analyzeSchedule: true });
    assert.deepEqual(analyzedProgram.ops, normalProgram.ops);
    assert.deepEqual(analyzedProgram.values, normalProgram.values);
    assert.deepEqual(analyzedProgram.stateBindings, normalProgram.stateBindings);
    const result = analyzedProgram.schedule;
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(`${patch.name ?? file}: ${result.operationCount} ops, ${result.regions.length} regions, ${result.regions.filter((region) => region.eligibility === 'block candidate').length} candidates; compile without report ${median(off).toFixed(3)} ms, with report ${median(on).toFixed(3)} ms (median, ${runs} runs each).`);
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

function checkCases(analyze) {
  const node = (id, type = 'Pass', extra = {}) => ({ id, type, params: {}, ...extra });
  const edge = (from, to) => ({ from: { node: from, port: 'signal' }, to: { node: to, port: 'signal' } });
  const report = (nodes, links, feedback = []) => analyze({ nodes, links }, [], feedback);
  const chain = report([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
  assert.equal(chain.regions.length, 3);
  assert.equal(chain.order.length, 3);
  const branch = report([node('a'), node('b'), node('c'), node('d')], [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]);
  assert.equal(branch.regions.length, 4);
  assert.equal(branch.dependencies.length, 4);
  const self = report([node('a')], [edge('a', 'a')], ['a.signal']);
  assert.equal(self.regions[0].cyclic, true);
  assert(self.regions[0].reasons.includes('lowered feedback history'));
  const cycles = report([node('a'), node('b'), node('c'), node('d')], [edge('a', 'b'), edge('b', 'a'), edge('c', 'd'), edge('d', 'c')]);
  assert.equal(cycles.regions.filter((region) => region.cyclic).length, 2);
  const routes = report([node('send', 'Send', { params: { number: 2 } }), node('receive', 'Receive', { params: { number: 2 } })], []);
  assert(routes.dependencies.some((dependency) => dependency.kind === 'send receive'));
  const resources = report([node('one', 'Buffer'), node('two', 'Buffer')], []);
  assert(resources.dependencies.some((dependency) => dependency.kind === 'resource order'));
  const repeats = report([node('a'), node('b', 'SineOsc', { runtimeSpread: { spreadId: 's', itemIndex: 0, originalNodeId: 'b' } })], [edge('a', 'b')]);
  assert(repeats.dependencies.some((dependency) => dependency.kind === 'repeat boundary'));
  const events = report([node('a', 'MidiCcSend'), node('b', 'MidiCcSend')], []);
  assert(events.dependencies.some((dependency) => dependency.kind === 'event order'));
  console.log('Graph cases passed: chain, fan-in, disconnected outputs, self-feedback, multiple cycles, Send/Receive, shared resource order, repeat boundary, event order.');
}
