// BeerJugSBT のテスト。node --test で動かす（npm test）。
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { compile, createChain, addr } from './chain.mjs';

const ZERO = '0x' + '00'.repeat(20);
const SITE = 'https://kawade502.github.io/beer-jug/';
const KINDS = {
  1: { label: '乾杯', cups: 2, file: 'kanpai.png' },
  2: { label: '常連さん', cups: 5, file: 'joren.png' },
  3: { label: '名誉店主', cups: 10, file: 'meiyo.png' }
};

const alice = addr('aa');
const bob = addr('bb');
const carol = addr('cc');
const dave = addr('dd');

let built;
before(() => { built = compile(); });

/** 失敗することと、そのエラー名を確かめる。 */
async function reverts(promise, name, args) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.name, name, `エラーが違う: ${e.message}`);
    if (args) assert.deepEqual(e.args, args);
    return true;
  });
}

/** data:application/json;base64,… を JSON にする。 */
function decodeUri(uri) {
  const prefix = 'data:application/json;base64,';
  assert.ok(uri.startsWith(prefix), uri.slice(0, 40));
  return JSON.parse(Buffer.from(uri.slice(prefix.length), 'base64').toString('utf8'));
}

describe('コンパイル', () => {
  test('エラーも警告もなく、最適化なしで 24KB の上限に収まる', (t) => {
    assert.deepEqual(built.warnings, []);
    const size = built.deployedBytecode.length / 2;
    t.diagnostic(`solc ${built.version} / evmVersion ${built.metadata.settings.evmVersion} / optimizer ${built.metadata.settings.optimizer.enabled} / 大きさ ${size} バイト`);
    assert.ok(size < 24576, `大きすぎる: ${size}`);
  });
});

describe('BeerJugSBT', () => {
  let c;
  // テストごとに作り直す
  const fresh = async () => { c = await createChain(built); };

  describe('デプロイ直後', () => {
    before(fresh);
    test('名前・記号・持ち主・画像の置き場所', async () => {
      assert.equal(await c.call('name'), 'Beer Jug Memorial');
      assert.equal(await c.call('symbol'), 'BEERJUG');
      assert.equal(await c.call('owner'), c.owner);
      assert.equal(await c.call('imageBase'), SITE + 'sbt/');
      assert.equal(await c.call('totalMinted'), 0n);
    });
  });

  describe('mint', () => {
    before(fresh);

    test('運営者が mint できる。tokenId は 1 から。Transfer と Locked が出る', async (t) => {
      c.setTime(1767225600);
      const r = await c.send(c.owner, 'mint', [alice, 1]);
      t.diagnostic(`mint のガス（実行分）: ${r.gas}`);
      assert.equal(r.value, 1n);
      assert.deepEqual(r.logs.map((l) => l.name), ['Transfer', 'Locked']);
      assert.deepEqual([...r.logs[0].args], [ZERO, alice, 1n]);
      assert.deepEqual([...r.logs[1].args], [1n]);
      assert.equal(await c.call('ownerOf', [1]), alice);
      assert.equal(await c.call('balanceOf', [alice]), 1n);
      assert.equal(await c.call('totalMinted'), 1n);
      assert.equal(await c.call('issued', [alice, 1]), true);
      assert.equal(await c.call('issued', [alice, 2]), false);
      const [kind, mintedAt] = await c.call('badgeOf', [1]);
      assert.equal(kind, 1n);
      assert.equal(mintedAt, 1767225600n);
    });

    test('同じアドレスでも種類が違えば mint できる。番号は続き', async () => {
      const r = await c.send(c.owner, 'mint', [alice, 2]);
      assert.equal(r.value, 2n);
      assert.equal(await c.call('balanceOf', [alice]), 2n);
    });

    test('運営者以外は mint できない', async () => {
      await reverts(c.send(alice, 'mint', [bob, 1]), 'OwnableUnauthorizedAccount', [alice]);
      await reverts(c.send(bob, 'mintBatch', [[bob], 1]), 'OwnableUnauthorizedAccount', [bob]);
    });

    test('同じ (アドレス, 種類) には二度出せない', async () => {
      await reverts(c.send(c.owner, 'mint', [alice, 1]), 'AlreadyIssued', [alice, 1n]);
    });

    test('種類は 1〜3 だけ', async () => {
      for (const kind of [0, 4, 255]) {
        await reverts(c.send(c.owner, 'mint', [bob, kind]), 'InvalidKind', [BigInt(kind)]);
        await reverts(c.send(c.owner, 'mintBatch', [[bob], kind]), 'InvalidKind', [BigInt(kind)]);
      }
    });

    test('ゼロアドレスには出せない', async () => {
      await reverts(c.send(c.owner, 'mint', [ZERO, 1]), 'ERC721InvalidReceiver', [ZERO]);
      await reverts(c.send(c.owner, 'mintBatch', [[bob, ZERO], 1]), 'ERC721InvalidReceiver', [ZERO]);
      assert.equal(await c.call('issued', [bob, 1]), false);   // 取り消されている
      assert.equal(await c.call('totalMinted'), 2n);
    });

    test('コントラクトのアドレスにも出せる（受け取り側を呼ばない＝_safeMint ではない）', async () => {
      // このコントラクト自身は onERC721Received を持たない。_safeMint なら失敗する
      const r = await c.send(c.owner, 'mint', [c.address, 1]);
      assert.equal(r.value, 3n);
      assert.equal(await c.call('ownerOf', [3]), c.address);
      await c.send(c.owner, 'mintBatch', [[c.address], 2]);
      assert.equal(await c.call('ownerOf', [4]), c.address);
    });
  });

  describe('mintBatch', () => {
    before(fresh);

    test('まとめて mint できる。番号は並べた順', async (t) => {
      const r = await c.send(c.owner, 'mintBatch', [[alice, bob, carol], 3]);
      t.diagnostic(`mintBatch 3 件のガス（実行分）: ${r.gas}`);
      assert.deepEqual(r.logs.map((l) => l.name), ['Transfer', 'Locked', 'Transfer', 'Locked', 'Transfer', 'Locked']);
      assert.equal(await c.call('ownerOf', [1]), alice);
      assert.equal(await c.call('ownerOf', [2]), bob);
      assert.equal(await c.call('ownerOf', [3]), carol);
      for (const id of [1, 2, 3]) assert.equal((await c.call('badgeOf', [id]))[0], 3n);
      assert.equal(await c.call('totalMinted'), 3n);
    });

    test('1 件でも発行済みがあれば、全部取り消し', async () => {
      await reverts(c.send(c.owner, 'mintBatch', [[dave, bob], 3]), 'AlreadyIssued', [bob, 3n]);
      assert.equal(await c.call('issued', [dave, 3]), false);
      assert.equal(await c.call('balanceOf', [dave]), 0n);
      assert.equal(await c.call('totalMinted'), 3n);
    });

    test('同じアドレスを 2 回並べても失敗する', async () => {
      await reverts(c.send(c.owner, 'mintBatch', [[dave, dave], 1]), 'AlreadyIssued', [dave, 1n]);
      assert.equal(await c.call('totalMinted'), 3n);
    });

    test('空の配列は何もしない', async () => {
      const r = await c.send(c.owner, 'mintBatch', [[], 1]);
      assert.deepEqual(r.logs, []);
      assert.equal(await c.call('totalMinted'), 3n);
    });
  });

  describe('譲渡できない', () => {
    before(async () => {
      await fresh();
      await c.send(c.owner, 'mint', [alice, 1]);
    });

    test('transferFrom / safeTransferFrom は失敗する（持ち主でも、運営者でも）', async () => {
      for (const from of [alice, c.owner]) {
        await reverts(c.send(from, 'transferFrom', [alice, bob, 1]), 'Soulbound');
        await reverts(c.send(from, 'safeTransferFrom(address,address,uint256)', [alice, bob, 1]), 'Soulbound');
        await reverts(c.send(from, 'safeTransferFrom(address,address,uint256,bytes)', [alice, bob, 1, '0x']), 'Soulbound');
      }
      assert.equal(await c.call('ownerOf', [1]), alice);
    });

    test('無い token を transferFrom で作ることもできない', async () => {
      await reverts(c.send(alice, 'transferFrom', [ZERO, bob, 99]), 'ERC721NonexistentToken', [99n]);
    });

    test('approve / setApprovalForAll は失敗する', async () => {
      await reverts(c.send(alice, 'approve', [bob, 1]), 'Soulbound');
      await reverts(c.send(alice, 'approve', [ZERO, 1]), 'Soulbound');
      await reverts(c.send(alice, 'setApprovalForAll', [bob, true]), 'Soulbound');
      await reverts(c.send(alice, 'setApprovalForAll', [bob, false]), 'Soulbound');
      assert.equal(await c.call('getApproved', [1]), ZERO);
      assert.equal(await c.call('isApprovedForAll', [alice, bob]), false);
    });

    test('locked() はある token で true、無い token は失敗する', async () => {
      assert.equal(await c.call('locked', [1]), true);
      await reverts(c.call('locked', [2]), 'ERC721NonexistentToken', [2n]);
    });

    test('supportsInterface', async () => {
      const yes = {
        ERC165: '0x01ffc9a7',
        ERC721: '0x80ac58cd',
        ERC721Metadata: '0x5b5e139f',
        'ERC-5192': '0xb45a3c0e',
        'ERC-4906': '0x49064906'
      };
      for (const [name, id] of Object.entries(yes)) assert.equal(await c.call('supportsInterface', [id]), true, name);
      for (const id of ['0xffffffff', '0x00000000', '0x780e9d63' /* Enumerable は無し */]) {
        assert.equal(await c.call('supportsInterface', [id]), false, id);
      }
    });
  });

  describe('burn', () => {
    before(async () => {
      await fresh();
      await c.send(c.owner, 'mint', [alice, 1]);
      await c.send(c.owner, 'mint', [bob, 1]);
    });

    test('持ち主以外は消せない（運営者も）', async () => {
      await reverts(c.send(bob, 'burn', [1]), 'NotTokenOwner', [1n]);
      await reverts(c.send(c.owner, 'burn', [1]), 'NotTokenOwner', [1n]);
      await reverts(c.send(alice, 'burn', [99]), 'ERC721NonexistentToken', [99n]);
      assert.equal(await c.call('ownerOf', [1]), alice);
    });

    test('持ち主は自分の分を消せる', async () => {
      const r = await c.send(alice, 'burn', [1]);
      assert.deepEqual(r.logs.map((l) => l.name), ['Transfer']);
      assert.deepEqual([...r.logs[0].args], [alice, ZERO, 1n]);
      assert.equal(await c.call('balanceOf', [alice]), 0n);
      await reverts(c.call('ownerOf', [1]), 'ERC721NonexistentToken', [1n]);
      await reverts(c.call('tokenURI', [1]), 'ERC721NonexistentToken', [1n]);
      await reverts(c.call('locked', [1]), 'ERC721NonexistentToken', [1n]);
      await reverts(c.call('badgeOf', [1]), 'ERC721NonexistentToken', [1n]);
      await reverts(c.send(alice, 'burn', [1]), 'ERC721NonexistentToken', [1n]);
      assert.equal(await c.call('ownerOf', [2]), bob);   // ほかの人の分はそのまま
    });

    test('消したあとも、同じ (アドレス, 種類) には出せない。番号は詰めない', async () => {
      assert.equal(await c.call('issued', [alice, 1]), true);
      await reverts(c.send(c.owner, 'mint', [alice, 1]), 'AlreadyIssued', [alice, 1n]);
      await reverts(c.send(c.owner, 'mintBatch', [[alice], 1]), 'AlreadyIssued', [alice, 1n]);
      const r = await c.send(c.owner, 'mint', [alice, 2]);
      assert.equal(r.value, 3n);
    });
  });

  describe('tokenURI', () => {
    before(fresh);

    for (const kind of [1, 2, 3]) {
      test(`種類 ${kind}（${KINDS[kind].label}）`, async () => {
        const time = 1767225600 + kind * 86400;
        c.setTime(time);
        const id = (await c.send(c.owner, 'mint', [alice, kind])).value;
        const k = KINDS[kind];
        const meta = decodeUri(await c.call('tokenURI', [id]));
        assert.deepEqual(Object.keys(meta), ['name', 'description', 'image', 'external_url', 'attributes']);
        assert.equal(meta.name, `ビールジョッキ「${k.label}」 #${id}`);
        assert.ok(meta.description.includes(`${k.cups}杯飲み干した記念`), meta.description);
        assert.ok(meta.description.includes('譲渡できません'), meta.description);
        assert.ok(meta.description.includes('金銭的な価値はありません'), meta.description);
        assert.ok(meta.description.includes(SITE), meta.description);
        assert.equal(meta.image, SITE + 'sbt/' + k.file);
        assert.equal(meta.external_url, SITE);
        assert.deepEqual(meta.attributes, [
          { trait_type: '記念', value: k.label },
          { trait_type: '杯数', display_type: 'number', value: k.cups },
          { trait_type: '発行日', display_type: 'date', value: time }
        ]);
      });
    }

    test('番号が 2 桁でも名前に入る', async () => {
      await c.send(c.owner, 'mintBatch', [[addr('01'), addr('02'), addr('03'), addr('04'), addr('05'), addr('06'), addr('07'), addr('08'), addr('09')], 1]);
      assert.equal(await c.call('totalMinted'), 12n);
      assert.equal(decodeUri(await c.call('tokenURI', [12])).name, 'ビールジョッキ「乾杯」 #12');
    });

    test('無い token は失敗する', async () => {
      await reverts(c.call('tokenURI', [0]), 'ERC721NonexistentToken', [0n]);
      await reverts(c.call('tokenURI', [999]), 'ERC721NonexistentToken', [999n]);
    });

    test('contractURI もそのまま読める JSON', async () => {
      const meta = decodeUri(await c.call('contractURI'));
      assert.equal(meta.name, 'Beer Jug Memorial');
      assert.ok(meta.description.includes('名誉店主（10杯）'), meta.description);
      assert.equal(meta.image, SITE + 'sbt/meiyo.png');
      assert.equal(meta.external_link, SITE);
    });
  });

  describe('setImageBase', () => {
    before(async () => {
      await fresh();
      await c.send(c.owner, 'mint', [alice, 2]);
    });

    test('運営者以外は変えられない', async () => {
      await reverts(c.send(alice, 'setImageBase', ['https://example.com/']), 'OwnableUnauthorizedAccount', [alice]);
      assert.equal(await c.call('imageBase'), SITE + 'sbt/');
    });

    test('運営者が変えると、画像の URL が変わる。ERC-4906 のイベントが出る', async () => {
      const r = await c.send(c.owner, 'setImageBase', ['https://example.com/beer/']);
      assert.deepEqual(r.logs.map((l) => l.name), ['ImageBaseChanged', 'BatchMetadataUpdate', 'ContractURIUpdated']);
      assert.deepEqual([...r.logs[1].args], [1n, 1n]);
      assert.equal(await c.call('imageBase'), 'https://example.com/beer/');
      assert.equal(decodeUri(await c.call('tokenURI', [1])).image, 'https://example.com/beer/joren.png');
      assert.equal(decodeUri(await c.call('contractURI')).image, 'https://example.com/beer/meiyo.png');
    });

    test('JSON が壊れる文字は入れられない', async () => {
      for (const bad of ['https://x/"', 'https://x/\\', 'https://x/\n']) {
        await reverts(c.send(c.owner, 'setImageBase', [bad]), 'InvalidImageBase');
      }
      assert.equal(await c.call('imageBase'), 'https://example.com/beer/');
    });
  });

  describe('ガスの目安', () => {
    test('デプロイ・mint・mintBatch(10 件)', async (t) => {
      await fresh();
      const one = await c.send(c.owner, 'mint', [alice, 1]);
      const many = await c.send(c.owner, 'mintBatch', [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => addr(i.toString(16).padStart(2, '0'))), 2]);
      t.diagnostic(`実行分のガス: デプロイ ${c.deployGas} / mint ${one.gas} / mintBatch 10 件 ${many.gas}`);
      assert.ok(one.gas < 200_000n);
    });
  });
});
