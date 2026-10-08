# @visual-fm/player-runtime

Browser runtime for Visual FM patch ZIPs exported with XP. The npm package contains the Rust/WASM kernel and AudioWorklet; patch ZIPs contain only the editable patch, compiled DSP program, parameter metadata, and referenced assets.

```js
import { PatchPlayer } from '@visual-fm/player-runtime';

const context = new AudioContext();
const player = await PatchPlayer.load(context, patchZipFile);
player.connect(context.destination);
await context.resume();
player.setParameter(player.parameters[0].id, 0.5);
player.noteOn(60, 0.8);
player.noteOff(60);
player.dispose();
```

Serve the package's `dist/audio-worklet-wasm.js` and `dist/visual-fm-kernel.wasm` alongside `dist/index.js`. The module resolves those files relative to its own URL. A bundler must copy these assets into its output, or a static server can serve the installed package files directly. `PatchPlayer.load` verifies the patch's asset hashes and checks the patch format and engine API versions.

Build this package from the editor repository with `npm run build:player-runtime`. Its worklet skips editor visualization, metering, CPU reporting, and legacy effect allocations while retaining DSP FFT outputs. The package is installable from a local tarball; it has not been published to a registry.
