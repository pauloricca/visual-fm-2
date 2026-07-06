import { expandGroups } from '../graph/subpatch';
import { getNodeDefinition } from '../graph/nodeTypes';
import type { LinkMode, NodeType, Patch, PatchLink, PatchNode } from '../graph/types';

export const DSP_OP = {
  Value: 0,
  Add: 1,
  Mul: 2,
  Osc: 3,
  Filter: 4,
  Output: 5,
  Abs: 6,
  Map: 7,
  FeedbackRead: 8,
  FeedbackWrite: 9,
} as const;

export interface DspProgram {
  version: 1;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  stateBindings: DspStateBinding[];
  registerCount: number;
  stateCount: number;
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  errors: string[];
}

export interface DspOp {
  opcode: number;
  out?: number;
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  state?: number;
  value?: number;
}

export interface DspValueBinding {
  id: string;
  valueIndex: number;
  kind: 'node-param' | 'link-weight' | 'constant';
  nodeId?: string;
  port?: string;
  linkId?: string;
}

export interface DspStateBinding {
  id: string;
  state: number;
  count: number;
  kind: 'oscillator' | 'filter' | 'feedback';
  nodeId: string;
}

interface FeedbackBinding {
  readRegister: number;
  state: number;
  writeEmitted: boolean;
}

interface CompileContext {
  patch: Patch;
  nodeById: Map<string, PatchNode>;
  incomingByInput: Map<string, PatchLink[]>;
  outputCache: Map<string, number>;
  visitingOutputs: Set<string>;
  feedbackByOutput: Map<string, FeedbackBinding>;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  stateBindings: DspStateBinding[];
  constantValueIndexes: Map<number, number>;
  errors: string[];
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  registerCount: number;
  stateCount: number;
}

const OSC_WAVES: Partial<Record<NodeType, number>> = {
  SineOsc: 0,
  TriangleOsc: 1,
  SawOsc: 2,
  RampOsc: 3,
  SquareOsc: 4,
};

const FILTER_TYPES: Partial<Record<NodeType, number>> = {
  LowpassFilter: 1,
  HighpassFilter: 2,
  BandpassFilter: 3,
};

export function compilePatchToDspProgram(patch: Patch): DspProgram {
  const expandedPatch = expandGroups(patch);
  const context = createContext(expandedPatch);
  const audioOutNodes = expandedPatch.nodes.filter((node) => node.type === 'AudioOut');

  if (audioOutNodes.length === 0) {
    context.errors.push('Patch needs an Audio Out node.');
  }

  for (const node of audioOutNodes) {
    compileAudioOut(node, context);
  }

  if (context.errors.length > 0) {
    return {
      version: 1,
      ops: [],
      values: context.values,
      valueBindings: context.valueBindings,
      stateBindings: context.stateBindings,
      registerCount: context.registerCount,
      stateCount: context.stateCount,
      feedbackLinkIds: context.feedbackLinkIds,
      monitorIds: context.monitorIds,
      errors: [...new Set(context.errors)],
    };
  }

  return {
    version: 1,
    ops: context.ops,
    values: context.values,
    valueBindings: context.valueBindings,
    stateBindings: context.stateBindings,
    registerCount: context.registerCount,
    stateCount: context.stateCount,
    feedbackLinkIds: context.feedbackLinkIds,
    monitorIds: context.monitorIds,
    errors: [],
  };
}

function createContext(patch: Patch): CompileContext {
  const incomingByInput = new Map<string, PatchLink[]>();
  for (const link of patch.links) {
    const key = inputKey(link.to.node, link.to.port);
    incomingByInput.set(key, [...(incomingByInput.get(key) ?? []), link]);
  }

  return {
    patch,
    nodeById: new Map(patch.nodes.map((node) => [node.id, node])),
    incomingByInput,
    outputCache: new Map(),
    visitingOutputs: new Set(),
    feedbackByOutput: new Map(),
    ops: [],
    values: [],
    valueBindings: [],
    stateBindings: [],
    constantValueIndexes: new Map(),
    errors: [],
    feedbackLinkIds: [],
    monitorIds: {},
    registerCount: 0,
    stateCount: 0,
  };
}

function compileAudioOut(node: PatchNode, context: CompileContext): void {
  const level = resolveInput(node, 'level', 0.75, context);

  for (const port of ['both', 'left', 'right'] as const) {
    const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
    if (links.length === 0) continue;

    const input = resolveInput(node, port, 0, context);
    const scaled = emitBinary(DSP_OP.Mul, input, level, context);
    if (port === 'both' || port === 'left') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 0 });
    }
    if (port === 'both' || port === 'right') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 1 });
    }
  }
}

function resolveInput(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  if (links.length === 0) return valueRegisterForNodeParam(node, port, fallback, context);

  const setRegisters: number[] = [];
  const addRegisters: number[] = [];
  const multiplyRegisters: number[] = [];

  for (const link of links) {
    const register = resolveLinkValue(link, context);
    if (register === null) continue;

    switch (link.mode ?? 'set') {
      case 'add':
        addRegisters.push(register);
        break;
      case 'multiply':
        multiplyRegisters.push(register);
        break;
      case 'set':
        setRegisters.push(register);
        break;
    }
  }

  let result = setRegisters.length > 0
    ? averageRegisters(setRegisters, context)
    : valueRegisterForNodeParam(node, port, fallback, context);

  for (const register of addRegisters) {
    result = emitBinary(DSP_OP.Add, result, register, context);
  }

  for (const register of multiplyRegisters) {
    result = emitBinary(DSP_OP.Mul, result, register, context);
  }

  return result;
}

function resolveLinkValue(link: PatchLink, context: CompileContext): number | null {
  const source = context.nodeById.get(link.from.node);
  if (!source) {
    context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    return null;
  }

  const sourceRegister = resolveOutput(source, link.from.port, context);
  if (sourceRegister === null) return null;

  const weightRegister = valueRegisterForLinkWeight(link, context);
  return emitBinary(DSP_OP.Mul, sourceRegister, weightRegister, context);
}

function resolveOutput(node: PatchNode, port: string, context: CompileContext): number | null {
  if (port !== 'signal' && port !== 'value') {
    context.errors.push(`Node "${node.id}" does not have supported output "${port}".`);
    return null;
  }

  const key = inputKey(node.id, port);
  const cached = context.outputCache.get(key);
  if (cached !== undefined) return cached;

  if (context.visitingOutputs.has(key)) {
    return feedbackRegisterForOutput(node, port, context);
  }

  context.visitingOutputs.add(key);
  const register = compileNodeOutput(node, context);
  context.visitingOutputs.delete(key);

  if (register !== null) {
    context.outputCache.set(key, register);
    emitFeedbackWriteIfNeeded(key, register, context);
  }
  return register;
}

function feedbackRegisterForOutput(node: PatchNode, port: string, context: CompileContext): number {
  const key = inputKey(node.id, port);
  const existing = context.feedbackByOutput.get(key);
  if (existing) return existing.readRegister;

  const state = nextState(context, 1);
  const readRegister = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.FeedbackRead, out: readRegister, state });
  context.feedbackByOutput.set(key, { readRegister, state, writeEmitted: false });
  context.feedbackLinkIds.push(key);
  context.stateBindings.push({
    id: `${key}:feedback`,
    state,
    count: 1,
    kind: 'feedback',
    nodeId: node.id,
  });
  return readRegister;
}

function emitFeedbackWriteIfNeeded(key: string, register: number, context: CompileContext): void {
  const feedback = context.feedbackByOutput.get(key);
  if (!feedback || feedback.writeEmitted) return;
  context.ops.push({ opcode: DSP_OP.FeedbackWrite, a: register, state: feedback.state });
  feedback.writeEmitted = true;
}

function compileNodeOutput(node: PatchNode, context: CompileContext): number | null {
  if (node.type === 'Constant') {
    return resolveInput(node, 'value', 1, context);
  }

  const wave = OSC_WAVES[node.type];
  if (wave !== undefined) {
    const frequency = resolveInput(node, 'frequency', 220, context);
    const level = resolveInput(node, 'level', 0.7, context);
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 1,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: wave, b: frequency, state });
    return emitBinary(DSP_OP.Mul, output, level, context);
  }

  if (node.type === 'Gain') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'gain', 1, context),
      context,
    );
  }

  if (node.type === 'Multiply') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'factor', 1, context),
      context,
    );
  }

  if (node.type === 'Abs') {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Abs, out: output, a: resolveInput(node, 'signal', 0, context) });
    return output;
  }

  if (node.type === 'Map') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Map,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'srcMin', 0, context),
      c: resolveInput(node, 'srcMax', 1, context),
      d: resolveInput(node, 'trgtMin', 0, context),
      e: resolveInput(node, 'trgtMax', 1, context),
    });
    return output;
  }

  const filterType = FILTER_TYPES[node.type];
  if (filterType !== undefined) {
    const output = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:filter`,
      state,
      count: 4,
      kind: 'filter',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: filterType,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'cutoff', 1200, context),
      d: resolveInput(node, 'resonance', 0.7, context),
      state,
    });
    return output;
  }

  if (node.type === 'Meter' || node.type === 'Scope') {
    const signal = resolveInput(node, 'signal', 0, context);
    context.monitorIds[node.id] = signal;
    return signal;
  }

  context.errors.push(`Node type "${node.type}" is not supported by the first DSP program slice.`);
  return null;
}

function averageRegisters(registers: number[], context: CompileContext): number {
  if (registers.length === 1) return registers[0];
  let sum = registers[0];
  for (const register of registers.slice(1)) {
    sum = emitBinary(DSP_OP.Add, sum, register, context);
  }
  return emitBinary(DSP_OP.Mul, sum, constantRegister(1 / registers.length, context), context);
}

function emitBinary(opcode: number, a: number, b: number, context: CompileContext): number {
  const out = nextRegister(context);
  context.ops.push({ opcode, out, a, b });
  return out;
}

function valueRegisterForNodeParam(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const definition = getNodeDefinition(node);
  const input = definition.inputs.find((candidate) => candidate.name === port);
  const value = finiteNumber(node.params[port], input?.defaultValue ?? fallback);
  return valueRegister(value, {
    id: `${node.id}.${port}`,
    kind: 'node-param',
    nodeId: node.id,
    port,
  }, context);
}

function valueRegisterForLinkWeight(link: PatchLink, context: CompileContext): number {
  const id = linkId(link);
  return valueRegister(finiteNumber(link.weight, 1), {
    id: `${id}.weight`,
    kind: 'link-weight',
    linkId: id,
  }, context);
}

function constantRegister(value: number, context: CompileContext): number {
  const normalized = finiteNumber(value, 0);
  const existingIndex = context.constantValueIndexes.get(normalized);
  if (existingIndex !== undefined) return emitValue(existingIndex, context);

  const valueIndex = context.values.length;
  context.constantValueIndexes.set(normalized, valueIndex);
  context.values.push(normalized);
  context.valueBindings.push({
    id: `constant.${normalized}`,
    valueIndex,
    kind: 'constant',
  });
  return emitValue(valueIndex, context);
}

function valueRegister(
  value: number,
  binding: Omit<DspValueBinding, 'valueIndex'>,
  context: CompileContext,
): number {
  const valueIndex = context.values.length;
  context.values.push(value);
  context.valueBindings.push({ ...binding, valueIndex });
  return emitValue(valueIndex, context);
}

function emitValue(valueIndex: number, context: CompileContext): number {
  const out = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.Value, out, a: valueIndex });
  return out;
}

function nextRegister(context: CompileContext): number {
  const register = context.registerCount;
  context.registerCount += 1;
  return register;
}

function nextState(context: CompileContext, count: number): number {
  const state = context.stateCount;
  context.stateCount += count;
  return state;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inputKey(nodeId: string, port: string): string {
  return `${nodeId}.${port}`;
}

function linkId(link: PatchLink): string {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}
