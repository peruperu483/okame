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
// --legacy：管理シートから取り込んだ9月・10月（金額はテスト用）を入れた状態で始める。月次の表示の確認用
if (process.argv.includes('--legacy')) {
  const { makeSpreadsheet } = await import('./gas-mock.mjs');
  env.setNow('2026-10-15T12:30:00+09:00');
  const head9 = ['8月', '列 1', '列 2', '列 3', '列 ４', '列 ', '団体及びイベント', '加奈', 'スタッフ', '現金\n売上', '団体\n売上', 'ポイント\n売上', '食品\n支出', 'その他\n支出', 'キャッシュ\nレス\n売上', '家賃', 'ガス\n電気\nカラオケ'];
  const sep = [head9, [1, '火', '加奈', '', '', '', '', 12000, 0, 80000, 0, 0, 3000, 0, 0, 200000, 30000],
    [4, '金', '岡本', '加奈', '', '', '6名団体', 13000, 5000, 20000, 300000, 1000, 2000, 500, 2000, 0, 1000], ['合計']];
  const head10 = ['10月', '列 1', '1', '2', '3', '3 2', '団体及びイベント', '加奈', 'スタッフ', '売上', '団体売上', 'キャッシュレス売上', 'ポイント\n売上', '食品支出', 'その他支出', '家賃電気', 'ガス・カラオケ・Wi-Fi・電話', '保険'];
  const oct = [head10, [1, '木', '岡本', '', '', '', '', 0, 0, 10000, 0, 0, 0, 500, 100, 250000, 30000, 8000],
    [14, '水', '岡本', '', '', '', '', 0, 0, 25000, 0, 6000, 0, 0, 0, 0, 0, 0], ['合計']];
  env.gas.importLegacy_(makeSpreadsheet({ '9月': sep, '10月': oct }), '2026-10-14');
}
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
