import { expandGroups } from '../graph/subpatch';
import { expandSpreads } from '../graph/spread';
import { customWaveWithBaseLevel, normalizeCustomWave } from '../graph/customWave';
import {
  SEQUENCER_DEFAULT_ROWS,
  SEQUENCER_DEFAULT_STEPS,
  SEQUENCER_INDEX_OUTPUT,
  getNodeDefinition,
  sequencerGatesForRow,
  sequencerOutputIndex,
  sequencerPatternValue,
  sequencerShape,
  sequencerStepVelocity,
  sequencerTriggerPositionParamName,
  sequencerTriggersForRow,
  sequencerUsesGateMode,
} from '../graph/nodeTypes';
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
  Slew: 31,
  Tempo: 32,
  Playhead: 33,
  Buffer: 34,
  Sequencer: 35,
  Image: 36,
  Time: 37,
  Compress: 38,
  Limiter: 39,
  Quantise: 40,
  BlockLatch: 41,
  SpreadBegin: 42,
  SpreadIndex: 43,
  SpreadCollect: 44,
  SpreadEnd: 45,
} as const;

export interface DspProgram {
  version: 1;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  midiControlBindings: DspMidiControlBinding[];
  tempoBindings: DspTempoBinding[];
  stateBindings: DspStateBinding[];
  registerCount: number;
  stateCount: number;
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  signedMeterIds: string[];
  sampleBindings: DspSampleBinding[];
  imageBindings: DspImageBinding[];
  customWaveBindings: DspCustomWaveBinding[];
  fftBindings: DspFftBinding[];
  maxVoices: number;
  usesMidiNote: boolean;
  usesMidiClock: boolean;
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
  value2?: number;
  value3?: number;
  value4?: number;
}

export interface DspValueBinding {
  id: string;
  valueIndex: number;
  kind: 'node-param' | 'link-weight' | 'constant' | 'analyser-output';
  nodeId?: string;
  port?: string;
  linkId?: string;
}

export interface DspStateBinding {
  id: string;
  state: number;
  count: number;
  kind: 'oscillator' | 'filter' | 'feedback' | 'selector' | 'effect' | 'sequencer' | 'spread';
  nodeId: string;
}

export interface DspMidiControlBinding {
  nodeId: string;
  kind: 'slider' | 'button';
  channel: number;
  cc: number;
  valueIndex: number;
  modeValueIndex?: number;
  clicksValueIndex?: number;
}

export interface DspTempoBinding {
  nodeId: string;
  sourceValueIndex: number;
  midiSourceValueIndex: number;
}

export interface DspSampleBinding {
  nodeId: string;
  sample: {
    name: string;
    url: string;
  };
  release: number;
}

export interface DspCustomWaveBinding {
  nodeId: string;
  customWave: CustomWaveSettings;
}

export interface DspFftBinding {
  nodeId: string;
  inputRegister: number;
  minFrequencyValueIndex: number;
  maxFrequencyValueIndex: number;
  frequencyValueIndex: number;
  amplitudeValueIndex: number;
}

export interface DspImageBinding {
  nodeId: string;
  image: { name: string; url: string };
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
  sliderUnitValueByNodeId: Map<string, number>;
  visitingOutputs: Set<string>;
  feedbackByOutput: Map<string, FeedbackBinding>;
  sequencerStateByNodeId: Map<string, number>;
  sequencerStepRegisterByNodeId: Map<string, number>;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  midiControlBindings: DspMidiControlBinding[];
  tempoBindings: DspTempoBinding[];
  stateBindings: DspStateBinding[];
  constantValueIndexes: Map<number, number>;
  errors: string[];
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  signedMeterIds: string[];
  sampleBindings: DspSampleBinding[];
  imageBindings: DspImageBinding[];
  imageBindingIndexByNodeId: Map<string, number>;
  customWaveBindings: DspCustomWaveBinding[];
  fftBindings: DspFftBinding[];
  fftBindingByNodeId: Map<string, DspFftBinding>;
  spreadCountRegisterById: Map<string, number>;
  spreadBoundaryRegisterByLink: Map<PatchLink, number>;
  usesMidiNote: boolean;
  usesMidiClock: boolean;
  maxVoices: number;
  registerCount: number;
  stateCount: number;
}

const BUTTON_GATE_FADE_SECONDS = 0.008;
const MAX_DSP_OPS = 4096;
const MAX_DSP_REGISTERS = 2048;
const MAX_DSP_VALUES = 2048;
const MAX_DSP_STATE = 4096;

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
  const spreadExpansion = expandSpreads(patch);
  const expandedPatch = expandGroups(spreadExpansion.patch);
  const context = createContext(expandedPatch);
  context.errors.push(...spreadExpansion.errors);
  const ordinaryNodes = expandedPatch.nodes.filter((node) => !node.runtimeSpread);
  const audioOutNodes = ordinaryNodes.filter((node) => node.type === 'AudioOut');
  const monitorNodes = ordinaryNodes.filter((node) => node.type === 'Meter' || node.type === 'Scope' || node.type === 'FFT');
  const sliderMonitorNodes = ordinaryNodes.filter((node) => node.type === 'Slider');
  const sequencerMonitorNodes = ordinaryNodes.filter((node) => node.type === 'Sequencer');
  const imagePreviewNodes = ordinaryNodes.filter((node) => node.type === 'Image');
  const samplePreviewNodes = ordinaryNodes.filter((node) => node.type === 'SamplePlayer');

  validatePatchLinks(context);
  compileSpreadTemplates(context);

  if (audioOutNodes.length === 0 && monitorNodes.length === 0 && sequencerMonitorNodes.length === 0 && imagePreviewNodes.length === 0) {
    context.errors.push('Patch needs an Audio Out node.');
  }

  for (const node of audioOutNodes) {
    compileAudioOut(node, context);
  }

  for (const node of monitorNodes) {
    if (node.type === 'FFT') {
      ensureFftBinding(node, context);
    } else {
      resolveOutput(node, 'signal', context);
    }
  }

  for (const node of sliderMonitorNodes) {
    registerSliderMonitor(node, context);
  }

  for (const node of sequencerMonitorNodes) {
    registerSequencerMonitor(node, context);
  }

  // The image preview needs the actual signals arriving at its coordinate
  // inputs, even when no image output is otherwise connected to a monitor.
  // Expose those registers through the existing control-meter channel.
  for (const node of imagePreviewNodes) {
    context.monitorIds[`${node.id}:image-x`] = resolveInput(node, 'x', 0.5, context);
    context.monitorIds[`${node.id}:image-y`] = resolveInput(node, 'y', 0.5, context);
  }

  // Compile sample players even when their audio output is not routed yet so
  // linked region and envelope controls can still drive the node preview.
  for (const node of samplePreviewNodes) {
    resolveOutput(node, 'signal', context);
  }

  if (context.ops.length > MAX_DSP_OPS) {
    context.errors.push(`DSP program needs ${context.ops.length} operations; the engine limit is ${MAX_DSP_OPS}. Reduce the nodes inside Spreads.`);
  }
  if (context.registerCount > MAX_DSP_REGISTERS) {
    context.errors.push(`DSP program needs ${context.registerCount} registers; the engine limit is ${MAX_DSP_REGISTERS}. Reduce the nodes inside Spreads.`);
  }
  if (context.values.length > MAX_DSP_VALUES) {
    context.errors.push(`DSP program needs ${context.values.length} values; the engine limit is ${MAX_DSP_VALUES}. Reduce the nodes inside Spreads.`);
  }
  if (context.stateCount > MAX_DSP_STATE) {
    context.errors.push(`DSP program needs ${context.stateCount} state slots; the engine limit is ${MAX_DSP_STATE}. Reduce the nodes inside Spreads.`);
  }

  if (context.errors.length > 0) {
    return {
      version: 1,
      ops: [],
      values: context.values,
      valueBindings: context.valueBindings,
      midiControlBindings: context.midiControlBindings,
      tempoBindings: context.tempoBindings,
      stateBindings: context.stateBindings,
      registerCount: context.registerCount,
      stateCount: context.stateCount,
      feedbackLinkIds: context.feedbackLinkIds,
      monitorIds: context.monitorIds,
      signedMeterIds: context.signedMeterIds,
      sampleBindings: context.sampleBindings,
      imageBindings: context.imageBindings,
      customWaveBindings: context.customWaveBindings,
      fftBindings: context.fftBindings,
      maxVoices: context.maxVoices,
      usesMidiNote: context.usesMidiNote,
      usesMidiClock: context.usesMidiClock,
      errors: [...new Set(context.errors)],
    };
  }

  return {
    version: 1,
    ops: context.ops,
    values: context.values,
    valueBindings: context.valueBindings,
    midiControlBindings: context.midiControlBindings,
    tempoBindings: context.tempoBindings,
    stateBindings: context.stateBindings,
    registerCount: context.registerCount,
    stateCount: context.stateCount,
    feedbackLinkIds: context.feedbackLinkIds,
    monitorIds: context.monitorIds,
    signedMeterIds: context.signedMeterIds,
    sampleBindings: context.sampleBindings,
    imageBindings: context.imageBindings,
    customWaveBindings: context.customWaveBindings,
    fftBindings: context.fftBindings,
    maxVoices: context.maxVoices,
    usesMidiNote: context.usesMidiNote,
    usesMidiClock: context.usesMidiClock,
    errors: [],
  };
}

function createContext(patch: Patch): CompileContext {
  const nodeById = new Map(patch.nodes.map((node) => [node.id, node]));
  const incomingByInput = new Map<string, PatchLink[]>();
  for (const link of patch.links) {
    if (link.enabled === false) continue;
    const target = nodeById.get(link.to.node);
    const targetPort = target?.type === 'Sequencer' && link.to.port === 'tick'
      ? 'signal'
      : link.to.port;
    const key = inputKey(link.to.node, targetPort);
    incomingByInput.set(key, [...(incomingByInput.get(key) ?? []), link]);
  }

  return {
    patch,
    nodeById,
    incomingByInput,
    outputCache: new Map(),
    sliderUnitValueByNodeId: new Map(),
    visitingOutputs: new Set(),
    feedbackByOutput: new Map(),
    sequencerStateByNodeId: new Map(),
    sequencerStepRegisterByNodeId: new Map(),
    ops: [],
    values: [],
    valueBindings: [],
    midiControlBindings: [],
    tempoBindings: [],
    stateBindings: [],
    constantValueIndexes: new Map(),
    errors: [],
    feedbackLinkIds: [],
    monitorIds: {},
    signedMeterIds: [],
    sampleBindings: [],
    imageBindings: [],
    imageBindingIndexByNodeId: new Map(),
    customWaveBindings: [],
    fftBindings: [],
    fftBindingByNodeId: new Map(),
    spreadCountRegisterById: new Map(),
    spreadBoundaryRegisterByLink: new Map(),
    usesMidiNote: false,
    usesMidiClock: false,
    maxVoices: 1,
    registerCount: 0,
    stateCount: 0,
  };
}

function compileSpreadTemplates(context: CompileContext): void {
  const spreads = context.patch.nodes.filter((node) => node.type === 'Spread');

  for (let spreadSlot = 0; spreadSlot < spreads.length; spreadSlot += 1) {
    const spread = spreads[spreadSlot];
    const templateNodes = context.patch.nodes.filter((node) => node.runtimeSpread?.spreadId === spread.id);
    const templateIds = new Set(templateNodes.map((node) => node.id));

    // Compile every signal entering the template before its repeat bracket so
    // external stateful nodes run once per sample, not once per Spread item.
    for (const link of context.patch.links) {
      if (link.enabled === false || !templateIds.has(link.to.node) || templateIds.has(link.from.node)) continue;
      const source = context.nodeById.get(link.from.node);
      if (source) resolveOutput(source, link.from.port, context);
    }

    const countRegister = ensureSpreadCountRegister(spread, context);
    const stateStart = context.stateCount;
    const begin: DspOp = {
      opcode: DSP_OP.SpreadBegin,
      a: countRegister,
      b: -1,
      state: stateStart,
      value: spreadSlot,
      value2: 0,
    };
    context.ops.push(begin);

    // Sinks and previews contained by the Spread are part of the repeated
    // template even when they do not lead to an external output link.
    for (const node of templateNodes) {
      if (node.type === 'AudioOut') compileAudioOut(node, context);
      else if (node.type === 'FFT') ensureFftBinding(node, context);
      else if (node.type === 'Meter' || node.type === 'Scope') resolveOutput(node, 'signal', context);
      else if (node.type === 'SamplePlayer') resolveOutput(node, 'signal', context);
    }

    for (const link of context.patch.links) {
      if (link.enabled === false || !templateIds.has(link.from.node) || templateIds.has(link.to.node)) continue;
      const source = context.nodeById.get(link.from.node);
      if (!source) continue;
      const sourceRegister = resolveOutput(source, link.from.port, context);
      if (sourceRegister === null) continue;
      const weightedRegister = emitBinary(
        DSP_OP.Mul,
        sourceRegister,
        valueRegisterForLinkWeight(link, context),
        context,
      );
      const aggregateRegister = nextRegister(context);
      context.ops.push({
        opcode: DSP_OP.SpreadCollect,
        out: aggregateRegister,
        a: weightedRegister,
        b: (link.mode ?? 'set') === 'multiply' ? 1 : 0,
      });
      context.spreadBoundaryRegisterByLink.set(link, aggregateRegister);
    }

    const endIndex = context.ops.length;
    context.ops.push({ opcode: DSP_OP.SpreadEnd, value: spreadSlot });
    begin.b = endIndex;
    begin.value2 = context.stateCount - stateStart;
  }
}

function ensureSpreadCountRegister(spread: PatchNode, context: CompileContext): number {
  const existing = context.spreadCountRegisterById.get(spread.id);
  if (existing !== undefined) return existing;

  const liveCount = resolveInput(spread, 'count', 1, context, 'immediate');
  const countRegister = nextRegister(context);
  const state = nextState(context, 1);
  context.ops.push({ opcode: DSP_OP.BlockLatch, out: countRegister, a: liveCount, state });
  context.stateBindings.push({
    id: `${spread.id}:count`,
    state,
    count: 1,
    kind: 'spread',
    nodeId: spread.id,
  });
  context.spreadCountRegisterById.set(spread.id, countRegister);
  return countRegister;
}

function compileAudioOut(node: PatchNode, context: CompileContext): void {
  const level = resolveInput(node, 'level', 0.75, context);
  const leftRegisters: number[] = [];
  const rightRegisters: number[] = [];
  let outputLinkCount = 0;

  for (const port of ['both', 'left', 'right'] as const) {
    const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
    if (links.length === 0) continue;

    outputLinkCount += links.length;
    const input = resolveInput(node, port, 0, context);
    const scaled = emitBinary(DSP_OP.Mul, input, level, context);
    if (port === 'both' || port === 'left') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 0 });
      leftRegisters.push(scaled);
    }
    if (port === 'both' || port === 'right') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 1 });
      rightRegisters.push(scaled);
    }
  }

  if (outputLinkCount === 0) {
    context.errors.push(`Audio Out node "${node.id}" has no connected audio signal.`);
    return;
  }

  context.monitorIds[`${node.id}:left`] = sumRegisters(leftRegisters, context);
  context.monitorIds[`${node.id}:right`] = sumRegisters(rightRegisters, context);
}

function validatePatchLinks(context: CompileContext): void {
  for (const link of context.patch.links) {
    if (link.enabled === false) continue;
    const source = context.nodeById.get(link.from.node);
    const target = context.nodeById.get(link.to.node);

    if (!source) {
      context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    } else if (!portExists(getNodeDefinition(source), 'outputs', link.from.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid output port "${link.from.port}" on node "${link.from.node}".`);
    }

    if (!target) {
      context.errors.push(`Link target node "${link.to.node}" does not exist.`);
    } else if (!portExists(getNodeDefinition(target), 'inputs', link.to.port) && !isLegacySequencerTickInput(target, link.to.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid input port "${link.to.port}" on node "${link.to.node}".`);
    }
  }
}

function isLegacySequencerTickInput(node: PatchNode, port: string): boolean {
  return node.type === 'Sequencer' && port === 'tick';
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
  valueMode: 'smoothed' | 'immediate' = 'smoothed',
): number {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  if (links.length === 0) {
    return valueRegisterForNodeParam(node, port, fallback, context, valueMode);
  }

  const setRegisters: number[] = [];
  const setSpreadGroups = new Map<string, number>();
  let ordinarySetCount = 0;
  const addRegisters: number[] = [];
  const multiplyRegisters: number[] = [];

  for (const link of links) {
    let register = resolveLinkValue(link, context);
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
        {
          const source = context.nodeById.get(link.from.node);
          const spread = source?.runtimeSpread;
          const targetSpread = node.runtimeSpread;
          if (spread && spread.spreadId !== targetSpread?.spreadId) {
            const countRegister = context.spreadCountRegisterById.get(spread.spreadId);
            if (countRegister !== undefined) {
              setSpreadGroups.set(
                `${spread.spreadId}:${spread.originalNodeId}:${link.from.port}`,
                countRegister,
              );
            }
          } else {
            ordinarySetCount += 1;
          }
        }
        break;
    }
  }

  const setDenominatorRegisters = [
    ...(ordinarySetCount > 0 ? [constantRegister(ordinarySetCount, context)] : []),
    ...setSpreadGroups.values(),
  ];
  let result = setRegisters.length > 0
    ? emitBinary(
        DSP_OP.Div,
        sumRegisters(setRegisters, context),
        sumRegisters(setDenominatorRegisters, context),
        context,
      )
    : valueRegisterForNodeParam(node, port, fallback, context, valueMode);

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
  const spreadBoundaryRegister = context.spreadBoundaryRegisterByLink.get(link);
  if (spreadBoundaryRegister !== undefined) return spreadBoundaryRegister;

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
    return register;
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
  if (node.type === 'Spread') {
    context.errors.push(`Spread "${node.id}" item index can only link to nodes inside that Spread.`);
    return null;
  }
  if (node.type === 'Constant') {
    if (node.runtimeSpread?.originalNodeId === '__item_index__') {
      const output = nextRegister(context);
      context.ops.push({ opcode: DSP_OP.SpreadIndex, out: output });
      return output;
    }
    return resolveInput(node, 'value', 1, context);
  }

  if (node.type === 'Pass') {
    return resolveInput(node, 'signal', 0, context);
  }

  if (node.type === 'FFT') {
    const binding = ensureFftBinding(node, context);
    if (port === 'frequency') return emitValue(binding.frequencyValueIndex, context, 'immediate');
    if (port === 'amplitude') return emitValue(binding.amplitudeValueIndex, context, 'immediate');
    context.errors.push(`FFT node "${node.id}" does not have supported output "${port}".`);
    return null;
  }

  if (node.type === 'Slider') {
    const unitValue = resolveSliderUnitValue(node, context);
    context.monitorIds[node.id] = unitValue;
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
    const pressedValueIndex = valueIndexForNodeParam(node, 'pressed', 0, context);
    const modeValueIndex = valueIndexForNodeParam(node, 'mode', 0, context);
    const clicksValueIndex = valueIndexForNodeParam(node, 'clicks', 0, context);
    addMidiControlBinding(node, 'button', pressedValueIndex, context, {
      modeValueIndex,
      clicksValueIndex,
    });
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
      a: pressedValueIndex,
      b: modeValueIndex,
      c: clicksValueIndex,
      state,
    });
    if (hasInput(node, 'signal', context)) {
      const smoothedOutput = nextRegister(context);
      const smoothingState = nextState(context, 1);
      context.stateBindings.push({
        id: `${node.id}:button-gate-slew`,
        state: smoothingState,
        count: 1,
        kind: 'effect',
        nodeId: node.id,
      });
      context.ops.push({
        opcode: DSP_OP.Slew,
        out: smoothedOutput,
        a: output,
        state: smoothingState,
        value: BUTTON_GATE_FADE_SECONDS,
      });
      return emitBinary(DSP_OP.Mul, resolveInput(node, 'signal', 0, context), smoothedOutput, context);
    }
    return output;
  }

  if (node.type === 'Keys') {
    const valueIndex = valueIndexForNodeParam(node, port === 'frequency' ? 'frequency' : 'note', 0, context);
    return emitValue(valueIndex, context, 'immediate');
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
      b: resolveInput(node, 'channel', 0, context),
    });
    return output;
  }

  if (node.type === 'Tempo') {
    return compileTempo(node, port, context);
  }

  if (node.type === 'MidiCc') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.MidiCc,
      out: output,
      a: resolveInput(node, 'cc', 1, context),
      b: resolveInput(node, 'channel', 0, context),
    });
    return output;
  }

  if (node.type === 'Noise') {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: 6, b: constantRegister(0, context) });
    return mapBipolarOscillatorAmplitude(output, node, context);
  }

  const wave = OSC_WAVES[node.type];
  if (wave !== undefined) {
    const frequency = wave === 5 ? constantRegister(0, context) : resolveInput(node, 'frequency', 220, context);
    const output = nextRegister(context);
    const stateCount = wave === 5 ? 3 : 4;
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
    return wave === 5 ? output : mapBipolarOscillatorAmplitude(output, node, context);
  }

  if (node.type === 'CustomWave') {
    const staticBaseLevel = node.params.baseLevel ?? 0;
    const staticRangeMin = node.params.rangeMin ?? -1;
    const staticRangeMax = node.params.rangeMax ?? 1;
    const customWaveIndex = context.customWaveBindings.length;
    context.customWaveBindings.push({
      nodeId: node.id,
      customWave: customWaveWithBaseLevel(
        normalizeCustomWave(node.customWave, node.params),
        staticBaseLevel,
        staticRangeMin,
        staticRangeMax,
      ),
    });
    const frequency = resolveInput(node, 'frequency', 220, context);
    const baseLevel = resolveInput(node, 'baseLevel', 0, context);
    const rangeMin = resolveInput(node, 'rangeMin', -1, context);
    const rangeMax = resolveInput(node, 'rangeMax', 1, context);
    const mappedBaseLevel = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Map,
      out: mappedBaseLevel,
      a: baseLevel,
      b: rangeMin,
      c: rangeMax,
      d: constantRegister(-1, context),
      e: constantRegister(1, context),
    });
    const normalizedBaseLevel = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.HardClip,
      out: normalizedBaseLevel,
      a: mappedBaseLevel,
      b: constantRegister(1, context),
    });
    const output = nextRegister(context);
    const state = nextState(context, 6);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 6,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: 9,
      b: frequency,
      c: normalizedBaseLevel,
      d: resolveInput(node, 'phase', 0, context),
      e: resolveInput(node, 'trigger', 0, context),
      state,
      value: customWaveIndex,
    });
    return mapBipolarAmplitude(output, rangeMin, rangeMax, context);
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
    return mapBipolarOscillatorAmplitude(output, node, context);
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

  if (node.type === 'Image') {
    let imageIndex = context.imageBindingIndexByNodeId.get(node.id);
    if (imageIndex === undefined) {
      imageIndex = context.imageBindings.length;
      context.imageBindingIndexByNodeId.set(node.id, imageIndex);
      context.imageBindings.push({
        nodeId: node.id,
        image: { name: node.image?.name ?? '', url: node.image?.url ?? '' },
      });
    }
    const channel = port === 'brightness' ? 0
      : port === 'r' ? 1
        : port === 'g' ? 2
          : port === 'b' ? 3
            : port === 'hue' ? 4
              : port === 'saturation' ? 5
                : -1;
    if (channel < 0) {
      context.errors.push(`Node "${node.id}" does not have supported output "${port}".`);
      return null;
    }
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Image,
      out: output,
      a: resolveInput(node, 'x', 0.5, context),
      b: resolveInput(node, 'y', 0.5, context),
      c: channel,
      value: imageIndex,
    });
    return output;
  }

  if (node.type === 'Playhead') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:playhead`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Playhead,
      out: output,
      a: resolveInput(node, 'start', 0, context),
      b: resolveInput(node, 'speed', 1, context),
      state,
    });
    return output;
  }

  if (node.type === 'Time') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:time`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Time,
      out: output,
      state,
    });
    return output;
  }

  if (node.type === 'Buffer') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:buffer`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Buffer,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'playhead', 0, context),
      c: resolveInput(node, 'recordHead', 0, context),
      d: resolveInput(node, 'length', 1, context),
      state,
    });
    return output;
  }

  if (node.type === 'Multiply') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'factor', 1, context),
      context,
    );
  }

  if (node.type === 'Pow') {
    return emitFunction(
      EXPRESSION_FUNCTIONS.pow.id,
      [
        resolveInput(node, 'signal', 0, context),
        resolveInput(node, 'exponent', 1, context),
      ],
      context,
    );
  }

  if (node.type === 'RingMod') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'amount', 1, context),
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

  if (node.type === 'Pan') {
    return compilePan(node, port, context);
  }

  if (node.type === 'Envelope') {
    const envelope = nextRegister(context);
    const state = nextState(context, 7);
    const sustain = resolveInput(node, 'sustain', 0.72, context);
    const gateLength = resolveInput(node, 'gateLength', 0, context);
    const release = resolveInput(node, 'release', 0.24, context);
    context.stateBindings.push({
      id: `${node.id}:envelope`,
      state,
      count: 7,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Envelope,
      out: envelope,
      a: resolveInput(node, 'trigger', 0, context),
      b: resolveInput(node, 'gate', 0, context),
      c: resolveInput(node, 'delay', 0, context),
      d: resolveInput(node, 'attack', 0.01, context),
      e: resolveInput(node, 'decay', 0.16, context),
      state,
      value: packRegisterPair(sustain, release),
      value2: gateLength + 1,
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
    return compileReverb(node, port, context);
  }

  if (node.type === 'Compress') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    const signal = resolveInput(node, 'signal', 0, context);
    const sidechain = hasInput(node, 'sidechain', context)
      ? resolveInput(node, 'sidechain', 0, context)
      : -1;
    const knee = resolveInput(node, 'knee', 6, context);
    const makeup = resolveInput(node, 'makeup', 0, context);
    context.stateBindings.push({
      id: `${node.id}:compressor`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Compress,
      out: output,
      a: signal,
      b: resolveInput(node, 'threshold', -24, context),
      c: resolveInput(node, 'ratio', 4, context),
      d: resolveInput(node, 'attack', 0.01, context),
      e: resolveInput(node, 'release', 0.1, context),
      state,
      value: packRegisterPair(knee, makeup),
      value2: sidechain,
    });
    return output;
  }

  if (node.type === 'Limiter') {
    const output = nextRegister(context);
    const state = nextState(context, 2);
    context.stateBindings.push({
      id: `${node.id}:limiter`,
      state,
      count: 2,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Limiter,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'inputGain', 0, context),
      c: resolveInput(node, 'ceiling', -1, context),
      d: resolveInput(node, 'release', 0.05, context),
      e: resolveInput(node, 'lookahead', 0.005, context),
      state,
    });
    return output;
  }

  if (node.type === 'Abs') {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Abs, out: output, a: resolveInput(node, 'signal', 0, context) });
    return output;
  }

  if (node.type === 'Quantise') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Quantise,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'scale', 0, context, 'immediate'),
      c: resolveInput(node, 'root', 60, context, 'immediate'),
    });
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
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:accumulator`,
      state,
      count: 3,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Accumulator,
      out: output,
      a: resolveInput(node, 'trigger', 0, context),
      b: resolveInput(node, 'min', 0, context),
      c: resolveInput(node, 'max', 1, context),
      d: resolveInput(node, 'increment', 1, context),
      e: resolveInput(node, 'reset', 0, context),
      state,
      value: Math.round(node.params.mode ?? 0) === 1 ? 1 : 0,
    });
    return output;
  }

  if (node.type === 'Sequencer') {
    return compileSequencer(node, port, context);
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

  if (node.type === 'Equalizer') {
    const output = nextRegister(context);
    const state = nextState(context, 12);
    context.stateBindings.push({
      id: `${node.id}:equalizer`,
      state,
      count: 12,
      kind: 'filter',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: 7,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'lows', 0, context),
      d: resolveInput(node, 'mids', 0, context),
      e: resolveInput(node, 'highs', 0, context),
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
    if (node.type === 'Meter' && !context.signedMeterIds.includes(node.id)) {
      context.signedMeterIds.push(node.id);
    }
    return signal;
  }

  context.errors.push(`Node type "${node.type}" is not supported by the first DSP program slice.`);
  return null;
}

function ensureFftBinding(node: PatchNode, context: CompileContext): DspFftBinding {
  const existing = context.fftBindingByNodeId.get(node.id);
  if (existing) return existing;

  const inputRegister = resolveInput(node, 'signal', 0, context);
  const minFrequencyValueIndex = valueIndexForNodeParam(node, 'minFreq', 20, context);
  const maxFrequencyValueIndex = valueIndexForNodeParam(node, 'maxFreq', 20000, context);
  const frequencyValueIndex = valueIndex(0, {
    id: `${node.id}.frequency`,
    kind: 'analyser-output',
    nodeId: node.id,
    port: 'frequency',
  }, context);
  const amplitudeValueIndex = valueIndex(0, {
    id: `${node.id}.amplitude`,
    kind: 'analyser-output',
    nodeId: node.id,
    port: 'amplitude',
  }, context);
  const binding = {
    nodeId: node.id,
    inputRegister,
    minFrequencyValueIndex,
    maxFrequencyValueIndex,
    frequencyValueIndex,
    amplitudeValueIndex,
  };
  context.monitorIds[node.id] = inputRegister;
  context.fftBindings.push(binding);
  context.fftBindingByNodeId.set(node.id, binding);
  return binding;
}

function resolveSliderUnitValue(node: PatchNode, context: CompileContext): number {
  const cached = context.sliderUnitValueByNodeId.get(node.id);
  if (cached !== undefined) return cached;

  let register: number;
  if (hasInput(node, 'value', context)) {
    register = resolveInput(node, 'value', 0.5, context);
  } else {
    const valueIndex = valueIndexForNodeParam(node, 'value', 0.5, context);
    addMidiControlBinding(node, 'slider', valueIndex, context);
    register = emitValue(valueIndex, context);
  }

  context.sliderUnitValueByNodeId.set(node.id, register);
  return register;
}

function registerSliderMonitor(node: PatchNode, context: CompileContext): void {
  context.monitorIds[node.id] = resolveSliderUnitValue(node, context);
}

function addMidiControlBinding(
  node: PatchNode,
  kind: DspMidiControlBinding['kind'],
  valueIndex: number,
  context: CompileContext,
  indexes: Pick<DspMidiControlBinding, 'modeValueIndex' | 'clicksValueIndex'> = {},
): void {
  const channel = clampInteger(node.params.midiChannel ?? 0, 0, 16);
  const cc = clampInteger(node.params.midiCc ?? 1, 0, 127);
  if (channel === 0) return;

  context.midiControlBindings.push({
    nodeId: node.id,
    kind,
    channel,
    cc,
    valueIndex,
    ...indexes,
  });
}

function compileTempo(node: PatchNode, port: string, context: CompileContext): number {
  const outputKind = tempoOutputKind(port);
  if (outputKind < 0) {
    context.errors.push(`Tempo node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }

  const output = nextRegister(context);
  const sourceValueIndex = valueIndexForNodeParam(node, 'source', 0, context);
  const midiSourceValueIndex = valueIndexForNodeParam(node, 'midiSource', 0, context);

  if (!context.tempoBindings.some((binding) => binding.nodeId === node.id)) {
    context.tempoBindings.push({
      nodeId: node.id,
      sourceValueIndex,
      midiSourceValueIndex,
    });
  }
  if (Math.round(node.params.source ?? 0) === 1) {
    context.usesMidiClock = true;
  }

  context.ops.push({
    opcode: DSP_OP.Tempo,
    out: output,
    a: resolveInput(node, 'bpm', 120, context),
    b: emitValue(sourceValueIndex, context),
    c: outputKind,
    d: emitValue(midiSourceValueIndex, context),
    e: resolveInput(node, 'swing', 0, context),
    state: -1,
  });
  return output;
}

const TEMPO_OUTPUT_LABELS = ['4 bar', '2 bar', 'bar', 'whole', 'half', 'quarter / beat', 'upbeat', 'eighth', 'sixteenth', 'thirty-second'] as const;

function tempoOutputKind(port: string): number {
  const clickIndex = TEMPO_OUTPUT_LABELS.indexOf(port as typeof TEMPO_OUTPUT_LABELS[number]);
  if (clickIndex >= 0) return clickIndex;
  const freqIndex = TEMPO_OUTPUT_LABELS.indexOf(port.replace(/ freq$/, '') as typeof TEMPO_OUTPUT_LABELS[number]);
  return freqIndex >= 0 && port.endsWith(' freq') ? freqIndex + TEMPO_OUTPUT_LABELS.length : -1;
}

function compileSamplePlayer(node: PatchNode, context: CompileContext): number {
  const sampleIndex = context.sampleBindings.length;
  context.sampleBindings.push({
    nodeId: node.id,
    sample: {
      name: node.sample?.name ?? '',
      url: node.sample?.url ?? '',
    },
    release: Math.max(0, Number(node.params.release) || 0),
  });

  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:sample`,
    state,
    count: 1,
    kind: 'effect',
    nodeId: node.id,
  });

  const originalFrequency = resolveSampleOriginalFrequency(node, context);
  const sampleParams: Array<[kind: number, port: string | null, fallback: number, register?: number]> = [
    [0, 'mode', 0],
    [1, 'start', 0],
    [2, 'end', 1],
    [3, 'attack', 0],
    [4, 'release', 0],
    [5, 'stretch', 1],
    [6, 'cycleLength', 4096],
    [7, 'overlapRatio', 0.09],
    [8, null, 440, originalFrequency],
  ];
  for (const [kind, port, fallback, register] of sampleParams) {
    const inputRegister = register ?? resolveInput(node, port ?? '', fallback, context);
    context.ops.push({
      opcode: DSP_OP.SampleParam,
      a: sampleIndex,
      b: kind,
      c: inputRegister,
    });
    if (
      (port === 'start' || port === 'end' || port === 'attack' || port === 'release')
      && hasInput(node, port, context)
    ) {
      const monitorId = `${node.id}:sample-${port}`;
      context.monitorIds[monitorId] = inputRegister;
      context.signedMeterIds.push(monitorId);
    }
  }

  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Sample,
    out: output,
    a: sampleIndex,
    b: resolveInput(node, 'frequency', 220, context),
    c: resolveInput(node, 'trigger', 0, context),
    d: resolveInput(node, 'voices', 1, context),
    e: resolveInput(node, 'level', 0.7, context),
    state,
  });
  return output;
}

function resolveSampleOriginalFrequency(node: PatchNode, context: CompileContext): number {
  if (node.params.originalFrequency !== undefined || node.inputs?.some((input) => input.name === 'originalFrequency')) {
    return resolveInput(node, 'originalFrequency', 440, context);
  }

  const originalPitch = node.params.originalPitch;
  if (originalPitch !== undefined) {
    return constantRegister(midiNoteFrequency(originalPitch), context);
  }

  return constantRegister(440, context);
}

function midiNoteFrequency(note: number): number {
  return 440 * (2 ** ((note - 69) / 12));
}

function compileSelector(node: PatchNode, context: CompileContext): number {
  const definition = getNodeDefinition(node);
  const valueInputs = definition.inputs
    .filter((input) => /^[1-9][0-9]*$/.test(input.name))
    .sort((left, right) => Number(left.name) - Number(right.name));
  if (valueInputs.length === 0) return constantRegister(0, context);

  // A selector index is categorical. Updating it must not pass through the
  // intervening numeric indices, because they can refer to unrelated values.
  const select = resolveInput(node, 'select', 0, context, 'immediate');
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

function compileSequencer(node: PatchNode, port: string, context: CompileContext): number {
  if (port === SEQUENCER_INDEX_OUTPUT) {
    return compileSequencerIndex(node, context);
  }

  const rowIndex = sequencerOutputIndex(port);
  if (rowIndex === null) {
    context.errors.push(`Sequencer node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }

  return compileSequencerRow(node, rowIndex, context);
}

function compileSequencerIndex(node: PatchNode, context: CompileContext): number {
  const shape = sequencerShape(node.params);
  let index = constantRegister(0, context);
  let noEarlierTrigger = constantRegister(1, context);

  for (let rowIndex = 0; rowIndex < shape.rows; rowIndex += 1) {
    const trigger = compileSequencerRow(node, rowIndex, context);
    const selectedTrigger = emitBinary(DSP_OP.Mul, trigger, noEarlierTrigger, context);
    index = emitBinary(
      DSP_OP.Add,
      index,
      emitBinary(DSP_OP.Mul, selectedTrigger, constantRegister(rowIndex + 1, context), context),
      context,
    );
    noEarlierTrigger = emitBinary(
      DSP_OP.Mul,
      noEarlierTrigger,
      emitBinary(DSP_OP.Sub, constantRegister(1, context), trigger, context),
      context,
    );
  }

  return index;
}

function compileSequencerRow(node: PatchNode, rowIndex: number, context: CompileContext): number {
  const shape = sequencerShape(node.params);
  const state = ensureSequencerStepRegister(node, context).state;
  if (sequencerUsesGateMode(node.params)) {
    const gates = sequencerGatesForRow(node.params, rowIndex, shape.steps);
    const outputs = gates.map((gate) => {
      const output = nextRegister(context);
      context.ops.push({
        opcode: DSP_OP.Sequencer,
        out: output,
        a: resolveInput(node, 'signal', 0, context),
        b: resolveInput(node, 'steps', SEQUENCER_DEFAULT_STEPS, context),
        c: constantRegister(-2, context),
        d: resolveInput(node, 'rows', SEQUENCER_DEFAULT_ROWS, context),
        e: resolveInput(node, 'reset', 0, context),
        state,
        value: gate.start,
        value2: gate.end,
      });
      const velocity = sequencerStepVelocity(node.params, rowIndex, gate.slot);
      if (velocity >= 1) return output;
      return emitBinary(DSP_OP.Mul, output, constantRegister(velocity, context), context);
    });
    const sum = sumRegisters(outputs, context);
    if (outputs.length <= 1) return sum;
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.HardClip, out: output, a: sum, b: constantRegister(1, context) });
    return output;
  }

  const output = nextRegister(context);
  const pattern = sequencerPatternValue(node.params, rowIndex, shape.steps);
  context.ops.push({
    opcode: DSP_OP.Sequencer,
    out: output,
    a: resolveInput(node, 'signal', 0, context),
    b: resolveInput(node, 'steps', SEQUENCER_DEFAULT_STEPS, context),
    c: constantRegister(rowIndex, context),
    d: resolveInput(node, 'rows', SEQUENCER_DEFAULT_ROWS, context),
    e: resolveInput(node, 'reset', 0, context),
    state,
    value: pattern[0],
    value2: pattern[1],
    value3: pattern[2],
    value4: pattern[3],
  });
  const positionedOutputs = sequencerTriggersForRow(node.params, rowIndex, shape.steps)
    .filter((trigger) => (
      node.params[sequencerTriggerPositionParamName(rowIndex, trigger.slot)] !== undefined
      || trigger.velocity < 1
    ))
    .map((trigger) => {
      const triggerOutput = nextRegister(context);
      context.ops.push({
        opcode: DSP_OP.Sequencer,
        out: triggerOutput,
        a: resolveInput(node, 'signal', 0, context),
        b: resolveInput(node, 'steps', SEQUENCER_DEFAULT_STEPS, context),
        c: constantRegister(-3, context),
        d: resolveInput(node, 'rows', SEQUENCER_DEFAULT_ROWS, context),
        e: resolveInput(node, 'reset', 0, context),
        state,
        value: trigger.position,
      });
      const velocity = sequencerStepVelocity(node.params, rowIndex, trigger.slot);
      if (velocity >= 1) return triggerOutput;
      return emitBinary(DSP_OP.Mul, triggerOutput, constantRegister(velocity, context), context);
    });
  if (positionedOutputs.length === 0) return output;
  const sum = sumRegisters([output, ...positionedOutputs], context);
  const clipped = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.HardClip, out: clipped, a: sum, b: constantRegister(1, context) });
  return clipped;
}

function registerSequencerMonitor(node: PatchNode, context: CompileContext): void {
  ensureSequencerStepRegister(node, context);
}

function ensureSequencerStepRegister(node: PatchNode, context: CompileContext): { state: number; register: number } {
  let state = context.sequencerStateByNodeId.get(node.id);
  if (state === undefined) {
    state = nextState(context, 8);
    context.sequencerStateByNodeId.set(node.id, state);
    context.stateBindings.push({
      id: `${node.id}:sequencer`,
      state,
      count: 8,
      kind: 'sequencer',
      nodeId: node.id,
    });
  }

  let register = context.sequencerStepRegisterByNodeId.get(node.id);
  if (register === undefined) {
    register = nextRegister(context);
    context.sequencerStepRegisterByNodeId.set(node.id, register);
    context.monitorIds[node.id] = register;
    context.ops.push({
      opcode: DSP_OP.Sequencer,
      out: register,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'steps', SEQUENCER_DEFAULT_STEPS, context),
      c: constantRegister(-1, context),
      d: resolveInput(node, 'rows', SEQUENCER_DEFAULT_ROWS, context),
      e: resolveInput(node, 'reset', 0, context),
      state,
      value: sequencerUsesGateMode(node.params) ? 1 : 0,
    });
  }

  return { state, register };
}

function compilePan(node: PatchNode, port: string, context: CompileContext): number {
  if (port !== 'left' && port !== 'right') {
    context.errors.push(`Pan node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }

  const signal = resolveInput(node, 'signal', 0, context);
  const pan = emitFunction(
    EXPRESSION_FUNCTIONS.clamp.id,
    [
      resolveInput(node, 'pan', 0, context),
      constantRegister(-1, context),
      constantRegister(1, context),
    ],
    context,
  );
  const panned = port === 'left'
    ? emitBinary(DSP_OP.Sub, constantRegister(1, context), pan, context)
    : emitBinary(DSP_OP.Add, constantRegister(1, context), pan, context);
  const gain = emitFunction(
    EXPRESSION_FUNCTIONS.sqrt.id,
    [emitBinary(DSP_OP.Mul, panned, constantRegister(0.5, context), context)],
    context,
  );
  return emitBinary(DSP_OP.Mul, signal, gain, context);
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

function compileReverb(node: PatchNode, port: string, context: CompileContext): number {
  if (port !== 'left' && port !== 'right') {
    context.errors.push(`Reverb node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }

  const sharedOutputKey = inputKey(node.id, 'reverb');
  const cached = context.outputCache.get(sharedOutputKey);
  if (cached !== undefined) return cached;

  const output = compileEffect(node, DSP_OP.Reverb, [
    ['size', 0.55],
    ['decay', 0.45],
    ['mix', 0.25],
  ], context);
  context.outputCache.set(sharedOutputKey, output);
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

function sumRegisters(registers: number[], context: CompileContext): number {
  if (registers.length === 0) return constantRegister(0, context);
  if (registers.length === 1) return registers[0];
  let sum = registers[0];
  for (const register of registers.slice(1)) {
    sum = emitBinary(DSP_OP.Add, sum, register, context);
  }
  return sum;
}

function emitBinary(opcode: number, a: number, b: number, context: CompileContext): number {
  const out = nextRegister(context);
  context.ops.push({ opcode, out, a, b });
  return out;
}

function mapBipolarOscillatorAmplitude(signal: number, node: PatchNode, context: CompileContext): number {
  const min = resolveInput(node, 'rangeMin', -1, context);
  const max = resolveInput(node, 'rangeMax', 1, context);
  return mapBipolarAmplitude(signal, min, max, context);
}

function mapBipolarAmplitude(
  signal: number,
  min: number,
  max: number,
  context: CompileContext,
): number {
  const unitSignal = emitBinary(
    DSP_OP.Mul,
    emitBinary(DSP_OP.Add, signal, constantRegister(1, context), context),
    constantRegister(0.5, context),
    context,
  );
  const range = emitBinary(DSP_OP.Sub, max, min, context);
  return emitBinary(DSP_OP.Add, min, emitBinary(DSP_OP.Mul, unitSignal, range, context), context);
}

function emitFunction(functionId: number, args: number[], context: CompileContext): number {
  const paddedArgs = [...args];
  while (paddedArgs.length < 3) paddedArgs.push(constantRegister(0, context));
  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Function,
    out: output,
    a: functionId,
    b: paddedArgs[0],
    c: paddedArgs[1],
    d: paddedArgs[2],
    value: args.length,
  });
  return output;
}

function valueRegisterForNodeParam(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
  mode: 'smoothed' | 'immediate' = 'smoothed',
): number {
  return emitValue(valueIndexForNodeParam(node, port, fallback, context), context, mode);
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

function emitValue(
  valueIndex: number,
  context: CompileContext,
  mode: 'smoothed' | 'immediate' = 'smoothed',
): number {
  const out = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Value,
    out,
    a: valueIndex,
    value: mode === 'immediate' ? 1 : 0,
  });
  return out;
}

function packRegisterPair(left: number, right: number): number {
  return left + right * 2048;
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
