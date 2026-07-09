export type NodeType =
  | 'Expression'
  | 'Group'
  | 'Ins'
  | 'Outs'
  | 'AudioOut'
  | 'SineOsc'
  | 'TriangleOsc'
  | 'SawOsc'
  | 'RampOsc'
  | 'SquareOsc'
  | 'SampleHoldOsc'
  | 'PerlinNoise'
  | 'Noise'
  | 'AudioInput'
  | 'CustomWave'
  | 'SamplePlayer'
  | 'Constant'
  | 'Slider'
  | 'Button'
  | 'MidiNote'
  | 'MidiCc'
  | 'Selector'
  | 'Accumulator'
  | 'Abs'
  | 'Map'
  | 'Clamp'
  | 'Multiply'
  | 'Delay'
  | 'Chorus'
  | 'Reverb'
  | 'Envelope'
  | 'Follower'
  | 'RingMod'
  | 'Fold'
  | 'Meter'
  | 'Scope'
  | 'LowpassFilter'
  | 'HighpassFilter'
  | 'BandpassFilter'
  | 'FormantFilter'
  | 'CombFilter'
  | 'CombNotchFilter'
  | 'HardClipDistortion'
  | 'SoftClipDistortion'
  | 'FuzzDistortion'
  | 'SaturateDistortion'
  | 'WavefoldDistortion';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PatchNode {
  id: string;
  type: NodeType;
  subpatchName?: string;
  subpatchCloneId?: string;
  expression?: string;
  sample?: SampleAsset;
  customWave?: CustomWaveSettings;
  params: Record<string, number>;
  position?: Vec2;
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
  subpatch?: Patch;
}

export interface SampleAsset {
  name: string;
  url: string;
}

export type CustomWaveMode = 'loop' | 'once' | 'ping-pong' | 'sustain' | 'sustain-loop' | 'sustain-ping-pong';

export interface CustomWavePoint {
  x: number;
  y: number;
}

export interface CustomWaveSettings {
  mode: CustomWaveMode;
  sustainStart: number;
  sustainEnd: number;
  points: CustomWavePoint[];
}

export interface Endpoint {
  node: string;
  port: string;
}

export type LinkMode = 'set' | 'add' | 'multiply';

export interface PatchLink {
  from: Endpoint;
  to: Endpoint;
  weight?: number;
  mode?: LinkMode;
}

export interface Patch {
  nodes: PatchNode[];
  links: PatchLink[];
  name?: string;
}

export interface PortDefinition {
  name: string;
  defaultValue?: number;
  connectable?: boolean;
  valueEditor?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface NodeDefinition {
  type: NodeType;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}
