import type { NodeDefinition, NodeType, PatchNode } from './types';

export const SEQUENCER_MIN_STEPS = 1;
export const SEQUENCER_MAX_STEPS = 128;
export const SEQUENCER_DEFAULT_STEPS = 16;
export const SEQUENCER_MIN_ROWS = 1;
export const SEQUENCER_MAX_ROWS = 16;
export const SEQUENCER_DEFAULT_ROWS = 4;
export const SEQUENCER_MIN_BEAT_LENGTH = 1;
export const SEQUENCER_DEFAULT_BEAT_LENGTH = 4;
export const SEQUENCER_INDEX_OUTPUT = 'trigger index';

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
      { name: 'level', defaultValue: 0.75 },
    ],
    outputs: [],
  },
  SineOsc: oscillator('SineOsc'),
  TriangleOsc: oscillator('TriangleOsc'),
  SawOsc: oscillator('SawOsc'),
  RampOsc: oscillator('RampOsc'),
  SquareOsc: oscillator('SquareOsc'),
  SampleHoldOsc: {
    type: 'SampleHoldOsc',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'trigger', defaultValue: 0 },
    ],
    outputs: [{ name: 'signal' }],
  },
  PerlinNoise: {
    type: 'PerlinNoise',
    inputs: [
      { name: 'speed', defaultValue: 8 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Noise: {
    type: 'Noise',
    inputs: [],
    outputs: [{ name: 'signal' }],
  },
  AudioInput: {
    type: 'AudioInput',
    inputs: [
      { name: 'gain', defaultValue: 1 },
      { name: 'level', defaultValue: 0.7 },
    ],
    outputs: [{ name: 'signal' }],
  },
  CustomWave: {
    type: 'CustomWave',
    inputs: [
      { name: 'frequency', defaultValue: 220 },
      { name: 'phase', defaultValue: 0 },
      { name: 'phaseReset', defaultValue: 0 },
      { name: 'rangeMin', defaultValue: -1 },
      { name: 'rangeMax', defaultValue: 1 },
    ],
    outputs: [{ name: 'signal' }],
  },
  SamplePlayer: {
    type: 'SamplePlayer',
    inputs: [
      { name: 'frequency', defaultValue: 220 },
      { name: 'originalFrequency', defaultValue: 440, min: 0.0001 },
      { name: 'trigger', defaultValue: 0 },
      { name: 'start', defaultValue: 0, min: 0, max: 1 },
      { name: 'end', defaultValue: 1, min: 0, max: 1 },
      { name: 'attack', defaultValue: 0, min: 0, step: 0.001 },
      { name: 'release', defaultValue: 0, min: 0, step: 0.001 },
      { name: 'stretch', defaultValue: 1, min: 0.001 },
      { name: 'cycleLength', defaultValue: 4096, min: 1 },
      { name: 'overlapRatio', defaultValue: 0.09, min: 0, max: 1 },
      { name: 'mode', defaultValue: 0, min: 0, max: 2, integer: true, connectable: false, valueEditor: false },
      { name: 'level', defaultValue: 0.7 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Buffer: {
    type: 'Buffer',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'playhead', defaultValue: 0 },
      { name: 'recordHead', defaultValue: 0 },
      { name: 'length', defaultValue: 1, min: 0.01, max: 10 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Playhead: {
    type: 'Playhead',
    inputs: [
      { name: 'start', defaultValue: 0 },
      { name: 'speed', defaultValue: 1 },
    ],
    outputs: [{ name: 'playhead' }],
  },
  Constant: {
    type: 'Constant',
    inputs: [{ name: 'value', defaultValue: 1 }],
    outputs: [{ name: 'signal' }],
  },
  Pass: {
    type: 'Pass',
    inputs: [{ name: 'signal', valueEditor: false }],
    outputs: [{ name: 'signal' }],
  },
  Slider: {
    type: 'Slider',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'value', defaultValue: 0.5, min: 0, max: 1 },
      { name: 'min', defaultValue: 0 },
      { name: 'max', defaultValue: 1 },
      { name: 'direction', defaultValue: 0, min: 0, max: 1, integer: true },
      { name: 'midiChannel', defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: 'midiCc', defaultValue: 1, min: 0, max: 127, integer: true, connectable: false },
    ],
    outputs: [{ name: 'signal' }],
  },
  Button: {
    type: 'Button',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'mode', defaultValue: 0, min: 0, max: 2, integer: true, connectable: false, valueEditor: false },
      { name: 'midiChannel', defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: 'midiCc', defaultValue: 1, min: 0, max: 127, integer: true, connectable: false },
    ],
    outputs: [{ name: 'signal' }],
  },
  Sequencer: {
    type: 'Sequencer',
    inputs: [
      { name: 'steps', defaultValue: SEQUENCER_DEFAULT_STEPS, min: SEQUENCER_MIN_STEPS, max: SEQUENCER_MAX_STEPS, integer: true },
      { name: 'rows', defaultValue: SEQUENCER_DEFAULT_ROWS, min: SEQUENCER_MIN_ROWS, max: SEQUENCER_MAX_ROWS, integer: true },
      { name: 'beatLength', defaultValue: SEQUENCER_DEFAULT_BEAT_LENGTH, min: SEQUENCER_MIN_BEAT_LENGTH, max: SEQUENCER_MAX_STEPS, integer: true, connectable: false },
      { name: 'signal', defaultValue: 0, valueEditor: false },
      { name: 'reset', defaultValue: 0, valueEditor: false },
    ],
    outputs: sequencerOutputDefinitions(SEQUENCER_DEFAULT_ROWS),
  },
  Tempo: {
    type: 'Tempo',
    inputs: [
      { name: 'bpm', defaultValue: 120, min: 1 },
      { name: 'swing', defaultValue: 0, min: -1, max: 1, step: 0.001 },
      { name: 'source', defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false },
      { name: 'midiSource', defaultValue: 0, min: 0, integer: true, connectable: false, valueEditor: false },
    ],
    outputs: [
      { name: '4 bar' },
      { name: '2 bar' },
      { name: 'bar' },
      { name: 'whole' },
      { name: 'half' },
      { name: 'quarter / beat' },
      { name: 'upbeat' },
      { name: 'eighth' },
      { name: 'sixteenth' },
      { name: 'thirty-second' },
      { name: '4 bar freq' },
      { name: '2 bar freq' },
      { name: 'bar freq' },
      { name: 'whole freq' },
      { name: 'half freq' },
      { name: 'quarter / beat freq' },
      { name: 'upbeat freq' },
      { name: 'eighth freq' },
      { name: 'sixteenth freq' },
      { name: 'thirty-second freq' },
    ],
  },
  MidiNote: {
    type: 'MidiNote',
    inputs: [
      { name: 'channel', defaultValue: 0, min: 0, max: 16, integer: true },
      { name: 'voices', defaultValue: 8, min: 1, max: 16, integer: true, connectable: false, valueEditor: false },
    ],
    outputs: [
      { name: 'note' },
      { name: 'frequency' },
      { name: 'velocity' },
      { name: 'gate' },
      { name: 'trigger' },
    ],
  },
  MidiCc: {
    type: 'MidiCc',
    inputs: [
      { name: 'channel', defaultValue: 0, min: 0, max: 16, integer: true },
      { name: 'cc', defaultValue: 1, min: 0, max: 127, integer: true },
    ],
    outputs: [{ name: 'signal' }],
  },
  Selector: {
    type: 'Selector',
    inputs: [
      { name: 'select', defaultValue: 0, min: 0, integer: true },
      { name: 'slide', defaultValue: 0, min: 0 },
      { name: '1', defaultValue: 0 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Accumulator: {
    type: 'Accumulator',
    inputs: [
      { name: 'trigger', defaultValue: 0 },
      { name: 'reset', defaultValue: 0, valueEditor: false },
      { name: 'min', defaultValue: 0 },
      { name: 'max', defaultValue: 1 },
    ],
    outputs: [{ name: 'signal' }],
  },
  Abs: processor('Abs', []),
  Map: processor('Map', [
    { name: 'srcMin', defaultValue: 0 },
    { name: 'srcMax', defaultValue: 1 },
    { name: 'trgtMin', defaultValue: 0 },
    { name: 'trgtMax', defaultValue: 1 },
  ]),
  Clamp: processor('Clamp', [
    { name: 'min', defaultValue: 0 },
    { name: 'max', defaultValue: 1 },
  ]),
  Multiply: processor('Multiply', [
    { name: 'factor', defaultValue: 1 },
  ]),
  Pow: processor('Pow', [
    { name: 'exponent', defaultValue: 1 },
  ]),
  Pan: {
    type: 'Pan',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'pan', defaultValue: 0, min: -1, max: 1 },
    ],
    outputs: [
      { name: 'left' },
      { name: 'right' },
    ],
  },
  Delay: processor('Delay', [
    { name: 'time', defaultValue: 0.28, min: 0.02, max: 1.5 },
    { name: 'feedback', defaultValue: 0.35, min: 0, max: 0.92 },
    { name: 'mix', defaultValue: 0.25, min: 0, max: 1 },
  ]),
  Chorus: processor('Chorus', [
    { name: 'rate', defaultValue: 0.8, min: 0.05, max: 6 },
    { name: 'depth', defaultValue: 0.012, min: 0.001, max: 0.04 },
    { name: 'mix', defaultValue: 0.25, min: 0, max: 1 },
  ]),
  Reverb: {
    type: 'Reverb',
    inputs: [
      { name: 'signal', valueEditor: false },
      { name: 'size', defaultValue: 0.55, min: 0.1, max: 1 },
      { name: 'decay', defaultValue: 0.45, min: 0, max: 0.94 },
      { name: 'mix', defaultValue: 0.25, min: 0, max: 1 },
    ],
    outputs: [
      { name: 'left' },
      { name: 'right' },
    ],
  },
  Envelope: processor('Envelope', [
    { name: 'trigger', valueEditor: false },
    { name: 'gate', valueEditor: false },
    { name: 'delay', defaultValue: 0, min: 0 },
    { name: 'attack', defaultValue: 0.01, min: 0 },
    { name: 'decay', defaultValue: 0.16, min: 0 },
    { name: 'sustain', defaultValue: 0.72 },
    { name: 'gateLength', defaultValue: 0, min: 0 },
    { name: 'release', defaultValue: 0.24, min: 0 },
  ]),
  Follower: processor('Follower', [
    { name: 'attack', defaultValue: 0.01, min: 0 },
    { name: 'release', defaultValue: 0.12, min: 0 },
  ]),
  RingMod: processor('RingMod', [
    { name: 'amount', defaultValue: 1 },
  ]),
  Fold: processor('Fold', [
    { name: 'amount', defaultValue: 1 },
  ]),
  Meter: processor('Meter', [
    { name: 'range', defaultValue: 1, min: 0.001 },
  ]),
  Scope: processor('Scope', [
    { name: 'range', defaultValue: 1, min: 0.001 },
    { name: 'length', defaultValue: 0.08, min: 0.01, max: 30, step: 0.01, connectable: false },
  ]),
  LowpassFilter: filter('LowpassFilter'),
  HighpassFilter: filter('HighpassFilter'),
  BandpassFilter: filter('BandpassFilter'),
  Equalizer: processor('Equalizer', [
    { name: 'lows', defaultValue: 0, min: -24, max: 24, step: 0.1 },
    { name: 'mids', defaultValue: 0, min: -24, max: 24, step: 0.1 },
    { name: 'highs', defaultValue: 0, min: -24, max: 24, step: 0.1 },
  ]),
  FormantFilter: processor('FormantFilter', [
    { name: 'morph', defaultValue: 0, min: 0, max: 1 },
    { name: 'intensity', defaultValue: 8, min: 0 },
  ]),
  CombFilter: processor('CombFilter', [
    { name: 'frequency', defaultValue: 440 },
    { name: 'feedback', defaultValue: 0.45, min: -0.999, max: 0.999 },
  ]),
  CombNotchFilter: processor('CombNotchFilter', [
    { name: 'frequency', defaultValue: 440 },
    { name: 'feedback', defaultValue: 0.45, min: -0.999, max: 0.999 },
  ]),
  HardClipDistortion: distortion('HardClipDistortion'),
  SoftClipDistortion: distortion('SoftClipDistortion'),
  FuzzDistortion: distortion('FuzzDistortion'),
  SaturateDistortion: distortion('SaturateDistortion'),
  WavefoldDistortion: distortion('WavefoldDistortion'),
};

export const NODE_TYPE_LIST = Object.keys(NODE_DEFINITIONS) as NodeType[];

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
  SamplePlayer: 'Sample',
  Buffer: 'Buffer',
  Playhead: 'Playhead',
  Constant: 'Constant',
  Pass: 'Pass',
  Slider: 'Slider',
  Button: 'Button',
  Sequencer: 'Sequencer',
  Tempo: 'Tempo',
  MidiNote: 'MIDI Note',
  MidiCc: 'MIDI CC',
  Selector: 'Selector',
  Accumulator: 'Accumulator',
  Abs: 'Abs',
  Map: 'Map',
  Clamp: 'Clamp',
  Multiply: 'Multiply',
  Pow: 'pow',
  Pan: 'Pan',
  Delay: 'Delay',
  Chorus: 'Chorus',
  Reverb: 'Reverb',
  Envelope: 'Envelope',
  Follower: 'Follower',
  RingMod: 'Ring Mod',
  Fold: 'Fold',
  Meter: 'Meter',
  Scope: 'Scope',
  LowpassFilter: 'Lowpass Filter',
  HighpassFilter: 'Highpass Filter',
  BandpassFilter: 'Bandpass Filter',
  Equalizer: 'Equaliser',
  FormantFilter: 'Formant Filter',
  CombFilter: 'Comb Filter',
  CombNotchFilter: 'Comb Notch',
  HardClipDistortion: 'Hard Clip',
  SoftClipDistortion: 'Soft Clip',
  FuzzDistortion: 'Fuzz',
  SaturateDistortion: 'Saturate',
  WavefoldDistortion: 'Wavefold',
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

  if (node.type === 'Sequencer') {
    return {
      ...getDefinition(node.type),
      inputs: node.inputs ?? getDefinition(node.type).inputs,
      outputs: sequencerOutputDefinitions(sequencerShape(node.params).rows),
    };
  }

  return {
    ...getDefinition(node.type),
    inputs: node.inputs ?? getDefinition(node.type).inputs,
    outputs: node.outputs ?? getDefinition(node.type).outputs,
  };
}

export function sequencerShape(params: Record<string, number>): { steps: number; rows: number; beatLength: number } {
  return {
    steps: clampInteger(params.steps, SEQUENCER_MIN_STEPS, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_STEPS),
    rows: clampInteger(params.rows, SEQUENCER_MIN_ROWS, SEQUENCER_MAX_ROWS, SEQUENCER_DEFAULT_ROWS),
    beatLength: clampInteger(params.beatLength, SEQUENCER_MIN_BEAT_LENGTH, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_BEAT_LENGTH),
  };
}

export function sequencerOutputName(rowIndex: number): string {
  return String(rowIndex + 1);
}

export function sequencerOutputIndex(port: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(port)) return null;
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > SEQUENCER_MAX_ROWS) return null;
  return value - 1;
}

export function sequencerCellParamName(rowIndex: number, stepIndex: number): string {
  return `cell:${rowIndex}:${stepIndex}`;
}

export function sequencerPatternValue(params: Record<string, number>, rowIndex: number, steps: number): [number, number, number, number] {
  const pattern: [number, number, number, number] = [0, 0, 0, 0];
  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    if ((params[sequencerCellParamName(rowIndex, stepIndex)] ?? 0) >= 0.5) {
      const laneIndex = Math.floor(stepIndex / 32);
      if (laneIndex < pattern.length) {
        pattern[laneIndex] += 2 ** (stepIndex % 32);
      }
    }
  }
  return pattern;
}

function sequencerOutputDefinitions(rows: number): NodeDefinition['outputs'] {
  return [
    ...Array.from({ length: rows }, (_, rowIndex) => ({ name: sequencerOutputName(rowIndex) })),
    { name: SEQUENCER_INDEX_OUTPUT },
  ];
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
      { name: 'frequency', defaultValue: 220 },
      { name: 'phase', defaultValue: 0 },
      { name: 'phaseReset', defaultValue: 0 },
      { name: 'rangeMin', defaultValue: -1 },
      { name: 'rangeMax', defaultValue: 1 },
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
    { name: 'cutoff', defaultValue: 1200, min: 0 },
    { name: 'resonance', defaultValue: 0.7, min: 0 },
  ]);
}

function distortion(type: NodeType): NodeDefinition {
  return processor(type, [
    { name: 'drive', defaultValue: 2.5, min: 0 },
  ]);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}
