const MAX_WASM_FRAMES: usize = 2048;
const MAX_NODES: usize = 512;
const MAX_LINKS: usize = 1024;
const MAX_VOICE_SLOTS: usize = 17;
const DRONE_VOICE_SLOT: usize = MAX_VOICE_SLOTS - 1;
const MAX_DELAY_SLOTS: usize = 96;
const MAX_COMB_SLOTS: usize = 96;
const MAX_DELAY_SAMPLES: usize = 8192;
const MAX_FORMANT_BANDS: usize = 3;
const MAX_CUSTOM_WAVE_POINTS: usize = 64;
const MAX_SAMPLE_SLOTS: usize = 16;
const MAX_SAMPLE_FRAMES: usize = 524_288;
const MAX_DSP_OPS: usize = 4096;
const MAX_DSP_REGS: usize = 2048;
const MAX_DSP_VALUES: usize = 2048;
const MAX_DSP_STATE: usize = 4096;
const MAX_DSP_SCOPES: usize = 32;
const MAX_DSP_METERS: usize = 128;
const MAX_DSP_EFFECT_SLOTS: usize = 64;
const MAX_DSP_DELAY_SAMPLES: usize = 65_536;
const MAX_DSP_BUFFER_SLOTS: usize = 16;
const MAX_DSP_BUFFER_SAMPLES: usize = 960_000;
const MAX_DSP_SAMPLE_NODES: usize = 128;
const LINK_SCOPE_POINTS: usize = 512;
const LINK_SCOPE_SECONDS_MAX: f64 = 30.0;
const FORMANT_INTENSITY_MAX: f64 = 36.0;
const DEFAULT_TEMPO: f64 = 120.0;
const CUSTOM_ONESHOT_EDGE_FADE_SECONDS: f64 = 0.002;
const SAMPLE_EDGE_FADE_SECONDS: f64 = 0.002;
const VOICE_START_FADE_SECONDS: f64 = 0.006;
const VOICE_STEAL_FADE_SECONDS: f64 = 0.03;
const PHASE_RESET_FADE_SECONDS: f64 = 0.008;
const DSP_VALUE_SMOOTH_SECONDS: f64 = 0.012;
const DSP_VALUE_SETTLE_EPSILON: f64 = 0.0000001;
const CUSTOM_MODE_LOOP: i32 = 0;
const CUSTOM_MODE_ONCE: i32 = 1;
const CUSTOM_MODE_PING_PONG: i32 = 2;
const CUSTOM_MODE_SUSTAIN: i32 = 3;
const CUSTOM_MODE_SUSTAIN_LOOP: i32 = 4;
const CUSTOM_MODE_SUSTAIN_PING_PONG: i32 = 5;
const SAMPLE_MODE_ONE_SHOT: i32 = 0;
const SAMPLE_MODE_LOOP: i32 = 1;
const SAMPLE_MODE_PING_PONG: i32 = 2;
const AUDIO_TARGET: i32 = -1;
const LINK_TARGET_BASE: i32 = -2;
const TWO_PI: f64 = core::f64::consts::PI * 2.0;
const ENVELOPE_TRIGGER_THRESHOLD: f64 = 0.5;
const ENVELOPE_TRIGGER_REARM: f64 = 0.45;
const TARGET_FREQUENCY: i32 = 1;
const TARGET_RING: i32 = 2;
const TARGET_FOLD: i32 = 3;
const TARGET_MIX: i32 = 4;
const TARGET_WAVE: i32 = 5;
const TARGET_PHASE_RESET_TRIGGER: i32 = 6;
const TARGET_AMPLITUDE: i32 = 10;
const TARGET_PAN: i32 = 11;
const TARGET_NOISE: i32 = 12;
const TARGET_DELAY: i32 = 13;
const TARGET_ENVELOPE_TRIGGER: i32 = 14;
const TARGET_ENVELOPE_DELAY: i32 = 15;
const TARGET_ENVELOPE_ATTACK: i32 = 16;
const TARGET_ENVELOPE_DECAY: i32 = 17;
const TARGET_ENVELOPE_SUSTAIN: i32 = 18;
const TARGET_ENVELOPE_RELEASE: i32 = 19;
const TARGET_FILTER_CUTOFF: i32 = 20;
const TARGET_FILTER_RESONANCE: i32 = 21;
const TARGET_DISTORTION_GAIN: i32 = 22;
const TARGET_SAMPLE_TRIGGER: i32 = 23;
const TARGET_SAMPLE_START: i32 = 24;
const TARGET_SAMPLE_END: i32 = 25;
const TARGET_SAMPLE_STRETCH: i32 = 26;
const TARGET_MAP_SRC_MIN: i32 = 27;
const TARGET_MAP_SRC_MAX: i32 = 28;
const TARGET_MAP_TARGET_MIN: i32 = 29;
const TARGET_MAP_TARGET_MAX: i32 = 30;
const PARAM_MODE_SET: i32 = 0;
const PARAM_MODE_ADD: i32 = 1;
const PARAM_MODE_MULTIPLY: i32 = 2;
const LINK_AMOUNT_LIMIT: f64 = 12_000.0;
const DSP_OP_VALUE: i32 = 0;
const DSP_OP_ADD: i32 = 1;
const DSP_OP_MUL: i32 = 2;
const DSP_OP_OSC: i32 = 3;
const DSP_OP_FILTER: i32 = 4;
const DSP_OP_OUTPUT: i32 = 5;
const DSP_OP_ABS: i32 = 6;
const DSP_OP_MAP: i32 = 7;
const DSP_OP_FEEDBACK_READ: i32 = 8;
const DSP_OP_FEEDBACK_WRITE: i32 = 9;
const DSP_OP_SELECT: i32 = 10;
const DSP_OP_INPUT: i32 = 11;
const DSP_OP_DELAY: i32 = 12;
const DSP_OP_CHORUS: i32 = 13;
const DSP_OP_REVERB: i32 = 14;
const DSP_OP_FOLD: i32 = 15;
const DSP_OP_SUB: i32 = 16;
const DSP_OP_DIV: i32 = 17;
const DSP_OP_NEG: i32 = 18;
const DSP_OP_ENVELOPE: i32 = 19;
const DSP_OP_FOLLOWER: i32 = 20;
const DSP_OP_HARD_CLIP: i32 = 21;
const DSP_OP_SOFT_CLIP: i32 = 22;
const DSP_OP_DISTORTION: i32 = 23;
const DSP_OP_SAMPLE: i32 = 24;
const DSP_OP_SAMPLE_PARAM: i32 = 25;
const DSP_OP_FUNCTION: i32 = 26;
const DSP_OP_MIDI_NOTE: i32 = 27;
const DSP_OP_MIDI_CC: i32 = 28;
const DSP_OP_ACCUMULATOR: i32 = 29;
const DSP_OP_BUTTON: i32 = 30;
const DSP_OP_SLEW: i32 = 31;
const DSP_OP_TEMPO: i32 = 32;
const DSP_OP_PLAYHEAD: i32 = 33;
const DSP_OP_BUFFER: i32 = 34;
const DSP_OP_SEQUENCER: i32 = 35;
const MAX_DSP_TEMPO_SOURCES: usize = 129;
const TEMPO_OUTPUT_COUNT: i32 = 10;
const DSP_TEMPO_INTERNAL_SOURCE: usize = 0;
const DSP_RENDER_FRAME_UNSET: u32 = u32::MAX;
const SEQUENCER_MIN_STEPS: i32 = 1;
const SEQUENCER_MAX_STEPS: i32 = 128;
const SEQUENCER_MIN_ROWS: i32 = 1;
const SEQUENCER_MAX_ROWS: i32 = 16;

#[derive(Copy, Clone)]
struct Node {
    wave: i32,
    frequency_mode: i32,
    ratio: f64,
    frequency: f64,
    sync_beats: f64,
    quantise_enabled: i32,
    quantise_root: i32,
    quantise_scale: i32,
    quantise_glide: f64,
    speed: f64,
    audio_input_gain: f64,
    custom_mode: i32,
    custom_sustain_start: f64,
    custom_sustain_end: f64,
    sample_mode: i32,
    sample_start: f64,
    sample_end: f64,
    sample_attack: f64,
    sample_release: f64,
    sample_stretch: f64,
    sample_cycle_length: f64,
    sample_overlap_ratio: f64,
    sample_original_frequency: f64,
}

#[derive(Copy, Clone)]
struct Link {
    from: i32,
    to: i32,
    amount: f64,
    delay: f64,
    noise: f64,
    pan: f64,
    target: i32,
    parameter_mode: i32,
    velocity_sensitivity: f64,
    drone: i32,
    signal_mode: i32,
    follower_attack: f64,
    follower_release: f64,
    map_src_min: f64,
    map_src_max: f64,
    map_target_min: f64,
    map_target_max: f64,
    filter_type: i32,
    filter_cutoff: f64,
    filter_resonance: f64,
    distortion_type: i32,
    distortion_gain: f64,
    env_delay: f64,
    env_attack: f64,
    env_decay: f64,
    env_sustain: f64,
    env_release: f64,
}

#[derive(Copy, Clone)]
struct DspOp {
    opcode: i32,
    out: i32,
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    state: i32,
    value: f64,
    value2: f64,
    value3: f64,
    value4: f64,
}

const EMPTY_NODE: Node = Node {
    wave: 0,
    frequency_mode: 0,
    ratio: 1.0,
    frequency: 440.0,
    sync_beats: 1.0,
    quantise_enabled: 0,
    quantise_root: 0,
    quantise_scale: 0,
    quantise_glide: 0.0,
    speed: 8.0,
    audio_input_gain: 1.0,
    custom_mode: CUSTOM_MODE_LOOP,
    custom_sustain_start: 0.5,
    custom_sustain_end: 0.75,
    sample_mode: SAMPLE_MODE_ONE_SHOT,
    sample_start: 0.0,
    sample_end: 1.0,
    sample_attack: 0.0,
    sample_release: 0.0,
    sample_stretch: 1.0,
    sample_cycle_length: 4096.0,
    sample_overlap_ratio: 0.09,
    sample_original_frequency: 440.0,
};

const EMPTY_LINK: Link = Link {
    from: -1,
    to: AUDIO_TARGET,
    amount: 0.0,
    delay: 0.0,
    noise: 0.0,
    pan: 0.0,
    target: 0,
    parameter_mode: PARAM_MODE_SET,
    velocity_sensitivity: 0.0,
    drone: 0,
    signal_mode: 0,
    follower_attack: 0.01,
    follower_release: 0.12,
    map_src_min: 0.0,
    map_src_max: 1.0,
    map_target_min: 0.0,
    map_target_max: 1.0,
    filter_type: 0,
    filter_cutoff: 5000.0,
    filter_resonance: 0.7,
    distortion_type: 0,
    distortion_gain: 1.5,
    env_delay: 0.0,
    env_attack: 0.01,
    env_decay: 0.16,
    env_sustain: 0.72,
    env_release: 0.24,
};

const EMPTY_DSP_OP: DspOp = DspOp {
    opcode: -1,
    out: -1,
    a: -1,
    b: -1,
    c: -1,
    d: -1,
    e: -1,
    state: -1,
    value: 0.0,
    value2: 0.0,
    value3: 0.0,
    value4: 0.0,
};

#[derive(Copy, Clone)]
struct FilterState {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

#[derive(Copy, Clone)]
struct FormantBand {
    frequency: f64,
    q: f64,
    gain_db: f64,
}

const EMPTY_FILTER_STATE: FilterState = FilterState {
    x1: 0.0,
    x2: 0.0,
    y1: 0.0,
    y2: 0.0,
};

const FORMANT_VOWELS: [[FormantBand; MAX_FORMANT_BANDS]; 5] = [
    [
        FormantBand {
            frequency: 800.0,
            q: 7.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 1150.0,
            q: 9.0,
            gain_db: -5.0,
        },
        FormantBand {
            frequency: 2900.0,
            q: 12.0,
            gain_db: -13.0,
        },
    ],
    [
        FormantBand {
            frequency: 420.0,
            q: 7.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 1750.0,
            q: 12.0,
            gain_db: -4.0,
        },
        FormantBand {
            frequency: 2600.0,
            q: 13.0,
            gain_db: -12.0,
        },
    ],
    [
        FormantBand {
            frequency: 300.0,
            q: 8.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 2200.0,
            q: 14.0,
            gain_db: -3.0,
        },
        FormantBand {
            frequency: 3000.0,
            q: 15.0,
            gain_db: -10.0,
        },
    ],
    [
        FormantBand {
            frequency: 500.0,
            q: 8.0,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 900.0,
            q: 9.0,
            gain_db: -5.0,
        },
        FormantBand {
            frequency: 2500.0,
            q: 12.0,
            gain_db: -14.0,
        },
    ],
    [
        FormantBand {
            frequency: 350.0,
            q: 8.0,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 700.0,
            q: 9.0,
            gain_db: -7.0,
        },
        FormantBand {
            frequency: 2400.0,
            q: 12.0,
            gain_db: -16.0,
        },
    ],
];

static mut LEFT: [f32; MAX_WASM_FRAMES] = [0.0; MAX_WASM_FRAMES];
static mut RIGHT: [f32; MAX_WASM_FRAMES] = [0.0; MAX_WASM_FRAMES];
static mut INPUT: [f32; MAX_WASM_FRAMES] = [0.0; MAX_WASM_FRAMES];
static mut NODES: [Node; MAX_NODES] = [EMPTY_NODE; MAX_NODES];
static mut LINKS: [Link; MAX_LINKS] = [EMPTY_LINK; MAX_LINKS];
static mut NODE_COUNT: usize = 0;
static mut LINK_COUNT: usize = 0;
static mut PHASES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] = [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut QUANTISED_FREQUENCIES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut QUANTISED_TARGETS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut QUANTISED_STEPS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut QUANTISED_REMAINING: [[u32; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut FEEDBACK: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] = [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_HOLDS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] = [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_HOLD_SET: [[bool; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[false; MAX_NODES]; MAX_VOICE_SLOTS];
static mut PERLIN_CURRENT: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut PERLIN_NEXT: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] = [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut PERLIN_SET: [[bool; MAX_NODES]; MAX_VOICE_SLOTS] = [[false; MAX_NODES]; MAX_VOICE_SLOTS];
static mut CUSTOM_WAVE_XS: [[f64; MAX_CUSTOM_WAVE_POINTS]; MAX_NODES] =
    [[0.0; MAX_CUSTOM_WAVE_POINTS]; MAX_NODES];
static mut CUSTOM_WAVE_YS: [[f64; MAX_CUSTOM_WAVE_POINTS]; MAX_NODES] =
    [[0.0; MAX_CUSTOM_WAVE_POINTS]; MAX_NODES];
static mut CUSTOM_WAVE_COUNTS: [usize; MAX_NODES] = [0; MAX_NODES];
static mut CUSTOM_WAVE_DONE: [[bool; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[false; MAX_NODES]; MAX_VOICE_SLOTS];
static mut CUSTOM_WAVE_DIRECTIONS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[1.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut CUSTOM_WAVE_TRIGGERED: [[bool; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[false; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_SLOT_FOR_NODE: [i32; MAX_NODES] = [-1; MAX_NODES];
static mut SAMPLE_DATA: [[f32; MAX_SAMPLE_FRAMES]; MAX_SAMPLE_SLOTS] =
    [[0.0; MAX_SAMPLE_FRAMES]; MAX_SAMPLE_SLOTS];
static mut SAMPLE_LENGTHS: [usize; MAX_SAMPLE_SLOTS] = [0; MAX_SAMPLE_SLOTS];
static mut SAMPLE_RATES: [f64; MAX_SAMPLE_SLOTS] = [44_100.0; MAX_SAMPLE_SLOTS];
static mut DSP_OPS: [DspOp; MAX_DSP_OPS] = [EMPTY_DSP_OP; MAX_DSP_OPS];
static mut DSP_OP_COUNT: usize = 0;
static mut DSP_VALUES: [f64; MAX_DSP_VALUES] = [0.0; MAX_DSP_VALUES];
static mut DSP_VALUE_TARGETS: [f64; MAX_DSP_VALUES] = [0.0; MAX_DSP_VALUES];
static mut DSP_VALUE_INITIALIZED: [bool; MAX_DSP_VALUES] = [false; MAX_DSP_VALUES];
static mut DSP_VALUE_ACTIVE_COUNT: usize = 0;
static mut DSP_REGS: [f64; MAX_DSP_REGS] = [0.0; MAX_DSP_REGS];
static mut DSP_STATE: [f64; MAX_DSP_STATE] = [0.0; MAX_DSP_STATE];
static mut DSP_VOICE_STATES: [[f64; MAX_DSP_STATE]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_DSP_STATE]; MAX_VOICE_SLOTS];
static mut DSP_CURRENT_NOTE: f64 = 0.0;
static mut DSP_CURRENT_CHANNEL: f64 = 1.0;
static mut DSP_CURRENT_FREQUENCY: f64 = 0.0;
static mut DSP_CURRENT_VELOCITY: f64 = 0.0;
static mut DSP_CURRENT_GATE: f64 = 0.0;
static mut DSP_CURRENT_TRIGGER: f64 = 0.0;
static mut DSP_MIDI_CC_VALUES: [[f64; 128]; 17] = [[0.0; 128]; 17];
static mut DSP_TEMPO_BPM: f64 = 120.0;
static mut DSP_TEMPO_BPM_BY_SOURCE: [f64; MAX_DSP_TEMPO_SOURCES] = [120.0; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_BEATS_BY_SOURCE: [f64; MAX_DSP_TEMPO_SOURCES] = [0.0; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE: [f64; MAX_DSP_TEMPO_SOURCES] =
    [0.0; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_STARTED_BY_SOURCE: [bool; MAX_DSP_TEMPO_SOURCES] =
    [false; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE: [bool; MAX_DSP_TEMPO_SOURCES] =
    [false; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_LAST_QUANTUM_BY_SOURCE: [u32; MAX_DSP_TEMPO_SOURCES] =
    [0; MAX_DSP_TEMPO_SOURCES];
static mut DSP_TEMPO_LAST_FRAME_BY_SOURCE: [u32; MAX_DSP_TEMPO_SOURCES] =
    [DSP_RENDER_FRAME_UNSET; MAX_DSP_TEMPO_SOURCES];
static mut DSP_RENDER_QUANTUM_ID: u32 = 1;
static mut DSP_SCOPE_REGS: [i32; MAX_DSP_SCOPES] = [-1; MAX_DSP_SCOPES];
static mut DSP_SCOPE_SAMPLES: [[f32; LINK_SCOPE_POINTS]; MAX_DSP_SCOPES] =
    [[0.0; LINK_SCOPE_POINTS]; MAX_DSP_SCOPES];
static mut DSP_SCOPE_POINTS_ACTIVE: [usize; MAX_DSP_SCOPES] = [256; MAX_DSP_SCOPES];
static mut DSP_SCOPE_DECIMATE: [u32; MAX_DSP_SCOPES] = [1; MAX_DSP_SCOPES];
static mut DSP_SCOPE_DECIMATE_COUNTERS: [u32; MAX_DSP_SCOPES] = [0; MAX_DSP_SCOPES];
static mut DSP_SCOPE_COUNTS: [u32; MAX_DSP_SCOPES] = [0; MAX_DSP_SCOPES];
static mut DSP_SCOPE_WRITE_INDICES: [u32; MAX_DSP_SCOPES] = [0; MAX_DSP_SCOPES];
static mut DSP_METER_REGS: [i32; MAX_DSP_METERS] = [-1; MAX_DSP_METERS];
static mut DSP_METER_SUMS: [f64; MAX_DSP_METERS] = [0.0; MAX_DSP_METERS];
static mut DSP_METER_COUNTS: [u32; MAX_DSP_METERS] = [0; MAX_DSP_METERS];
static mut DSP_EFFECT_BUFFERS: [[f32; MAX_DSP_DELAY_SAMPLES]; MAX_DSP_EFFECT_SLOTS] =
    [[0.0; MAX_DSP_DELAY_SAMPLES]; MAX_DSP_EFFECT_SLOTS];
static mut DSP_EFFECT_INDICES: [usize; MAX_DSP_EFFECT_SLOTS] = [0; MAX_DSP_EFFECT_SLOTS];
static mut DSP_BUFFER_BUFFERS: [[f32; MAX_DSP_BUFFER_SAMPLES]; MAX_DSP_BUFFER_SLOTS] =
    [[0.0; MAX_DSP_BUFFER_SAMPLES]; MAX_DSP_BUFFER_SLOTS];
static mut DSP_BUFFER_STATE_SLOTS: [i32; MAX_DSP_STATE] = [-1; MAX_DSP_STATE];
static mut DSP_BUFFER_SLOT_STATES: [i32; MAX_DSP_BUFFER_SLOTS] = [-1; MAX_DSP_BUFFER_SLOTS];
static mut DSP_SAMPLE_NODE_INDICES: [i32; MAX_DSP_SAMPLE_NODES] = [-1; MAX_DSP_SAMPLE_NODES];
static mut SAMPLE_PLAYING: [[bool; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[false; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_POSITIONS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_DIRECTIONS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[1.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_PLAYBACK_AGES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_RELEASE_AGES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[-1.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_START_VALUES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_STRETCH_PHASES: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_STRETCH_ANCHORS: [[f64; MAX_NODES]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_NODES]; MAX_VOICE_SLOTS];
static mut SAMPLE_STRETCH_MODS: [f64; MAX_NODES] = [0.0; MAX_NODES];
static mut LINK_DELAY_SLOTS: [i32; MAX_LINKS] = [-1; MAX_LINKS];
static mut LINK_DELAY_SLOT_COUNT: usize = 0;
static mut LINK_COMB_SLOTS: [i32; MAX_LINKS] = [-1; MAX_LINKS];
static mut LINK_COMB_SLOT_COUNT: usize = 0;
static mut LINK_FIRST_MODULATOR: [i32; MAX_LINKS] = [-1; MAX_LINKS];
static mut LINK_NEXT_MODULATOR: [i32; MAX_LINKS] = [-1; MAX_LINKS];
static mut LINK_HAS_ENVELOPE_TRIGGER: [bool; MAX_LINKS] = [false; MAX_LINKS];
static mut LINK_DELAY_BUFFERS: [[[f32; MAX_DELAY_SAMPLES]; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS] =
    [[[0.0; MAX_DELAY_SAMPLES]; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_DELAY_INDICES: [[usize; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS] =
    [[0; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_DELAY_READY: [[bool; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS] =
    [[false; MAX_DELAY_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_COMB_BUFFERS: [[[f32; MAX_DELAY_SAMPLES]; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS] =
    [[[0.0; MAX_DELAY_SAMPLES]; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_COMB_INDICES: [[usize; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS] =
    [[0; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_COMB_READY: [[bool; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS] =
    [[false; MAX_COMB_SLOTS]; MAX_VOICE_SLOTS];
static mut LINK_TRIGGER_ARMED: [[bool; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[true; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut LINK_TRIGGER_START_AGE: [[f64; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[-1.0; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut LINK_TRIGGER_RELEASE_AGE: [[f64; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[-1.0; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut LINK_FOLLOWERS: [[f64; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[0.0; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut LINK_FILTERS: [[FilterState; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[EMPTY_FILTER_STATE; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut LINK_FORMANT_FILTERS: [[[FilterState; MAX_FORMANT_BANDS]; MAX_LINKS]; MAX_VOICE_SLOTS] =
    [[[EMPTY_FILTER_STATE; MAX_FORMANT_BANDS]; MAX_LINKS]; MAX_VOICE_SLOTS];
static mut RNG_STATES: [u32; MAX_VOICE_SLOTS] = [
    0x1234_5678,
    0x2345_6789,
    0x3456_789a,
    0x4567_89ab,
    0x5678_9abc,
    0x6789_abcd,
    0x789a_bcde,
    0x89ab_cdef,
    0x9abc_def0,
    0xabcd_ef01,
    0xbcde_f012,
    0xcdef_0123,
    0xdef0_1234,
    0xef01_2345,
    0xf012_3456,
    0x1020_3040,
    0x5060_7080,
];
static mut FREQUENCY_MODS: [f64; MAX_NODES] = [0.0; MAX_NODES];
static mut FREQUENCY_MOD_ACTIVE: [bool; MAX_NODES] = [false; MAX_NODES];
static mut RENDER_CACHE: [f64; MAX_NODES] = [0.0; MAX_NODES];
static mut CACHE_STAMPS: [u32; MAX_NODES] = [0; MAX_NODES];
static mut RENDER_STACK: [bool; MAX_NODES] = [false; MAX_NODES];
static mut LINK_PARAM_STACK: [bool; MAX_LINKS] = [false; MAX_LINKS];
static mut LINK_METER_INPUT_SUMS: [f64; MAX_LINKS] = [0.0; MAX_LINKS];
static mut LINK_METER_OUTPUT_SUMS: [f64; MAX_LINKS] = [0.0; MAX_LINKS];
static mut LINK_METER_ENVELOPE_SUMS: [f64; MAX_LINKS] = [0.0; MAX_LINKS];
static mut LINK_METER_COUNTS: [u32; MAX_LINKS] = [0; MAX_LINKS];
static mut LINK_SCOPE_SAMPLES: [f32; LINK_SCOPE_POINTS] = [0.0; LINK_SCOPE_POINTS];
static mut LINK_SCOPE_LINK_INDEX: i32 = -1;
static mut LINK_SCOPE_MODE: i32 = 0;
static mut LINK_SCOPE_POINTS_ACTIVE: usize = 256;
static mut LINK_SCOPE_DECIMATE: u32 = 1;
static mut LINK_SCOPE_DECIMATE_COUNTER: u32 = 0;
static mut LINK_SCOPE_COUNT: u32 = 0;
static mut LINK_SCOPE_WRITE_INDEX: u32 = 0;
static mut LINK_SCOPE_LAST_ENVELOPE: f64 = 0.0;
static mut LINK_SCOPE_CAPTURE_ACTIVE: bool = false;
static mut CURRENT_STAMP: u32 = 1;
static mut TEMPO: f64 = DEFAULT_TEMPO;

#[no_mangle]
pub extern "C" fn leftPtr() -> *const f32 {
    core::ptr::addr_of!(LEFT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn rightPtr() -> *const f32 {
    core::ptr::addr_of!(RIGHT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn inputPtr() -> *mut f32 {
    core::ptr::addr_of_mut!(INPUT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn linkMeterInputPtr() -> *const f64 {
    core::ptr::addr_of!(LINK_METER_INPUT_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterOutputPtr() -> *const f64 {
    core::ptr::addr_of!(LINK_METER_OUTPUT_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterEnvelopePtr() -> *const f64 {
    core::ptr::addr_of!(LINK_METER_ENVELOPE_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterCountPtr() -> *const u32 {
    core::ptr::addr_of!(LINK_METER_COUNTS).cast::<u32>()
}

#[no_mangle]
pub extern "C" fn linkScopePtr() -> *const f32 {
    core::ptr::addr_of!(LINK_SCOPE_SAMPLES).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn linkScopeCount() -> u32 {
    unsafe { LINK_SCOPE_COUNT }
}

#[no_mangle]
pub extern "C" fn linkScopeWriteIndex() -> u32 {
    unsafe { LINK_SCOPE_WRITE_INDEX }
}

#[no_mangle]
pub extern "C" fn maxSampleFrames() -> u32 {
    MAX_SAMPLE_FRAMES as u32
}

#[no_mangle]
pub extern "C" fn sampleDataPtr(slot: u32) -> *mut f32 {
    let slot = slot as usize;
    if slot >= MAX_SAMPLE_SLOTS {
        return core::ptr::null_mut();
    }
    unsafe { core::ptr::addr_of_mut!(SAMPLE_DATA[slot]).cast::<f32>() }
}

#[no_mangle]
pub extern "C" fn setSampleData(node_index: i32, sample_rate: f64, length: u32) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= NODE_COUNT {
            return -1;
        }
        let node_index = node_index as usize;
        let existing = SAMPLE_SLOT_FOR_NODE[node_index];
        let slot = if existing >= 0 {
            existing as usize
        } else {
            let mut free_slot = None;
            'outer: for slot_index in 0..MAX_SAMPLE_SLOTS {
                for node_slot in 0..MAX_NODES {
                    if SAMPLE_SLOT_FOR_NODE[node_slot] == slot_index as i32 {
                        continue 'outer;
                    }
                }
                free_slot = Some(slot_index);
                break;
            }
            match free_slot {
                Some(slot_index) => {
                    SAMPLE_SLOT_FOR_NODE[node_index] = slot_index as i32;
                    slot_index
                }
                None => return -1,
            }
        };
        SAMPLE_LENGTHS[slot] = (length as usize).min(MAX_SAMPLE_FRAMES);
        SAMPLE_RATES[slot] = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn clear(frames: u32) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    let left = core::ptr::addr_of_mut!(LEFT).cast::<f32>();
    let right = core::ptr::addr_of_mut!(RIGHT).cast::<f32>();

    for index in 0..frames {
        unsafe {
            *left.add(index) = 0.0;
            *right.add(index) = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn beginDspRenderQuantum() {
    unsafe {
        DSP_RENDER_QUANTUM_ID = DSP_RENDER_QUANTUM_ID.wrapping_add(1);
        if DSP_RENDER_QUANTUM_ID == 0 {
            DSP_RENDER_QUANTUM_ID = 1;
            for index in 0..MAX_DSP_TEMPO_SOURCES {
                DSP_TEMPO_LAST_QUANTUM_BY_SOURCE[index] = 0;
                DSP_TEMPO_LAST_FRAME_BY_SOURCE[index] = DSP_RENDER_FRAME_UNSET;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn clearGraph() {
    unsafe {
        NODE_COUNT = 0;
        LINK_COUNT = 0;
        LINK_SCOPE_LINK_INDEX = -1;
        reset_link_scope();
        LINK_DELAY_SLOT_COUNT = 0;
        LINK_COMB_SLOT_COUNT = 0;
        for index in 0..MAX_LINKS {
            LINK_DELAY_SLOTS[index] = -1;
            LINK_COMB_SLOTS[index] = -1;
            LINK_FIRST_MODULATOR[index] = -1;
            LINK_NEXT_MODULATOR[index] = -1;
            LINK_HAS_ENVELOPE_TRIGGER[index] = false;
        }
        for index in 0..MAX_NODES {
            CUSTOM_WAVE_COUNTS[index] = 0;
            SAMPLE_SLOT_FOR_NODE[index] = -1;
            SAMPLE_STRETCH_MODS[index] = 0.0;
            FREQUENCY_MODS[index] = 0.0;
            FREQUENCY_MOD_ACTIVE[index] = false;
        }
    }
}

fn clear_dsp_buffers() {
    unsafe {
        for state in 0..MAX_DSP_STATE {
            DSP_BUFFER_STATE_SLOTS[state] = -1;
        }
        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            DSP_BUFFER_SLOT_STATES[slot] = -1;
            for index in 0..MAX_DSP_BUFFER_SAMPLES {
                DSP_BUFFER_BUFFERS[slot][index] = 0.0;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn clearDspProgram() {
    unsafe {
        DSP_OP_COUNT = 0;
        DSP_VALUE_ACTIVE_COUNT = 0;
        for index in 0..MAX_DSP_REGS {
            DSP_REGS[index] = 0.0;
        }
        for index in 0..MAX_DSP_STATE {
            DSP_STATE[index] = 0.0;
        }
        for slot in 0..MAX_VOICE_SLOTS {
            for index in 0..MAX_DSP_STATE {
                DSP_VOICE_STATES[slot][index] = 0.0;
            }
        }
        for index in 0..MAX_DSP_VALUES {
            DSP_VALUE_INITIALIZED[index] = false;
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            DSP_EFFECT_INDICES[slot] = 0;
            for index in 0..MAX_DSP_DELAY_SAMPLES {
                DSP_EFFECT_BUFFERS[slot][index] = 0.0;
            }
        }
        clear_dsp_buffers();
        for index in 0..MAX_DSP_SAMPLE_NODES {
            DSP_SAMPLE_NODE_INDICES[index] = -1;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspVoiceState(slot: u32) {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_VOICE_SLOTS {
            return;
        }
        for index in 0..MAX_DSP_STATE {
            DSP_VOICE_STATES[slot][index] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspRuntimeState() {
    unsafe {
        for index in 0..MAX_DSP_REGS {
            DSP_REGS[index] = 0.0;
        }
        for index in 0..MAX_DSP_STATE {
            DSP_STATE[index] = 0.0;
        }
        for slot in 0..MAX_VOICE_SLOTS {
            for index in 0..MAX_DSP_STATE {
                DSP_VOICE_STATES[slot][index] = 0.0;
            }
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            DSP_EFFECT_INDICES[slot] = 0;
            for index in 0..MAX_DSP_DELAY_SAMPLES {
                DSP_EFFECT_BUFFERS[slot][index] = 0.0;
            }
        }
        clear_dsp_buffers();
        reset_dsp_tempo_clocks();
    }
}

fn reset_dsp_tempo_clocks() {
    unsafe {
        for index in 0..MAX_DSP_TEMPO_SOURCES {
            DSP_TEMPO_BEATS_BY_SOURCE[index] = 0.0;
            DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE[index] = 0.0;
            DSP_TEMPO_STARTED_BY_SOURCE[index] = false;
            DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE[index] = false;
            DSP_TEMPO_LAST_QUANTUM_BY_SOURCE[index] = 0;
            DSP_TEMPO_LAST_FRAME_BY_SOURCE[index] = DSP_RENDER_FRAME_UNSET;
        }
        DSP_RENDER_QUANTUM_ID = 1;
    }
}

#[no_mangle]
pub extern "C" fn setDspMidiCc(channel: u32, cc: u32, value: f64) {
    unsafe {
        let channel = (channel as usize).min(16);
        let cc = cc as usize;
        if cc < 128 {
            let value = if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                0.0
            };
            DSP_MIDI_CC_VALUES[0][cc] = value;
            DSP_MIDI_CC_VALUES[channel][cc] = value;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspTempo(bpm: f64) {
    unsafe {
        DSP_TEMPO_BPM = if bpm.is_finite() {
            bpm.clamp(1.0, 999.0)
        } else {
            120.0
        };
        DSP_TEMPO_BPM_BY_SOURCE[0] = DSP_TEMPO_BPM;
    }
}

#[no_mangle]
pub extern "C" fn setDspTempoSource(source_index: u32, bpm: f64) {
    unsafe {
        let source_index = (source_index as usize).min(MAX_DSP_TEMPO_SOURCES - 1);
        let bpm = if bpm.is_finite() {
            bpm.clamp(1.0, 999.0)
        } else {
            120.0
        };
        DSP_TEMPO_BPM_BY_SOURCE[source_index] = bpm;
        if source_index == 0 {
            DSP_TEMPO_BPM = bpm;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspSampleNode(slot: u32, node_index: i32) -> i32 {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_SAMPLE_NODES || node_index < 0 || node_index as usize >= MAX_NODES {
            return -1;
        }
        DSP_SAMPLE_NODE_INDICES[slot] = node_index;
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspSamplePlayhead(slot: u32) -> f64 {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_SAMPLE_NODES {
            return -1.0;
        }
        let node_index = DSP_SAMPLE_NODE_INDICES[slot];
        if node_index < 0 || node_index as usize >= MAX_NODES {
            return -1.0;
        }
        let node_index = node_index as usize;
        if !SAMPLE_PLAYING[DRONE_VOICE_SLOT][node_index] {
            return -1.0;
        }
        let Some(sample_slot) = sample_slot_for_node(node_index) else {
            return -1.0;
        };
        let length = SAMPLE_LENGTHS[sample_slot];
        if length <= 1 {
            return -1.0;
        }
        (SAMPLE_POSITIONS[DRONE_VOICE_SLOT][node_index] / (length - 1) as f64).clamp(0.0, 1.0)
    }
}

#[no_mangle]
pub extern "C" fn getDspState(index: u32) -> f64 {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_STATE {
            DSP_STATE[index]
        } else {
            0.0
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspState(index: u32, value: f64) {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_STATE {
            DSP_STATE[index] = if value.is_finite() {
                value.clamp(-12_000.0, 12_000.0)
            } else {
                0.0
            };
        }
    }
}

fn reset_dsp_scope(slot: usize) {
    unsafe {
        DSP_SCOPE_DECIMATE_COUNTERS[slot] = 0;
        DSP_SCOPE_COUNTS[slot] = 0;
        DSP_SCOPE_WRITE_INDICES[slot] = 0;
        for index in 0..LINK_SCOPE_POINTS {
            DSP_SCOPE_SAMPLES[slot][index] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn clearDspScopes() {
    unsafe {
        for slot in 0..MAX_DSP_SCOPES {
            DSP_SCOPE_REGS[slot] = -1;
            DSP_SCOPE_POINTS_ACTIVE[slot] = 256;
            DSP_SCOPE_DECIMATE[slot] = 1;
            reset_dsp_scope(slot);
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspScope(
    slot: u32,
    register: i32,
    seconds: f64,
    points: u32,
    sample_rate: f64,
) -> i32 {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_SCOPES || register < 0 || register as usize >= MAX_DSP_REGS {
            return -1;
        }
        let safe_seconds = if seconds.is_finite() {
            seconds.clamp(0.01, LINK_SCOPE_SECONDS_MAX)
        } else {
            0.08
        };
        let safe_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        let active_points = (points as usize).clamp(32, LINK_SCOPE_POINTS);

        DSP_SCOPE_REGS[slot] = register;
        DSP_SCOPE_POINTS_ACTIVE[slot] = active_points;
        DSP_SCOPE_DECIMATE[slot] = ((safe_seconds * safe_rate) / active_points as f64)
            .round()
            .max(1.0) as u32;
        reset_dsp_scope(slot);
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspScopePtr(slot: u32) -> *const f32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return core::ptr::null();
    }
    unsafe { core::ptr::addr_of!(DSP_SCOPE_SAMPLES[slot][0]) }
}

#[no_mangle]
pub extern "C" fn dspScopeCount(slot: u32) -> u32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return 0;
    }
    unsafe { DSP_SCOPE_COUNTS[slot] }
}

#[no_mangle]
pub extern "C" fn dspScopeWriteIndex(slot: u32) -> u32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return 0;
    }
    unsafe { DSP_SCOPE_WRITE_INDICES[slot] }
}

#[no_mangle]
pub extern "C" fn clearDspMeters() {
    unsafe {
        for slot in 0..MAX_DSP_METERS {
            DSP_METER_REGS[slot] = -1;
            DSP_METER_SUMS[slot] = 0.0;
            DSP_METER_COUNTS[slot] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspMeterLevels() {
    unsafe {
        for slot in 0..MAX_DSP_METERS {
            DSP_METER_SUMS[slot] = 0.0;
            DSP_METER_COUNTS[slot] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspMeter(slot: u32, register: i32) -> i32 {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_METERS || register < 0 || register as usize >= MAX_DSP_REGS {
            return -1;
        }
        DSP_METER_REGS[slot] = register;
        DSP_METER_SUMS[slot] = 0.0;
        DSP_METER_COUNTS[slot] = 0;
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspMeterLevel(slot: u32) -> f64 {
    let slot = slot as usize;
    if slot >= MAX_DSP_METERS {
        return 0.0;
    }
    unsafe {
        if DSP_METER_COUNTS[slot] == 0 {
            0.0
        } else {
            DSP_METER_SUMS[slot] / DSP_METER_COUNTS[slot] as f64
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspValue(index: u32, value: f64) {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_VALUES {
            let value = if value.is_finite() { value } else { 0.0 };
            DSP_VALUE_TARGETS[index] = value;
            if !DSP_VALUE_INITIALIZED[index] {
                DSP_VALUES[index] = value;
                DSP_VALUE_INITIALIZED[index] = true;
            }
            DSP_VALUE_ACTIVE_COUNT = DSP_VALUE_ACTIVE_COUNT.max(index + 1);
        }
    }
}

#[no_mangle]
pub extern "C" fn addDspOp(
    opcode: i32,
    out: i32,
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    state: i32,
    value: f64,
    value2: f64,
    value3: f64,
    value4: f64,
) -> i32 {
    unsafe {
        if DSP_OP_COUNT >= MAX_DSP_OPS {
            return -1;
        }
        let index = DSP_OP_COUNT;
        DSP_OPS[index] = DspOp {
            opcode,
            out,
            a,
            b,
            c,
            d,
            e,
            state,
            value,
            value2,
            value3,
            value4,
        };
        DSP_OP_COUNT += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn clearLinkMeters() {
    unsafe {
        for index in 0..MAX_LINKS {
            LINK_METER_INPUT_SUMS[index] = 0.0;
            LINK_METER_OUTPUT_SUMS[index] = 0.0;
            LINK_METER_ENVELOPE_SUMS[index] = 0.0;
            LINK_METER_COUNTS[index] = 0;
        }
    }
}

fn reset_link_scope() {
    unsafe {
        for index in 0..LINK_SCOPE_POINTS {
            LINK_SCOPE_SAMPLES[index] = 0.0;
        }
        LINK_SCOPE_DECIMATE_COUNTER = 0;
        LINK_SCOPE_COUNT = 0;
        LINK_SCOPE_WRITE_INDEX = 0;
        LINK_SCOPE_LAST_ENVELOPE = 0.0;
        LINK_SCOPE_CAPTURE_ACTIVE = false;
    }
}

#[no_mangle]
pub extern "C" fn setLinkScope(
    link_index: i32,
    mode: i32,
    seconds: f64,
    points: u32,
    sample_rate: f64,
) {
    unsafe {
        if link_index < 0 || link_index as usize >= LINK_COUNT {
            LINK_SCOPE_LINK_INDEX = -1;
            reset_link_scope();
            return;
        }
        LINK_SCOPE_LINK_INDEX = link_index;
        LINK_SCOPE_MODE = if mode == 1 || mode == 2 { mode } else { 0 };
        LINK_SCOPE_POINTS_ACTIVE = (points as usize).clamp(32, LINK_SCOPE_POINTS);
        let safe_seconds = if seconds.is_finite() {
            seconds.clamp(0.01, LINK_SCOPE_SECONDS_MAX)
        } else {
            0.08
        };
        let safe_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        LINK_SCOPE_DECIMATE = ((safe_seconds * safe_rate) / LINK_SCOPE_POINTS_ACTIVE as f64)
            .round()
            .max(1.0) as u32;
        reset_link_scope();
    }
}

#[no_mangle]
pub extern "C" fn addNode(
    wave: i32,
    frequency_mode: i32,
    ratio: f64,
    frequency: f64,
    sync_beats: f64,
    quantise_enabled: i32,
    quantise_root: i32,
    quantise_scale: i32,
    quantise_glide: f64,
    speed: f64,
    audio_input_gain: f64,
    custom_mode: i32,
    custom_sustain_start: f64,
    custom_sustain_end: f64,
    sample_mode: i32,
    sample_start: f64,
    sample_end: f64,
    sample_stretch: f64,
    sample_cycle_length: f64,
    sample_overlap_ratio: f64,
    sample_original_frequency: f64,
    sample_attack: f64,
    sample_release: f64,
) -> i32 {
    unsafe {
        if NODE_COUNT >= MAX_NODES {
            return -1;
        }
        let index = NODE_COUNT;
        NODES[index] = Node {
            wave,
            frequency_mode: frequency_mode.clamp(0, 2),
            ratio: ratio.clamp(0.0, 16.0),
            frequency: if wave == 11 {
                frequency.clamp(-1.0, 1.0)
            } else {
                frequency.clamp(0.0, 12_000.0)
            },
            sync_beats: sync_beats.clamp(1.0 / 64.0, 64.0),
            quantise_enabled: if quantise_enabled != 0 { 1 } else { 0 },
            quantise_root: quantise_root.clamp(-1, 11),
            quantise_scale: quantise_scale.clamp(0, 8),
            quantise_glide: quantise_glide.clamp(0.0, 4.0),
            speed: speed.clamp(0.01, 60.0),
            audio_input_gain: audio_input_gain.clamp(0.0, 4.0),
            custom_mode: custom_mode.clamp(CUSTOM_MODE_LOOP, CUSTOM_MODE_SUSTAIN_PING_PONG),
            custom_sustain_start: custom_sustain_start.clamp(0.0, 0.999),
            custom_sustain_end: custom_sustain_end
                .clamp((custom_sustain_start + 0.001).clamp(0.001, 1.0), 1.0),
            sample_mode: sample_mode.clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG),
            sample_start: sample_start.clamp(0.0, 1.0),
            sample_end: sample_end.clamp(0.0, 1.0),
            sample_attack: sample_attack.max(0.0),
            sample_release: sample_release.max(0.0),
            sample_stretch: sample_stretch.max(0.001),
            sample_cycle_length: sample_cycle_length.round().max(1.0),
            sample_overlap_ratio: sample_overlap_ratio.clamp(0.0, 1.0),
            sample_original_frequency: sample_original_frequency.max(0.0001),
        };
        CUSTOM_WAVE_COUNTS[index] = 0;
        SAMPLE_SLOT_FOR_NODE[index] = -1;
        NODE_COUNT += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn addCustomWavePoint(node_index: i32, x: f64, y: f64) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= NODE_COUNT {
            return -1;
        }
        let node_index = node_index as usize;
        let count = CUSTOM_WAVE_COUNTS[node_index];
        if count >= MAX_CUSTOM_WAVE_POINTS {
            return -1;
        }
        CUSTOM_WAVE_XS[node_index][count] = x.clamp(0.0, 1.0);
        CUSTOM_WAVE_YS[node_index][count] = y.clamp(-1.0, 1.0);
        CUSTOM_WAVE_COUNTS[node_index] = count + 1;
        count as i32
    }
}

#[no_mangle]
pub extern "C" fn setNodeFrequencyMode(index: u32, frequency_mode: i32) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].frequency_mode = frequency_mode.clamp(0, 2);
        }
    }
}

#[no_mangle]
pub extern "C" fn setTempo(tempo: f64) {
    unsafe {
        TEMPO = tempo.clamp(20.0, 300.0);
    }
}

#[no_mangle]
pub extern "C" fn setNodeSyncBeats(index: u32, sync_beats: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sync_beats = sync_beats.clamp(1.0 / 64.0, 64.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeRatio(index: u32, ratio: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].ratio = ratio.clamp(0.0, 16.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeFrequency(index: u32, frequency: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].frequency = if NODES[index as usize].wave == 11 {
                frequency.clamp(-1.0, 1.0)
            } else {
                frequency.clamp(0.0, 12_000.0)
            };
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseEnabled(index: u32, enabled: i32) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].quantise_enabled = if enabled != 0 { 1 } else { 0 };
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseRoot(index: u32, root: i32) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].quantise_root = root.clamp(-1, 11);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseScale(index: u32, scale: i32) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].quantise_scale = scale.clamp(0, 8);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseGlide(index: u32, glide: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].quantise_glide = glide.clamp(0.0, 4.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSpeed(index: u32, speed: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].speed = speed.clamp(0.01, 60.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeAudioInputGain(index: u32, gain: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].audio_input_gain = gain.clamp(0.0, 4.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleMode(index: u32, mode: i32) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_mode =
                mode.clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleStart(index: u32, start: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_start = start.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleEnd(index: u32, end: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_end = end.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleStretch(index: u32, stretch: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_stretch = stretch.max(0.001);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleCycleLength(index: u32, cycle_length: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_cycle_length = cycle_length.round().max(1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleOverlapRatio(index: u32, overlap_ratio: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_overlap_ratio = overlap_ratio.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleOriginalFrequency(index: u32, frequency: f64) {
    unsafe {
        if (index as usize) < NODE_COUNT {
            NODES[index as usize].sample_original_frequency = frequency.max(0.0001);
        }
    }
}

fn clamp_link_amount(amount: f64) -> f64 {
    amount.clamp(-LINK_AMOUNT_LIMIT, LINK_AMOUNT_LIMIT)
}

#[no_mangle]
pub extern "C" fn addLink(
    from: i32,
    to: i32,
    amount: f64,
    delay: f64,
    noise: f64,
    pan: f64,
    target: i32,
    parameter_mode: i32,
    velocity_sensitivity: f64,
    drone: i32,
    signal_mode: i32,
    follower_attack: f64,
    follower_release: f64,
    filter_type: i32,
    filter_cutoff: f64,
    filter_resonance: f64,
    distortion_type: i32,
    distortion_gain: f64,
    env_delay: f64,
    env_attack: f64,
    env_decay: f64,
    env_sustain: f64,
    env_release: f64,
    map_src_min: f64,
    map_src_max: f64,
    map_target_min: f64,
    map_target_max: f64,
) -> i32 {
    unsafe {
        if LINK_COUNT >= MAX_LINKS || from < 0 || from as usize >= NODE_COUNT {
            return -1;
        }
        if to >= 0 && to as usize >= NODE_COUNT {
            return -1;
        }
        if to < AUDIO_TARGET {
            let target_index = link_target_index(to);
            if target_index.is_none() || target_index.unwrap() >= MAX_LINKS {
                return -1;
            }
        } else if to != AUDIO_TARGET && to < 0 {
            return -1;
        }
        let index = LINK_COUNT;
        LINKS[index] = Link {
            from,
            to,
            amount: clamp_link_amount(amount),
            delay: delay.clamp(0.0, 3.0),
            noise: noise.clamp(0.0, 1.0),
            pan: pan.clamp(-1.0, 1.0),
            target,
            parameter_mode: parameter_mode.clamp(PARAM_MODE_SET, PARAM_MODE_MULTIPLY),
            velocity_sensitivity: velocity_sensitivity.clamp(-8.0, 8.0),
            drone,
            signal_mode,
            follower_attack: follower_attack.clamp(0.001, 2.0),
            follower_release: follower_release.clamp(0.001, 4.0),
            filter_type,
            filter_cutoff: if filter_type == 4 {
                filter_cutoff.clamp(0.0, 1.0)
            } else if filter_type == 5 || filter_type == 6 {
                filter_cutoff.clamp(20.0, 5_000.0)
            } else {
                filter_cutoff.clamp(20.0, 12_000.0)
            },
            filter_resonance: filter_resonance.clamp(
                if filter_type == 5 || filter_type == 6 {
                    -0.98
                } else {
                    0.1
                },
                if filter_type == 4 {
                    FORMANT_INTENSITY_MAX
                } else if filter_type == 5 || filter_type == 6 {
                    0.98
                } else {
                    12.0
                },
            ),
            distortion_type: distortion_type.clamp(0, 5),
            distortion_gain: distortion_gain.clamp(0.1, 40.0),
            env_delay: env_delay.clamp(0.0, 4.0),
            env_attack: env_attack.clamp(0.001, 4.0),
            env_decay: env_decay.clamp(0.001, 4.0),
            env_sustain: env_sustain.clamp(0.0, 1.0),
            env_release: env_release.clamp(0.001, 6.0),
            map_src_min,
            map_src_max,
            map_target_min,
            map_target_max,
        };
        if let Some(target_index) = link_target_index(to) {
            if target_index < MAX_LINKS {
                LINK_NEXT_MODULATOR[index] = LINK_FIRST_MODULATOR[target_index];
                LINK_FIRST_MODULATOR[target_index] = index as i32;
                if target == TARGET_ENVELOPE_TRIGGER {
                    LINK_HAS_ENVELOPE_TRIGGER[target_index] = true;
                }
            }
        }
        LINK_COUNT += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn setLinkNoise(index: u32, noise: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].noise = noise.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkVelocitySensitivity(index: u32, velocity_sensitivity: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].velocity_sensitivity = velocity_sensitivity.clamp(-8.0, 8.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkFilterCutoff(index: u32, cutoff: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].filter_cutoff = if LINKS[index as usize].filter_type == 4 {
                cutoff.clamp(0.0, 1.0)
            } else if LINKS[index as usize].filter_type == 5
                || LINKS[index as usize].filter_type == 6
            {
                cutoff.clamp(20.0, 5_000.0)
            } else {
                cutoff.clamp(20.0, 12_000.0)
            };
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkFilterResonance(index: u32, resonance: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].filter_resonance = resonance.clamp(
                if LINKS[index as usize].filter_type == 5 || LINKS[index as usize].filter_type == 6
                {
                    -0.98
                } else {
                    0.1
                },
                if LINKS[index as usize].filter_type == 4 {
                    FORMANT_INTENSITY_MAX
                } else if LINKS[index as usize].filter_type == 5
                    || LINKS[index as usize].filter_type == 6
                {
                    0.98
                } else {
                    12.0
                },
            );
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkDistortionGain(index: u32, gain: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].distortion_gain = gain.clamp(0.1, 40.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkAmount(index: u32, amount: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].amount = clamp_link_amount(amount);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkDelay(index: u32, delay: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].delay = delay.clamp(0.0, 3.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkPan(index: u32, pan: f64) {
    unsafe {
        if (index as usize) < LINK_COUNT {
            LINKS[index as usize].pan = pan.clamp(-1.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn resetPhases() {
    reset_dsp_tempo_clocks();

    let phases = core::ptr::addr_of_mut!(PHASES).cast::<f64>();
    let quantised_frequencies = core::ptr::addr_of_mut!(QUANTISED_FREQUENCIES).cast::<f64>();
    let quantised_targets = core::ptr::addr_of_mut!(QUANTISED_TARGETS).cast::<f64>();
    let quantised_steps = core::ptr::addr_of_mut!(QUANTISED_STEPS).cast::<f64>();
    let quantised_remaining = core::ptr::addr_of_mut!(QUANTISED_REMAINING).cast::<u32>();
    let feedback = core::ptr::addr_of_mut!(FEEDBACK).cast::<f64>();
    let sample_holds = core::ptr::addr_of_mut!(SAMPLE_HOLDS).cast::<f64>();
    let sample_hold_set = core::ptr::addr_of_mut!(SAMPLE_HOLD_SET).cast::<bool>();
    let perlin_current = core::ptr::addr_of_mut!(PERLIN_CURRENT).cast::<f64>();
    let perlin_next = core::ptr::addr_of_mut!(PERLIN_NEXT).cast::<f64>();
    let perlin_set = core::ptr::addr_of_mut!(PERLIN_SET).cast::<bool>();
    let custom_wave_done = core::ptr::addr_of_mut!(CUSTOM_WAVE_DONE).cast::<bool>();
    let custom_wave_directions = core::ptr::addr_of_mut!(CUSTOM_WAVE_DIRECTIONS).cast::<f64>();
    let custom_wave_triggered = core::ptr::addr_of_mut!(CUSTOM_WAVE_TRIGGERED).cast::<bool>();
    let sample_playing = core::ptr::addr_of_mut!(SAMPLE_PLAYING).cast::<bool>();
    let sample_positions = core::ptr::addr_of_mut!(SAMPLE_POSITIONS).cast::<f64>();
    let sample_directions = core::ptr::addr_of_mut!(SAMPLE_DIRECTIONS).cast::<f64>();
    let sample_start_values = core::ptr::addr_of_mut!(SAMPLE_START_VALUES).cast::<f64>();
    let delay_buffers = core::ptr::addr_of_mut!(LINK_DELAY_BUFFERS).cast::<f32>();
    let delay_indices = core::ptr::addr_of_mut!(LINK_DELAY_INDICES).cast::<usize>();
    let delay_ready = core::ptr::addr_of_mut!(LINK_DELAY_READY).cast::<bool>();
    let comb_buffers = core::ptr::addr_of_mut!(LINK_COMB_BUFFERS).cast::<f32>();
    let comb_indices = core::ptr::addr_of_mut!(LINK_COMB_INDICES).cast::<usize>();
    let comb_ready = core::ptr::addr_of_mut!(LINK_COMB_READY).cast::<bool>();
    let trigger_armed = core::ptr::addr_of_mut!(LINK_TRIGGER_ARMED).cast::<bool>();
    let trigger_start_age = core::ptr::addr_of_mut!(LINK_TRIGGER_START_AGE).cast::<f64>();
    let trigger_release_age = core::ptr::addr_of_mut!(LINK_TRIGGER_RELEASE_AGE).cast::<f64>();
    let followers = core::ptr::addr_of_mut!(LINK_FOLLOWERS).cast::<f64>();
    let filters = core::ptr::addr_of_mut!(LINK_FILTERS).cast::<FilterState>();
    let formant_filters = core::ptr::addr_of_mut!(LINK_FORMANT_FILTERS).cast::<FilterState>();
    let link_stack = core::ptr::addr_of_mut!(LINK_PARAM_STACK).cast::<bool>();
    let total = MAX_VOICE_SLOTS * MAX_NODES;
    for index in 0..total {
        unsafe {
            *phases.add(index) = 0.0;
            *quantised_frequencies.add(index) = 0.0;
            *quantised_targets.add(index) = 0.0;
            *quantised_steps.add(index) = 0.0;
            *quantised_remaining.add(index) = 0;
            *feedback.add(index) = 0.0;
            *sample_holds.add(index) = 0.0;
            *sample_hold_set.add(index) = false;
            *perlin_current.add(index) = 0.0;
            *perlin_next.add(index) = 0.0;
            *perlin_set.add(index) = false;
            *custom_wave_done.add(index) = false;
            *custom_wave_directions.add(index) = 1.0;
            *custom_wave_triggered.add(index) = false;
            *sample_playing.add(index) = false;
            *sample_positions.add(index) = 0.0;
            *sample_directions.add(index) = 1.0;
            *sample_start_values.add(index) = 0.0;
            *core::ptr::addr_of_mut!(SAMPLE_STRETCH_PHASES)
                .cast::<f64>()
                .add(index) = 0.0;
            *core::ptr::addr_of_mut!(SAMPLE_STRETCH_ANCHORS)
                .cast::<f64>()
                .add(index) = 0.0;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_LINKS) {
        unsafe {
            *followers.add(index) = 0.0;
            *filters.add(index) = EMPTY_FILTER_STATE;
            *trigger_armed.add(index) = true;
            *trigger_start_age.add(index) = -1.0;
            *trigger_release_age.add(index) = -1.0;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_LINKS * MAX_FORMANT_BANDS) {
        unsafe {
            *formant_filters.add(index) = EMPTY_FILTER_STATE;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_DELAY_SLOTS) {
        unsafe {
            *delay_indices.add(index) = 0;
            *delay_ready.add(index) = false;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_DELAY_SLOTS * MAX_DELAY_SAMPLES) {
        unsafe {
            *delay_buffers.add(index) = 0.0;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_COMB_SLOTS) {
        unsafe {
            *comb_indices.add(index) = 0;
            *comb_ready.add(index) = false;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_COMB_SLOTS * MAX_DELAY_SAMPLES) {
        unsafe {
            *comb_buffers.add(index) = 0.0;
        }
    }
    for index in 0..MAX_LINKS {
        unsafe {
            *link_stack.add(index) = false;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetVoiceSlot(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..MAX_NODES {
            PHASES[voice_slot][node_index] =
                if node_index < NODE_COUNT && NODES[node_index].wave != 9 {
                    random_unit(voice_slot)
                } else {
                    0.0
                };
            QUANTISED_FREQUENCIES[voice_slot][node_index] = 0.0;
            QUANTISED_TARGETS[voice_slot][node_index] = 0.0;
            QUANTISED_STEPS[voice_slot][node_index] = 0.0;
            QUANTISED_REMAINING[voice_slot][node_index] = 0;
            FEEDBACK[voice_slot][node_index] = 0.0;
            SAMPLE_HOLDS[voice_slot][node_index] = 0.0;
            SAMPLE_HOLD_SET[voice_slot][node_index] = false;
            PERLIN_CURRENT[voice_slot][node_index] = 0.0;
            PERLIN_NEXT[voice_slot][node_index] = 0.0;
            PERLIN_SET[voice_slot][node_index] = false;
            CUSTOM_WAVE_DONE[voice_slot][node_index] = false;
            CUSTOM_WAVE_DIRECTIONS[voice_slot][node_index] = 1.0;
            CUSTOM_WAVE_TRIGGERED[voice_slot][node_index] = false;
            SAMPLE_PLAYING[voice_slot][node_index] =
                node_index < NODE_COUNT && NODES[node_index].wave == 10;
            SAMPLE_POSITIONS[voice_slot][node_index] = 0.0;
            SAMPLE_DIRECTIONS[voice_slot][node_index] = 1.0;
            SAMPLE_PLAYBACK_AGES[voice_slot][node_index] = 0.0;
            SAMPLE_RELEASE_AGES[voice_slot][node_index] = -1.0;
            SAMPLE_START_VALUES[voice_slot][node_index] = 0.0;
            SAMPLE_STRETCH_PHASES[voice_slot][node_index] = 0.0;
            SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] = 0.0;
            if node_index < NODE_COUNT && NODES[node_index].wave == 10 {
                start_sample_player(node_index, voice_slot, NODES[node_index], 0.0, 0.0);
            }
        }
        for link_index in 0..MAX_LINKS {
            LINK_TRIGGER_ARMED[voice_slot][link_index] = true;
            LINK_TRIGGER_START_AGE[voice_slot][link_index] = -1.0;
            LINK_TRIGGER_RELEASE_AGE[voice_slot][link_index] = -1.0;
            LINK_FOLLOWERS[voice_slot][link_index] = 0.0;
            LINK_FILTERS[voice_slot][link_index] = EMPTY_FILTER_STATE;
            for band_index in 0..MAX_FORMANT_BANDS {
                LINK_FORMANT_FILTERS[voice_slot][link_index][band_index] = EMPTY_FILTER_STATE;
            }
        }
        for slot_index in 0..MAX_DELAY_SLOTS {
            LINK_DELAY_INDICES[voice_slot][slot_index] = 0;
            LINK_DELAY_READY[voice_slot][slot_index] = false;
            for sample_index in 0..MAX_DELAY_SAMPLES {
                LINK_DELAY_BUFFERS[voice_slot][slot_index][sample_index] = 0.0;
            }
        }
        for slot_index in 0..MAX_COMB_SLOTS {
            LINK_COMB_INDICES[voice_slot][slot_index] = 0;
            LINK_COMB_READY[voice_slot][slot_index] = false;
            for sample_index in 0..MAX_DELAY_SAMPLES {
                LINK_COMB_BUFFERS[voice_slot][slot_index][sample_index] = 0.0;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn resetVoiceSlotPhases(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..MAX_NODES {
            PHASES[voice_slot][node_index] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn armCustomOnceTriggers(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..NODE_COUNT {
            let node = NODES[node_index];
            if node.wave == 9
                && node.custom_mode == CUSTOM_MODE_ONCE
                && !CUSTOM_WAVE_TRIGGERED[voice_slot][node_index]
            {
                CUSTOM_WAVE_DONE[voice_slot][node_index] = true;
            }
        }
    }
}

fn next_stamp() -> u32 {
    unsafe {
        CURRENT_STAMP = CURRENT_STAMP.wrapping_add(1);
        if CURRENT_STAMP == 0 {
            let stamps = core::ptr::addr_of_mut!(CACHE_STAMPS).cast::<u32>();
            for index in 0..MAX_NODES {
                *stamps.add(index) = 0;
            }
            CURRENT_STAMP = 1;
        }
        CURRENT_STAMP
    }
}

fn normalize_phase(phase: f64) -> f64 {
    phase - phase.floor()
}

fn link_target_index(target: i32) -> Option<usize> {
    if target <= LINK_TARGET_BASE {
        Some((LINK_TARGET_BASE - target) as usize)
    } else {
        None
    }
}

fn observe_link_meter(link_index: usize, input: f64, output: f64, envelope: f64) {
    unsafe {
        if link_index >= MAX_LINKS {
            return;
        }
        LINK_METER_INPUT_SUMS[link_index] += input.abs();
        LINK_METER_OUTPUT_SUMS[link_index] += output.abs();
        LINK_METER_ENVELOPE_SUMS[link_index] += envelope.abs();
        LINK_METER_COUNTS[link_index] = LINK_METER_COUNTS[link_index].saturating_add(1);
    }
    observe_link_scope(link_index, output, envelope);
}

fn observe_link_scope(link_index: usize, output: f64, envelope: f64) {
    unsafe {
        if LINK_SCOPE_LINK_INDEX != link_index as i32 || LINK_SCOPE_POINTS_ACTIVE == 0 {
            return;
        }
        let value = output as f32;
        let env = envelope.clamp(0.0, 1.0);
        if LINK_SCOPE_MODE == 2 && LINK_SCOPE_LAST_ENVELOPE <= 0.001 && env > 0.001 {
            LINK_SCOPE_DECIMATE_COUNTER = 0;
            LINK_SCOPE_COUNT = 0;
            LINK_SCOPE_WRITE_INDEX = 0;
            LINK_SCOPE_CAPTURE_ACTIVE = true;
        }
        LINK_SCOPE_LAST_ENVELOPE = env;
        if LINK_SCOPE_MODE == 2 && !LINK_SCOPE_CAPTURE_ACTIVE {
            return;
        }
        LINK_SCOPE_DECIMATE_COUNTER = LINK_SCOPE_DECIMATE_COUNTER.saturating_add(1);
        if LINK_SCOPE_DECIMATE_COUNTER < LINK_SCOPE_DECIMATE {
            return;
        }
        LINK_SCOPE_DECIMATE_COUNTER = 0;
        if LINK_SCOPE_MODE == 2 {
            if (LINK_SCOPE_COUNT as usize) < LINK_SCOPE_POINTS_ACTIVE {
                LINK_SCOPE_SAMPLES[LINK_SCOPE_COUNT as usize] = value;
                LINK_SCOPE_COUNT = LINK_SCOPE_COUNT.saturating_add(1);
            }
            if (LINK_SCOPE_COUNT as usize) >= LINK_SCOPE_POINTS_ACTIVE {
                LINK_SCOPE_CAPTURE_ACTIVE = false;
            }
            return;
        }
        LINK_SCOPE_SAMPLES[LINK_SCOPE_WRITE_INDEX as usize] = value;
        LINK_SCOPE_WRITE_INDEX = (LINK_SCOPE_WRITE_INDEX + 1) % LINK_SCOPE_POINTS_ACTIVE as u32;
        if (LINK_SCOPE_COUNT as usize) < LINK_SCOPE_POINTS_ACTIVE {
            LINK_SCOPE_COUNT = LINK_SCOPE_COUNT.saturating_add(1);
        }
    }
}

fn smooth_step(t: f64) -> f64 {
    let x = t.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

fn oscillator(
    node_index: usize,
    node: Node,
    phase: f64,
    voice_slot: usize,
    frame: usize,
    wave: i32,
) -> f64 {
    let p = normalize_phase(phase);
    match wave {
        1 => 1.0 - 4.0 * ((p - 0.25).round() - (p - 0.25)).abs(),
        2 => p * 2.0 - 1.0,
        3 => 1.0 - p * 2.0,
        4 => {
            if p < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        5 => unsafe {
            if !SAMPLE_HOLD_SET[voice_slot][node_index] {
                SAMPLE_HOLDS[voice_slot][node_index] = random_unit(voice_slot);
                SAMPLE_HOLD_SET[voice_slot][node_index] = true;
            }
            SAMPLE_HOLDS[voice_slot][node_index]
        },
        6 => random_bipolar(voice_slot),
        7 => unsafe {
            if !PERLIN_SET[voice_slot][node_index] {
                PERLIN_CURRENT[voice_slot][node_index] = random_bipolar(voice_slot);
                PERLIN_NEXT[voice_slot][node_index] = random_bipolar(voice_slot);
                PERLIN_SET[voice_slot][node_index] = true;
            }
            let current = PERLIN_CURRENT[voice_slot][node_index];
            let next = PERLIN_NEXT[voice_slot][node_index];
            current + (next - current) * smooth_step(p)
        },
        8 => unsafe { INPUT[frame.min(MAX_WASM_FRAMES - 1)] as f64 * node.audio_input_gain },
        9 => custom_wave_value(node_index, p),
        11 => node.frequency.clamp(-1.0, 1.0),
        _ => (TWO_PI * p).sin(),
    }
}

fn modulated_wave(base_wave: i32, modulation: f64) -> i32 {
    if !modulation.is_finite() {
        return base_wave;
    }
    let waves = [0, 1, 2, 3, 4, 5, 9];
    let base_index = match waves.iter().position(|wave| *wave == base_wave) {
        Some(index) => index as i32,
        None => return base_wave,
    };
    let index = ((base_index as f64 + modulation).round() as i32).clamp(0, (waves.len() - 1) as i32)
        as usize;
    waves[index]
}

fn custom_wave_value(node_index: usize, phase: f64) -> f64 {
    unsafe {
        let count = CUSTOM_WAVE_COUNTS[node_index];
        if count < 2 {
            return 0.0;
        }
        let p = phase.clamp(0.0, 1.0);
        for point_index in 1..count {
            let previous_x = CUSTOM_WAVE_XS[node_index][point_index - 1];
            let previous_y = CUSTOM_WAVE_YS[node_index][point_index - 1];
            let next_x = CUSTOM_WAVE_XS[node_index][point_index];
            let next_y = CUSTOM_WAVE_YS[node_index][point_index];
            if p > next_x && point_index < count - 1 {
                continue;
            }
            let span = next_x - previous_x;
            if span <= 0.0 {
                return next_y;
            }
            let t = ((p - previous_x) / span).clamp(0.0, 1.0);
            return previous_y + (next_y - previous_y) * t;
        }
        CUSTOM_WAVE_YS[node_index][count - 1]
    }
}

fn custom_one_shot_edge_gain(node: Node, phase: f64, base_frequency: f64) -> f64 {
    if node.wave != 9 || !custom_mode_is_finite(node.custom_mode) || base_frequency <= 0.0 {
        return 1.0;
    }
    let fade_phase = (CUSTOM_ONESHOT_EDGE_FADE_SECONDS * base_frequency).clamp(0.0005, 0.08);
    let p = phase.clamp(0.0, 1.0);
    (p / fade_phase).min((1.0 - p) / fade_phase).clamp(0.0, 1.0)
}

fn sample_slot_for_node(node_index: usize) -> Option<usize> {
    unsafe {
        if node_index >= MAX_NODES {
            return None;
        }
        let slot = SAMPLE_SLOT_FOR_NODE[node_index];
        if slot < 0 {
            return None;
        }
        let slot = slot as usize;
        if slot >= MAX_SAMPLE_SLOTS || SAMPLE_LENGTHS[slot] == 0 {
            return None;
        }
        Some(slot)
    }
}

fn sample_range(
    node_index: usize,
    node: Node,
    start_mod: f64,
    end_mod: f64,
) -> Option<(f64, f64, f64, f64, f64, f64)> {
    let slot = sample_slot_for_node(node_index)?;
    unsafe {
        let max_frame = SAMPLE_LENGTHS[slot].saturating_sub(1) as f64;
        if max_frame <= 0.0 {
            return None;
        }
        let start = (node.sample_start + start_mod).clamp(0.0, 1.0);
        let end = (node.sample_end + end_mod).clamp(0.0, 1.0);
        let start_frame = (start * max_frame).round().clamp(0.0, max_frame);
        let end_frame = (end * max_frame).round().clamp(0.0, max_frame);
        let first_frame = start_frame.min(end_frame);
        let last_frame = start_frame.max(end_frame);
        let direction = if end_frame >= start_frame { 1.0 } else { -1.0 };
        let length = (end_frame - start_frame).abs() + 1.0;
        Some((
            start_frame,
            end_frame,
            first_frame,
            last_frame,
            direction,
            length.max(1.0),
        ))
    }
}

fn sample_playback_step(
    node_index: usize,
    node: Node,
    note_frequency: f64,
    target_frequency: f64,
    sample_rate: f64,
) -> f64 {
    let Some(slot) = sample_slot_for_node(node_index) else {
        return 0.0;
    };
    unsafe {
        let target_frequency = if target_frequency.is_finite() && target_frequency >= 0.0 {
            target_frequency
        } else {
            base_frequency(node, note_frequency)
        }
        .max(0.0001);
        let original = node.sample_original_frequency.max(0.0001);
        let source_rate = SAMPLE_RATES[slot].max(1.0);
        (target_frequency / original) * (source_rate / sample_rate.max(1.0))
    }
}

fn sample_playback_duration(
    node_index: usize,
    node: Node,
    note_frequency: f64,
    target_frequency: f64,
    sample_rate: f64,
) -> Option<f64> {
    let (_, _, _, _, _, length) = sample_range(node_index, node, 0.0, 0.0)?;
    let step = sample_playback_step(
        node_index,
        node,
        note_frequency,
        target_frequency,
        sample_rate,
    )
    .abs()
    .max(0.0001);
    Some((length / step / sample_rate.max(1.0)) * node.sample_stretch.max(0.001) + node.sample_release.max(0.0))
}

fn start_sample_player(
    node_index: usize,
    voice_slot: usize,
    node: Node,
    start_mod: f64,
    end_mod: f64,
) {
    unsafe {
        let Some((start_frame, _, _, _, direction, _)) =
            sample_range(node_index, node, start_mod, end_mod)
        else {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
            return;
        };
        let Some(slot) = sample_slot_for_node(node_index) else {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
            return;
        };
        let start_index =
            (start_frame.round() as usize).min(SAMPLE_LENGTHS[slot].saturating_sub(1));
        SAMPLE_PLAYING[voice_slot][node_index] = true;
        SAMPLE_POSITIONS[voice_slot][node_index] = start_frame;
        SAMPLE_DIRECTIONS[voice_slot][node_index] = direction;
        SAMPLE_PLAYBACK_AGES[voice_slot][node_index] = 0.0;
        SAMPLE_RELEASE_AGES[voice_slot][node_index] = -1.0;
        SAMPLE_START_VALUES[voice_slot][node_index] = SAMPLE_DATA[slot][start_index] as f64;
        SAMPLE_STRETCH_PHASES[voice_slot][node_index] = 0.0;
        SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] = start_frame;
    }
}

fn sample_player_boundary(
    node_index: usize,
    voice_slot: usize,
    start_frame: f64,
    end_frame: f64,
    direction: f64,
) -> f64 {
    unsafe {
        if SAMPLE_DIRECTIONS[voice_slot][node_index] == direction {
            end_frame
        } else {
            start_frame
        }
    }
}

fn sample_player_past_end(position: f64, play_direction: f64, boundary: f64) -> bool {
    if play_direction >= 0.0 {
        position > boundary
    } else {
        position < boundary
    }
}

fn sample_player_before_start(position: f64, play_direction: f64, start_frame: f64) -> bool {
    if play_direction >= 0.0 {
        position < start_frame
    } else {
        position > start_frame
    }
}

fn finish_sample_boundary(
    node_index: usize,
    voice_slot: usize,
    node: Node,
    start_frame: f64,
    end_frame: f64,
    first_frame: f64,
    last_frame: f64,
    direction: f64,
) {
    unsafe {
        let play_direction = SAMPLE_DIRECTIONS[voice_slot][node_index];
        let boundary =
            sample_player_boundary(node_index, voice_slot, start_frame, end_frame, direction);
        let position = SAMPLE_POSITIONS[voice_slot][node_index];
        if !sample_player_past_end(position, play_direction, boundary) {
            return;
        }
        if node.sample_mode == SAMPLE_MODE_LOOP {
            let span = (end_frame - start_frame).abs().max(1.0);
            let overshoot = (position - boundary).abs();
            let wrapped = overshoot % span;
            SAMPLE_POSITIONS[voice_slot][node_index] = if direction >= 0.0 {
                start_frame + wrapped
            } else {
                start_frame - wrapped
            };
            SAMPLE_DIRECTIONS[voice_slot][node_index] = direction;
        } else if node.sample_mode == SAMPLE_MODE_PING_PONG {
            let next_direction = -play_direction;
            let overshoot = (position - boundary).abs();
            SAMPLE_DIRECTIONS[voice_slot][node_index] = next_direction;
            SAMPLE_POSITIONS[voice_slot][node_index] =
                (boundary + overshoot * next_direction).clamp(first_frame, last_frame);
        } else if node.sample_release > 0.0 && SAMPLE_RELEASE_AGES[voice_slot][node_index] < 0.0 {
            SAMPLE_POSITIONS[voice_slot][node_index] = boundary;
            SAMPLE_RELEASE_AGES[voice_slot][node_index] = 0.0;
        } else {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
        }
    }
}

fn sample_value(
    node_index: usize,
    node: Node,
    voice_slot: usize,
    sample_rate: f64,
    start_mod: f64,
    end_mod: f64,
    stretch_mod: f64,
) -> f64 {
    unsafe {
        if !SAMPLE_PLAYING[voice_slot][node_index] {
            return 0.0;
        }
        let Some(slot) = sample_slot_for_node(node_index) else {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
            return 0.0;
        };
        let Some((start_frame, end_frame, first_frame, last_frame, direction, length)) =
            sample_range(node_index, node, start_mod, end_mod)
        else {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
            return 0.0;
        };
        let release_age = SAMPLE_RELEASE_AGES[voice_slot][node_index];
        if release_age >= node.sample_release.max(0.0) && release_age >= 0.0 {
            SAMPLE_PLAYING[voice_slot][node_index] = false;
            return 0.0;
        }
        if sample_player_before_start(
            SAMPLE_POSITIONS[voice_slot][node_index],
            SAMPLE_DIRECTIONS[voice_slot][node_index],
            start_frame,
        ) {
            start_sample_player(node_index, voice_slot, node, start_mod, end_mod);
        }
        finish_sample_boundary(
            node_index,
            voice_slot,
            node,
            start_frame,
            end_frame,
            first_frame,
            last_frame,
            direction,
        );
        if !SAMPLE_PLAYING[voice_slot][node_index] {
            return 0.0;
        }
        let stretch = (node.sample_stretch + stretch_mod).max(0.001);
        let (position, next_position, mix) = if (stretch - 1.0).abs() < 0.001 {
            let base_position = SAMPLE_POSITIONS[voice_slot][node_index];
            (base_position, base_position, 0.0)
        } else {
            let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
            let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
                0.0
            } else {
                (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                    .round()
                    .clamp(1.0, (grain_frames - 1.0).max(1.0))
            };
            let hop_frames = (grain_frames - overlap_frames).max(1.0);
            let local = SAMPLE_STRETCH_PHASES[voice_slot][node_index].clamp(0.0, grain_frames);
            let overlap_local = (local - hop_frames).max(0.0);
            let mix = if overlap_frames > 0.0 && overlap_local > 0.0 {
                smooth_step(overlap_local / overlap_frames)
            } else {
                0.0
            };
            let direction = SAMPLE_DIRECTIONS[voice_slot][node_index];
            let next_anchor =
                SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] + (hop_frames / stretch) * direction;
            (
                SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] + local * direction,
                next_anchor + overlap_local * direction,
                mix,
            )
        };
        let position = if SAMPLE_RELEASE_AGES[voice_slot][node_index] >= 0.0 {
            end_frame
        } else {
            position.clamp(first_frame, last_frame)
        };
        let sample_at = |read_position: f64| -> f64 {
            let read_position = read_position.clamp(first_frame, last_frame);
            let lower =
                (read_position.floor() as usize).min(SAMPLE_LENGTHS[slot].saturating_sub(1));
            let upper = (lower + 1)
                .min(SAMPLE_LENGTHS[slot].saturating_sub(1))
                .min(last_frame as usize);
            let frac = read_position - lower as f64;
            let a = SAMPLE_DATA[slot][lower] as f64;
            let b = SAMPLE_DATA[slot][upper] as f64;
            a + (b - a) * frac
        };
        let blended = if mix > 0.0 {
            sample_at(position) * (1.0 - mix) + sample_at(next_position) * mix
        } else {
            sample_at(position)
        };
        let start_distance = (position - start_frame).abs();
        let end_distance = (end_frame - position).abs();
        let fade_frames = (SAMPLE_RATES[slot].max(sample_rate) * SAMPLE_EDGE_FADE_SECONDS)
            .round()
            .clamp(1.0, (length * 0.5).max(1.0));
        let end_edge = if node.sample_mode == SAMPLE_MODE_ONE_SHOT && node.sample_release > 0.0 {
            1.0
        } else {
            smooth_step(end_distance / fade_frames)
        };
        let edge = smooth_step(start_distance / fade_frames) * end_edge;
        let correction = SAMPLE_START_VALUES[voice_slot][node_index]
            * (1.0 - smooth_step(start_distance / fade_frames));
        let attack = if node.sample_attack > 0.0 {
            smooth_step((SAMPLE_PLAYBACK_AGES[voice_slot][node_index] / node.sample_attack).clamp(0.0, 1.0))
        } else {
            1.0
        };
        let release = if release_age >= 0.0 && node.sample_release > 0.0 {
            1.0 - smooth_step((release_age / node.sample_release).clamp(0.0, 1.0))
        } else {
            1.0
        };
        sanitize_sample((blended - correction) * edge * attack * release, 4.0)
    }
}

fn custom_mode_is_finite(mode: i32) -> bool {
    matches!(
        mode,
        CUSTOM_MODE_ONCE
            | CUSTOM_MODE_SUSTAIN
            | CUSTOM_MODE_SUSTAIN_LOOP
            | CUSTOM_MODE_SUSTAIN_PING_PONG
    )
}

fn fold_sample(sample: f64, drive: f64) -> f64 {
    let wrapped = ((sample * drive + 1.0) % 4.0 + 4.0) % 4.0;
    if wrapped <= 2.0 {
        wrapped - 1.0
    } else {
        3.0 - wrapped
    }
}

fn sanitize_sample(value: f64, limit: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-limit, limit)
    } else {
        0.0
    }
}

fn sanitize_control_value(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-12_000.0, 12_000.0)
    } else {
        0.0
    }
}

fn pan_gains(pan: f64) -> (f64, f64) {
    let angle = (pan.clamp(-1.0, 1.0) + 1.0) * core::f64::consts::PI * 0.25;
    (angle.cos(), angle.sin())
}

fn scale_contains(scale: i32, interval: i32) -> bool {
    match scale {
        1 => matches!(interval, 0 | 2 | 4 | 5 | 7 | 9 | 11),
        2 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 8 | 10),
        3 => matches!(interval, 0 | 2 | 4 | 7 | 9),
        4 => matches!(interval, 0 | 3 | 5 | 7 | 10),
        5 => matches!(interval, 0 | 3 | 5 | 6 | 7 | 10),
        6 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 9 | 10),
        7 => matches!(interval, 0 | 2 | 4 | 5 | 7 | 9 | 10),
        8 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 8 | 11),
        _ => true,
    }
}

fn midi_pitch_class(frequency: f64) -> i32 {
    if !frequency.is_finite() || frequency <= 0.0 {
        return 0;
    }
    let midi = (69.0 + 12.0 * (frequency / 440.0).log2()).round() as i32;
    midi.rem_euclid(12)
}

fn quantise_frequency(node: Node, frequency: f64, note_frequency: f64) -> f64 {
    if node.quantise_enabled == 0 || !frequency.is_finite() || frequency <= 0.0 {
        return frequency;
    }
    let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
    let center = midi.round() as i32;
    let octave_center = (center.div_euclid(12)) * 12;
    let root = if node.quantise_root < 0 {
        midi_pitch_class(note_frequency)
    } else {
        node.quantise_root.clamp(0, 11)
    };
    let mut best_midi = center;
    let mut best_distance = f64::INFINITY;
    for octave in -2..=2 {
        let octave_base = octave_center + octave * 12;
        for interval in 0..12 {
            if !scale_contains(node.quantise_scale, interval) {
                continue;
            }
            let candidate = octave_base + (root + interval).rem_euclid(12);
            let distance = ((candidate as f64) - midi).abs();
            if distance < best_distance {
                best_distance = distance;
                best_midi = candidate;
            }
        }
    }
    440.0 * 2.0_f64.powf(((best_midi as f64) - 69.0) / 12.0)
}

fn glide_frequency(
    voice_slot: usize,
    node_index: usize,
    node: Node,
    target: f64,
    sample_rate: f64,
) -> f64 {
    if node.quantise_enabled == 0 || !target.is_finite() || target <= 0.0 {
        return target;
    }
    unsafe {
        let glide = node.quantise_glide.clamp(0.0, 4.0);
        if glide <= 0.0 {
            QUANTISED_FREQUENCIES[voice_slot][node_index] = target;
            QUANTISED_TARGETS[voice_slot][node_index] = target;
            QUANTISED_STEPS[voice_slot][node_index] = 0.0;
            QUANTISED_REMAINING[voice_slot][node_index] = 0;
            return target;
        }
        let current = QUANTISED_FREQUENCIES[voice_slot][node_index];
        if !current.is_finite() || current <= 0.0 {
            QUANTISED_FREQUENCIES[voice_slot][node_index] = target;
            QUANTISED_TARGETS[voice_slot][node_index] = target;
            QUANTISED_STEPS[voice_slot][node_index] = 0.0;
            QUANTISED_REMAINING[voice_slot][node_index] = 0;
            return target;
        }
        if (target - QUANTISED_TARGETS[voice_slot][node_index]).abs() > 0.000001 {
            let remaining = (glide * sample_rate).round().max(1.0) as u32;
            QUANTISED_TARGETS[voice_slot][node_index] = target;
            QUANTISED_REMAINING[voice_slot][node_index] = remaining;
            QUANTISED_STEPS[voice_slot][node_index] = (target - current) / remaining as f64;
        }
        if QUANTISED_REMAINING[voice_slot][node_index] > 0 {
            QUANTISED_FREQUENCIES[voice_slot][node_index] +=
                QUANTISED_STEPS[voice_slot][node_index];
            QUANTISED_REMAINING[voice_slot][node_index] -= 1;
            if QUANTISED_REMAINING[voice_slot][node_index] == 0 {
                QUANTISED_FREQUENCIES[voice_slot][node_index] =
                    QUANTISED_TARGETS[voice_slot][node_index];
            }
        }
        QUANTISED_FREQUENCIES[voice_slot][node_index]
    }
}

fn base_frequency(node: Node, note_frequency: f64) -> f64 {
    if node.frequency_mode == 1 {
        node.frequency
    } else if node.frequency_mode == 2 {
        unsafe { (TEMPO / 60.0) / node.sync_beats.clamp(1.0 / 64.0, 64.0) }
    } else {
        note_frequency * node.ratio
    }
}

fn velocity_scale(velocity_sensitivity: f64, velocity: f64) -> f64 {
    if velocity_sensitivity == 0.0 {
        return 1.0;
    }
    let velocity = velocity.clamp(0.0, 1.0);
    if velocity_sensitivity < 0.0 {
        let inverted = (1.0 - velocity).clamp(0.0, 1.0);
        let depth = velocity_sensitivity.abs();
        if depth <= 1.0 {
            1.0 - depth + depth * inverted
        } else {
            inverted.powf(depth)
        }
    } else if velocity_sensitivity == 1.0 {
        velocity
    } else if velocity_sensitivity <= 1.0 {
        1.0 - velocity_sensitivity + velocity_sensitivity * velocity
    } else {
        velocity.powf(velocity_sensitivity)
    }
}

fn attack_curve(t: f64) -> f64 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

fn decay_curve(t: f64) -> f64 {
    (1.0 - t.clamp(0.0, 1.0)).powi(2)
}

fn held_envelope_value(link: Link, age: f64) -> f64 {
    let mut elapsed = age.max(0.0);
    if elapsed < link.env_delay {
        return 0.0;
    }
    elapsed -= link.env_delay;

    if elapsed < link.env_attack {
        return attack_curve(elapsed / link.env_attack);
    }
    if elapsed < link.env_attack + link.env_decay {
        let t = (elapsed - link.env_attack) / link.env_decay;
        return link.env_sustain + (1.0 - link.env_sustain) * decay_curve(t);
    }
    link.env_sustain
}

fn envelope_value(link: Link, age: f64, release_age: f64) -> f64 {
    if release_age < 0.0 {
        return held_envelope_value(link, age);
    }

    let release_started_age = (age - release_age).max(0.0);
    let release_level = held_envelope_value(link, release_started_age);
    release_level * decay_curve(release_age / link.env_release.max(0.001))
}

fn link_has_envelope_trigger(link_index: usize) -> bool {
    unsafe {
        if link_index >= MAX_LINKS {
            return false;
        }
        if LINK_HAS_ENVELOPE_TRIGGER[link_index] {
            return true;
        }
        let mut mod_cursor = LINK_FIRST_MODULATOR[link_index];
        while mod_cursor >= 0 {
            let mod_index = mod_cursor as usize;
            if mod_index >= MAX_LINKS {
                return false;
            }
            if LINKS[mod_index].target == TARGET_ENVELOPE_TRIGGER {
                return true;
            }
            mod_cursor = LINK_NEXT_MODULATOR[mod_index];
        }
        false
    }
}

fn triggered_envelope_value(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    age: f64,
    release_age: f64,
) -> f64 {
    let has_envelope_trigger = link_has_envelope_trigger(link_index);
    if link.drone != 0 && !has_envelope_trigger {
        return 1.0;
    }

    unsafe {
        let start_age = LINK_TRIGGER_START_AGE[voice_slot][link_index];
        if voice_slot == DRONE_VOICE_SLOT || has_envelope_trigger {
            if start_age < 0.0 || age < start_age {
                return 0.0;
            }
            let trigger_release_age = LINK_TRIGGER_RELEASE_AGE[voice_slot][link_index];
            let effective_release_age =
                if trigger_release_age >= start_age && age >= trigger_release_age {
                    age - trigger_release_age
                } else {
                    release_age
                };
            return envelope_value(link, age - start_age, effective_release_age);
        }
        if release_age < 0.0 && link.from >= 0 {
            let node_index = link.from as usize;
            if node_index < NODE_COUNT {
                let node = NODES[node_index];
                if node.wave == 10 && node.sample_mode == SAMPLE_MODE_ONE_SHOT {
                    let target_frequency = if FREQUENCY_MOD_ACTIVE[node_index] {
                        FREQUENCY_MODS[node_index]
                    } else {
                        base_frequency(node, note_frequency)
                    };
                    if let Some(duration) = sample_playback_duration(
                        node_index,
                        node,
                        note_frequency,
                        target_frequency,
                        sample_rate,
                    ) {
                        let release_at = (duration - link.env_release.max(0.001)).max(0.0);
                        if age >= release_at {
                            let release_level = held_envelope_value(link, release_at);
                            return release_level
                                * decay_curve((age - release_at) / link.env_release.max(0.001));
                        }
                    }
                }
            }
        }
        envelope_value(link, age, release_age)
    }
}

fn trigger_node_output_envelopes(target_node_index: usize, voice_slot: usize, age: f64) {
    unsafe {
        for link_index in 0..LINK_COUNT {
            if LINKS[link_index].from == target_node_index as i32 && LINKS[link_index].drone == 0 {
                LINK_TRIGGER_START_AGE[voice_slot][link_index] = age;
            }
        }
    }
}

fn apply_envelope_trigger(
    target_link_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    age: f64,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = LINK_TRIGGER_ARMED[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            LINK_TRIGGER_START_AGE[voice_slot][target_link_index] = age;
            LINK_TRIGGER_RELEASE_AGE[voice_slot][target_link_index] = -1.0;
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            if LINK_TRIGGER_RELEASE_AGE[voice_slot][target_link_index] < 0.0 {
                LINK_TRIGGER_RELEASE_AGE[voice_slot][target_link_index] = age;
            }
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = true;
        }
    }
}

fn apply_phase_reset_trigger(
    target_node_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = LINK_TRIGGER_ARMED[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            PHASES[voice_slot][target_node_index] = 0.0;
            CUSTOM_WAVE_DONE[voice_slot][target_node_index] = false;
            CUSTOM_WAVE_DIRECTIONS[voice_slot][target_node_index] = 1.0;
            CUSTOM_WAVE_TRIGGERED[voice_slot][target_node_index] = true;
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = true;
        }
    }
}

fn apply_sample_trigger(
    target_node_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    age: f64,
    value: f64,
    start_mod: f64,
    end_mod: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = LINK_TRIGGER_ARMED[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            if target_node_index < NODE_COUNT {
                start_sample_player(
                    target_node_index,
                    voice_slot,
                    NODES[target_node_index],
                    start_mod,
                    end_mod,
                );
                trigger_node_output_envelopes(target_node_index, voice_slot, age);
            }
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            LINK_TRIGGER_ARMED[voice_slot][mod_link_index] = true;
        }
    }
}

fn random_unit(voice_slot: usize) -> f64 {
    unsafe {
        let state = RNG_STATES[voice_slot]
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        RNG_STATES[voice_slot] = state;
        state as f64 / u32::MAX as f64
    }
}

fn random_bipolar(voice_slot: usize) -> f64 {
    random_unit(voice_slot) * 2.0 - 1.0
}

fn apply_link_noise(sample: f64, link: Link, voice_slot: usize) -> f64 {
    if link.noise <= 0.0 {
        return sanitize_sample(sample, 4.0);
    }
    sanitize_sample(sample + random_bipolar(voice_slot) * link.noise, 4.0)
}

fn filter_coefficients(
    filter_type: i32,
    cutoff: f64,
    q: f64,
    sample_rate: f64,
) -> (f64, f64, f64, f64, f64) {
    let cutoff = cutoff.clamp(20.0, sample_rate * 0.45);
    let q = q.clamp(0.1, 96.0);
    let omega = TWO_PI * cutoff / sample_rate;
    let sin = omega.sin();
    let cos = omega.cos();
    let alpha = sin / (2.0 * q);
    let mut b0 = 1.0;
    let mut b1 = 0.0;
    let mut b2 = 0.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos;
    let a2 = 1.0 - alpha;

    if filter_type == 1 {
        b0 = (1.0 - cos) * 0.5;
        b1 = 1.0 - cos;
        b2 = (1.0 - cos) * 0.5;
    } else if filter_type == 2 {
        b0 = (1.0 + cos) * 0.5;
        b1 = -(1.0 + cos);
        b2 = (1.0 + cos) * 0.5;
    } else if filter_type == 3 {
        b0 = alpha;
        b1 = 0.0;
        b2 = -alpha;
    }

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

fn equalizer_coefficients(
    band: i32,
    gain_db: f64,
    sample_rate: f64,
) -> (f64, f64, f64, f64, f64) {
    let (frequency, q): (f64, f64) = match band {
        1 => (1_000.0, 0.9),
        2 => (5_000.0, 0.707),
        _ => (180.0, 0.707),
    };
    let omega = TWO_PI * frequency.clamp(20.0, sample_rate * 0.45) / sample_rate.max(1.0);
    let sin = omega.sin();
    let cos = omega.cos();
    let gain = gain_db.clamp(-24.0, 24.0);
    let a = 10.0_f64.powf(gain / 40.0);
    let alpha = sin / (2.0 * q);
    let beta = 2.0 * a.sqrt() * alpha;

    let (b0, b1, b2, a0, a1, a2) = match band {
        1 => (
            1.0 + alpha * a,
            -2.0 * cos,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos,
            1.0 - alpha / a,
        ),
        2 => (
            a * ((a + 1.0) + (a - 1.0) * cos + beta),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - beta),
            (a + 1.0) - (a - 1.0) * cos + beta,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - beta,
        ),
        _ => (
            a * ((a + 1.0) - (a - 1.0) * cos + beta),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
            a * ((a + 1.0) - (a - 1.0) * cos - beta),
            (a + 1.0) + (a - 1.0) * cos + beta,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos),
            (a + 1.0) + (a - 1.0) * cos - beta,
        ),
    };

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

fn apply_biquad_filter(
    state: &mut FilterState,
    sample: f64,
    coefficients: (f64, f64, f64, f64, f64),
) -> f64 {
    let (b0, b1, b2, a1, a2) = coefficients;
    let output = b0 * sample + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1;
    state.x1 = sanitize_sample(sample, 4.0);
    state.y2 = state.y1;
    state.y1 = sanitize_sample(output, 4.0);
    state.y1
}

fn formant_band(
    morph: f64,
    intensity: f64,
    band_index: usize,
    sample_rate: f64,
) -> (f64, f64, f64) {
    let position = morph.clamp(0.0, 1.0) * ((FORMANT_VOWELS.len() - 1) as f64);
    let left_index = position.floor() as usize;
    let right_index = (left_index + 1).min(FORMANT_VOWELS.len() - 1);
    let t = position - left_index as f64;
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let left = FORMANT_VOWELS[left_index][band_index];
    let right = FORMANT_VOWELS[right_index][band_index];
    let frequency = (left.frequency * (right.frequency / left.frequency).powf(t))
        .clamp(20.0, sample_rate * 0.45);
    let q = (left.q + (right.q - left.q) * t) * (0.7 + strength * 1.9 + overdrive * 4.2);
    let gain_db =
        left.gain_db + (right.gain_db - left.gain_db) * t + strength * 4.0 + overdrive * 18.0;
    (frequency, q.clamp(0.1, 96.0), 10.0_f64.powf(gain_db / 20.0))
}

fn apply_formant_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let intensity = link.filter_resonance.clamp(0.1, FORMANT_INTENSITY_MAX);
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let mut wet = 0.0;

    unsafe {
        for band_index in 0..MAX_FORMANT_BANDS {
            let (frequency, q, gain) =
                formant_band(link.filter_cutoff, intensity, band_index, sample_rate);
            let coefficients = filter_coefficients(3, frequency, q, sample_rate);
            wet += apply_biquad_filter(
                &mut LINK_FORMANT_FILTERS[voice_slot][link_index][band_index],
                sample,
                coefficients,
            ) * gain;
        }
    }

    let dry_mix = 0.42 - strength * 0.18 - overdrive * 0.16;
    let wet_mix = 0.46 + strength * 0.38 + overdrive * 0.95;
    sanitize_sample(sample * dry_mix + wet * wet_mix, 4.0)
}

fn comb_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if link_index >= MAX_LINKS {
            return None;
        }
        let existing = LINK_COMB_SLOTS[link_index];
        if existing >= 0 {
            return Some(existing as usize);
        }
        if LINK_COMB_SLOT_COUNT >= MAX_COMB_SLOTS {
            return None;
        }
        let slot = LINK_COMB_SLOT_COUNT;
        LINK_COMB_SLOT_COUNT += 1;
        LINK_COMB_SLOTS[link_index] = slot as i32;
        Some(slot)
    }
}

fn apply_comb_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let Some(slot) = comb_slot_for_link(link_index) else {
        return sanitize_sample(sample, 4.0);
    };
    let clean_sample = sanitize_sample(sample, 4.0);
    let frequency = link
        .filter_cutoff
        .clamp(20.0, sample_rate * 0.45)
        .min(5_000.0);
    let delay_samples = (sample_rate / frequency).clamp(1.0, (MAX_DELAY_SAMPLES - 1) as f64);
    let feedback = link.filter_resonance.clamp(-0.98, 0.98);

    unsafe {
        if !LINK_COMB_READY[voice_slot][slot] {
            LINK_COMB_BUFFERS[voice_slot][slot].fill(0.0);
            LINK_COMB_INDICES[voice_slot][slot] = 0;
            LINK_COMB_READY[voice_slot][slot] = true;
        }
        let write_index = LINK_COMB_INDICES[voice_slot][slot];
        let delayed = read_delay(
            &LINK_COMB_BUFFERS[voice_slot][slot],
            write_index,
            delay_samples,
        );
        let write_value = sanitize_sample(clean_sample + delayed * feedback, 4.0);
        LINK_COMB_BUFFERS[voice_slot][slot][write_index] = write_value as f32;
        LINK_COMB_INDICES[voice_slot][slot] = (write_index + 1) % MAX_DELAY_SAMPLES;
        if link.filter_type == 6 {
            sanitize_sample(clean_sample - delayed * feedback.abs().max(0.45), 4.0)
        } else {
            sanitize_sample(delayed, 4.0)
        }
    }
}

fn apply_link_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    if link.filter_type == 0 {
        return sample;
    }
    if link.filter_type == 4 {
        return apply_formant_filter(link_index, link, voice_slot, sample_rate, sample);
    }
    if link.filter_type == 5 || link.filter_type == 6 {
        return apply_comb_filter(link_index, link, voice_slot, sample_rate, sample);
    }

    let coefficients = filter_coefficients(
        link.filter_type,
        link.filter_cutoff,
        link.filter_resonance,
        sample_rate,
    );
    unsafe {
        apply_biquad_filter(
            &mut LINK_FILTERS[voice_slot][link_index],
            sample,
            coefficients,
        )
    }
}

fn apply_link_distortion(sample: f64, link: Link, voice_slot: usize) -> f64 {
    if link.distortion_type == 0 {
        return sample;
    }
    let gain = link.distortion_gain.clamp(0.1, 40.0);
    let driven = sanitize_sample(sample * gain, 32.0);
    let output = match link.distortion_type {
        1 => driven.clamp(-1.0, 1.0),
        3 => {
            let fuzz = driven.signum() * (1.0 - (-driven.abs() * 2.6).exp());
            fuzz + random_bipolar(voice_slot) * (gain * 0.002).min(0.08)
        }
        4 => driven / (1.0 + driven.abs()),
        5 => fold_sample(sample, gain),
        _ => driven.tanh(),
    };
    sanitize_sample(output, 4.0)
}

fn delay_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if link_index >= MAX_LINKS {
            return None;
        }
        let existing = LINK_DELAY_SLOTS[link_index];
        if existing >= 0 {
            return Some(existing as usize);
        }
        if LINK_DELAY_SLOT_COUNT >= MAX_DELAY_SLOTS {
            return None;
        }
        let slot = LINK_DELAY_SLOT_COUNT;
        LINK_DELAY_SLOT_COUNT += 1;
        LINK_DELAY_SLOTS[link_index] = slot as i32;
        Some(slot)
    }
}

fn read_delay(buffer: &[f32; MAX_DELAY_SAMPLES], write_index: usize, delay_samples: f64) -> f64 {
    let length = MAX_DELAY_SAMPLES as f64;
    let mut index = write_index as f64 - delay_samples;
    while index < 0.0 {
        index += length;
    }
    let index_floor = index.floor();
    let index_a = index_floor as usize % MAX_DELAY_SAMPLES;
    let index_b = (index_a + 1) % MAX_DELAY_SAMPLES;
    let fraction = index - index_floor;
    buffer[index_a] as f64 * (1.0 - fraction) + buffer[index_b] as f64 * fraction
}

fn apply_link_delay(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let clean_sample = sanitize_sample(sample, 4.0);
    if link.delay <= 0.0 {
        return clean_sample;
    }

    let Some(slot) = delay_slot_for_link(link_index) else {
        return clean_sample;
    };
    let max_delay_samples = (MAX_DELAY_SAMPLES - 1) as f64;
    let delay_samples = (link.delay * sample_rate).clamp(1.0, max_delay_samples);

    unsafe {
        if !LINK_DELAY_READY[voice_slot][slot] {
            LINK_DELAY_BUFFERS[voice_slot][slot].fill(clean_sample as f32);
            LINK_DELAY_INDICES[voice_slot][slot] = 0;
            LINK_DELAY_READY[voice_slot][slot] = true;
        }
        let write_index = LINK_DELAY_INDICES[voice_slot][slot];
        let delayed = read_delay(
            &LINK_DELAY_BUFFERS[voice_slot][slot],
            write_index,
            delay_samples,
        );
        LINK_DELAY_BUFFERS[voice_slot][slot][write_index] = clean_sample as f32;
        LINK_DELAY_INDICES[voice_slot][slot] = (write_index + 1) % MAX_DELAY_SAMPLES;
        sanitize_sample(delayed, 4.0)
    }
}

fn apply_signal_mode(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    if link.signal_mode == 0 {
        return sample;
    }

    if link.signal_mode == 3 {
        return sample.abs();
    }
    if link.signal_mode == 4 {
        return map_sample(sample, link);
    }
    if link.signal_mode == 5 {
        return map_sample(sample.abs(), link);
    }
    if link.signal_mode == 6 {
        return map_sample(sample, link).abs();
    }

    unsafe {
        let input = sample.abs().clamp(0.0, 1.0);
        let current = LINK_FOLLOWERS[voice_slot][link_index];
        let time = if input > current {
            link.follower_attack
        } else {
            link.follower_release
        };
        let alpha = 1.0 - (-1.0 / (sample_rate * time.max(0.001))).exp();
        let next = (current + (input - current) * alpha).clamp(0.0, 1.0);
        LINK_FOLLOWERS[voice_slot][link_index] = next;
        if link.signal_mode == 2 {
            1.0 - next
        } else {
            next
        }
    }
}

fn map_sample(sample: f64, link: Link) -> f64 {
    let source_range = link.map_src_max - link.map_src_min;
    let denominator = if source_range.abs() < 0.000001 {
        0.000001
    } else {
        source_range
    };
    link.map_target_min
        + ((sample - link.map_src_min) / denominator) * (link.map_target_max - link.map_target_min)
}

struct LinkSignal {
    signal: f64,
    amount: f64,
    pan: f64,
    value: f64,
}

#[derive(Copy, Clone)]
struct ParamAccumulator {
    set_sum: f64,
    set_count: f64,
    add: f64,
    multiply: f64,
}

impl ParamAccumulator {
    fn new() -> Self {
        Self {
            set_sum: 0.0,
            set_count: 0.0,
            add: 0.0,
            multiply: 1.0,
        }
    }

    fn push(&mut self, mode: i32, value: f64) {
        if !value.is_finite() {
            return;
        }

        match mode {
            PARAM_MODE_MULTIPLY => self.multiply *= value,
            PARAM_MODE_ADD => self.add += value,
            _ => {
                self.set_sum += value;
                self.set_count += 1.0;
            }
        }
    }

    fn apply(self, base: f64) -> f64 {
        let value = if self.set_count > 0.0 {
            self.set_sum / self.set_count
        } else {
            base
        };
        (value + self.add) * self.multiply
    }
}

fn effective_link_params(
    link_index: usize,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
) -> Link {
    unsafe {
        if link_index >= LINK_COUNT {
            return EMPTY_LINK;
        }

        let base = LINKS[link_index];
        if LINK_PARAM_STACK[link_index] {
            return base;
        }

        LINK_PARAM_STACK[link_index] = true;

        let mut amount_mod = ParamAccumulator::new();
        let mut delay_mod = ParamAccumulator::new();
        let mut noise_mod = ParamAccumulator::new();
        let mut pan_mod = ParamAccumulator::new();
        let mut cutoff_mod = ParamAccumulator::new();
        let mut resonance_mod = ParamAccumulator::new();
        let mut distortion_gain_mod = ParamAccumulator::new();
        let mut env_delay_mod = ParamAccumulator::new();
        let mut env_attack_mod = ParamAccumulator::new();
        let mut env_decay_mod = ParamAccumulator::new();
        let mut env_sustain_mod = ParamAccumulator::new();
        let mut env_release_mod = ParamAccumulator::new();
        let mut map_src_min_mod = ParamAccumulator::new();
        let mut map_src_max_mod = ParamAccumulator::new();
        let mut map_target_min_mod = ParamAccumulator::new();
        let mut map_target_max_mod = ParamAccumulator::new();

        let mut mod_cursor = LINK_FIRST_MODULATOR[link_index];
        while mod_cursor >= 0 {
            let mod_index = mod_cursor as usize;
            let mod_link = LINKS[mod_index];
            mod_cursor = LINK_NEXT_MODULATOR[mod_index];
            if mod_link.from < 0 {
                continue;
            }

            let source = render_node(
                mod_link.from as usize,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
            );
            let modulation = render_link_signal(
                mod_index,
                source,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
                mod_link.target == TARGET_ENVELOPE_TRIGGER,
            );

            match mod_link.target {
                TARGET_AMPLITUDE => amount_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_DELAY => delay_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_NOISE => noise_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_PAN => pan_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_FILTER_CUTOFF => cutoff_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_FILTER_RESONANCE => {
                    resonance_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_DISTORTION_GAIN => {
                    distortion_gain_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_DELAY => {
                    env_delay_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_ATTACK => {
                    env_attack_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_DECAY => {
                    env_decay_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_SUSTAIN => {
                    env_sustain_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_RELEASE => {
                    env_release_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_SRC_MIN => {
                    map_src_min_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_SRC_MAX => {
                    map_src_max_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_TARGET_MIN => {
                    map_target_min_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_TARGET_MAX => {
                    map_target_max_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_TRIGGER => {
                    apply_envelope_trigger(
                        link_index,
                        mod_index,
                        voice_slot,
                        age,
                        modulation.value,
                    );
                }
                _ => cutoff_mod.push(mod_link.parameter_mode, modulation.value),
            }
        }

        let mut effective = base;
        effective.amount = amount_mod.apply(base.amount).clamp(-32.0, 32.0);
        effective.delay = delay_mod.apply(base.delay).clamp(0.0, 3.0);
        effective.noise = noise_mod.apply(base.noise).clamp(0.0, 1.0);
        effective.pan = pan_mod.apply(base.pan).clamp(-1.0, 1.0);
        let cutoff_value = cutoff_mod.apply(base.filter_cutoff);
        effective.filter_cutoff = if base.filter_type == 4 {
            cutoff_value.clamp(0.0, 1.0)
        } else {
            cutoff_value.clamp(20.0, sample_rate * 0.45)
        };
        effective.filter_resonance = resonance_mod.apply(base.filter_resonance).clamp(
            0.1,
            if base.filter_type == 4 {
                FORMANT_INTENSITY_MAX
            } else {
                12.0
            },
        );
        effective.distortion_gain = distortion_gain_mod
            .apply(base.distortion_gain)
            .clamp(0.1, 40.0);
        effective.env_delay = env_delay_mod.apply(base.env_delay).clamp(0.0, 4.0);
        effective.env_attack = env_attack_mod.apply(base.env_attack).clamp(0.001, 4.0);
        effective.env_decay = env_decay_mod.apply(base.env_decay).clamp(0.001, 4.0);
        effective.env_sustain = env_sustain_mod.apply(base.env_sustain).clamp(0.0, 1.0);
        effective.env_release = env_release_mod.apply(base.env_release).clamp(0.001, 6.0);
        effective.map_src_min = map_src_min_mod.apply(base.map_src_min);
        effective.map_src_max = map_src_max_mod.apply(base.map_src_max);
        effective.map_target_min = map_target_min_mod.apply(base.map_target_min);
        effective.map_target_max = map_target_max_mod.apply(base.map_target_max);

        LINK_PARAM_STACK[link_index] = false;
        effective
    }
}

#[allow(clippy::too_many_arguments)]
fn render_link_signal(
    link_index: usize,
    source: f64,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
    ignore_envelope: bool,
) -> LinkSignal {
    let link = effective_link_params(
        link_index,
        voice_slot,
        sample_rate,
        note_frequency,
        velocity,
        age,
        release_age,
        frame,
        stamp,
    );
    let filtered_source = apply_link_filter(link_index, link, voice_slot, sample_rate, source);
    let signal_source =
        apply_signal_mode(link_index, link, voice_slot, sample_rate, filtered_source);
    let noisy_source = apply_link_noise(signal_source, link, voice_slot);
    let distorted_source = apply_link_distortion(noisy_source, link, voice_slot);
    let envelope = if ignore_envelope {
        1.0
    } else {
        triggered_envelope_value(
            link_index,
            link,
            voice_slot,
            sample_rate,
            note_frequency,
            age,
            release_age,
        )
    };
    let delayed_source = apply_link_delay(
        link_index,
        link,
        voice_slot,
        sample_rate,
        distorted_source * envelope * velocity_scale(link.velocity_sensitivity, velocity),
    );
    observe_link_meter(link_index, source, delayed_source * link.amount, envelope);
    LinkSignal {
        signal: delayed_source,
        amount: link.amount,
        pan: link.pan,
        value: delayed_source * link.amount,
    }
}

fn render_node(
    node_index: usize,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
) -> f64 {
    unsafe {
        if node_index >= NODE_COUNT {
            return 0.0;
        }
        if CACHE_STAMPS[node_index] == stamp {
            return RENDER_CACHE[node_index];
        }
        if RENDER_STACK[node_index] {
            return FEEDBACK[voice_slot][node_index];
        }

        RENDER_STACK[node_index] = true;
        let node = NODES[node_index];
        let node_base_frequency = if node.wave == 7 {
            node.speed
        } else {
            base_frequency(node, note_frequency)
        };
        let mut phase_mod = ParamAccumulator::new();
        let mut frequency_mod = ParamAccumulator::new();
        let mut wave_mod = ParamAccumulator::new();
        let mut fold_drive = ParamAccumulator::new();
        let mut mix_amount = ParamAccumulator::new();
        let mut mix_signal = 0.0;
        let mut ring_amount = ParamAccumulator::new();
        let mut ring_signal = 0.0;
        let mut sample_start_mod = ParamAccumulator::new();
        let mut sample_end_mod = ParamAccumulator::new();
        let mut sample_stretch_mod = ParamAccumulator::new();

        for link_index in 0..LINK_COUNT {
            let link = LINKS[link_index];
            if link.to != node_index as i32 {
                continue;
            }
            let source = if link.from == node_index as i32 {
                FEEDBACK[voice_slot][node_index]
            } else if link.from >= 0 {
                render_node(
                    link.from as usize,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    release_age,
                    frame,
                    stamp,
                )
            } else {
                0.0
            };
            let modulation = render_link_signal(
                link_index,
                source,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
                link.target == TARGET_PHASE_RESET_TRIGGER,
            );
            match link.target {
                TARGET_FREQUENCY => frequency_mod.push(link.parameter_mode, modulation.value),
                TARGET_WAVE => wave_mod.push(link.parameter_mode, modulation.value),
                TARGET_PHASE_RESET_TRIGGER => {
                    apply_phase_reset_trigger(node_index, link_index, voice_slot, modulation.value);
                }
                TARGET_SAMPLE_START => sample_start_mod.push(link.parameter_mode, modulation.value),
                TARGET_SAMPLE_END => sample_end_mod.push(link.parameter_mode, modulation.value),
                TARGET_SAMPLE_STRETCH => {
                    sample_stretch_mod.push(link.parameter_mode, modulation.value)
                }
                TARGET_SAMPLE_TRIGGER => {
                    let start_mod = sample_start_mod.apply(node.sample_start) - node.sample_start;
                    let end_mod = sample_end_mod.apply(node.sample_end) - node.sample_end;
                    apply_sample_trigger(
                        node_index,
                        link_index,
                        voice_slot,
                        age,
                        modulation.value,
                        start_mod,
                        end_mod,
                    );
                }
                TARGET_RING => {
                    ring_amount.push(link.parameter_mode, modulation.amount);
                    ring_signal += modulation.signal * modulation.amount;
                }
                TARGET_FOLD => fold_drive.push(link.parameter_mode, modulation.value.abs()),
                TARGET_MIX => {
                    mix_amount.push(link.parameter_mode, modulation.amount.max(0.0));
                    mix_signal += modulation.signal * modulation.amount.max(0.0);
                }
                _ => phase_mod.push(link.parameter_mode, modulation.value),
            }
        }

        let phase = PHASES[voice_slot][node_index];
        let frequency_value = frequency_mod.apply(node_base_frequency).max(0.0);
        let phase_value = phase_mod.apply(0.0);
        let wave_value = wave_mod.apply(0.0);
        let fold_value = fold_drive.apply(0.0);
        let mix_value = mix_amount.apply(0.0);
        let ring_value = ring_amount.apply(0.0);
        let sample_start_value = sample_start_mod.apply(node.sample_start);
        let sample_end_value = sample_end_mod.apply(node.sample_end);
        let sample_stretch_value = sample_stretch_mod.apply(node.sample_stretch);
        let sample_start_offset = sample_start_value - node.sample_start;
        let sample_end_offset = sample_end_value - node.sample_end;
        let sample_stretch_offset = sample_stretch_value - node.sample_stretch;
        let active_wave = node.wave == 6
            || node.wave == 8
            || node.wave == 10
            || node.wave == 11
            || frequency_value > 0.0;
        let wave = modulated_wave(node.wave, wave_value);
        let custom_done = node.wave == 9
            && custom_mode_is_finite(node.custom_mode)
            && CUSTOM_WAVE_DONE[voice_slot][node_index];
        let mut value = if active_wave && !custom_done {
            if node.wave == 10 {
                sample_value(
                    node_index,
                    node,
                    voice_slot,
                    sample_rate,
                    sample_start_offset,
                    sample_end_offset,
                    sample_stretch_offset,
                )
            } else {
                oscillator(
                    node_index,
                    node,
                    phase + phase_value,
                    voice_slot,
                    frame,
                    wave,
                )
            }
        } else {
            0.0
        };
        value *= custom_one_shot_edge_gain(node, phase, frequency_value);

        if ring_value > 0.0 {
            let depth = ring_value.clamp(0.0, 1.0);
            value = sanitize_sample(
                value * (1.0 - depth) + value * (ring_signal / ring_value) * depth,
                4.0,
            );
        }
        if fold_value > 0.0 {
            value = sanitize_sample(
                fold_sample(value, 1.0 + fold_value.clamp(0.0, 8.0) * 3.0),
                4.0,
            );
        }
        if mix_value > 0.0 {
            let mix = mix_value.clamp(0.0, 1.0);
            let carrier_gain = if mix <= 0.5 {
                1.0
            } else {
                1.0 - (mix - 0.5) * 2.0
            };
            let modulator_gain = if mix_value > 1.0 {
                mix_value
            } else if mix >= 0.5 {
                1.0
            } else {
                mix * 2.0
            };
            value = sanitize_sample(
                value * carrier_gain + (mix_signal / mix_value) * modulator_gain,
                4.0,
            );
        }

        value = sanitize_sample(value, 4.0);
        FREQUENCY_MODS[node_index] = frequency_value;
        FREQUENCY_MOD_ACTIVE[node_index] = true;
        SAMPLE_STRETCH_MODS[node_index] = sample_stretch_offset;
        RENDER_CACHE[node_index] = value;
        CACHE_STAMPS[node_index] = stamp;
        FEEDBACK[voice_slot][node_index] = value;
        RENDER_STACK[node_index] = false;
        value
    }
}

fn finish_custom_phase(voice_slot: usize, node_index: usize, mut direction: f64, value: f64) {
    unsafe {
        if value >= 1.0 {
            CUSTOM_WAVE_DONE[voice_slot][node_index] = true;
            PHASES[voice_slot][node_index] = 1.0;
        } else {
            PHASES[voice_slot][node_index] = value.clamp(0.0, 1.0);
        }
        if direction == 0.0 {
            direction = 1.0;
        }
        CUSTOM_WAVE_DIRECTIONS[voice_slot][node_index] = direction;
    }
}

fn advance_custom_wave_phase(
    voice_slot: usize,
    node_index: usize,
    node: Node,
    step: f64,
    release_age: f64,
) {
    unsafe {
        let released = release_age >= 0.0;
        let current = PHASES[voice_slot][node_index];
        let mut direction = CUSTOM_WAVE_DIRECTIONS[voice_slot][node_index];
        if direction == 0.0 {
            direction = 1.0;
        }
        let start = node.custom_sustain_start.clamp(0.0, 0.999);
        let end = node.custom_sustain_end.clamp(start + 0.001, 1.0);
        let length = (end - start).max(0.001);

        match node.custom_mode {
            CUSTOM_MODE_PING_PONG => {
                let mut next = current + step * direction;
                if next >= 1.0 {
                    next = 1.0 - (next - 1.0);
                    direction = -1.0;
                } else if next <= 0.0 {
                    next = -next;
                    direction = 1.0;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_ONCE => {
                finish_custom_phase(voice_slot, node_index, direction, current + step);
            }
            CUSTOM_MODE_SUSTAIN => {
                let mut next = current + step;
                if !released && next >= start {
                    next = start;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_SUSTAIN_LOOP => {
                let mut next = current + step;
                if !released && next >= start {
                    next = start + (((next - start) % length) + length) % length;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_SUSTAIN_PING_PONG => {
                let mut next = current + step * direction;
                if !released {
                    if next >= end {
                        next = end - (next - end);
                        direction = -1.0;
                    } else if next <= start && current >= start {
                        next = start + (start - next);
                        direction = 1.0;
                    } else if next >= start && current < start {
                        direction = 1.0;
                    }
                    finish_custom_phase(voice_slot, node_index, direction, next);
                } else {
                    if direction < 0.0 && next <= start {
                        next = start + (start - next);
                        direction = 1.0;
                    }
                    finish_custom_phase(voice_slot, node_index, direction, next);
                }
            }
            _ => {
                PHASES[voice_slot][node_index] = normalize_phase(current + step);
                CUSTOM_WAVE_DIRECTIONS[voice_slot][node_index] = direction;
            }
        }
    }
}

fn advance_phases(voice_slot: usize, sample_rate: f64, note_frequency: f64, release_age: f64) {
    unsafe {
        for node_index in 0..NODE_COUNT {
            let node = NODES[node_index];
            if node.wave == 6 || node.wave == 8 || node.wave == 11 {
                FREQUENCY_MODS[node_index] = 0.0;
                FREQUENCY_MOD_ACTIVE[node_index] = false;
                continue;
            }
            let base = if node.wave == 7 {
                node.speed
            } else {
                base_frequency(node, note_frequency)
            };
            let frequency = if FREQUENCY_MOD_ACTIVE[node_index] {
                FREQUENCY_MODS[node_index]
            } else {
                base
            };
            let target_frequency = if node.wave == 7 {
                frequency
            } else {
                quantise_frequency(node, frequency, note_frequency)
            };
            let effective_frequency = if node.wave == 7 {
                target_frequency
            } else {
                glide_frequency(voice_slot, node_index, node, target_frequency, sample_rate)
            };
            let step = effective_frequency / sample_rate;
            if node.wave == 9 {
                advance_custom_wave_phase(voice_slot, node_index, node, step, release_age);
                FREQUENCY_MODS[node_index] = 0.0;
                FREQUENCY_MOD_ACTIVE[node_index] = false;
                continue;
            }
            if node.wave == 10 {
                if SAMPLE_PLAYING[voice_slot][node_index] {
                    if SAMPLE_RELEASE_AGES[voice_slot][node_index] >= 0.0 {
                        SAMPLE_RELEASE_AGES[voice_slot][node_index] += 1.0 / sample_rate.max(1.0);
                        SAMPLE_STRETCH_MODS[node_index] = 0.0;
                        FREQUENCY_MODS[node_index] = 0.0;
                        FREQUENCY_MOD_ACTIVE[node_index] = false;
                        continue;
                    }
                    let sample_step = sample_playback_step(
                        node_index,
                        node,
                        note_frequency,
                        frequency,
                        sample_rate,
                    )
                    .abs()
                    .max(0.0001);
                    let stretch =
                        (node.sample_stretch + SAMPLE_STRETCH_MODS[node_index]).max(0.001);
                    SAMPLE_PLAYBACK_AGES[voice_slot][node_index] += 1.0 / sample_rate.max(1.0);
                    SAMPLE_POSITIONS[voice_slot][node_index] +=
                        (sample_step / stretch) * SAMPLE_DIRECTIONS[voice_slot][node_index];
                    if (stretch - 1.0).abs() < 0.001 {
                        SAMPLE_STRETCH_PHASES[voice_slot][node_index] = 0.0;
                        SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] =
                            SAMPLE_POSITIONS[voice_slot][node_index];
                    } else {
                        let (_, _, _, _, _, length) = sample_range(node_index, node, 0.0, 0.0)
                            .unwrap_or((0.0, 0.0, 0.0, 0.0, 1.0, 512.0));
                        let grain_frames =
                            node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
                        let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
                            0.0
                        } else {
                            (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                                .round()
                                .clamp(1.0, (grain_frames - 1.0).max(1.0))
                        };
                        let hop_frames = (grain_frames - overlap_frames).max(1.0);
                        SAMPLE_STRETCH_PHASES[voice_slot][node_index] += sample_step;
                        while SAMPLE_STRETCH_PHASES[voice_slot][node_index] >= grain_frames {
                            SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] +=
                                (hop_frames / stretch) * SAMPLE_DIRECTIONS[voice_slot][node_index];
                            SAMPLE_STRETCH_PHASES[voice_slot][node_index] -= hop_frames;
                        }
                    }
                }
                SAMPLE_STRETCH_MODS[node_index] = 0.0;
                FREQUENCY_MODS[node_index] = 0.0;
                FREQUENCY_MOD_ACTIVE[node_index] = false;
                continue;
            }
            let next_phase = PHASES[voice_slot][node_index] + step;
            if node.wave == 5 && next_phase >= 1.0 {
                SAMPLE_HOLDS[voice_slot][node_index] = random_unit(voice_slot);
                SAMPLE_HOLD_SET[voice_slot][node_index] = true;
            }
            if node.wave == 7 && next_phase >= 1.0 {
                if !PERLIN_SET[voice_slot][node_index] {
                    PERLIN_CURRENT[voice_slot][node_index] = random_bipolar(voice_slot);
                    PERLIN_NEXT[voice_slot][node_index] = random_bipolar(voice_slot);
                    PERLIN_SET[voice_slot][node_index] = true;
                }
                PERLIN_CURRENT[voice_slot][node_index] = PERLIN_NEXT[voice_slot][node_index];
                PERLIN_NEXT[voice_slot][node_index] = random_bipolar(voice_slot);
            }
            PHASES[voice_slot][node_index] = normalize_phase(next_phase);
            FREQUENCY_MODS[node_index] = 0.0;
            FREQUENCY_MOD_ACTIVE[node_index] = false;
        }
    }
}

fn dsp_reg(index: i32) -> f64 {
    unsafe {
        if index < 0 || index as usize >= MAX_DSP_REGS {
            0.0
        } else {
            DSP_REGS[index as usize]
        }
    }
}

fn set_dsp_reg(index: i32, value: f64) {
    unsafe {
        if index >= 0 && (index as usize) < MAX_DSP_REGS {
            DSP_REGS[index as usize] = if value.is_finite() {
                value.clamp(-12_000.0, 12_000.0)
            } else {
                0.0
            };
        }
    }
}

fn dsp_value(index: i32) -> f64 {
    unsafe {
        if index < 0 || index as usize >= MAX_DSP_VALUES {
            0.0
        } else {
            DSP_VALUES[index as usize]
        }
    }
}

fn dsp_value_target(index: i32) -> f64 {
    unsafe {
        if index < 0 || index as usize >= MAX_DSP_VALUES {
            0.0
        } else {
            DSP_VALUE_TARGETS[index as usize]
        }
    }
}

fn advance_dsp_values(sample_rate: f64) {
    let alpha = 1.0 - (-1.0 / (sample_rate * DSP_VALUE_SMOOTH_SECONDS.max(0.001))).exp();
    unsafe {
        for index in 0..DSP_VALUE_ACTIVE_COUNT {
            if !DSP_VALUE_INITIALIZED[index] {
                continue;
            }
            let current = DSP_VALUES[index];
            let target = DSP_VALUE_TARGETS[index];
            let next = current + (target - current) * alpha;
            DSP_VALUES[index] = if (target - next).abs() <= DSP_VALUE_SETTLE_EPSILON {
                target
            } else {
                next
            };
        }
    }
}

fn dsp_oscillator(wave: i32, phase: f64) -> f64 {
    let p = normalize_phase(phase);
    match wave {
        1 => 1.0 - 4.0 * ((p - 0.25).round() - (p - 0.25)).abs(),
        2 => p * 2.0 - 1.0,
        3 => 1.0 - p * 2.0,
        4 => {
            if p < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        _ => (TWO_PI * p).sin(),
    }
}

fn dsp_sample_hold_value(input_register: i32) -> f64 {
    if input_register >= 0 {
        sanitize_control_value(dsp_reg(input_register))
    } else {
        random_unit(DRONE_VOICE_SLOT)
    }
}

fn render_dsp_biquad_state(
    state_index: usize,
    sample: f64,
    coefficients: (f64, f64, f64, f64, f64),
) -> f64 {
    unsafe {
        if state_index + 3 >= MAX_DSP_STATE {
            return sanitize_sample(sample, 4.0);
        }

        let (b0, b1, b2, a1, a2) = coefficients;
        let x1 = DSP_STATE[state_index];
        let x2 = DSP_STATE[state_index + 1];
        let y1 = DSP_STATE[state_index + 2];
        let y2 = DSP_STATE[state_index + 3];
        let output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        DSP_STATE[state_index + 1] = sanitize_sample(x1, 4.0);
        DSP_STATE[state_index] = sanitize_sample(sample, 4.0);
        DSP_STATE[state_index + 3] = sanitize_sample(y1, 4.0);
        DSP_STATE[state_index + 2] = sanitize_sample(output, 4.0);
        sanitize_sample(output, 4.0)
    }
}

fn render_dsp_formant_filter(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.b), 4.0);
    if op.state < 0 || (op.state as usize + MAX_FORMANT_BANDS * 4 - 1) >= MAX_DSP_STATE {
        return sample;
    }

    let state_index = op.state as usize;
    let morph = dsp_reg(op.c);
    let intensity = dsp_reg(op.d).clamp(0.1, FORMANT_INTENSITY_MAX);
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let mut wet = 0.0;

    for band_index in 0..MAX_FORMANT_BANDS {
        let (frequency, q, gain) = formant_band(morph, intensity, band_index, sample_rate);
        let coefficients = filter_coefficients(3, frequency, q, sample_rate);
        wet += render_dsp_biquad_state(state_index + band_index * 4, sample, coefficients) * gain;
    }

    let dry_mix = 0.42 - strength * 0.18 - overdrive * 0.16;
    let wet_mix = 0.46 + strength * 0.38 + overdrive * 0.95;
    sanitize_sample(sample * dry_mix + wet * wet_mix, 4.0)
}

fn render_dsp_equalizer(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.b), 4.0);
    if op.state < 0 || (op.state as usize + 11) >= MAX_DSP_STATE {
        return sample;
    }

    let state_index = op.state as usize;
    let gains = [dsp_reg(op.c), dsp_reg(op.d), dsp_reg(op.e)];
    let mut output = sample;
    for (band, gain) in gains.into_iter().enumerate() {
        output = render_dsp_biquad_state(
            state_index + band * 4,
            output,
            equalizer_coefficients(band as i32, gain, sample_rate),
        );
    }
    sanitize_sample(output, 4.0)
}

fn render_dsp_comb_filter(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return sanitize_sample(dsp_reg(op.b), 4.0);
    };
    unsafe {
        let sample = sanitize_sample(dsp_reg(op.b), 4.0);
        let frequency = dsp_reg(op.c)
            .clamp(20.0, sample_rate.max(1.0) * 0.45)
            .min(5_000.0);
        let delay_samples =
            (sample_rate.max(1.0) / frequency).clamp(1.0, (MAX_DSP_DELAY_SAMPLES - 1) as f64);
        let feedback = dsp_reg(op.d).clamp(-0.98, 0.98);
        let index = DSP_EFFECT_INDICES[slot];
        let delayed = sanitize_sample(read_dsp_effect_delay(slot, index, delay_samples), 4.0);

        DSP_EFFECT_BUFFERS[slot][index] = sanitize_sample(sample + delayed * feedback, 4.0) as f32;
        DSP_EFFECT_INDICES[slot] = (index + 1) % MAX_DSP_DELAY_SAMPLES;

        if op.a == 6 {
            sanitize_sample(sample - delayed * feedback.abs().max(0.45), 4.0)
        } else {
            sanitize_sample(delayed, 4.0)
        }
    }
}

fn render_dsp_filter(op: DspOp, sample_rate: f64) -> f64 {
    if op.a == 4 {
        return render_dsp_formant_filter(op, sample_rate);
    }
    if op.a == 5 || op.a == 6 {
        return render_dsp_comb_filter(op, sample_rate);
    }
    if op.a == 7 {
        return render_dsp_equalizer(op, sample_rate);
    }

    if op.state < 0 {
        return dsp_reg(op.b);
    }
    let cutoff = dsp_reg(op.c);
    let resonance = dsp_reg(op.d);
    let coefficients = filter_coefficients(op.a, cutoff, resonance, sample_rate);
    render_dsp_biquad_state(op.state as usize, dsp_reg(op.b), coefficients)
}

fn render_dsp_selector(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 3) >= MAX_DSP_STATE {
            return dsp_reg(op.c);
        }

        let state_index = op.state as usize;
        let input = dsp_reg(op.c);
        let max_index = op.e.max(1) as f64;
        let selected_index = dsp_reg(op.a).floor() as i32;

        // Selector inputs are 1-based. A zero (or out-of-range) selection keeps
        // the previous selection active, allowing sparse trigger signals to
        // switch a selector without resetting it between pulses. The active
        // selection must still be rendered while the input is zero so its slide
        // can finish instead of advancing for a single sample only.
        let previous_index = DSP_STATE[state_index + 1].round() as i32;
        let has_new_selection = selected_index >= 1
            && (selected_index as f64) <= max_index
            && selected_index == op.d;
        let continues_previous_selection = (selected_index < 1 || (selected_index as f64) > max_index)
            && previous_index == op.d;
        if has_new_selection || continues_previous_selection {
            let uninitialized = DSP_STATE[state_index] == 0.0
                && DSP_STATE[state_index + 1] == 0.0
                && DSP_STATE[state_index + 2] == 0.0
                && DSP_STATE[state_index + 3] == 0.0;
            let slide = dsp_reg(op.b).max(0.0);
            let sample_rate = sample_rate.max(1.0);

            if uninitialized {
                DSP_STATE[state_index] = sanitize_control_value(input);
                DSP_STATE[state_index + 1] = selected_index as f64;
                DSP_STATE[state_index + 2] = sanitize_control_value(input);
                DSP_STATE[state_index + 3] = slide;
            } else if has_new_selection && previous_index != selected_index {
                DSP_STATE[state_index + 2] = DSP_STATE[state_index];
                DSP_STATE[state_index + 3] = 0.0;
                DSP_STATE[state_index + 1] = selected_index as f64;
            }

            if slide <= 0.0 {
                DSP_STATE[state_index] = sanitize_control_value(input);
                DSP_STATE[state_index + 3] = slide;
            } else {
                let elapsed = (DSP_STATE[state_index + 3] + (1.0 / sample_rate)).min(slide);
                let mix = (elapsed / slide).clamp(0.0, 1.0);
                let start = DSP_STATE[state_index + 2];
                let output = if mix >= 1.0 {
                    input
                } else {
                    start + (input - start) * mix
                };
                DSP_STATE[state_index] = sanitize_control_value(output);
                DSP_STATE[state_index + 3] = elapsed;
            }
        }

        sanitize_control_value(DSP_STATE[state_index])
    }
}

fn dsp_effect_slot(state: i32) -> Option<usize> {
    if state < 0 {
        return None;
    }
    Some((state as usize) % MAX_DSP_EFFECT_SLOTS)
}

fn dsp_buffer_slot(state: i32) -> Option<usize> {
    unsafe {
        if state < 0 || state as usize >= MAX_DSP_STATE {
            return None;
        }

        let state_index = state as usize;
        let existing = DSP_BUFFER_STATE_SLOTS[state_index];
        if existing >= 0 && (existing as usize) < MAX_DSP_BUFFER_SLOTS {
            return Some(existing as usize);
        }

        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            if DSP_BUFFER_SLOT_STATES[slot] < 0 {
                DSP_BUFFER_SLOT_STATES[slot] = state;
                DSP_BUFFER_STATE_SLOTS[state_index] = slot as i32;
                return Some(slot);
            }
        }

        None
    }
}

fn read_dsp_effect_delay(slot: usize, write_index: usize, delay_samples: f64) -> f64 {
    unsafe {
        let length = MAX_DSP_DELAY_SAMPLES;
        let delay_samples = delay_samples.clamp(1.0, (length - 1) as f64);
        let mut index = write_index as f64 - delay_samples;
        while index < 0.0 {
            index += length as f64;
        }
        let index_a = index.floor() as usize % length;
        let index_b = (index_a + 1) % length;
        let fraction = index - index.floor();
        DSP_EFFECT_BUFFERS[slot][index_a] as f64 * (1.0 - fraction)
            + DSP_EFFECT_BUFFERS[slot][index_b] as f64 * fraction
    }
}

fn read_dsp_buffer(slot: usize, length: usize, head: f64) -> f64 {
    unsafe {
        let length = length.clamp(2, MAX_DSP_BUFFER_SAMPLES);
        let position = normalize_phase(head) * length as f64;
        let index_a = position.floor() as usize % length;
        let index_b = (index_a + 1) % length;
        let fraction = position - position.floor();
        DSP_BUFFER_BUFFERS[slot][index_a] as f64 * (1.0 - fraction)
            + DSP_BUFFER_BUFFERS[slot][index_b] as f64 * fraction
    }
}

fn write_dsp_buffer(slot: usize, length: usize, head: f64, sample: f64) {
    unsafe {
        let length = length.clamp(2, MAX_DSP_BUFFER_SAMPLES);
        let position = normalize_phase(head) * length as f64;
        let index = position.floor() as usize % length;
        DSP_BUFFER_BUFFERS[slot][index] = sanitize_sample(sample, 8.0) as f32;
    }
}

fn render_dsp_playhead(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return normalize_phase(dsp_reg(op.a));
        }

        let state_index = op.state as usize;
        let relative_position = normalize_phase(DSP_STATE[state_index]);
        let output = normalize_phase(dsp_reg(op.a) + relative_position);
        let step = dsp_reg(op.b) / sample_rate.max(1.0);
        DSP_STATE[state_index] = normalize_phase(relative_position + step);
        output
    }
}

fn render_dsp_buffer(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_buffer_slot(op.state) else {
        return 0.0;
    };

    let length_samples = (dsp_reg(op.d).max(0.001) * sample_rate.max(1.0))
        .round()
        .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
    let output = read_dsp_buffer(slot, length_samples, dsp_reg(op.b));
    write_dsp_buffer(slot, length_samples, dsp_reg(op.c), dsp_reg(op.a));
    sanitize_sample(output, 8.0)
}

fn render_dsp_delay(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    unsafe {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let time = dsp_reg(op.b).clamp(0.001, 1.5);
        let feedback = dsp_reg(op.c).clamp(0.0, 0.98);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        let index = DSP_EFFECT_INDICES[slot];
        let delayed = sanitize_sample(
            read_dsp_effect_delay(slot, index, time * sample_rate.max(1.0)),
            8.0,
        );
        DSP_EFFECT_BUFFERS[slot][index] = sanitize_sample(sample + delayed * feedback, 8.0) as f32;
        DSP_EFFECT_INDICES[slot] = (index + 1) % MAX_DSP_DELAY_SAMPLES;
        sanitize_sample(sample * (1.0 - mix) + delayed * mix, 8.0)
    }
}

fn render_dsp_chorus(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    unsafe {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let rate = dsp_reg(op.b).clamp(0.05, 12.0);
        let depth = dsp_reg(op.c).clamp(0.001, 0.08);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        let index = DSP_EFFECT_INDICES[slot];
        let phase_index = op.state as usize;
        let phase = if phase_index < MAX_DSP_STATE {
            DSP_STATE[phase_index]
        } else {
            0.0
        };
        let lfo = 0.5 + 0.5 * phase.sin();
        let delay_samples = (0.012 + depth * lfo) * sample_rate.max(1.0);
        let delayed = sanitize_sample(read_dsp_effect_delay(slot, index, delay_samples), 8.0);
        DSP_EFFECT_BUFFERS[slot][index] = sample as f32;
        DSP_EFFECT_INDICES[slot] = (index + 1) % MAX_DSP_DELAY_SAMPLES;
        if phase_index < MAX_DSP_STATE {
            DSP_STATE[phase_index] = (phase + (TWO_PI * rate) / sample_rate.max(1.0)) % TWO_PI;
        }
        sanitize_sample(sample * (1.0 - mix) + delayed * mix, 8.0)
    }
}

fn render_dsp_reverb(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    unsafe {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let size = dsp_reg(op.b).clamp(0.1, 1.0);
        let decay = dsp_reg(op.c).clamp(0.0, 0.96);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        let index = DSP_EFFECT_INDICES[slot];
        let scale = 0.45 + size * 0.9;
        let wet = (read_dsp_effect_delay(slot, index, 0.029 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.037 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.041 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.053 * scale * sample_rate.max(1.0)))
            * 0.25;
        DSP_EFFECT_BUFFERS[slot][index] = sanitize_sample(sample + wet * decay, 8.0) as f32;
        DSP_EFFECT_INDICES[slot] = (index + 1) % MAX_DSP_DELAY_SAMPLES;
        sanitize_sample(sample * (1.0 - mix) + wet * mix, 8.0)
    }
}

fn envelope_coefficient(seconds: f64, sample_rate: f64) -> f64 {
    if seconds <= 0.0 {
        1.0
    } else {
        1.0 - (-1.0 / (sample_rate.max(1.0) * seconds.max(0.000001))).exp()
    }
}

fn render_dsp_envelope(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 5) >= MAX_DSP_STATE {
            return 0.0;
        }

        let state_index = op.state as usize;
        let trigger = dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let gate = dsp_reg(op.b) >= ENVELOPE_TRIGGER_THRESHOLD;
        let was_triggered = DSP_STATE[state_index + 1] > 0.5;
        let was_gated = DSP_STATE[state_index + 5] > 0.5;
        let delay = dsp_reg(op.c).max(0.0);
        let attack = dsp_reg(op.d).max(0.0);
        let decay = dsp_reg(op.e).max(0.0);
        let packed = op.value.round() as i32;
        let sustain_register = packed.rem_euclid(MAX_DSP_REGS as i32);
        let release_register = packed.div_euclid(MAX_DSP_REGS as i32);
        let sustain = dsp_reg(sustain_register).clamp(0.0, 1.0);
        let gate_length_register = (op.value2.round() as i32) - 1;
        let gate_length = if gate_length_register >= 0 {
            dsp_reg(gate_length_register).max(0.0)
        } else {
            0.0
        };
        let release = dsp_reg(release_register).max(0.0);
        let dt = 1.0 / sample_rate.max(1.0);
        let mut env = DSP_STATE[state_index].clamp(0.0, 1.0);
        let mut stage = DSP_STATE[state_index + 2].round() as i32;
        let mut stage_time = DSP_STATE[state_index + 3].max(0.0);
        let mut release_start = DSP_STATE[state_index + 4].clamp(0.0, 1.0);
        let trigger_edge = trigger && !was_triggered;
        let gate_opened = gate && !was_gated;
        let gate_closed = !gate && was_gated;

        if trigger_edge || gate_opened {
            stage = if delay > 0.0 { 5 } else { 1 };
            stage_time = 0.0;
        } else if gate_closed {
            stage = 4;
            stage_time = 0.0;
            release_start = env;
        }

        match stage {
            5 => {
                stage_time += dt;
                env = 0.0;
                if stage_time >= delay {
                    stage = 1;
                    stage_time = 0.0;
                }
            }
            1 => {
                stage_time += dt;
                env = if attack <= 0.0 {
                    1.0
                } else {
                    (stage_time / attack).clamp(0.0, 1.0)
                };
                if env >= 1.0 {
                    stage = 2;
                    stage_time = 0.0;
                }
            }
            2 => {
                stage_time += dt;
                env = if decay <= 0.0 {
                    sustain
                } else {
                    1.0 + (sustain - 1.0) * (stage_time / decay).clamp(0.0, 1.0)
                };
                if stage_time >= decay {
                    env = sustain;
                    stage_time = 0.0;
                    if gate {
                        stage = 3;
                    } else if gate_length > 0.0 {
                        stage = 6;
                    } else {
                        stage = 4;
                        release_start = env;
                    }
                }
            }
            3 => {
                if gate {
                    env = sustain;
                } else {
                    stage = 4;
                    stage_time = 0.0;
                    release_start = env;
                }
            }
            6 => {
                stage_time += dt;
                env = sustain;
                if stage_time >= gate_length {
                    stage = 4;
                    stage_time = 0.0;
                    release_start = env;
                }
            }
            4 => {
                stage_time += dt;
                env = if release <= 0.0 {
                    0.0
                } else {
                    release_start * (1.0 - (stage_time / release).clamp(0.0, 1.0))
                };
                if env <= 0.000001 {
                    env = 0.0;
                    stage = 0;
                    stage_time = 0.0;
                }
            }
            _ => {
                env = if gate { env } else { 0.0 };
            }
        }

        DSP_STATE[state_index] = sanitize_control_value(env).clamp(0.0, 1.0);
        DSP_STATE[state_index + 1] = if trigger { 1.0 } else { 0.0 };
        DSP_STATE[state_index + 2] = stage as f64;
        DSP_STATE[state_index + 3] = stage_time;
        DSP_STATE[state_index + 4] = release_start;
        DSP_STATE[state_index + 5] = if gate { 1.0 } else { 0.0 };
        DSP_STATE[state_index]
    }
}

fn render_dsp_follower(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return dsp_reg(op.a).abs();
        }

        let state_index = op.state as usize;
        let target = dsp_reg(op.a).abs();
        let current = DSP_STATE[state_index].max(0.0);
        let attack = dsp_reg(op.b).max(0.0);
        let release = dsp_reg(op.c).max(0.0);
        let coefficient = if target > current {
            envelope_coefficient(attack, sample_rate)
        } else {
            envelope_coefficient(release, sample_rate)
        };
        let next = current + (target - current) * coefficient;
        DSP_STATE[state_index] = sanitize_control_value(next).max(0.0);
        DSP_STATE[state_index]
    }
}

fn render_dsp_distortion(op: DspOp) -> f64 {
    let distortion_type = dsp_reg(op.c).round() as i32;
    if distortion_type <= 0 {
        return dsp_reg(op.a);
    }

    let gain = dsp_reg(op.b).clamp(0.1, 40.0);
    let sample = dsp_reg(op.a);
    let driven = sanitize_sample(sample * gain, 32.0);
    let output = match distortion_type {
        1 => driven.clamp(-1.0, 1.0),
        3 => {
            let fuzz = driven.signum() * (1.0 - (-driven.abs() * 2.6).exp());
            fuzz + random_bipolar(DRONE_VOICE_SLOT) * (gain * 0.002).min(0.08)
        }
        4 => driven / (1.0 + driven.abs()),
        5 => fold_sample(sample, gain),
        _ => driven.tanh(),
    };
    sanitize_sample(output, 4.0)
}

fn dsp_sample_node_index(sample_index: i32) -> Option<usize> {
    unsafe {
        if sample_index < 0 || sample_index as usize >= MAX_DSP_SAMPLE_NODES {
            return None;
        }
        let node_index = DSP_SAMPLE_NODE_INDICES[sample_index as usize];
        if node_index < 0 || node_index as usize >= NODE_COUNT {
            return None;
        }
        Some(node_index as usize)
    }
}

fn render_dsp_sample_param(op: DspOp) {
    let Some(node_index) = dsp_sample_node_index(op.a) else {
        return;
    };
    let value = dsp_reg(op.c);
    unsafe {
        match op.b {
            0 => {
                NODES[node_index].sample_mode =
                    (value.round() as i32).clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG)
            }
            1 => NODES[node_index].sample_start = value.clamp(0.0, 1.0),
            2 => NODES[node_index].sample_end = value.clamp(0.0, 1.0),
            3 => NODES[node_index].sample_attack = value.max(0.0),
            4 => NODES[node_index].sample_release = value.max(0.0),
            5 => NODES[node_index].sample_stretch = value.max(0.001),
            6 => NODES[node_index].sample_cycle_length = value.round().max(1.0),
            7 => NODES[node_index].sample_overlap_ratio = value.clamp(0.0, 1.0),
            8 => NODES[node_index].sample_original_frequency = value.max(0.0001),
            _ => {}
        }
    }
}

fn advance_dsp_sample_player(
    node_index: usize,
    node: Node,
    target_frequency: f64,
    sample_rate: f64,
) {
    unsafe {
        let voice_slot = DRONE_VOICE_SLOT;
        if !SAMPLE_PLAYING[voice_slot][node_index] {
            return;
        }
        if SAMPLE_RELEASE_AGES[voice_slot][node_index] >= 0.0 {
            SAMPLE_RELEASE_AGES[voice_slot][node_index] += 1.0 / sample_rate.max(1.0);
            return;
        }

        let sample_step = sample_playback_step(
            node_index,
            node,
            target_frequency,
            target_frequency,
            sample_rate,
        )
        .abs()
        .max(0.0001);
        let stretch = node.sample_stretch.max(0.001);
        SAMPLE_PLAYBACK_AGES[voice_slot][node_index] += 1.0 / sample_rate.max(1.0);
        SAMPLE_POSITIONS[voice_slot][node_index] +=
            (sample_step / stretch) * SAMPLE_DIRECTIONS[voice_slot][node_index];
        if (stretch - 1.0).abs() < 0.001 {
            SAMPLE_STRETCH_PHASES[voice_slot][node_index] = 0.0;
            SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] =
                SAMPLE_POSITIONS[voice_slot][node_index];
            return;
        }

        let (_, _, _, _, _, length) =
            sample_range(node_index, node, 0.0, 0.0).unwrap_or((0.0, 0.0, 0.0, 0.0, 1.0, 512.0));
        let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
        let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
            0.0
        } else {
            (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                .round()
                .clamp(1.0, (grain_frames - 1.0).max(1.0))
        };
        let hop_frames = (grain_frames - overlap_frames).max(1.0);
        SAMPLE_STRETCH_PHASES[voice_slot][node_index] += sample_step;
        while SAMPLE_STRETCH_PHASES[voice_slot][node_index] >= grain_frames {
            SAMPLE_STRETCH_ANCHORS[voice_slot][node_index] +=
                (hop_frames / stretch) * SAMPLE_DIRECTIONS[voice_slot][node_index];
            SAMPLE_STRETCH_PHASES[voice_slot][node_index] -= hop_frames;
        }
    }
}

fn render_dsp_sample(op: DspOp, sample_rate: f64) -> f64 {
    let Some(node_index) = dsp_sample_node_index(op.a) else {
        return 0.0;
    };
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return 0.0;
        }

        let voice_slot = DRONE_VOICE_SLOT;
        let trigger = dsp_reg(op.c) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_trigger = DSP_STATE[op.state as usize] >= ENVELOPE_TRIGGER_THRESHOLD;
        let node = NODES[node_index];
        let has_sample = sample_slot_for_node(node_index).is_some();

        if !has_sample {
            DSP_STATE[op.state as usize] = 0.0;
            return 0.0;
        }

        if trigger && !previous_trigger {
            start_sample_player(node_index, voice_slot, node, 0.0, 0.0);
        }
        DSP_STATE[op.state as usize] = if trigger { 1.0 } else { 0.0 };

        let value = sample_value(node_index, node, voice_slot, sample_rate, 0.0, 0.0, 0.0);
        advance_dsp_sample_player(node_index, node, dsp_reg(op.b), sample_rate);
        sanitize_sample(value, 4.0)
    }
}

fn render_dsp_function(op: DspOp) -> f64 {
    let x = dsp_reg(op.b);
    let y = dsp_reg(op.c);
    let z = dsp_reg(op.d);
    let output = match op.a {
        1 => x.abs(),
        2 => x.sin(),
        3 => x.cos(),
        4 => x.tan(),
        5 => x.tanh(),
        6 => x.min(y),
        7 => x.max(y),
        8 => x.clamp(y.min(z), y.max(z)),
        9 => sign_preserving_pow(x, y),
        10 => x.clamp(-60.0, 60.0).exp(),
        11 => x.max(0.000001).ln(),
        12 => x.max(0.0).sqrt(),
        13 => x.floor(),
        14 => x.ceil(),
        15 => x.round(),
        16 => {
            if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }
        17 => x - x.floor(),
        18 => x + (y - x) * z,
        _ => 0.0,
    };
    sanitize_control_value(output)
}

fn sign_preserving_pow(base: f64, exponent: f64) -> f64 {
    let magnitude = base.abs().powf(exponent);
    if base > 0.0 {
        magnitude
    } else if base < 0.0 {
        -magnitude
    } else {
        0.0
    }
}

fn render_dsp_midi_note(op: DspOp) -> f64 {
    unsafe {
        let channel = dsp_reg(op.b).round().clamp(0.0, 16.0);
        if channel > 0.0 && (channel - DSP_CURRENT_CHANNEL).abs() > 0.5 {
            return 0.0;
        }
        match op.a {
            1 => DSP_CURRENT_FREQUENCY,
            2 => DSP_CURRENT_VELOCITY,
            3 => DSP_CURRENT_GATE,
            4 => DSP_CURRENT_TRIGGER,
            _ => DSP_CURRENT_NOTE,
        }
    }
}

fn render_dsp_midi_cc(op: DspOp) -> f64 {
    let cc = dsp_reg(op.a).round().clamp(0.0, 127.0) as usize;
    let channel = dsp_reg(op.b).round().clamp(0.0, 16.0) as usize;
    unsafe { DSP_MIDI_CC_VALUES[channel][cc] }
}

fn tempo_division_beats(kind: i32) -> f64 {
    match kind.rem_euclid(TEMPO_OUTPUT_COUNT) {
        0 => 16.0,
        1 => 8.0,
        2 => 4.0,
        3 => 4.0,
        4 => 2.0,
        5 => 1.0,
        6 => 1.0,
        7 => 0.5,
        8 => 0.25,
        9 => 0.125,
        _ => 1.0,
    }
}

fn tempo_click_phase_offset(kind: i32) -> f64 {
    if kind.rem_euclid(TEMPO_OUTPUT_COUNT) == 6 {
        0.5
    } else {
        0.0
    }
}

fn advance_dsp_tempo_clock(source_index: usize, bpm: f64, sample_rate: f64, frame: usize) {
    unsafe {
        let source_index = source_index.min(MAX_DSP_TEMPO_SOURCES - 1);
        let frame = (frame as u32).min(MAX_WASM_FRAMES as u32);
        if DSP_TEMPO_LAST_QUANTUM_BY_SOURCE[source_index] == DSP_RENDER_QUANTUM_ID
            && DSP_TEMPO_LAST_FRAME_BY_SOURCE[source_index] == frame
        {
            return;
        }

        DSP_TEMPO_LAST_QUANTUM_BY_SOURCE[source_index] = DSP_RENDER_QUANTUM_ID;
        DSP_TEMPO_LAST_FRAME_BY_SOURCE[source_index] = frame;
        DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE[source_index] = false;

        let bpm = bpm.clamp(1.0, 999.0);
        let step = (bpm / 60.0) / sample_rate.max(1.0);
        if !DSP_TEMPO_STARTED_BY_SOURCE[source_index] {
            DSP_TEMPO_STARTED_BY_SOURCE[source_index] = true;
            DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE[source_index] = true;
        }

        let previous = DSP_TEMPO_BEATS_BY_SOURCE[source_index].max(0.0);
        DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE[source_index] = previous;
        DSP_TEMPO_BEATS_BY_SOURCE[source_index] =
            sanitize_control_value(previous + step.max(0.0)).max(0.0);
    }
}

fn tempo_boundary_crossed(
    previous_beats: f64,
    current_beats: f64,
    division_beats: f64,
    offset_beats: f64,
) -> bool {
    if division_beats <= 0.0 || current_beats <= previous_beats {
        return false;
    }

    let previous_boundary = ((previous_beats - offset_beats) / division_beats).floor();
    let current_boundary = ((current_beats - offset_beats) / division_beats).floor();
    current_boundary > previous_boundary
}

fn tempo_swung_boundary_time(
    boundary_index: i64,
    division_beats: f64,
    offset_beats: f64,
    swing: f64,
) -> f64 {
    let base = offset_beats + boundary_index as f64 * division_beats;
    if boundary_index.rem_euclid(2) == 0 {
        base
    } else {
        base + swing.clamp(-1.0, 1.0) * division_beats * 0.5
    }
}

fn tempo_swung_boundary_crossed(
    previous_beats: f64,
    current_beats: f64,
    division_beats: f64,
    offset_beats: f64,
    swing: f64,
) -> bool {
    if swing.abs() < 0.000001 {
        return tempo_boundary_crossed(previous_beats, current_beats, division_beats, offset_beats);
    }

    if division_beats <= 0.0 || current_beats <= previous_beats {
        return false;
    }

    let max_shift = division_beats * 0.5;
    let start_index =
        ((previous_beats - offset_beats - max_shift) / division_beats).floor() as i64 - 1;
    let end_index =
        ((current_beats - offset_beats + max_shift) / division_beats).floor() as i64 + 1;

    for boundary_index in start_index..=end_index {
        let boundary =
            tempo_swung_boundary_time(boundary_index, division_beats, offset_beats, swing);
        if boundary > previous_beats && boundary <= current_beats {
            return true;
        }
    }

    false
}

fn render_dsp_tempo(op: DspOp, frame: usize, sample_rate: f64) -> f64 {
    unsafe {
        if sample_rate <= 0.0 {
            return 0.0;
        }

        let source = dsp_reg(op.b).round() as i32;
        let midi_source = dsp_reg(op.d)
            .round()
            .clamp(0.0, (MAX_DSP_TEMPO_SOURCES - 1) as f64) as usize;
        let internal_bpm = dsp_reg(op.a).clamp(1.0, 999.0);
        let source_index = if source == 1 {
            midi_source
        } else {
            DSP_TEMPO_INTERNAL_SOURCE
        };
        let bpm = if source == 1 {
            if midi_source == 0 {
                DSP_TEMPO_BPM
            } else {
                DSP_TEMPO_BPM_BY_SOURCE[midi_source]
            }
        } else {
            internal_bpm
        }
        .clamp(1.0, 999.0);
        let swing = dsp_reg(op.e).clamp(-1.0, 1.0);
        advance_dsp_tempo_clock(source_index, bpm, sample_rate, frame);

        let frequency = (bpm / 60.0) / tempo_division_beats(op.c);
        if op.c >= TEMPO_OUTPUT_COUNT {
            return sanitize_control_value(frequency);
        }

        let offset = tempo_click_phase_offset(op.c);
        let click = if DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE[source_index] && offset <= 0.0 {
            true
        } else {
            tempo_swung_boundary_crossed(
                DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE[source_index],
                DSP_TEMPO_BEATS_BY_SOURCE[source_index],
                tempo_division_beats(op.c),
                offset,
                swing,
            )
        };
        if click {
            1.0
        } else {
            0.0
        }
    }
}

fn render_dsp_accumulator(op: DspOp) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 2) >= MAX_DSP_STATE {
            return dsp_reg(op.b);
        }

        let state_index = op.state as usize;
        let trigger = dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_trigger = DSP_STATE[state_index + 1] >= ENVELOPE_TRIGGER_THRESHOLD;
        let reset = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_reset = DSP_STATE[state_index + 2] >= ENVELOPE_TRIGGER_THRESHOLD;
        let min = dsp_reg(op.b);
        let max = dsp_reg(op.c);
        let low = min.min(max);
        let high = min.max(max);
        let span = (high - low).max(0.0);
        let mut value = DSP_STATE[state_index].clamp(low, high);

        if !DSP_STATE[state_index].is_finite() || (value == 0.0 && low > 0.0) {
            value = low;
        }

        if reset && !previous_reset {
            value = low;
        } else if trigger && !previous_trigger {
            value += 1.0;
            if span <= 0.0 || value > high {
                value = low;
            }
        }

        DSP_STATE[state_index] = sanitize_control_value(value);
        DSP_STATE[state_index + 1] = if trigger { 1.0 } else { 0.0 };
        DSP_STATE[state_index + 2] = if reset { 1.0 } else { 0.0 };
        DSP_STATE[state_index]
    }
}

fn render_dsp_sequencer(op: DspOp, frame: usize) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 5) >= MAX_DSP_STATE {
            return 0.0;
        }

        let steps = (dsp_reg(op.b).round() as i32).clamp(SEQUENCER_MIN_STEPS, SEQUENCER_MAX_STEPS);
        let rows = (dsp_reg(op.d).round() as i32).clamp(SEQUENCER_MIN_ROWS, SEQUENCER_MAX_ROWS);
        let row = dsp_reg(op.c).round() as i32;

        let state_index = op.state as usize;
        let frame_token =
            DSP_RENDER_QUANTUM_ID as f64 * (MAX_WASM_FRAMES as f64 + 1.0) + frame as f64;
        if (DSP_STATE[state_index + 3] - frame_token).abs() >= 0.5 {
            let trigger = dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
            let previous_trigger = DSP_STATE[state_index + 1] >= ENVELOPE_TRIGGER_THRESHOLD;
            let pulse = trigger && !previous_trigger;
            let reset = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
            let previous_reset = DSP_STATE[state_index + 5] >= ENVELOPE_TRIGGER_THRESHOLD;
            let reset_pulse = reset && !previous_reset;
            let mut pulse_count = DSP_STATE[state_index + 4].round() as i32;
            if !DSP_STATE[state_index + 4].is_finite() || pulse_count < 0 {
                pulse_count = 0;
            }
            if reset_pulse {
                pulse_count = 0;
            }
            if pulse {
                pulse_count += 1;
            }
            let initialized = pulse_count > 0;
            let step = if initialized {
                (pulse_count - 1).rem_euclid(steps.max(1))
            } else {
                0
            };

            DSP_STATE[state_index] = step as f64;
            DSP_STATE[state_index + 1] = if trigger { 1.0 } else { 0.0 };
            DSP_STATE[state_index + 2] = if pulse { 1.0 } else { 0.0 };
            DSP_STATE[state_index + 3] = frame_token;
            DSP_STATE[state_index + 4] = pulse_count as f64;
            DSP_STATE[state_index + 5] = if reset { 1.0 } else { 0.0 };
        }

        let step = DSP_STATE[state_index].round() as i32;
        if row < 0 && DSP_STATE[state_index + 4] >= 1.0 {
            return step.max(0) as f64;
        }

        if row >= rows {
            return 0.0;
        }

        if DSP_STATE[state_index + 2] < 0.5 {
            return 0.0;
        }

        if step < 0 || step >= steps {
            return 0.0;
        }

        let lane = match step / 32 {
            0 => op.value,
            1 => op.value2,
            2 => op.value3,
            3 => op.value4,
            _ => 0.0,
        };
        let pattern = lane.round().clamp(0.0, u32::MAX as f64) as u32;
        let bit = (step % 32) as u32;
        if (pattern & (1_u32 << bit)) != 0 {
            1.0
        } else {
            0.0
        }
    }
}

fn render_dsp_button(op: DspOp) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 2) >= MAX_DSP_STATE {
            return if dsp_value_target(op.a) >= ENVELOPE_TRIGGER_THRESHOLD {
                1.0
            } else {
                0.0
            };
        }

        let state_index = op.state as usize;
        let pressed = dsp_value_target(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let mode = dsp_value_target(op.b).round() as i32;
        let clicks = dsp_value_target(op.c).round();
        let initialized = DSP_STATE[state_index + 2] >= 0.5;
        let previous_clicks = if initialized {
            DSP_STATE[state_index + 1].round()
        } else {
            clicks
        };

        let output = if mode == 1 {
            if initialized && (clicks - previous_clicks).abs() >= 0.5 {
                1.0
            } else {
                0.0
            }
        } else if pressed {
            1.0
        } else {
            0.0
        };

        DSP_STATE[state_index] = if pressed { 1.0 } else { 0.0 };
        DSP_STATE[state_index + 1] = clicks;
        DSP_STATE[state_index + 2] = 1.0;
        output
    }
}

fn render_dsp_phase_oscillator_output(
    op: DspOp,
    render_phase: f64,
    state_index: Option<usize>,
) -> f64 {
    unsafe {
        match op.a {
            6 => random_bipolar(DRONE_VOICE_SLOT),
            7 => {
                if let Some(index) = state_index {
                    if index + 2 < MAX_DSP_STATE {
                        if DSP_STATE[index + 1] == 0.0
                            && DSP_STATE[index + 2] == 0.0
                            && render_phase == 0.0
                        {
                            DSP_STATE[index + 1] = random_bipolar(DRONE_VOICE_SLOT);
                            DSP_STATE[index + 2] = random_bipolar(DRONE_VOICE_SLOT);
                        }
                        let current = DSP_STATE[index + 1];
                        let next = DSP_STATE[index + 2];
                        current + (next - current) * smooth_step(render_phase)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                }
            }
            9 => {
                let node_index = op.value.round() as i32;
                if node_index >= 0 && (node_index as usize) < MAX_NODES {
                    if let Some(index) = state_index {
                        if index + 3 < MAX_DSP_STATE && DSP_STATE[index + 3] >= 0.5 {
                            0.0
                        } else {
                            custom_wave_value(node_index as usize, render_phase)
                        }
                    } else {
                        custom_wave_value(node_index as usize, render_phase)
                    }
                } else {
                    0.0
                }
            }
            _ => dsp_oscillator(op.a, render_phase),
        }
    }
}

fn render_dsp_slew(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        let target = dsp_reg(op.a);
        if op.state < 0 || op.state as usize >= MAX_DSP_STATE {
            return target;
        }

        let state_index = op.state as usize;
        let seconds = op.value.max(0.0);
        if seconds <= 0.0 || sample_rate <= 0.0 {
            DSP_STATE[state_index] = sanitize_control_value(target);
            return target;
        }

        let mut current = DSP_STATE[state_index];
        if !current.is_finite() {
            current = 0.0;
        }

        let delta = target - current;
        let step = 1.0 / (seconds * sample_rate.max(1.0));
        current = if delta.abs() <= step {
            target
        } else {
            current + step.copysign(delta)
        };

        DSP_STATE[state_index] = sanitize_control_value(current);
        DSP_STATE[state_index]
    }
}

fn render_dsp_op(
    op: DspOp,
    frame: usize,
    sample_rate: f64,
    left_sample: &mut f64,
    right_sample: &mut f64,
) {
    let _ = op.value;
    match op.opcode {
        DSP_OP_VALUE => set_dsp_reg(op.out, dsp_value(op.a)),
        DSP_OP_ADD => set_dsp_reg(op.out, dsp_reg(op.a) + dsp_reg(op.b)),
        DSP_OP_MUL => set_dsp_reg(op.out, dsp_reg(op.a) * dsp_reg(op.b)),
        DSP_OP_SUB => set_dsp_reg(op.out, dsp_reg(op.a) - dsp_reg(op.b)),
        DSP_OP_DIV => {
            let denominator = dsp_reg(op.b);
            let output = if denominator.abs() <= 0.000001 {
                0.0
            } else {
                dsp_reg(op.a) / denominator
            };
            set_dsp_reg(op.out, output);
        }
        DSP_OP_NEG => set_dsp_reg(op.out, -dsp_reg(op.a)),
        DSP_OP_OSC => unsafe {
            let frequency = dsp_reg(op.b).max(0.0);
            let state_index = if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                Some(op.state as usize)
            } else {
                None
            };
            let mut phase = state_index.map(|index| DSP_STATE[index]).unwrap_or(0.0);
            let mut phase_reset_fade_started = false;
            if op.a != 5 && op.a != 7 {
                if let Some(index) = state_index {
                    if index + 1 < MAX_DSP_STATE && op.e >= 0 {
                        let reset_trigger = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
                        let previous_reset_trigger =
                            DSP_STATE[index + 1] >= ENVELOPE_TRIGGER_THRESHOLD;
                        if reset_trigger && !previous_reset_trigger {
                            let reset_fade_index = if op.a == 9 { index + 4 } else { index + 2 };
                            if reset_fade_index + 1 < MAX_DSP_STATE {
                                let previous_render_phase = if op.d >= 0 {
                                    phase + dsp_reg(op.d)
                                } else {
                                    phase
                                };
                                DSP_STATE[reset_fade_index] = render_dsp_phase_oscillator_output(
                                    op,
                                    previous_render_phase,
                                    state_index,
                                );
                                DSP_STATE[reset_fade_index + 1] = 0.0;
                                phase_reset_fade_started = true;
                            }
                            phase = 0.0;
                            DSP_STATE[index] = 0.0;
                            if op.a == 9 && index + 3 < MAX_DSP_STATE {
                                DSP_STATE[index + 2] = 1.0;
                                DSP_STATE[index + 3] = 0.0;
                            }
                        }
                        DSP_STATE[index + 1] = if reset_trigger { 1.0 } else { 0.0 };
                    }
                }
            }
            let render_phase = if op.a != 5 && op.a != 7 && op.d >= 0 {
                phase + dsp_reg(op.d)
            } else {
                phase
            };
            let custom_wave_is_done = op.a == 9
                && state_index
                    .map(|index| index + 3 < MAX_DSP_STATE && DSP_STATE[index + 3] >= 0.5)
                    .unwrap_or(false);
            let mut output = if custom_wave_is_done {
                0.0
            } else {
                match op.a {
                    5 => {
                        if let Some(index) = state_index {
                            if index + 2 < MAX_DSP_STATE && DSP_STATE[index + 2] == 0.0 {
                                DSP_STATE[index + 1] = dsp_sample_hold_value(op.c);
                                DSP_STATE[index + 2] = 1.0;
                            }
                            let trigger = dsp_reg(op.d) >= ENVELOPE_TRIGGER_THRESHOLD;
                            let previous_trigger = DSP_STATE[index] >= ENVELOPE_TRIGGER_THRESHOLD;
                            if trigger && !previous_trigger {
                                DSP_STATE[index + 1] = dsp_sample_hold_value(op.c);
                            }
                            DSP_STATE[index] = if trigger { 1.0 } else { 0.0 };
                            if index + 1 < MAX_DSP_STATE {
                                DSP_STATE[index + 1]
                            } else {
                                0.0
                            }
                        } else {
                            0.0
                        }
                    }
                    _ => render_dsp_phase_oscillator_output(op, render_phase, state_index),
                }
            };
            if op.a != 5 && op.a != 7 {
                if let Some(index) = state_index {
                    let reset_fade_index = if op.a == 9 { index + 4 } else { index + 2 };
                    if reset_fade_index + 1 < MAX_DSP_STATE {
                        let fade_age = DSP_STATE[reset_fade_index + 1].max(0.0);
                        if phase_reset_fade_started
                            || (fade_age > 0.0 && fade_age < PHASE_RESET_FADE_SECONDS)
                        {
                            let mix = smooth_step(fade_age / PHASE_RESET_FADE_SECONDS);
                            let previous_output = DSP_STATE[reset_fade_index];
                            output = previous_output + (output - previous_output) * mix;
                            DSP_STATE[reset_fade_index + 1] = fade_age + 1.0 / sample_rate.max(1.0);
                        }
                    }
                }
            }
            set_dsp_reg(op.out, output);
            if let Some(index) = state_index {
                let next_phase = phase + frequency / sample_rate.max(1.0);
                if op.a == 7 && next_phase >= 1.0 && index + 2 < MAX_DSP_STATE {
                    DSP_STATE[index + 1] = DSP_STATE[index + 2];
                    DSP_STATE[index + 2] = random_bipolar(DRONE_VOICE_SLOT);
                }
                if op.a == 9 && index + 3 < MAX_DSP_STATE {
                    let node_index = op.value.round() as i32;
                    if node_index >= 0 && (node_index as usize) < MAX_NODES {
                        let node = NODES[node_index as usize];
                        let start = node.custom_sustain_start.clamp(0.0, 0.999);
                        let end = node.custom_sustain_end.clamp(start + 0.001, 1.0);
                        let length = (end - start).max(0.001);
                        let mut direction = if DSP_STATE[index + 2] == 0.0 {
                            1.0
                        } else {
                            DSP_STATE[index + 2]
                        };
                        let mut custom_next = next_phase;
                        let mut done = DSP_STATE[index + 3] >= 0.5;

                        if done {
                            custom_next = phase;
                        } else {
                            match node.custom_mode {
                                CUSTOM_MODE_PING_PONG => {
                                    custom_next =
                                        phase + (frequency / sample_rate.max(1.0)) * direction;
                                    if custom_next >= 1.0 {
                                        custom_next = 1.0 - (custom_next - 1.0);
                                        direction = -1.0;
                                    } else if custom_next <= 0.0 {
                                        custom_next = -custom_next;
                                        direction = 1.0;
                                    }
                                }
                                CUSTOM_MODE_ONCE => {
                                    if custom_next >= 1.0 {
                                        custom_next = 1.0;
                                        done = true;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN => {
                                    if custom_next >= start {
                                        custom_next = start;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN_LOOP => {
                                    if custom_next >= start {
                                        custom_next = start
                                            + (((custom_next - start) % length) + length) % length;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN_PING_PONG => {
                                    custom_next =
                                        phase + (frequency / sample_rate.max(1.0)) * direction;
                                    if custom_next >= end {
                                        custom_next = end - (custom_next - end);
                                        direction = -1.0;
                                    } else if custom_next <= start && phase >= start {
                                        custom_next = start + (start - custom_next);
                                        direction = 1.0;
                                    } else if custom_next >= start && phase < start {
                                        direction = 1.0;
                                    }
                                }
                                _ => {
                                    custom_next = normalize_phase(custom_next);
                                }
                            }
                        }

                        DSP_STATE[index] = custom_next.clamp(0.0, 1.0);
                        DSP_STATE[index + 2] = direction;
                        DSP_STATE[index + 3] = if done { 1.0 } else { 0.0 };
                    } else {
                        DSP_STATE[index] = normalize_phase(next_phase);
                    }
                } else if op.a != 5 {
                    DSP_STATE[index] = normalize_phase(next_phase);
                }
            }
        },
        DSP_OP_INPUT => unsafe {
            let input = INPUT[frame.min(MAX_WASM_FRAMES - 1)] as f64;
            set_dsp_reg(op.out, input * dsp_reg(op.a));
        },
        DSP_OP_FILTER => set_dsp_reg(op.out, render_dsp_filter(op, sample_rate)),
        DSP_OP_OUTPUT => {
            let sample = sanitize_sample(dsp_reg(op.a), 8.0);
            if op.b == 0 {
                *left_sample = sanitize_sample(*left_sample + sample, 8.0);
            } else if op.b == 1 {
                *right_sample = sanitize_sample(*right_sample + sample, 8.0);
            }
        }
        DSP_OP_ABS => set_dsp_reg(op.out, dsp_reg(op.a).abs()),
        DSP_OP_MAP => {
            let source = dsp_reg(op.a);
            let src_min = dsp_reg(op.b);
            let src_max = dsp_reg(op.c);
            let target_min = dsp_reg(op.d);
            let target_max = dsp_reg(op.e);
            let denominator = (src_max - src_min)
                .abs()
                .max(0.000001)
                .copysign(src_max - src_min);
            let mapped =
                target_min + ((source - src_min) / denominator) * (target_max - target_min);
            set_dsp_reg(op.out, mapped);
        }
        DSP_OP_FEEDBACK_READ => unsafe {
            let value = if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                DSP_STATE[op.state as usize]
            } else {
                0.0
            };
            set_dsp_reg(op.out, value);
        },
        DSP_OP_FEEDBACK_WRITE => unsafe {
            if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                DSP_STATE[op.state as usize] = sanitize_sample(dsp_reg(op.a), 8.0);
            }
        },
        DSP_OP_SELECT => set_dsp_reg(op.out, render_dsp_selector(op, sample_rate)),
        DSP_OP_DELAY => set_dsp_reg(op.out, render_dsp_delay(op, sample_rate)),
        DSP_OP_CHORUS => set_dsp_reg(op.out, render_dsp_chorus(op, sample_rate)),
        DSP_OP_REVERB => set_dsp_reg(op.out, render_dsp_reverb(op, sample_rate)),
        DSP_OP_FOLD => {
            let sample = dsp_reg(op.a);
            let amount = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, fold_sample(sample, 1.0 + amount * 3.0));
        }
        DSP_OP_ENVELOPE => set_dsp_reg(op.out, render_dsp_envelope(op, sample_rate)),
        DSP_OP_FOLLOWER => set_dsp_reg(op.out, render_dsp_follower(op, sample_rate)),
        DSP_OP_HARD_CLIP => {
            let drive = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, (dsp_reg(op.a) * drive).clamp(-1.0, 1.0));
        }
        DSP_OP_SOFT_CLIP => {
            let drive = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, (dsp_reg(op.a) * drive).tanh());
        }
        DSP_OP_DISTORTION => set_dsp_reg(op.out, render_dsp_distortion(op)),
        DSP_OP_SAMPLE_PARAM => render_dsp_sample_param(op),
        DSP_OP_SAMPLE => set_dsp_reg(op.out, render_dsp_sample(op, sample_rate)),
        DSP_OP_FUNCTION => set_dsp_reg(op.out, render_dsp_function(op)),
        DSP_OP_MIDI_NOTE => set_dsp_reg(op.out, render_dsp_midi_note(op)),
        DSP_OP_MIDI_CC => set_dsp_reg(op.out, render_dsp_midi_cc(op)),
        DSP_OP_TEMPO => set_dsp_reg(op.out, render_dsp_tempo(op, frame, sample_rate)),
        DSP_OP_ACCUMULATOR => set_dsp_reg(op.out, render_dsp_accumulator(op)),
        DSP_OP_SEQUENCER => set_dsp_reg(op.out, render_dsp_sequencer(op, frame)),
        DSP_OP_BUTTON => set_dsp_reg(op.out, render_dsp_button(op)),
        DSP_OP_SLEW => set_dsp_reg(op.out, render_dsp_slew(op, sample_rate)),
        DSP_OP_PLAYHEAD => set_dsp_reg(op.out, render_dsp_playhead(op, sample_rate)),
        DSP_OP_BUFFER => set_dsp_reg(op.out, render_dsp_buffer(op, sample_rate)),
        _ => {}
    }
}

fn capture_dsp_scopes() {
    unsafe {
        for slot in 0..MAX_DSP_SCOPES {
            let register = DSP_SCOPE_REGS[slot];
            if register < 0 || register as usize >= MAX_DSP_REGS {
                continue;
            }

            DSP_SCOPE_DECIMATE_COUNTERS[slot] = DSP_SCOPE_DECIMATE_COUNTERS[slot].saturating_add(1);
            if DSP_SCOPE_DECIMATE_COUNTERS[slot] < DSP_SCOPE_DECIMATE[slot] {
                continue;
            }
            DSP_SCOPE_DECIMATE_COUNTERS[slot] = 0;

            let active_points = DSP_SCOPE_POINTS_ACTIVE[slot].clamp(32, LINK_SCOPE_POINTS);
            let write_index = (DSP_SCOPE_WRITE_INDICES[slot] as usize).min(active_points - 1);
            DSP_SCOPE_SAMPLES[slot][write_index] =
                sanitize_control_value(DSP_REGS[register as usize]) as f32;
            DSP_SCOPE_WRITE_INDICES[slot] = ((write_index + 1) % active_points) as u32;
            if (DSP_SCOPE_COUNTS[slot] as usize) < active_points {
                DSP_SCOPE_COUNTS[slot] = DSP_SCOPE_COUNTS[slot].saturating_add(1);
            }
        }
    }
}

fn capture_dsp_meters() {
    unsafe {
        for slot in 0..MAX_DSP_METERS {
            let register = DSP_METER_REGS[slot];
            if register < 0 || register as usize >= MAX_DSP_REGS {
                continue;
            }
            DSP_METER_SUMS[slot] += dsp_reg(register).abs();
            DSP_METER_COUNTS[slot] = DSP_METER_COUNTS[slot].saturating_add(1);
        }
    }
}

#[no_mangle]
pub extern "C" fn renderDspProgram(frames: u32, sample_rate: f64) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }

    unsafe {
        for frame in 0..frames {
            let mut left_sample = 0.0;
            let mut right_sample = 0.0;
            advance_dsp_values(sample_rate);
            for op_index in 0..DSP_OP_COUNT {
                render_dsp_op(
                    DSP_OPS[op_index],
                    frame,
                    sample_rate,
                    &mut left_sample,
                    &mut right_sample,
                );
            }
            capture_dsp_meters();
            capture_dsp_scopes();
            LEFT[frame] += left_sample as f32;
            RIGHT[frame] += right_sample as f32;
        }
    }
}

#[no_mangle]
pub extern "C" fn renderDspProgramVoice(
    slot: u32,
    frames: u32,
    sample_rate: f64,
    channel: f64,
    note: f64,
    note_frequency: f64,
    velocity: f64,
    lifecycle_gain: f64,
    voice_age: f64,
    release_age: f64,
    stolen_age: f64,
) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }

    let voice_slot = (slot as usize).min(MAX_VOICE_SLOTS - 1);
    let base_amp = velocity.clamp(0.0, 1.0) * lifecycle_gain.clamp(0.0, 1.0);

    unsafe {
        for index in 0..MAX_DSP_STATE {
            DSP_STATE[index] = DSP_VOICE_STATES[voice_slot][index];
        }

        for frame in 0..frames {
            let mut left_sample = 0.0;
            let mut right_sample = 0.0;
            let sample_offset = frame as f64 / sample_rate;
            let age = voice_age + sample_offset;
            let sample_release_age = if release_age < 0.0 {
                -1.0
            } else {
                release_age + sample_offset
            };
            let sample_stolen_age = if stolen_age < 0.0 {
                -1.0
            } else {
                stolen_age + sample_offset
            };
            let steal_gain = if sample_stolen_age < 0.0 {
                1.0
            } else {
                1.0 - smooth_step(sample_stolen_age / VOICE_STEAL_FADE_SECONDS)
            };
            let amp = base_amp * smooth_step(age / VOICE_START_FADE_SECONDS) * steal_gain;

            DSP_CURRENT_CHANNEL = channel.round().clamp(1.0, 16.0);
            DSP_CURRENT_NOTE = note.clamp(0.0, 127.0);
            DSP_CURRENT_FREQUENCY = note_frequency.max(0.0);
            DSP_CURRENT_VELOCITY = velocity.clamp(0.0, 1.0);
            DSP_CURRENT_GATE = if sample_release_age < 0.0 && sample_stolen_age < 0.0 {
                1.0
            } else {
                0.0
            };
            DSP_CURRENT_TRIGGER = if sample_release_age < 0.0
                && sample_stolen_age < 0.0
                && age <= 1.0 / sample_rate
            {
                1.0
            } else {
                0.0
            };

            advance_dsp_values(sample_rate);
            for op_index in 0..DSP_OP_COUNT {
                render_dsp_op(
                    DSP_OPS[op_index],
                    frame,
                    sample_rate,
                    &mut left_sample,
                    &mut right_sample,
                );
            }
            capture_dsp_meters();
            capture_dsp_scopes();
            LEFT[frame] += (left_sample * amp) as f32;
            RIGHT[frame] += (right_sample * amp) as f32;
        }

        for index in 0..MAX_DSP_STATE {
            DSP_VOICE_STATES[voice_slot][index] = DSP_STATE[index];
        }
    }
}

#[no_mangle]
pub extern "C" fn renderVoiceGraph(
    slot: u32,
    frames: u32,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    lifecycle_gain: f64,
    voice_age: f64,
    release_age: f64,
    stolen_age: f64,
) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }

    let voice_slot = (slot as usize).min(MAX_VOICE_SLOTS - 1);
    let left = core::ptr::addr_of_mut!(LEFT).cast::<f32>();
    let right = core::ptr::addr_of_mut!(RIGHT).cast::<f32>();
    let base_amp = velocity.clamp(0.0, 1.0) * lifecycle_gain.clamp(0.0, 1.0);

    for frame in 0..frames {
        let stamp = next_stamp();
        let mut left_sample = 0.0;
        let mut right_sample = 0.0;
        let sample_offset = frame as f64 / sample_rate;
        let age = voice_age + sample_offset;
        let sample_release_age = if release_age < 0.0 {
            -1.0
        } else {
            release_age + sample_offset
        };
        let sample_stolen_age = if stolen_age < 0.0 {
            -1.0
        } else {
            stolen_age + sample_offset
        };
        let steal_gain = if sample_stolen_age < 0.0 {
            1.0
        } else {
            1.0 - smooth_step(sample_stolen_age / VOICE_STEAL_FADE_SECONDS)
        };
        let amp = base_amp * smooth_step(age / VOICE_START_FADE_SECONDS) * steal_gain;

        unsafe {
            for link_index in 0..LINK_COUNT {
                let link = LINKS[link_index];
                if link.to != AUDIO_TARGET || link.from < 0 {
                    continue;
                }
                let source = render_node(
                    link.from as usize,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    sample_release_age,
                    frame,
                    stamp,
                );
                let modulation = render_link_signal(
                    link_index,
                    source,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    sample_release_age,
                    frame,
                    stamp,
                    false,
                );
                let signal = modulation.value * amp;
                let (left_gain, right_gain) = pan_gains(modulation.pan);
                left_sample = sanitize_sample(left_sample + signal * left_gain, 8.0);
                right_sample = sanitize_sample(right_sample + signal * right_gain, 8.0);
            }

            *left.add(frame) += left_sample as f32;
            *right.add(frame) += right_sample as f32;
        }

        advance_phases(voice_slot, sample_rate, note_frequency, sample_release_age);
    }
}
