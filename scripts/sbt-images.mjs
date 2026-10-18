// 杯数の記念 SBT の絵（public/sbt/kanpai.png・joren.png・meiyo.png、1000×1000）を、アプリそのもので描いて作る。
//   npm run build && npx vite preview &
//   npm run sbt-images        → public/sbt/ に 3 つの PNG と、一覧用の小さい絵（-160.png）ができる（できた画像はコミットする）
// 撮り方は shot.mjs と同じ（SwiftShader、?test、window.__beer）。泡の立ったジョッキを丸いメダルの中に描き、
// 下の帯に記念の名前と杯数を入れる。縁の色は 乾杯=銅、常連さん=銀、名誉店主=金。
// 文字のフォントは FONT にファイル（woff2 など）を渡すと埋め込む（今の絵は Zen Maru Gothic 700）。
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.URL || 'http://localhost:5184/';
const S = 1000;
const BADGES = [
  { id: 'kanpai', name: '乾杯', cups: 2, metal: ['#7a4219', '#d08a4a', '#f3c08a', '#a35e2a'] },
  { id: 'joren', name: '常連さん', cups: 5, metal: ['#6b7380', '#c9d0d8', '#f6f8fa', '#97a0ab'] },
  { id: 'meiyo', name: '名誉店主', cups: 10, metal: ['#8a5a00', '#e0a81c', '#fff0a8', '#b98208'] },
];

const font = process.env.FONT
  ? `@font-face { font-family: 'OG'; font-weight: 700; src: url(data:font/woff2;base64,${readFileSync(process.env.FONT).toString('base64')}); }`
  : '';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// ジョッキは画面の高さの真ん中に描かれる。縦に長い画面で描いて、真ん中より少し上から 1000 を切り出すと、
// ジョッキが上寄りになり、下に帯を置く場所が空く。
const H = 1500;
const TOP = 335;
const page = await browser.newPage({ viewport: { width: S, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${url}?test`);
await page.waitForFunction(() => window.__beer);
await page.evaluate(() => {
  const b = window.__beer;
  b.zoomOut(2.65);
  b.fill();
  b.advance(1);
  b.render(1);
});
await page.addStyleTag({
  content: `${font}
    #hint, .round, #cheers, #error, #award, #panel { display: none !important; }
    .medal { position: fixed; left: 0; top: ${TOP}px; width: ${S}px; height: ${S}px; pointer-events: none; }
    /* 丸の外は暗く塗る */
    .medal .outside { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, transparent 455px, #1c120b 456px); }
    .medal .ring { position: absolute; inset: 24px; border-radius: 50%; padding: 26px;
      background: conic-gradient(from 200deg, var(--m0), var(--m1), var(--m2), var(--m1), var(--m3), var(--m1), var(--m2), var(--m0));
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 26px), #000 calc(100% - 25px));
      mask: radial-gradient(farthest-side, transparent calc(100% - 26px), #000 calc(100% - 25px)); }
    .medal .band { position: absolute; left: 50%; top: 700px; transform: translateX(-50%); width: 760px; padding: 18px 0 22px;
      text-align: center; border-radius: 28px; background: #2a1606e8; border: 4px solid var(--m1);
      box-shadow: 0 8px 30px #000a;
      font-family: 'OG', 'Hiragino Maru Gothic ProN', 'IPAPGothic', sans-serif; font-weight: 700; }
    .medal .name { font-size: 104px; line-height: 1.15; letter-spacing: 0.06em; color: var(--m2);
      text-shadow: 0 3px 0 var(--m0), 0 0 18px #0008; }
    .medal .sub { margin-top: 6px; font-size: 40px; letter-spacing: 0.08em; color: #fff6e4; }
  `,
});
mkdirSync('public/sbt', { recursive: true });
// 一覧に出す小さい絵（160×160）。大きく描いた絵を、何も描いていないページの canvas で半分ずつ縮める。
const tool = await browser.newPage();
async function thumb(png, n) {
  const data = await tool.evaluate(
    async ([src, n]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      let c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      while (c.width / 2 >= n) {
        const d = document.createElement('canvas');
        d.width = d.height = Math.round(c.width / 2);
        const g = d.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(c, 0, 0, d.width, d.height);
        c = d;
      }
      const d = document.createElement('canvas');
      d.width = d.height = n;
      const g = d.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, n, n);
      return d.toDataURL('image/png');
    },
    [`data:image/png;base64,${png.toString('base64')}`, n],
  );
  return Buffer.from(data.split(',')[1], 'base64');
}
for (const b of BADGES) {
  await page.evaluate(async (b) => {
    document.querySelector('.medal')?.remove();
    const d = document.createElement('div');
    d.className = 'medal';
    b.metal.forEach((c, i) => d.style.setProperty(`--m${i}`, c));
    d.innerHTML = `<div class="outside"></div><div class="ring"></div>
      <div class="band"><div class="name">${b.name}</div><div class="sub">ビールジョッキ・${b.cups}杯飲み干し記念</div></div>`;
    document.body.append(d);
    await document.fonts.ready;
  }, b);
  const out = `public/sbt/${b.id}.png`;
  const png = await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: TOP, width: S, height: S } });
  console.log(out, `${S}x${S}`, `${Math.round(statSync(out).size / 1024)}KB`);
  const small = `public/sbt/${b.id}-160.png`;
  writeFileSync(small, await thumb(png, 160));
  console.log(small, '160x160', `${Math.round(statSync(small).size / 1024)}KB`);
}
await browser.close();
