// Facebook・X・LINE などで URL を共有したときに出す画像（public/og.jpg、1200×630）を、アプリそのもので描いて作る。
//   npm run build && npx vite preview &
//   npm run og                → public/og.jpg ができる（できた画像はコミットする）
// 撮り方は shot.mjs と同じ（SwiftShader、?test、window.__beer）。
// 横に長い画面で描くとジョッキは真ん中に来るので、その左側だけを切り出し、空いた左に文字を置く。
// 文字のフォントは FONT にファイル（woff2 など）を渡すと埋め込む。渡さなければ端末のフォント（Mac ならヒラギノ丸ゴシック、
// なければ IPA P ゴシック）を使う。
import { mkdirSync, readFileSync, statSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.URL || 'http://localhost:5184/';
const out = 'public/og.jpg';
const W = 1200;
const H = 630;

const font = process.env.FONT
  ? `@font-face { font-family: 'OG'; font-weight: 700; src: url(data:font/woff2;base64,${readFileSync(process.env.FONT).toString('base64')}); }`
  : '';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// ジョッキは画面の真ん中あたりに描かれる。画面を 1740 にして左から 1200 で切ると、右寄りになる。
// そのままだと高さいっぱいで、X が上下を 15px ずつ切ると底が欠けるので、少し引いて上下に余白を作る。
const page = await browser.newPage({ viewport: { width: 1740, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${url}?test`);
await page.waitForFunction(() => window.__beer);
await page.evaluate(() => {
  const b = window.__beer;
  b.zoomOut(1.12);
  b.fill();
  b.advance(1);
  b.render(1);
});
// ボタンと案内は隠し、左に文字を置く。X はタイトルを画像の左下に重ねるので、文字は真ん中より少し上にする。
await page.addStyleTag({
  content: `${font}
    #hint, .round, #cheers, #error { display: none !important; }
    .og {
      position: fixed; left: 72px; top: 0; height: ${H}px; width: 600px;
      display: flex; flex-direction: column; justify-content: center; padding-bottom: 70px; box-sizing: border-box;
      font-family: 'OG', 'Hiragino Maru Gothic ProN', 'IPAPGothic', sans-serif; font-weight: 700;
      color: #2b1709; text-shadow: 0 0 18px rgba(255, 244, 222, 0.9), 0 0 4px rgba(255, 244, 222, 0.7);
    }
    .og .title { font-size: 76px; letter-spacing: 0.04em; line-height: 1.2; }
    .og .sub { font-size: 32px; margin-top: 22px; color: #4a2c14; letter-spacing: 0.04em; }
  `,
});
await page.evaluate(async () => {
  const d = document.createElement('div');
  d.className = 'og';
  d.innerHTML = '<div class="title">ビールジョッキ</div><div class="sub">スマホを傾けて、ゴクゴク飲もう</div>';
  document.body.append(d);
  await document.fonts.ready;
});
mkdirSync('public', { recursive: true });
await page.screenshot({ path: out, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: W, height: H } });
console.log(out, `${W}x${H}`, `${Math.round(statSync(out).size / 1024)}KB`);
await browser.close();
