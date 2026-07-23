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
- `Audio Out`: sends mono graph signals to the stereo hardware output via `both`, `left`, or `right`, with a final `level` control.
- `Sine Osc`: generates a sine oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Triangle Osc`: generates a triangle oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Saw Osc`: generates a saw oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Ramp Osc`: generates a ramp oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Square Osc`: generates a square oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Sample Hold`: samples an incoming signal when triggered and holds that value.
- `Perlin Noise`: generates smooth noise at a controllable speed.
- `Noise`: generates raw noise.
- `Audio Input`: brings a microphone or input device into the patch with gain/level controls.
- `Custom Wave`: generates an editable breakpoint waveform with loop, one-shot, ping-pong, and sustain modes. Its scope-style grid shows the configured output range; zooming into the canvas reveals denser grid divisions and more scale labels while chart strokes remain screen-thin and labels and edit points stay screen-relative, with a small capped size increase at high zoom for legibility. Hovering or dragging an edit point shows its value in the configured Y-axis range. The zero-origin endpoints follow that range proportionally and clamp to an edge when zero is outside it, while saved curve points remain normalized and range-independent. Point drags update the live DSP at a limited rate, morph smoothly between curve revisions without rebuilding the graph, and always commit the final position after release.
- `Sample`: plays a selected, uploaded, or microphone-recorded sample with frequency/original-frequency pitch tracking, trigger, polyphony, region, envelope, stretch, granular-style mode, and level controls. Positive frequency plays forward, negative frequency plays backward, and zero pauses the playhead. With `voices` set to `1`, playback follows live parameter changes; with more than one voice, each voice keeps the parameter values captured by its trigger. The sample picker can record from the microphone; stopping converts the capture to PCM WAV, prompts for a name, saves the `.wav` file in `samples/`, and selects it for the node.
- `Image`: samples brightness, RGB, hue, and saturation from an uploaded image at an `x`/`y` position.
- `Buffer`: records and plays a rolling audio buffer from signal, playhead, record-head, and length controls.
- `Playhead`: outputs a playback position signal from start and speed controls.
- `Time`: outputs elapsed time in seconds.
- `Constant`: outputs a fixed numeric value.
- `Pass`: passes a signal through unchanged.
- `Slider`: provides a playable UI control, optionally driven by MIDI CC, that outputs a mapped signal.
- `Button`: provides a playable UI button, optionally driven by MIDI CC, for gate/toggle/trigger-style control.
- `Keys`: provides an on-canvas keyboard with configurable size and starting MIDI note, outputting MIDI note and frequency.
- `Sequencer`: offers Trigger mode for the original clickable pulse grid and Gate mode for freely positioned, edge-resizable intervals; drag a step's top edge down to lower its velocity from `1` to a minimum of `0.1`, so the row output emits that smaller value when the step triggers or gates; `signal` advances the sequence, `reset` restarts it, each row has its own output, and `trigger index` emits the 1-based index of the first active row.
- `Tempo`: outputs clock triggers and matching frequency values from 4-bar divisions down to thirty-seconds, with BPM, swing, internal/MIDI source, and MIDI-source selection.
- `MIDI Note`: converts MIDI note input into note, frequency, velocity, gate, and trigger outputs.
- `MIDI CC`: outputs the current value of a selected MIDI CC.
- `Selector`: selects one of several input values and can glide between selections.
- `Accumulator`: steps through a min/max range by a configurable, floating-point increment, either on trigger edges or continuously for every audio sample.
- `Abs`: outputs the absolute value of the input signal.
- `Map`: remaps a signal from one numeric range to another.
- `Clamp`: limits a signal to a minimum and maximum.
- `Multiply`: multiplies a signal by a factor.
- `pow`: raises the signal to an exponent.
- `Pan`: splits a signal into equal-power `left` and `right` outputs from a `pan` value, where `-1` is left, `0` is center, and `1` is right.
- `Delay`: applies delay with time, feedback, and wet/dry mix controls.
- `Chorus`: applies a modulated delay chorus effect.
- `Reverb`: applies a reverb effect with size, decay, mix controls, and `left`/`right` outputs.
- `Compress`: applies dynamics compression with optional sidechain, threshold, ratio, attack, release, knee, and makeup controls.
- `Limiter`: applies lookahead limiting with input gain, ceiling, release, and lookahead controls.
- `Envelope`: creates an envelope with trigger/gate inputs and delay, attack, decay, sustain, gate-length, and release controls.
- `Follower`: follows the amplitude contour of a signal with attack/release smoothing.
- `Ring Mod`: multiplies a signal by a modulation amount for ring-mod-style tones.
- `Fold`: folds a signal back on itself for wavefolding.
- `Meter`: measures a signal level for display and downstream control. Canvas zoom increases its grid and scale-label detail while preserving thin screen-relative chart strokes, with a small capped label-size increase at high zoom.
- `Scope`: shows an oscilloscope-style view of the signal. Canvas zoom increases its grid and scale-label detail while preserving thin screen-relative chart strokes, with a small capped label-size increase at high zoom.
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

### Node signatures

The signature notation below is `inputs -> outputs`. Port names are the names used by patch links. `Expression`, `Group`, `Ins`, and `Outs` have patch-defined ports; Sequencer row outputs and Selector value inputs also expand dynamically.

| Node | Inputs | Outputs |
| --- | --- | --- |
| Expression | dynamic expression variables | `value` |
| Group | dynamic subpatch inputs | dynamic subpatch outputs |
| Ins | — | dynamic subpatch inputs |
| Outs | dynamic subpatch outputs | — |
| Audio Out | `both`, `left`, `right`, `level` | — |
| Sine Osc | `frequency`, `phase`, `phaseReset`, `rangeMin`, `rangeMax` | `signal` |
| Triangle Osc | `frequency`, `phase`, `phaseReset`, `rangeMin`, `rangeMax` | `signal` |
| Saw Osc | `frequency`, `phase`, `phaseReset`, `rangeMin`, `rangeMax` | `signal` |
| Ramp Osc | `frequency`, `phase`, `phaseReset`, `rangeMin`, `rangeMax` | `signal` |
| Square Osc | `frequency`, `phase`, `phaseReset`, `rangeMin`, `rangeMax` | `signal` |
| Sample Hold | `signal`, `trigger` | `signal` |
| Perlin Noise | `speed`, `rangeMin`, `rangeMax` | `signal` |
| Noise | `rangeMin`, `rangeMax` | `signal` |
| Audio Input | `gain`, `level` | `signal` |
| Custom Wave | `frequency`, `phase`, `trigger`, `rangeMin`, `rangeMax` | `signal` |
| Sample | `frequency`, `originalFrequency`, `trigger`, `voices`, `start`, `end`, `attack`, `release`, `stretch`, `cycleLength`, `overlapRatio`, `mode`, `level` | `signal` |
| Image | `x`, `y` | `brightness`, `r`, `g`, `b`, `hue`, `saturation` |
| Buffer | `signal`, `playhead`, `recordHead`, `length` | `signal` |
| Playhead | `start`, `speed` | `playhead` |
| Time | — | `seconds` |
| Constant | `value` | `signal` |
| Pass | `signal` | `signal` |
| Slider | `signal`, `value`, `min`, `max`, `direction`, `midiChannel`, `midiCc` | `signal` |
| Button | `signal`, `mode`, `midiChannel`, `midiCc` | `signal` |
| Keys | `size`, `startNote` | `midi note`, `frequency` |
| Sequencer | `steps`, `rows`, `beatLength`, `mode`, `signal`, `reset` | row outputs `1`…`16` (according to `rows`), `trigger index` |
| Tempo | `bpm`, `swing`, `source`, `midiSource` | `4 bar`, `2 bar`, `bar`, `whole`, `half`, `quarter / beat`, `upbeat`, `eighth`, `sixteenth`, `thirty-second`, plus a matching `… freq` output for each |
| MIDI Note | `channel`, `voices` | `note`, `frequency`, `velocity`, `gate`, `trigger` |
| MIDI CC | `channel`, `cc` | `signal` |
| Selector | `select`, `slide`, dynamic value inputs `1`… | `signal` |
| Accumulator | `mode`, `trigger`, `reset`, `increment`, `min`, `max` | `signal` |
| Abs | `signal` | `signal` |
| Map | `signal`, `srcMin`, `srcMax`, `trgtMin`, `trgtMax` | `signal` |
| Clamp | `signal`, `min`, `max` | `signal` |
| Multiply | `signal`, `factor` | `signal` |
| pow | `signal`, `exponent` | `signal` |
| Pan | `signal`, `pan` | `left`, `right` |
| Delay | `signal`, `time`, `feedback`, `mix` | `signal` |
| Chorus | `signal`, `rate`, `depth`, `mix` | `signal` |
| Reverb | `signal`, `size`, `decay`, `mix` | `left`, `right` |
| Compress | `signal`, `sidechain`, `threshold`, `ratio`, `attack`, `release`, `knee`, `makeup` | `signal` |
| Limiter | `signal`, `inputGain`, `ceiling`, `release`, `lookahead` | `signal` |
| Envelope | `signal`, `trigger`, `gate`, `delay`, `attack`, `decay`, `sustain`, `gateLength`, `release` | `signal` |
| Follower | `signal`, `attack`, `release` | `signal` |
| Ring Mod | `signal`, `amount` | `signal` |
| Fold | `signal`, `amount` | `signal` |
| Meter | `signal`, `range`, `mode` | `signal` |
| Scope | `signal`, `range`, `mode`, `length` | `signal` |
| Lowpass Filter | `signal`, `cutoff`, `resonance` | `signal` |
| Highpass Filter | `signal`, `cutoff`, `resonance` | `signal` |
| Bandpass Filter | `signal`, `cutoff`, `resonance` | `signal` |
| Equaliser | `signal`, `lows`, `mids`, `highs` | `signal` |
| Formant Filter | `signal`, `morph`, `intensity` | `signal` |
| Comb Filter | `signal`, `frequency`, `feedback` | `signal` |
| Comb Notch | `signal`, `frequency`, `feedback` | `signal` |
| Hard Clip | `signal`, `drive` | `signal` |
| Soft Clip | `signal`, `drive` | `signal` |
| Fuzz | `signal`, `drive` | `signal` |
| Saturate | `signal`, `drive` | `signal` |
| Wavefold | `signal`, `drive` | `signal` |

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

While dragging a new link, press `a` to create it in `add` mode, `m` for `multiply` mode, or `s` for `set` mode (the default). The live link changes colour to preview the selected mode.

This order matters. A frequency input with a local value of `80`, an `add` link carrying `1`, and no other links resolves to roughly `81`. A `set` link carrying a slow oscillator around `-1..1` sets the input near those values, rather than multiplying the local `80`.

Static values from nodes like `Constant` and static `Expression` outputs are folded by the compiler. Audio-rate values are lowered onto the `visual-fm` WASM modulation lanes, preserving the engine's smoothing and click-free behavior.

## Areas

Create a visual area by Cmd/Ctrl-dragging on the canvas. Click its title to edit it and select the whole name, ready to replace; double-clicking the title also selects its text without collapsing the area, and leaving an empty title when editing finishes restores `Area`. An area or node belongs inside another area only when its top-left corner is inside it, so touching edges and other partial overlaps do not link their movement. Drag the lower edge of an expanded area header to make a dashed UI section for user-facing controls such as sliders and sequencers. When the area is collapsed, that UI section remains visible and usable, while the lower functional section is hidden. UI nodes become display-only: their pins, node editing, moving, and resizing are disabled, and their external cables are presented at the area header instead.

## Editor controls and shortcuts

Shortcuts are ignored while editing text or numeric fields unless noted otherwise.

| Shortcut or gesture | Action |
| --- | --- |
| `Space` | Start or stop audio playback. |
| `Cmd/Ctrl+Z` | Undo. |
| `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` | Redo. |
| `Cmd/Ctrl+C`, `Cmd/Ctrl+V` | Copy and paste selected nodes. |
| `Backspace` or `Delete` | Delete the selected nodes, links, subpatch boundary port, or area. |
| `Cmd/Ctrl+Backspace` or `Cmd/Ctrl+Delete` | Delete selected nodes while bridging compatible incoming and outgoing links. |
| `A`, `S`, `M` | Set a new or selected link to add, set, or multiply mode. |
| `X` | Enable or disable the selected links. |
| `1`…`9` | Set the selected Selector node to the corresponding input. |
| `Cmd/Ctrl+0` | Reset canvas zoom to 100%. |
| `Shift` or `Cmd` while selecting | Add to the current selection. |
| `Alt`-drag selected nodes | Duplicate the selected graph. Add `Cmd`, `Ctrl`, or `Shift` to preserve links between the duplicates and unselected nodes. |
| `Cmd`, `Ctrl`, or `Alt` while reconnecting a link endpoint | Keep the original link and create the reconnected link as a duplicate. |
| Drag empty canvas | Rectangle-select nodes and their connected links. |
| `Cmd/Ctrl`-drag empty canvas | Create an area. The gesture can switch between area creation and rectangle selection while the modifier is pressed or released. |
| Double-click empty canvas | Create a new untyped node at the pointer. |
| Double-click a link | Insert a new node into that link. |
| Double-click a Group node | Enter and edit its subpatch. |
| Scroll | Pan the canvas. |
| Pinch | Zoom the canvas. |

The floating controls provide play/stop (`PL`), recording, MIDI device settings (`MD`), patch save/load (`SV`/`LD`), undo/redo (`UN`/`RE`), grouping (`GR`), new patch (`NW`), subpatch import (`IM`), and selected-node scaling (`S+`/`S-`). Pressing record while playback is stopped arms recording at `0:00`; capture begins when playback starts. The zoom percentage button resets zoom to 100%. Node and area header titles receive stepped size boosts below 70%, at 50%, and at 30% canvas zoom so they remain readable while zoomed out. The adjacent `CPU` meter fills from left to right while audio is running to show the DSP worklet's share of each audio-block deadline; hover it for the percentage.

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

Themes are selected with `--theme=NAME` (or `--theme NAME`). Available presets are `console` (green phosphor), `amber` (warm orange), and `ocean` (cool blue); for example, `./start --theme=amber`. The default theme preserves the original monochrome appearance. Sample waveform boundaries and envelope guides use contrasting colors for visibility; in the ocean theme, the start marker and attack guide are green. Palette and font tokens live in `web/src/themes.css`; add a `:root[data-theme='NAME']` block there to create another theme.

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
