import type { NodeType, Patch, PatchLink, PatchNode } from '../graph/types';
import { replaceExpressionInputs } from '../graph/expression';
import { expandGroups } from '../graph/subpatch';

export interface WasmAudioGraph {
  nodes: WasmAudioNode[];
  links: WasmAudioLink[];
  maxVoices: number;
  tempo: number;
  masterEffects: Record<string, unknown>;
}

interface WasmAudioNode {
  id: string;
  wave: string;
  frequencyMode: 'ratio' | 'fixed';
  ratio: number;
  frequency: number;
  speed?: number;
  audioInputGain?: number;
  customWave?: {
    mode: string;
    sustainStart: number;
    sustainEnd: number;
    points: Array<{ x: number; y: number }>;
  };
  sample?: {
    mode: string;
    start: number;
    end: number;
    stretch: number;
    cycleLength: number;
    overlapRatio: number;
    originalPitch: number;
  };
}

interface WasmAudioLink {
  id: string;
  from: string;
  to: string;
  amount: number;
  modulationTarget: string;
  parameterMode?: string;
  internalTarget?: boolean;
  pan?: number;
  delay?: number;
  signalMode?: string;
  follower?: {
    attack: number;
    release: number;
  };
  drone?: boolean;
  filter?: {
    type: string;
    cutoff: number;
    resonance: number;
  };
  distortion?: {
    enabled: boolean;
    type: string;
    gain: number;
  };
  envelope?: {
    delay?: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  monitorNodeIds?: string[];
}

interface SignalState {
  amount: number;
  delay?: number;
  signalMode?: string;
  follower?: WasmAudioLink['follower'];
  filter?: WasmAudioLink['filter'];
  distortion?: WasmAudioLink['distortion'];
  envelope?: WasmAudioLink['envelope'];
  monitorNodeIds?: string[];
  linkParameterModulations?: LinkParameterModulation[];
}

interface LinkParameterModulation {
  link: PatchLink;
  target: string;
}

interface CompileContext {
  nodeById: Map<string, PatchNode>;
  outgoingByNode: Map<string, PatchLink[]>;
  incomingByInput: Map<string, PatchLink[]>;
}

const OSC_WAVES: Partial<Record<NodeType, string>> = {
  SineOsc: 'sine',
  TriangleOsc: 'triangle',
  SawOsc: 'saw',
  RampOsc: 'ramp',
  SquareOsc: 'square',
  SampleHoldOsc: 'sample-hold',
  PerlinNoise: 'perlin',
  Noise: 'noise',
  AudioInput: 'audio-input',
  CustomWave: 'custom',
  SamplePlayer: 'sample',
  Constant: 'constant',
};

const FILTER_TYPES = ['none', 'lowpass', 'highpass', 'bandpass'] as const;
const DISTORTION_TYPES = ['hard-clip', 'soft-clip', 'fuzz', 'saturate', 'wavefold'] as const;
const DISTORTION_NODE_TYPES: Partial<Record<NodeType, string>> = {
  HardClipDistortion: 'hard-clip',
  SoftClipDistortion: 'soft-clip',
  FuzzDistortion: 'fuzz',
  SaturateDistortion: 'saturate',
  WavefoldDistortion: 'wavefold',
};
const CUSTOM_WAVE_MODES = ['loop', 'once', 'ping-pong', 'sustain', 'sustain-loop', 'sustain-ping-pong'] as const;

export function compilePatchToWasmGraph(patch: Patch): WasmAudioGraph {
  const expandedPatch = expandGroups(patch);
  const context = contextForPatch(expandedPatch);
  const nodes = expandedPatch.nodes.flatMap((node) => compileSourceNode(node, context));
  const links = dedupeWasmLinks(expandedPatch.nodes.flatMap((node) => compileNodeOutput(node, context)));

  return {
    nodes,
    links,
    maxVoices: 8,
    tempo: 120,
    masterEffects: {
      chorus: { enabled: false },
      delay: { enabled: false },
      reverb: { enabled: false },
    },
  };
}

function contextForPatch(patch: Patch): CompileContext {
  const nodeById = new Map(patch.nodes.map((node) => [node.id, node]));
  const outgoingByNode = new Map<string, PatchLink[]>();
  const incomingByInput = new Map<string, PatchLink[]>();

  for (const link of patch.links) {
    outgoingByNode.set(link.from.node, [...(outgoingByNode.get(link.from.node) ?? []), link]);
    incomingByInput.set(inputKey(link.to.node, link.to.port), [
      ...(incomingByInput.get(inputKey(link.to.node, link.to.port)) ?? []),
      link,
    ]);
  }

  return { nodeById, outgoingByNode, incomingByInput };
}

function compileSourceNode(node: PatchNode, context: CompileContext): WasmAudioNode[] {
  const wave = OSC_WAVES[node.type];
  if (!wave) return [];

  const ratio = inputValue(node, 'ratio', 1, context);
  return [{
    id: node.id,
    wave,
    frequencyMode: 'fixed',
    ratio,
    frequency: node.type === 'Constant'
      ? inputValue(node, 'value', 1, context)
      : frequencyInputValue(node, context) * ratio,
    ...(node.type === 'PerlinNoise' ? { speed: inputValue(node, 'speed', 8, context) } : {}),
    ...(node.type === 'AudioInput' ? { audioInputGain: inputValue(node, 'gain', 1, context) } : {}),
    ...(node.type === 'CustomWave' ? {
      customWave: {
        mode: CUSTOM_WAVE_MODES[clamp(Math.round(inputValue(node, 'mode', 0, context)), 0, CUSTOM_WAVE_MODES.length - 1)] ?? 'loop',
        sustainStart: inputValue(node, 'sustainStart', 0.5, context),
        sustainEnd: inputValue(node, 'sustainEnd', 0.75, context),
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
          { x: 1, y: 0 },
        ],
      },
    } : {}),
    ...(node.type === 'SamplePlayer' ? {
      sample: {
        mode: 'one-shot',
        start: inputValue(node, 'start', 0, context),
        end: inputValue(node, 'end', 1, context),
        stretch: inputValue(node, 'stretch', 1, context),
        cycleLength: inputValue(node, 'cycleLength', 4096, context),
        overlapRatio: inputValue(node, 'overlapRatio', 0.09, context),
        originalPitch: inputValue(node, 'originalPitch', 60, context),
      },
    } : {}),
  }];
}

function compileNodeOutput(node: PatchNode, context: CompileContext): WasmAudioLink[] {
  if (!OSC_WAVES[node.type]) return [];

  const initial: SignalState = {
    amount: inputValue(node, 'level', 1, context),
  };
  const links: WasmAudioLink[] = [];
  walkSignalOutput(node.id, node.id, initial, context, links, new Set());
  return links;
}

function walkSignalOutput(
  originId: string,
  currentNodeId: string,
  state: SignalState,
  context: CompileContext,
  wasmLinks: WasmAudioLink[],
  visited: Set<string>,
): void {
  if (visited.has(currentNodeId)) return;

  const nextVisited = new Set(visited);
  nextVisited.add(currentNodeId);

  for (const patchLink of context.outgoingByNode.get(currentNodeId) ?? []) {
    if (patchLink.from.port !== 'signal') continue;

    const target = context.nodeById.get(patchLink.to.node);
    if (!target) continue;

    if (target.type === 'AudioOut') {
      if (!isAudioOutPort(patchLink.to.port)) continue;
      const linkState = applyCable(state, signalCableScale(patchLink, context));
      const outputLink = audioOutputLink(originId, patchLink, target, linkState, context);
      wasmLinks.push(outputLink, ...linkParameterModulationLinks(outputLink, linkState, context));
      continue;
    }

    const targetParameter = parameterTarget(patchLink.to.port);
    if (targetParameter) {
      if (OSC_WAVES[target.type]) {
        const outputLink = parameterLink(originId, patchLink, target, state, targetParameter, context);
        wasmLinks.push(outputLink, ...linkParameterModulationLinks(outputLink, state, context));
      }
      continue;
    }

    if (patchLink.to.port !== 'signal') continue;

    const linkState = applyCable(state, signalCableScale(patchLink, context));
    const processedState = applyProcessorNode(linkState, target, context);
    walkSignalOutput(originId, target.id, processedState, context, wasmLinks, nextVisited);
  }
}

function audioOutputLink(
  originId: string,
  patchLink: PatchLink,
  outputNode: PatchNode,
  state: SignalState,
  context: CompileContext,
): WasmAudioLink {
  return {
    ...state,
    id: linkId({ ...patchLink, from: { ...patchLink.from, node: originId } }),
    from: originId,
    to: 'audio',
    amount: state.amount * inputValue(outputNode, 'level', 1, context),
    modulationTarget: 'amplitude',
    pan: audioOutPan(patchLink.to.port),
    drone: true,
    envelope: state.envelope ?? { delay: 0, attack: 0.01, decay: 0.12, sustain: 0.86, release: 0.18 },
  };
}

function parameterLink(
  originId: string,
  patchLink: PatchLink,
  targetNode: PatchNode,
  state: SignalState,
  target: string,
  context: CompileContext,
): WasmAudioLink {
  return {
    ...state,
    id: linkId({ ...patchLink, from: { ...patchLink.from, node: originId } }),
    from: originId,
    to: targetNode.id,
    amount: state.amount * dynamicParameterAmount(patchLink, context),
    modulationTarget: target,
    parameterMode: patchLink.mode ?? 'set',
    drone: true,
  };
}

function applyProcessorNode(state: SignalState, node: PatchNode, context: CompileContext): SignalState {
  if (node.type === 'Gain') {
    return {
      ...state,
      amount: state.amount * inputValue(node, 'gain', 1, context),
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, { gain: 'amplitude' }, context),
      ],
    };
  }

  if (node.type === 'Multiply') {
    return {
      ...state,
      amount: state.amount * inputValue(node, 'factor', 1, context),
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, { factor: 'amplitude' }, context),
      ],
    };
  }

  if (node.type === 'Delay') {
    return {
      ...state,
      delay: inputValue(node, 'time', 0.12, context),
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, { time: 'delay' }, context),
      ],
    };
  }

  if (node.type === 'Envelope') {
    return {
      ...state,
      signalMode: 'envelope',
      envelope: {
        delay: inputValue(node, 'delay', 0, context),
        attack: inputValue(node, 'attack', 0.01, context),
        decay: inputValue(node, 'decay', 0.16, context),
        sustain: inputValue(node, 'sustain', 0.72, context),
        release: inputValue(node, 'release', 0.24, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, {
          trigger: 'envelopeTrigger',
          delay: 'envelope.delay',
          attack: 'envelope.attack',
          decay: 'envelope.decay',
          sustain: 'envelope.sustain',
          release: 'envelope.release',
        }, context),
      ],
    };
  }

  if (node.type === 'Follower') {
    return {
      ...state,
      signalMode: 'envelope',
      follower: {
        attack: inputValue(node, 'attack', 0.01, context),
        release: inputValue(node, 'release', 0.12, context),
      },
    };
  }

  if (node.type === 'Fold') {
    return {
      ...state,
      distortion: {
        enabled: true,
        type: 'wavefold',
        gain: 1 + inputValue(node, 'amount', 1, context) * 3,
      },
    };
  }

  if (node.type === 'RingMod' || node.type === 'Mix') {
    return {
      ...state,
      amount: state.amount * inputValue(node, 'amount', 1, context),
    };
  }

  if (node.type === 'Filter' || node.type === 'LowpassFilter' || node.type === 'HighpassFilter' || node.type === 'BandpassFilter') {
    const type = node.type === 'HighpassFilter'
      ? 'highpass'
      : node.type === 'BandpassFilter'
        ? 'bandpass'
        : node.type === 'Filter'
          ? FILTER_TYPES[clamp(Math.round(inputValue(node, 'type', 1, context)), 0, FILTER_TYPES.length - 1)] ?? 'lowpass'
          : 'lowpass';
    return {
      ...state,
      filter: {
        type,
        cutoff: inputValue(node, 'cutoff', 1200, context),
        resonance: inputValue(node, 'resonance', 0.7, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, {
          cutoff: 'filterCutoff',
          resonance: 'filterResonance',
        }, context),
      ],
    };
  }

  if (node.type === 'FormantFilter') {
    return {
      ...state,
      filter: {
        type: 'formant',
        cutoff: inputValue(node, 'morph', 0, context),
        resonance: inputValue(node, 'intensity', 8, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, {
          morph: 'filterCutoff',
          intensity: 'filterResonance',
        }, context),
      ],
    };
  }

  if (node.type === 'CombFilter' || node.type === 'CombNotchFilter') {
    return {
      ...state,
      filter: {
        type: node.type === 'CombFilter' ? 'comb' : 'comb-notch',
        cutoff: inputValue(node, 'frequency', 440, context),
        resonance: inputValue(node, 'feedback', 0.45, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, {
          frequency: 'filterCutoff',
          feedback: 'filterResonance',
        }, context),
      ],
    };
  }

  if (node.type === 'Distortion') {
    return {
      ...state,
      distortion: {
        enabled: true,
        type: DISTORTION_TYPES[clamp(Math.round(inputValue(node, 'type', 2, context)) - 1, 0, DISTORTION_TYPES.length - 1)] ?? 'soft-clip',
        gain: inputValue(node, 'drive', 2.5, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, { drive: 'distortionGain' }, context),
      ],
    };
  }

  const distortionType = DISTORTION_NODE_TYPES[node.type];
  if (distortionType) {
    return {
      ...state,
      distortion: {
        enabled: true,
        type: distortionType,
        gain: inputValue(node, 'drive', 2.5, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, { drive: 'distortionGain' }, context),
      ],
    };
  }

  if (node.type === 'Meter' || node.type === 'Scope') {
    return {
      ...state,
      monitorNodeIds: [...(state.monitorNodeIds ?? []), node.id],
    };
  }

  return state;
}

function linkParameterModulationLinks(
  targetLink: WasmAudioLink,
  state: SignalState,
  context: CompileContext,
): WasmAudioLink[] {
  return (state.linkParameterModulations ?? []).flatMap((modulation, index) => {
    const source = context.nodeById.get(modulation.link.from.node);
    if (!source || !OSC_WAVES[source.type]) return [];

    return [{
      id: `${targetLink.id}::${modulation.target}<-${linkId(modulation.link)}:${index}`,
      from: modulation.link.from.node,
      to: targetLink.id,
      amount: sourceOutputAmount(source, context)
        * dynamicLinkParameterAmount(modulation.link, modulation.target, targetLink, context),
      modulationTarget: modulation.target,
      drone: true,
      internalTarget: true,
    }];
  });
}

function dynamicInputModulations(
  node: PatchNode,
  ports: Record<string, string>,
  context: CompileContext,
): LinkParameterModulation[] {
  return Object.entries(ports).flatMap(([port, target]) => (
    (context.incomingByInput.get(inputKey(node.id, port)) ?? [])
      .filter((link) => staticLinkValue(link, context) === null)
      .map((link) => ({ link, target }))
  ));
}

function applyCable(state: SignalState, scale: number): SignalState {
  return {
    ...state,
    amount: state.amount * scale,
  };
}

function signalCableScale(link: PatchLink, context: CompileContext): number {
  const inputLinks = context.incomingByInput.get(inputKey(link.to.node, link.to.port)) ?? [link];
  const setLinks = inputLinks.filter((candidate) => (candidate.mode ?? 'set') === 'set');
  const staticMultiplyScale = inputLinks
    .filter((candidate) => (candidate.mode ?? 'set') === 'multiply')
    .reduce((scale, candidate) => {
      const value = staticLinkValue(candidate, context);
      return value === null ? scale : scale * value;
    }, 1);

  if ((link.mode ?? 'set') === 'multiply' && staticLinkValue(link, context) === null) return 0;
  const baseScale = (link.mode ?? 'set') === 'set' && setLinks.length > 0
    ? linkWeight(link) / setLinks.length
    : linkWeight(link);

  return baseScale * staticMultiplyScale;
}

function inputValue(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
  visiting = new Set<string>(),
): number {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  if (links.length === 0) return param(node, port, fallback);

  const setValues: number[] = [];
  const addValues: number[] = [];
  const multiplyValues: number[] = [];

  for (const link of links) {
    const value = staticLinkValue(link, context, visiting);
    if (value === null) continue;

    switch (link.mode ?? 'set') {
      case 'add':
        addValues.push(value);
        break;
      case 'multiply':
        multiplyValues.push(value);
        break;
      case 'set':
        setValues.push(value);
        break;
    }
  }

  const setLinkCount = links.filter((link) => (link.mode ?? 'set') === 'set').length;
  let value = setLinkCount > 0
    ? setValues.length > 0
      ? averageValues(setValues, setLinkCount)
      : param(node, port, fallback)
    : param(node, port, fallback);

  value += addValues.reduce((sum, addValue) => sum + addValue, 0);

  if (multiplyValues.length > 0) {
    value *= multiplyValues.reduce((product, multiplyValue) => product * multiplyValue, 1);
  }

  return Number.isFinite(value) ? value : fallback;
}

function staticLinkValue(
  link: PatchLink,
  context: CompileContext,
  visiting = new Set<string>(),
): number | null {
  const value = staticOutputValue(link.from.node, link.from.port, context, visiting);
  return value === null ? null : value * linkWeight(link);
}

function staticOutputValue(
  nodeId: string,
  port: string,
  context: CompileContext,
  visiting: Set<string>,
): number | null {
  const key = inputKey(nodeId, port);
  if (visiting.has(key)) return null;

  const node = context.nodeById.get(nodeId);
  if (!node) return null;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(key);

  if (node.type === 'Constant' && (port === 'signal' || port === 'value')) {
    return inputValue(node, 'value', 1, context, nextVisiting);
  }

  if (node.type === 'Expression' && (port === 'value' || port === 'signal')) {
    return staticExpressionValue(node, context, nextVisiting);
  }

  if (node.type === 'Gain' && port === 'signal') {
    return inputValue(node, 'signal', 0, context, nextVisiting)
      * inputValue(node, 'gain', 1, context, nextVisiting);
  }

  if (node.type === 'Multiply' && port === 'signal') {
    return inputValue(node, 'signal', 0, context, nextVisiting)
      * inputValue(node, 'factor', 1, context, nextVisiting);
  }

  if (isProcessorNode(node) && port === 'signal') {
    return inputValue(node, 'signal', 0, context, nextVisiting);
  }

  return null;
}

function dynamicParameterAmount(link: PatchLink, context: CompileContext): number {
  const links = context.incomingByInput.get(inputKey(link.to.node, link.to.port)) ?? [link];
  const mode = link.mode ?? 'set';
  const setLinks = links.filter((candidate) => (candidate.mode ?? 'set') === 'set');
  const staticMultiplyScale = links
    .filter((candidate) => (candidate.mode ?? 'set') === 'multiply')
    .reduce((scale, candidate) => {
      const value = staticLinkValue(candidate, context);
      return value === null ? scale : scale * value;
    }, 1);

  const modeAmount = mode === 'set' && setLinks.length > 0
    ? linkWeight(link) / setLinks.length
    : linkWeight(link);
  const amount = modeAmount * staticMultiplyScale;

  return amount;
}

function dynamicLinkParameterAmount(
  link: PatchLink,
  target: string,
  targetLink: WasmAudioLink,
  context: CompileContext,
): number {
  const amount = dynamicParameterAmount(link, context);
  if (target === 'filterCutoff' && (link.mode ?? 'set') === 'add') {
    const baseCutoff = Math.max(Math.abs(targetLink.filter?.cutoff ?? 1), 1);
    return amount / (baseCutoff * Math.LN2);
  }

  if (target === 'amplitude') {
    return amount;
  }

  return amount;
}

function sourceOutputAmount(node: PatchNode, context: CompileContext): number {
  if (node.type === 'Constant') return 1;
  return inputValue(node, 'level', 1, context);
}

function averageValues(values: number[], divisor: number): number {
  if (values.length === 0 || divisor <= 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / divisor;
}

function frequencyInputValue(node: PatchNode, context: CompileContext): number {
  const fallback = 220;
  const links = context.incomingByInput.get(inputKey(node.id, 'frequency')) ?? [];
  const hasDynamicSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) === null);
  const hasStaticSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) !== null);
  if (hasDynamicSet && !hasStaticSet) return 0;

  return inputValue(node, 'frequency', fallback, context);
}

function staticExpressionValue(
  node: PatchNode,
  context: CompileContext,
  visiting: Set<string>,
): number | null {
  const expression = node.expression?.trim() || '0';
  const replaced = replaceExpressionInputs(expression, (name) => (
    String(inputValue(node, name, 0, context, visiting))
  ));

  try {
    const evaluator = new Function(
      'Math',
      `
        const {
          abs, acos, asin, atan, atan2, ceil, cos, exp, floor, log,
          max, min, pow, random, round, sign, sin, sqrt, tan, trunc,
          PI, E
        } = Math;
        return (${replaced});
      `,
    );
    const value = Number(evaluator(Math));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function isProcessorNode(node: PatchNode): boolean {
  return node.type === 'Gain'
    || node.type === 'Multiply'
    || node.type === 'Delay'
    || node.type === 'Envelope'
    || node.type === 'Follower'
    || node.type === 'RingMod'
    || node.type === 'Fold'
    || node.type === 'Mix'
    || node.type === 'Filter'
    || node.type === 'LowpassFilter'
    || node.type === 'HighpassFilter'
    || node.type === 'BandpassFilter'
    || node.type === 'FormantFilter'
    || node.type === 'CombFilter'
    || node.type === 'CombNotchFilter'
    || node.type === 'Distortion'
    || Boolean(DISTORTION_NODE_TYPES[node.type])
    || node.type === 'Meter'
    || node.type === 'Scope';
}

function parameterTarget(port: string): string | null {
  if (port === 'frequency') return 'frequency';
  if (port === 'ratio') return 'frequency';
  if (port === 'phase') return 'phase';
  if (port === 'phaseReset') return 'phaseResetTrigger';
  if (port === 'trigger') return 'sampleTrigger';
  if (port === 'start') return 'sampleStart';
  if (port === 'end') return 'sampleEnd';
  if (port === 'stretch') return 'sampleStretch';
  if (port === 'level' || port === 'gain' || port === 'factor') return 'amplitude';
  if (port === 'cutoff') return 'filterCutoff';
  if (port === 'resonance') return 'filterResonance';
  if (port === 'drive') return 'distortionGain';
  return null;
}

function isAudioOutPort(port: string): boolean {
  return port === 'both' || port === 'left' || port === 'right' || port === 'signal';
}

function audioOutPan(port: string): number {
  if (port === 'left') return -1;
  if (port === 'right') return 1;
  return 0;
}

function param(node: PatchNode, name: string, fallback: number): number {
  const value = node.params[name];
  return Number.isFinite(value) ? value : fallback;
}

function linkWeight(link: PatchLink): number {
  return Number.isFinite(link.weight) ? link.weight ?? 1 : 1;
}

function linkId(link: PatchLink): string {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}

function inputKey(nodeId: string, port: string): string {
  return `${nodeId}.${port}`;
}

function dedupeWasmLinks(links: WasmAudioLink[]): WasmAudioLink[] {
  const seen = new Set<string>();
  const deduped: WasmAudioLink[] = [];
  for (const link of links) {
    if (seen.has(link.id)) continue;
    seen.add(link.id);
    deduped.push(link);
  }
  return deduped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
