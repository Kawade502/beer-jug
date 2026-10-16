// ファビコン（public/favicon.png、48×48）と、iPhone のホーム画面用のアイコン（public/apple-touch-icon.png、180×180）を、
// アプリそのもので描いて作る。
//   npm run build && npx vite preview &
//   npm run icon              → public/ に 2 つの PNG ができる（できた画像はコミットする）
// 撮り方は shot.mjs と同じ（SwiftShader、?test、window.__beer）。大きく描いてから、ページの canvas できれいに縮める。
import { mkdirSync, statSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.URL || 'http://localhost:5184/';
const S = 512;
const outs = [
  ['public/favicon.png', 48],
  ['public/apple-touch-icon.png', 180],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${url}?test`);
await page.waitForFunction(() => window.__beer);
await page.evaluate(() => {
  const b = window.__beer;
  b.zoomOut(1.08);
  b.fill();
  b.advance(1);
  b.render(1);
});
await page.addStyleTag({ content: '#hint, .round, #cheers, #error { display: none !important; }' });
const big = await page.screenshot({ type: 'png' });

// 縮めるのは何も描いていないページで（アプリのページの canvas とは別に）。
const tool = await browser.newPage();
mkdirSync('public', { recursive: true });
for (const [out, n] of outs) {
  const data = await tool.evaluate(
    async ([src, n]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      // 半分ずつ縮めると、細い縁がちらつかずにきれいに残る。
      let c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      while (c.width / 2 >= n) {
        const d = document.createElement('canvas');
        d.width = d.height = c.width / 2;
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
    [`data:image/png;base64,${big.toString('base64')}`, n],
  );
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(out, `${n}x${n}`, `${Math.round(statSync(out).size / 1024)}KB`);
}
await browser.close();
