interface ImportMetaEnv {
  readonly VITE_VISUAL_FM_THEME?: string;
  readonly VITE_VISUAL_FM_PATCH_STORAGE?: 'local' | 'browser';
  readonly VITE_VISUAL_VISUAL_PATCH_STORAGE?: 'local' | 'browser';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
