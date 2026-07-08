import { expandGroups } from '../graph/subpatch';
import { normalizeCustomWave } from '../graph/customWave';
import { migratePatchForCompatibility } from '../graph/migrations';
import { getNodeDefinition } from '../graph/nodeTypes';
import type { CustomWaveSettings, LinkMode, NodeType, Patch, PatchLink, PatchNode } from '../graph/types';

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
  Select: 10,
  Input: 11,
  Delay: 12,
  Chorus: 13,
  Reverb: 14,
  Fold: 15,
  Sub: 16,
  Div: 17,
  Neg: 18,
  Envelope: 19,
  Follower: 20,
  HardClip: 21,
  SoftClip: 22,
  Distortion: 23,
  Sample: 24,
  SampleParam: 25,
  Function: 26,
  MidiNote: 27,
  MidiCc: 28,
  Accumulator: 29,
  Button: 30,
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
  sampleBindings: DspSampleBinding[];
  customWaveBindings: DspCustomWaveBinding[];
  maxVoices: number;
  usesMidiNote: boolean;
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
  kind: 'oscillator' | 'filter' | 'feedback' | 'selector' | 'effect';
  nodeId: string;
}

export interface DspSampleBinding {
  nodeId: string;
  sample: {
    name: string;
    url: string;
  };
}

export interface DspCustomWaveBinding {
  nodeId: string;
  customWave: CustomWaveSettings;
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
  sampleBindings: DspSampleBinding[];
  customWaveBindings: DspCustomWaveBinding[];
  usesMidiNote: boolean;
  maxVoices: number;
  registerCount: number;
  stateCount: number;
}

const OSC_WAVES: Partial<Record<NodeType, number>> = {
  SineOsc: 0,
  TriangleOsc: 1,
  SawOsc: 2,
  RampOsc: 3,
  SquareOsc: 4,
  SampleHoldOsc: 5,
};

const FILTER_TYPES: Partial<Record<NodeType, number>> = {
  LowpassFilter: 1,
  HighpassFilter: 2,
  BandpassFilter: 3,
};

const DISTORTION_TYPES: Partial<Record<NodeType, number>> = {
  HardClipDistortion: 1,
  SoftClipDistortion: 2,
  FuzzDistortion: 3,
  SaturateDistortion: 4,
  WavefoldDistortion: 5,
};

const EXPRESSION_FUNCTIONS: Record<string, { id: number; minArgs: number; maxArgs: number }> = {
  abs: { id: 1, minArgs: 1, maxArgs: 1 },
  sin: { id: 2, minArgs: 1, maxArgs: 1 },
  cos: { id: 3, minArgs: 1, maxArgs: 1 },
  tan: { id: 4, minArgs: 1, maxArgs: 1 },
  tanh: { id: 5, minArgs: 1, maxArgs: 1 },
  min: { id: 6, minArgs: 2, maxArgs: 2 },
  max: { id: 7, minArgs: 2, maxArgs: 2 },
  clamp: { id: 8, minArgs: 3, maxArgs: 3 },
  pow: { id: 9, minArgs: 2, maxArgs: 2 },
  exp: { id: 10, minArgs: 1, maxArgs: 1 },
  log: { id: 11, minArgs: 1, maxArgs: 1 },
  sqrt: { id: 12, minArgs: 1, maxArgs: 1 },
  floor: { id: 13, minArgs: 1, maxArgs: 1 },
  ceil: { id: 14, minArgs: 1, maxArgs: 1 },
  round: { id: 15, minArgs: 1, maxArgs: 1 },
  sign: { id: 16, minArgs: 1, maxArgs: 1 },
  fract: { id: 17, minArgs: 1, maxArgs: 1 },
  mix: { id: 18, minArgs: 3, maxArgs: 3 },
};

export function compilePatchToDspProgram(patch: Patch): DspProgram {
  const expandedPatch = expandGroups(migratePatchForCompatibility(patch));
  const context = createContext(expandedPatch);
  const audioOutNodes = expandedPatch.nodes.filter((node) => node.type === 'AudioOut');
  const monitorNodes = expandedPatch.nodes.filter((node) => node.type === 'Meter' || node.type === 'Scope');

  validatePatchLinks(context);

  if (audioOutNodes.length === 0 && monitorNodes.length === 0) {
    context.errors.push('Patch needs an Audio Out node.');
  }

  for (const node of audioOutNodes) {
    compileAudioOut(node, context);
  }

  for (const node of monitorNodes) {
    resolveOutput(node, 'signal', context);
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
      sampleBindings: context.sampleBindings,
      customWaveBindings: context.customWaveBindings,
      maxVoices: context.maxVoices,
      usesMidiNote: context.usesMidiNote,
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
    sampleBindings: context.sampleBindings,
    customWaveBindings: context.customWaveBindings,
    maxVoices: context.maxVoices,
    usesMidiNote: context.usesMidiNote,
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
    sampleBindings: [],
    customWaveBindings: [],
    usesMidiNote: false,
    maxVoices: 1,
    registerCount: 0,
    stateCount: 0,
  };
}

function compileAudioOut(node: PatchNode, context: CompileContext): void {
  const level = resolveInput(node, 'level', 0.75, context);
  let outputLinkCount = 0;

  for (const port of ['both', 'left', 'right'] as const) {
    const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
    if (links.length === 0) continue;

    outputLinkCount += links.length;
    const input = resolveInput(node, port, 0, context);
    const scaled = emitBinary(DSP_OP.Mul, input, level, context);
    if (port === 'both' || port === 'left') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 0 });
    }
    if (port === 'both' || port === 'right') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 1 });
    }
  }

  if (outputLinkCount === 0) {
    context.errors.push(`Audio Out node "${node.id}" has no connected audio signal.`);
  }
}

function validatePatchLinks(context: CompileContext): void {
  for (const link of context.patch.links) {
    const source = context.nodeById.get(link.from.node);
    const target = context.nodeById.get(link.to.node);

    if (!source) {
      context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    } else if (!portExists(getNodeDefinition(source), 'outputs', link.from.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid output port "${link.from.port}" on node "${link.from.node}".`);
    }

    if (!target) {
      context.errors.push(`Link target node "${link.to.node}" does not exist.`);
    } else if (!portExists(getNodeDefinition(target), 'inputs', link.to.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid input port "${link.to.port}" on node "${link.to.node}".`);
    }
  }
}

function portExists(definition: ReturnType<typeof getNodeDefinition>, side: 'inputs' | 'outputs', port: string): boolean {
  return definition[side].some((entry) => entry.name === port);
}

function formatLink(link: PatchLink): string {
  return `${link.from.node}:${link.from.port} -> ${link.to.node}:${link.to.port}`;
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

function hasInput(node: PatchNode, port: string, context: CompileContext): boolean {
  return (context.incomingByInput.get(inputKey(node.id, port)) ?? []).length > 0;
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
  if (!getNodeDefinition(node).outputs.some((output) => output.name === port)) {
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
  const register = compileNodeOutput(node, port, context);
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

function compileNodeOutput(node: PatchNode, port: string, context: CompileContext): number | null {
  if (node.type === 'Constant') {
    return resolveInput(node, 'value', 1, context);
  }

  if (node.type === 'Slider') {
    const unitValue = resolveInput(node, 'value', 0.5, context);
    if (hasInput(node, 'signal', context)) {
      return emitBinary(DSP_OP.Mul, resolveInput(node, 'signal', 0, context), unitValue, context);
    }
    const min = resolveInput(node, 'min', 0, context);
    const max = resolveInput(node, 'max', 1, context);
    return emitBinary(DSP_OP.Add, min, emitBinary(DSP_OP.Mul, unitValue, emitBinary(DSP_OP.Sub, max, min, context), context), context);
  }

  if (node.type === 'Button') {
    const output = nextRegister(context);
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:button`,
      state,
      count: 3,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Button,
      out: output,
      a: valueIndexForNodeParam(node, 'pressed', 0, context),
      b: valueIndexForNodeParam(node, 'mode', 0, context),
      c: valueIndexForNodeParam(node, 'clicks', 0, context),
      state,
    });
    return output;
  }

  if (node.type === 'Expression') {
    return compileExpression(node, context);
  }

  if (node.type === 'MidiNote') {
    context.usesMidiNote = true;
    context.maxVoices = Math.max(context.maxVoices, clampInteger(node.params.voices ?? 8, 1, 16));
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.MidiNote,
      out: output,
      a: midiNoteOutputKind(port),
    });
    return output;
  }

  if (node.type === 'MidiCc') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.MidiCc,
      out: output,
      a: resolveInput(node, 'cc', 1, context),
    });
    return output;
  }

  if (node.type === 'Noise') {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: 6, b: constantRegister(0, context) });
    return output;
  }

  const wave = OSC_WAVES[node.type];
  if (wave !== undefined) {
    const frequency = wave === 5 ? constantRegister(0, context) : resolveInput(node, 'frequency', 220, context);
    const output = nextRegister(context);
    const stateCount = wave === 5 ? 3 : 2;
    const state = nextState(context, stateCount);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: stateCount,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: wave,
      b: frequency,
      c: hasInput(node, 'signal', context) ? resolveInput(node, 'signal', 0, context) : -1,
      d: wave === 5 ? resolveInput(node, 'trigger', 0, context) : resolveInput(node, 'phase', 0, context),
      e: wave === 5 ? -1 : resolveInput(node, 'phaseReset', 0, context),
      state,
    });
    return output;
  }

  if (node.type === 'CustomWave') {
    const customWaveIndex = context.customWaveBindings.length;
    context.customWaveBindings.push({
      nodeId: node.id,
      customWave: normalizeCustomWave(node.customWave, node.params),
    });
    const frequency = resolveInput(node, 'frequency', 220, context);
    const output = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 4,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: 9,
      b: frequency,
      d: resolveInput(node, 'phase', 0, context),
      e: resolveInput(node, 'phaseReset', 0, context),
      state,
      value: customWaveIndex,
    });
    return output;
  }

  if (node.type === 'PerlinNoise') {
    const speed = resolveInput(node, 'speed', 8, context);
    const output = nextRegister(context);
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 3,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: 7, b: speed, state });
    return output;
  }

  if (node.type === 'AudioInput') {
    const output = nextRegister(context);
    const gain = Math.round(node.params.muted ?? 0) === 1
      ? 0
      : resolveInput(node, 'gain', 1, context);
    context.ops.push({
      opcode: DSP_OP.Input,
      out: output,
      a: gain,
    });
    return emitBinary(DSP_OP.Mul, output, resolveInput(node, 'level', 0.7, context), context);
  }

  if (node.type === 'SamplePlayer') {
    return compileSamplePlayer(node, context);
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

  if (node.type === 'RingMod' || node.type === 'Mix') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'amount', node.type === 'Mix' ? 0.5 : 1, context),
      context,
    );
  }

  if (node.type === 'Fold') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Fold,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'amount', 1, context),
    });
    return output;
  }

  if (node.type === 'Envelope') {
    const envelope = nextRegister(context);
    const state = nextState(context, 5);
    context.stateBindings.push({
      id: `${node.id}:envelope`,
      state,
      count: 5,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Envelope,
      out: envelope,
      a: resolveInput(node, 'trigger', 0, context),
      b: resolveInput(node, 'delay', 0, context),
      c: resolveInput(node, 'attack', 0.01, context),
      d: resolveInput(node, 'decay', 0.16, context),
      e: resolveInput(node, 'sustain', 0.72, context),
      state,
      value: resolveInput(node, 'release', 0.24, context),
    });
    return emitBinary(DSP_OP.Mul, resolveInput(node, 'signal', 0, context), envelope, context);
  }

  if (node.type === 'Follower') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:follower`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Follower,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'attack', 0.01, context),
      c: resolveInput(node, 'release', 0.12, context),
      state,
    });
    return output;
  }

  if (node.type === 'Distortion') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Distortion,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'drive', 2.5, context),
      c: resolveInput(node, 'type', 2, context),
    });
    return output;
  }

  const distortionType = DISTORTION_TYPES[node.type];
  if (distortionType !== undefined) {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Distortion,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'drive', 2.5, context),
      c: constantRegister(distortionType, context),
    });
    return output;
  }

  if (node.type === 'Delay') {
    return compileEffect(node, DSP_OP.Delay, [
      ['time', 0.28],
      ['feedback', 0.35],
      ['mix', 0.25],
    ], context);
  }

  if (node.type === 'Chorus') {
    return compileEffect(node, DSP_OP.Chorus, [
      ['rate', 0.8],
      ['depth', 0.012],
      ['mix', 0.25],
    ], context);
  }

  if (node.type === 'Reverb') {
    return compileEffect(node, DSP_OP.Reverb, [
      ['size', 0.55],
      ['decay', 0.45],
      ['mix', 0.25],
    ], context);
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

  if (node.type === 'Clamp') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Function,
      out: output,
      a: EXPRESSION_FUNCTIONS.clamp.id,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'min', 0, context),
      d: resolveInput(node, 'max', 1, context),
      value: 3,
    });
    return output;
  }

  if (node.type === 'Selector') {
    return compileSelector(node, context);
  }

  if (node.type === 'Accumulator') {
    const output = nextRegister(context);
    const state = nextState(context, 2);
    context.stateBindings.push({
      id: `${node.id}:accumulator`,
      state,
      count: 2,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Accumulator,
      out: output,
      a: resolveInput(node, 'trigger', 0, context),
      b: resolveInput(node, 'min', 0, context),
      c: resolveInput(node, 'max', 1, context),
      state,
    });
    return output;
  }

  if (node.type === 'FormantFilter') {
    const output = nextRegister(context);
    const state = nextState(context, 12);
    context.stateBindings.push({
      id: `${node.id}:filter`,
      state,
      count: 12,
      kind: 'filter',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: 4,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'morph', 0, context),
      d: resolveInput(node, 'intensity', 8, context),
      state,
    });
    return output;
  }

  if (node.type === 'CombFilter' || node.type === 'CombNotchFilter') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:comb`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: node.type === 'CombFilter' ? 5 : 6,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'frequency', 440, context),
      d: resolveInput(node, 'feedback', 0.45, context),
      state,
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

function compileSamplePlayer(node: PatchNode, context: CompileContext): number {
  const sampleIndex = context.sampleBindings.length;
  context.sampleBindings.push({
    nodeId: node.id,
    sample: {
      name: node.sample?.name ?? '',
      url: node.sample?.url ?? '',
    },
  });

  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:sample`,
    state,
    count: 1,
    kind: 'effect',
    nodeId: node.id,
  });

  const sampleParams: Array<[kind: number, port: string, fallback: number]> = [
    [1, 'start', 0],
    [2, 'end', 1],
    [3, 'stretch', 1],
    [4, 'cycleLength', 4096],
    [5, 'overlapRatio', 0.09],
    [6, 'originalPitch', 60],
  ];
  for (const [kind, port, fallback] of sampleParams) {
    context.ops.push({
      opcode: DSP_OP.SampleParam,
      a: sampleIndex,
      b: kind,
      c: resolveInput(node, port, fallback, context),
    });
  }

  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Sample,
    out: output,
    a: sampleIndex,
    b: resolveInput(node, 'frequency', 220, context),
    c: resolveInput(node, 'trigger', 0, context),
    state,
  });
  return emitBinary(DSP_OP.Mul, output, resolveInput(node, 'level', 0.7, context), context);
}

function compileSelector(node: PatchNode, context: CompileContext): number {
  const definition = getNodeDefinition(node);
  const valueInputs = definition.inputs
    .filter((input) => /^(0|[1-9][0-9]*)$/.test(input.name))
    .sort((left, right) => Number(left.name) - Number(right.name));
  if (valueInputs.length === 0) return constantRegister(0, context);

  const select = resolveInput(node, 'select', 0, context);
  const slide = resolveInput(node, 'slide', 0, context);
  const output = nextRegister(context);
  const state = nextState(context, 4);
  const maxInputIndex = Math.max(...valueInputs.map((input) => Number(input.name)));
  context.stateBindings.push({
    id: `${node.id}:selector`,
    state,
    count: 4,
    kind: 'selector',
    nodeId: node.id,
  });

  valueInputs.forEach((input) => {
    context.ops.push({
      opcode: DSP_OP.Select,
      out: output,
      a: select,
      b: slide,
      c: resolveInput(node, input.name, input.defaultValue ?? 0, context),
      d: Number(input.name),
      e: maxInputIndex,
      state,
    });
  });
  return output;
}

function midiNoteOutputKind(port: string): number {
  switch (port) {
    case 'note':
      return 0;
    case 'frequency':
      return 1;
    case 'velocity':
      return 2;
    case 'gate':
      return 3;
    case 'trigger':
      return 4;
    default:
      return 0;
  }
}

function compileEffect(
  node: PatchNode,
  opcode: number,
  params: Array<[port: string, fallback: number]>,
  context: CompileContext,
): number {
  const output = nextRegister(context);
  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:effect`,
    state,
    count: 1,
    kind: 'effect',
    nodeId: node.id,
  });
  context.ops.push({
    opcode,
    out: output,
    a: resolveInput(node, 'signal', 0, context),
    b: resolveInput(node, params[0]?.[0] ?? 'unused', params[0]?.[1] ?? 0, context),
    c: resolveInput(node, params[1]?.[0] ?? 'unused', params[1]?.[1] ?? 0, context),
    d: resolveInput(node, params[2]?.[0] ?? 'unused', params[2]?.[1] ?? 0, context),
    state,
  });
  return output;
}

type ExpressionToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

function compileExpression(node: PatchNode, context: CompileContext): number {
  const source = typeof node.expression === 'string' && node.expression.trim()
    ? node.expression
    : '0';
  const parser = new ExpressionParser(tokenizeExpression(source), node, context);
  return parser.parse();
}

class ExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: ExpressionToken[],
    private readonly node: PatchNode,
    private readonly context: CompileContext,
  ) {}

  parse(): number {
    const register = this.parseAdditive();
    if (!this.isAtEnd()) {
      this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
      return constantRegister(0, this.context);
    }
    return register;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      left = emitBinary(operator === '+' ? DSP_OP.Add : DSP_OP.Sub, left, right, this.context);
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseUnary();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = emitBinary(operator === '*' ? DSP_OP.Mul : DSP_OP.Div, left, right, this.context);
    }
    return left;
  }

  private parseUnary(): number {
    if (this.matchOperator('-')) {
      const output = nextRegister(this.context);
      this.context.ops.push({ opcode: DSP_OP.Neg, out: output, a: this.parseUnary() });
      return output;
    }
    if (this.matchOperator('+')) {
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    if (this.match('number')) {
      const token = this.previous();
      return constantRegister(token.type === 'number' ? token.value : 0, this.context);
    }
    if (this.match('identifier')) {
      const token = this.previous();
      const name = token.type === 'identifier' ? token.value : '';
      if (this.matchOperator('(')) {
        return this.parseFunctionCall(name);
      }
      return resolveInput(this.node, name, 0, this.context);
    }
    if (this.matchOperator('(')) {
      const register = this.parseAdditive();
      if (!this.matchOperator(')')) {
        this.context.errors.push(`Expression node "${this.node.id}" is missing a closing parenthesis.`);
        return constantRegister(0, this.context);
      }
      return register;
    }

    this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
    this.advance();
    return constantRegister(0, this.context);
  }

  private parseFunctionCall(name: string): number {
    const args: number[] = [];
    if (!this.matchOperator(')')) {
      do {
        args.push(this.parseAdditive());
        if (this.matchOperator(')')) break;
        if (!this.matchOperator(',')) {
          this.context.errors.push(`Expression node "${this.node.id}" is missing a comma or closing parenthesis in "${name}(...)"`);
          return constantRegister(0, this.context);
        }
      } while (!this.isAtEnd());
    }

    const definition = EXPRESSION_FUNCTIONS[name.toLowerCase()];
    if (!definition) {
      this.context.errors.push(`Expression node "${this.node.id}" uses unsupported function "${name}".`);
      return constantRegister(0, this.context);
    }
    if (args.length < definition.minArgs || args.length > definition.maxArgs) {
      this.context.errors.push(`Expression function "${name}" expects ${arityLabel(definition.minArgs, definition.maxArgs)}.`);
      return constantRegister(0, this.context);
    }

    const paddedArgs = [...args];
    while (paddedArgs.length < 3) paddedArgs.push(constantRegister(0, this.context));
    const output = nextRegister(this.context);
    this.context.ops.push({
      opcode: DSP_OP.Function,
      out: output,
      a: definition.id,
      b: paddedArgs[0],
      c: paddedArgs[1],
      d: paddedArgs[2],
      value: args.length,
    });
    return output;
  }

  private match(type: ExpressionToken['type']): boolean {
    if (this.isAtEnd() || this.peek().type !== type) return false;
    this.advance();
    return true;
  }

  private matchOperator(value: Extract<ExpressionToken, { type: 'operator' }>['value']): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type !== 'operator' || token.value !== value) return false;
    this.advance();
    return true;
  }

  private advance(): ExpressionToken {
    if (!this.isAtEnd()) this.index += 1;
    return this.previous();
  }

  private previous(): ExpressionToken {
    return this.tokens[Math.max(0, this.index - 1)] ?? { type: 'number', value: 0 };
  }

  private peek(): ExpressionToken {
    return this.tokens[this.index] ?? { type: 'number', value: 0 };
  }

  private peekLabel(): string {
    const token = this.tokens[this.index];
    return token ? String(token.value) : 'end of expression';
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }
}

function tokenizeExpression(source: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[+\-*/(),]/.test(char)) {
      tokens.push({ type: 'operator', value: char as Extract<ExpressionToken, { type: 'operator' }>['value'] });
      index += 1;
      continue;
    }

    const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (numberMatch) {
      tokens.push({ type: 'number', value: finiteNumber(Number(numberMatch[0]), 0) });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      tokens.push({ type: 'identifier', value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }

    tokens.push({ type: 'operator', value: '+' });
    index += 1;
  }

  return tokens;
}

function arityLabel(minArgs: number, maxArgs: number): string {
  if (minArgs === maxArgs) return `${minArgs} argument${minArgs === 1 ? '' : 's'}`;
  return `${minArgs}-${maxArgs} arguments`;
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
  return emitValue(valueIndexForNodeParam(node, port, fallback, context), context);
}

function valueIndexForNodeParam(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const definition = getNodeDefinition(node);
  const input = definition.inputs.find((candidate) => candidate.name === port);
  const value = finiteNumber(node.params[port], input?.defaultValue ?? fallback);
  return valueIndex(value, {
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
  return emitValue(valueIndex(value, binding, context), context);
}

function valueIndex(
  value: number,
  binding: Omit<DspValueBinding, 'valueIndex'>,
  context: CompileContext,
): number {
  const valueIndex = context.values.length;
  context.values.push(value);
  context.valueBindings.push({ ...binding, valueIndex });
  return valueIndex;
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

function clampInteger(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function inputKey(nodeId: string, port: string): string {
  return `${nodeId}.${port}`;
}

function linkId(link: PatchLink): string {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}
