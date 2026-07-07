import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    renderSyncPlugin(),
    localSampleStoragePlugin(),
    ...(process.env.VITE_VISUAL_VISUAL_PATCH_STORAGE === 'browser' ? [] : [localPatchStoragePlugin()]),
  ],
  server: {
    https: viteHttpsConfig(),
    headers: crossOriginIsolationHeaders(),
  },
  preview: {
    https: viteHttpsConfig(),
    headers: crossOriginIsolationHeaders(),
  },
});

function crossOriginIsolationHeaders() {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
}

function localSampleStoragePlugin(): Plugin {
  const samplesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'samples');

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/api/local-samples' && request.method === 'GET') {
      listLocalSamples(samplesDir).then((samples) => {
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ samples }));
      }).catch((error: unknown) => {
        sendPatchStorageError(response, error);
      });
      return;
    }

    if (path === '/api/local-samples' && request.method === 'POST') {
      saveUploadedSample(samplesDir, request).then((sample) => {
        response.statusCode = 201;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(sample));
      }).catch((error: unknown) => {
        sendPatchStorageError(response, error);
      });
      return;
    }

    if (path.startsWith('/samples/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const fileName = safeDecodedPathSegment(path.slice('/samples/'.length));
      if (!fileName || !isSafePatchStorageSegment(fileName)) {
        response.statusCode = 404;
        response.end();
        return;
      }

      const filePath = join(samplesDir, fileName);
      if (!existsSync(filePath)) {
        response.statusCode = 404;
        response.end();
        return;
      }

      response.statusCode = 200;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', sampleContentType(fileName));
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
      return;
    }

    next();
  };

  return {
    name: 'visual-visual-local-sample-storage',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function viteHttpsConfig() {
  const keyPath = process.env.VISUAL_VISUAL_HTTPS_KEY;
  const certPath = process.env.VISUAL_VISUAL_HTTPS_CERT;
  if (!keyPath || !certPath || !existsSync(keyPath) || !existsSync(certPath)) return undefined;

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

function renderSyncPlugin(): Plugin {
  const latestBundles = new Map<string, string>();
  const clientsByAppId = new Map<string, Set<Connect.ServerResponse>>();

  const sendBundle = (response: Connect.ServerResponse, bundle: string) => {
    response.write(`event: render-bundle\ndata: ${bundle}\n\n`);
  };

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/api/render-bundle' && request.method === 'GET') {
      const appId = renderSyncAppId(url, response);
      if (!appId) return;

      const latestBundle = latestBundles.get(appId) ?? null;
      response.statusCode = latestBundle ? 200 : 204;
      response.setHeader('Cache-Control', 'no-store');
      if (latestBundle) {
        response.setHeader('Content-Type', 'application/json');
        response.end(latestBundle);
      } else {
        response.end();
      }
      return;
    }

    if (path === '/api/render-bundle' && request.method === 'POST') {
      readRequestBody(request).then((body) => {
        const appId = renderSyncAppId(url, response);
        if (!appId) return;

        latestBundles.set(appId, body);
        response.statusCode = 204;
        response.end();
        for (const client of clientsByAppId.get(appId) ?? []) {
          sendBundle(client, body);
        }
      }).catch((error: unknown) => {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'text/plain');
        response.end(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (path === '/api/render-events' && request.method === 'GET') {
      const appId = renderSyncAppId(url, response);
      if (!appId) return;

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Connection', 'keep-alive');
      response.write('retry: 1000\n\n');
      const clients = clientsByAppId.get(appId) ?? new Set<Connect.ServerResponse>();
      clientsByAppId.set(appId, clients);
      clients.add(response);

      const latestBundle = latestBundles.get(appId);
      if (latestBundle) {
        sendBundle(response, latestBundle);
      }

      request.on('close', () => {
        clients.delete(response);
        if (clients.size === 0) {
          clientsByAppId.delete(appId);
        }
      });
      return;
    }

    next();
  };

  return {
    name: 'visual-visual-render-sync',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function renderSyncAppId(url: URL, response: Connect.ServerResponse): string | null {
  const appId = url.searchParams.get('app-id');
  if (appId && /^[A-Za-z0-9]{5}$/.test(appId)) return appId;

  response.statusCode = 400;
  response.setHeader('Content-Type', 'text/plain');
  response.end('A valid 5-character app-id is required.');
  return null;
}

function localPatchStoragePlugin(): Plugin {
  const patchesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'patches');

  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (!path.startsWith('/api/local-patches')) {
      next();
      return;
    }

    if (path === '/api/local-patches' && request.method === 'GET') {
      listLocalPatches(patchesDir).then((patches) => {
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ patches }));
      }).catch((error: unknown) => {
        sendPatchStorageError(response, error);
      });
      return;
    }

    if (path === '/api/local-patches' && request.method === 'POST') {
      readRequestBody(request).then(async (body) => {
        const payload = JSON.parse(body) as unknown;
        if (!isRecord(payload) || typeof payload.name !== 'string' || typeof payload.patchJson !== 'string') {
          throw new Error('Expected patch name and patch JSON.');
        }

        JSON.parse(payload.patchJson);
        const result = await saveLocalPatch(patchesDir, payload.name, payload.patchJson);
        response.statusCode = 201;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(result));
      }).catch((error: unknown) => {
        sendPatchStorageError(response, error);
      });
      return;
    }

    if (path === '/api/local-patches/version' && request.method === 'GET') {
      readLocalPatchVersion(patchesDir, url.searchParams.get('patch'), url.searchParams.get('version')).then((patchJson) => {
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(patchJson);
      }).catch((error: unknown) => {
        sendPatchStorageError(response, error);
      });
      return;
    }

    next();
  };

  return {
    name: 'visual-visual-local-patch-storage',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

interface LocalPatchVersion {
  id: string;
  savedAt: string;
}

interface LocalPatchEntry {
  name: string;
  versionCount: number;
  versions: LocalPatchVersion[];
}

interface UploadedSampleFile {
  name: string;
  contentType: string;
  data: Buffer;
}

const MAX_SAMPLE_UPLOAD_BYTES = 100 * 1024 * 1024;
const SAMPLE_AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.wav',
  '.wave',
  '.webm',
]);

async function saveUploadedSample(samplesDir: string, request: Connect.IncomingMessage) {
  const boundary = multipartBoundary(request.headers['content-type']);
  if (!boundary) throw new Error('Expected a multipart sample upload.');

  const body = await readRequestBuffer(request, MAX_SAMPLE_UPLOAD_BYTES);
  const uploaded = parseMultipartSampleFile(body, boundary);
  if (!uploaded) throw new Error('Expected an audio file named "sample".');
  if (!uploaded.contentType.startsWith('audio/') && uploaded.contentType !== 'application/octet-stream') {
    throw new Error('Expected an audio file upload.');
  }

  const fileName = sanitizeSampleFilename(uploaded.name);
  await mkdir(samplesDir, { recursive: true });
  const savedName = await uniqueSampleFilename(samplesDir, fileName);
  await writeFile(join(samplesDir, savedName), uploaded.data);

  return {
    name: savedName,
    url: `/samples/${encodeURIComponent(savedName)}`,
  };
}

async function listLocalSamples(samplesDir: string) {
  if (!existsSync(samplesDir)) return [];

  const entries = await readdir(samplesDir, { withFileTypes: true });
  const samples = await Promise.all(entries
    .filter((entry) => entry.isFile() && isSafePatchStorageSegment(entry.name) && SAMPLE_AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map(async (entry) => {
      const fileStats = await stat(join(samplesDir, entry.name));
      return {
        name: entry.name,
        url: `/samples/${encodeURIComponent(entry.name)}`,
        updatedAt: fileStats.mtime.getTime(),
      };
    }));

  return samples
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    .map(({ name, url }) => ({ name, url }));
}

function multipartBoundary(contentType: string | string[] | undefined): string | null {
  const header = Array.isArray(contentType) ? contentType[0] : contentType;
  const match = header?.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseMultipartSampleFile(body: Buffer, boundary: string): UploadedSampleFile | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerDelimiter = Buffer.from('\r\n\r\n');
  let searchFrom = 0;

  while (searchFrom < body.length) {
    const delimiterStart = body.indexOf(delimiter, searchFrom);
    if (delimiterStart < 0) return null;
    let partStart = delimiterStart + delimiter.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) return null;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;

    const headerEnd = body.indexOf(headerDelimiter, partStart);
    if (headerEnd < 0) return null;

    const nextDelimiter = body.indexOf(delimiter, headerEnd + headerDelimiter.length);
    if (nextDelimiter < 0) return null;

    const headers = body.subarray(partStart, headerEnd).toString('utf8');
    let dataEnd = nextDelimiter;
    if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;

    const disposition = headers.match(/content-disposition:[^\r\n]*/i)?.[0] ?? '';
    const fieldName = disposition.match(/\bname="([^"]+)"/i)?.[1] ?? '';
    const fileName = disposition.match(/\bfilename="([^"]*)"/i)?.[1] ?? '';
    if (fieldName === 'sample' && fileName) {
      return {
        name: fileName,
        contentType: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? 'application/octet-stream',
        data: Buffer.from(body.subarray(headerEnd + headerDelimiter.length, dataEnd)),
      };
    }

    searchFrom = nextDelimiter + delimiter.length;
  }

  return null;
}

function sanitizeSampleFilename(name: string): string {
  const extension = extname(name).toLowerCase();
  if (!SAMPLE_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported sample file type.');
  }

  const stem = basename(name, extension)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '') || 'sample';

  return `${stem}${extension}`;
}

async function uniqueSampleFilename(samplesDir: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const stem = basename(fileName, extension);
  let candidate = fileName;
  let suffix = 2;
  while (existsSync(join(samplesDir, candidate))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

async function listLocalPatches(patchesDir: string): Promise<LocalPatchEntry[]> {
  if (!existsSync(patchesDir)) return [];

  const entries = await readdir(patchesDir, { withFileTypes: true });
  const patches = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && isSafePatchStorageSegment(entry.name))
    .map(async (entry): Promise<LocalPatchEntry | null> => {
      const patchDir = join(patchesDir, entry.name);
      const files = await readdir(patchDir, { withFileTypes: true });
      const versions = await Promise.all(files
        .filter((file) => file.isFile() && file.name.endsWith('.json') && isSafePatchVersionFilename(file.name))
        .map(async (file): Promise<LocalPatchVersion> => {
          const fileStats = await stat(join(patchDir, file.name));
          return {
            id: file.name.slice(0, -'.json'.length),
            savedAt: fileStats.mtime.toISOString(),
          };
        }));

      versions.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      if (versions.length === 0) return null;

      return {
        name: entry.name,
        versionCount: versions.length,
        versions,
      };
    }));

  return patches
    .filter((entry): entry is LocalPatchEntry => entry !== null)
    .sort((a, b) => {
      const latestA = a.versions[0]?.savedAt ?? '';
      const latestB = b.versions[0]?.savedAt ?? '';
      return latestB.localeCompare(latestA) || a.name.localeCompare(b.name);
    });
}

async function saveLocalPatch(patchesDir: string, requestedName: string, patchJson: string) {
  const patchName = sanitizePatchStorageSegment(requestedName);
  const patchDir = join(patchesDir, patchName);
  await mkdir(patchDir, { recursive: true });

  const savedAt = new Date();
  const versionId = savedAt.toISOString().replace(/:/g, '-');
  let filePath = join(patchDir, `${versionId}.json`);
  let suffix = 2;
  while (existsSync(filePath)) {
    filePath = join(patchDir, `${versionId}-${suffix}.json`);
    suffix += 1;
  }

  await writeFile(filePath, patchJson, 'utf8');

  return {
    patchName,
    version: {
      id: filePath.slice(patchDir.length + 1, -'.json'.length),
      savedAt: savedAt.toISOString(),
    },
  };
}

async function readLocalPatchVersion(patchesDir: string, patchName: string | null, versionId: string | null): Promise<string> {
  if (!patchName || !versionId || !isSafePatchStorageSegment(patchName) || !isSafePatchStorageSegment(versionId)) {
    throw new Error('Invalid patch version.');
  }

  return readFile(join(patchesDir, patchName, `${versionId}.json`), 'utf8');
}

function sanitizePatchStorageSegment(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');

  return cleaned || 'untitled-patch';
}

function isSafePatchStorageSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function isSafePatchVersionFilename(value: string): boolean {
  return /^[0-9TZ_.-]+\.json$/.test(value);
}

function safeDecodedPathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sampleContentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case '.aac':
      return 'audio/aac';
    case '.aif':
    case '.aiff':
      return 'audio/aiff';
    case '.flac':
      return 'audio/flac';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.oga':
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
    case '.wave':
      return 'audio/wav';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

function sendPatchStorageError(response: Connect.ServerResponse, error: unknown): void {
  response.statusCode = 400;
  response.setHeader('Content-Type', 'text/plain');
  response.end(error instanceof Error ? error.message : String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequestBody(request: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function readRequestBuffer(request: Connect.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;

    request.on('data', (chunk: Buffer) => {
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        reject(new Error('Sample upload is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}
