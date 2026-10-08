interface ImportMetaEnv {
  readonly VITE_VISUAL_FM_THEME?: string;
  readonly VITE_VISUAL_FM_DSP_MODE?: 'single' | 'multi';
  readonly VITE_VISUAL_FM_DSP_WORKERS?: string;
  readonly VITE_VISUAL_FM_PATCH_STORAGE?: 'local' | 'browser';
  readonly VITE_VISUAL_VISUAL_PATCH_STORAGE?: 'local' | 'browser';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:audio-engine-assets' {
  export const AUDIO_WORKLET_ASSET_VERSION: string;
  export const AUDIO_WASM_ASSET_VERSION: string;
  export const AUDIO_SIMD_WASM_ASSET_VERSION: string;
  export const AUDIO_PARALLEL_WASM_ASSET_VERSION: string;
  export const AUDIO_PARALLEL_WORKER_ASSET_VERSION: string;
}
