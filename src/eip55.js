// ウォレットのアドレスの打ち間違いを見つける（EIP-55：大文字小文字によるチェックサム）。
// 同じ作者の XBill Web Remake（src/game.html）の実装を、モジュールにして移した。
// Keccak-256（イーサリアムのハッシュ）の最小実装。速さは要らないので BigInt で素直に書く。

const KECCAK_RC = (() => {
  const rc = [];
  let r = 1;
  for (let i = 0; i < 24; i++) {
    let v = 0n;
    for (let j = 0; j < 7; j++) {
      r = ((r << 1) ^ ((r >> 7) * 0x71)) % 256;
      if (r & 2) v ^= 1n << BigInt((1 << j) - 1);
    }
    rc.push(v);
  }
  return rc;
})();
const MASK64 = (1n << 64n) - 1n;
const rol64 = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK64);

function keccakF(a) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rol64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    let x = 1, y = 0, cur = a[1];
    for (let t = 0; t < 24; t++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      const tmp = a[x + 5 * y];
      a[x + 5 * y] = rol64(cur, ((t + 1) * (t + 2) / 2) % 64);
      cur = tmp;
    }
    for (let yy = 0; yy < 25; yy += 5) {
      const row = a.slice(yy, yy + 5);
      for (let xx = 0; xx < 5; xx++) a[yy + xx] = row[xx] ^ ((~row[(xx + 1) % 5] & MASK64) & row[(xx + 2) % 5]);
    }
    a[0] ^= KECCAK_RC[round];
  }
}

/** Keccak-256（イーサリアムのハッシュ）。bytes は Uint8Array、戻り値は16進数の文字列 */
export function keccak256Hex(bytes) {
  const RATE = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const a = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      a[i] ^= lane;
    }
    keccakF(a);
  }
  let hex = '';
  for (let i = 0; i < 4; i++) {
    for (let b = 0; b < 8; b++) hex += Number((a[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  }
  return hex;
}

/** EIP-55 の形（大文字小文字の混ざった形）にする */
export function toChecksumAddress(address) {
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256Hex(new TextEncoder().encode(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** 大文字小文字が混ざっていれば、チェックサムが合うか。すべて小文字・すべて大文字なら検査できないので true */
export function checksumOk(address) {
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}
