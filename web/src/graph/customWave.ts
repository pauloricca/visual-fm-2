import type { CustomWaveMode, CustomWavePoint, CustomWaveSettings, PatchNode } from './types';

export const CUSTOM_WAVE_MODES: Array<{ value: CustomWaveMode; label: string }> = [
  { value: 'loop', label: 'Loop' },
  { value: 'ping-pong', label: 'Ping-pong' },
  { value: 'once', label: 'Play once on trigger' },
  { value: 'sustain', label: 'Sustain' },
  { value: 'sustain-loop', label: 'Sustain loop' },
  { value: 'sustain-ping-pong', label: 'Sustain ping-pong' },
];

export const DEFAULT_CUSTOM_WAVE: CustomWaveSettings = {
  mode: 'loop',
  sustainStart: 0.5,
  sustainEnd: 0.75,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

const CUSTOM_WAVE_MODE_VALUES = new Set<CustomWaveMode>(CUSTOM_WAVE_MODES.map((mode) => mode.value));
const LEGACY_CUSTOM_WAVE_MODES = CUSTOM_WAVE_MODES.map((mode) => mode.value);

export function normalizeCustomWave(
  customWave: Partial<CustomWaveSettings> | undefined,
  legacyParams?: PatchNode['params'],
): CustomWaveSettings {
  const legacyMode = legacyParams && Number.isFinite(legacyParams.mode)
    ? LEGACY_CUSTOM_WAVE_MODES[clamp(Math.round(legacyParams.mode ?? 0), 0, LEGACY_CUSTOM_WAVE_MODES.length - 1)]
    : undefined;
  const mode = CUSTOM_WAVE_MODE_VALUES.has(customWave?.mode as CustomWaveMode)
    ? customWave?.mode as CustomWaveMode
    : legacyMode ?? DEFAULT_CUSTOM_WAVE.mode;
  const sustainStart = Number.isFinite(Number(customWave?.sustainStart))
    ? clamp(Number(customWave?.sustainStart), 0, 0.999)
    : Number.isFinite(legacyParams?.sustainStart)
      ? clamp(Number(legacyParams?.sustainStart), 0, 0.999)
      : DEFAULT_CUSTOM_WAVE.sustainStart;
  const sustainEnd = Number.isFinite(Number(customWave?.sustainEnd))
    ? clamp(Number(customWave?.sustainEnd), sustainStart + 0.001, 1)
    : Number.isFinite(legacyParams?.sustainEnd)
      ? clamp(Number(legacyParams?.sustainEnd), sustainStart + 0.001, 1)
      : Math.max(sustainStart + 0.001, DEFAULT_CUSTOM_WAVE.sustainEnd);
  const sourcePoints = Array.isArray(customWave?.points) ? customWave.points : DEFAULT_CUSTOM_WAVE.points;
  const pointsByX = new Map<number, number>();

  for (const point of sourcePoints) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pointsByX.set(clamp(x, 0, 1), clamp(y, -1, 1));
  }

  pointsByX.set(0, 0);
  pointsByX.set(1, 0);

  return {
    mode,
    sustainStart,
    sustainEnd,
    points: [...pointsByX.entries()]
      .map(([x, y]): CustomWavePoint => ({ x, y }))
      .sort((a, b) => a.x - b.x),
  };
}

export function customWaveUsesSustainStart(mode: CustomWaveMode): boolean {
  return mode.startsWith('sustain');
}

export function customWaveUsesSustainEnd(mode: CustomWaveMode): boolean {
  return mode === 'sustain-loop' || mode === 'sustain-ping-pong';
}

/**
 * Returns a copy whose locked endpoints produce zero in the configured output
 * range. The stored points stay normalized, so changing the range never
 * rewrites the user's curve.
 */
export function customWaveWithRangeOrigin(
  customWave: CustomWaveSettings,
  rangeMin: number,
  rangeMax: number,
): CustomWaveSettings {
  const endpointY = normalizedCustomWaveValue(0, rangeMin, rangeMax);
  const lastIndex = customWave.points.length - 1;
  return {
    ...customWave,
    points: customWave.points.map((point, index) => (
      index === 0 || index === lastIndex ? { ...point, y: endpointY } : point
    )),
  };
}

export function normalizedCustomWaveValue(value: number, rangeMin: number, rangeMax: number): number {
  const min = Number.isFinite(rangeMin) ? rangeMin : -1;
  const max = Number.isFinite(rangeMax) ? rangeMax : 1;
  const span = max - min;
  if (span === 0) {
    if (min === value) return 0;
    return value < min ? -1 : 1;
  }
  return clamp(((value - min) / span) * 2 - 1, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
