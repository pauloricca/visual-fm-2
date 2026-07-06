import type { Patch } from './types';

export const demoPatch: Patch = {
  name: 'single-patch',
  nodes: [
    {
      id: 'sine_1',
      type: 'SineOsc',
      params: { frequency: 110, phase: 0, phaseReset: 0, level: 0.75 },
      position: { x: 80, y: 130 },
    },
    {
      id: 'filter_1',
      type: 'LowpassFilter',
      params: { cutoff: 900, resonance: 0.8 },
      position: { x: 380, y: 130 },
    },
    {
      id: 'audio_out',
      type: 'AudioOut',
      params: { level: 0.8 },
      position: { x: 680, y: 130 },
    },
  ],
  links: [
    {
      from: { node: 'sine_1', port: 'signal' },
      to: { node: 'filter_1', port: 'signal' },
      weight: 1,
      mode: 'set',
    },
    {
      from: { node: 'filter_1', port: 'signal' },
      to: { node: 'audio_out', port: 'both' },
      weight: 0.85,
      mode: 'set',
    },
  ],
};
