// Local-only production build preview. Example: node scripts/serve-static.mjs dist / 5199
import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
const root = path.resolve(process.argv[2] || 'dist');
const base = ('/' + (process.argv[3] || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
const port = Number(process.argv[4] || 5199);
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.gltf':'model/gltf+json', '.glb':'model/gltf-binary', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.woff2':'font/woff2' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) || !(await stat(target)).isFile()) { response.writeHead(404).end(); return; }
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store', 'Content-Length':body.length });
    response.end(body);
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Preview http://127.0.0.1:${port}${base}`));
