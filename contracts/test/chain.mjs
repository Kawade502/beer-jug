// テスト用の小さなチェーン。solc（npm の solc-js）でコンパイルし、@ethereumjs/evm の上で動かす。
// ネットワークにはつながない（npm install のあとはオフラインで動く）。
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { createEVM } from '@ethereumjs/evm';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { Interface, getAddress } from 'ethers';

const ROOT = new URL('../', import.meta.url);
export const SOURCE = 'BeerJugSBT.sol';

// Remix の初期設定と同じ：最適化なし、EVM はコンパイラの既定（0.8.29 は cancun）。
export const SETTINGS = {
  optimizer: { enabled: false, runs: 200 },
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } }
};

/** BeerJugSBT.sol をコンパイルする。@openzeppelin/... は node_modules から読む。 */
export function compile() {
  const input = {
    language: 'Solidity',
    sources: { [SOURCE]: { content: readFileSync(new URL(SOURCE, ROOT), 'utf8') } },
    settings: SETTINGS
  };
  const findImports = (path) => {
    try {
      return { contents: readFileSync(new URL('node_modules/' + path, ROOT), 'utf8') };
    } catch {
      return { error: 'ファイルが見つかりません: ' + path };
    }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts[SOURCE].BeerJugSBT;
  return {
    abi: c.abi,
    bytecode: c.evm.bytecode.object,
    deployedBytecode: c.evm.deployedBytecode.object,
    metadata: JSON.parse(c.metadata),
    warnings: (out.errors || []).filter((e) => e.severity !== 'error').map((e) => e.formattedMessage),
    version: solc.version()
  };
}

/** 失敗した呼び出し。name はカスタムエラーの名前（Soulbound など）。 */
export class Revert extends Error {
  constructor(name, args, data) {
    super(`revert ${name}(${args.map(String).join(', ')})`);
    this.name = name;
    this.args = args;
    this.data = data;
  }
}

/** テスト用のアドレス（0x11…11 など）。 */
export const addr = (byte) => getAddress('0x' + byte.repeat(20));

export async function createChain(built = compile()) {
  const iface = new Interface(built.abi);
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
  const evm = await createEVM({ common });
  let timestamp = 1767225600n;   // 2026-01-01T00:00:00Z
  let number = 1n;

  const block = () => ({
    header: {
      number,
      coinbase: createAddressFromString('0x' + '00'.repeat(20)),
      timestamp,
      difficulty: 0n,
      prevRandao: new Uint8Array(32),
      gasLimit: 30_000_000n,
      baseFeePerGas: 0n,
      getBlobGasPrice: () => 0n
    }
  });

  async function run(from, to, data) {
    const res = await evm.runCall({
      caller: createAddressFromString(from),
      origin: createAddressFromString(from),
      to: to ? createAddressFromString(to) : undefined,
      data: hexToBytes(data),
      gasLimit: 15_000_000n,
      block: block()
    });
    number++;
    const ex = res.execResult;
    if (ex.exceptionError) {
      const ret = bytesToHex(ex.returnValue);
      let parsed = null;
      try { parsed = iface.parseError(ret); } catch { /* 知らないエラー */ }
      if (parsed) throw new Revert(parsed.name, [...parsed.args], ret);
      throw new Revert(ex.exceptionError.error || 'unknown', [], ret);
    }
    return res;
  }

  // デプロイ
  const owner = addr('11');
  const created = await run(owner, null, '0x' + built.bytecode);
  const address = getAddress(created.createdAddress.toString());

  const parseLogs = (res) => (res.execResult.logs || []).map(([, topics, data]) =>
    iface.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) }));

  return {
    iface,
    address,
    owner,
    deployGas: created.execResult.executionGasUsed,
    setTime(t) { timestamp = BigInt(t); },
    get time() { return timestamp; },
    /** 書き込み。{ logs, gas, value } を返す。失敗すると Revert を投げる。 */
    async send(from, fn, args = []) {
      const f = iface.getFunction(fn);
      const res = await run(from, address, iface.encodeFunctionData(f, args));
      const decoded = iface.decodeFunctionResult(f, bytesToHex(res.execResult.returnValue));
      return { logs: parseLogs(res), gas: res.execResult.executionGasUsed, value: decoded.length === 1 ? decoded[0] : decoded };
    },
    /** 読み出し。戻り値が 1 つならその値を返す。 */
    async call(fn, args = [], from = addr('ee')) {
      const f = iface.getFunction(fn);
      const res = await run(from, address, iface.encodeFunctionData(f, args));
      const decoded = iface.decodeFunctionResult(f, bytesToHex(res.execResult.returnValue));
      return decoded.length === 1 ? decoded[0] : decoded;
    }
  };
}
