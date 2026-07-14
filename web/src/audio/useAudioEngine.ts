import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUDIO_ENGINE_CONFIG } from './config';
import { DSP_OP, type DspProgram } from './dspProgram';
import { logDiagnosticEvent, serializeError } from '../diagnostics';

type AudioStatus = 'idle' | 'starting' | 'running' | 'error';
type RecordingStatus = 'idle' | 'waiting' | 'recording' | 'saving' | 'saved' | 'error';
export type AudioInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';
export type MidiInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';

const MIDI_CLOCK_TICKS_PER_BEAT = 24;
const MIDI_CLOCK_TEMPO_MIN = 1;
const MIDI_CLOCK_TEMPO_MAX = 999;
const MIDI_CLOCK_EMA_WEIGHT = 0.18;

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioInputState {
  status: AudioInputStatus;
  message: string;
  devices: AudioInputDevice[];
  selectedDeviceId: string;
  canSelectDevice: boolean;
}

export interface MidiInputDevice {
  id: string;
  label: string;
  state: string;
}

export interface MidiControlChange {
  id: number;
  sourceIndex: number;
  channel: number;
  cc: number;
  value: number;
  receivedAt: number;
}

export interface MidiInputState {
  status: MidiInputStatus;
  message: string;
  devices: MidiInputDevice[];
  canRequestAccess: boolean;
  lastControlChange?: MidiControlChange;
}

export interface LinkMeterReading {
  input: number;
  output: number;
  envelope: number;
}

export interface LinkScopeReading {
  mode: string;
  samples: number[];
}

export interface RecordingState {
  status: RecordingStatus;
  message: string;
  fileName: string | null;
  elapsedSeconds: number;
}

interface AudioEngineState {
  status: AudioStatus;
  message: string;
  peak: number;
  linkMeters: Record<string, LinkMeterReading>;
  linkScopes: Record<string, LinkScopeReading>;
  recording: RecordingState;
  audioInput: AudioInputState;
  midiInput: MidiInputState;
  start: () => Promise<void>;
  stop: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  syncGraph: (program: DspProgram) => void;
  setLinkScopes: (linkIds: string[]) => void;
  setAudioInputDeviceId: (deviceId: string) => void;
  refreshAudioInputDevices: () => Promise<void>;
  refreshMidiInputDevices: () => Promise<void>;
}

interface UseAudioEngineOptions {
  selectedMidiInputDeviceIds?: string[];
  recordingPatchName?: string;
}

interface MidiInputLike {
  id?: string;
  name?: string;
  manufacturer?: string;
  state?: string;
  onmidimessage: ((event: any) => void) | null;
}

interface MidiAccessLike {
  inputs: {
    values: () => Iterable<MidiInputLike>;
  };
  onstatechange: (() => void) | null;
}

interface RecordingCapture {
  id: number;
  patchName: string;
  chunks: Float32Array[][];
  channelCount: number;
  sampleRate: number;
  frames: number;
  stopping: boolean;
}

interface SampleDataCacheEntry {
  key: string;
  data: Float32Array;
  sampleRate: number;
  name: string;
  storageKey: string;
}

interface SampleDataRequest {
  key: string;
  promise: Promise<SampleDataCacheEntry | null>;
}

const AUDIO_ENGINE_ASSET_VERSION = '2026-07-10-midi-channel-inputs';
const WORKLET_URL = `/audio/audio-worklet-wasm.js?v=${AUDIO_ENGINE_ASSET_VERSION}`;
const WASM_URL = `/audio/visual-fm-kernel.wasm?v=${AUDIO_ENGINE_ASSET_VERSION}`;
const METER_UPDATE_INTERVAL_MS = 80;
const RECORDING_CHUNK_FRAMES = 16384;
const RECORDING_CHANNEL_COUNT = 2;
const SCOPE_CAPTURE_POINTS = 512;
const SCOPE_DISPLAY_POINTS = 160;
const SCOPE_SECONDS = 0.08;
const SCOPE_MODE = 'zero-crossing';
const AUDIO_OUTPUT_FADE_SECONDS = 0.02;
const AUDIO_OUTPUT_STOP_DELAY_MS = Math.ceil(AUDIO_OUTPUT_FADE_SECONDS * 1000) + 24;
const AUDIO_SILENCE_PEAK_THRESHOLD = 0.00001;
const AUDIO_UNEXPECTED_SILENCE_MS = 5000;
const AUDIO_SILENCE_REPORT_INTERVAL_MS = 15000;
const AUDIO_HEALTH_REPORT_INTERVAL_MS = 5000;

function closeAudioContext(
  contextRef: { current: AudioContext | null },
  nodeRef: { current: AudioWorkletNode | null },
  analyserRef: { current: AnalyserNode | null },
  outputGainRef: { current: GainNode | null },
  inputSourceRef: { current: MediaStreamAudioSourceNode | null },
  inputStreamRef: { current: MediaStream | null },
  stopTimeoutRef?: { current: number | null },
): void {
  if (stopTimeoutRef && stopTimeoutRef.current !== null) {
    window.clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = null;
  }
  nodeRef.current?.port.postMessage({ type: 'panic' });
  inputSourceRef.current?.disconnect();
  inputStreamRef.current?.getTracks().forEach((track) => track.stop());
  if (nodeRef.current) {
    nodeRef.current.port.onmessage = null;
  }
  if (contextRef.current) {
    contextRef.current.onstatechange = null;
  }
  nodeRef.current?.disconnect();
  analyserRef.current?.disconnect();
  outputGainRef.current?.disconnect();
  void contextRef.current?.close();
  inputSourceRef.current = null;
  inputStreamRef.current = null;
  nodeRef.current = null;
  analyserRef.current = null;
  outputGainRef.current = null;
  contextRef.current = null;
}

function parkAudioContext(
  nodeRef: { current: AudioWorkletNode | null },
  outputGainRef: { current: GainNode | null },
  inputSourceRef: { current: MediaStreamAudioSourceNode | null },
  inputStreamRef: { current: MediaStream | null },
  stopTimeoutRef: { current: number | null },
): void {
  stopTimeoutRef.current = null;
  nodeRef.current?.port.postMessage({ type: 'setMuted', payload: { muted: true } });
  inputSourceRef.current?.disconnect();
  inputStreamRef.current?.getTracks().forEach((track) => track.stop());
  outputGainRef.current?.gain.cancelScheduledValues(0);
  if (outputGainRef.current) {
    outputGainRef.current.gain.value = 0;
  }
  inputSourceRef.current = null;
  inputStreamRef.current = null;
}

function fadeAudioOutputIn(context: AudioContext, gain: GainNode): void {
  const now = context.currentTime;
  holdAudioParamAtCurrentValue(gain.gain, now);
  gain.gain.linearRampToValueAtTime(1, now + AUDIO_OUTPUT_FADE_SECONDS);
}

function fadeAudioOutputOut(context: AudioContext, gain: GainNode): void {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(1, now);
  gain.gain.linearRampToValueAtTime(0, now + AUDIO_OUTPUT_FADE_SECONDS);
}

function holdAudioParamAtCurrentValue(param: AudioParam, time: number): void {
  const holdableParam = param as AudioParam & {
    cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
  };
  if (typeof holdableParam.cancelAndHoldAtTime === 'function') {
    holdableParam.cancelAndHoldAtTime(time);
    return;
  }
  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);
}

export function useAudioEngine(options: UseAudioEngineOptions = {}): AudioEngineState {
  const selectedMidiInputDeviceIds = options.selectedMidiInputDeviceIds ?? [];
  const recordingPatchNameRef = useRef(options.recordingPatchName ?? 'untitled-patch');
  recordingPatchNameRef.current = options.recordingPatchName ?? 'untitled-patch';
  const selectedMidiInputDeviceKey = selectedMidiInputDeviceIds.join('\n');
  const selectedMidiInputDeviceIdSet = useMemo(() => new Set(selectedMidiInputDeviceIds), [selectedMidiInputDeviceKey]);
  const midiInputEnabled = selectedMidiInputDeviceIds.length > 0;
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [message, setMessage] = useState('audio stopped');
  const [peak, setPeak] = useState(0);
  const [linkMeters, setLinkMeters] = useState<Record<string, LinkMeterReading>>({});
  const [linkScopes, setLinkScopeReadings] = useState<Record<string, LinkScopeReading>>({});
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [recordingMessage, setRecordingMessage] = useState('recording stopped');
  const [recordingFileName, setRecordingFileName] = useState<string | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [audioInputStatus, setAudioInputStatus] = useState<AudioInputStatus>('inactive');
  const [audioInputMessage, setAudioInputMessage] = useState('Add an AudioInput node, then start audio.');
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState('');
  const [midiInputStatus, setMidiInputStatus] = useState<MidiInputStatus>('inactive');
  const [midiInputMessage, setMidiInputMessage] = useState('Add a MIDI Note, MIDI CC, or MIDI Tempo source, then start audio.');
  const [midiInputDevices, setMidiInputDevices] = useState<MidiInputDevice[]>([]);
  const [lastMidiControlChange, setLastMidiControlChange] = useState<MidiControlChange | undefined>(undefined);
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const inputRequestIdRef = useRef(0);
  const currentInputDeviceIdRef = useRef('');
  const midiAccessRef = useRef<MidiAccessLike | null>(null);
  const midiRequestRef = useRef<Promise<MidiAccessLike> | null>(null);
  const midiAccessRequestedRef = useRef(false);
  const midiClockTickMsBySourceRef = useRef<Record<number, number>>({});
  const midiClockTempoBySourceRef = useRef<Record<number, number>>({});
  const midiControlChangeIdRef = useRef(0);
  const meterFrameRef = useRef<number | null>(null);
  const lastAudibleAtRef = useRef(0);
  const lastSilenceReportAtRef = useRef(0);
  const lastAudioHealthReportAtRef = useRef(0);
  const graphRef = useRef<DspProgram | null>(null);
  const audioEngineRequestRef = useRef<Promise<void> | null>(null);
  const audioActivationRequestedRef = useRef(false);
  const backendReadyRef = useRef(false);
  const lastSentProgramStructureRef = useRef<string | null>(null);
  const lastSentValuesRef = useRef<number[] | null>(null);
  const activeScopeLinkIdsRef = useRef<string[]>([]);
  const sampleDataKeysRef = useRef<Record<string, string>>({});
  const sampleDataCacheRef = useRef<Record<string, SampleDataCacheEntry>>({});
  const sampleDataRequestRef = useRef<Record<string, SampleDataRequest>>({});
  const recordingRequestedRef = useRef(false);
  const recordingCaptureRef = useRef<RecordingCapture | null>(null);
  const recordingSessionIdRef = useRef(0);
  const recordingSaveIdRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    lastAudibleAtRef.current = 0;
    lastSilenceReportAtRef.current = 0;
    lastAudioHealthReportAtRef.current = 0;
    setPeak(0);
  }, []);

  const startMeter = useCallback(() => {
    stopMeter();
    const analyser = analyserRef.current;
    if (!analyser) return;

    const samples = new Float32Array(analyser.fftSize);
    let lastMeterUpdateAt = 0;
    const tick = (timestamp: number) => {
      analyser.getFloatTimeDomainData(samples);
      let nextPeak = 0;
      for (const sample of samples) {
        nextPeak = Math.max(nextPeak, Math.abs(sample));
      }
      if (
        contextRef.current?.state === 'running' &&
        audioActivationRequestedRef.current &&
        backendReadyRef.current
      ) {
        if (timestamp - lastAudioHealthReportAtRef.current >= AUDIO_HEALTH_REPORT_INTERVAL_MS) {
          lastAudioHealthReportAtRef.current = timestamp;
          logDiagnosticEvent('audio-health', {
            details: {
              contextState: contextRef.current.state,
              contextTime: contextRef.current.currentTime,
              sampleRate: contextRef.current.sampleRate,
              peak: nextPeak,
              graph: dspProgramDiagnosticSnapshot(graphRef.current),
            },
          });
        }
        if (nextPeak > AUDIO_SILENCE_PEAK_THRESHOLD) {
          lastAudibleAtRef.current = timestamp;
        } else if (
          lastAudibleAtRef.current > 0 &&
          timestamp - lastAudibleAtRef.current >= AUDIO_UNEXPECTED_SILENCE_MS &&
          timestamp - lastSilenceReportAtRef.current >= AUDIO_SILENCE_REPORT_INTERVAL_MS
        ) {
          lastSilenceReportAtRef.current = timestamp;
          logDiagnosticEvent('audio-output-silent-after-signal', {
            level: 'warn',
            details: {
              contextState: contextRef.current.state,
              mutedByUi: !audioActivationRequestedRef.current,
              lastAudibleAgoMs: Math.round(timestamp - lastAudibleAtRef.current),
              peak: nextPeak,
              graph: dspProgramDiagnosticSnapshot(graphRef.current),
            },
          });
        }
      }
      if (timestamp - lastMeterUpdateAt >= METER_UPDATE_INTERVAL_MS) {
        lastMeterUpdateAt = timestamp;
        setPeak(nextPeak);
      }
      meterFrameRef.current = window.requestAnimationFrame(tick);
    };
    meterFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopMeter]);

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStartedAtRef.current = 0;
  }, []);

  const appendRecordingChunk = useCallback((payload: unknown) => {
    if (!isRecord(payload)) return;
    const id = Number(payload.id);
    const capture = recordingCaptureRef.current;
    if (!capture || capture.id !== id) return;

    const chunk = recordingChunkFromPayload(payload, capture.channelCount);
    if (!chunk) return;

    capture.chunks.push(chunk);
    capture.frames += chunk[0]?.length ?? 0;
  }, []);

  const completeRecordingCapture = useCallback((id: number) => {
    const capture = recordingCaptureRef.current;
    if (!capture || capture.id !== id) return;

    recordingCaptureRef.current = null;
    const saveId = recordingSaveIdRef.current + 1;
    recordingSaveIdRef.current = saveId;
    const wavBlob = encodeWav(capture.chunks, capture.sampleRate, capture.channelCount);
    logDiagnosticEvent('audio-recording-stopped', {
      details: {
        chunks: capture.chunks.length,
        frames: capture.frames,
        sampleRate: capture.sampleRate,
        channelCount: capture.channelCount,
        bytes: wavBlob.size,
      },
    });
    setRecordingElapsedSeconds(Math.floor(capture.frames / Math.max(1, capture.sampleRate)));
    setRecordingStatus('saving');
    setRecordingMessage('saving recording');

    void uploadRecording(wavBlob, capture.patchName).then((result) => {
      if (recordingSaveIdRef.current !== saveId) return;
      setRecordingStatus('saved');
      setRecordingMessage(`saved ${result.name}`);
      setRecordingFileName(result.name);
    }).catch((error) => {
      if (recordingSaveIdRef.current !== saveId) return;
      setRecordingStatus('error');
      setRecordingMessage(error instanceof Error ? error.message : 'recording save failed');
    });
  }, []);

  const beginRecordingCapture = useCallback((context: AudioContext, node: AudioWorkletNode) => {
    if (recordingCaptureRef.current || context.state !== 'running') return;

    const id = recordingSessionIdRef.current;
    const chunks: Float32Array[][] = [];
    recordingCaptureRef.current = {
      id,
      patchName: recordingPatchNameRef.current,
      chunks,
      channelCount: RECORDING_CHANNEL_COUNT,
      sampleRate: context.sampleRate,
      frames: 0,
      stopping: false,
    };
    node.port.postMessage({
      type: 'startRecording',
      payload: {
        id,
        channelCount: RECORDING_CHANNEL_COUNT,
        chunkFrames: RECORDING_CHUNK_FRAMES,
      },
    });
    logDiagnosticEvent('audio-recording-started', {
      details: {
        id,
        sampleRate: context.sampleRate,
        channelCount: RECORDING_CHANNEL_COUNT,
      },
    });
    stopRecordingTimer();
    recordingStartedAtRef.current = performance.now();
    setRecordingElapsedSeconds(0);
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingElapsedSeconds(Math.floor((performance.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
    setRecordingStatus('recording');
    setRecordingMessage('recording audio');
    setRecordingFileName(null);
  }, [stopRecordingTimer]);

  const finishRecordingCapture = useCallback(() => {
    recordingRequestedRef.current = false;
    stopRecordingTimer();
    const capture = recordingCaptureRef.current;
    if (!capture) {
      setRecordingStatus('idle');
      setRecordingMessage('recording stopped');
      setRecordingElapsedSeconds(0);
      return;
    }

    if (capture.stopping) return;

    capture.stopping = true;
    setRecordingStatus('saving');
    setRecordingMessage('finalizing recording');
    const node = nodeRef.current;
    if (node && contextRef.current?.state !== 'closed') {
      node.port.postMessage({ type: 'stopRecording', payload: { id: capture.id } });
      return;
    }

    completeRecordingCapture(capture.id);
  }, [completeRecordingCapture, stopRecordingTimer]);

  const startRecording = useCallback(() => {
    if (recordingCaptureRef.current) {
      setRecordingStatus('saving');
      setRecordingMessage('finalizing recording');
      return;
    }
    recordingSessionIdRef.current += 1;
    recordingSaveIdRef.current += 1;
    recordingRequestedRef.current = true;
    setRecordingFileName(null);
    setRecordingElapsedSeconds(0);
    const context = contextRef.current;
    const node = nodeRef.current;
    if (context?.state === 'running' && node) {
      beginRecordingCapture(context, node);
      return;
    }

    setRecordingStatus('waiting');
    setRecordingMessage('waiting for audio to start');
  }, [beginRecordingCapture]);

  const stopRecording = useCallback(() => {
    finishRecordingCapture();
  }, [finishRecordingCapture]);

  const refreshAudioInputDevices = useCallback(async () => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) {
      setAudioInputDevices((current) => current.length === 0 ? current : []);
      return;
    }

    try {
      const devices = await mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Input ${index + 1}`,
        }));
      setAudioInputDevices(audioInputs);
      setSelectedAudioInputDeviceId((current) => {
        if (!current) return current;
        return audioInputs.some((device) => device.deviceId === current) ? current : '';
      });
    } catch {
      setAudioInputDevices((current) => current.length === 0 ? current : []);
    }
  }, []);

  const disconnectAudioInput = useCallback((nextStatus: AudioInputStatus = 'inactive', nextMessage = 'Audio input is not used by this patch.') => {
    inputRequestIdRef.current += 1;
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    currentInputDeviceIdRef.current = '';
    setAudioInputStatus(nextStatus);
    setAudioInputMessage(nextMessage);
  }, []);

  const updateMidiInputDevices = useCallback((midiAccess: MidiAccessLike): MidiInputDevice[] => {
    const inputs = [...midiAccess.inputs.values()];
    const devices = inputs.map(midiInputDeviceFromInput);
    setMidiInputDevices((current) => midiInputDevicesEqual(current, devices) ? current : devices);
    return devices;
  }, []);

  const disconnectMidiInput = useCallback((nextStatus: MidiInputStatus = 'inactive', nextMessage = 'MIDI input is not used by this patch.') => {
    const midiAccess = midiAccessRef.current;
    if (midiAccess) {
      midiAccess.onstatechange = null;
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    midiAccessRef.current = null;
    midiRequestRef.current = null;
    setMidiInputDevices((current) => current.length === 0 ? current : []);
    setMidiInputStatus(nextStatus);
    setMidiInputMessage(nextMessage);
  }, []);

  const attachMidiInputs = useCallback((midiAccess: MidiAccessLike, node: AudioWorkletNode | null) => {
    const devices = updateMidiInputDevices(midiAccess);
    const selectedConnectedCount = devices.filter((device) => selectedMidiInputDeviceIdSet.has(device.id)).length;
    setMidiInputStatus(devices.length > 0 ? 'connected' : 'unsupported');
    setMidiInputMessage(midiInputStatusMessage(devices.length, selectedMidiInputDeviceIds.length, selectedConnectedCount));

    const handleMidiClock = (sourceIndex: number, event: { timeStamp?: number }) => {
      const graph = graphRef.current;
      if (!node || !programUsesMidiClock(graph)) return;

      const activeSources = activeMidiClockSourceIndexes(graph);
      if (activeSources.size > 0 && !activeSources.has(0) && !activeSources.has(sourceIndex)) return;

      const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : performance.now();
      const previous = midiClockTickMsBySourceRef.current[sourceIndex];
      midiClockTickMsBySourceRef.current[sourceIndex] = now;
      if (!Number.isFinite(previous) || previous <= 0 || now <= previous) return;

      const intervalMs = now - previous;
      const measuredBpm = 60_000 / (intervalMs * MIDI_CLOCK_TICKS_PER_BEAT);
      if (!Number.isFinite(measuredBpm)) return;

      const previousTempo = midiClockTempoBySourceRef.current[sourceIndex] || measuredBpm;
      const bpm = clampNumber(
        previousTempo + (measuredBpm - previousTempo) * MIDI_CLOCK_EMA_WEIGHT,
        MIDI_CLOCK_TEMPO_MIN,
        MIDI_CLOCK_TEMPO_MAX,
      );
      midiClockTempoBySourceRef.current[sourceIndex] = bpm;
      node.port.postMessage({ type: 'midiClockTempo', payload: { sourceIndex, bpm } });
    };

    const handleMidiMessage = (sourceIndex: number, event: { data: ArrayLike<number>; timeStamp?: number }) => {
      const status = Number(event.data[0] ?? 0);
      if (status === 0xf8) {
        handleMidiClock(sourceIndex, event);
        return;
      }
      if (status === 0xfa || status === 0xfb || status === 0xfc) {
        delete midiClockTickMsBySourceRef.current[sourceIndex];
        delete midiClockTempoBySourceRef.current[sourceIndex];
        return;
      }
      const data1 = Number(event.data[1] ?? 0);
      const data2 = Number(event.data[2] ?? 0);
      const command = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      if (command === 0x90 && data2 > 0) {
        node?.port.postMessage({ type: 'noteOn', payload: { channel, note: data1, velocity: data2 / 127 } });
        return;
      }
      if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        node?.port.postMessage({ type: 'noteOff', payload: { channel, note: data1 } });
        return;
      }
      if (command === 0xb0) {
        const value = data2 / 127;
        setLastMidiControlChange({
          id: midiControlChangeIdRef.current + 1,
          sourceIndex,
          channel,
          cc: data1,
          value,
          receivedAt: Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : performance.now(),
        });
        midiControlChangeIdRef.current += 1;
        node?.port.postMessage({ type: 'midiCc', payload: { channel, cc: data1, value } });
      }
    };

    for (const [index, input] of [...midiAccess.inputs.values()].entries()) {
      const sourceIndex = index + 1;
      const device = midiInputDeviceFromInput(input, index);
      input.onmidimessage = selectedMidiInputDeviceIdSet.has(device.id)
        ? (event) => handleMidiMessage(sourceIndex, event)
        : null;
    }
    midiAccess.onstatechange = () => attachMidiInputs(
      midiAccess,
      graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null,
    );
  }, [selectedMidiInputDeviceIdSet, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey, updateMidiInputDevices]);

  const refreshMidiInputDevices = useCallback(async () => {
    const navigatorWithMidi = navigator as Navigator & {
      requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
    };
    if (!navigatorWithMidi.requestMIDIAccess) {
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiInputStatus('unsupported');
      setMidiInputMessage('MIDI input is unavailable in this browser.');
      return;
    }

    midiAccessRequestedRef.current = true;
    if (midiAccessRef.current) {
      attachMidiInputs(
        midiAccessRef.current,
        graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null,
      );
      return;
    }

    setMidiInputStatus('requesting');
    setMidiInputMessage('Requesting MIDI permission...');
    try {
      const midiAccess = await navigatorWithMidi.requestMIDIAccess({ sysex: false }) as MidiAccessLike;
      midiAccessRef.current = midiAccess;
      attachMidiInputs(
        midiAccess,
        graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null,
      );
    } catch (error) {
      setMidiInputStatus(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'error');
      setMidiInputMessage(error instanceof Error ? error.message : 'MIDI permission was denied.');
      setMidiInputDevices((current) => current.length === 0 ? current : []);
    }
  }, [attachMidiInputs]);

  const syncAudioInput = useCallback((graph: DspProgram, context: AudioContext, node: AudioWorkletNode) => {
    if (!programUsesAudioInput(graph)) {
      disconnectAudioInput();
      return;
    }

    if (inputSourceRef.current && currentInputDeviceIdRef.current === selectedAudioInputDeviceId) return;
    if (inputSourceRef.current) {
      disconnectAudioInput('requesting', 'Switching audio input device...');
    }

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setAudioInputStatus('unsupported');
      setAudioInputMessage('Audio input is unavailable in this browser.');
      setMessage('audio input unavailable: this browser does not expose getUserMedia');
      return;
    }

    setAudioInputStatus('requesting');
    setAudioInputMessage(selectedAudioInputDeviceId
      ? `Requesting ${audioInputDeviceLabel(audioInputDevices, selectedAudioInputDeviceId)}...`
      : 'Requesting microphone permission...');
    const requestId = inputRequestIdRef.current + 1;
    inputRequestIdRef.current = requestId;
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(selectedAudioInputDeviceId ? { deviceId: { exact: selectedAudioInputDeviceId } } : {}),
    };
    void mediaDevices.getUserMedia({
      audio: audioConstraints,
    }).then((stream) => {
      const stillCurrent = (
        inputRequestIdRef.current === requestId &&
        contextRef.current === context &&
        nodeRef.current === node &&
        graphRef.current &&
        programUsesAudioInput(graphRef.current)
      );
      if (!stillCurrent) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      inputStreamRef.current = stream;
      inputSourceRef.current = source;
      const track = stream.getAudioTracks()[0] ?? null;
      track?.addEventListener('ended', () => {
        logDiagnosticEvent('audio-input-track-ended', {
          level: 'warn',
          details: {
            label: track.label,
            readyState: track.readyState,
            settings: track.getSettings(),
          },
        });
      });
      const connectedDeviceId = track?.getSettings().deviceId ?? selectedAudioInputDeviceId;
      currentInputDeviceIdRef.current = selectedAudioInputDeviceId;
      setAudioInputStatus('connected');
      setAudioInputMessage(`${track?.label || audioInputDeviceLabel(audioInputDevices, connectedDeviceId) || 'Audio input'} connected.`);
      void refreshAudioInputDevices();
      setMessage(`WASM audio ${context.state} (${AUDIO_ENGINE_ASSET_VERSION})`);
    }).catch((error) => {
      logDiagnosticEvent('audio-input-error', {
        level: 'warn',
        details: {
          error: serializeError(error),
        },
      });
      if (inputRequestIdRef.current !== requestId) return;
      const errorName = error instanceof DOMException ? error.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        setAudioInputStatus('denied');
        setAudioInputMessage('Microphone permission was denied. Allow microphone access for this site and try again.');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setAudioInputStatus('unsupported');
        setAudioInputMessage('No microphone or audio input device was found.');
      } else if (errorName === 'OverconstrainedError') {
        setAudioInputStatus('error');
        setAudioInputMessage('The selected input device is unavailable. Choose another input.');
        setSelectedAudioInputDeviceId('');
      } else {
        setAudioInputStatus('error');
        setAudioInputMessage(error instanceof Error ? error.message : 'Audio input failed.');
      }
      void refreshAudioInputDevices();
      setMessage(`audio input unavailable: ${error instanceof Error ? error.message : 'permission denied'}`);
    });
  }, [audioInputDevices, disconnectAudioInput, refreshAudioInputDevices, selectedAudioInputDeviceId]);

  const syncGraphSamples = useCallback((graph: DspProgram, context: AudioContext, node: AudioWorkletNode) => {
    const nextKeys: Record<string, string> = {};

    for (const binding of graph.sampleBindings) {
      const sampleUrl = binding.sample.url.trim();
      if (!sampleUrl) continue;

      const sampleName = binding.sample.name;
      const sampleKey = `${sampleUrl}\n${sampleName}`;
      nextKeys[binding.nodeId] = sampleKey;
      if (sampleDataKeysRef.current[binding.nodeId] === sampleKey) continue;

      sampleDataKeysRef.current[binding.nodeId] = sampleKey;
      void loadAndPostSampleData(
        context,
        node,
        binding.nodeId,
        sampleUrl,
        sampleName,
        sampleKey,
        sampleDataKeysRef,
        sampleDataCacheRef,
        sampleDataRequestRef,
      )
        .catch(() => {
          if (sampleDataKeysRef.current[binding.nodeId] === sampleKey) {
            delete sampleDataKeysRef.current[binding.nodeId];
          }
        });
    }

    for (const nodeId of Object.keys(sampleDataKeysRef.current)) {
      if (nextKeys[nodeId]) continue;
      delete sampleDataKeysRef.current[nodeId];
      node.port.postMessage({ type: 'sampleData', payload: { nodeId, data: [], sampleRate: context.sampleRate, name: '', storageKey: '' } });
    }
  }, []);

  const preloadGraphSamples = useCallback((graph: DspProgram) => {
    const nextKeys: Record<string, string> = {};

    for (const binding of graph.sampleBindings) {
      const sampleUrl = binding.sample.url.trim();
      if (!sampleUrl) continue;

      const sampleName = binding.sample.name;
      const sampleKey = `${sampleUrl}\n${sampleName}`;
      nextKeys[binding.nodeId] = sampleKey;
      void loadCachedSampleData(
        binding.nodeId,
        sampleUrl,
        sampleName,
        sampleKey,
        sampleDataCacheRef,
        sampleDataRequestRef,
      ).catch(() => undefined);
    }

    for (const nodeId of Object.keys(sampleDataCacheRef.current)) {
      if (nextKeys[nodeId] === sampleDataCacheRef.current[nodeId]?.key) continue;
      delete sampleDataCacheRef.current[nodeId];
    }
    for (const nodeId of Object.keys(sampleDataRequestRef.current)) {
      if (nextKeys[nodeId] === sampleDataRequestRef.current[nodeId]?.key) continue;
      delete sampleDataRequestRef.current[nodeId];
    }
  }, []);

  const syncMidiInput = useCallback((graph: DspProgram, node: AudioWorkletNode) => {
    if (!programUsesMidi(graph) && !midiInputEnabled && !midiAccessRequestedRef.current) {
      disconnectMidiInput();
      return;
    }

    const navigatorWithMidi = navigator as Navigator & {
      requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
    };
    if (!navigatorWithMidi.requestMIDIAccess) {
      setMidiInputStatus('unsupported');
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiInputMessage('MIDI input is unavailable in this browser.');
      setMessage('MIDI input unavailable: this browser does not expose Web MIDI');
      return;
    }

    if (midiAccessRef.current) {
      attachMidiInputs(midiAccessRef.current, node);
      return;
    }

    if (!midiRequestRef.current) {
      setMidiInputStatus('requesting');
      setMidiInputMessage('Requesting MIDI permission...');
      midiRequestRef.current = navigatorWithMidi
        .requestMIDIAccess({ sysex: false })
        .then((midiAccess) => midiAccess as MidiAccessLike);
    }

    const midiRequest = midiRequestRef.current as Promise<MidiAccessLike>;
    void midiRequest.then((midiAccess) => {
      midiAccessRef.current = midiAccess;
      attachMidiInputs(midiAccess, node);
    }).catch((error) => {
      setMidiInputStatus(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'error');
      setMidiInputMessage(error instanceof Error ? error.message : 'MIDI permission was denied.');
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMessage(`MIDI input unavailable: ${error instanceof Error ? error.message : 'permission denied'}`);
      midiRequestRef.current = null;
    });
  }, [attachMidiInputs, disconnectMidiInput, midiInputEnabled]);

  const activateAudioEngine = useCallback(async () => {
    const context = contextRef.current;
    const node = nodeRef.current;
    const outputGain = outputGainRef.current;
    const analyser = analyserRef.current;
    if (!context || !node || !outputGain) return;

    audioActivationRequestedRef.current = true;
    logDiagnosticEvent('audio-activation-requested', {
      details: {
        contextState: context.state,
        graph: dspProgramDiagnosticSnapshot(graphRef.current),
      },
    });
    await resumeAudioContext(context);
    node.port.postMessage({ type: 'setMuted', payload: { muted: false } });
    fadeAudioOutputIn(context, outputGain);

    if (graphRef.current) {
      syncGraphSamples(graphRef.current, context, node);
      syncAudioInput(graphRef.current, context, node);
      syncMidiInput(graphRef.current, node);
    }

    setStatus(context.state === 'running' ? 'running' : 'idle');
    setMessage(`audio context ${context.state}`);
    if (context.state === 'running') {
      logDiagnosticEvent('audio-context-running', {
        details: {
          sampleRate: context.sampleRate,
          baseLatency: context.baseLatency,
          outputLatency: audioContextOutputLatency(context),
          graph: dspProgramDiagnosticSnapshot(graphRef.current),
        },
      });
      startMeter();
      if (recordingRequestedRef.current && node) {
        beginRecordingCapture(context, node);
      }
    }
  }, [beginRecordingCapture, startMeter, syncAudioInput, syncGraphSamples, syncMidiInput]);

  const ensureAudioEngine = useCallback(async (activate: boolean) => {
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    if (activate) {
      audioActivationRequestedRef.current = true;
      setStatus('starting');
      setMessage(backendReadyRef.current ? 'starting audio' : 'preparing audio');
    }

    if (nodeRef.current && contextRef.current) {
      if (activate) {
        await activateAudioEngine();
      }
      return;
    }

    if (!audioEngineRequestRef.current) {
      audioEngineRequestRef.current = (async () => {
        try {
          if (!activate) {
            setMessage('preparing audio');
          }

          backendReadyRef.current = false;
          const context = new AudioContext();
          logDiagnosticEvent('audio-context-created', {
            details: {
              sampleRate: context.sampleRate,
              baseLatency: context.baseLatency,
              outputLatency: audioContextOutputLatency(context),
              state: context.state,
            },
          });
          const wasmBytes = await fetch(WASM_URL, { cache: 'no-store' }).then((response) => {
            if (!response.ok) {
              throw new Error(`Could not load WASM kernel (${response.status}).`);
            }
            return response.arrayBuffer();
          });
          await context.audioWorklet.addModule(WORKLET_URL);
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          const outputGain = context.createGain();
          outputGain.gain.value = 0;
          const node = new AudioWorkletNode(context, 'visual-fm-wasm-engine', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { wasmBytes, audioConfig: AUDIO_ENGINE_CONFIG },
          });
          node.addEventListener('processorerror', () => {
            logDiagnosticEvent('audio-worklet-processor-error', {
              level: 'error',
              details: {
                contextState: context.state,
                graph: dspProgramDiagnosticSnapshot(graphRef.current),
              },
            });
          });

          node.port.onmessage = (event) => {
            const { type, payload } = event.data || {};
            if (type === 'backendStatus') {
              backendReadyRef.current = Boolean(payload?.ready);
              logDiagnosticEvent('audio-backend-status', {
                level: payload?.ready ? 'info' : 'error',
                details: {
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current),
                },
              });
              if (payload?.ready) {
                if (audioActivationRequestedRef.current && context.state === 'running') {
                  fadeAudioOutputIn(context, outputGain);
                  setStatus('running');
                  setMessage(`WASM audio ${context.state} (${AUDIO_ENGINE_ASSET_VERSION})`);
                } else {
                  setStatus((current) => current === 'starting' ? current : 'idle');
                  setMessage('audio ready');
                }
              } else {
                setStatus('error');
                setMessage(payload?.error || 'WASM audio failed');
              }
              return;
            }
            if (type === 'processorError') {
              logDiagnosticEvent('audio-worklet-runtime-error', {
                level: 'error',
                details: {
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current),
                },
              });
              return;
            }
            if (type === 'recordingStarted') {
              logDiagnosticEvent('audio-recording-worklet-started', {
                details: {
                  payload,
                  contextState: context.state,
                },
              });
              return;
            }
            if (type === 'recordingChunk') {
              appendRecordingChunk(payload);
              return;
            }
            if (type === 'recordingStopped') {
              const id = Number(payload?.id);
              if (Number.isFinite(id)) {
                completeRecordingCapture(id);
              }
              return;
            }
            if (type === 'linkMeters') {
              setLinkMeters(linkMetersFromPayload(payload));
              return;
            }
            if (type === 'linkScope') {
              const id = typeof payload?.id === 'string' ? payload.id : null;
              if (!id) return;
              setLinkScopeReadings((current) => ({
                ...current,
                [id]: {
                  mode: typeof payload?.mode === 'string' ? payload.mode : 'continuous',
                  samples: Array.isArray(payload?.samples) ? payload.samples.map(Number).filter(Number.isFinite) : [],
                },
              }));
            }
          };
          context.onstatechange = () => {
            const contextState = context.state as string;
            logDiagnosticEvent('audio-context-state-change', {
              level: contextState === 'interrupted' || contextState === 'closed' ? 'warn' : 'info',
              details: {
                state: contextState,
                sampleRate: context.sampleRate,
                baseLatency: context.baseLatency,
                outputLatency: audioContextOutputLatency(context),
              },
            });
            setMessage((current) => current.replace(/(audio|context) (running|suspended|interrupted|closed)/, `$1 ${context.state}`));
            if (recordingRequestedRef.current && context.state === 'running') {
              beginRecordingCapture(context, node);
            }
          };

          node.connect(analyser);
          analyser.connect(outputGain);
          outputGain.connect(context.destination);
          node.port.postMessage({ type: 'setMuted', payload: { muted: true } });
          contextRef.current = context;
          nodeRef.current = node;
          analyserRef.current = analyser;
          outputGainRef.current = outputGain;

          if (graphRef.current) {
            sampleDataKeysRef.current = {};
            lastSentProgramStructureRef.current = dspProgramStructureKey(graphRef.current);
            lastSentValuesRef.current = [...graphRef.current.values];
            node.port.postMessage({ type: 'dspProgram', payload: graphRef.current });
            syncGraphSamples(graphRef.current, context, node);
          }
          if (activeScopeLinkIdsRef.current.length > 0) {
            node.port.postMessage({
              type: 'setLinkScopes',
              payload: scopePayload(activeScopeLinkIdsRef.current),
            });
          }
        } catch (error) {
          logDiagnosticEvent('audio-engine-start-error', {
            level: 'error',
            details: {
              error: serializeError(error),
              graph: dspProgramDiagnosticSnapshot(graphRef.current),
            },
          });
          if (activate) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : 'audio failed');
          } else {
            setMessage('audio stopped');
          }
          closeAudioContext(contextRef, nodeRef, analyserRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
          backendReadyRef.current = false;
          throw error;
        } finally {
          audioEngineRequestRef.current = null;
        }
      })();
    }

    try {
      await audioEngineRequestRef.current;
    } catch {
      if (!activate) return;
      throw new Error('audio failed');
    }

    if (activate) {
      await activateAudioEngine();
    }
  }, [activateAudioEngine, appendRecordingChunk, beginRecordingCapture, completeRecordingCapture, syncGraphSamples]);

  const syncGraph = useCallback((graph: DspProgram) => {
    graphRef.current = graph;
    preloadGraphSamples(graph);
    if (!nodeRef.current || !contextRef.current) {
      if (programUsesAudioInput(graph)) {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          setAudioInputStatus('unsupported');
          setAudioInputMessage('Audio input is unavailable in this browser.');
        } else {
          setAudioInputStatus('needs-permission');
          setAudioInputMessage('Start audio to request microphone access.');
          void refreshAudioInputDevices();
        }
      } else {
        disconnectAudioInput();
      }
      if (programUsesMidi(graph) || midiInputEnabled || midiAccessRequestedRef.current) {
        const navigatorWithMidi = navigator as Navigator & {
          requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
        };
        if (!navigatorWithMidi.requestMIDIAccess) {
          setMidiInputStatus('unsupported');
          setMidiInputDevices((current) => current.length === 0 ? current : []);
          setMidiInputMessage('MIDI input is unavailable in this browser.');
        } else if (midiAccessRef.current) {
          const devices = updateMidiInputDevices(midiAccessRef.current);
          const selectedConnectedCount = devices.filter((device) => selectedMidiInputDeviceIdSet.has(device.id)).length;
          setMidiInputStatus(devices.length > 0 ? 'connected' : 'unsupported');
          setMidiInputMessage(midiInputStatusMessage(devices.length, selectedMidiInputDeviceIds.length, selectedConnectedCount));
        } else {
          setMidiInputStatus('needs-permission');
          setMidiInputMessage(midiInputEnabled || midiAccessRequestedRef.current
            ? 'Open MIDI settings to request browser MIDI access.'
            : 'Start audio or refresh MIDI to request browser MIDI access.');
        }
      } else {
        disconnectMidiInput();
      }
      return;
    }
    const shouldSyncExternalInputs = audioActivationRequestedRef.current;
    const structureKey = dspProgramStructureKey(graph);
    if (
      lastSentProgramStructureRef.current === structureKey
      && arraysEqual(lastSentValuesRef.current, graph.values)
    ) {
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      if (shouldSyncExternalInputs) {
        syncAudioInput(graph, contextRef.current, nodeRef.current);
        syncMidiInput(graph, nodeRef.current);
      }
      return;
    }

    if (lastSentProgramStructureRef.current === structureKey) {
      lastSentValuesRef.current = [...graph.values];
      nodeRef.current.port.postMessage({ type: 'dspValues', payload: { values: graph.values } });
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      if (shouldSyncExternalInputs) {
        syncAudioInput(graph, contextRef.current, nodeRef.current);
        syncMidiInput(graph, nodeRef.current);
      }
      return;
    }

    lastSentProgramStructureRef.current = structureKey;
    lastSentValuesRef.current = [...graph.values];
    nodeRef.current.port.postMessage({ type: 'dspProgram', payload: graph });
    syncGraphSamples(graph, contextRef.current, nodeRef.current);
    if (shouldSyncExternalInputs) {
      syncAudioInput(graph, contextRef.current, nodeRef.current);
      syncMidiInput(graph, nodeRef.current);
    }
    nodeRef.current.port.postMessage({
      type: 'setLinkScopes',
      payload: activeScopeLinkIdsRef.current.length > 0
        ? scopePayload(activeScopeLinkIdsRef.current)
        : {},
    });
  }, [disconnectAudioInput, disconnectMidiInput, ensureAudioEngine, midiInputEnabled, preloadGraphSamples, refreshAudioInputDevices, selectedMidiInputDeviceIdSet, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey, syncAudioInput, syncGraphSamples, syncMidiInput, updateMidiInputDevices]);

  const setLinkScopes = useCallback((linkIds: string[]) => {
    const nextLinkIds = uniqueScopeLinkIds(linkIds);
    if (stringArraysEqual(activeScopeLinkIdsRef.current, nextLinkIds)) return;

    activeScopeLinkIdsRef.current = nextLinkIds;
    nodeRef.current?.port.postMessage({
      type: 'setLinkScopes',
      payload: activeScopeLinkIdsRef.current.length > 0
        ? scopePayload(activeScopeLinkIdsRef.current)
        : {},
    });
  }, []);

  const start = useCallback(async () => {
    try {
      logDiagnosticEvent('audio-start-clicked', {
        details: {
          graph: dspProgramDiagnosticSnapshot(graphRef.current),
        },
      });
      await ensureAudioEngine(true);
    } catch (error) {
      logDiagnosticEvent('audio-start-error', {
        level: 'error',
        details: {
          error: serializeError(error),
          graph: dspProgramDiagnosticSnapshot(graphRef.current),
        },
      });
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'audio failed');
    }
  }, [ensureAudioEngine]);

  const stop = useCallback(() => {
    logDiagnosticEvent('audio-stop-clicked', {
      details: {
        contextState: contextRef.current?.state ?? 'none',
        graph: dspProgramDiagnosticSnapshot(graphRef.current),
      },
    });
    audioActivationRequestedRef.current = false;
    finishRecordingCapture();
    const context = contextRef.current;
    const outputGain = outputGainRef.current;
    if (context && outputGain && context.state !== 'closed') {
      fadeAudioOutputOut(context, outputGain);
      if (stopTimeoutRef.current !== null) {
        window.clearTimeout(stopTimeoutRef.current);
      }
      stopTimeoutRef.current = window.setTimeout(() => {
        closeAudioContext(contextRef, nodeRef, analyserRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
        backendReadyRef.current = false;
        lastSentProgramStructureRef.current = null;
        lastSentValuesRef.current = null;
        setLinkMeters({});
        setLinkScopeReadings({});
      }, AUDIO_OUTPUT_STOP_DELAY_MS);
    } else {
      closeAudioContext(contextRef, nodeRef, analyserRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
      setLinkMeters({});
      setLinkScopeReadings({});
    }
    if ((midiInputEnabled || midiAccessRequestedRef.current) && midiAccessRef.current) {
      attachMidiInputs(midiAccessRef.current, null);
    } else {
      disconnectMidiInput();
    }
    inputRequestIdRef.current += 1;
    currentInputDeviceIdRef.current = '';
    stopMeter();
    setLinkMeters({});
    setLinkScopeReadings({});
    setStatus('idle');
    setMessage('audio stopped');
    setAudioInputStatus(programUsesAudioInput(graphRef.current) ? 'needs-permission' : 'inactive');
    setAudioInputMessage(programUsesAudioInput(graphRef.current)
      ? 'Start audio to request microphone access.'
      : 'Audio input is not used by this patch.');
    setMidiInputStatus(programUsesMidi(graphRef.current) || midiInputEnabled || midiAccessRequestedRef.current ? 'needs-permission' : 'inactive');
    setMidiInputMessage(programUsesMidi(graphRef.current) || midiInputEnabled || midiAccessRequestedRef.current
      ? 'Open MIDI settings to request browser MIDI access.'
      : 'MIDI input is not used by this patch.');
    if (!midiInputEnabled && !midiAccessRequestedRef.current) {
      setMidiInputDevices((current) => current.length === 0 ? current : []);
    }
  }, [attachMidiInputs, disconnectMidiInput, finishRecordingCapture, midiInputEnabled, stopMeter]);

  useEffect(() => {
    if (!midiAccessRef.current) return;
    attachMidiInputs(
      midiAccessRef.current,
      graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null,
    );
  }, [attachMidiInputs]);

  useEffect(() => () => {
    audioActivationRequestedRef.current = false;
    finishRecordingCapture();
    stopMeter();
    closeAudioContext(contextRef, nodeRef, analyserRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
    disconnectMidiInput();
  }, [disconnectMidiInput, finishRecordingCapture, stopMeter]);

  useEffect(() => {
    void refreshAudioInputDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshAudioInputDevices]);

  const audioInput: AudioInputState = useMemo(() => ({
    status: audioInputStatus,
    message: audioInputMessage,
    devices: audioInputDevices,
    selectedDeviceId: selectedAudioInputDeviceId,
    canSelectDevice: Boolean(navigator.mediaDevices?.enumerateDevices),
  }), [audioInputDevices, audioInputMessage, audioInputStatus, selectedAudioInputDeviceId]);
  const midiInput: MidiInputState = useMemo(() => ({
    status: midiInputStatus,
    message: midiInputMessage,
    devices: midiInputDevices,
    canRequestAccess: Boolean((navigator as Navigator & {
      requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
    }).requestMIDIAccess),
    lastControlChange: lastMidiControlChange,
  }), [lastMidiControlChange, midiInputDevices, midiInputMessage, midiInputStatus]);
  const recording: RecordingState = useMemo(() => ({
    status: recordingStatus,
    message: recordingMessage,
    fileName: recordingFileName,
    elapsedSeconds: recordingElapsedSeconds,
  }), [recordingElapsedSeconds, recordingFileName, recordingMessage, recordingStatus]);

  return {
    status,
    message,
    peak,
    linkMeters,
    linkScopes,
    recording,
    audioInput,
    midiInput,
    start,
    stop,
    startRecording,
    stopRecording,
    syncGraph,
    setLinkScopes,
    setAudioInputDeviceId: setSelectedAudioInputDeviceId,
    refreshAudioInputDevices,
    refreshMidiInputDevices,
  };
}

function encodeWav(chunks: Float32Array[][], sampleRate: number, channelCount: number): Blob {
  const frameCount = chunks.reduce((total, chunk) => total + (chunk[0]?.length ?? 0), 0);
  const bytesPerSample = 2;
  const dataByteLength = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (const chunk of chunks) {
    const frames = chunk[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelSamples = chunk[channel] ?? chunk[0];
        const sample = Math.max(-1, Math.min(1, channelSamples?.[frame] ?? 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function recordingChunkFromPayload(payload: Record<string, unknown>, channelCount: number): Float32Array[] | null {
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const firstChannel = float32ArrayFromUnknown(channels[0]);
  if (!firstChannel || firstChannel.length === 0) return null;

  const frameCount = firstChannel.length;
  const output: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = float32ArrayFromUnknown(channels[channel]) ?? firstChannel;
    output.push(source.length === frameCount ? source : source.slice(0, frameCount));
  }
  return output;
}

function float32ArrayFromUnknown(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) {
    return Float32Array.from(value.map((sample) => {
      const numeric = Number(sample);
      return Number.isFinite(numeric) ? numeric : 0;
    }));
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value) {
    return Float32Array.from(Array.from(value as unknown as ArrayLike<number>, (sample) => {
      const numeric = Number(sample);
      return Number.isFinite(numeric) ? numeric : 0;
    }));
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function uploadRecording(blob: Blob, patchName: string): Promise<{ name: string }> {
  const response = await fetch('/api/recordings', {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav',
      'X-Visual-Fm-Patch-Name': patchName,
    },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(await response.text() || `Recording save failed (${response.status}).`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || typeof payload.name !== 'string') {
    throw new Error('Recording save returned an invalid response.');
  }
  return { name: payload.name };
}

function scopePayload(linkIds: string[]) {
  return {
    linkIds,
    points: SCOPE_CAPTURE_POINTS,
    displayPoints: SCOPE_DISPLAY_POINTS,
    seconds: SCOPE_SECONDS,
    mode: SCOPE_MODE,
  };
}

function dspProgramStructureKey(program: DspProgram): string {
  return JSON.stringify({
    version: program.version,
    ops: program.ops,
    valueBindings: program.valueBindings,
    midiControlBindings: program.midiControlBindings,
    tempoBindings: program.tempoBindings,
    stateBindings: program.stateBindings,
    registerCount: program.registerCount,
    stateCount: program.stateCount,
    feedbackLinkIds: program.feedbackLinkIds,
    monitorIds: program.monitorIds,
    sampleBindings: program.sampleBindings,
    customWaveBindings: program.customWaveBindings,
    maxVoices: program.maxVoices,
    usesMidiNote: program.usesMidiNote,
    usesMidiClock: program.usesMidiClock,
    errors: program.errors,
  });
}

function arraysEqual(left: number[] | null, right: number[]): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function uniqueScopeLinkIds(linkIds: string[]): string[] {
  return [...new Set(linkIds.map((id) => String(id)).filter(Boolean))];
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function programUsesAudioInput(program: DspProgram | null): boolean {
  return Boolean(program?.ops.some((op) => op.opcode === DSP_OP.Input));
}

function audioInputDeviceLabel(devices: AudioInputDevice[], deviceId: string): string {
  return devices.find((device) => device.deviceId === deviceId)?.label ?? '';
}

function midiInputDeviceFromInput(input: MidiInputLike, index: number): MidiInputDevice {
  const name = input.name?.trim();
  const manufacturer = input.manufacturer?.trim();
  return {
    id: input.id || `${manufacturer || 'midi'}-${name || index}`,
    label: [manufacturer, name].filter(Boolean).join(' ') || `MIDI input ${index + 1}`,
    state: input.state || 'connected',
  };
}

function midiInputDevicesEqual(left: MidiInputDevice[], right: MidiInputDevice[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((device, index) => (
    device.id === right[index]?.id &&
    device.label === right[index]?.label &&
    device.state === right[index]?.state
  ));
}

function midiInputStatusMessage(deviceCount: number, selectedCount: number, selectedConnectedCount: number): string {
  if (deviceCount === 0) {
    return 'MIDI permission is granted, but no input devices were found.';
  }
  if (selectedCount === 0) {
    return `${deviceCount} MIDI input${deviceCount === 1 ? '' : 's'} available. Select inputs in MIDI settings.`;
  }
  if (selectedConnectedCount === 0) {
    return 'Selected MIDI input is not currently available.';
  }
  return `${selectedConnectedCount} of ${deviceCount} MIDI input${deviceCount === 1 ? '' : 's'} selected.`;
}

function programUsesMidi(program: DspProgram | null): boolean {
  return Boolean(
    program?.ops.some((op) => op.opcode === DSP_OP.MidiNote || op.opcode === DSP_OP.MidiCc) ||
    (program?.midiControlBindings.length ?? 0) > 0 ||
    programUsesMidiClock(program)
  );
}

function programUsesMidiClock(program: DspProgram | null): boolean {
  return Boolean(program?.usesMidiClock);
}

function activeMidiClockSourceIndexes(program: DspProgram | null): Set<number> {
  const indexes = new Set<number>();
  if (!program?.usesMidiClock) return indexes;

  for (const binding of program.tempoBindings) {
    const source = Math.round(program.values[binding.sourceValueIndex] ?? 0);
    if (source !== 1) continue;
    indexes.add(Math.max(0, Math.round(program.values[binding.midiSourceValueIndex] ?? 0)));
  }
  return indexes;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function resumeAudioContext(context: AudioContext): Promise<void> {
  if (context.state === 'running') return;

  await Promise.race([
    context.resume().then(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 350);
    }),
  ]);
}

function linkMetersFromPayload(payload: unknown): Record<string, LinkMeterReading> {
  const levels = (payload as { levels?: unknown })?.levels;
  if (!Array.isArray(levels)) return {};

  const readings: Record<string, LinkMeterReading> = {};
  for (const entry of levels) {
    if (!Array.isArray(entry)) continue;
    const [id, input, output, envelope] = entry;
    if (typeof id !== 'string') continue;
    readings[id] = {
      input: finiteNumber(input),
      output: finiteNumber(output),
      envelope: finiteNumber(envelope),
    };
  }
  return readings;
}

function finiteNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

async function loadAndPostSampleData(
  context: AudioContext,
  node: AudioWorkletNode,
  nodeId: string,
  url: string,
  name: string,
  key: string,
  keysRef: { current: Record<string, string> },
  cacheRef: { current: Record<string, SampleDataCacheEntry> },
  requestRef: { current: Record<string, SampleDataRequest> },
): Promise<void> {
  const entry = await loadCachedSampleData(nodeId, url, name, key, cacheRef, requestRef, context);
  if (!entry || keysRef.current[nodeId] !== key) return;
  postSampleData(node, nodeId, entry);
}

async function loadCachedSampleData(
  nodeId: string,
  url: string,
  name: string,
  key: string,
  cacheRef: { current: Record<string, SampleDataCacheEntry> },
  requestRef: { current: Record<string, SampleDataRequest> },
  context?: BaseAudioContext,
): Promise<SampleDataCacheEntry | null> {
  const cached = cacheRef.current[nodeId];
  if (cached?.key === key) return cached;

  const currentRequest = requestRef.current[nodeId];
  if (currentRequest?.key === key) return currentRequest.promise;

  delete cacheRef.current[nodeId];
  const requestState: SampleDataRequest = {
    key,
    promise: Promise.resolve(null),
  };
  const request = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not load sample "${name || url}" (${response.status}).`);
      }

      const buffer = await decodeSampleAudioData(await response.arrayBuffer(), context);
      const entry: SampleDataCacheEntry = {
        key,
        data: audioBufferToMonoData(buffer),
        sampleRate: buffer.sampleRate,
        name,
        storageKey: url,
      };
      if (requestRef.current[nodeId] === requestState) {
        cacheRef.current[nodeId] = entry;
        delete requestRef.current[nodeId];
      }
      return entry;
    } catch (error) {
      logDiagnosticEvent('audio-sample-load-error', {
        level: 'warn',
        details: {
          nodeId,
          url,
          name,
          error: serializeError(error),
        },
      });
      if (requestRef.current[nodeId] === requestState) {
        delete requestRef.current[nodeId];
      }
      throw error;
    }
  })();
  requestState.promise = request;
  requestRef.current[nodeId] = requestState;
  return request;
}

async function decodeSampleAudioData(arrayBuffer: ArrayBuffer, context?: BaseAudioContext): Promise<AudioBuffer> {
  if (context) {
    return context.decodeAudioData(arrayBuffer);
  }

  const windowWithOfflineAudio = window as Window & {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const OfflineAudioContextConstructor = window.OfflineAudioContext || windowWithOfflineAudio.webkitOfflineAudioContext;
  if (!OfflineAudioContextConstructor) {
    throw new Error('This browser cannot preload samples while audio is stopped.');
  }
  const decodeContext = new OfflineAudioContextConstructor(1, 1, 44100);
  return decodeContext.decodeAudioData(arrayBuffer);
}

function postSampleData(node: AudioWorkletNode, nodeId: string, entry: SampleDataCacheEntry): void {
  const data = new Float32Array(entry.data);
  node.port.postMessage({
    type: 'sampleData',
    payload: {
      nodeId,
      data,
      sampleRate: entry.sampleRate,
      name: entry.name,
      storageKey: entry.storageKey,
    },
  }, [data.buffer]);
}

function audioBufferToMonoData(buffer: AudioBuffer): Float32Array {
  const output = new Float32Array(buffer.length);
  if (buffer.numberOfChannels === 0) return output;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) {
      output[index] += input[index] / buffer.numberOfChannels;
    }
  }

  return output;
}

function audioContextOutputLatency(context: AudioContext): number | null {
  const contextWithOutputLatency = context as AudioContext & { outputLatency?: number };
  return typeof contextWithOutputLatency.outputLatency === 'number' ? contextWithOutputLatency.outputLatency : null;
}

function dspProgramDiagnosticSnapshot(program: DspProgram | null) {
  if (!program) return null;
  return {
    ops: program.ops.length,
    values: program.values.length,
    stateBindings: program.stateBindings.length,
    registerCount: program.registerCount,
    stateCount: program.stateCount,
    sampleBindings: program.sampleBindings.length,
    customWaveBindings: program.customWaveBindings.length,
    midiControlBindings: program.midiControlBindings.length,
    tempoBindings: program.tempoBindings.length,
    maxVoices: program.maxVoices,
    usesMidiNote: program.usesMidiNote,
    usesMidiClock: program.usesMidiClock,
    errors: program.errors.slice(0, 8),
  };
}
