import type { DspProgram } from './dspProgram';
import { patchToJson } from '../graph/serialize';
import type { BufferAsset, Patch, PatchNode } from '../graph/types';
import { loadBufferSnapshot } from './bufferStorage';

type PackageFile = { path: string; bytes: Uint8Array<ArrayBuffer> };

const encoder = new TextEncoder();
const MAX_ZIP_SIZE = 0xffff_ffff;

export async function createPatchPackage(patch: Patch, sourceProgram: DspProgram): Promise<Blob> {
  if (sourceProgram.errors.length) throw new Error(`Cannot export a patch with DSP errors: ${sourceProgram.errors.join('; ')}`);
  const portablePatch = structuredClone(patch);
  const program = structuredClone(sourceProgram);
  const files: PackageFile[] = [];
  const assets: Array<{ path: string; sha256: string; bytes: number; source: string }> = [];
  const mediaPaths = new Map<string, string>();

  const addAsset = async (path: string, bytes: Uint8Array<ArrayBuffer>, source: string) => {
    files.push({ path, bytes });
    assets.push({ path, sha256: await sha256(bytes), bytes: bytes.byteLength, source });
  };
  const packageMedia = async (url: string, kind: 'samples' | 'images'): Promise<string> => {
    if (!url.trim()) return url;
    const existing = mediaPaths.get(url);
    if (existing) return existing;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not export asset ${url} (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = await sha256(bytes);
    const extension = safeExtension(new URL(url, location.href).pathname);
    const path = `assets/${kind}/${hash}${extension}`;
    if (!files.some((file) => file.path === path)) await addAsset(path, bytes, url);
    mediaPaths.set(url, path);
    return path;
  };
  const visit = async (nodes: PatchNode[]) => {
    for (const node of nodes) {
      if (node.sample) {
        node.sample.url = await packageMedia(node.sample.url, 'samples');
        if (node.sample.originalUrl) node.sample.originalUrl = await packageMedia(node.sample.originalUrl, 'samples');
      }
      if (node.image) node.image.url = await packageMedia(node.image.url, 'images');
      if (node.subpatch) await visit(node.subpatch.nodes);
    }
  };
  await visit(portablePatch.nodes);
  for (const binding of program.sampleBindings) binding.sample.url = mediaPaths.get(binding.sample.url) ?? binding.sample.url;
  for (const binding of program.imageBindings) binding.image.url = mediaPaths.get(binding.image.url) ?? binding.image.url;

  for (const asset of Object.values(portablePatch.buffers ?? {}) as BufferAsset[]) {
    const path = `assets/buffers/${asset.hash}.f32`;
    if (files.some((file) => file.path === path)) continue;
    const snapshot = await loadBufferSnapshot(asset);
    if (!snapshot) throw new Error(`Preserved Buffer ${asset.hash} is missing from browser storage.`);
    const bytes = new Uint8Array(snapshot.samples.byteLength);
    bytes.set(new Uint8Array(snapshot.samples.buffer, snapshot.samples.byteOffset, snapshot.samples.byteLength));
    if (await sha256(bytes) !== asset.hash) throw new Error(`Preserved Buffer ${asset.hash} failed its integrity check.`);
    await addAsset(path, bytes, asset.hash);
  }

  const parameters = portablePatch.nodes.filter((node) => node.type === 'Params').flatMap((node) =>
    (node.outputs ?? []).map((port) => {
      const binding = program.valueBindings.find((value) => value.kind === 'node-param' && value.nodeId === node.id && value.port === port.name);
      if (!binding) throw new Error(`Parameter ${node.id}.${port.name} has no compiled value binding.`);
      return {
        id: `${node.id}.${port.name}`,
        name: port.name,
        nodeId: node.id,
        valueIndex: binding.valueIndex,
        defaultValue: node.params[port.name] ?? port.defaultValue ?? 0,
        min: port.min ?? 0,
        max: port.max ?? 1,
      };
    }));
  const manifest = {
    format: 'teia-patch',
    version: 2,
    programVersion: program.version,
    engineApiVersion: 1,
    runtimePackage: '@pauloricca/teia-runtime',
    paths: { patch: 'patch.json', program: 'program.json' },
    parameters,
    assets,
  };
  files.unshift(
    { path: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2) + '\n') },
    { path: 'patch.json', bytes: encoder.encode(patchToJson(portablePatch)) },
    { path: 'program.json', bytes: encoder.encode(JSON.stringify(program) + '\n') },
  );
  return zipStore(files);
}

function safeExtension(pathname: string): string {
  const extension = pathname.match(/\.[a-z0-9]{1,8}$/i)?.[0].toLowerCase();
  return extension ?? '';
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function zipStore(files: PackageFile[]): Blob {
  const chunks: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const length = file.bytes.byteLength;
    if (length > MAX_ZIP_SIZE || offset + length + name.length + 30 > MAX_ZIP_SIZE) {
      throw new Error('Package exceeds the ZIP size limit (4 GiB).');
    }
    const checksum = crc32(file.bytes);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, length, true);
    view.setUint32(22, length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    chunks.push(header, file.bytes);

    const entry = new Uint8Array(46 + name.length);
    const central = new DataView(entry.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, length, true);
    central.setUint32(24, length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    entry.set(name, 46);
    directory.push(entry);
    offset += header.length + length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  if (files.length > 0xffff || offset + directorySize > MAX_ZIP_SIZE) throw new Error('Package exceeds the ZIP size limit.');
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
