import type { NodeDefinition, NodeType, PatchNode } from './types';

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  Expression: {
    type: 'Expression',
    inputs: [],
    outputs: [{ name: 'value' }],
  },
  Group: {
    type: 'Group',
    inputs: [],
    outputs: [],
  },
  Ins: {
    type: 'Ins',
    inputs: [],
    outputs: [],
  },
  Outs: {
    type: 'Outs',
    inputs: [],
    outputs: [],
  },
  AudioOut: {
    type: 'AudioOut',
    inputs: [
      { name: 'both', valueEditor: false },
      { name: 'left', valueEditor: false },
      { name: 'right', valueEditor: false },
      { name: 'level', defaultValue: 0.75, min: 0, max: 2 },
    ],
    outputs: [],
  },
  SineOsc: oscillator('SineOsc'),
  TriangleOsc: oscillator('TriangleOsc'),
  SawOsc: oscillator('SawOsc'),
  RampOsc: oscillator('RampOsc'),
  SquareOsc: oscillator('SquareOsc'),
  SampleHoldOsc: oscillator('SampleHoldOsc'),
  PerlinNoise: {
    type: 'PerlinNoise',
    inputs: [
      { name: 'speed', defaultValue: 8, min: 0.01, max: 60 },
      { name: 'level', defaultValue: 0.7, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Noise: {
    type: 'Noise',
    inputs: [
      { name: 'frequency', defaultValue: 440, min: 0, max: 12000 },
      { name: 'level', defaultValue: 0.4, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  },
  AudioInput: {
    type: 'AudioInput',
    inputs: [
      { name: 'gain', defaultValue: 1, min: 0, max: 4 },
      { name: 'level', defaultValue: 0.7, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  },
  CustomWave: {
    type: 'CustomWave',
    inputs: [
      { name: 'frequency', defaultValue: 220, min: 0, max: 12000 },
      { name: 'ratio', defaultValue: 1, min: 0, max: 16 },
      { name: 'phase', defaultValue: 0, min: -16, max: 16 },
      { name: 'phaseReset', defaultValue: 0, min: 0, max: 1 },
      { name: 'mode', defaultValue: 0, min: 0, max: 5, integer: true },
      { name: 'sustainStart', defaultValue: 0.5, min: 0, max: 0.999 },
      { name: 'sustainEnd', defaultValue: 0.75, min: 0.001, max: 1 },
      { name: 'level', defaultValue: 0.7, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  },
  SamplePlayer: {
    type: 'SamplePlayer',
    inputs: [
      { name: 'frequency', defaultValue: 220, min: 0, max: 12000 },
      { name: 'ratio', defaultValue: 1, min: 0, max: 16 },
      { name: 'trigger', defaultValue: 0, min: 0, max: 1 },
      { name: 'start', defaultValue: 0, min: 0, max: 1 },
      { name: 'end', defaultValue: 1, min: 0, max: 1 },
      { name: 'stretch', defaultValue: 1, min: 0.001, max: 16 },
      { name: 'cycleLength', defaultValue: 4096, min: 64, max: 65536 },
      { name: 'overlapRatio', defaultValue: 0.09, min: 0, max: 1 },
      { name: 'originalPitch', defaultValue: 60, min: 0, max: 127 },
      { name: 'level', defaultValue: 0.7, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Constant: {
    type: 'Constant',
    inputs: [{ name: 'value', defaultValue: 1, min: -1, max: 1 }],
    outputs: [{ name: 'signal' }],
  },
  Gain: {
    type: 'Gain',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'gain', defaultValue: 1, min: -8, max: 8 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Multiply: processor('Multiply', [
    { name: 'factor', defaultValue: 1, min: -8, max: 8 },
  ]),
  Delay: processor('Delay', [
    { name: 'time', defaultValue: 0.12, min: 0, max: 3 },
  ]),
  LinkNoise: processor('LinkNoise', []),
  Envelope: processor('Envelope', [
    { name: 'trigger', valueEditor: false },
    { name: 'delay', defaultValue: 0, min: 0, max: 4 },
    { name: 'attack', defaultValue: 0.01, min: 0.001, max: 4 },
    { name: 'decay', defaultValue: 0.16, min: 0.001, max: 4 },
    { name: 'sustain', defaultValue: 0.72, min: 0, max: 1 },
    { name: 'release', defaultValue: 0.24, min: 0.001, max: 6 },
  ]),
  Follower: processor('Follower', [
    { name: 'attack', defaultValue: 0.01, min: 0.001, max: 2 },
    { name: 'release', defaultValue: 0.12, min: 0.001, max: 4 },
  ]),
  RingMod: processor('RingMod', [
    { name: 'amount', defaultValue: 1, min: 0, max: 1 },
  ]),
  Fold: processor('Fold', [
    { name: 'amount', defaultValue: 1, min: 0, max: 8 },
  ]),
  Mix: processor('Mix', [
    { name: 'amount', defaultValue: 0.5, min: 0, max: 1 },
  ]),
  Meter: processor('Meter', []),
  Scope: processor('Scope', []),
  Filter: filter('Filter'),
  LowpassFilter: filter('LowpassFilter'),
  HighpassFilter: filter('HighpassFilter'),
  BandpassFilter: filter('BandpassFilter'),
  FormantFilter: processor('FormantFilter', [
    { name: 'morph', defaultValue: 0, min: 0, max: 1 },
    { name: 'intensity', defaultValue: 8, min: 0.1, max: 36 },
  ]),
  CombFilter: processor('CombFilter', [
    { name: 'frequency', defaultValue: 440, min: 20, max: 5000 },
    { name: 'feedback', defaultValue: 0.45, min: -0.98, max: 0.98 },
  ]),
  CombNotchFilter: processor('CombNotchFilter', [
    { name: 'frequency', defaultValue: 440, min: 20, max: 5000 },
    { name: 'feedback', defaultValue: 0.45, min: -0.98, max: 0.98 },
  ]),
  HardClipDistortion: distortion('HardClipDistortion'),
  SoftClipDistortion: distortion('SoftClipDistortion'),
  FuzzDistortion: distortion('FuzzDistortion'),
  SaturateDistortion: distortion('SaturateDistortion'),
  WavefoldDistortion: distortion('WavefoldDistortion'),
  Distortion: {
    type: 'Distortion',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'type', defaultValue: 2, min: 1, max: 5, integer: true },
      { name: 'drive', defaultValue: 2.5, min: 0.1, max: 40 },
    ],
    outputs: [{ name: 'signal' }],
  },
};

export const NODE_TYPE_LIST = (Object.keys(NODE_DEFINITIONS) as NodeType[])
  .filter((type) => type !== 'Filter' && type !== 'Distortion' && type !== 'LinkNoise');

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  Expression: 'Expression',
  Group: 'Group',
  Ins: 'Ins',
  Outs: 'Outs',
  AudioOut: 'Audio Out',
  SineOsc: 'Sine Osc',
  TriangleOsc: 'Triangle Osc',
  SawOsc: 'Saw Osc',
  RampOsc: 'Ramp Osc',
  SquareOsc: 'Square Osc',
  SampleHoldOsc: 'Sample Hold',
  PerlinNoise: 'Perlin Noise',
  Noise: 'Noise',
  AudioInput: 'Audio Input',
  CustomWave: 'Custom Wave',
  SamplePlayer: 'Sample Player',
  Constant: 'Constant',
  Gain: 'Gain',
  Multiply: 'Multiply',
  Delay: 'Delay',
  LinkNoise: 'Link Noise',
  Envelope: 'Envelope',
  Follower: 'Follower',
  RingMod: 'Ring Mod',
  Fold: 'Fold',
  Mix: 'Mix',
  Meter: 'Meter',
  Scope: 'Scope',
  Filter: 'Filter',
  LowpassFilter: 'Lowpass Filter',
  HighpassFilter: 'Highpass Filter',
  BandpassFilter: 'Bandpass Filter',
  FormantFilter: 'Formant Filter',
  CombFilter: 'Comb Filter',
  CombNotchFilter: 'Comb Notch',
  HardClipDistortion: 'Hard Clip',
  SoftClipDistortion: 'Soft Clip',
  FuzzDistortion: 'Fuzz',
  SaturateDistortion: 'Saturate',
  WavefoldDistortion: 'Wavefold',
  Distortion: 'Distortion',
};

export function getDefinition(type: NodeType): NodeDefinition {
  return NODE_DEFINITIONS[type];
}

export function getNodeDefinition(node: PatchNode): NodeDefinition {
  if (node.type === 'Expression') {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: getDefinition(node.type).outputs,
    };
  }

  if (node.type === 'Group') {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
    };
  }

  if (node.type === 'Ins') {
    return {
      type: node.type,
      inputs: [],
      outputs: node.outputs ?? [],
    };
  }

  if (node.type === 'Outs') {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: [],
    };
  }

  return {
    ...getDefinition(node.type),
    inputs: node.inputs ?? getDefinition(node.type).inputs,
    outputs: node.outputs ?? getDefinition(node.type).outputs,
  };
}

export function getNodeTypeLabel(type: NodeType): string {
  return NODE_TYPE_LABELS[type];
}

export function defaultParamsFor(type: NodeType): Record<string, number> {
  const params: Record<string, number> = {};
  for (const input of getDefinition(type).inputs) {
    if (input.defaultValue !== undefined) {
      params[input.name] = input.defaultValue;
    }
  }
  return params;
}

function oscillator(type: NodeType): NodeDefinition {
  return {
    type,
    inputs: [
      { name: 'frequency', defaultValue: 220, min: 0, max: 12000 },
      { name: 'ratio', defaultValue: 1, min: 0, max: 16 },
      { name: 'phase', defaultValue: 0, min: -16, max: 16 },
      { name: 'phaseReset', defaultValue: 0, min: 0, max: 1 },
      { name: 'level', defaultValue: 0.7, min: 0, max: 2 },
    ],
    outputs: [{ name: 'signal' }],
  };
}

function processor(type: NodeType, params: NodeDefinition['inputs']): NodeDefinition {
  return {
    type,
    inputs: [
      { name: 'signal', valueEditor: false },
      ...params,
    ],
    outputs: [{ name: 'signal' }],
  };
}

function filter(type: NodeType): NodeDefinition {
  return processor(type, [
    { name: 'cutoff', defaultValue: 1200, min: 20, max: 12000 },
    { name: 'resonance', defaultValue: 0.7, min: 0.1, max: 12 },
  ]);
}

function distortion(type: NodeType): NodeDefinition {
  return processor(type, [
    { name: 'drive', defaultValue: 2.5, min: 0.1, max: 40 },
  ]);
}
