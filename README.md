# visual-fm-2

`visual-fm-2` is an audio node editor built from two earlier projects:

- `visual-visual` is the UI blueprint. The canvas, node styling, simple cable controls, selection, panning, grouping/subpatching, expression node, and save/load/import workflow are meant to feel like that app.
- `visual-fm` is the audio lineage. Its Rust/WASM engine is the sound source: oscillators, modulation, filtering, distortion, envelopes, metering, smoothing, and click-free playback all come from that work.

The important design change is that this project is node-first. In `visual-fm`, cables were rich objects: they could contain effects and processors, and one cable could modulate another cable. In `visual-fm-2`, cables are intentionally simple. Audio behavior lives in nodes. Cables connect node ports.

## Patch Model

The current app has one patch at a time. Subpatches can be created and imported, but the runtime compiles a single expanded patch for audio playback.

All signals are mono inside the graph. `Audio Out` has `both`, `left`, and `right` inputs:

- `both` sends the incoming mono signal to both output channels.
- `left` sends it to the left channel.
- `right` sends it to the right channel.

Nodes own the audio behavior. Oscillators generate signals. Filters filter signals. Distortion nodes distort signals. Delay, multiply, meter, scope, and other processors are explicit nodes in the graph.

Cables do not contain filters, distortion, delay, envelopes, or other processors as user-facing behavior. The compiler may still lower explicit processor nodes onto the existing `visual-fm` WASM link fields internally, because that is the proven ABI the engine already exposes. Those fields are implementation details here, not the patch philosophy.

## Nodes

Most node types are available from the node picker. `Ins` and `Outs` appear while editing subpatches.

- `Expression`: evaluates a typed expression and outputs the result as a signal/control value.
- `Group`: wraps a subpatch so a reusable patch can live inside a single node.
- `Ins`: exposes subpatch input ports while editing a subpatch.
- `Outs`: exposes subpatch output ports while editing a subpatch.
- `Audio Out`: sends mono graph signals to the stereo hardware output via `both`, `left`, or `right`.
- `Sine Osc`: generates a sine oscillator signal.
- `Triangle Osc`: generates a triangle oscillator signal.
- `Saw Osc`: generates a falling/rising saw oscillator signal.
- `Ramp Osc`: generates a ramp-style oscillator signal.
- `Square Osc`: generates a square oscillator signal.
- `Sample Hold`: samples an incoming signal when triggered and holds that value.
- `Perlin Noise`: generates smooth noise at a controllable speed.
- `Noise`: generates raw noise.
- `Audio Input`: brings a microphone or input device into the patch with gain/level controls.
- `Custom Wave`: generates an editable breakpoint waveform with loop, one-shot, ping-pong, and sustain modes.
- `Sample`: plays an uploaded sample with trigger, region, pitch, stretch, and granular-style controls.
- `Buffer`: records and plays a rolling audio buffer from signal, playhead, record-head, and length controls.
- `Playhead`: outputs a playback position signal from start and speed controls.
- `Constant`: outputs a fixed numeric value.
- `Slider`: provides a playable UI control, optionally driven by MIDI CC, that outputs a mapped signal.
- `Button`: provides a playable UI button, optionally driven by MIDI CC, for gate/toggle/trigger-style control.
- `Sequencer`: displays a clickable step grid with configurable steps and rows; `signal` advances the sequence, `reset` restarts it, each row has its own trigger output, and `trigger index` emits the 1-based index of the first triggered row.
- `Tempo`: outputs clock triggers and matching frequency values from 4-bar divisions down to thirty-seconds.
- `MIDI Note`: converts MIDI note input into note, frequency, velocity, gate, and trigger outputs.
- `MIDI CC`: outputs the current value of a selected MIDI CC.
- `Selector`: selects one of several input values and can glide between selections.
- `Accumulator`: steps through a min/max range when triggered.
- `Abs`: outputs the absolute value of the input signal.
- `Map`: remaps a signal from one numeric range to another.
- `Clamp`: limits a signal to a minimum and maximum.
- `Multiply`: multiplies a signal by a factor.
- `Pan`: splits a signal into equal-power `left` and `right` outputs from a `pan` value, where `-1` is left, `0` is center, and `1` is right.
- `Delay`: applies delay with time, feedback, and wet/dry mix controls.
- `Chorus`: applies a modulated delay chorus effect.
- `Reverb`: applies a reverb effect with size, decay, mix controls, and `left`/`right` outputs.
- `Envelope`: creates an ADSR-style envelope from a trigger input.
- `Follower`: follows the amplitude contour of a signal with attack/release smoothing.
- `Ring Mod`: multiplies a signal by a modulation amount for ring-mod-style tones.
- `Fold`: folds a signal back on itself for wavefolding.
- `Meter`: measures a signal level for display and downstream control.
- `Scope`: shows an oscilloscope-style view of the signal.
- `Lowpass Filter`: filters out frequencies above the cutoff.
- `Highpass Filter`: filters out frequencies below the cutoff.
- `Bandpass Filter`: keeps frequencies around the cutoff and attenuates the rest.
- `Equaliser`: shapes a signal with independent low, mid, and high gain controls (in dB).
- `Formant Filter`: applies a vowel/formant-style filter with morph and intensity controls.
- `Comb Filter`: applies a resonant comb filter tuned by frequency and feedback.
- `Comb Notch`: applies a comb-style notch filter tuned by frequency and feedback.
- `Hard Clip`: clips a signal sharply for hard distortion.
- `Soft Clip`: clips a signal smoothly for warmer distortion.
- `Fuzz`: applies fuzz-style distortion.
- `Saturate`: applies saturation-style distortion.
- `Wavefold`: applies wavefolding distortion.

## Links

Every link has:

- `weight`: the cable amplitude/control amount.
- `mode`: one of `set`, `add`, or `multiply`.

The link value is:

```text
linkValue = sourceOutput * weight
```

When several links connect to the same input, `visual-fm-2` follows the same rule as `visual-visual`:

```text
setBase = average(all set link values), if any set links exist
setBase = the node's local input value, if there are no set links

afterAdd = setBase + sum(all add link values)

finalValue = afterAdd * product(all multiply link values)
```

So:

- `set` replaces the node's local value. Multiple `set` links are averaged.
- `add` adds to the local value or to the averaged `set` value.
- `multiply` multiplies the result after `set` and `add`.

This order matters. A frequency input with a local value of `80`, an `add` link carrying `1`, and no other links resolves to roughly `81`. A `set` link carrying a slow oscillator around `-1..1` sets the input near those values, rather than multiplying the local `80`.

Static values from nodes like `Constant` and static `Expression` outputs are folded by the compiler. Audio-rate values are lowered onto the `visual-fm` WASM modulation lanes, preserving the engine's smoothing and click-free behavior.

## Compiler And Engine Boundary

The active compiler is `web/src/audio/dspProgram.ts`. It expands subpatches, combines input links with the rule above, and emits a `DspProgram` for the worklet. The editor sends that program with `dspProgram` messages, and value-only changes use `dspValues`.

The old link-centric `WasmAudioGraph` TypeScript compiler has been removed. Current playback fixes should target `web/src/audio/dspProgram.ts` and the `DspProgram` sync path in the worklet.

The worklet in `web/public/audio/audio-worklet-wasm.js` loads the `visual-fm` WASM kernel and syncs the compiled `DspProgram` into it. User-facing patch links target nodes or the audio output; any remaining inherited link-centric WASM API names are implementation details, not the patch philosophy.

The current WASM binary still has the inherited `visual-fm` ABI, where some processor settings are named as link parameters. That naming reflects the original engine, not the user-facing model in this app. The app should keep the audio kernel stable unless there is a clear DSP reason to change it.

## Development

Install dependencies:

```sh
npm install
```

Run the app:

```sh
npm run dev
```

Run the app through Docker with the local helper:

```sh
./start
```

`./start` serves the editor on port `5174` by default, generates a self-signed HTTPS certificate when `openssl` is available, prints LAN URLs for another device or projector, and supports `--port=PORT`, `--patch-storage=local`, and `--patch-storage=browser`.

Themes are selected with `--theme=NAME` (or `--theme NAME`). Available presets are `console` (green phosphor), `amber` (warm orange), and `ocean` (cool blue); for example, `./start --theme=amber`. The default theme preserves the original monochrome appearance. Palette and font tokens live in `web/src/themes.css`; add a `:root[data-theme='NAME']` block there to create another theme.

Typecheck:

```sh
npm run typecheck
```

Build:

```sh
npm run build
```

Rebuild the Rust/WASM kernel and copy it into the web public/dist audio assets:

```sh
npm run build:wasm
```

Check compiled DSP port/link behavior:

```sh
npm run smoke:dsp-ports
```

Render a quick WASM startup smoke test:

```sh
node scripts/render-worklet-startup.mjs 1
```

Render the compiled MIDI/polyphony path:

```sh
node scripts/render-worklet-startup.mjs 1 --midi-note
```

Manual MIDI check:

1. Add a MIDI Note node, Sine Osc, and Audio Out.
2. Connect `MIDI Note.frequency` to `Sine Osc.frequency`, then `Sine Osc.signal` to `Audio Out.both`.
3. Set `MIDI Note.voices` to `2`, start audio, and allow MIDI access when prompted.
4. Play and release notes on a MIDI keyboard. Note-on should start voices, note-off should release them, and holding more than two notes should steal the oldest voice with a short fade.
