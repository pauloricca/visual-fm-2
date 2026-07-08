import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DSP_OP, type DspProgram } from './dspProgram';

type AudioStatus = 'idle' | 'starting' | 'running' | 'error';
export type AudioInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';
export type MidiInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';

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

export interface MidiInputState {
  status: MidiInputStatus;
  message: string;
  devices: MidiInputDevice[];
  canRequestAccess: boolean;
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

interface AudioEngineState {
  status: AudioStatus;
  message: string;
  peak: number;
  linkMeters: Record<string, LinkMeterReading>;
  linkScopes: Record<string, LinkScopeReading>;
  audioInput: AudioInputState;
  midiInput: MidiInputState;
  start: () => Promise<void>;
  stop: () => void;
  syncGraph: (program: DspProgram) => void;
  setLinkScopes: (linkIds: string[]) => void;
  setAudioInputDeviceId: (deviceId: string) => void;
  refreshAudioInputDevices: () => Promise<void>;
  refreshMidiInputDevices: () => Promise<void>;
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

const AUDIO_ENGINE_ASSET_VERSION = '2026-07-08-button-node';
const WORKLET_URL = `/audio/audio-worklet-wasm.js?v=${AUDIO_ENGINE_ASSET_VERSION}`;
const WASM_URL = `/audio/visual-fm-kernel.wasm?v=${AUDIO_ENGINE_ASSET_VERSION}`;
const METER_UPDATE_INTERVAL_MS = 80;
const SCOPE_CAPTURE_POINTS = 512;
const SCOPE_DISPLAY_POINTS = 160;
const SCOPE_SECONDS = 0.08;
const SCOPE_MODE = 'zero-crossing';

function stopAudioContext(
  contextRef: { current: AudioContext | null },
  nodeRef: { current: AudioWorkletNode | null },
  analyserRef: { current: AnalyserNode | null },
  inputSourceRef: { current: MediaStreamAudioSourceNode | null },
  inputStreamRef: { current: MediaStream | null },
): void {
  nodeRef.current?.port.postMessage({ type: 'panic' });
  inputSourceRef.current?.disconnect();
  inputStreamRef.current?.getTracks().forEach((track) => track.stop());
  nodeRef.current?.disconnect();
  analyserRef.current?.disconnect();
  void contextRef.current?.close();
  inputSourceRef.current = null;
  inputStreamRef.current = null;
  nodeRef.current = null;
  analyserRef.current = null;
  contextRef.current = null;
}

export function useAudioEngine(): AudioEngineState {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [message, setMessage] = useState('audio stopped');
  const [peak, setPeak] = useState(0);
  const [linkMeters, setLinkMeters] = useState<Record<string, LinkMeterReading>>({});
  const [linkScopes, setLinkScopeReadings] = useState<Record<string, LinkScopeReading>>({});
  const [audioInputStatus, setAudioInputStatus] = useState<AudioInputStatus>('inactive');
  const [audioInputMessage, setAudioInputMessage] = useState('Add an AudioInput node, then start audio.');
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState('');
  const [midiInputStatus, setMidiInputStatus] = useState<MidiInputStatus>('inactive');
  const [midiInputMessage, setMidiInputMessage] = useState('Add a MIDI Note or MIDI CC node, then start audio.');
  const [midiInputDevices, setMidiInputDevices] = useState<MidiInputDevice[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputRequestIdRef = useRef(0);
  const currentInputDeviceIdRef = useRef('');
  const midiAccessRef = useRef<MidiAccessLike | null>(null);
  const midiRequestRef = useRef<Promise<MidiAccessLike> | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const graphRef = useRef<DspProgram | null>(null);
  const lastSentProgramStructureRef = useRef<string | null>(null);
  const lastSentValuesRef = useRef<number[] | null>(null);
  const activeScopeLinkIdsRef = useRef<string[]>([]);
  const sampleDataKeysRef = useRef<Record<string, string>>({});

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
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
      if (timestamp - lastMeterUpdateAt >= METER_UPDATE_INTERVAL_MS) {
        lastMeterUpdateAt = timestamp;
        setPeak(nextPeak);
      }
      meterFrameRef.current = window.requestAnimationFrame(tick);
    };
    meterFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopMeter]);

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
    const devices = inputs.map((input, index) => {
      const name = input.name?.trim();
      const manufacturer = input.manufacturer?.trim();
      return {
        id: input.id || `${manufacturer || 'midi'}-${name || index}`,
        label: [manufacturer, name].filter(Boolean).join(' ') || `MIDI input ${index + 1}`,
        state: input.state || 'connected',
      };
    });
    setMidiInputDevices(devices);
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
    setMidiInputStatus(devices.length > 0 ? 'connected' : 'unsupported');
    setMidiInputMessage(devices.length > 0
      ? `${devices.length} MIDI input${devices.length === 1 ? '' : 's'} connected.`
      : 'MIDI permission is granted, but no input devices were found.');

    const handleMidiMessage = (event: { data: ArrayLike<number> }) => {
      if (!node) return;
      const status = Number(event.data[0] ?? 0);
      const data1 = Number(event.data[1] ?? 0);
      const data2 = Number(event.data[2] ?? 0);
      const command = status & 0xf0;
      if (command === 0x90 && data2 > 0) {
        node.port.postMessage({ type: 'noteOn', payload: { note: data1, velocity: data2 / 127 } });
        return;
      }
      if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        node.port.postMessage({ type: 'noteOff', payload: { note: data1 } });
        return;
      }
      if (command === 0xb0) {
        node.port.postMessage({ type: 'midiCc', payload: { cc: data1, value: data2 / 127 } });
      }
    };

    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = node ? handleMidiMessage : null;
    }
    midiAccess.onstatechange = () => attachMidiInputs(
      midiAccess,
      graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null,
    );
  }, [updateMidiInputDevices]);

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
      const connectedDeviceId = track?.getSettings().deviceId ?? selectedAudioInputDeviceId;
      currentInputDeviceIdRef.current = selectedAudioInputDeviceId;
      setAudioInputStatus('connected');
      setAudioInputMessage(`${track?.label || audioInputDeviceLabel(audioInputDevices, connectedDeviceId) || 'Audio input'} connected.`);
      void refreshAudioInputDevices();
      setMessage(`WASM audio ${context.state} (${AUDIO_ENGINE_ASSET_VERSION})`);
    }).catch((error) => {
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
      void loadAndPostSampleData(context, node, binding.nodeId, sampleUrl, sampleName, sampleKey, sampleDataKeysRef)
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

  const syncMidiInput = useCallback((graph: DspProgram, node: AudioWorkletNode) => {
    if (!programUsesMidi(graph)) {
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
  }, [attachMidiInputs, disconnectMidiInput]);

  const syncGraph = useCallback((graph: DspProgram) => {
    graphRef.current = graph;
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
      if (programUsesMidi(graph)) {
        const navigatorWithMidi = navigator as Navigator & {
          requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
        };
        if (!navigatorWithMidi.requestMIDIAccess) {
          setMidiInputStatus('unsupported');
          setMidiInputDevices((current) => current.length === 0 ? current : []);
          setMidiInputMessage('MIDI input is unavailable in this browser.');
        } else if (midiAccessRef.current) {
          const devices = updateMidiInputDevices(midiAccessRef.current);
          setMidiInputStatus(devices.length > 0 ? 'connected' : 'unsupported');
          setMidiInputMessage(devices.length > 0
            ? `${devices.length} MIDI input${devices.length === 1 ? '' : 's'} connected.`
            : 'MIDI permission is granted, but no input devices were found.');
        } else {
          setMidiInputStatus('needs-permission');
          setMidiInputMessage('Start audio or refresh MIDI to request browser MIDI access.');
        }
      } else {
        disconnectMidiInput();
      }
      return;
    }
    const structureKey = dspProgramStructureKey(graph);
    if (
      lastSentProgramStructureRef.current === structureKey
      && arraysEqual(lastSentValuesRef.current, graph.values)
    ) {
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      syncAudioInput(graph, contextRef.current, nodeRef.current);
      syncMidiInput(graph, nodeRef.current);
      return;
    }

    if (lastSentProgramStructureRef.current === structureKey) {
      lastSentValuesRef.current = [...graph.values];
      nodeRef.current.port.postMessage({ type: 'dspValues', payload: { values: graph.values } });
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      syncAudioInput(graph, contextRef.current, nodeRef.current);
      syncMidiInput(graph, nodeRef.current);
      return;
    }

    lastSentProgramStructureRef.current = structureKey;
    lastSentValuesRef.current = [...graph.values];
    nodeRef.current.port.postMessage({ type: 'dspProgram', payload: graph });
    syncGraphSamples(graph, contextRef.current, nodeRef.current);
    syncAudioInput(graph, contextRef.current, nodeRef.current);
    syncMidiInput(graph, nodeRef.current);
    nodeRef.current.port.postMessage({
      type: 'setLinkScopes',
      payload: activeScopeLinkIdsRef.current.length > 0
        ? scopePayload(activeScopeLinkIdsRef.current)
        : {},
    });
  }, [disconnectAudioInput, disconnectMidiInput, refreshAudioInputDevices, syncAudioInput, syncGraphSamples, syncMidiInput, updateMidiInputDevices]);

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
    if (nodeRef.current && contextRef.current) {
      await resumeAudioContext(contextRef.current);
      setStatus(contextRef.current.state === 'running' ? 'running' : 'idle');
      setMessage(`audio context ${contextRef.current.state}`);
      if (contextRef.current.state === 'running') startMeter();
      return;
    }

    try {
      setStatus('starting');
      setMessage('starting audio');
      const context = new AudioContext();
      await resumeAudioContext(context);
      setMessage(`audio context ${context.state}`);
      const wasmBytes = await fetch(WASM_URL, { cache: 'no-store' }).then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load WASM kernel (${response.status}).`);
        }
        return response.arrayBuffer();
      });
      await context.audioWorklet.addModule(WORKLET_URL);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const node = new AudioWorkletNode(context, 'visual-fm-wasm-engine', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasmBytes },
      });

      node.port.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === 'backendStatus') {
          if (payload?.ready) {
            setStatus('running');
            setMessage(`WASM audio ${context.state} (${AUDIO_ENGINE_ASSET_VERSION})`);
          } else {
            setStatus('error');
            setMessage(payload?.error || 'WASM audio failed');
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
        setMessage((current) => current.replace(/(audio|context) (running|suspended|interrupted|closed)/, `$1 ${context.state}`));
      };

      node.connect(analyser);
      analyser.connect(context.destination);
      contextRef.current = context;
      nodeRef.current = node;
      analyserRef.current = analyser;

      if (graphRef.current) {
        lastSentProgramStructureRef.current = dspProgramStructureKey(graphRef.current);
        lastSentValuesRef.current = [...graphRef.current.values];
        node.port.postMessage({ type: 'dspProgram', payload: graphRef.current });
        syncGraphSamples(graphRef.current, context, node);
        syncAudioInput(graphRef.current, context, node);
        syncMidiInput(graphRef.current, node);
      }
      if (activeScopeLinkIdsRef.current.length > 0) {
        node.port.postMessage({
          type: 'setLinkScopes',
          payload: scopePayload(activeScopeLinkIdsRef.current),
        });
      }
      if (context.state !== 'running') {
        await resumeAudioContext(context);
      }
      if (context.state === 'running') {
        startMeter();
      } else {
        setStatus('idle');
        setMessage(`audio context ${context.state}`);
      }
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'audio failed');
    }
  }, [startMeter, syncAudioInput, syncGraphSamples, syncMidiInput]);

  const stop = useCallback(() => {
    stopAudioContext(contextRef, nodeRef, analyserRef, inputSourceRef, inputStreamRef);
    disconnectMidiInput();
    inputRequestIdRef.current += 1;
    currentInputDeviceIdRef.current = '';
    lastSentProgramStructureRef.current = null;
    lastSentValuesRef.current = null;
    sampleDataKeysRef.current = {};
    stopMeter();
    setLinkMeters({});
    setLinkScopeReadings({});
    setStatus('idle');
    setMessage('audio stopped');
    setAudioInputStatus(programUsesAudioInput(graphRef.current) ? 'needs-permission' : 'inactive');
    setAudioInputMessage(programUsesAudioInput(graphRef.current)
      ? 'Start audio to request microphone access.'
      : 'Audio input is not used by this patch.');
    setMidiInputStatus(programUsesMidi(graphRef.current) ? 'needs-permission' : 'inactive');
    setMidiInputMessage(programUsesMidi(graphRef.current)
      ? 'Start audio or refresh MIDI to request browser MIDI access.'
      : 'MIDI input is not used by this patch.');
    setMidiInputDevices((current) => current.length === 0 ? current : []);
  }, [disconnectMidiInput, stopMeter]);

  useEffect(() => () => {
    stopMeter();
    stopAudioContext(contextRef, nodeRef, analyserRef, inputSourceRef, inputStreamRef);
    disconnectMidiInput();
  }, [disconnectMidiInput, stopMeter]);

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
  }), [midiInputDevices, midiInputMessage, midiInputStatus]);

  return {
    status,
    message,
    peak,
    linkMeters,
    linkScopes,
    audioInput,
    midiInput,
    start,
    stop,
    syncGraph,
    setLinkScopes,
    setAudioInputDeviceId: setSelectedAudioInputDeviceId,
    refreshAudioInputDevices,
    refreshMidiInputDevices,
  };
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
    stateBindings: program.stateBindings,
    registerCount: program.registerCount,
    stateCount: program.stateCount,
    feedbackLinkIds: program.feedbackLinkIds,
    monitorIds: program.monitorIds,
    sampleBindings: program.sampleBindings,
    customWaveBindings: program.customWaveBindings,
    maxVoices: program.maxVoices,
    usesMidiNote: program.usesMidiNote,
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

function programUsesMidi(program: DspProgram | null): boolean {
  return Boolean(program?.ops.some((op) => op.opcode === DSP_OP.MidiNote || op.opcode === DSP_OP.MidiCc));
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
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load sample "${name || url}" (${response.status}).`);
  }

  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  if (keysRef.current[nodeId] !== key) return;

  const data = audioBufferToMonoData(buffer);
  node.port.postMessage({
    type: 'sampleData',
    payload: {
      nodeId,
      data,
      sampleRate: buffer.sampleRate,
      name,
      storageKey: url,
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
