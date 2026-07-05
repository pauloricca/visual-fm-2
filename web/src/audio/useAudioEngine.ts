import { useCallback, useEffect, useRef, useState } from 'react';
import type { WasmAudioGraph } from './compiler';

type AudioStatus = 'idle' | 'starting' | 'running' | 'error';

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
  start: () => Promise<void>;
  stop: () => void;
  syncGraph: (graph: WasmAudioGraph) => void;
  setLinkScope: (linkId: string | null) => void;
}

const WORKLET_URL = '/audio/audio-worklet-wasm.js';
const WASM_URL = '/audio/visual-fm-kernel.wasm';
const METER_UPDATE_INTERVAL_MS = 80;

export function useAudioEngine(): AudioEngineState {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [message, setMessage] = useState('audio stopped');
  const [peak, setPeak] = useState(0);
  const [linkMeters, setLinkMeters] = useState<Record<string, LinkMeterReading>>({});
  const [linkScopes, setLinkScopes] = useState<Record<string, LinkScopeReading>>({});
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const graphRef = useRef<WasmAudioGraph | null>(null);
  const lastSentGraphJsonRef = useRef<string | null>(null);
  const activeScopeLinkIdRef = useRef<string | null>(null);

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

  const syncGraph = useCallback((graph: WasmAudioGraph) => {
    graphRef.current = graph;
    const graphJson = JSON.stringify(graph);
    if (!nodeRef.current || lastSentGraphJsonRef.current === graphJson) return;

    lastSentGraphJsonRef.current = graphJson;
    nodeRef.current.port.postMessage({ type: 'graph', payload: graph });
    nodeRef.current.port.postMessage({
      type: 'setLinkScope',
      payload: activeScopeLinkIdRef.current
        ? { linkId: activeScopeLinkIdRef.current, points: 160, seconds: 0.08, mode: 'zero-crossing' }
        : {},
    });
  }, []);

  const setLinkScope = useCallback((linkId: string | null) => {
    activeScopeLinkIdRef.current = linkId;
    nodeRef.current?.port.postMessage({
      type: 'setLinkScope',
      payload: linkId ? { linkId, points: 160, seconds: 0.08, mode: 'zero-crossing' } : {},
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
      const wasmBytes = await fetch(WASM_URL).then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load WASM kernel (${response.status}).`);
        }
        return response.arrayBuffer();
      });
      await context.audioWorklet.addModule(WORKLET_URL);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const node = new AudioWorkletNode(context, 'visual-fm-wasm-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasmBytes },
      });

      node.port.onmessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === 'backendStatus') {
        if (payload?.ready) {
          setStatus('running');
          setMessage(`WASM audio ${context.state}`);
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
        setLinkScopes((current) => ({
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
        lastSentGraphJsonRef.current = JSON.stringify(graphRef.current);
        node.port.postMessage({ type: 'graph', payload: graphRef.current });
      }
      if (activeScopeLinkIdRef.current) {
        node.port.postMessage({
          type: 'setLinkScope',
          payload: { linkId: activeScopeLinkIdRef.current, points: 160, seconds: 0.08, mode: 'zero-crossing' },
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
  }, [startMeter]);

  const stop = useCallback(() => {
    nodeRef.current?.port.postMessage({ type: 'panic' });
    void contextRef.current?.suspend();
    stopMeter();
    setLinkMeters({});
    setLinkScopes({});
    setStatus('idle');
    setMessage('audio stopped');
  }, [stopMeter]);

  useEffect(() => () => {
    stopMeter();
    nodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    void contextRef.current?.close();
  }, [stopMeter]);

  return { status, message, peak, linkMeters, linkScopes, start, stop, syncGraph, setLinkScope };
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
