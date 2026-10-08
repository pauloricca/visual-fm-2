import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'player-runtime', 'dist');
await mkdir(output, { recursive: true });
const workletSource = await readFile(path.join(root, 'web/public/audio/audio-worklet-wasm.js'), 'utf8');
const buildMarker = 'const PLAYER_RUNTIME_BUILD = false;';
if (!workletSource.includes(buildMarker)) throw new Error('Player worklet build marker is missing.');
const playerWorkletSource = workletSource.replace(buildMarker, 'const PLAYER_RUNTIME_BUILD = true;');
const { code } = await transform(playerWorkletSource, { loader: 'js', minify: true, target: 'es2022' });
await writeFile(path.join(output, 'audio-worklet-wasm.js'), code);
await copyFile(path.join(root, 'web/public/audio/visual-fm-kernel.wasm'), path.join(output, 'visual-fm-kernel.wasm'));
console.log(`Built player runtime at ${output}`);
