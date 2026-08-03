export type NodeType =
  | 'Expression'
  | 'Group'
  | 'Spread'
  | 'Spawn'
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
  | 'Random'
  | 'AudioInput'
  | 'CustomWave'
  | 'SamplePlayer'
  | 'Image'
  | 'Buffer'
  | 'Playhead'
  | 'Time'
  | 'Freq2Length'
  | 'Length2Freq'
  | 'Constant'
  | 'Pass'
  | 'Slider'
  | 'Joystick'
  | 'Button'
  | 'Keys'
  | 'Sequencer'
  | 'Tempo'
  | 'MidiNote'
  | 'MidiNoteOn'
  | 'MidiNoteOff'
  | 'MidiCc'
  | 'Selector'
  | 'Accumulator'
  | 'Quantise'
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
  | 'Limiter'
  | 'Envelope'
  | 'Follower'
  | 'RingMod'
  | 'Fold'
  | 'Meter'
  | 'Scope'
  | 'FFT'
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
  /** Per-Group-instance values for controls projected from the shared subpatch UI. */
  subpatchUiOverrides?: Record<string, SubpatchUiNodeOverride>;
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
  /** Locked Spread/Spawn membership, mirroring an area's node snapshot. */
  spreadNodeIds?: string[];
  /** Compiler-only metadata attached to nodes cloned from a Spread or Spawn. */
  runtimeSpread?: {
    spreadId: string;
    itemIndex: number;
    originalNodeId: string;
  };
}

export interface SubpatchUiNodeOverride {
  params?: Record<string, number>;
  customWave?: CustomWaveSettings;
}

export interface SampleAsset {
  name: string;
  url: string;
  /** Original full-resolution video retained alongside an editor proxy. */
  originalUrl?: string;
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
  /** Visual editor areas owned by this patch, including subpatch control panels. */
  areas?: PatchArea[];
  name?: string;
  midiInput?: MidiInputPreferences;
}

export interface PatchArea {
  id: string;
  title: string;
  kind?: 'area' | 'spread';
  spreadNodeId?: string;
  position: Vec2;
  size: NodeDisplaySize;
  uiHeight?: number;
  collapsed?: boolean;
  locked?: boolean;
  nodeIds?: string[];
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
