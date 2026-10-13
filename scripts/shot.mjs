// 画面のスクリーンショットを撮って、見た目と数値を確かめる。
//   npm run build && npx vite preview &
//   npm run shot              → shots/ に PNG と state.json ができる
// GPU のない環境でも動くよう、Chromium のソフトウェア描画（SwiftShader）を使う。
// playwright はこのリポジトリの依存に入れていないので、入っている場所を PLAYWRIGHT で渡せる。
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.URL || 'http://localhost:5184/';
const only = process.argv[2];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// [名前, 画面の大きさ, 準備]
const scenes = [
  ['01-empty', [390, 844], async (b) => b.reset()],
  ['02-pouring', [390, 844], async (b) => { b.pour(); b.advance(2.6); }],
  ['03-poured', [390, 844], async (b) => { b.pour(); b.advance(7.4); }],
  ['04-settled', [390, 844], async (b) => { b.fill(); b.advance(1); }],
  ['05-roll30', [390, 844], async (b) => { b.fill(); b.advance(0.5); b.tilt(30); b.advance(0.5); }],
  ['06-pitch30', [390, 844], async (b) => { b.fill(); b.advance(0.5); b.tilt(0, 30); b.advance(0.5); }],
  ['07-drinking', [390, 844], async (b) => { b.fill(); b.advance(0.5); b.tilt(62); b.advance(1.2); }],
  ['08-half', [390, 844], async (b) => { b.fill(); b.tilt(75); b.advance(4); b.tilt(0); b.advance(2); }],
  ['09-empty-done', [390, 844], async (b) => { b.fill(); b.tilt(120); b.advance(14); b.tilt(0); b.advance(2); }],
  ['10-landscape', [844, 390], async (b) => { b.fill(); b.advance(1); }],
  ['11-desktop', [1280, 800], async (b) => { b.fill(); b.advance(1); b.tilt(-20); b.advance(0.3); }],
];

mkdirSync('shots', { recursive: true });
const states = {};
for (const [name, [w, h], prep] of scenes) {
  if (only && !name.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(name, e.message));
  page.on('console', (m) => m.type() === 'error' && console.error(name, m.text()));
  await page.goto(`${url}?test`);
  await page.waitForFunction(() => window.__beer);
  await page.evaluate(`(${prep.toString()})(window.__beer)`);
  await page.evaluate(() => window.__beer.render(1));
  states[name] = await page.evaluate(() => ({ ...window.__beer.state(), calls: { ...window.__beer.calls } }));
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(name, JSON.stringify(states[name]));
  await page.close();
}
writeFileSync('shots/state.json', JSON.stringify(states, null, 2));
await browser.close();
