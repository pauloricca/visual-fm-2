# Teia Player

This separate browser app lives in `player/` and installs `@teia/runtime` as an npm dependency. The dependency contains the Rust/WASM engine and AudioWorklet. The ZIP downloaded with XP contains the patch manifest, editable patch, compiled DSP program, and referenced assets only.

## Run with Docker

```sh
cd player
./start
```

The script builds and starts the Player in the foreground, opens `http://localhost:5181` when it is ready, and runs `docker compose down` when you end the script with Ctrl-C. Set `TEIA_PLAYER_PORT` or pass `--port=PORT` to use another host port. The container still listens on 5180 internally. Choose a new XP `.zip` export, then use Start audio, middle C, microphone input, and the exported Params sliders. Each slider uses the parameter range from the package manifest, with its current value and range shown beside it. AudioWorklet and microphone access require a secure context; browsers treat localhost as secure.

## Runtime API

The app installs the npm package from its vendored tarball so Docker builds need no npm registry access. Runtime version 0.2.2 uses a player-specific worklet that skips editor visualization and CPU reporting while retaining FFT signal outputs. It selects the SIMD block kernel where supported and keeps scalar rendering for KinkOsc/power programs on ordinary WASM hosts. A project with registry access can depend on a published `@teia/runtime` version instead. The package API is:

```js
import { PatchPlayer } from '@teia/runtime';
const context = new AudioContext();
const player = await PatchPlayer.load(context, packageFile);
player.connect(context.destination);
await context.resume();
player.setParameter(player.parameters[0].id, 0.5);
player.noteOn(60, 0.8);
player.noteOff(60);
player.dispose();
```

The loader verifies patch asset hashes, decodes samples and images, restores preserved buffers, and runs the package's WASM engine. Parameter changes are smoothed by the kernel. Browser sample decoding and audio output use Web Audio APIs. Events are currently immediate; future sample-accurate scheduling is not part of this API.

To update the dependency from the repository root, run `npm run build:runtime`, then pack `runtime/` into `player/vendor/` and update the Player lockfile and local installation. A running Docker player also needs a rebuilt image and restart to receive that new package; updating host `node_modules` alone does not change the container. The ZIP is a playback package, not an editor import format.
