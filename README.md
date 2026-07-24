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
- `Spread`: repeats the nodes placed inside its resizable area at runtime.
- `Spawn`: creates a new, independent runtime copy of the nodes inside its resizable area on each trigger.
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
- `Custom Wave`: generates an editable breakpoint waveform with loop, one-shot, ping-pong, and sustain modes. Its `end trigger` output emits a one-sample pulse when playback completes: at each wrap in loop modes, after the return trip in ping-pong modes, at the hold point in sustain mode, and at the endpoint in one-shot mode. Retriggering resets playback without producing an end pulse. Its `baseLevel` input (default `0`) sets the locked start/end points and the value held while a one-shot is idle or complete, clamping to the configured output range when necessary. Its scope-style grid shows that range; zooming into the canvas reveals denser grid divisions and more scale labels while the grid stays screen-thin, the waveform stroke scales with canvas zoom like a cable, and labels stay screen-relative with a small capped size increase at high zoom for legibility. Edit points retain their screen-relative size down to 70% canvas zoom, then progressively shrink to avoid overwhelming the waveform when zoomed farther out. Hovering or dragging an edit point shows its value in the configured Y-axis range. Saved curve points remain normalized and range-independent. Point drags update the live DSP at a limited rate, morph smoothly between curve revisions without rebuilding the graph, and always commit the final position after release.
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
- `Quantise`: snaps incoming frequency values in Hz to the nearest note in a selected scale and root, preserving the sign for reverse-playback frequency signals. Scale choices include chromatic, major, minor, modal, pentatonic, blues, whole-tone, and diminished scales; roots use note-and-octave labels such as `C1` and `F#3`.
- `Abs`: outputs the absolute value of the input signal.
- `Map`: remaps a signal from one numeric range to another.
- `Clamp`: limits a signal to a minimum and maximum.
- `Multiply`: multiplies a signal by a factor.
- `pow`: raises the signal to an exponent.
- `Pan`: splits a signal into equal-power `left` and `right` outputs from a `pan` value, where `-1` is left, `0` is center, and `1` is right.
- `Delay`: applies delay with time, feedback, and wet/dry mix controls. A time of `0` bypasses the delay; positive times resolve to at least one audio sample.
- `Chorus`: applies a modulated delay chorus effect.
- `Reverb`: applies a reverb effect with size, decay, mix controls, and `left`/`right` outputs.
- `Compress`: applies dynamics compression with optional sidechain, threshold, ratio, attack, release, knee, and makeup controls.
- `Limiter`: applies lookahead limiting with input gain, ceiling, release, and lookahead controls.
- `Envelope`: creates an envelope with trigger/gate inputs and delay, attack, decay, sustain, gate-length, and release controls. Its `end trigger` output emits a one-sample pulse when the release stage finishes.
- `Follower`: follows the amplitude contour of a signal with attack/release smoothing.
- `Ring Mod`: multiplies a signal by a modulation amount for ring-mod-style tones.
- `Fold`: folds a signal back on itself for wavefolding.
- `Meter`: measures a signal level for display and downstream control. It uses the shared adaptive chart grid: resizing or canvas zoom changes the grid and legend detail while preserving thin screen-relative chart strokes and legible labels.
- `Scope`: shows an oscilloscope-style view of the signal. Canvas zoom increases its grid and scale-label detail while preserving thin screen-relative chart strokes, with a small capped label-size increase at high zoom.
- `FFT`: analyses an input signal and shows its live frequency spectrum as logarithmically grouped bars in a wide, resizable display. `minFreq` and `maxFreq` set an analysis window from 20 Hz to 20 kHz; drag the two coloured boundaries directly on the chart to adjust them. The full spectrum is still calculated for display while bars outside the window fade. Its frequency grid and legends adapt to node size and canvas zoom through the same shared chart grid as Meter. The `frequency` output reports the strongest spectral frequency inside the selected window in hertz, and `amplitude` reports that frequency's linear amplitude at visualization/control rate. If the window contains no measurable spectral energy, both outputs are `0`.
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

The signature notation below is `inputs -> outputs`. Port names are the names used by patch links. On standard nodes, an output named `signal` stays on the header even when the node has additional outputs; those additional outputs remain in the body. `Expression`, `Group`, `Ins`, and `Outs` have patch-defined ports; Sequencer row outputs and Selector value inputs also expand dynamically.

| Node | Inputs | Outputs |
| --- | --- | --- |
| Expression | dynamic expression variables | `value` |
| Group | dynamic subpatch inputs | dynamic subpatch outputs |
| Spread | count | item index |
| Spawn | `trigger`, internal-only `kill trigger` | none |
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
| Custom Wave | `frequency`, `phase`, `trigger`, `baseLevel`, `rangeMin`, `rangeMax` | `signal`, `end trigger` |
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
| Quantise | `signal`, `scale`, `root` | `signal` |
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
| Envelope | `signal`, `trigger`, `gate`, `delay`, `attack`, `decay`, `sustain`, `gateLength`, `release` | `signal`, `end trigger` |
| Follower | `signal`, `attack`, `release` | `signal` |
| Ring Mod | `signal`, `amount` | `signal` |
| Fold | `signal`, `amount` | `signal` |
| Meter | `signal`, `range`, `mode` | `signal` |
| Scope | `signal`, `range`, `mode`, `length` | `signal` |
| FFT | `signal`, `minFreq`, `maxFreq` | `frequency`, `amplitude` |
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

Create a visual area by Cmd/Ctrl-dragging on the canvas, or choose `Area` from a node's type dropdown to replace that node with an area at the same position and size. This conversion removes the node's links and is one-way because areas do not have node type dropdowns. Drag an area by any empty part of its header or by its title. Click its title without dragging to edit it and select the whole name, ready to replace; double-clicking the title also selects its text without collapsing the area, and leaving an empty title when editing finishes restores `Area`. Selecting, moving, or interacting with an Area, Spread, or Spawn raises all of its contained nodes together while preserving their internal layer order. An area or node belongs inside another area only when its top-left corner is inside it, so touching edges and other partial overlaps do not link their movement. Locking an Area, Spread, or Spawn freezes that membership and prevents its resize handles from crossing the full visual bounds of its member nodes; unlocked containers retain unrestricted resizing. Drag the lower edge of an expanded area header to make a dashed UI section for user-facing controls such as sliders and sequencers. When the area is collapsed, that UI section remains visible and usable, while the lower functional section is hidden. UI nodes become display-only: their pins, node editing, moving, and resizing are disabled, and their external cables are presented at the area header instead.

## Spreads

Choose `Spread` from a node's type picker to create a functional area. A Spread uses the same header, title editing, lock, collapse, resizing, nesting, membership, and movement interactions as an Area. Its fixed control strip sits immediately below the header: `count` uses a normal boundary input on the left, and the inward-facing `item index` pin follows immediately after the count editor on the same row. When the Spread is collapsed, the control strip and count input remain visible while the internal-only `item index` pin is hidden.

A node is part of an unlocked Spread when its top-left corner is inside the functional body below the control strip. Locking the Spread preserves the same membership snapshot used by Areas, including after a member is moved outside the visible bounds. Unlike a visual Area, a Spread changes the DSP graph:

- `count` selects how many items are active. It is a non-negative integer with no Spread-specific maximum and may be linked like any other input.
- `item index` produces the user-facing, one-based index of each active item (`1` through `count`). It may only be linked to nodes inside that Spread.
- Links between two contained nodes are copied within each item. Links entering the Spread are copied to every item, and links leaving it contribute one signal per active item using the link's existing `set`, `add`, or `multiply` behavior.

The compiler emits the contained graph once as a repeatable DSP template. The WASM engine floors the `count` signal at zero, samples it once at the start of each audio buffer, and runs that template only for the active items. Each item keeps independent DSP state, allocated as the runtime count grows; there is no Spread count ceiling, so very large values can exhaust CPU or memory. Group, Spawn, and nested Spread nodes are not currently supported inside a Spread; place their underlying nodes directly in the Spread instead.

## Spawns

Choose `Spawn` from a node's type picker to create an event-driven functional area with the same header, resizing, nesting, membership, movement, lock, and collapse interactions as a Spread. Its control strip has no output pins: `trigger` is a normal boundary input on the left, while the inward-facing `kill trigger` input is visible only when the Spawn is expanded.

- A rising edge on `trigger` creates a new runtime instance of every contained node. Existing instances continue independently, so retriggering does not reset or replace them.
- `kill trigger` may only be driven by a node inside that Spawn. A rising edge produced by an instance removes that instance and its complete contained-node state without affecting the other live instances.
- Links between contained nodes are copied within each instance. Links entering the Spawn are shared with every live instance, while links leaving it combine one signal from each live instance using the link's existing `set`, `add`, or `multiply` behavior.
- A Spawn has no fixed voice limit. Instances remain alive until their own kill trigger fires, so a missing kill path or a very fast trigger can consume increasing CPU and memory.

The compiler emits the contained graph once as a reusable DSP template, and the WASM engine allocates a fresh state set for each trigger. Group, Spread, and nested Spawn nodes are not currently supported inside a Spawn; place their underlying nodes directly in the Spawn instead.

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
