export const AUDIO_ENGINE_CONFIG = {
  // Changing an env file requires restarting Vite (or rebuilding production).
  // The matching settings below can also be edited directly for local work.
  rendering: {
    mode: (import.meta.env.VITE_TEIA_DSP_MODE ?? import.meta.env.VITE_VISUAL_FM_DSP_MODE) === 'multi' ? 'multi' : 'single',
    workers: Math.max(1, Math.min(4,
      Math.trunc(Number(import.meta.env.VITE_TEIA_DSP_WORKERS ?? import.meta.env.VITE_VISUAL_FM_DSP_WORKERS) || 2))),
  },
  graphUpdateCrossfade: {
    enabled: true,
    seconds: 0.02,
  },
} as const;
