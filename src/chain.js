// 記念の SBT が発行されたかを、Polygon のコントラクトから読む（読むだけ。ガス代も秘密鍵も要らない）。
// コントラクトは contracts/BeerJugSBT.sol。issued(address, uint8) は、そのアドレスにその種類を発行したことがあれば true。
import { keccak256Hex } from './eip55.js';

export const CONTRACT = '0x7CF5663c1afa9123a3aB94800aF65ffCB2456ef2';
// ブラウザから呼べる、公開の Polygon の窓口。上から順に試す。
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'];
const TIMEOUT = 6000;

let selector = '';
function issuedSelector() {
  if (!selector) selector = keccak256Hex(new TextEncoder().encode('issued(address,uint8)')).slice(0, 8);
  return selector;
}

const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

// 発行済みなら true、まだなら false。どの窓口からも読めなければ null。
export async function isIssued(address, kind) {
  const data = `0x${issuedSelector()}${word(address)}${word(kind.toString(16))}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACT, data }, 'latest'] });
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (typeof json.result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(json.result)) continue;
      return BigInt(json.result) !== 0n;
    } catch {
      // 次の窓口を試す
    }
  }
  return null;
}
