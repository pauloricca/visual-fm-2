export interface SampleWaveformBin {
  min: number;
  max: number;
}

export interface SampleWaveform {
  bins: SampleWaveformBin[];
  duration: number;
}

const MAX_CACHED_WAVEFORMS = 48;
const waveformCache = new Map<string, Promise<SampleWaveform | null>>();

/**
 * Fetches and analyses each sample URL at most once at a time. Completed
 * analyses are retained so newly mounted Sample nodes can render immediately.
 */
export function getSampleWaveform(url: string): Promise<SampleWaveform | null> {
  const existing = waveformCache.get(url);
  if (existing) {
    // Keep recently used waveforms resident without retaining an unbounded
    // library for a long-running editor session.
    waveformCache.delete(url);
    waveformCache.set(url, existing);
    return existing;
  }

  const request = analyseSampleWaveform(url).catch(() => null);
  waveformCache.set(url, request);
  void request.then((waveform) => {
    // Do not retain failed requests: a transient loading error should be
    // retried when a node next asks for this sample.
    if (waveform === null) {
      if (waveformCache.get(url) === request) waveformCache.delete(url);
      return;
    }
    while (waveformCache.size > MAX_CACHED_WAVEFORMS) {
      const oldestUrl = waveformCache.keys().next().value;
      if (typeof oldestUrl !== 'string') break;
      waveformCache.delete(oldestUrl);
    }
  });
  return request;
}

async function analyseSampleWaveform(url: string): Promise<SampleWaveform | null> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) return null;

  const OfflineAudioContextConstructor = window.OfflineAudioContext
    || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineAudioContextConstructor) return null;

  const context = new OfflineAudioContextConstructor(1, 1, 44100);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  return {
    bins: sampleWaveformBins(buffer, 720),
    duration: Math.max(0.001, buffer.duration),
  };
}

function sampleWaveformBins(buffer: AudioBuffer, count: number): SampleWaveformBin[] {
  const bins: SampleWaveformBin[] = [];
  const framesPerBin = Math.max(1, Math.ceil(buffer.length / count));
  for (let start = 0; start < buffer.length; start += framesPerBin) {
    const end = Math.min(buffer.length, start + framesPerBin);
    let min = 0;
    let max = 0;
    for (let frame = start; frame < end; frame += 1) {
      let value = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        value += buffer.getChannelData(channel)[frame] / buffer.numberOfChannels;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    bins.push({ min, max });
  }
  return bins;
}
