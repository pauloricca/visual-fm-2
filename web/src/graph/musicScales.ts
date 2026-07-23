export interface QuantiseScale {
  label: string;
  semitones: readonly number[];
}

export const QUANTISE_SCALES: readonly QuantiseScale[] = [
  { label: 'chromatic', semitones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { label: 'major', semitones: [0, 2, 4, 5, 7, 9, 11] },
  { label: 'minor', semitones: [0, 2, 3, 5, 7, 8, 10] },
  { label: 'harmonic minor', semitones: [0, 2, 3, 5, 7, 8, 11] },
  { label: 'melodic minor', semitones: [0, 2, 3, 5, 7, 9, 11] },
  { label: 'major pentatonic', semitones: [0, 2, 4, 7, 9] },
  { label: 'minor pentatonic', semitones: [0, 3, 5, 7, 10] },
  { label: 'blues', semitones: [0, 3, 5, 6, 7, 10] },
  { label: 'dorian', semitones: [0, 2, 3, 5, 7, 9, 10] },
  { label: 'phrygian', semitones: [0, 1, 3, 5, 7, 8, 10] },
  { label: 'lydian', semitones: [0, 2, 4, 6, 7, 9, 11] },
  { label: 'mixolydian', semitones: [0, 2, 4, 5, 7, 9, 10] },
  { label: 'locrian', semitones: [0, 1, 3, 5, 6, 8, 10] },
  { label: 'whole tone', semitones: [0, 2, 4, 6, 8, 10] },
  { label: 'diminished (whole-half)', semitones: [0, 2, 3, 5, 6, 8, 9, 11] },
  { label: 'diminished (half-whole)', semitones: [0, 1, 3, 4, 6, 7, 9, 10] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiNoteLabel(note: number): string {
  const midiNote = Math.max(0, Math.min(127, Math.round(note)));
  return `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}
