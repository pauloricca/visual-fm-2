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
  | 'Image'
  | 'Buffer'
  | 'Playhead'
  | 'Time'
  | 'Constant'
  | 'Pass'
  | 'Slider'
  | 'Button'
  | 'Keys'
  | 'Sequencer'
  | 'Tempo'
  | 'MidiNote'
  | 'MidiCc'
  | 'Selector'
  | 'Accumulator'
  | 'Abs'
  | 'Map'
  | 'Clamp'
  | 'Multiply'
  | 'Pow'
  | 'Pan'
  | 'Delay'
  | 'Chorus'
  | 'Reverb'
  | 'Compress'
  | 'Envelope'
  | 'Follower'
  | 'RingMod'
  | 'Fold'
  | 'Meter'
  | 'Scope'
  | 'LowpassFilter'
  | 'HighpassFilter'
  | 'BandpassFilter'
  | 'Equalizer'
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

export interface NodeDisplaySize {
  width: number;
  height: number;
}

export interface PatchNode {
  id: string;
  type: NodeType;
  /** Optional editor label displayed instead of the type while the node is collapsed. */
  customLabel?: string;
  subpatchName?: string;
  subpatchCloneId?: string;
  expression?: string;
  sample?: SampleAsset;
  image?: ImageAsset;
  customWave?: CustomWaveSettings;
  params: Record<string, number>;
  position?: Vec2;
  /** Visual priority multiplier used by the editor; 1 is the default size. */
  scale?: number;
  scopeSize?: NodeDisplaySize;
  inputs?: PortDefinition[];
  outputs?: PortDefinition[];
  subpatch?: Patch;
  compactPorts?: boolean;
}

export interface SampleAsset {
  name: string;
  url: string;
}

export interface ImageAsset {
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
  /** Links are enabled unless explicitly disabled. */
  enabled?: boolean;
}

export interface Patch {
  nodes: PatchNode[];
  links: PatchLink[];
  name?: string;
  midiInput?: MidiInputPreferences;
}

export interface MidiInputPreferences {
  selectedDeviceIds: string[];
}

export interface PortDefinition {
  name: string;
  defaultValue?: number;
  connectable?: boolean;
  valueEditor?: boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}

export interface NodeDefinition {
  type: NodeType;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}
