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
When changing an existing node's type, local input values carry over only to inputs with the same name; other inputs use the new node type's defaults.

- `Expression`: evaluates a typed expression and outputs the result as a signal/control value. It supports arithmetic (`+`, `-`, `*`, `/`), comparisons (`<`, `<=`, `>`, `>=`, `==`, `!=`), logical operators (`&&`, `||`, `!`), and numeric booleans: `true` and successful conditions output `1`, while `false` and failed conditions output `0`. Any nonzero signal is truthy in a logical expression.
- `Group`: wraps a subpatch so a reusable patch can live inside a single node. An Area inside the subpatch named `UI` or `Controls` (case-insensitive) exposes its contained nodes as a control panel above the Group's unchanged input/output ports. Projected control values are local to each Group instance while subpatch structure and defaults remain shared between clones.
- `Spread`: repeats the nodes placed inside its resizable area at runtime.
- `Spawn`: creates a new, independent runtime copy of the nodes inside its resizable area on each trigger.
- `Ins`: exposes subpatch input ports while editing a subpatch.
- `Outs`: exposes subpatch output ports while editing a subpatch.

Dragging a new link or reconnecting an existing link endpoint onto the temporary port shown on `Ins` or `Outs` creates the corresponding subpatch input or output.

- `Audio Out`: sends mono graph signals to the stereo hardware output via `both`, `left`, or `right`, with a final `level` control.
- `Sine Osc`: generates a sine oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Triangle Osc`: generates a triangle oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Saw Osc`: generates a saw oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Ramp Osc`: generates a ramp oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Square Osc`: generates a square oscillator signal with frequency, phase, phase-reset, and output-range controls.
- `Sample Hold`: samples an incoming signal when triggered and holds that value.
- `Perlin Noise`: generates smooth noise at a controllable speed.
- `Noise`: generates raw noise.
- `Random`: generates and holds an independent random value when playback starts, then generates a new value on each rising edge at `trigger`. Each node has its own random sequence, and playback restarts reseed all Random nodes. `rangeMin` and `rangeMax` map the held value to the requested range.
- `Audio Input`: brings a microphone or input device into the patch with gain/level controls.
- `Custom Wave`: generates an editable breakpoint waveform with loop, one-shot, ping-pong, and sustain modes. Its `end trigger` output emits a one-sample pulse when playback completes: at each wrap in loop modes, after the return trip in ping-pong modes, at the hold point in sustain mode, and at the endpoint in one-shot mode. Retriggering resets playback without producing an end pulse. Its `baseLevel` input (default `0`) sets the locked start/end points and the value held while a one-shot is idle or complete, clamping to the configured output range when necessary. Its scope-style grid shows that range; zooming into the canvas reveals denser grid divisions and more scale labels while the grid stays screen-thin, the waveform stroke scales with canvas zoom like a cable, and labels stay screen-relative with a small capped size increase at high zoom for legibility. Edit points retain their screen-relative size down to 70% canvas zoom, then progressively shrink to avoid overwhelming the waveform when zoomed farther out. Hovering or dragging an edit point shows its value in the configured Y-axis range. Saved curve points remain normalized and range-independent. Point drags update the live DSP at a limited rate, morph smoothly between curve revisions without rebuilding the graph, and always commit the final position after release.
- `Sample`: plays a selected, uploaded, or microphone-recorded sample with frequency/original-frequency pitch tracking, trigger, polyphony, region, envelope, stretch, granular-style mode, and level controls. `frequency` defaults to `440` Hz. The picker accepts audio files and MP4 video files up to 1 GB. MP4 uploads retain the original file in `samples/` and use `ffmpeg` to create a maximum 640×480 H.264/AAC editor proxy beside it. Every proxy frame is a keyframe for fast arbitrary-frame seeking, and its MP4 metadata is placed at the front for quick loading. The Sample node selects the proxy, decodes and plays its audio track, and shows its video above the waveform; the original filename and URL remain in the saved asset metadata for full-quality video work. Existing MP4 files without a proxy continue to load directly and require browser support for their embedded audio and video codecs. While idle, the preview follows the sample's `start` position, including while its boundary is dragged. A warm decoder pre-seeks that position and keeps a small cache of recently decoded start frames so repeated sequencer jumps can display immediately. During playback it follows the DSP playhead exactly, including reverse or stretched playback; when voices overlap, it follows the most recently triggered voice. Positive frequency plays from `start` to `end`; negative frequency swaps the effective boundaries and plays from `end` to `start`; zero pauses the playhead. Active voices appear as playheads on the sample waveform, and stopping audio clears them. Structural DSP edits preserve active playback for unchanged Sample nodes, including their voice positions, envelopes, and stretch state. With `voices` set to `1`, playback follows live parameter changes; with more than one voice, each voice keeps the parameter values captured by its trigger. The sample picker can record from the microphone; stopping converts the capture to PCM WAV, prompts for a name, saves the `.wav` file in `samples/`, and selects it for the node.
- `Image`: samples brightness, RGB, hue, and saturation from an uploaded image at an `x`/`y` position.
- `Buffer`: records and plays a rolling audio buffer from signal, playhead, record-head, speed, and length controls. `playhead speed` and `record head speed` are independent rates where `1` is real time, `0` pauses, and negative values run backward. An incoming connection to `playhead` or `record head` overrides that head's speed and follows the connected position instead; without a connection, the corresponding position value is the starting point after reset. Its resizable waveform shows the current playhead and red record head; the `CLEAR` button in its lower-right corner empties the recording immediately. Each sample is recorded before the main `signal` output is read, so coincident playhead and record-head positions return the newly written sample. `record head out` still reads the existing sample at the record head before the new sample is written, enabling overdub and feedback patches. `on reset` can clear the recording on each transport reset or preserve it between plays. Cloning a Buffer with Alt-drag or copy/paste copies its current recording into independent buffer memory, so subsequent recording changes do not affect the source. Preserved contents on ordinary and Group-contained Buffer nodes are checkpointed to IndexedDB every five seconds while audio runs, when audio stops, and when the page becomes hidden, then restored after a refresh. Per-item Spread and per-instance Spawn Buffer contents remain runtime-only because those dynamic copies do not have stable patch identities. Changing a non-silent Buffer node's type to Sample asks whether to use its content and lets you name the WAV: `Yes` saves it in `samples/` and preselects it, while `No` converts without creating an asset. An empty all-zero buffer converts directly.
- `Playhead`: outputs a wrapping playback position from `0` to `1`. `length` sets the cycle duration in seconds, `speed` is a playback-rate multiplier (`1` is real time, `2` is double speed, and negative values run backward), and `start` offsets the normalized starting position. A rising edge at `reset trigger` returns the playhead to `start`.
- `Time`: outputs elapsed time in seconds.
- `freq2length`: converts a frequency in hertz to the duration in seconds of one full cycle (`1 / frequency`).
- `length2freq`: converts the duration in seconds of one full cycle back to frequency in hertz (`1 / length`).
- `Constant`: outputs a fixed numeric value.
- `Pass`: passes a signal through unchanged.
- `Slider`: provides a playable UI control, optionally driven by MIDI CC, that outputs a mapped signal. Hovering the node shows its live mapped output followed by its normalized `0`–`1` value in parentheses, including updates from the slider, MIDI, or a connected `value` input.
- `Joystick`: provides a resizable two-dimensional UI control whose draggable square outputs independently mapped `x` and `y` positions. Each axis has its own min/max range and optional MIDI channel/CC mapping; the square's normalized position runs from `0` at left/bottom to `1` at right/top. `elasticity` defaults to `0`, which leaves the square where it is released; positive values return it to the centre at that normalized-unit-per-second speed, with larger values returning faster.
- `Button`: provides a playable UI button, optionally driven by MIDI CC, for gate/toggle/trigger-style control.
- `Keys`: provides an on-canvas keyboard with configurable size and starting MIDI note, outputting MIDI note and frequency.
- `Sequencer`: offers Trigger mode for the original clickable pulse grid and Gate mode for freely positioned, edge-resizable intervals. Clicking to create a gate snaps its start to the leading edge of the selected grid square. Gates in a row never overlap: creating, moving, and resizing stops at neighboring gates, creation uses the available gap when it is shorter than a full step, and mode conversion resolves overlaps by shortening the earlier gate's end. Drag a step's top edge down to lower its velocity from `1` to a minimum of `0.1`, so the row output emits that smaller value when the step triggers or gates; `signal` advances the sequence, `reset` restarts it, each row has its own output, and `trigger index` emits the 1-based index of the first active row. Pattern, timing, velocity, length, and Trigger/Gate mode edits update the running sequencer in place without resetting its playhead or recompiling the DSP graph; changing the row count still recompiles because it changes the node's output ports.
- `Tempo`: outputs clock triggers and matching frequency values from 4-bar divisions down to thirty-seconds, with BPM, swing, internal/MIDI source, and MIDI-source selection.
- `MIDI Note`: tracks the most recently pressed held note as a monophonic note, frequency, velocity, gate, and note-on trigger source.
- `MIDI Note On`: emits queued one-sample note, frequency, and velocity values for MIDI note-on events, with zero-valued separator samples between events.
- `MIDI Note Off`: emits queued one-sample note and frequency values for MIDI note-off events, with zero-valued separator samples between events.
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
- `Envelope`: creates an envelope with trigger/gate inputs and delay, attack, decay, sustain, gate-length, and release controls. It stays closed while both event inputs are idle or unconnected, opens on a trigger or gate, and its `end trigger` output emits a one-sample pulse when the release stage finishes.
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
| Spawn | `trigger`, `release trigger`, internal-only `kill trigger` | internal-only `instance gate` |
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
| Random | `trigger`, `rangeMin`, `rangeMax` | `signal` |
| Audio Input | `gain`, `level` | `signal` |
| Custom Wave | `frequency`, `phase`, `trigger`, `baseLevel`, `rangeMin`, `rangeMax` | `signal`, `end trigger` |
| Sample | `frequency`, `originalFrequency`, `trigger`, `voices`, `start`, `end`, `attack`, `release`, `stretch`, `cycleLength`, `overlapRatio`, `mode`, `level` | `signal` |
| Image | `x`, `y` | `brightness`, `r`, `g`, `b`, `hue`, `saturation` |
| Buffer | `signal`, `playhead`, `playhead speed`, `record head`, `record head speed`, `length`, `on reset` | `signal`, `record head out` |
| Playhead | `start`, `speed`, `length`, `reset trigger` | `playhead` |
| Time | — | `seconds` |
| freq2length | `frequency` | `length` |
| length2freq | `length` | `frequency` |
| Constant | `value` | `signal` |
| Pass | `signal` | `signal` |
| Slider | `signal`, `value`, `min`, `max`, `direction`, `midiChannel`, `midiCc` | `signal` |
| Joystick | `xMin`, `xMax`, `xMidiChannel`, `xMidiCc`, `yMin`, `yMax`, `yMidiChannel`, `yMidiCc`, `elasticity` | `x`, `y` |
| Button | `signal`, `mode`, `midiChannel`, `midiCc` | `signal` |
| Keys | `size`, `startNote` | `midi note`, `frequency` |
| Sequencer | `steps`, `rows`, `beatLength`, `mode`, `signal`, `reset` | row outputs `1`…`16` (according to `rows`), `trigger index` |
| Tempo | `bpm`, `swing`, `source`, `midiSource` | `4 bar`, `2 bar`, `bar`, `whole`, `half`, `quarter / beat`, `upbeat`, `eighth`, `sixteenth`, `thirty-second`, plus a matching `… freq` output for each |
| MIDI Note | `channel` | `note`, `frequency`, `velocity`, `gate`, `trigger` |
| MIDI Note On | `channel` | `note`, `frequency`, `velocity` |
| MIDI Note Off | `channel` | `note`, `frequency` |
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

Create a visual area by Cmd/Ctrl-dragging on the canvas, or choose `Area` from a node's type dropdown to replace that node with an area at the same position and size. This conversion removes the node's links and is one-way because areas do not have node type dropdowns. Drag an area by any empty part of its header or by its title. Alt-drag an Area, Spread, or Spawn to clone the complete container hierarchy and its contained graph; add Cmd, Ctrl, or Shift to retain links between the cloned nodes and nodes outside the container. Click its title without dragging to edit it and select the whole name, ready to replace; double-clicking the title also selects its text without collapsing the area, and leaving an empty title when editing finishes restores `Area`. Expanding, selecting, moving, or interacting with an Area, Spread, or Spawn raises the container and all of its contained nodes above unrelated canvas content while preserving their internal layer order; interacting elsewhere then applies the normal selection and recency layering rules. An area or node belongs inside another area only when its top-left corner is inside it, so touching edges and other partial overlaps do not link their movement. Locking an Area, Spread, or Spawn freezes both its node membership and nested-container membership at that moment: nodes or containers created or moved into its bounds afterward do not move with it. Locked resize handles cannot cross the full visual bounds of the snapshotted member nodes; unlocked containers retain unrestricted resizing and live top-left-corner membership. Drag the lower edge of an expanded area header to make a dashed UI section for user-facing controls such as sliders and sequencers. When the area is collapsed, that UI section remains visible and usable, while the lower functional section is hidden. UI nodes become display-only: their pins, node editing, moving, and resizing are disabled. External cables belonging to actual member nodes are presented at the area header instead; merely overlapping a locked Area, Spread, or Spawn does not reroute a node's cables.

Areas are stored at the patch level, so subpatches keep independent area layouts. Inside a Group subpatch, name an Area exactly `UI` or `Controls` (ignoring case) to expose every member node on the parent Group. A panel matching the Area's content bounds, excluding its header, appears above the Group's normal ports. Projected nodes remain usable as controls and retain live visual feedback, while pins, type editing, movement, and resizing stay disabled. Their headers use the normal background and foreground colours as control labels; clicking one does not select the Group. Values changed through this projected panel are saved as overrides on that Group instance; editing the same nodes inside the subpatch changes the shared defaults instead. A cloned Group initially copies the source instance's overrides and then changes independently. Double-click a projected node's header to clear all overrides for that node and restore the current shared defaults. Double-click the Group itself to edit the layout inside the subpatch; locked Area membership is respected.

## Spreads

Choose `Spread` from a node's type picker to create a functional area. A Spread uses the same header, title editing, lock, collapse, resizing, nesting, membership, and movement interactions as an Area. Its fixed control strip sits immediately below the header: `count` uses a normal boundary input on the left, and the inward-facing `item index` pin follows immediately after the count editor on the same row. When the Spread is collapsed, the control strip and count input remain visible while the internal-only `item index` pin is hidden.

A node is part of an unlocked Spread when its top-left corner is inside the functional body below the control strip. Locking the Spread preserves the same membership snapshot used by Areas, including after a member is moved outside the visible bounds. Unlike a visual Area, a Spread changes the DSP graph:

- `count` selects how many items are active. It is a non-negative integer with no Spread-specific maximum and may be linked like any other input.
- `item index` produces the user-facing, one-based index of each active item (`1` through `count`). It may only be linked to nodes inside that Spread.
- Links between two contained nodes are copied within each item. Links entering the Spread are copied to every item, and links leaving it contribute one signal per active item using the link's existing `set`, `add`, or `multiply` behavior.

The compiler emits the contained graph once as a repeatable DSP template. The WASM engine floors the `count` signal at zero, samples it once at the start of each audio buffer, and runs that template only for the active items. Each item keeps independent scalar DSP state and mutable node resources, including Sample playback voices, effect delay memory, Limiter lookahead, and Buffer recordings. Sample and Custom Wave visualizations inside the Spread show every active item's playhead, cycling through four line colors to make overlapping items easier to follow. State is allocated as the runtime count grows; there is no Spread count ceiling, so very large values—especially with memory-heavy nodes—can exhaust CPU or memory. Group, Spawn, and nested Spread nodes are not currently supported inside a Spread; place their underlying nodes directly in the Spread instead.

## Spawns

Choose `Spawn` from a node's type picker to create an event-driven functional area with the same header, resizing, nesting, membership, movement, lock, and collapse interactions as a Spread. Spawn areas have a minimum width of 480 pixels so their lifecycle controls remain distinct. The header shows the current number of live instances after the Spawn title, such as `Spawn (3)`. In its control strip, the external `trigger` and `release trigger` boundary inputs are stacked on the left, while the inward-facing `instance gate` output and `kill trigger` input are visible only when the Spawn is expanded.

- A value rising to `0.5` or above on `trigger` creates a new runtime instance of every contained node and tags that instance with the numeric trigger value. Existing instances continue independently, so retriggering does not reset or replace them. Return the signal to `0` between events to arm the next rising edge.
- A value rising to `0.5` or above on `release trigger` finds every live instance whose tag matches that numeric value and lowers its `instance gate` from `1` to `0`. For example, triggering with `35` and later release-triggering with `35` releases all live instances tagged `35`. Return this signal to `0` between release events as well.
- `instance gate` is an internal-only signal owned by each instance. It starts at `1`; a matching `release trigger` changes it to `0`. The contained graph decides how to respond—for example, by beginning an envelope release or allowing a Buffer tail to finish.
- `kill trigger` may only be driven by a node inside that Spawn. A rising edge produced by an instance removes that instance and its complete contained-node state without affecting the other live instances.
- Links between contained nodes are copied within each instance. Links entering the Spawn are shared with every live instance, while links leaving it combine one signal from each live instance using the link's existing `set`, `add`, or `multiply` behavior.
- A Spawn has no fixed voice limit. Instances remain alive until their own kill trigger fires, so a missing kill path or a very fast trigger can consume increasing CPU and memory.

For MIDI-controlled Spawn voices, connect `MIDI Note On.note` to `Spawn.trigger` and `MIDI Note Off.note` to `Spawn.release trigger`. Inside the Spawn, instance-local Sample & Hold nodes can capture `MIDI Note On.note`, `frequency`, and `velocity` when `instance gate` first rises. Connect `instance gate` to the voice envelope gate and route the envelope's `end trigger` back to `kill trigger`. MIDI note `0` is currently indistinguishable from the event nodes' idle zero output and therefore cannot tag a Spawn instance.

The compiler emits the contained graph once as a reusable DSP template, and the WASM engine allocates a fresh state set for each trigger. Both scalar DSP state and mutable node resources are instance-local, so Sample playback, Delay, Chorus, Reverb, Comb/Notch, Limiter lookahead, and Buffer memory advance independently in overlapping instances. Sample and Custom Wave visualizations inside the Spawn show every live instance's playhead, cycling through four line colors to make overlapping instances easier to follow. Immutable assets and external sources such as decoded sample data, images, audio input, MIDI, and tempo transport remain intentionally shared. Group, Spread, and nested Spawn nodes are not currently supported inside a Spawn; place their underlying nodes directly in the Spawn instead.

Live graph recompilation migrates Spawn instances and Spread items by stable container and node IDs. Unchanged nodes retain their scalar state and mutable Sample/effect/Buffer resources, removed nodes discard only their own state, and newly added nodes start with clean state. This keeps existing voices and repeated items running while a template is edited.

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
| `Alt`-drag an Area, Spread, or Spawn | Duplicate the complete container hierarchy and contained graph. Add `Cmd`, `Ctrl`, or `Shift` to preserve links to nodes outside it. |
| `Cmd`, `Ctrl`, or `Alt` while reconnecting a link endpoint | Keep the original link and create the reconnected link as a duplicate. |
| Drag empty canvas | Rectangle-select nodes and their connected links. |
| `Cmd/Ctrl`-drag empty canvas | Create an area. The gesture can switch between area creation and rectangle selection while the modifier is pressed or released. |
| Double-click empty canvas | Create a new untyped node at the pointer. |
| Double-click a link | Insert a new node into that link. |
| Double-click a Group node | Enter and edit its subpatch. |
| Double-click a projected control node header | Reset every value on that node to the subpatch defaults for this Group instance. |
| Scroll | Pan the canvas. |
| Pinch | Zoom the canvas. |

Resizable visual nodes without a saved size initially fit their visible labels and controls. Dragging a resize corner switches the node to an explicit size that is preserved with the patch. Image, Sequencer, Spread, and Spawn retain their type-specific initial geometry.

The floating controls provide play/stop (`PL`), recording, MIDI device settings (`MD`), patch save/load (`SV`/`LD`), undo/redo (`UN`/`RE`), grouping (`GR`), new patch (`NW`), subpatch import (`IM`), and selected-node scaling (`S+`/`S-`). The current editor state is stored in the browser as it changes, including when `NW` replaces the graph, and the latest state is restored after a refresh. Pressing record while playback is stopped arms recording at `0:00`; capture begins when playback starts. When a recording contains at least one triggered MP4 video sample, its saved WAV has a same-stem CSV beside it in `recordings/` (for example, `performance.wav` and `performance.csv`); audio-only recordings save only the WAV. The CSV contains one row for every triggered playback from an MP4 Sample node, sorted by trigger time; audio-only sample events are omitted. Its `node_id` and `sample_name` columns identify the source; the remaining columns record source-region start/end in milliseconds, effective speed ratio (`1` is real time, including pitch and stretch), volume, attack/release in milliseconds, and trigger time relative to the start of the recording. The zoom percentage button resets zoom to 100%. Node and area header titles receive stepped size boosts below 70%, at 50%, and at 30% canvas zoom so they remain readable while zoomed out. The adjacent `CPU` meter fills from left to right while audio is running to show the DSP worklet's share of each audio-block deadline; hover it for the percentage.

Saving a patch first checkpoints every preserved ordinary or Group-contained Buffer. Patch JSON stores only each Buffer's SHA-256 hash, sample rate, and sample count. In local/server patch-storage mode, raw Float32 contents are kept as content-addressed `.f32` files in the internal `buffers/` directory; a save asks the server which hashes are missing and uploads only new contents, so unchanged buffers are shared by consecutive patch versions. Loading a version fetches any content not already cached in IndexedDB and restores it into the audio engine. The `buffers/` directory is deliberately not exposed as a user-facing asset library. Clearing the browser's site data removes refresh checkpoints, but server-saved patch versions remain loadable from `buffers/`.

To turn the Sample events in one of those CSV files back into a chopped video, install `ffmpeg`/`ffprobe` and run:

```bash
npm run remix:video -- recordings/performance.csv
```

The output defaults to `recordings/performance-remixed.mp4`. For every `sample_name` in the CSV, the script loads the matching sample from `samples/`, skipping it and its events with a warning when it has no video stream, so older CSVs containing audio-only sample events remain usable. One remix can use events from multiple source videos. The first video source determines the output dimensions, frame rate, and audio sample rate; other video sources are normalized to match. The script preserves reverse playback, pitch-changing speed, volume, attack, release, and source audio. It also warns and skips rows whose source region is empty or entirely outside its video; the export fails only when no usable video rows remain. Pass `--pre 0.25` or `--post 0.5` to add that many seconds of source-video context before or after every clip; fractional seconds are accepted, available source media limits the handles, and the added portions are silent. Add `--faded-extensions` to render only that pre/post footage in grayscale at 50% opacity; overlap modes reveal the underlying composition, while the default montage composites the same appearance over black. In the default cut mode these handles extend the montage and delay each clip's unchanged audio by its available pre-roll. With an overlap mode they extend only the visual voice around its original recording-timeline trigger, leaving every audio trigger unchanged. By default, each new trigger cuts off the preceding clip. Pass `--overlap-opacity` to mix every active voice while using the oldest active video as the full-strength base and layering each newer clip over it at 50% opacity; a clip returns to full opacity when it is the only active one. Pass `--overlap-split` to mix every active voice while dividing the frame into equal vertical source slices in trigger order; the remaining clips dynamically expand into the available slices as voices finish. Pass `--overlap-grid` to analyze the maximum simultaneous voice count, create the smallest near-square grid that fits it, and place each video into a fixed cell using an aspect-preserving centered crop rather than stretching it; cells remain stable as other voices finish. The overlap options are mutually exclusive.

Because the CSV does not contain the recording stop time, the export ends one median trigger interval after the final trigger; override that last duration with `--final-duration-ms 1000` when needed. With a single event, its full source-region duration is used. Use `--samples-dir path` to override the default `samples/` directory, `-o output.mp4` to choose an output path, `--sample-name name.mp4` to restrict a multi-source CSV to one source, and `--overwrite` to replace an existing output.

## Compiler And Engine Boundary

The active compiler is `web/src/audio/dspProgram.ts`. It expands subpatches, combines input links with the rule above, and emits a `DspProgram` for the worklet. The editor sends that program with `dspProgram` messages, and value-only changes use `dspValues`.

The old link-centric `WasmAudioGraph` TypeScript compiler has been removed. Current playback fixes should target `web/src/audio/dspProgram.ts` and the `DspProgram` sync path in the worklet.

The worklet in `web/public/audio/audio-worklet-wasm.js` loads the `visual-fm` WASM kernel and syncs the compiled `DspProgram` into it. User-facing patch links target nodes or the audio output; any remaining inherited link-centric WASM API names are implementation details, not the patch philosophy.

Spawn instances and Spread items execute a shared compiled template with separate runtime state. Small numeric histories use a packed per-instance state block that the template mutates directly through an active state view. Sample playback receives its instance-owned state by mutable reference, avoiding per-sample restore/capture copies across its voice slots, and its render loop visits only slots up to the highest voice that may still be active. Memory-backed effect and Buffer resources remain per-instance; their storage is moved into the kernel workspace by pointer swap for template execution and moved back afterward without copying buffer contents.

The engine supports up to 64 compiled buffered effects (`Delay`, `Chorus`, `Reverb`, Comb/Notch, and `Limiter`) and 16 compiled `Buffer` nodes. Each compiled node receives an explicit resource slot; exceeding either limit is a compiler error rather than causing two nodes to share memory. Spawn and Spread runtime copies reuse their template's compiled slot while owning separate buffer contents.

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

`./start` checks the Rust/WASM kernel before launching and rebuilds it when it is missing or older than its Rust sources or build inputs. It then serves the editor on port `5174` by default, generates a self-signed HTTPS certificate when `openssl` is available, prints LAN URLs for another device or projector, and supports `--port=PORT`, `--patch-storage=local`, and `--patch-storage=browser`. Direct `npm start`, `npm run dev`, and `npm run preview` run the same WASM preflight.

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

Render the MIDI note path:

```sh
node scripts/render-worklet-startup.mjs 1 --midi-note
```

Manual MIDI check:

1. Add a MIDI Note node, Sine Osc, and Audio Out.
2. Connect `MIDI Note.frequency` to `Sine Osc.frequency`, then `Sine Osc.signal` to `Audio Out.both`.
3. Start audio and allow MIDI access when prompted.
4. Hold a note, then press another. MIDI Note should follow the newest held note; releasing it should restore the most recently pressed note still held, and releasing all notes should lower `gate`.

`MIDI Note On` and `MIDI Note Off` share an ordered event queue. One MIDI event is exposed per audio sample and every event is followed by a zero sample, so simultaneous chord messages become sequences such as `10, 0, 32, 0, 52`. All outputs belonging to an event are aligned on the same sample. The separator makes each non-zero note value a distinct rising event when connected to Spawn.
