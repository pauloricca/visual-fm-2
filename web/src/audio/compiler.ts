import type { NodeType, Patch, PatchLink, PatchNode } from '../graph/types';
import { normalizeCustomWave } from '../graph/customWave';
import { replaceExpressionInputs } from '../graph/expression';
import { expandGroups } from '../graph/subpatch';

/**
 * @deprecated Legacy compatibility compiler for the old link-centric
 * WasmAudioGraph runtime. The app's live audio path is
 * compilePatchToDspProgram() in dspProgram.ts, which posts DspProgram messages
 * to the worklet. Keep fixes for current playback out of this file unless you
 * are deliberately maintaining old graph payload compatibility.
 */
export interface WasmAudioGraph {
  nodes: WasmAudioNode[];
  links: WasmAudioLink[];
  maxVoices: number;
  tempo: number;
  masterEffects: MasterEffects;
}

interface MasterEffects {
  chorus: {
    enabled: boolean;
    rate: number;
    depth: number;
    mix: number;
  };
  delay: {
    enabled: boolean;
    time: number;
    feedback: number;
    mix: number;
  };
  reverb: {
    enabled: boolean;
    size: number;
    decay: number;
    mix: number;
  };
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
    name: string;
    url: string;
    mode: string;
    start: number;
    end: number;
    stretch: number;
    cycleLength: number;
    overlapRatio: number;
    originalPitch: number;
  };
}

interface WasmAudioMap {
  srcMin: number;
  srcMax: number;
  trgtMin: number;
  trgtMax: number;
}

interface WasmAudioLink {
  id: string;
  from: string;
  to: string;
  amount: number;
  modulationTarget: string;
  parameterMode?: string;
  internalTarget?: boolean;
  monitorOnly?: boolean;
  pan?: number;
  delay?: number;
  signalMode?: string;
  map?: WasmAudioMap;
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
  map?: WasmAudioMap;
  follower?: WasmAudioLink['follower'];
  filter?: WasmAudioLink['filter'];
  distortion?: WasmAudioLink['distortion'];
  envelope?: WasmAudioLink['envelope'];
  monitorNodeIds?: string[];
  linkParameterModulations?: LinkParameterModulation[];
  masterEffects?: Partial<MasterEffects>;
}

interface LinkParameterModulation {
  link: PatchLink;
  port: string;
  target: string;
}

interface CompileContext {
  nodeById: Map<string, PatchNode>;
  outgoingByNode: Map<string, PatchLink[]>;
  incomingByInput: Map<string, PatchLink[]>;
  masterEffects: MasterEffects;
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
const RATIO_NODE_TYPES = new Set<NodeType>(['CustomWave', 'SamplePlayer']);

/**
 * @deprecated Use compilePatchToDspProgram() from dspProgram.ts for the active
 * runtime. This function remains only to document and support old graph-shaped
 * payloads.
 */
export function compilePatchToWasmGraph(patch: Patch): WasmAudioGraph {
  const expandedPatch = expandGroups(patch);
  const masterEffects = defaultMasterEffects();
  const context = contextForPatch(expandedPatch, masterEffects);
  const nodes = expandedPatch.nodes.flatMap((node) => compileSourceNode(node, context));
  const links = dedupeWasmLinks(expandedPatch.nodes.flatMap((node) => compileNodeOutput(node, context)));

  return {
    nodes,
    links,
    maxVoices: 8,
    tempo: 120,
    masterEffects,
  };
}

function defaultMasterEffects(): MasterEffects {
  return {
    chorus: { enabled: false, rate: 0.8, depth: 0.012, mix: 0.25 },
    delay: { enabled: false, time: 0.28, feedback: 0.35, mix: 0.25 },
    reverb: { enabled: false, size: 0.55, decay: 0.45, mix: 0.25 },
  };
}

function contextForPatch(patch: Patch, masterEffects: MasterEffects): CompileContext {
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

  return { nodeById, outgoingByNode, incomingByInput, masterEffects };
}

function compileSourceNode(node: PatchNode, context: CompileContext): WasmAudioNode[] {
  if (isImplicitEnvelopeSource(node, context)) {
    return [{
      id: node.id,
      wave: 'constant',
      frequencyMode: 'fixed',
      ratio: 1,
      frequency: 1,
    }];
  }

  const wave = OSC_WAVES[node.type];
  if (!wave) return [];

  const ratio = RATIO_NODE_TYPES.has(node.type) ? inputValue(node, 'ratio', 1, context) : 1;
  const customWave = node.type === 'CustomWave' ? normalizeCustomWave(node.customWave, node.params) : null;
  return [{
    id: node.id,
    wave,
    frequencyMode: 'fixed',
    ratio,
    frequency: node.type === 'Constant'
      ? inputValue(node, 'value', 1, context)
      : frequencyInputValue(node, context) * ratio,
    ...(node.type === 'PerlinNoise' ? { speed: inputValue(node, 'speed', 8, context) } : {}),
    ...(node.type === 'AudioInput' ? { audioInputGain: Math.round(node.params.muted ?? 0) === 1 ? 0 : inputValue(node, 'gain', 1, context) } : {}),
    ...(node.type === 'CustomWave' ? {
      customWave: {
        mode: customWave?.mode ?? 'loop',
        sustainStart: customWave?.sustainStart ?? 0.5,
        sustainEnd: customWave?.sustainEnd ?? 0.75,
        points: customWave?.points ?? [],
      },
    } : {}),
    ...(node.type === 'SamplePlayer' ? {
      sample: {
        name: node.sample?.name ?? '',
        url: node.sample?.url ?? '',
        mode: sampleModeFromValue(inputValue(node, 'mode', 0, context)),
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

function sampleModeFromValue(value: number): 'one-shot' | 'loop' | 'ping-pong' {
  const mode = Math.round(value);
  if (mode === 1) return 'loop';
  if (mode === 2) return 'ping-pong';
  return 'one-shot';
}

function compileNodeOutput(node: PatchNode, context: CompileContext): WasmAudioLink[] {
  const isImplicitEnvelope = isImplicitEnvelopeSource(node, context);
  if (!OSC_WAVES[node.type] && !isImplicitEnvelope) return [];

  const initial: SignalState = isImplicitEnvelope
    ? applyProcessorNode({ amount: 1 }, node, context)
    : sourceHasLevelInput(node)
      ? applyAmplitudeInput({ amount: 1 }, node, 'level', context)
      : { amount: 1 };
  const links: WasmAudioLink[] = [];
  walkSignalOutput(node.id, node.id, initial, context, links, new Set());
  return links;
}

function isImplicitEnvelopeSource(node: PatchNode, context: CompileContext): boolean {
  return node.type === 'Envelope'
    && (context.incomingByInput.get(inputKey(node.id, 'signal')) ?? []).length === 0
    && (context.outgoingByNode.get(node.id) ?? []).some((link) => link.from.port === 'signal');
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
      const outputState = applyAmplitudeInput(linkState, target, 'level', context);
      mergeMasterEffects(context.masterEffects, outputState.masterEffects);
      const outputLink = audioOutputLink(originId, patchLink, outputState);
      wasmLinks.push(outputLink, ...linkParameterModulationLinks(outputLink, outputState, context));
      continue;
    }

    const targetParameter = parameterTarget(patchLink.to.port, target);
    if (targetParameter) {
      if (OSC_WAVES[target.type] && patchLink.to.port !== 'level') {
        const outputLink = parameterLink(originId, patchLink, target, state, targetParameter, context);
        wasmLinks.push(outputLink, ...linkParameterModulationLinks(outputLink, state, context));
      }
      continue;
    }

    const linkState = applyCable(state, signalCableScale(patchLink, context));
    if (patchLink.to.port !== 'signal') continue;

    if (target.type === 'Meter' || target.type === 'Scope') {
      const hasSignalOutput = (context.outgoingByNode.get(target.id) ?? [])
        .some((link) => link.from.port === 'signal');
      if (hasSignalOutput) {
        const processedState = applyProcessorNode(linkState, target, context);
        walkSignalOutput(originId, target.id, processedState, context, wasmLinks, nextVisited);
      } else {
        const monitorLink = terminalMonitorLink(originId, target, linkState);
        wasmLinks.push(monitorLink, ...linkParameterModulationLinks(monitorLink, linkState, context));
      }
      continue;
    }

    const processedState = applyProcessorNode(linkState, target, context);
    walkSignalOutput(originId, target.id, processedState, context, wasmLinks, nextVisited);
  }
}

function audioOutputLink(
  originId: string,
  patchLink: PatchLink,
  state: SignalState,
): WasmAudioLink {
  return {
    ...wasmLinkState(state),
    id: linkId({ ...patchLink, from: { ...patchLink.from, node: originId } }),
    from: originId,
    to: 'audio',
    amount: state.amount,
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
    ...wasmLinkState(state),
    id: linkId({ ...patchLink, from: { ...patchLink.from, node: originId } }),
    from: originId,
    to: targetNode.id,
    amount: state.amount * dynamicParameterAmount(patchLink, context),
    modulationTarget: target,
    parameterMode: patchLink.mode ?? 'set',
    drone: true,
  };
}

function terminalMonitorLink(originId: string, monitorNode: PatchNode, state: SignalState): WasmAudioLink {
  return {
    ...wasmLinkState(state),
    id: `${originId}:signal->${monitorNode.id}:monitor`,
    from: originId,
    to: 'audio',
    amount: state.amount,
    modulationTarget: 'amplitude',
    drone: true,
    monitorOnly: true,
    monitorNodeIds: [monitorNode.id],
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

  if (node.type === 'Abs') {
    return {
      ...state,
      signalMode: signalModeAfterAbs(state.signalMode),
    };
  }

  if (node.type === 'Map') {
    return {
      ...state,
      signalMode: signalModeAfterMap(state.signalMode),
      map: {
        srcMin: inputValue(node, 'srcMin', 0, context),
        srcMax: inputValue(node, 'srcMax', 1, context),
        trgtMin: inputValue(node, 'trgtMin', 0, context),
        trgtMax: inputValue(node, 'trgtMax', 1, context),
      },
      linkParameterModulations: [
        ...(state.linkParameterModulations ?? []),
        ...dynamicInputModulations(node, {
          srcMin: 'mapSrcMin',
          srcMax: 'mapSrcMax',
          trgtMin: 'mapTargetMin',
          trgtMax: 'mapTargetMax',
        }, context),
      ],
    };
  }

  if (node.type === 'Delay') {
    return {
      ...state,
      masterEffects: {
        ...(state.masterEffects ?? {}),
        delay: {
          enabled: true,
          time: clamp(inputValue(node, 'time', 0.28, context), 0.02, 1.5),
          feedback: clamp(inputValue(node, 'feedback', 0.35, context), 0, 0.92),
          mix: clamp(inputValue(node, 'mix', 0.25, context), 0, 1),
        },
      },
    };
  }

  if (node.type === 'Chorus') {
    return {
      ...state,
      masterEffects: {
        ...(state.masterEffects ?? {}),
        chorus: {
          enabled: true,
          rate: clamp(inputValue(node, 'rate', 0.8, context), 0.05, 6),
          depth: clamp(inputValue(node, 'depth', 0.012, context), 0.001, 0.04),
          mix: clamp(inputValue(node, 'mix', 0.25, context), 0, 1),
        },
      },
    };
  }

  if (node.type === 'Reverb') {
    return {
      ...state,
      masterEffects: {
        ...(state.masterEffects ?? {}),
        reverb: {
          enabled: true,
          size: clamp(inputValue(node, 'size', 0.55, context), 0.1, 1),
          decay: clamp(inputValue(node, 'decay', 0.45, context), 0, 0.94),
          mix: clamp(inputValue(node, 'mix', 0.25, context), 0, 1),
        },
      },
    };
  }

  if (node.type === 'Envelope') {
    return {
      ...state,
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
    if (!source || !isWasmSourceNode(source, context)) return [];
    const sourceState = modulationSourceState(source, context);
    const modulationLink: WasmAudioLink = {
      ...wasmLinkState(sourceState),
      id: `${targetLink.id}::${modulation.target}<-${linkId(modulation.link)}:${index}`,
      from: modulation.link.from.node,
      to: targetLink.id,
      amount: sourceState.amount
        * dynamicLinkParameterAmount(modulation, targetLink, context),
      modulationTarget: modulation.target,
      parameterMode: modulation.link.mode ?? 'set',
      drone: true,
      internalTarget: true,
      monitorOnly: Boolean(targetLink.monitorOnly),
    };

    return [
      modulationLink,
      ...linkParameterModulationLinks(modulationLink, sourceState, context),
    ];
  });
}

function dynamicInputModulations(
  node: PatchNode,
  ports: Record<string, string>,
  context: CompileContext,
): LinkParameterModulation[] {
  return Object.entries(ports).flatMap(([port, target]) => (
    (context.incomingByInput.get(inputKey(node.id, port)) ?? [])
      .map((link) => ({ link, port, target }))
  ));
}

function applyAmplitudeInput(
  state: SignalState,
  node: PatchNode,
  port: string,
  context: CompileContext,
): SignalState {
  return {
    ...state,
    amount: state.amount * amplitudeInputValue(node, port, 1, context),
    linkParameterModulations: [
      ...(state.linkParameterModulations ?? []),
      ...dynamicInputModulations(node, { [port]: 'amplitude' }, context),
    ],
  };
}

function applyCable(state: SignalState, scale: number): SignalState {
  return {
    ...state,
    amount: state.amount * scale,
  };
}

function signalCableScale(link: PatchLink, context: CompileContext): number {
  void context;
  return linkWeight(link);
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
  const source = context.nodeById.get(link.from.node);
  if (source && isWasmSourceNode(source, context)) return null;

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

  if (isImplicitEnvelopeSource(node, context) && port === 'signal') {
    return null;
  }

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

  if (node.type === 'Abs' && (port === 'signal' || port === 'value')) {
    return Math.abs(inputValue(node, 'signal', 0, context, nextVisiting));
  }

  if (node.type === 'Map' && (port === 'signal' || port === 'value')) {
    return mapValue(
      inputValue(node, 'signal', 0, context, nextVisiting),
      inputValue(node, 'srcMin', 0, context, nextVisiting),
      inputValue(node, 'srcMax', 1, context, nextVisiting),
      inputValue(node, 'trgtMin', 0, context, nextVisiting),
      inputValue(node, 'trgtMax', 1, context, nextVisiting),
    );
  }

  if (node.type === 'Clamp' && (port === 'signal' || port === 'value')) {
    const min = inputValue(node, 'min', 0, context, nextVisiting);
    const max = inputValue(node, 'max', 1, context, nextVisiting);
    return clamp(inputValue(node, 'signal', 0, context, nextVisiting), Math.min(min, max), Math.max(min, max));
  }

  if (isProcessorNode(node) && port === 'signal') {
    return inputValue(node, 'signal', 0, context, nextVisiting);
  }

  return null;
}

function dynamicParameterAmount(link: PatchLink, context: CompileContext): number {
  void context;
  return linkWeight(link);
}

function dynamicLinkParameterAmount(
  modulation: LinkParameterModulation,
  targetLink: WasmAudioLink,
  context: CompileContext,
): number {
  const amount = dynamicParameterAmount(modulation.link, context);
  if (modulation.target !== 'amplitude') return amount;

  const targetNode = context.nodeById.get(modulation.link.to.node);
  if (!targetNode) return amount;

  const base = amplitudeInputValue(targetNode, modulation.port, 1, context);
  if (!Number.isFinite(base) || Math.abs(base) < 1e-9) return amount;

  return amount * (targetLink.amount / base);
}

function wasmLinkState(state: SignalState): Omit<SignalState, 'masterEffects'> {
  const { masterEffects: _masterEffects, ...linkState } = state;
  return linkState;
}

function modulationSourceState(node: PatchNode, context: CompileContext): SignalState {
  if (isImplicitEnvelopeSource(node, context)) {
    return applyProcessorNode({ amount: 1 }, node, context);
  }

  return sourceHasLevelInput(node)
    ? applyAmplitudeInput({ amount: 1 }, node, 'level', context)
    : { amount: 1 };
}

function isWasmSourceNode(node: PatchNode, context: CompileContext): boolean {
  return Boolean(OSC_WAVES[node.type]) || isImplicitEnvelopeSource(node, context);
}

function sourceHasLevelInput(node: PatchNode): boolean {
  return node.type === 'AudioInput'
    || node.type === 'SamplePlayer';
}

function averageValues(values: number[], divisor: number): number {
  if (values.length === 0 || divisor <= 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / divisor;
}

function mergeMasterEffects(
  target: MasterEffects,
  source: Partial<MasterEffects> | undefined,
): void {
  if (!source) return;
  if (source.chorus) target.chorus = source.chorus;
  if (source.delay) target.delay = source.delay;
  if (source.reverb) target.reverb = source.reverb;
}

function frequencyInputValue(node: PatchNode, context: CompileContext): number {
  const fallback = 220;
  const links = context.incomingByInput.get(inputKey(node.id, 'frequency')) ?? [];
  const hasDynamicSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) === null);
  const hasStaticSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) !== null);
  if (hasDynamicSet && !hasStaticSet) return 0;

  return inputValue(node, 'frequency', fallback, context);
}

function amplitudeInputValue(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  const hasDynamicSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) === null);
  const hasStaticSet = links.some((link) => (link.mode ?? 'set') === 'set' && staticLinkValue(link, context) !== null);
  if (hasDynamicSet && !hasStaticSet) return fallback;

  return inputValue(node, port, fallback, context);
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
    || node.type === 'Abs'
    || node.type === 'Map'
    || node.type === 'Clamp'
    || node.type === 'Multiply'
    || node.type === 'Delay'
    || node.type === 'Chorus'
    || node.type === 'Reverb'
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

function signalModeAfterAbs(current?: string): string {
  if (current === 'map') return 'map-abs';
  if (current === 'abs' || current === 'abs-map') return current;
  return 'abs';
}

function signalModeAfterMap(current?: string): string {
  if (current === 'abs') return 'abs-map';
  return 'map';
}

function mapValue(value: number, srcMin: number, srcMax: number, trgtMin: number, trgtMax: number): number {
  const sourceRange = srcMax - srcMin;
  const denominator = Math.abs(sourceRange) < 0.000001 ? 0.000001 : sourceRange;
  return trgtMin + ((value - srcMin) / denominator) * (trgtMax - trgtMin);
}

function parameterTarget(port: string, targetNode: PatchNode): string | null {
  if (port === 'frequency') return 'frequency';
  if (port === 'ratio' && RATIO_NODE_TYPES.has(targetNode.type)) return 'frequency';
  if (port === 'phase') return 'phase';
  if (port === 'phaseReset') return 'phaseResetTrigger';
  if (port === 'trigger' && targetNode.type === 'SamplePlayer') return 'sampleTrigger';
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
