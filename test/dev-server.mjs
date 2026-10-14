// 開発用サーバー：v2/ を配り、GASの代わりに gas/Code.gs を「まね」の上で動かす。
// 使い方：node test/dev-server.mjs [ポート]  → 表示されたURLをブラウザで開く
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-mock.mjs';

const ROOT = fileURLToPath(new URL('../v2/', import.meta.url));
const env = loadGas(fileURLToPath(new URL('../gas/Code.gs', import.meta.url)));
env.gas.setup();
const port = Number(process.argv[2] || 8787);
// --real：GASのまねを使わず、v2/config.js（本物のGAS）のまま配る。本物のGASで画面を確かめるとき用
const REAL = process.argv.includes('--real');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/gas' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(env.post(JSON.parse(body || '{}'))));
    });
    return;
  }
  if (url.pathname === '/config.js' && !REAL) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end("export const GAS_URL = '/gas';\nexport const APP_VERSION = 'dev';\n");
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`http://localhost:${port}/`);
  console.log(env.logs.join('\n'));
});
