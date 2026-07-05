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

Nodes own the audio behavior. Oscillators generate signals. Filters filter signals. Distortion nodes distort signals. Delay, gain, multiply, meter, scope, and other processors are explicit nodes in the graph.

Cables do not contain filters, distortion, delay, envelopes, or other processors as user-facing behavior. The compiler may still lower explicit processor nodes onto the existing `visual-fm` WASM link fields internally, because that is the proven ABI the engine already exposes. Those fields are implementation details here, not the patch philosophy.

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

The compiler in `web/src/audio/compiler.ts` expands subpatches, combines input links with the rule above, and emits a `WasmAudioGraph` for the worklet.

The worklet in `web/public/audio/audio-worklet-wasm.js` loads the `visual-fm` WASM kernel and syncs the compiled graph into it. User-facing patch links target nodes or the audio output. The compiler may generate hidden internal links that target engine links when a processor-node parameter, such as filter cutoff, has audio-rate modulation. That is a lowering detail for the existing kernel ABI, not a visible patch feature.

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

Typecheck:

```sh
npm run typecheck
```

Build:

```sh
npm run build
```

Render a quick WASM startup smoke test:

```sh
node scripts/render-worklet-startup.mjs 1 --compiled
```
