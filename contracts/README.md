# 記念 SBT のコントラクト

ビールジョッキで飲み干した杯数の記念に配る、SBT（譲渡できない NFT）のコントラクトです。Polygon に置きます。

アプリは申請（受取アドレス）を集めるだけです。mint（発行）は、運営者が申請を見て、後日、手作業で行います（XBill の全クリア記念 SBT と同じやり方）。
杯数はスマホの中に保存した自己申告なので、発行するかどうかは運営者が決めます。

| kind | 記念 | 杯数 | 申請の badge | 画像 |
| --- | --- | --- | --- | --- |
| 1 | 乾杯 | 2 杯 | `kanpai` | [sbt/kanpai.png](https://kawade502.github.io/beer-jug/sbt/kanpai.png) |
| 2 | 常連さん | 5 杯 | `joren` | [sbt/joren.png](https://kawade502.github.io/beer-jug/sbt/joren.png) |
| 3 | 名誉店主 | 10 杯 | `meiyo` | [sbt/meiyo.png](https://kawade502.github.io/beer-jug/sbt/meiyo.png) |

- 譲渡も承認（approve）もできない（ERC-5192）。持ち主は自分の分を消せる（burn）
- 同じアドレスに同じ種類は一度だけ。消したあとも、もう一度は出せない
- 名前・説明・属性（記念、杯数、発行日）は、コントラクトがその場で JSON を作る。画像だけ上の URL を指す
- 名前は「ビールジョッキ「乾杯」 #12」のように、通し番号（1 から）が付く

```
BeerJugSBT.sol   コントラクト本体（Remix に貼るのはこれだけ）
test/            テスト（npm test）
package.json     テスト用
```

## 用意するもの

1. **MetaMask**（ブラウザの拡張機能）。XBill の SBT を出したのと同じウォレットでかまいません。
   デプロイしたアカウントが運営者（owner）になり、mint できるのはそのアカウントだけです。
2. **MetaMask のネットワークを Polygon にする。** 左上のネットワーク一覧で「Polygon Mainnet」を選びます。
   一覧に無ければ「ネットワークを追加」から Polygon Mainnet を追加します（チェーン ID 137、通貨 POL、エクスプローラー https://polygonscan.com）。
3. **ガス代の POL を少し。** 使うガスの量は次のとおり（テストで測った値）。払う POL は、そのときの混み具合（ガス代）で大きく変わります。2026-10-20 の本番のデプロイは、約 1.01 POL かかりました（ガス 364 万）。mint 1 件はその約 25 分の 1（0.04 POL 前後）が目安です。運営者のウォレットには、数か月分のガス代（数 POL）だけを入れておきます。

   | 操作 | ガス |
   | --- | --- |
   | デプロイ（最初の 1 回だけ） | 約 360 万 |
   | mint 1 件 | 約 14 万 |
   | mintBatch 10 件 | 約 100 万 |

## デプロイする（最初の 1 回だけ）

ブラウザで Remix（https://remix.ethereum.org）を開きます。画面の名前は Remix の版で少し違うことがあります。

### 1. ファイルを作る

1. 左端の「File explorer」（書類のアイコン）を開く
2. `contracts` フォルダを右クリック →「New File」→ `BeerJugSBT.sol` と入力
3. このフォルダの [`BeerJugSBT.sol`](BeerJugSBT.sol) の中身を全部コピーして、貼り付ける

`@openzeppelin/contracts/...` の import は、Remix が自動で取ってきます（左に `.deps` フォルダができる）。そのままだと、そのときの最新版を取ってくるので、テストした版と同じにするには、貼り付けたあと import の 5 行を `@openzeppelin/contracts@5.6.1/...` のように書き換えます（例：`import {ERC721} from "@openzeppelin/contracts@5.6.1/token/ERC721/ERC721.sol";`）。

### 2. コンパイルする

1. 左端の「Solidity compiler」を開く
2. 「Compiler」で **`0.8.29+commit.ab55807c`** を選ぶ（テストしたのはこの版）
3. 「Advanced Configurations」は初期のままにする（Optimization（最適化）は**オフのままでよい**。EVM Version は default。0.8.29 の default は cancun で、Polygon で動く）
4. 「Compile BeerJugSBT.sol」を押す。左のアイコンに緑のチェックが付けば成功

新しい版のコンパイラでもコンパイルはできますが、EVM Version の初期値が変わるので、0.8.29 にしておくのが確実です。

### 3. デプロイする

1. 左端の「Deploy & run transactions」を開く
2. 「Environment」で **「Injected Provider - MetaMask」** を選ぶ（版によっては「Browser extension」の中の「MetaMask」）。MetaMask が接続してよいか聞いてくるので、運営者のアカウントで接続する
3. 「Account」が運営者のアドレスになっていること、Environment の下に `(137)` と出ていること（137 = Polygon）を確かめる
4. 「Contract」で `BeerJugSBT - contracts/BeerJugSBT.sol` を選ぶ
5. オレンジの「Deploy」を押し、MetaMask で「確認」を押す
6. しばらくすると、下の「Deployed Contracts」に `BEERJUGSBT AT 0x…` が出る。横のコピーボタンで**コントラクトのアドレス**を控える（あとで毎回使う。beer-jug の README にも書いておく）

### 次に Remix を開いたとき

デプロイはもうしません。1・2（ファイルとコンパイル）のあと、「Deploy & run transactions」で Environment を MetaMask にし、
「At Address」の横の欄にコントラクトのアドレスを貼って「At Address」を押します。「Deployed Contracts」に出てきます。

## mint する

「Deployed Contracts」の `BEERJUGSBT AT 0x…` を開くと、ボタンが並びます。
オレンジは書き込み（ガス代がかかり、MetaMask の確認が出る）、青は読むだけ（無料）です。
申請の badge が `kanpai` なら kind 1、`joren` なら 2、`meiyo` なら 3 です。

### 1 件ずつ

`mint` の右の ∨ を押して開き、

- `to`：受取アドレス（0x で始まる 42 文字。小文字のままでよい）
- `kind`：`1`（乾杯）、`2`（常連さん）、`3`（名誉店主）

を入れて「transact」→ MetaMask で「確認」。

### まとめて（同じ種類だけ）

`mintBatch` を開き、

- `to`：`["0x1111111111111111111111111111111111111111","0x2222222222222222222222222222222222222222"]`（角かっこで囲み、1 件ずつダブルクォートで囲んでカンマで区切る）
- `kind`：`1` / `2` / `3`

を入れて「transact」。1 回に 100 件くらいまでにします。

並べた中に 1 件でも出せないアドレス（同じ種類を発行済み、同じアドレスが 2 回、0x000…000）があると、**全体が失敗して 1 件も発行されません**。
送る前に Remix や MetaMask が「失敗しそう」と警告を出すので、そのときは送らずに、そのアドレスを外してやり直します（Remix の表示に `AlreadyIssued` と、どのアドレスかが出ます）。

### 出す前に確かめる

青の `issued` に `address` と `kind` を入れて「call」を押すと、発行済みなら `true` が出ます（持ち主が消したものも `true`）。

## 確かめる（PolygonScan）

https://polygonscan.com/address/コントラクトのアドレス を開きます。

- 「Transactions」に、デプロイと mint の取引が並ぶ
- 受取人のアドレスのページの「NFT Transfers」に「Beer Jug Memorial (BEERJUG)」が出る
- 中身を見るには、Remix の青の `tokenURI` に番号を入れて「call」。`data:application/json;base64,…` と出るので、全部コピーしてブラウザのアドレス欄に貼ると JSON が見える
- `totalMinted` は発行した数、`badgeOf` は番号ごとの種類と発行日時（UNIX 秒）

### ソースを公開する（任意）

公開すると、PolygonScan の「Contract」タブで誰でもソースを読めるようになり、「Read Contract」「Write Contract」も使えます。

- **Remix のプラグインで（簡単）**：左下の「Plugin manager」で「Contract Verification」を Activate。Etherscan の API キー（https://etherscan.io で無料登録して作る。PolygonScan にも使える）を設定し、チェーンに Polygon Mainnet（137）、コントラクトのアドレスを入れて Verify。Remix がコンパイルした設定のまま送るので、食い違いが起きない
- **手で**：File explorer で `BeerJugSBT.sol` を右クリック →「Flatten」で 1 つにまとめたファイルができる。PolygonScan のコントラクトのページ →「Contract」→「Verify and Publish」で、Compiler Type「Solidity (Single file)」、Compiler Version「v0.8.29+commit.ab55807c」、License「No License (None)」、次の画面で Optimization「No」にして、まとめたファイルの中身を貼る（`// SPDX-License-Identifier:` の行が 2 つ以上あると失敗するので、1 つだけ残す）

## 注意

- 同じアドレス・同じ種類には一度しか出せません。持ち主が消した（burn した）あとも出せません。運営者がうっかり二重に mint しても失敗するように、発行の記録は消さずに残しています
- 運営者のアカウントの鍵（MetaMask のシークレットリカバリーフレーズ）は誰にも教えないこと。mint と `setImageBase` は運営者のアカウントだけができます
- `renounceOwnership` は押さないこと（運営者がいなくなり、二度と mint できなくなる）。運営者を別のアカウントに移すときは `transferOwnership`。**宛先は 1 文字でも間違えると二度と戻せない**ので、送る前に宛先のアドレスを 2 回（できれば先頭と末尾の 6 文字ずつ声に出して）確かめる
- Mac のスクリプト（`deploy.mjs`・`verify.mjs`・mint 用のスクリプト）で秘密鍵を使うときは、`contracts/.env` を**使うときだけ作り、終わったら消す**。`.env` は git に入らない設定にしてあるが、iCloud Drive・Dropbox などの同期フォルダや、Time Machine などのバックアップに入る場所には置かない。鍵を画面に出したり、チャットに貼ったりしない
- 画像の置き場所を移したときは、`setImageBase` に新しい URL（末尾は `/`）を入れます。発行済みの分も新しい画像になります
- 受取アドレス・種類・発行日時は、チェーン上に公開され、消えません。金銭的な価値はありません
- ガス代は混み具合で変わります（上の目安）

## テスト

```bash
cd contracts
npm install
npm test
```

npm の solc（solc-js、コンパイラが入っている）でコンパイルし、@ethereumjs/evm の上で動かして確かめます。`npm install` のあとは、ネットにつながなくても動きます。
コンパイルの設定は Remix の初期設定（最適化なし、EVM Version は default）に合わせてあります。
テストした版：solc 0.8.29、OpenZeppelin Contracts 5.6.1（5.7.0 でも通る）。Remix は import したときの最新の OpenZeppelin Contracts を取ってきます（上の「1. ファイルを作る」のとおり、版を書いておくと同じ版になります）。
