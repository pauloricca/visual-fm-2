import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { resolve } from 'node:path';
import { preview } from 'vite';

const publicHost = process.env.HOST || '0.0.0.0';
const publicPort = positivePort(process.env.PORT, 5173);
const internalHost = '127.0.0.1';
const internalPort = positivePort(process.env.INTERNAL_PORT, 4173);
const keyPath = resolve(process.env.VISUAL_VISUAL_HTTPS_KEY || '.cert/visual-visual.key');
const certPath = resolve(process.env.VISUAL_VISUAL_HTTPS_CERT || '.cert/visual-visual.crt');

// TLS terminates here; the loopback-only Vite preview server keeps the local
// diagnostics and storage middleware available for the production bundle.
process.env.VISUAL_VISUAL_HTTPS_KEY = '';
process.env.VISUAL_VISUAL_HTTPS_CERT = '';
const previewServer = await preview({
  root: resolve('web'),
  preview: {
    host: internalHost,
    port: internalPort,
    strictPort: true,
  },
});

const server = createHttpsServer({
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
}, (request, response) => {
  const upstream = httpRequest({
    hostname: internalHost,
    port: internalPort,
    method: request.method,
    path: request.url,
    headers: {
      ...request.headers,
      host: `${internalHost}:${internalPort}`,
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.statusCode = 502;
    response.setHeader('Content-Type', 'text/plain');
    response.end(`Preview server unavailable: ${error.message}`);
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});

server.listen(publicPort, publicHost, () => {
  console.log(`Visual FM 2 production server: https://localhost:${publicPort}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    previewServer.httpServer.close();
  });
}

function positivePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
