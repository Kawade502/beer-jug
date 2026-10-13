import * as THREE from 'three';
import './style.css';
import { makeProfileTexture } from './jug.js';
import { createBeer, STREAM_AT, STREAM_R } from './beer.js';
import { BLIT_FRAG, KEY_AZ, KEY_EL, TRACE_FRAG, VERT } from './shader.js';
import { createSound } from './sound.js';
import { createTilt } from './tilt.js';

const STEP = 1 / 120;
const DIST = 720; // カメラからジョッキの軸までの距離 (mm)
const HALF_W = 44; // 縦画面で見せる幅の半分。胴（外径 39mm）がほぼ画面いっぱいになり、取っ手は右端で切れる
const HALF_H = 100; // 横長の画面で見せる高さの半分
const CENTER_Y = 93;
const TAP_SLOP = 6;

const params = new URLSearchParams(location.search);
const testMode = params.has('test');
const touch = matchMedia('(hover: none)').matches;

const app = document.getElementById('app');
const canvas = document.getElementById('stage');
const hint = document.getElementById('hint');
const errorBox = document.getElementById('error');
const cheers = document.getElementById('cheers');
const again = document.getElementById('again');
const muteButton = document.getElementById('mute');
const levelButton = document.getElementById('level');
const leftText = document.getElementById('left');

document.documentElement.dataset.input = touch ? 'touch' : 'mouse';

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
} catch (e) {
  errorBox.hidden = false;
  throw e;
}
renderer.setPixelRatio(1);
renderer.autoClear = false;

const quad = new THREE.PlaneGeometry(2, 2);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uCamPos: { value: new THREE.Vector3(0, CENTER_Y, DIST) },
  uCamShift: { value: new THREE.Vector2(0, 0) },
  uTanHalf: { value: 0.15 },
  uProf: { value: makeProfileTexture() },
  uRot: { value: new THREE.Matrix3() },
  uLightL: { value: new THREE.Vector3(0, 1, 0) },
  uLiq: { value: new THREE.Vector4(0, 1, 0, 0) },
  uFoamD: { value: 0 },
  uDome: { value: 0 },
  uBub: { value: Array.from({ length: 48 }, () => new THREE.Vector4()) },
  uBubN: { value: 0 },
  uRipple: { value: 0 },
  uHaze: { value: 0 },
  uTime: { value: 0 },
  uStreamC: { value: new THREE.Vector3() },
  uStream: { value: new THREE.Vector3() },
};

const traceMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: VERT,
  fragmentShader: TRACE_FRAG,
  uniforms,
  depthTest: false,
  depthWrite: false,
});
const traceScene = new THREE.Scene();
traceScene.add(new THREE.Mesh(quad, traceMat));

const target = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
});
const blitMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: VERT,
  fragmentShader: BLIT_FRAG,
  uniforms: { uTex: { value: target.texture }, uRes: { value: new THREE.Vector2(1, 1) } },
  depthTest: false,
  depthWrite: false,
});
const blitScene = new THREE.Scene();
blitScene.add(new THREE.Mesh(quad, blitMat));

// ---------------------------------------------------------------- 状態

const sound = createSound();
// センサーの最初の値が届いたら、画面の逆回しを始める。
const tilt = createTilt({ onFirstReading: () => resize() });
const beer = createBeer({
  gulp: () => sound.gulp(0.8 + 0.2 * Math.random()),
  glug: (r) => sound.glug(r),
  aah: (v) => sound.aah(v),
});

const st = {
  time: 0,
  started: false, // 乾杯ボタンを押したか
  locked: false, // 縦向きに固定できたか（Android の全画面）
  locking: false, // 固定しようとしている途中か
  rotateHinted: false, // 縦向きのロックを案内したか
  notice: '',
  noticeT: 0,
};

// ---------------------------------------------------------------- カメラと描画

const size = { w: 1, h: 1, ratio: 1 };
let scale = 0.6;

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// 縦向きのときの描く範囲の大きさ (CSS px)。画面を逆に回している間もこの大きさで合わせて、
// 1mm あたりの画素数を変えない（iPhone は横向きにするとツールバーの位置が変わり、範囲の縦横比が変わるため）。
// 横向きのまま開いたときにも使えるよう、端末ごとに覚えておく。まだ一度も縦向きで開いていなければ、今の範囲に合わせる。
const PORTRAIT_KEY = 'beer-jug:portrait';
const screenKey = () => `${Math.min(screen.width, screen.height)}x${Math.max(screen.width, screen.height)}`;
const portrait = { w: 0, h: 0 };
try {
  const v = JSON.parse(localStorage.getItem(PORTRAIT_KEY));
  if (v && v.key === screenKey()) Object.assign(portrait, { w: v.w, h: v.h });
} catch {
  // 覚えておけない環境では、縦向きになったときに測る。
}

function updateCamera(w, h) {
  if (touch && turn === 0 && osTurn === 0 && (portrait.w !== w || portrait.h !== h)) {
    portrait.w = w;
    portrait.h = h;
    try {
      localStorage.setItem(PORTRAIT_KEY, JSON.stringify({ key: screenKey(), w, h }));
    } catch {
      // 保存できなくても、この回のあいだは使える。
    }
  }
  const [rw, rh] = turn !== 0 && portrait.h ? [portrait.w, portrait.h] : [w, h];
  const aspect = rw / rh;
  // 縦長なら幅で、横長なら高さで合わせる。横長では取っ手まで入るよう少し右へずらす。
  uniforms.uTanHalf.value = Math.max(HALF_H / DIST, HALF_W / (DIST * aspect)) * (h / rh);
  const camX = 14 * smoothstep(0.6, 1.0, aspect);
  uniforms.uCamPos.value.set(camX, CENTER_Y, DIST);
}

// ローカル → 世界の回転。世界の y は重力の上向き、z は画面の手前にいちばん近い水平な向き。
const _wy = new THREE.Vector3();
const _wz = new THREE.Vector3();
const _wx = new THREE.Vector3();
const LIGHT_W = new THREE.Vector3(Math.sin(KEY_AZ) * Math.cos(KEY_EL), Math.sin(KEY_EL), Math.cos(KEY_AZ) * Math.cos(KEY_EL));

function updateUniforms() {
  const up = tilt.up;
  const s = beer.state;
  _wy.fromArray(up);
  _wz.set(0, 0, 1).addScaledVector(_wy, -_wy.z);
  if (_wz.lengthSq() < 1e-4) _wz.set(0, -1, 0).addScaledVector(_wy, _wy.y);
  _wz.normalize();
  _wx.crossVectors(_wy, _wz);
  const R = uniforms.uRot.value;
  R.set(_wx.x, _wx.y, _wx.z, _wy.x, _wy.y, _wy.z, _wz.x, _wz.y, _wz.z);
  // 世界のキーライトをローカルへ：local = R^T * world
  uniforms.uLightL.value.copy(LIGHT_W).applyMatrix3(R.clone().transpose());

  uniforms.uLiq.value.set(up[0], up[1], up[2], s.liqD);
  uniforms.uFoamD.value = s.foam > 50 ? s.foamD : s.liqD;
  // 立てているときだけ、縁の上で泡がこんもり盛り上がる。
  uniforms.uDome.value = s.dome;
  uniforms.uRipple.value = Math.min(1, tilt.slosh() * 1.2 + s.pouring * 0.6 + (s.flow > 0 ? 0.5 : 0) + 0.03);
  uniforms.uHaze.value = s.haze;
  uniforms.uTime.value = st.time;

  const bub = uniforms.uBub.value;
  beer.bubbles.forEach((b, i) => bub[i].set(b.x, b.y, b.z, b.r));
  uniforms.uBubN.value = beer.bubbles.length;

  const range = beer.stream();
  if (range) {
    // 流れの軸は、上向きに平行で STREAM_AT を通る線。
    const c = uniforms.uStreamC.value.fromArray(STREAM_AT);
    c.addScaledVector(_wy, -c.dot(_wy));
    uniforms.uStream.value.set(STREAM_R, range[0], range[1]);
  } else {
    uniforms.uStream.value.set(0, 0, 0);
  }
}

// ---------------------------------------------------------------- 画面の向き

// スマホを傾けると OS が画面を自動で横向きにするが、ジョッキはスマホ本体に貼り付いたままにしたい。
// そこで OS が回したぶん中身（#app）を逆に回し、いつも本体の自然な向き（縦）で描く。
// こうするとジョッキのローカル座標は本体の座標と同じになり、傾きセンサーの値をそのまま使える。
// センサーがない間（乾杯の前や、許可されなかったとき）は、OS の回転だけが重力の手がかりなので、逆に回さない。
let osTurn = 0; // OS が画面を回している角度（度、本体の自然な向きから反時計回り）
let turn = 0; // 中身を逆に回している角度

// 本体の自然な向きが横の端末（多くの Android タブレット）。そのときは逆に回さず、センサーの値のほうを回す。
function naturalLandscape() {
  const o = screen.orientation;
  if (!o || typeof o.type !== 'string') return false;
  return (o.angle % 180 === 0) === o.type.startsWith('landscape');
}

function screenAngle() {
  if (!touch) return 0; // パソコンの横長の画面はそのまま
  const o = screen.orientation;
  const a = o && typeof o.angle === 'number' ? o.angle : Number(window.orientation) || 0;
  const q = (((Math.round(a / 90) * 90) % 360) + 360) % 360;
  if (q === 90 || q === 270) {
    // 横向きのときは、どちらへ倒したかを重力の向きで確かめる（ブラウザによって角度の符号が違うことがあるため）。
    // 本体の右の辺（+x）が上を向いていれば、反時計回りに倒している。
    const g = tilt.state.sensor;
    if (g && Math.abs(g[0]) > 0.5) return g[0] > 0 ? 90 : 270;
  }
  return q;
}

// 画面の端の余白（ノッチなど）の大きさ。env() は今の画面の上下左右で決まる。
const insetProbe = document.createElement('div');
insetProbe.style.cssText =
  'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(insetProbe);
const EDGES = ['top', 'right', 'bottom', 'left'];

function resize() {
  osTurn = screenAngle();
  turn = tilt.state.sensor && !naturalLandscape() ? osTurn : 0;
  tilt.setFrame(osTurn - turn);
  const side = turn === 90 || turn === 270;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = side ? vh : vw;
  const h = side ? vw : vh;
  app.style.width = `${w}px`;
  app.style.height = `${h}px`;
  app.style.left = `${(vw - w) / 2}px`;
  app.style.top = `${(vh - h) / 2}px`;
  app.style.transform = turn ? `rotate(${-turn}deg)` : '';
  // 中身の上下左右は、逆に回したぶん画面の別の辺に来るので、余白もその辺のものを使う。
  const cs = getComputedStyle(insetProbe);
  const inset = EDGES.map((e) => parseFloat(cs.getPropertyValue(`padding-${e}`)) || 0);
  const k = turn / 90;
  EDGES.forEach((e, i) => app.style.setProperty(`--safe-${e}`, `${inset[(i - k + 4) % 4]}px`));

  size.ratio = Math.min(window.devicePixelRatio || 1, 2);
  size.w = Math.max(1, Math.round(w * size.ratio));
  size.h = Math.max(1, Math.round(h * size.ratio));
  renderer.setSize(size.w, size.h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  updateCamera(w, h);

  // iPhone は回転を止められないので、一度だけ縦向きのロックを案内する。
  // 固定しようとしている途中は決めない（終わったあとの resize で決める）。
  if (turn && !st.locked && !st.locking && !st.rotateHinted) {
    st.rotateHinted = true;
    showNotice('rotate', 6);
  }
  stillDrawn = false;
  wake();
}

// 画面上でのずれ (dx, dy) を、逆に回した中身の向きでのずれにする。
function toApp(dx, dy) {
  const a = (turn * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * dx - s * dy, s * dx + c * dy];
}

// Android の Chrome などでは、全画面にすれば縦向きに固定できる。
// iPhone はできないので、上の逆回しで合わせる。
async function lockPortrait() {
  const el = document.documentElement;
  if (!touch || !el.requestFullscreen || !screen.orientation || !screen.orientation.lock) return;
  if (naturalLandscape()) return;
  try {
    await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('portrait');
    st.locked = true;
  } catch {
    // 固定できなくても、逆回しで合わせるので困らない。
  }
}
// 全画面をやめると固定も外れる。
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) st.locked = false;
});

function render(s) {
  updateUniforms();
  const w = Math.max(1, Math.round(size.w * s));
  const h = Math.max(1, Math.round(size.h * s));
  if (s >= 0.999) {
    uniforms.uRes.value.set(size.w, size.h);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, size.w, size.h);
    renderer.render(traceScene, orthoCam);
    return;
  }
  if (target.width !== w || target.height !== h) target.setSize(w, h);
  uniforms.uRes.value.set(w, h);
  renderer.setRenderTarget(target);
  renderer.render(traceScene, orthoCam);
  renderer.setRenderTarget(null);
  blitMat.uniforms.uRes.value.set(size.w, size.h);
  renderer.render(blitScene, orthoCam);
}

// ---------------------------------------------------------------- 動き

let acc = 0;
function simulate(dt) {
  st.time += dt;
  acc += dt;
  while (acc >= STEP) {
    tilt.step(STEP);
    acc -= STEP;
  }
  beer.step(dt, tilt.up);
  if (st.noticeT > 0) {
    st.noticeT -= dt;
    if (st.noticeT <= 0) st.notice = '';
  }
}

function updateLoopSound() {
  const s = beer.state;
  const air = s.rimD - s.liqD;
  const fizz = s.volume > 0 ? 0.25 + 0.75 * Math.exp(-s.since / 8) * Math.min(1, s.volume / 100000) : 0;
  sound.setLoops(s.pouring, air, s.pouring ? 1 : fizz * 0.6, s.slurp);
}

// 炭酸の泡が上り続けるので、ビールが残っている間はずっと描く。
// 何も動かしていないときは間引いて、電池を減らしにくくする。
function isActive() {
  const s = beer.state;
  return s.volume > 0 || s.foam > 50 || tilt.moving() || beer.stream() !== null;
}
function isBusy() {
  const s = beer.state;
  return tilt.moving() || s.pouring > 0 || s.flow > 0 || s.slurp > 0 || s.haze > 0.004 || beer.stream() !== null;
}

let raf = 0;
let last = 0;
let stillDrawn = false;
let frameAvg = 1 / 60;
let frames = 0;
let skip = 0;

function wake() {
  stillDrawn = false;
  if (testMode || raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  // requestAnimationFrame の時刻は、呼んだ時刻より前のことがあるので、負にならないようにする。
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  simulate(dt);
  updateLoopSound();
  updateHint();

  if (isActive()) {
    const busy = isBusy();
    // 静かなときは 2 フレームに 1 回だけ描く。
    if (busy || ++skip % 2 === 0) {
      frameAvg += (dt - frameAvg) * 0.1;
      if (++frames % 12 === 0) {
        if (frameAvg > 1 / 40) scale = Math.max(0.3, scale - 0.05);
        else if (frameAvg < 1 / 55) scale = Math.min(1, scale + 0.05);
      }
      render(busy ? scale : Math.min(1, scale + 0.15));
    }
    stillDrawn = false;
    raf = requestAnimationFrame(tick);
  } else if (!stillDrawn) {
    render(1);
    stillDrawn = true;
  }
}

// ---------------------------------------------------------------- 入力

const pointer = { down: false, id: -1, x: 0, y: 0, startX: 0, startY: 0, roll0: 0, pitch0: 0, moved: 0 };

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (tilt.sensorOn) return;
  pointer.down = true;
  pointer.id = e.pointerId;
  pointer.startX = e.clientX;
  pointer.startY = e.clientY;
  pointer.roll0 = tilt.state.roll;
  pointer.pitch0 = tilt.state.pitch;
  pointer.moved = 0;
  tilt.state.held = true;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  wake();
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointer.down || e.pointerId !== pointer.id) return;
  const [dx, dy] = toApp(e.clientX - pointer.startX, e.clientY - pointer.startY);
  pointer.moved = Math.max(pointer.moved, Math.hypot(dx, dy));
  const t = tilt.state;
  t.roll = tilt.clamp(pointer.roll0 + dx * tilt.PER_PX, -tilt.TILT_MAX, tilt.TILT_MAX);
  t.pitch = tilt.clamp(pointer.pitch0 + dy * tilt.PER_PX, -tilt.PITCH_MAX, tilt.PITCH_MAX);
  wake();
});

function endPointer(e) {
  if (!pointer.down || e.pointerId !== pointer.id) return;
  pointer.down = false;
  tilt.state.held = false;
  canvas.style.cursor = '';
  wake();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  sound.unlock();
  if (KEYS[e.key]) {
    tilt.state.keys[KEYS[e.key]] = true;
    e.preventDefault();
  } else if (e.key === 'r' || e.key === 'R') {
    refill();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMute();
  } else if ((e.key === 'Enter' || e.key === ' ') && !st.started) {
    e.preventDefault();
    startCheers();
  } else {
    return;
  }
  wake();
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.key]) tilt.state.keys[KEYS[e.key]] = false;
  wake();
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(tilt.state.keys)) tilt.state.keys[k] = false;
  tilt.state.held = false;
  pointer.down = false;
});
window.addEventListener('resize', resize);
// iPhone では、向きが変わった直後はまだ画面の大きさが古いことがあるので、少し待ってもう一度合わせる。
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
if (screen.orientation) screen.orientation.addEventListener('change', resize);

// 乾杯：音を鳴らせるようにして、スマホなら傾きセンサーを使い始め、縦向きに固定する。
async function startCheers() {
  if (st.started) return;
  st.started = true;
  sound.unlock();
  sound.clink();
  cheers.hidden = true;
  if (touch && 'DeviceOrientationEvent' in window) {
    // iPhone の許可はタップの中で先に聞く。
    const ok = await tilt.enableSensor();
    levelButton.hidden = !ok;
    if (!ok) showNotice('nosensor', 4);
  }
  st.locking = true;
  try {
    await lockPortrait();
  } finally {
    st.locking = false;
  }
  resize();
}
cheers.addEventListener('click', startCheers);

function refill() {
  beer.pour();
  sound.thunk();
  wake();
}
again.addEventListener('click', () => {
  sound.unlock();
  refill();
});

levelButton.addEventListener('click', () => {
  if (tilt.calibrate()) showNotice('level', 2);
  wake();
});

muteButton.addEventListener('click', toggleMute);
function toggleMute() {
  sound.unlock();
  sound.toggleMute();
  updateMuteButton();
}
function updateMuteButton() {
  muteButton.dataset.muted = String(sound.muted);
  muteButton.setAttribute('aria-pressed', String(sound.muted));
  muteButton.setAttribute('aria-label', sound.muted ? '音を出す' : '音を消す');
}

// 裏のタブに回ったら音と描画を止める。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.pause();
  else {
    sound.resume();
    wake();
  }
});

function showNotice(name, seconds) {
  st.notice = name;
  st.noticeT = seconds;
}

function updateHint() {
  const s = beer.state;
  let state = s.phase;
  if (state === 'settle') state = 'ready';
  if (s.flow > 0 || s.slurp > 0) state = 'drinking';
  if (st.notice) state = st.notice;
  if (hint.dataset.state !== state) hint.dataset.state = state;
  const ml = Math.round(s.volume / 1000);
  const text = s.phase === 'pour' || s.phase === 'empty' ? '' : `残り ${ml}ml`;
  if (leftText.textContent !== text) leftText.textContent = text;
}

// ---------------------------------------------------------------- テスト用の入口

window.__beer = {
  pour: () => beer.pour(),
  fill: () => beer.fill(),
  reset: () => beer.reset(),
  // 傾ける（度）。roll は右へ倒すと正、pitch は上を手前へ倒すと正。null で手を離す。
  tilt(roll, pitch = 0) {
    if (roll === null) {
      tilt.state.test = null;
      return;
    }
    const r = (roll * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    const cp = Math.cos(p);
    tilt.state.test = [-Math.sin(r) * cp, Math.cos(r) * cp, -Math.sin(p)];
    const l = Math.hypot(...tilt.state.test);
    tilt.state.test = tilt.state.test.map((x) => x / l);
    tilt.snap();
  },
  advance(sec) {
    const n = Math.max(1, Math.round(sec / (1 / 60)));
    for (let i = 0; i < n; i++) simulate(sec / n);
  },
  calls: { gulp: 0, aah: 0 },
  layout: () => ({ turn, osTurn, width: app.style.width, height: app.style.height, transform: app.style.transform, tanHalf: +uniforms.uTanHalf.value.toFixed(4) }),
  enableSensor: () => tilt.enableSensor(),
  calibrateNow: () => tilt.calibrate(),
  render(s = 1) {
    updateHint();
    render(s);
    renderer.getContext().finish();
  },
  state: () => {
    const s = beer.state;
    return {
      phase: s.phase,
      volumeMl: +(s.volume / 1000).toFixed(2),
      foamMl: +(s.foam / 1000).toFixed(2),
      liqD: +s.liqD.toFixed(2),
      foamD: +s.foamD.toFixed(2),
      rimD: +s.rimD.toFixed(2),
      drunkMl: +(s.drunk / 1000).toFixed(1),
      flow: Math.round(s.flow),
      bubbles: beer.bubbles.length,
      up: tilt.up.map((x) => +x.toFixed(3)),
      hint: hint.dataset.state,
    };
  },
};
// gulp と aah の回数を数える（テストで確かめる）。
{
  const g = sound.gulp;
  sound.gulp = (v) => {
    window.__beer.calls.gulp++;
    g(v);
  };
  const a = sound.aah;
  sound.aah = (v) => {
    window.__beer.calls.aah++;
    a(v);
  };
}

updateMuteButton();
resize();
if (testMode) {
  cheers.hidden = true;
  render(1);
} else {
  // 開いたらすぐ注ぎ始める。
  beer.pour();
  wake();
}
