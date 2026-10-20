/**
 * BeerJugSBT デプロイスクリプト
 *
 * 実行方法:
 *   node --env-file=.env deploy.mjs           # 残高・ガス見積もりのみ（dry run）
 *   node --env-file=.env deploy.mjs --deploy   # 実際にデプロイする
 *
 * 必要な .env の項目:
 *   PRIVATE_KEY       運営者のウォレットの秘密鍵（0x 付き）
 *   POLYGON_RPC_URL   Polygon Mainnet の RPC URL（省略時: publicnode）
 */

import { ethers } from 'ethers';
import { compile } from './test/chain.mjs';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const POLYGON_CHAIN_ID = 137n;
const RPC = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

if (!PRIVATE_KEY) {
  console.error('エラー: .env に PRIVATE_KEY が設定されていません');
  process.exit(1);
}

const isDeploy = process.argv.includes('--deploy');

console.log('='.repeat(60));
console.log('BeerJugSBT デプロイ準備');
console.log('='.repeat(60));

// ---- コンパイル ----
process.stdout.write('コンパイル中 ... ');
const built = compile();
if (built.warnings.length > 0) {
  console.log('警告あり:');
  built.warnings.forEach((w) => console.warn(' ', w));
} else {
  console.log('OK（警告なし）');
}
console.log(`  solc ${built.version} / evmVersion ${built.metadata.settings.evmVersion} / optimizer ${built.metadata.settings.optimizer.enabled} / ${built.deployedBytecode.length / 2} バイト`);

// ---- ネットワーク接続 ----
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const network = await provider.getNetwork();
if (network.chainId !== POLYGON_CHAIN_ID) {
  console.error(`エラー: チェーン ID が ${network.chainId} です（Polygon Mainnet は 137）`);
  process.exit(1);
}

// ---- 残高・ガス見積もり ----
const address = wallet.address;
const balanceBig = await provider.getBalance(address);
const balance = ethers.formatEther(balanceBig);

const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 30n * 10n ** 9n;

// テスト結果: デプロイのガス 3,318,741。マージン 1.2 倍を目安に
const GAS_LIMIT = 3_980_000n;
const estimatedFee = GAS_LIMIT * gasPrice;
const estimatedFeePOL = ethers.formatEther(estimatedFee);

console.log('');
console.log('デプロイ情報');
console.log('-'.repeat(60));
console.log(`  デプロイアカウント : ${address}`);
console.log(`  POL 残高           : ${balance} POL`);
console.log(`  gasPrice           : ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
console.log(`  ガス上限（目安）    : ${GAS_LIMIT.toLocaleString()}`);
console.log(`  ガス代見積もり     : ~${estimatedFeePOL} POL`);
console.log('-'.repeat(60));

if (balanceBig < estimatedFee) {
  console.error('残高が足りません。');
  process.exit(1);
}

if (!isDeploy) {
  console.log('');
  console.log('確認のみ（dry run）完了。デプロイするには --deploy オプションを付けてください。');
  process.exit(0);
}

// ---- デプロイ ----
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ans = await rl.question('\nPolygon Mainnet にデプロイします。よろしいですか？ [yes/no] ');
rl.close();
if (ans.trim().toLowerCase() !== 'yes') {
  console.log('キャンセルしました。');
  process.exit(0);
}

console.log('');
console.log('デプロイ中 ...');
const factory = new ethers.ContractFactory(built.abi, '0x' + built.bytecode, wallet);
const contract = await factory.deploy({ gasLimit: GAS_LIMIT });
const deployTx = contract.deploymentTransaction();
console.log(`  送信済み: ${deployTx.hash}`);

process.stdout.write('  確認待ち ... ');
const receipt = await deployTx.wait(2);
console.log(`承認済み（ブロック ${receipt.blockNumber}）`);

const contractAddress = await contract.getAddress();
const gasUsed = receipt.gasUsed;
const feePOL = ethers.formatEther(gasUsed * (receipt.gasPrice ?? gasPrice));

console.log('');
console.log('='.repeat(60));
console.log('デプロイ完了');
console.log('='.repeat(60));
console.log(`  コントラクトアドレス : ${contractAddress}`);
console.log(`  取引ハッシュ         : ${deployTx.hash}`);
console.log(`  ブロック番号         : ${receipt.blockNumber}`);
console.log(`  gasUsed              : ${gasUsed.toLocaleString()}`);
console.log(`  実際のガス代         : ${feePOL} POL`);
console.log(`  PolygonScan          : https://polygonscan.com/address/${contractAddress}`);

const result = {
  network: 'polygon',
  chainId: 137,
  contractAddress,
  deployer: address,
  txHash: deployTx.hash,
  blockNumber: Number(receipt.blockNumber),
  gasUsed: Number(gasUsed),
  feePOL,
  deployedAt: new Date().toISOString().slice(0, 10),
  explorerUrl: `https://polygonscan.com/address/${contractAddress}`,
};
writeFileSync('deployed-polygon.json', JSON.stringify(result, null, 2) + '\n');
console.log('  deployed-polygon.json に保存しました');
