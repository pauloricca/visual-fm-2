const MAX_WASM_FRAMES = 2048;
const TWO_PI = Math.PI * 2;
const LEFT_OFFSET = 0;
const RIGHT_OFFSET = 8192;
const MAX_ACTIVE_VOICES = 16;
const DEFAULT_TEMPO = 120;
const TEMPO_MIN = 20;
const TEMPO_MAX = 300;
const DEFAULT_SYNC_BEATS = 1;
const DRONE_SLOT = MAX_ACTIVE_VOICES;
const AUDIO_TARGET = -1;
const LINK_TARGET_BASE = -2;
const MASTER_GAIN = 0.18;
const VOICE_START_FADE_SECONDS = 0.006;
const VOICE_STEAL_FADE_SECONDS = 0.03;
const LINK_CONTROL_SMOOTH_SECONDS = 0.012;
const LINK_CONTROL_SETTLE_EPSILON = 1e-7;
const LINK_METER_POST_SECONDS = 1 / 30;
const LINK_SCOPE_SECONDS_MAX = 30;
const MASTER_DC_BLOCK_HZ = 10;
const DENORMAL_EPSILON = 1e-20;
const FORMANT_INTENSITY_MAX = 36;
const MAX_CUSTOM_WAVE_POINTS = 64;
const QUANTISE_MIDI_ROOT = "midi-note";

const WAVE_IDS = new Map([
  ["sine", 0],
  ["triangle", 1],
  ["saw", 2],
  ["ramp", 3],
  ["square", 4],
  ["sample-hold", 5],
  ["noise", 6],
  ["perlin", 7],
  ["audio-input", 8],
  ["custom", 9],
  ["sample", 10],
  ["constant", 11],
]);

const MODULATION_TARGET_IDS = new Map([
  ["phase", 0],
  ["frequency", 1],
  ["wave", 5],
  ["phaseResetTrigger", 6],
  ["ring", 2],
  ["fold", 3],
  ["mix", 4],
  ["amplitude", 10],
  ["pan", 11],
  ["noise", 12],
  ["delay", 13],
  ["envelopeTrigger", 14],
  ["envelope.delay", 15],
  ["envelope.attack", 16],
  ["envelope.decay", 17],
  ["envelope.sustain", 18],
  ["envelope.release", 19],
  ["filterCutoff", 20],
  ["filterResonance", 21],
  ["distortionGain", 22],
  ["sampleTrigger", 23],
  ["sampleStart", 24],
  ["sampleEnd", 25],
  ["sampleStretch", 26],
  ["mapSrcMin", 27],
  ["mapSrcMax", 28],
  ["mapTargetMin", 29],
  ["mapTargetMax", 30],
]);

const SIGNAL_MODE_IDS = new Map([
  ["raw", 0],
  ["envelope", 1],
  ["inverted-envelope", 2],
  ["abs", 3],
  ["map", 4],
  ["abs-map", 5],
  ["map-abs", 6],
]);

const PARAMETER_MODE_IDS = new Map([
  ["set", 0],
  ["add", 1],
  ["multiply", 2],
]);

const FILTER_TYPE_IDS = new Map([
  ["none", 0],
  ["lowpass", 1],
  ["highpass", 2],
  ["bandpass", 3],
  ["formant", 4],
  ["comb", 5],
  ["comb-notch", 6],
]);
const DISTORTION_TYPE_IDS = new Map([
  ["hard-clip", 1],
  ["soft-clip", 2],
  ["fuzz", 3],
  ["saturate", 4],
  ["wavefold", 5],
]);
const CUSTOM_WAVE_MODE_IDS = new Map([
  ["loop", 0],
  ["once", 1],
  ["ping-pong", 2],
  ["sustain", 3],
  ["sustain-loop", 4],
  ["sustain-ping-pong", 5],
]);
const SAMPLE_MODE_IDS = new Map([
  ["one-shot", 0],
  ["loop", 1],
  ["ping-pong", 2],
]);
const DEFAULT_CUSTOM_WAVE = Object.freeze({
  mode: "loop",
  sustainStart: 0.5,
  sustainEnd: 0.75,
  points: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 1, y: 0 }),
  ]),
});
const QUANTISE_ROOT_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const QUANTISE_SCALE_IDS = new Map([
  ["chromatic", 0],
  ["major", 1],
  ["minor", 2],
  ["major-pentatonic", 3],
  ["minor-pentatonic", 4],
  ["blues", 5],
  ["dorian", 6],
  ["mixolydian", 7],
  ["harmonic-minor", 8],
]);

class VisualFmWasmEngine extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.nodes = [];
    this.nodesById = new Map();
    this.links = [];
    this.linksById = new Map();
    this.dspProgram = null;
    this.sampleDataByNodeId = new Map();
    this.linkControlSmoothers = new Map();
    this.activeLinkControlSmoothers = new Set();
    this.hasActiveDroneLinks = false;
    this.maxVoices = 5;
    this.tempo = DEFAULT_TEMPO;
    this.voices = new Map();
    this.activeVoicesByNote = new Map();
    this.pendingVoiceStarts = [];
    this.voiceCounter = 1;
    this.freeSlots = Array.from({ length: MAX_ACTIVE_VOICES }, (_, index) => index);
    this.sampleCursor = 0;
    this.nextLinkMeterPostSample = 0;
    this.lastOutputPeak = 0;
    this.lastProcessFrames = 128;
    this.ready = false;
    this.muted = false;
    this.zeroVoicePhasesOnStart = false;
    this.wasmBytes = null;
    this.wasm = null;
    this.leftBuffer = null;
    this.rightBuffer = null;
    this.inputBuffer = null;
    this.linkMeterInputSums = null;
    this.linkMeterOutputSums = null;
    this.linkMeterEnvelopeSums = null;
    this.linkMeterCounts = null;
    this.linkScopeRequest = null;
    this.linkScopeRequests = [];
    this.linkScopeRequestIndex = 0;
    this.monitorScopeStates = new Map();
    this.dspScopeStates = new Map();
    this.dspMeterStates = new Map();
    this.graphVersion = 0;
    this.linkScopeSamples = null;
    this.masterEffects = this.normalizeEffects();
    this.chorusBuffers = [
      new Float32Array(Math.ceil(sampleRate * 0.08)),
      new Float32Array(Math.ceil(sampleRate * 0.08)),
    ];
    this.chorusIndices = [0, 0];
    this.chorusPhases = [0, Math.PI * 0.5];
    this.delayBuffers = [
      new Float32Array(Math.ceil(sampleRate * 1.6)),
      new Float32Array(Math.ceil(sampleRate * 1.6)),
    ];
    this.delayIndices = [0, 0];
    this.reverbDelays = [this.createReverbDelays(), this.createReverbDelays()];
    this.inputDcBlockers = [this.createDcBlocker(), this.createDcBlocker()];
    this.outputDcBlockers = [this.createDcBlocker(), this.createDcBlocker()];

    this.port.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === "graph") {
        this.setGraph(payload);
      } else if (type === "dspProgram") {
        this.setDspProgram(payload);
      } else if (type === "dspValues") {
        this.setDspValues(payload);
      } else if (type === "sampleData") {
        this.setSampleData(payload);
      } else if (type === "nodeParam") {
        this.setNodeParam(payload);
      } else if (type === "linkParam") {
        this.setLinkParam(payload);
      } else if (type === "noteOn") {
        if (!this.muted) this.noteOn(payload.note, payload.velocity);
      } else if (type === "noteOff") {
        this.noteOff(payload.note);
      } else if (type === "panic") {
        this.resetRuntimeState();
      } else if (type === "setMuted") {
        this.setMuted(Boolean(payload?.muted));
      } else if (type === "setLinkScope") {
        this.setLinkScopes(payload);
      } else if (type === "setLinkScopes") {
        this.setLinkScopes(payload);
      }
    };

    this.loadWasm(options.processorOptions || {});
  }

  async loadWasm({ wasmBytes, wasmUrl } = {}) {
    try {
      let bytes = wasmBytes;
      if (!bytes) {
        if (!wasmUrl || typeof fetch !== "function") {
          throw new Error("Missing WASM kernel bytes.");
        }
        const response = await fetch(wasmUrl);
        if (!response.ok) {
          throw new Error(`Could not fetch WASM kernel (${response.status}).`);
        }
        bytes = await response.arrayBuffer();
      }
      const { instance } = await WebAssembly.instantiate(bytes, {});
      this.wasmBytes = bytes;
      this.wasm = instance.exports;
      const leftOffset = typeof this.wasm.leftPtr === "function" ? this.wasm.leftPtr() : LEFT_OFFSET;
      const rightOffset = typeof this.wasm.rightPtr === "function" ? this.wasm.rightPtr() : RIGHT_OFFSET;
      this.leftBuffer = new Float32Array(this.wasm.memory.buffer, leftOffset, MAX_WASM_FRAMES);
      this.rightBuffer = new Float32Array(this.wasm.memory.buffer, rightOffset, MAX_WASM_FRAMES);
      if (typeof this.wasm.inputPtr === "function") {
        this.inputBuffer = new Float32Array(this.wasm.memory.buffer, this.wasm.inputPtr(), MAX_WASM_FRAMES);
      }
      if (
        typeof this.wasm.linkMeterInputPtr === "function"
        && typeof this.wasm.linkMeterOutputPtr === "function"
        && typeof this.wasm.linkMeterEnvelopePtr === "function"
        && typeof this.wasm.linkMeterCountPtr === "function"
      ) {
        this.linkMeterInputSums = new Float64Array(this.wasm.memory.buffer, this.wasm.linkMeterInputPtr(), 1024);
        this.linkMeterOutputSums = new Float64Array(this.wasm.memory.buffer, this.wasm.linkMeterOutputPtr(), 1024);
        this.linkMeterEnvelopeSums = new Float64Array(this.wasm.memory.buffer, this.wasm.linkMeterEnvelopePtr(), 1024);
        this.linkMeterCounts = new Uint32Array(this.wasm.memory.buffer, this.wasm.linkMeterCountPtr(), 1024);
      }
      if (typeof this.wasm.linkScopePtr === "function") {
        this.linkScopeSamples = new Float32Array(this.wasm.memory.buffer, this.wasm.linkScopePtr(), 512);
      }
      this.wasm.resetPhases();
      this.ready = true;
      this.syncRustGraph();
      this.syncDspProgram();
      this.configureDspScopes();
      this.configureDspMeters();
      for (const link of this.links) {
        link.controlSmoother = this.syncLinkControlSmoother(link, true);
        this.applyLinkControlSmoother(link);
      }
      this.port.postMessage({ type: "backendStatus", payload: { backend: "wasm", ready: true } });
    } catch (error) {
      this.port.postMessage({
        type: "backendStatus",
        payload: { backend: "wasm", ready: false, error: error?.message || "WASM failed to load." },
      });
    }
  }

  setGraph(graph = {}) {
    this.dspProgram = null;
    this.wasm?.clearDspProgram?.();
    this.wasm?.clearDspScopes?.();
    this.wasm?.clearDspMeters?.();
    this.nodes = (graph.nodes || []).map((node) => this.normalizeNode(node));
    this.nodesById = new Map(this.nodes.map((node) => [node.id, node]));
    this.links = (graph.links || []).map((link) => this.normalizeLink(link));
    this.linksById = new Map(this.links.map((link) => [link.id, link]));
    const linkIds = new Set(this.links.map((link) => link.id));
    for (const id of this.linkControlSmoothers.keys()) {
      if (!linkIds.has(id)) {
        this.linkControlSmoothers.delete(id);
        this.activeLinkControlSmoothers.delete(id);
      }
    }
    this.maxVoices = this.clamp(Math.round(Number(graph.maxVoices) || 5), 1, MAX_ACTIVE_VOICES);
    this.tempo = this.normalizeTempo(graph.tempo);
    this.masterEffects = this.normalizeEffects(graph.masterEffects);
    this.hasActiveDroneLinks = this.links.some((link) => link.drone && !link.monitorOnly);
    this.graphVersion += 1;
    this.dspScopeStates.clear();
    this.dspMeterStates.clear();
    this.monitorScopeStates.clear();
    this.syncRustGraph();
    for (const link of this.links) {
      link.controlSmoother = this.syncLinkControlSmoother(link, true);
      this.applyLinkControlSmoother(link);
    }
    if (this.linkScopeRequests.length > 0) this.setLinkScopes({ ...this.linkScopeRequests[0], linkIds: this.linkScopeRequests.map((request) => request.linkId) });
    this.enforceVoiceLimit();
  }

  setDspProgram(program = {}) {
    const preservedState = this.captureDspState(this.dspProgram);
    this.dspProgram = this.normalizeDspProgram(program);
    this.nodes = [];
    this.nodesById = new Map();
    this.links = [];
    this.linksById = new Map();
    this.hasActiveDroneLinks = false;
    this.linkControlSmoothers.clear();
    this.activeLinkControlSmoothers.clear();
    this.monitorScopeStates.clear();
    this.syncDspProgram(preservedState);
    this.configureDspScopes();
    this.configureDspMeters();
  }

  setDspValues(payload = {}) {
    if (!this.dspProgram || !this.wasm?.setDspValue) return;
    const values = Array.isArray(payload.values)
      ? payload.values.map(Number).map((value) => Number.isFinite(value) ? value : 0)
      : [];
    if (values.length !== this.dspProgram.values.length) return;

    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === this.dspProgram.values[index]) continue;
      this.dspProgram.values[index] = values[index];
      this.wasm.setDspValue(index, values[index]);
    }
  }

  normalizeDspProgram(program = {}) {
    const ops = Array.isArray(program.ops)
      ? program.ops.map((op) => ({
        opcode: Math.trunc(Number(op.opcode)),
        out: Math.trunc(Number(op.out ?? -1)),
        a: Math.trunc(Number(op.a ?? -1)),
        b: Math.trunc(Number(op.b ?? -1)),
        c: Math.trunc(Number(op.c ?? -1)),
        d: Math.trunc(Number(op.d ?? -1)),
        e: Math.trunc(Number(op.e ?? -1)),
        state: Math.trunc(Number(op.state ?? -1)),
        value: Number(op.value ?? 0),
      })).filter((op) => Number.isFinite(op.opcode))
      : [];
    const values = Array.isArray(program.values)
      ? program.values.map(Number).map((value) => Number.isFinite(value) ? value : 0)
      : [];
    const errors = Array.isArray(program.errors)
      ? program.errors.map(String).filter(Boolean)
      : [];
    const stateBindings = Array.isArray(program.stateBindings)
      ? program.stateBindings.map((binding) => ({
        id: String(binding?.id || ""),
        state: Math.trunc(Number(binding?.state ?? -1)),
        count: Math.max(0, Math.trunc(Number(binding?.count ?? 0))),
        kind: ["filter", "feedback", "selector", "effect"].includes(binding?.kind) ? binding.kind : "oscillator",
        nodeId: String(binding?.nodeId || ""),
      })).filter((binding) => binding.id && binding.state >= 0 && binding.count > 0)
      : [];
    const monitorIds = {};
    if (program.monitorIds && typeof program.monitorIds === "object") {
      for (const [id, register] of Object.entries(program.monitorIds)) {
        const registerNumber = Math.trunc(Number(register));
        if (id && Number.isFinite(registerNumber)) monitorIds[String(id)] = registerNumber;
      }
    }

    return {
      version: 1,
      ops,
      values,
      stateBindings,
      registerCount: Math.max(0, Math.trunc(Number(program.registerCount) || 0)),
      stateCount: Math.max(0, Math.trunc(Number(program.stateCount) || 0)),
      monitorIds,
      feedbackLinkIds: Array.isArray(program.feedbackLinkIds) ? program.feedbackLinkIds.map(String) : [],
      errors,
    };
  }

  captureDspState(program) {
    if (!program || !this.wasm?.getDspState) return new Map();

    const states = new Map();
    for (const binding of program.stateBindings || []) {
      const values = [];
      for (let offset = 0; offset < binding.count; offset += 1) {
        values.push(Number(this.wasm.getDspState(binding.state + offset)) || 0);
      }
      states.set(binding.id, values);
    }
    return states;
  }

  restoreDspState(preservedState) {
    if (!preservedState || !this.dspProgram || !this.wasm?.setDspState) return;

    for (const binding of this.dspProgram.stateBindings || []) {
      const values = preservedState.get(binding.id);
      if (!values) continue;
      const count = Math.min(binding.count, values.length);
      for (let offset = 0; offset < count; offset += 1) {
        this.wasm.setDspState(binding.state + offset, values[offset]);
      }
    }
  }

  syncDspProgram(preservedState = null) {
    if (!this.wasm?.clearDspProgram || !this.dspProgram) return;

    this.wasm.clearDspProgram();
    if (this.dspProgram.errors.length > 0) return;

    for (let index = 0; index < this.dspProgram.values.length; index += 1) {
      this.wasm.setDspValue?.(index, this.dspProgram.values[index]);
    }
    for (const op of this.dspProgram.ops) {
      this.wasm.addDspOp?.(
        op.opcode,
        op.out,
        op.a,
        op.b,
        op.c,
        op.d,
        op.e,
        op.state,
        op.value,
      );
    }
    this.restoreDspState(preservedState);
  }

  configureDspScopes() {
    this.dspScopeStates.clear();
    this.wasm?.clearDspScopes?.();
    if (!this.dspProgram || !this.wasm?.setDspScope || !this.wasm?.dspScopePtr) return;

    let slot = 0;
    for (const request of this.linkScopeRequests) {
      if (slot >= 32) break;
      const register = Math.trunc(Number(this.dspProgram.monitorIds?.[request.linkId]));
      if (!Number.isFinite(register) || register < 0) continue;
      const scopeSlot = this.wasm.setDspScope(slot, register, request.seconds, request.points, sampleRate);
      if (scopeSlot < 0) continue;
      const ptr = this.wasm.dspScopePtr(slot);
      if (!ptr) continue;
      this.dspScopeStates.set(request.linkId, {
        request,
        slot,
        samples: new Float32Array(this.wasm.memory.buffer, ptr, 512),
      });
      slot += 1;
    }
  }

  configureDspMeters() {
    this.dspMeterStates.clear();
    this.wasm?.clearDspMeters?.();
    if (!this.dspProgram || !this.wasm?.setDspMeter) return;

    let slot = 0;
    for (const [id, registerValue] of Object.entries(this.dspProgram.monitorIds || {})) {
      if (slot >= 128) break;
      const register = Math.trunc(Number(registerValue));
      if (!Number.isFinite(register) || register < 0) continue;
      const meterSlot = this.wasm.setDspMeter(slot, register);
      if (meterSlot < 0) continue;
      this.dspMeterStates.set(String(id), { id: String(id), slot });
      slot += 1;
    }
  }

  normalizeNode(node = {}) {
    const ratio = Number(node.ratio);
    const frequency = Number(node.frequency);
    const speed = Number(node.speed);
    const audioInputGain = Number(node.audioInputGain);
    const quantiseGlide = Number(node.quantise?.glide);
    return {
      id: node.id,
      wave: WAVE_IDS.has(node.wave) ? node.wave : "sine",
      frequencyMode: ["ratio", "fixed", "sync"].includes(node.frequencyMode) ? node.frequencyMode : "ratio",
      ratio: Number.isFinite(ratio) ? ratio : 1,
      frequency: Number.isFinite(frequency)
        ? frequency
        : node.wave === "constant" ? 1 : 440,
      baseFrequency: Number.isFinite(frequency)
        ? frequency
        : node.wave === "constant" ? 1 : 440,
      syncBeats: this.normalizeSyncBeats(node.syncBeats),
      quantise: {
        enabled: Boolean(node.quantise?.enabled),
        root: node.quantise?.root === QUANTISE_MIDI_ROOT || QUANTISE_ROOT_NOTES.includes(node.quantise?.root) ? node.quantise.root : "C",
        scale: QUANTISE_SCALE_IDS.has(node.quantise?.scale) ? node.quantise.scale : "chromatic",
        glide: Number.isFinite(quantiseGlide) ? this.clamp(quantiseGlide, 0, 4) : 0,
      },
      speed: Number.isFinite(speed) ? speed : 8,
      audioInputGain: Number.isFinite(audioInputGain) ? audioInputGain : 1,
      customWave: this.normalizeCustomWave(node.customWave),
      sample: this.normalizeSample(node.sample),
    };
  }

  normalizeSample(sample = {}) {
    const start = Number(sample.start);
    const end = Number(sample.end);
    const stretch = Number(sample.stretch);
    const cycleLength = Number(sample.cycleLength);
    const overlapRatio = Number(sample.overlapRatio);
    const originalPitch = Number(sample.originalPitch);
    return {
      name: sample.name || "",
      sampleRate: Number.isFinite(Number(sample.sampleRate)) ? Math.max(1, Number(sample.sampleRate)) : sampleRate,
      mode: SAMPLE_MODE_IDS.has(sample.mode) ? sample.mode : "one-shot",
      start: Number.isFinite(start) ? this.clamp(start, 0, 1) : 0,
      end: Number.isFinite(end) ? this.clamp(end, 0, 1) : 1,
      stretch: Number.isFinite(stretch) ? Math.max(0.001, stretch) : 1,
      cycleLength: Number.isFinite(cycleLength) ? Math.max(1, Math.round(cycleLength)) : 4096,
      overlapRatio: Number.isFinite(overlapRatio) ? this.clamp(overlapRatio, 0, 1) : 0.09,
      originalPitch: Number.isFinite(originalPitch) ? originalPitch : 60,
    };
  }

  normalizeTempo(tempo) {
    const value = Number(tempo);
    return Number.isFinite(value) ? this.clamp(value, TEMPO_MIN, TEMPO_MAX) : DEFAULT_TEMPO;
  }

  normalizeSyncBeats(syncBeats) {
    const value = Number(syncBeats);
    return Number.isFinite(value) && value > 0 ? this.clamp(value, 1 / 64, 64) : DEFAULT_SYNC_BEATS;
  }

  normalizeCustomWave(customWave = {}) {
    const customWaveModes = new Set(["loop", "once", "ping-pong", "sustain", "sustain-loop", "sustain-ping-pong"]);
    const sourceMode = customWave.mode || customWave.playback;
    const mode = customWaveModes.has(sourceMode) ? sourceMode : DEFAULT_CUSTOM_WAVE.mode;
    const sustainStart = Number.isFinite(Number(customWave.sustainStart))
      ? this.clamp(Number(customWave.sustainStart), 0, 0.999)
      : DEFAULT_CUSTOM_WAVE.sustainStart;
    const sustainEnd = Number.isFinite(Number(customWave.sustainEnd))
      ? this.clamp(Number(customWave.sustainEnd), sustainStart + 0.001, 1)
      : Math.max(sustainStart + 0.001, DEFAULT_CUSTOM_WAVE.sustainEnd);
    const sourcePoints = Array.isArray(customWave.points) ? customWave.points : DEFAULT_CUSTOM_WAVE.points;
    const pointsByX = new Map();
    for (const point of sourcePoints) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pointsByX.set(this.clamp(x, 0, 1), this.clamp(y, -1, 1));
    }
    pointsByX.set(0, 0);
    pointsByX.set(1, 0);
    const points = [...pointsByX.entries()]
      .map(([x, y]) => ({ x, y }))
      .sort((a, b) => a.x - b.x);
    const cappedPoints = points.length > MAX_CUSTOM_WAVE_POINTS
      ? [...points.slice(0, MAX_CUSTOM_WAVE_POINTS - 1), points[points.length - 1]]
      : points;
    return {
      mode,
      sustainStart,
      sustainEnd,
      points: cappedPoints,
    };
  }

  normalizeLink(link = {}) {
    const amount = Number(link.amount);
    const delay = Number(link.delay);
    const noise = Number(link.noise);
    const pan = Number(link.pan);
    const velocitySensitivity = Number(link.velocitySensitivity);
    const envelopeDelay = Number(link.envelope?.delay);
    const attack = Number(link.envelope?.attack);
    const decay = Number(link.envelope?.decay);
    const sustain = Number(link.envelope?.sustain);
    const release = Number(link.envelope?.release);
    const followerAttack = Number(link.follower?.attack);
    const followerRelease = Number(link.follower?.release);
    const mapSrcMin = Number(link.map?.srcMin);
    const mapSrcMax = Number(link.map?.srcMax);
    const mapTargetMin = Number(link.map?.trgtMin);
    const mapTargetMax = Number(link.map?.trgtMax);
    const filterCutoff = Number(link.filter?.cutoff);
    const filterResonance = Number(link.filter?.resonance);
    const isComb = link.filter?.type === "comb" || link.filter?.type === "comb-notch";
    const distortionGain = Number(link.distortion?.gain);
    return {
      id: link.id,
      from: link.from,
      to: link.to,
      amount: this.normalizeLinkAmount(link, amount),
      delay: Number.isFinite(delay) ? Math.max(0, delay) : 0,
      noise: Number.isFinite(noise) ? this.clamp(noise, 0, 1) : 0,
      pan: Number.isFinite(pan) ? this.clamp(pan, -1, 1) : 0,
      velocitySensitivity: Number.isFinite(velocitySensitivity) ? this.clamp(velocitySensitivity, -8, 8) : 0,
      modulationTarget: link.modulationTarget || "phase",
      parameterMode: ["set", "add", "multiply"].includes(link.parameterMode) ? link.parameterMode : "set",
      internalTarget: Boolean(link.internalTarget),
      monitorOnly: Boolean(link.monitorOnly),
      drone: Boolean(link.drone),
      signalMode: SIGNAL_MODE_IDS.has(link.signalMode) ? link.signalMode : "raw",
      follower: {
        attack: Number.isFinite(followerAttack) ? Math.max(0, followerAttack) : 0.01,
        release: Number.isFinite(followerRelease) ? Math.max(0, followerRelease) : 0.12,
      },
      map: {
        srcMin: Number.isFinite(mapSrcMin) ? mapSrcMin : 0,
        srcMax: Number.isFinite(mapSrcMax) ? mapSrcMax : 1,
        trgtMin: Number.isFinite(mapTargetMin) ? mapTargetMin : 0,
        trgtMax: Number.isFinite(mapTargetMax) ? mapTargetMax : 1,
      },
      filter: {
        type: FILTER_TYPE_IDS.has(link.filter?.type) ? link.filter.type : "none",
        cutoff: link.filter?.type === "formant"
          ? this.clamp(Number.isFinite(filterCutoff) ? filterCutoff : 0, 0, 1)
          : Number.isFinite(filterCutoff) ? Math.max(0, filterCutoff) : isComb ? 440 : 5000,
        resonance: Number.isFinite(filterResonance)
          ? isComb ? this.clamp(filterResonance, -0.999, 0.999) : Math.max(0, filterResonance)
          : isComb ? 0.45 : 0.7,
      },
      distortion: {
        enabled: Boolean(link.distortion?.enabled),
        type: DISTORTION_TYPE_IDS.has(link.distortion?.type) ? link.distortion.type : "soft-clip",
        gain: Number.isFinite(distortionGain) ? Math.max(0, distortionGain) : 1.5,
      },
      envelope: {
        delay: Number.isFinite(envelopeDelay) ? Math.max(0, envelopeDelay) : 0,
        attack: Number.isFinite(attack) ? Math.max(0, attack) : 0.01,
        decay: Number.isFinite(decay) ? Math.max(0, decay) : 0.16,
        sustain: Number.isFinite(sustain) ? sustain : 0.72,
        release: Number.isFinite(release) ? Math.max(0, release) : 0.24,
      },
    };
  }

  normalizeLinkAmount(link, amount) {
    if (!Number.isFinite(amount)) return 0;
    return amount;
  }

  syncRustGraph() {
    if (!this.wasm?.clearGraph) return;

    this.wasm.clearGraph();
    this.wasm.clearLinkMeters?.();
    this.wasm.setTempo?.(this.tempo);
    for (const node of this.nodes) {
      node.wasmIndex = this.wasm.addNode(
        this.waveId(node),
        this.frequencyModeId(node),
        node.ratio,
        node.frequency,
        node.syncBeats,
        node.quantise.enabled ? 1 : 0,
        node.quantise.root === QUANTISE_MIDI_ROOT ? -1 : QUANTISE_ROOT_NOTES.indexOf(node.quantise.root),
        QUANTISE_SCALE_IDS.get(node.quantise.scale) ?? 0,
        node.quantise.glide,
        node.speed,
        node.audioInputGain,
        CUSTOM_WAVE_MODE_IDS.get(node.customWave?.mode) ?? 0,
        node.customWave?.sustainStart ?? 0.5,
        node.customWave?.sustainEnd ?? 0.75,
        SAMPLE_MODE_IDS.get(node.sample?.mode) ?? 0,
        node.sample?.start ?? 0,
        node.sample?.end ?? 1,
        node.sample?.stretch ?? 1,
        node.sample?.cycleLength ?? 4096,
        node.sample?.overlapRatio ?? 0.09,
        node.sample?.originalPitch ?? 60,
      );
      if (node.wasmIndex >= 0 && node.wave === "custom" && typeof this.wasm.addCustomWavePoint === "function") {
        for (const point of node.customWave.points) {
          this.wasm.addCustomWavePoint(node.wasmIndex, point.x, point.y);
        }
      }
      this.copySampleDataToWasm(node);
    }

    for (const link of this.links) {
      link.wasmIndex = -1;
    }

    for (const link of this.links) {
      if (link.monitorOnly || link.internalTarget) {
        link.wasmIndex = -1;
        continue;
      }
      const from = this.nodesById.get(link.from)?.wasmIndex ?? -1;
      let to = AUDIO_TARGET;
      let hasValidTarget = false;
      if (link.to === "audio") {
        to = AUDIO_TARGET;
        hasValidTarget = true;
      } else if (this.nodesById.has(link.to)) {
        to = this.nodesById.get(link.to).wasmIndex;
        hasValidTarget = to >= 0;
      }
      link.wasmIndex = from >= 0 && hasValidTarget
        ? this.wasm.addLink(
          from,
          to,
          link.amount,
          link.delay || 0,
          link.noise || 0,
          link.pan || 0,
          MODULATION_TARGET_IDS.get(link.modulationTarget) ?? 0,
          PARAMETER_MODE_IDS.get(link.parameterMode) ?? 0,
          link.velocitySensitivity || 0,
          link.drone ? 1 : 0,
          SIGNAL_MODE_IDS.get(link.signalMode) ?? 0,
          link.follower?.attack || 0.01,
          link.follower?.release || 0.12,
          FILTER_TYPE_IDS.get(link.filter?.type) ?? 0,
          link.filter?.cutoff ?? 5000,
          link.filter?.resonance || 0.7,
          link.distortion?.enabled ? DISTORTION_TYPE_IDS.get(link.distortion?.type) ?? 2 : 0,
          link.distortion?.gain || 1.5,
          link.envelope?.delay || 0,
          link.envelope?.attack || 0.01,
          link.envelope?.decay || 0.16,
          link.envelope?.sustain ?? 0.72,
          link.envelope?.release || 0.24,
          link.map?.srcMin ?? 0,
          link.map?.srcMax ?? 1,
          link.map?.trgtMin ?? 0,
          link.map?.trgtMax ?? 1,
        )
        : -1;
    }

    for (const link of this.links) {
      if (link.monitorOnly || !link.internalTarget) {
        continue;
      }
      const from = this.nodesById.get(link.from)?.wasmIndex ?? -1;
      const targetIndex = this.linksById.get(link.to)?.wasmIndex ?? -1;
      const to = targetIndex >= 0 ? LINK_TARGET_BASE - targetIndex : AUDIO_TARGET;
      link.wasmIndex = from >= 0 && targetIndex >= 0
        ? this.wasm.addLink(
          from,
          to,
          link.amount,
          link.delay || 0,
          link.noise || 0,
          link.pan || 0,
          MODULATION_TARGET_IDS.get(link.modulationTarget) ?? 0,
          PARAMETER_MODE_IDS.get(link.parameterMode) ?? 0,
          link.velocitySensitivity || 0,
          link.drone ? 1 : 0,
          SIGNAL_MODE_IDS.get(link.signalMode) ?? 0,
          link.follower?.attack || 0.01,
          link.follower?.release || 0.12,
          FILTER_TYPE_IDS.get(link.filter?.type) ?? 0,
          link.filter?.cutoff ?? 5000,
          link.filter?.resonance || 0.7,
          link.distortion?.enabled ? DISTORTION_TYPE_IDS.get(link.distortion?.type) ?? 2 : 0,
          link.distortion?.gain || 1.5,
          link.envelope?.delay || 0,
          link.envelope?.attack || 0.01,
          link.envelope?.decay || 0.16,
          link.envelope?.sustain ?? 0.72,
          link.envelope?.release || 0.24,
          link.map?.srcMin ?? 0,
          link.map?.srcMax ?? 1,
          link.map?.trgtMin ?? 0,
          link.map?.trgtMax ?? 1,
        )
        : -1;
    }
    this.wasm.armCustomOnceTriggers?.(DRONE_SLOT);
  }

  setSampleData(payload = {}) {
    if (!payload.nodeId) return;
    const data = payload.data instanceof Float32Array
      ? payload.data
      : Float32Array.from(Array.isArray(payload.data) ? payload.data : []);
    this.sampleDataByNodeId.set(payload.nodeId, {
      data,
      sampleRate: Number.isFinite(Number(payload.sampleRate)) ? Math.max(1, Number(payload.sampleRate)) : sampleRate,
      name: payload.name || "",
      storageKey: payload.storageKey || "",
    });
    const node = this.nodesById.get(payload.nodeId);
    if (node) this.copySampleDataToWasm(node);
    if (this.linkScopeRequests.length > 0) {
      this.monitorScopeStates.clear();
      this.setLinkScopes({ ...this.linkScopeRequests[0], linkIds: this.linkScopeRequests.map((request) => request.linkId) });
    }
  }

  copySampleDataToWasm(node) {
    if (!this.wasm || node?.wave !== "sample" || node.wasmIndex < 0) return;
    const entry = this.sampleDataByNodeId.get(node.id);
    if (!entry?.data?.length || typeof this.wasm.setSampleData !== "function" || typeof this.wasm.sampleDataPtr !== "function") return;
    const maxFrames = typeof this.wasm.maxSampleFrames === "function" ? this.wasm.maxSampleFrames() : entry.data.length;
    const length = Math.min(entry.data.length, Math.max(0, maxFrames || 0));
    if (!length) return;
    const slot = this.wasm.setSampleData(node.wasmIndex, entry.sampleRate || sampleRate, length);
    if (slot < 0) return;
    const ptr = this.wasm.sampleDataPtr(slot);
    if (!ptr) return;
    new Float32Array(this.wasm.memory.buffer, ptr, length).set(entry.data.subarray(0, length));
  }

  setNodeParam({ id, parameter, value } = {}) {
    const node = this.nodesById.get(id);
    if (!node || node.wasmIndex < 0) return;
    if (parameter === "frequencyMode") {
      node.frequencyMode = ["ratio", "fixed", "sync"].includes(value) ? value : "ratio";
      this.wasm?.setNodeFrequencyMode?.(node.wasmIndex, this.frequencyModeId(node));
    } else if (parameter === "ratio") {
      node.ratio = Number.isFinite(Number(value)) ? Number(value) : 0;
      this.wasm?.setNodeRatio?.(node.wasmIndex, node.ratio);
    } else if (parameter === "frequency") {
      node.frequency = node.wave === "constant"
        ? (Number.isFinite(Number(value)) ? Number(value) : 1)
        : (Number.isFinite(Number(value)) ? Number(value) : 0);
      node.baseFrequency = node.frequency;
      this.wasm?.setNodeFrequency?.(node.wasmIndex, node.frequency);
    } else if (parameter === "syncBeats") {
      node.syncBeats = this.normalizeSyncBeats(value);
      this.wasm?.setNodeSyncBeats?.(node.wasmIndex, node.syncBeats);
    } else if (parameter === "quantise.enabled") {
      node.quantise.enabled = Boolean(value);
      this.wasm?.setNodeQuantiseEnabled?.(node.wasmIndex, node.quantise.enabled ? 1 : 0);
    } else if (parameter === "quantise.root") {
      node.quantise.root = value === QUANTISE_MIDI_ROOT || QUANTISE_ROOT_NOTES.includes(value) ? value : "C";
      this.wasm?.setNodeQuantiseRoot?.(
        node.wasmIndex,
        node.quantise.root === QUANTISE_MIDI_ROOT ? -1 : QUANTISE_ROOT_NOTES.indexOf(node.quantise.root),
      );
    } else if (parameter === "quantise.scale") {
      node.quantise.scale = QUANTISE_SCALE_IDS.has(value) ? value : "chromatic";
      this.wasm?.setNodeQuantiseScale?.(node.wasmIndex, QUANTISE_SCALE_IDS.get(node.quantise.scale) ?? 0);
    } else if (parameter === "quantise.glide") {
      node.quantise.glide = this.clamp(Number(value) || 0, 0, 4);
      this.wasm?.setNodeQuantiseGlide?.(node.wasmIndex, node.quantise.glide);
    } else if (parameter === "speed") {
      node.speed = Number.isFinite(Number(value)) ? Number(value) : 8;
      this.wasm?.setNodeSpeed?.(node.wasmIndex, node.speed);
    } else if (parameter === "audioInputGain") {
      node.audioInputGain = Number.isFinite(Number(value)) ? Number(value) : 1;
      this.wasm?.setNodeAudioInputGain?.(node.wasmIndex, node.audioInputGain);
    } else if (parameter === "sample.mode") {
      node.sample.mode = SAMPLE_MODE_IDS.has(value) ? value : "one-shot";
      this.wasm?.setNodeSampleMode?.(node.wasmIndex, SAMPLE_MODE_IDS.get(node.sample.mode) ?? 0);
    } else if (parameter === "sample.start") {
      node.sample.start = this.clamp(Number(value) || 0, 0, 1);
      this.wasm?.setNodeSampleStart?.(node.wasmIndex, node.sample.start);
    } else if (parameter === "sample.end") {
      node.sample.end = this.clamp(Number(value) || 0, 0, 1);
      this.wasm?.setNodeSampleEnd?.(node.wasmIndex, node.sample.end);
    } else if (parameter === "sample.stretch") {
      node.sample.stretch = Math.max(0.001, Number(value) || 1);
      this.wasm?.setNodeSampleStretch?.(node.wasmIndex, node.sample.stretch);
    } else if (parameter === "sample.cycleLength") {
      node.sample.cycleLength = Math.max(1, Math.round(Number(value) || 4096));
      this.wasm?.setNodeSampleCycleLength?.(node.wasmIndex, node.sample.cycleLength);
    } else if (parameter === "sample.overlapRatio") {
      node.sample.overlapRatio = this.clamp(Number(value) || 0, 0, 1);
      this.wasm?.setNodeSampleOverlapRatio?.(node.wasmIndex, node.sample.overlapRatio);
    } else if (parameter === "sample.originalPitch") {
      node.sample.originalPitch = Number.isFinite(Number(value)) ? Number(value) : 60;
      this.wasm?.setNodeSampleOriginalPitch?.(node.wasmIndex, node.sample.originalPitch);
    }
  }

  setLinkParam({ id, parameter, value } = {}) {
    const link = this.linksById.get(id);
    if (!link) return;
    if (parameter === "amount") {
      link.amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    } else if (parameter === "delay") {
      link.delay = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
    } else if (parameter === "noise") {
      link.noise = this.clamp(Number(value) || 0, 0, 1);
    } else if (parameter === "pan") {
      link.pan = this.clamp(Number(value) || 0, -1, 1);
    } else if (parameter === "velocitySensitivity") {
      link.velocitySensitivity = this.clamp(Number(value) || 0, -8, 8);
      if (this.wasm?.setLinkVelocitySensitivity && link.wasmIndex >= 0) {
        this.wasm.setLinkVelocitySensitivity(link.wasmIndex, link.velocitySensitivity);
      }
    } else if (parameter === "filter.cutoff") {
      const isComb = link.filter.type === "comb" || link.filter.type === "comb-notch";
      link.filter.cutoff = link.filter.type === "formant"
        ? this.clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1)
        : Math.max(0, Number.isFinite(Number(value)) ? Number(value) : isComb ? 440 : 5000);
      if (link.filter.type === "formant" && this.wasm?.setLinkFilterCutoff && link.wasmIndex >= 0) {
        this.wasm.setLinkFilterCutoff(link.wasmIndex, link.filter.cutoff);
      }
    } else if (parameter === "filter.resonance") {
      const isComb = link.filter.type === "comb" || link.filter.type === "comb-notch";
      link.filter.resonance = this.clamp(
        Number.isFinite(Number(value)) ? Number(value) : isComb ? 0.45 : 0.7,
        isComb ? -0.999 : 0,
        link.filter.type === "formant" ? Infinity : isComb ? 0.999 : Infinity,
      );
      if (link.filter.type === "formant" && this.wasm?.setLinkFilterResonance && link.wasmIndex >= 0) {
        this.wasm.setLinkFilterResonance(link.wasmIndex, link.filter.resonance);
      }
    } else if (parameter === "distortion.gain") {
      link.distortion = {
        ...(link.distortion || { enabled: false, type: "soft-clip", gain: 1.5 }),
        gain: Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 1.5),
      };
    } else {
      return;
    }

    link.controlSmoother = this.syncLinkControlSmoother(link);
  }

  linkControlTargets(link) {
    return {
      amount: link.amount,
      delay: link.delay,
      noise: link.noise,
      pan: link.pan,
      filterCutoff: link.filter?.cutoff ?? 5000,
      filterResonance: link.filter?.resonance || 0.7,
      distortionGain: link.distortion?.gain ?? 1.5,
    };
  }

  linkControlIsSettled(smoother) {
    const { current, target } = smoother;
    return current.amount === target.amount
      && current.delay === target.delay
      && current.noise === target.noise
      && current.pan === target.pan
      && current.filterCutoff === target.filterCutoff
      && current.filterResonance === target.filterResonance
      && current.distortionGain === target.distortionGain;
  }

  syncActiveLinkControlSmoother(smoother) {
    if (this.linkControlIsSettled(smoother)) {
      this.activeLinkControlSmoothers.delete(smoother.id);
    } else {
      this.activeLinkControlSmoothers.add(smoother.id);
    }
  }

  syncLinkControlSmoother(link, resetCurrent = false) {
    const target = this.linkControlTargets(link);
    const existing = this.linkControlSmoothers.get(link.id);
    if (existing) {
      existing.target = target;
      if (resetCurrent) existing.current = { ...target };
      if (resetCurrent || link.filter?.type === "formant") {
        existing.current.filterCutoff = target.filterCutoff;
        existing.current.filterResonance = target.filterResonance;
      }
      this.syncActiveLinkControlSmoother(existing);
      return existing;
    }

    const smoother = {
      id: link.id,
      current: { ...target },
      target,
    };
    this.linkControlSmoothers.set(link.id, smoother);
    this.syncActiveLinkControlSmoother(smoother);
    return smoother;
  }

  smoothControlValue(current, target, alpha) {
    const next = current + (target - current) * alpha;
    return Math.abs(target - next) <= LINK_CONTROL_SETTLE_EPSILON ? target : next;
  }

  applyLinkControlSmoother(link) {
    const current = link.controlSmoother?.current || this.linkControlTargets(link);
    if (this.wasm?.setLinkAmount && link.wasmIndex >= 0) {
      this.wasm.setLinkAmount(link.wasmIndex, current.amount);
    }
    if (this.wasm?.setLinkDelay && link.wasmIndex >= 0) {
      this.wasm.setLinkDelay(link.wasmIndex, current.delay);
    }
    if (this.wasm?.setLinkNoise && link.wasmIndex >= 0) {
      this.wasm.setLinkNoise(link.wasmIndex, current.noise);
    }
    if (this.wasm?.setLinkPan && link.wasmIndex >= 0) {
      this.wasm.setLinkPan(link.wasmIndex, current.pan);
    }
    if (this.wasm?.setLinkFilterCutoff && link.wasmIndex >= 0) {
      this.wasm.setLinkFilterCutoff(link.wasmIndex, current.filterCutoff);
    }
    if (this.wasm?.setLinkFilterResonance && link.wasmIndex >= 0) {
      this.wasm.setLinkFilterResonance(link.wasmIndex, current.filterResonance);
    }
    if (this.wasm?.setLinkDistortionGain && link.wasmIndex >= 0) {
      this.wasm.setLinkDistortionGain(link.wasmIndex, current.distortionGain);
    }
  }

  advanceLinkControlSmoothers(frames = this.lastProcessFrames || 128) {
    if (!this.activeLinkControlSmoothers.size) return;
    const alpha = 1 - Math.exp(-Math.max(1, frames) / (sampleRate * LINK_CONTROL_SMOOTH_SECONDS));

    for (const id of [...this.activeLinkControlSmoothers]) {
      const smoother = this.linkControlSmoothers.get(id);
      const link = this.linksById.get(id);
      if (!smoother || !link) {
        this.activeLinkControlSmoothers.delete(id);
        continue;
      }

      const { current, target } = smoother;
      current.amount = this.smoothControlValue(current.amount, target.amount, alpha);
      current.delay = this.smoothControlValue(current.delay, target.delay, alpha);
      current.noise = this.smoothControlValue(current.noise, target.noise, alpha);
      current.pan = this.smoothControlValue(current.pan, target.pan, alpha);
      current.filterCutoff = this.smoothControlValue(current.filterCutoff, target.filterCutoff, alpha);
      current.filterResonance = this.smoothControlValue(current.filterResonance, target.filterResonance, alpha);
      current.distortionGain = this.smoothControlValue(current.distortionGain, target.distortionGain, alpha);
      this.applyLinkControlSmoother(link);
      this.syncActiveLinkControlSmoother(smoother);
    }
  }

  normalizeEffects(effects = {}) {
    return {
      chorus: {
        enabled: Boolean(effects.chorus?.enabled),
        rate: this.clamp(Number(effects.chorus?.rate) || 0.8, 0.05, 6),
        depth: this.clamp(Number(effects.chorus?.depth) || 0.012, 0.001, 0.04),
        mix: this.clamp(Number(effects.chorus?.mix) || 0.25, 0, 1),
      },
      delay: {
        enabled: Boolean(effects.delay?.enabled),
        time: this.clamp(Number(effects.delay?.time) || 0.28, 0.02, 1.5),
        feedback: this.clamp(Number(effects.delay?.feedback) || 0.35, 0, 0.92),
        mix: this.clamp(Number(effects.delay?.mix) || 0.25, 0, 1),
      },
      reverb: {
        enabled: Boolean(effects.reverb?.enabled),
        size: this.clamp(Number(effects.reverb?.size) || 0.55, 0.1, 1),
        decay: this.clamp(Number(effects.reverb?.decay) || 0.45, 0, 0.94),
        mix: this.clamp(Number(effects.reverb?.mix) || 0.25, 0, 1),
      },
    };
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  sanitizeSample(value, limit = 16) {
    if (!Number.isFinite(value)) return 0;
    if (Math.abs(value) < DENORMAL_EPSILON) return 0;
    return this.clamp(value, -limit, limit);
  }

  smoothStep(t) {
    const x = this.clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  createReverbDelays() {
    return [0.043, 0.061, 0.079, 0.097].map((time) => ({
      buffer: new Float32Array(Math.ceil(sampleRate * time)),
      index: 0,
    }));
  }

  createDcBlocker() {
    return {
      input: 0,
      output: 0,
      coefficient: Math.exp((-TWO_PI * MASTER_DC_BLOCK_HZ) / sampleRate),
    };
  }

  readDelay(buffer, writeIndex, delaySamples) {
    const length = buffer.length;
    let index = writeIndex - delaySamples;
    if (index < 0) index += length;

    const indexA = Math.floor(index) % length;
    const indexB = (indexA + 1) % length;
    const fraction = index - Math.floor(index);
    return this.sanitizeSample(buffer[indexA] * (1 - fraction) + buffer[indexB] * fraction);
  }

  applyChorus(sample, channel) {
    const cleanSample = this.sanitizeSample(sample);
    const effect = this.masterEffects.chorus;
    const buffer = this.chorusBuffers[channel];
    const index = this.chorusIndices[channel];
    if (!effect.enabled || effect.mix <= 0) {
      buffer[index] = cleanSample;
      this.chorusIndices[channel] = (index + 1) % buffer.length;
      return cleanSample;
    }

    const baseDelay = 0.012 * sampleRate;
    const depthSamples = effect.depth * sampleRate;
    const lfo = 0.5 + 0.5 * Math.sin(this.chorusPhases[channel]);
    const delayed = this.readDelay(buffer, index, baseDelay + depthSamples * lfo);
    buffer[index] = cleanSample;
    this.chorusIndices[channel] = (index + 1) % buffer.length;
    this.chorusPhases[channel] = (this.chorusPhases[channel] + (TWO_PI * effect.rate) / sampleRate) % TWO_PI;
    return this.sanitizeSample(cleanSample * (1 - effect.mix) + delayed * effect.mix);
  }

  applyDelay(sample, channel) {
    const cleanSample = this.sanitizeSample(sample);
    const effect = this.masterEffects.delay;
    const buffer = this.delayBuffers[channel];
    const index = this.delayIndices[channel];
    const active = effect.enabled && effect.mix > 0;
    const delaySamples = Math.min(buffer.length - 1, Math.max(1, effect.time * sampleRate));
    const delayed = this.readDelay(buffer, index, delaySamples);
    buffer[index] = this.sanitizeSample(cleanSample + delayed * (active ? effect.feedback : 0));
    this.delayIndices[channel] = (index + 1) % buffer.length;

    if (!active) return cleanSample;
    return this.sanitizeSample(cleanSample * (1 - effect.mix) + delayed * effect.mix);
  }

  applyReverb(sample, channel) {
    const cleanSample = this.sanitizeSample(sample);
    const effect = this.masterEffects.reverb;
    const active = effect.enabled && effect.mix > 0;
    let wet = 0;

    for (const delay of this.reverbDelays[channel]) {
      const readIndex = delay.index;
      const delayed = this.sanitizeSample(delay.buffer[readIndex]);
      wet += delayed;
      const damping = active ? effect.decay * (0.55 + effect.size * 0.4) : 0;
      delay.buffer[readIndex] = this.sanitizeSample(cleanSample + delayed * damping);
      delay.index = (delay.index + 1) % delay.buffer.length;
    }

    wet *= 0.25;
    if (!active) return cleanSample;
    return this.sanitizeSample(cleanSample * (1 - effect.mix) + wet * effect.mix);
  }

  applyDcBlocker(sample, channel, blockers) {
    const state = blockers[channel];
    const cleanSample = this.sanitizeSample(sample, 4);
    const output = cleanSample - state.input + state.coefficient * state.output;
    state.input = cleanSample;
    state.output = this.sanitizeSample(output, 4);
    return state.output;
  }

  applyMasterEffects(sample, channel) {
    let effected = this.applyDcBlocker(sample, channel, this.inputDcBlockers);
    effected = this.applyChorus(effected, channel);
    effected = this.applyDelay(effected, channel);
    effected = this.applyReverb(effected, channel);
    return this.sanitizeSample(Math.tanh(this.applyDcBlocker(effected, channel, this.outputDcBlockers)), 1);
  }

  midiNoteFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  allocateSlot() {
    if (this.freeSlots.length) return this.freeSlots.shift();
    const stolenVoice = [...this.voices.values()]
      .filter((voice) => voice.stolenAt !== null)
      .sort((a, b) => a.stolenAt - b.stolenAt)[0];
    if (stolenVoice) {
      const slot = stolenVoice.slot;
      this.deleteVoice(stolenVoice.id, { keepSlot: true });
      return slot;
    }
    return null;
  }

  voiceToSteal() {
    const voices = [...this.voices.values()];
    return voices
      .filter((voice) => voice.stolenAt === null)
      .sort((a, b) => {
        if ((a.releasedAt === null) !== (b.releasedAt === null)) return a.releasedAt === null ? 1 : -1;
        return (a.releasedAt ?? a.startedAt) - (b.releasedAt ?? b.startedAt);
      })[0] || null;
  }

  activeVoiceToSteal() {
    return [...this.voices.values()]
      .filter((voice) => voice.stolenAt === null && voice.releasedAt === null)
      .sort((a, b) => a.startedAt - b.startedAt)[0] || null;
  }

  activeVoiceCount() {
    let count = 0;
    for (const voice of this.voices.values()) {
      if (voice.stolenAt === null) count += 1;
    }
    return count;
  }

  stealVoiceForFade() {
    const candidate = this.voiceToSteal();
    if (!candidate) return false;
    candidate.stolenAt = this.sampleCursor / sampleRate;
    this.forgetActiveVoice(candidate.id);
    return true;
  }

  enforceVoiceLimit(limit = this.maxVoices) {
    while (this.activeVoiceCount() > limit) {
      const candidate = this.activeVoiceToSteal() || this.voiceToSteal();
      if (!candidate) return;
      candidate.stolenAt = this.sampleCursor / sampleRate;
      this.forgetActiveVoice(candidate.id);
    }
  }

  forgetActiveVoice(voiceId) {
    for (const [note, activeVoiceId] of this.activeVoicesByNote) {
      if (activeVoiceId === voiceId) this.activeVoicesByNote.delete(note);
    }
  }

  latestStolenFadeEnd(now = this.sampleCursor / sampleRate) {
    let fadeEnd = now;
    for (const voice of this.voices.values()) {
      if (voice.stolenAt !== null) {
        fadeEnd = Math.max(fadeEnd, voice.stolenAt + VOICE_STEAL_FADE_SECONDS);
      }
    }
    return fadeEnd;
  }

  queueVoiceStart(note, velocity, readyAt) {
    this.pendingVoiceStarts = this.pendingVoiceStarts.filter((pending) => pending.note !== note);
    this.pendingVoiceStarts.push({ note, velocity, readyAt });
  }

  flushPendingVoiceStarts(now) {
    if (!this.pendingVoiceStarts.length) return;

    let ready = [];
    const remaining = [];
    for (const pending of this.pendingVoiceStarts) {
      if (pending.readyAt > now) {
        remaining.push(pending);
      } else {
        ready.push(pending);
      }
    }
    if (!ready.length) {
      this.pendingVoiceStarts = remaining;
      return;
    }

    if (ready.length > this.maxVoices) {
      ready = ready.slice(ready.length - this.maxVoices);
    }

    const freeActiveSlots = Math.max(0, this.maxVoices - this.activeVoiceCount());
    const slotsToReserve = Math.max(0, ready.length - freeActiveSlots);
    if (slotsToReserve > 0) {
      let reservedSlots = 0;
      while (reservedSlots < slotsToReserve && this.stealVoiceForFade()) {
        reservedSlots += 1;
      }
      this.pendingVoiceStarts = [
        ...remaining,
        ...ready.map((pending) => ({ ...pending, readyAt: this.latestStolenFadeEnd(now) })),
      ];
      return;
    }

    const stillPending = [];
    for (const pending of ready) {
      if (this.startVoice(pending.note, pending.velocity, now)) continue;
      stillPending.push({ ...pending, readyAt: this.latestStolenFadeEnd(now) });
    }
    this.pendingVoiceStarts = [...remaining, ...stillPending];
    this.enforceVoiceLimit();
  }

  startVoice(note, velocity = 1, startedAt = this.sampleCursor / sampleRate) {
    const numericNote = Number(note);
    if (!Number.isFinite(numericNote)) return false;
    const slot = this.allocateSlot();
    if (slot === null) return false;
    this.wasm?.resetVoiceSlot?.(slot);
    if (this.zeroVoicePhasesOnStart) this.wasm?.resetVoiceSlotPhases?.(slot);
    const voice = {
      id: `voice-${this.voiceCounter++}`,
      slot,
      note: numericNote,
      frequency: this.midiNoteFrequency(numericNote),
      velocity: this.clamp(Number(velocity) || 0, 0.05, 1),
      startedAt,
      releasedAt: null,
      stolenAt: null,
      releaseSeconds: 0.24,
      releaseGain: 1,
      oneShotSampleEndAt: this.oneShotSampleEndAt(startedAt, this.midiNoteFrequency(numericNote)),
    };
    this.voices.set(voice.id, voice);
    this.activeVoicesByNote.set(numericNote, voice.id);
    return true;
  }

  noteOn(note, velocity = 1) {
    const numericNote = Number(note);
    if (!Number.isFinite(numericNote)) return;
    const now = this.sampleCursor / sampleRate;
    const activeVoice = this.voices.get(this.activeVoicesByNote.get(numericNote));
    if (activeVoice && activeVoice.releasedAt === null) {
      activeVoice.releasedAt = now;
      this.activeVoicesByNote.delete(numericNote);
    }
    this.queueVoiceStart(numericNote, velocity, now);
    this.flushPendingVoiceStarts(now);
  }

  noteOff(note) {
    const numericNote = Number(note);
    this.pendingVoiceStarts = this.pendingVoiceStarts.filter((pending) => pending.note !== numericNote);
    const voice = this.voices.get(this.activeVoicesByNote.get(numericNote));
    if (!voice) return;
    if (voice.oneShotSampleEndAt !== null && this.sampleCursor / sampleRate < voice.oneShotSampleEndAt) {
      return;
    }
    this.releaseVoice(voice, this.sampleCursor / sampleRate, this.outputReleaseSeconds());
  }

  releaseVoice(voice, now, releaseSeconds) {
    if (voice.releasedAt !== null) return;
    voice.releaseGain = this.voiceLifecycleGain(voice, now);
    voice.releaseSeconds = releaseSeconds;
    voice.releasedAt = now;
    this.activeVoicesByNote.delete(voice.note);
  }

  deleteVoice(voiceId, { keepSlot = false } = {}) {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    this.voices.delete(voiceId);
    for (const [note, activeVoiceId] of this.activeVoicesByNote) {
      if (activeVoiceId === voiceId) this.activeVoicesByNote.delete(note);
    }
    if (!keepSlot && Number.isInteger(voice.slot)) {
      this.freeSlots.push(voice.slot);
      this.freeSlots.sort((a, b) => a - b);
    }
  }

  outputReleaseSeconds() {
    const outputReleases = this.links
      .filter((link) => link.to === "audio" && !link.monitorOnly)
      .map((link) => link.envelope?.release || 0.24);
    return Math.max(0.001, ...outputReleases);
  }

  sampleRangeLength(node) {
    const entry = this.sampleDataByNodeId.get(node.id);
    const length = entry?.data?.length || 0;
    if (!length) return 0;
    const start = this.clamp(Number(node.sample?.start) || 0, 0, 1);
    const end = this.clamp(Number.isFinite(Number(node.sample?.end)) ? Number(node.sample.end) : 1, 0, 1);
    const maxFrame = Math.max(0, length - 1);
    return Math.abs(Math.round(end * maxFrame) - Math.round(start * maxFrame)) + 1;
  }

  oneShotSampleDuration(node, noteFrequency) {
    if (node.wave !== "sample" || node.sample?.mode !== "one-shot") return 0;
    const rangeLength = this.sampleRangeLength(node);
    if (!rangeLength) return 0;
    const entry = this.sampleDataByNodeId.get(node.id);
    const original = this.midiNoteFrequency(node.sample?.originalPitch ?? 60);
    const base = this.baseFrequency(node, noteFrequency);
    const playbackRate = Math.max(0.0001, base) / Math.max(0.0001, original);
    const sourceRate = Math.max(1, entry?.sampleRate || sampleRate);
    return rangeLength / sourceRate / playbackRate;
  }

  baseFrequency(node, noteFrequency) {
    if (node?.frequencyMode === "fixed") return Number(node.frequency) || 0;
    if (node?.frequencyMode === "sync") return (this.tempo / 60) / this.normalizeSyncBeats(node.syncBeats);
    return noteFrequency * (Number.isFinite(Number(node?.ratio)) ? Number(node.ratio) : 1);
  }

  oneShotSampleEndAt(startedAt, noteFrequency) {
    let duration = 0;
    for (const node of this.nodes) {
      duration = Math.max(duration, this.oneShotSampleDuration(node, noteFrequency));
    }
    return duration > 0 ? startedAt + duration : null;
  }

  voiceLifecycleGain(voice, now) {
    const startGain = this.smoothStep((now - voice.startedAt) / VOICE_START_FADE_SECONDS);
    if (voice.stolenAt === null) return startGain;
    const stealFade = 1 - this.smoothStep((now - voice.stolenAt) / VOICE_STEAL_FADE_SECONDS);
    return startGain * stealFade;
  }

  pruneVoices(now) {
    for (const voice of [...this.voices.values()]) {
      if (voice.releasedAt === null && voice.oneShotSampleEndAt !== null && now >= voice.oneShotSampleEndAt) {
        this.deleteVoice(voice.id);
        continue;
      }
      const stealFinished = voice.stolenAt !== null && now - voice.stolenAt > VOICE_STEAL_FADE_SECONDS;
      const releaseFinished = voice.releasedAt !== null && now - voice.releasedAt > (voice.releaseSeconds || 0.24) + 0.02;
      if (stealFinished || releaseFinished) {
        this.deleteVoice(voice.id);
      }
    }
    this.enforceVoiceLimit();
    this.flushPendingVoiceStarts(now);
  }

  resetRuntimeState() {
    this.voices.clear();
    this.activeVoicesByNote.clear();
    this.pendingVoiceStarts = [];
    this.freeSlots = Array.from({ length: MAX_ACTIVE_VOICES }, (_, index) => index);
    this.chorusBuffers.forEach((buffer) => buffer.fill(0));
    this.chorusIndices = [0, 0];
    this.chorusPhases = [0, Math.PI * 0.5];
    this.delayBuffers.forEach((buffer) => buffer.fill(0));
    this.delayIndices = [0, 0];
    this.reverbDelays = [this.createReverbDelays(), this.createReverbDelays()];
    this.inputDcBlockers = [this.createDcBlocker(), this.createDcBlocker()];
    this.outputDcBlockers = [this.createDcBlocker(), this.createDcBlocker()];
    if (this.wasm) this.wasm.resetPhases();
    this.wasm?.clearLinkMeters?.();
  }

  setMuted(muted) {
    this.muted = muted;
    this.zeroVoicePhasesOnStart = !muted;
    this.resetRuntimeState();
  }

  waveId(node) {
    return WAVE_IDS.get(node?.wave) || 0;
  }

  frequencyModeId(node) {
    if (node?.frequencyMode === "fixed") return 1;
    if (node?.frequencyMode === "sync") return 2;
    return 0;
  }

  renderVoice(voice, now, frames) {
    this.wasm.renderVoiceGraph(
      voice.slot,
      frames,
      sampleRate,
      voice.frequency,
      voice.velocity,
      1,
      now - voice.startedAt,
      voice.releasedAt === null ? -1 : now - voice.releasedAt,
      voice.stolenAt === null ? -1 : now - voice.stolenAt,
    );
  }

  setLinkScopes(payload = {}) {
    const linkIds = Array.isArray(payload.linkIds)
      ? payload.linkIds.map((id) => String(id)).filter(Boolean)
      : payload.linkId
      ? [String(payload.linkId)]
      : [];

    if (linkIds.length === 0) {
      this.linkScopeRequest = null;
      this.linkScopeRequests = [];
      this.linkScopeRequestIndex = 0;
      this.monitorScopeStates.clear();
      this.dspScopeStates.clear();
      this.wasm?.setLinkScope?.(-1, 0, 0.08, 256, sampleRate);
      this.wasm?.clearDspScopes?.();
      return;
    }

    const points = this.clamp(Math.round(Number(payload.points) || 256), 32, 512);
    const displayPoints = this.clamp(Math.round(Number(payload.displayPoints) || points), 32, points);
    const seconds = this.clamp(Number(payload.seconds) || 0.08, 0.01, LINK_SCOPE_SECONDS_MAX);
    const mode = payload.mode === "zero-crossing" ? "zero-crossing" : payload.mode === "envelope" ? "envelope" : "continuous";
    this.linkScopeRequests = [...new Set(linkIds)].map((linkId) => ({
      linkId,
      mode,
      points,
      displayPoints,
      seconds,
    }));
    this.linkScopeRequestIndex = Math.min(this.linkScopeRequestIndex, this.linkScopeRequests.length - 1);
    this.linkScopeRequest = this.linkScopeRequests[this.linkScopeRequestIndex] || null;
    this.wasm?.setLinkScope?.(-1, 0, 0.08, 256, sampleRate);

    if (this.dspProgram) {
      this.monitorScopeStates.clear();
      this.configureDspScopes();
      return;
    }

    this.dspScopeStates.clear();
    this.wasm?.clearDspScopes?.();
    const requestIds = new Set(this.linkScopeRequests.map((request) => request.linkId));
    for (const linkId of this.monitorScopeStates.keys()) {
      if (!requestIds.has(linkId)) this.monitorScopeStates.delete(linkId);
    }
    for (const request of this.linkScopeRequests) {
      this.ensureMonitorScopeState(request);
    }
  }

  applyLinkScopeRequest() {
    if (!this.linkScopeRequest) {
      this.wasm?.setLinkScope?.(-1, 0, 0.08, 256, sampleRate);
      return;
    }

    const link = this.linksById.get(this.linkScopeRequest.linkId);
    const modeId = this.linkScopeRequest.mode === "zero-crossing" ? 1 : this.linkScopeRequest.mode === "envelope" ? 2 : 0;
    this.wasm?.setLinkScope?.(
      link?.wasmIndex ?? -1,
      modeId,
      this.linkScopeRequest.seconds,
      this.linkScopeRequest.points,
      sampleRate,
    );
  }

  advanceLinkScopeRequest() {
    if (this.linkScopeRequests.length <= 1) return;
    this.linkScopeRequestIndex = (this.linkScopeRequestIndex + 1) % this.linkScopeRequests.length;
    this.linkScopeRequest = this.linkScopeRequests[this.linkScopeRequestIndex];
    this.applyLinkScopeRequest();
  }

  ensureMonitorScopeState(request) {
    const existing = this.monitorScopeStates.get(request.linkId);
    if (existing?.graphVersion === this.graphVersion) {
      existing.request = request;
      return existing;
    }

    const state = {
      request,
      graphVersion: this.graphVersion,
      ready: false,
      loading: true,
      wasm: null,
      linkIndex: -1,
      linkScopeSamples: null,
      sampleCursor: 0,
    };
    this.monitorScopeStates.set(request.linkId, state);

    void this.createMonitorScopeState(state).catch(() => {
      const current = this.monitorScopeStates.get(request.linkId);
      if (current === state) this.monitorScopeStates.delete(request.linkId);
    });

    return state;
  }

  async createMonitorScopeState(state) {
    if (!this.wasmBytes) return;
    const link = this.linksById.get(state.request.linkId);
    if (!link) return;

    const { instance } = await WebAssembly.instantiate(this.wasmBytes, {});
    if (this.monitorScopeStates.get(state.request.linkId) !== state) return;

    const wasm = instance.exports;
    const nodeIndices = new Map();
    wasm.clearGraph?.();
    wasm.clearLinkMeters?.();
    wasm.setTempo?.(this.tempo);

    for (const node of this.nodes) {
      const nodeIndex = wasm.addNode(
        this.waveId(node),
        this.frequencyModeId(node),
        node.ratio,
        node.frequency,
        node.syncBeats,
        node.quantise.enabled ? 1 : 0,
        node.quantise.root === QUANTISE_MIDI_ROOT ? -1 : QUANTISE_ROOT_NOTES.indexOf(node.quantise.root),
        QUANTISE_SCALE_IDS.get(node.quantise.scale) ?? 0,
        node.quantise.glide,
        node.speed,
        node.audioInputGain,
        CUSTOM_WAVE_MODE_IDS.get(node.customWave?.mode) ?? 0,
        node.customWave?.sustainStart ?? 0.5,
        node.customWave?.sustainEnd ?? 0.75,
        SAMPLE_MODE_IDS.get(node.sample?.mode) ?? 0,
        node.sample?.start ?? 0,
        node.sample?.end ?? 1,
        node.sample?.stretch ?? 1,
        node.sample?.cycleLength ?? 4096,
        node.sample?.overlapRatio ?? 0.09,
        node.sample?.originalPitch ?? 60,
      );
      nodeIndices.set(node.id, nodeIndex);
      if (nodeIndex >= 0 && node.wave === "custom" && typeof wasm.addCustomWavePoint === "function") {
        for (const point of node.customWave.points) {
          wasm.addCustomWavePoint(nodeIndex, point.x, point.y);
        }
      }
      this.copySampleDataToWasmInstance(wasm, node, nodeIndex);
    }

    const linkIndices = new Map();
    const addLinkToInstance = (candidate, to) => {
      const from = nodeIndices.get(candidate.from) ?? -1;
      if (from < 0) return -1;
      const linkIndex = wasm.addLink(
        from,
        to,
        candidate.amount,
        candidate.delay || 0,
        candidate.noise || 0,
        candidate.pan || 0,
        MODULATION_TARGET_IDS.get(candidate.modulationTarget) ?? 0,
        PARAMETER_MODE_IDS.get(candidate.parameterMode) ?? 0,
        candidate.velocitySensitivity || 0,
        candidate.drone ? 1 : 0,
        SIGNAL_MODE_IDS.get(candidate.signalMode) ?? 0,
        candidate.follower?.attack || 0.01,
        candidate.follower?.release || 0.12,
        FILTER_TYPE_IDS.get(candidate.filter?.type) ?? 0,
        candidate.filter?.cutoff ?? 5000,
        candidate.filter?.resonance || 0.7,
        candidate.distortion?.enabled ? DISTORTION_TYPE_IDS.get(candidate.distortion?.type) ?? 2 : 0,
        candidate.distortion?.gain || 1.5,
        candidate.envelope?.delay || 0,
        candidate.envelope?.attack || 0.01,
        candidate.envelope?.decay || 0.16,
        candidate.envelope?.sustain ?? 0.72,
        candidate.envelope?.release || 0.24,
        candidate.map?.srcMin ?? 0,
        candidate.map?.srcMax ?? 1,
        candidate.map?.trgtMin ?? 0,
        candidate.map?.trgtMax ?? 1,
      );
      if (linkIndex >= 0) linkIndices.set(candidate.id, linkIndex);
      return linkIndex;
    };

    for (const candidate of this.links) {
      if (candidate === link || candidate.monitorOnly || candidate.internalTarget || candidate.to === "audio") continue;
      const to = this.nodesById.has(candidate.to) ? nodeIndices.get(candidate.to) ?? -1 : -1;
      if (to >= 0) addLinkToInstance(candidate, to);
    }

    const linkIndex = addLinkToInstance(link, AUDIO_TARGET);
    if (linkIndex < 0) return;

    let addedInternalLink = true;
    while (addedInternalLink) {
      addedInternalLink = false;
      for (const internalLink of this.links) {
        if (!internalLink.internalTarget || linkIndices.has(internalLink.id)) continue;
        const targetIndex = linkIndices.get(internalLink.to);
        if (targetIndex === undefined) continue;
        const internalIndex = addLinkToInstance(internalLink, LINK_TARGET_BASE - targetIndex);
        if (internalIndex >= 0) addedInternalLink = true;
      }
    }

    const modeId = state.request.mode === "zero-crossing" ? 1 : state.request.mode === "envelope" ? 2 : 0;
    wasm.setLinkScope?.(linkIndex, modeId, state.request.seconds, state.request.points, sampleRate);
    wasm.armCustomOnceTriggers?.(DRONE_SLOT);

    state.wasm = wasm;
    state.linkIndex = linkIndex;
    state.linkScopeSamples = typeof wasm.linkScopePtr === "function"
      ? new Float32Array(wasm.memory.buffer, wasm.linkScopePtr(), 512)
      : null;
    state.ready = true;
    state.loading = false;
  }

  copySampleDataToWasmInstance(wasm, node, nodeIndex) {
    if (!wasm || node?.wave !== "sample" || nodeIndex < 0) return;
    const entry = this.sampleDataByNodeId.get(node.id);
    if (!entry?.data?.length || typeof wasm.setSampleData !== "function" || typeof wasm.sampleDataPtr !== "function") return;
    const maxFrames = typeof wasm.maxSampleFrames === "function" ? wasm.maxSampleFrames() : entry.data.length;
    const length = Math.min(entry.data.length, Math.max(0, maxFrames || 0));
    if (!length) return;
    const slot = wasm.setSampleData(nodeIndex, entry.sampleRate || sampleRate, length);
    if (slot < 0) return;
    const ptr = wasm.sampleDataPtr(slot);
    if (!ptr) return;
    new Float32Array(wasm.memory.buffer, ptr, length).set(entry.data.subarray(0, length));
  }

  renderMonitorScopes(frames) {
    for (const state of this.monitorScopeStates.values()) {
      if (!state.ready || !state.wasm) continue;
      const now = state.sampleCursor / sampleRate;
      state.wasm.clear?.(frames);
      state.wasm.renderVoiceGraph?.(
        DRONE_SLOT,
        frames,
        sampleRate,
        440,
        1,
        1,
        now,
        -1,
        -1,
      );
      state.sampleCursor += frames;
    }
  }

  monitorScopeFrameSamples(state) {
    if (!state.ready || !state.linkScopeSamples || !state.wasm) return [];
    const count = this.clamp(Math.round(state.wasm.linkScopeCount?.() || 0), 0, state.request.points);
    const mode = state.request.mode;
    const displayPoints = state.request.displayPoints || state.request.points;
    const writeIndex = mode === "envelope"
      ? 0
      : this.clamp(Math.round(state.wasm.linkScopeWriteIndex?.() || 0), 0, state.request.points - 1);
    const raw = Array.from(state.linkScopeSamples.slice(0, state.request.points));
    const samples = mode === "envelope"
      ? raw.slice(0, count).concat(Array(Math.max(0, state.request.points - count)).fill(0))
      : count < state.request.points
      ? raw.slice(0, count)
      : raw.slice(writeIndex).concat(raw.slice(0, writeIndex));
    if (samples.length < displayPoints) {
      return Array(Math.max(0, displayPoints - samples.length)).fill(0).concat(samples).slice(-displayPoints);
    }
    if (mode !== "zero-crossing") return samples.slice(-displayPoints);
    const maxCrossing = samples.length - displayPoints;
    const crossing = samples.findIndex((sample, index) => (
      index > 0
      && index <= maxCrossing
      && samples[index - 1] < 0
      && sample >= 0
    ));
    return (crossing > 0 ? samples.slice(crossing, crossing + displayPoints) : samples.slice(-displayPoints));
  }

  linkScopeFrameSamples() {
    if (!this.linkScopeRequest || !this.linkScopeSamples || !this.wasm) return [];
    const count = this.clamp(Math.round(this.wasm.linkScopeCount?.() || 0), 0, this.linkScopeRequest.points);
    const mode = this.linkScopeRequest.mode;
    const displayPoints = this.linkScopeRequest.displayPoints || this.linkScopeRequest.points;
    const writeIndex = mode === "envelope"
      ? 0
      : this.clamp(Math.round(this.wasm.linkScopeWriteIndex?.() || 0), 0, this.linkScopeRequest.points - 1);
    const raw = Array.from(this.linkScopeSamples.slice(0, this.linkScopeRequest.points));
    const samples = mode === "envelope"
      ? raw.slice(0, count).concat(Array(Math.max(0, this.linkScopeRequest.points - count)).fill(0))
      : count < this.linkScopeRequest.points
      ? raw.slice(0, count)
      : raw.slice(writeIndex).concat(raw.slice(0, writeIndex));
    if (samples.length < displayPoints) {
      return Array(Math.max(0, displayPoints - samples.length)).fill(0).concat(samples).slice(-displayPoints);
    }
    if (mode !== "zero-crossing") return samples.slice(-displayPoints);
    const maxCrossing = samples.length - displayPoints;
    const crossing = samples.findIndex((sample, index) => (
      index > 0
      && index <= maxCrossing
      && samples[index - 1] < 0
      && sample >= 0
    ));
    return (crossing > 0 ? samples.slice(crossing, crossing + displayPoints) : samples.slice(-displayPoints));
  }

  dspScopeFrameSamples(state) {
    if (!state?.samples || !this.wasm) return [];
    const count = this.clamp(Math.round(this.wasm.dspScopeCount?.(state.slot) || 0), 0, state.request.points);
    const mode = state.request.mode;
    const displayPoints = state.request.displayPoints || state.request.points;
    const writeIndex = mode === "envelope"
      ? 0
      : this.clamp(Math.round(this.wasm.dspScopeWriteIndex?.(state.slot) || 0), 0, state.request.points - 1);
    const raw = Array.from(state.samples.slice(0, state.request.points));
    const samples = mode === "envelope"
      ? raw.slice(0, count).concat(Array(Math.max(0, state.request.points - count)).fill(0))
      : count < state.request.points
      ? raw.slice(0, count)
      : raw.slice(writeIndex).concat(raw.slice(0, writeIndex));
    if (samples.length < displayPoints) {
      return Array(Math.max(0, displayPoints - samples.length)).fill(0).concat(samples).slice(-displayPoints);
    }
    if (mode !== "zero-crossing") return samples.slice(-displayPoints);
    const maxCrossing = samples.length - displayPoints;
    const crossing = samples.findIndex((sample, index) => (
      index > 0
      && index <= maxCrossing
      && samples[index - 1] < 0
      && sample >= 0
    ));
    return (crossing > 0 ? samples.slice(crossing, crossing + displayPoints) : samples.slice(-displayPoints));
  }

  flushLinkMeters() {
    if (this.sampleCursor < this.nextLinkMeterPostSample) return;
    this.nextLinkMeterPostSample = this.sampleCursor + Math.max(1, Math.round(sampleRate * LINK_METER_POST_SECONDS));
    const levels = this.links.filter((link) => !link.monitorOnly).map((link) => {
      const index = link.wasmIndex;
      const count = index >= 0 ? this.linkMeterCounts?.[index] || 0 : 0;
      if (count > 0) {
        return [
          link.id,
          Math.max(0, (this.linkMeterInputSums?.[index] || 0) / count),
          Math.max(0, (this.linkMeterOutputSums?.[index] || 0) / count),
          Math.max(0, (this.linkMeterEnvelopeSums?.[index] || 0) / count),
        ];
      }
      return [link.id, 0, 0, 0];
    });
    for (const state of this.monitorScopeStates.values()) {
      if (!state.ready || !state.wasm || state.linkIndex < 0) continue;
      const count = state.wasm.linkMeterCountPtr
        ? new Uint32Array(state.wasm.memory.buffer, state.wasm.linkMeterCountPtr(), 1024)[state.linkIndex] || 0
        : 0;
      if (count > 0) {
        const inputSums = new Float64Array(state.wasm.memory.buffer, state.wasm.linkMeterInputPtr(), 1024);
        const outputSums = new Float64Array(state.wasm.memory.buffer, state.wasm.linkMeterOutputPtr(), 1024);
        const envelopeSums = new Float64Array(state.wasm.memory.buffer, state.wasm.linkMeterEnvelopePtr(), 1024);
        levels.push([
          state.request.linkId,
          Math.max(0, (inputSums[state.linkIndex] || 0) / count),
          Math.max(0, (outputSums[state.linkIndex] || 0) / count),
          Math.max(0, (envelopeSums[state.linkIndex] || 0) / count),
        ]);
      }
      state.wasm.clearLinkMeters?.();
    }
    for (const state of this.dspMeterStates.values()) {
      const level = Math.max(0, Number(this.wasm?.dspMeterLevel?.(state.slot)) || 0);
      levels.push([state.id, level, level, level]);
    }
    this.lastOutputPeak = 0;
    this.wasm?.clearLinkMeters?.();
    this.wasm?.resetDspMeterLevels?.();
    this.port.postMessage({ type: "linkMeters", payload: { levels } });
    for (const state of this.monitorScopeStates.values()) {
      if (!state.ready) continue;
      this.port.postMessage({
        type: "linkScope",
        payload: {
          id: state.request.linkId,
          mode: state.request.mode,
          samples: this.monitorScopeFrameSamples(state),
        },
      });
    }
    for (const state of this.dspScopeStates.values()) {
      this.port.postMessage({
        type: "linkScope",
        payload: {
          id: state.request.linkId,
          mode: state.request.mode,
          samples: this.dspScopeFrameSamples(state),
        },
      });
    }
  }

  fillSilence(outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] || left;
    if (!left) return;
    left.fill(0);
    if (right !== left) right.fill(0);
  }

  copyInput(inputs, frames) {
    if (!this.inputBuffer) return;
    const input = inputs[0];
    const inputLeft = input?.[0];
    const inputRight = input?.[1] || inputLeft;
    for (let i = 0; i < frames; i += 1) {
      this.inputBuffer[i] = inputLeft
        ? ((inputLeft[i] || 0) + (inputRight?.[i] || 0)) * 0.5
        : 0;
    }
  }

  renderDspProgramToOutput(inputs, outputs, frames) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] || left;
    if (!left) return true;

    if (!this.ready || !this.dspProgram || this.dspProgram.errors.length > 0 || this.dspProgram.ops.length === 0) {
      this.fillSilence(outputs);
      this.sampleCursor += left.length;
      return true;
    }

    this.wasm.clear(frames);
    this.copyInput(inputs, frames);
    this.wasm.renderDspProgram?.(frames, sampleRate);

    let peak = 0;
    for (let i = 0; i < frames; i += 1) {
      const leftSample = this.applyMasterEffects(Math.tanh((this.leftBuffer[i] || 0) * MASTER_GAIN), 0);
      const rightSample = this.applyMasterEffects(Math.tanh((this.rightBuffer[i] || 0) * MASTER_GAIN), 1);
      left[i] = leftSample;
      right[i] = rightSample;
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
    }
    for (let i = frames; i < left.length; i += 1) {
      left[i] = 0;
      right[i] = 0;
    }
    this.lastOutputPeak = Math.max(this.lastOutputPeak, peak);
    this.sampleCursor += left.length;
    this.flushLinkMeters();
    return true;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] || left;
    if (!left) return true;

    const frames = Math.min(left.length, MAX_WASM_FRAMES);
    this.lastProcessFrames = frames;
    const now = this.sampleCursor / sampleRate;

    if (this.muted) {
      this.fillSilence(outputs);
      return true;
    }

    if (this.dspProgram) {
      return this.renderDspProgramToOutput(inputs, outputs, frames);
    }

    const hasMainLinks = this.links.some((link) => link.wasmIndex >= 0);
    if (!this.ready || (!hasMainLinks && this.monitorScopeStates.size === 0)) {
      this.fillSilence(outputs);
      this.sampleCursor += left.length;
      return true;
    }

    if (!hasMainLinks) {
      this.fillSilence(outputs);
      this.renderMonitorScopes(frames);
      this.sampleCursor += left.length;
      this.flushLinkMeters();
      return true;
    }

    this.pruneVoices(now);
    this.advanceLinkControlSmoothers(frames);
    this.wasm.clear(frames);
    this.copyInput(inputs, frames);

    if (this.hasActiveDroneLinks) {
      this.renderVoice({
        slot: DRONE_SLOT,
        frequency: 440,
        velocity: 1,
        startedAt: 0,
        releasedAt: null,
        stolenAt: null,
      }, now, frames);
    }

    for (const voice of this.voices.values()) {
      this.renderVoice(voice, now, frames);
    }

    this.renderMonitorScopes(frames);

    const hasAudibleOutput = this.links.some((link) => link.to === "audio" && !link.monitorOnly && link.wasmIndex >= 0);
    let peak = 0;
    for (let i = 0; i < frames; i += 1) {
      const leftSample = hasAudibleOutput
        ? this.applyMasterEffects(Math.tanh((this.leftBuffer[i] || 0) * MASTER_GAIN), 0)
        : 0;
      const rightSample = hasAudibleOutput
        ? this.applyMasterEffects(Math.tanh((this.rightBuffer[i] || 0) * MASTER_GAIN), 1)
        : 0;
      left[i] = leftSample;
      right[i] = rightSample;
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
    }
    for (let i = frames; i < left.length; i += 1) {
      left[i] = 0;
      right[i] = 0;
    }
    this.lastOutputPeak = Math.max(this.lastOutputPeak, peak);
    this.sampleCursor += left.length;
    this.flushLinkMeters();
    return true;
  }
}

registerProcessor("visual-fm-wasm-engine", VisualFmWasmEngine);
