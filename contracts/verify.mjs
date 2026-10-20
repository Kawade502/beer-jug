/**
 * BeerJugSBT PolygonScan ソース公開スクリプト
 * 実行: node --env-file=.env verify.mjs
 */

import { readFileSync } from 'node:fs';
import { SOURCE, SETTINGS } from './test/chain.mjs';
import solc from 'solc';

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS
  ?? JSON.parse(readFileSync('deployed-polygon.json', 'utf8')).contractAddress;
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY ?? '';
const API = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = 137;

if (!POLYGONSCAN_API_KEY) {
  console.error('エラー: POLYGONSCAN_API_KEY が設定されていません');
  process.exit(1);
}

const ROOT = new URL('./', import.meta.url);

// コンパイラ入力 JSON を組み立てる（全ソースファイルを含める）
const sources = {};
const collected = new Set();

function collectSources(path) {
  if (collected.has(path)) return;
  collected.add(path);
  let content;
  if (path === SOURCE) {
    content = readFileSync(new URL(SOURCE, ROOT), 'utf8');
  } else {
    content = readFileSync(new URL('node_modules/' + path, ROOT), 'utf8');
  }
  sources[path] = { content };
  // import 文を探して再帰的に収集
  for (const m of content.matchAll(/^\s*import\s+(?:{[^}]*}\s+from\s+)?["']([^"']+)["']/gm)) {
    const imp = m[1];
    // 相対パスを解決
    if (imp.startsWith('.')) {
      const base = path.includes('/') ? path.replace(/\/[^/]+$/, '/') : '';
      let resolved = base + imp;
      // .. を解決
      const parts = resolved.split('/');
      const stack = [];
      for (const p of parts) {
        if (p === '..') stack.pop();
        else if (p !== '.') stack.push(p);
      }
      collectSources(stack.join('/'));
    } else {
      collectSources(imp);
    }
  }
}

collectSources(SOURCE);

const compilerInput = JSON.stringify({
  language: 'Solidity',
  sources,
  settings: {
    optimizer: SETTINGS.optimizer,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } },
  },
});

// PolygonScan は "v0.8.29+commit.ab55807c" 形式（.Emscripten.clang は除く）
const compilerVersion = `v${solc.version().replace(/\+commit\.([0-9a-f]+).*/, '+commit.$1')}`;
console.log(`コントラクトアドレス : ${CONTRACT_ADDRESS}`);
console.log(`コンパイラバージョン : ${compilerVersion}`);
console.log(`ソースファイル数     : ${Object.keys(sources).length}`);

// 送信
const body = new URLSearchParams({
  module: 'contract',
  action: 'verifysourcecode',
  contractaddress: CONTRACT_ADDRESS,
  sourceCode: compilerInput,
  codeformat: 'solidity-standard-json-input',
  contractname: `${SOURCE}:BeerJugSBT`,
  compilerversion: compilerVersion,
  apikey: POLYGONSCAN_API_KEY,
});

console.log('\nPolygonScan に送信中 ...');
const res = await fetch(`${API}?chainid=${CHAIN_ID}`, { method: 'POST', body });
const json = await res.json();

if (json.status !== '1') {
  console.error('送信失敗:', JSON.stringify(json));
  process.exit(1);
}
const guid = json.result;
console.log(`GUID: ${guid}`);

// 検証結果をポーリング
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const check = await fetch(`${API}?${new URLSearchParams({
    chainid: String(CHAIN_ID),
    module: 'contract',
    action: 'checkverifystatus',
    guid,
    apikey: POLYGONSCAN_API_KEY,
  })}`);
  const r = await check.json();
  console.log(`  [${i + 1}] ${r.result}`);
  if (r.result === 'Pass - Verified') {
    console.log('\n✓ Verify 完了');
    console.log(`  https://polygonscan.com/address/${CONTRACT_ADDRESS}#code`);
    process.exit(0);
  }
  if (r.result && !r.result.startsWith('Pending')) {
    console.error('失敗:', r.result);
    process.exit(1);
  }
}
console.error('タイムアウト: PolygonScan の画面で確認してください');
process.exit(1);
