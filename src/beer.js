import { DOME_MAX, FILL_LEVEL, FOAM_TOP, FULL_VOLUME, LIP_Y, liquidPlane, profileAt, rimLow, volumeBelow } from './jug.js';

export const MAX_BUB = 48;

// 再現できる乱数（スクリーンショットを毎回同じにするため）。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const innerR = (y) => profileAt(Math.min(y, LIP_Y))[2];

const POUR_TIME = 6.5; // 注ぎきるまでの秒数
const POUR_HEAD = 0.35; // 注ぎ口から液面まで流れが落ちてくる秒数
// 立てたときの泡の量（注ぎ終わりの目安）。注いでいる間は少し多めに立ち、落ち着くとこれに戻る。
const FOAM_FULL = volumeBelow([0, 1, 0], FOAM_TOP, DOME_MAX) - FULL_VOLUME;
// 泡は時間とともにゆっくり痩せ、最後は薄い膜が残る（3 分で約 6 割、10 分で約 2 割）。
const FOAM_MIN = FOAM_FULL * 0.1;
const FOAM_FADE = 300; // 痩せる時定数 (秒)

const GULP = 0.5; // ゴクッのリズム (秒)
const GULP_FLOW = 0.34; // そのうち、のどに流れ込んでいる時間 (秒)
const DRINK_K = 7600; // 縁を越えた高さ h (mm) に対して K·h^1.5 (mm³/s) で流れ出る
const DRINK_MAX = 75000;
// 泡はふわっと固まっているので、傾けても液体のようには流れ出ない。縁を越えた泡がほんの少しずつ減るだけ。
const FOAM_SPILL_K = 300;
const FOAM_SPILL_MAX = 600; // (mm³/s)
const FOAM_PER_SIP = 0.03; // 飲んだ量に対して、一緒に口に入る泡の割合
export const EMPTY = 6000; // これより少なければ飲み干した (mm³)

const SITES = 12;

// ビールの中身。液の量、泡の量、注ぐ流れ、炭酸の泡、飲んで減る量を受け持つ。
// 液面と泡の上面は、どちらも「傾けても体積が変わらない水平な面」として毎フレーム解く。
export function createBeer(events = {}) {
  let rand = mulberry32(11);
  const bubbles = [];
  const sites = [];
  const s = {
    phase: 'empty', // pour → settle → ready、飲み干したら empty
    t: 0,
    volume: 0,
    foam: 0,
    pourT: -1,
    tail: -1, // 注ぎ終わってから流れの尻尾が落ちきるまで
    since: 0, // 注ぎ終わってからの秒数
    haze: 0,
    gulpT: -1,
    glugAt: -1,
    drunk: 0, // 今の一杯で飲んだ量
    flow: 0, // ビールが縁から流れ出ている速さ (mm³/s)
    liqD: 0,
    foamD: 0,
    rimD: 0,
    dome: 0,
    bubAcc: 0,
  };

  function placeSites() {
    sites.length = 0;
    for (let i = 0; i < SITES; i++) {
      const th = rand() * Math.PI * 2;
      if (i < 5) {
        const rr = 4 + rand() * 24;
        sites.push({ x: Math.cos(th) * rr, y: 17.5, z: Math.sin(th) * rr });
      } else {
        const y = 22 + rand() * 110;
        const rr = innerR(y) - 0.5;
        sites.push({ x: Math.cos(th) * rr, y, z: Math.sin(th) * rr });
      }
    }
  }

  function reset() {
    rand = mulberry32(11);
    bubbles.length = 0;
    placeSites();
    Object.assign(s, {
      phase: 'empty',
      volume: 0,
      foam: 0,
      pourT: -1,
      tail: -1,
      since: 0,
      haze: 0,
      gulpT: -1,
      glugAt: -1,
      drunk: 0,
      flow: 0,
    });
  }

  function pour() {
    reset();
    s.phase = 'pour';
    s.pourT = 0;
  }

  // 注いだ直後の状態にすぐする（テストと、動きを減らす設定のとき）。
  function fill() {
    reset();
    s.phase = 'ready';
    s.volume = FULL_VOLUME;
    s.foam = FOAM_FULL;
    s.since = 30;
  }

  // 注ぐ流れの [下端, 上端]（上向きに測った高さ）。流れがなければ null。
  function stream() {
    const top = 600;
    if (s.pourT >= 0) {
      const head = top - (top - s.foamD) * Math.min(1, (s.pourT / POUR_HEAD) ** 2);
      return [head, top];
    }
    if (s.tail >= 0) {
      const tailY = top - (top - s.foamD) * Math.min(1, (s.tail / POUR_HEAD) ** 2);
      return tailY > s.foamD + 1 ? [s.foamD, tailY] : null;
    }
    return null;
  }

  function spawnBubble(up, P) {
    let b;
    if (P > 0.05 && rand() < 0.7) {
      // 注いでいる流れが当たったところから、細かい泡が巻き込まれて沈み、また上る。
      const th = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 16;
      const depth = 4 + rand() * Math.min(70, Math.max(s.liqD - 20, 4));
      const y = s.liqD - depth;
      b = { x: STREAM_AT[0] + Math.cos(th) * rr, y, z: STREAM_AT[2] + Math.sin(th) * rr, r: 0.25 + rand() * 0.6, ph: rand() * 6.28, wob: 4 };
    } else {
      const st = sites[Math.floor(rand() * sites.length)];
      b = { x: st.x + (rand() - 0.5) * 0.3, y: st.y, z: st.z + (rand() - 0.5) * 0.3, r: 0.15 + rand() * 0.12, ph: rand() * 6.28, wob: 0.5 };
    }
    if (dot([b.x, b.y, b.z], up) > s.liqD - 1.5) return null;
    return b;
  }

  function step(dt, up) {
    s.t += dt;
    const total = s.volume + s.foam;

    // ---------------- 注ぐ
    let P = 0;
    if (s.pourT >= 0) {
      s.pourT += dt;
      const flowing = Math.max(0, Math.min(s.pourT - POUR_HEAD * 0.8, POUR_TIME) - Math.max(s.pourT - dt - POUR_HEAD * 0.8, 0));
      if (flowing > 0) {
        const q = (FULL_VOLUME / POUR_TIME) * flowing;
        const prog = Math.min(1, s.volume / FULL_VOLUME);
        s.volume += q;
        // 勢いよく当たるので泡が立つ。満ちるほど泡の層が厚くなる。
        s.foam += q * (FOAM_FULL / FULL_VOLUME) * (0.6 + 0.9 * prog);
        P = 1;
      }
      if (s.pourT > POUR_HEAD * 0.8 + POUR_TIME) {
        s.pourT = -1;
        s.tail = 0;
        s.phase = 'settle';
        s.since = 0;
      }
    }
    if (s.tail >= 0) {
      s.tail += dt;
      if (s.tail > POUR_HEAD * 2) s.tail = -1;
    }
    s.pouring = P;
    s.haze = P > 0 ? Math.min(0.05, s.haze + dt * 0.08) : s.haze * Math.exp(-dt / 1.6);

    // ---------------- 泡が落ち着く
    if (s.phase === 'settle' || s.phase === 'ready') {
      s.since += dt;
      if (s.foam > FOAM_FULL) s.foam += (FOAM_FULL - s.foam) * (1 - Math.exp(-dt / 2.5));
      // 時間とともにゆっくり痩せる。
      if (s.foam > FOAM_MIN) s.foam -= (s.foam - FOAM_MIN) * (1 - Math.exp(-dt / FOAM_FADE));
      if (s.phase === 'settle' && s.since > 3) s.phase = 'ready';
    }

    // ---------------- 液面と泡の上面
    s.liqD = liquidPlane(up, s.volume);
    // 立てているときだけ、泡は縁の上にこんもり盛り上がれる。
    s.dome = DOME_MAX * smoothstep(0.93, 0.995, up[1]);
    s.foamD = s.foam > 50 ? liquidPlane(up, s.volume + s.foam, s.dome) : s.liqD;
    const rim = rimLow(up);
    s.rimD = rim;

    // ---------------- 飲む：縁を越えたぶんが、のどへ流れ込む
    // 泡が縁を越えても、描くときに縁で切れるだけで、立て直せば泡の頭が戻る。ほんの少しずつだけ減る。
    const foamOver = s.foamD - (rim + s.dome * 0.7);
    if (s.foam > 0 && foamOver > 0) {
      const q = Math.min(FOAM_SPILL_K * foamOver ** 1.5, FOAM_SPILL_MAX) * dt;
      s.foam = Math.max(0, s.foam - q);
    }

    const over = s.liqD - rim;
    s.flow = 0;
    if (over > 0.2 && s.volume > 0) {
      const before = s.gulpT;
      s.gulpT = before < 0 ? 0 : s.gulpT + dt;
      const phase = s.gulpT % GULP;
      const prev = before < 0 ? GULP : before % GULP;
      if (phase < prev) {
        events.gulp?.();
        s.glugAt = 0.12 + rand() * 0.08;
      }
      if (phase < GULP_FLOW) {
        const q = Math.min(DRINK_K * over ** 1.5, DRINK_MAX) * dt;
        const take = Math.min(q, s.volume);
        s.volume -= take;
        s.drunk += take;
        s.flow = take / dt;
        // ビールは泡の下をくぐって口に入る。泡の層は液面に乗ったまま下がり、ほんの少しだけ一緒に減る。
        s.foam = Math.max(0, s.foam - take * FOAM_PER_SIP);
      }
    } else {
      s.gulpT = -1;
    }
    if (s.glugAt >= 0) {
      s.glugAt -= dt;
      if (s.glugAt < 0) events.glug?.(2.5 + rand() * 1.5);
    }

    if (s.phase !== 'empty' && s.phase !== 'pour' && s.volume < EMPTY) {
      s.phase = 'empty';
      s.foam = Math.min(s.foam, FOAM_MIN * 0.3);
      events.empty?.();
    }
    if (s.phase === 'empty' && s.volume < EMPTY) s.foam *= Math.exp(-dt / 6);

    // ---------------- 炭酸の泡
    const fizz = s.volume > EMPTY ? 1 : 0;
    s.bubAcc += dt * (fizz * 14 + P * 160);
    while (s.bubAcc >= 1) {
      s.bubAcc -= 1;
      if (bubbles.length >= MAX_BUB) continue;
      const b = spawnBubble(up, P);
      if (b) bubbles.push(b);
    }
    const stir = P + Math.min(1, s.flow / 40000);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.r = Math.min(b.r + dt * 0.18, 1.1);
      const rise = (18 + 30 * b.r) * dt;
      b.x += up[0] * rise;
      b.y += up[1] * rise;
      b.z += up[2] * rise;
      b.ph += dt * 7;
      const wob = b.wob + stir * 6;
      b.x += Math.cos(b.ph) * dt * wob;
      b.z += Math.sin(b.ph * 1.3) * dt * wob;
      const lim = innerR(b.y) - b.r - 0.4;
      const rr = Math.hypot(b.x, b.z);
      if (rr > lim && rr > 0) {
        b.x *= lim / rr;
        b.z *= lim / rr;
      }
      if (dot([b.x, b.y, b.z], up) > s.liqD - b.r - 0.1 || b.y < 16 || b.y > LIP_Y) bubbles.splice(i, 1);
    }
    return total !== s.volume + s.foam;
  }

  return {
    reset,
    pour,
    fill,
    step,
    stream,
    bubbles,
    state: s,
    get fullness() {
      return Math.min(1, s.volume / FULL_VOLUME);
    },
  };
}

// 注ぐ流れが落ちる位置（上向きに垂直な面で、軸からのずれ）。少し左奥へ外して注ぐ。
export const STREAM_AT = [-9, 0, -6];
export const STREAM_R = 4.2;
export { FILL_LEVEL, FOAM_FULL };
