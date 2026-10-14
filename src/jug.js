import * as THREE from 'three';

// 寸法はすべてミリメートル。y は底面からの高さ、r は中心軸からの半径。
// ジョッキのローカル座標は画面と同じ向き：x が右、y が上（ジョッキの軸）、z が手前。
// 中ジョッキを、スマホの縦画面（幅：高さ ≒ 0.46）に収まるよう少し縦長にした形。

// 外側の輪郭 [r, y]。下から縁まで。底は少し広がった厚いガラス。
const OUTER = [
  [37.6, 0],
  [38.9, 2.5],
  [39.2, 7],
  [38.5, 16],
  [38.6, 60],
  [39.2, 140],
  [39.4, 175],
];

// 内側の輪郭 [r, y]。胴は上へ向かってわずかに広がる。
const INNER = [
  [33.0, 0],
  [33.2, 20],
  [33.8, 60],
  [34.8, 140],
  [35.2, 175],
];

export const LIP_Y = 175;

// 縁は丸いビード（トーラス）で閉じる。
const LIP_RO = OUTER[OUTER.length - 1][0];
const LIP_RI = INNER[INNER.length - 1][0];
export const LIP = { y: LIP_Y, rc: (LIP_RO + LIP_RI) / 2, rt: (LIP_RO - LIP_RI) / 2 };

// 底：外側はわずかに上げ底、内側は厚いガラスで、縁に向かって丸くせり上がる。
export const BASE = { punt: 1.2, puntR: 30, innerY: 15, innerRise: 3.5, innerR: 33 };

// 取っ手：胴の右（+x）に付いた D 字の太い管。x-y 平面の角丸の長方形の輪郭をなぞる。
// 一般的な 500cc のジョッキと同じく低めに付ける：下は厚い底のすぐ上（23mm）、上は高さの 7 割ほど（123mm）。
export const HANDLE = { cx: 55, cy: 73, hx: 15, hy: 50, round: 15, rx: 6.5, rz: 8.5 };

// 注ぎ終わりの目安：ビールはここまで、泡はその上に縁を少し越えるまで。
export const FILL_LEVEL = 146;
export const FOAM_TOP = LIP_Y + 4;

export const PROFILE_N = 1024;

// 単調な 3 次エルミート補間。行き過ぎ（オーバーシュート）しないので、
// 輪郭が制御点の間で膨らまない。y から [r, dr/dy] を返す。
function profileCurve(points) {
  const ys = points.map((p) => p[1]);
  const rs = points.map((p) => p[0]);
  const n = points.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((rs[i + 1] - rs[i]) / (ys[i + 1] - ys[i]));
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]);

  return (y) => {
    if (y <= ys[0]) return [rs[0] + m[0] * (y - ys[0]), m[0]];
    if (y >= ys[n - 1]) return [rs[n - 1], 0];
    let i = 0;
    while (y > ys[i + 1]) i++;
    const h = ys[i + 1] - ys[i];
    const t = (y - ys[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const r =
      (2 * t3 - 3 * t2 + 1) * rs[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * rs[i + 1] +
      (t3 - t2) * h * m[i + 1];
    const dr =
      ((6 * t2 - 6 * t) * rs[i] +
        (3 * t2 - 4 * t + 1) * h * m[i] +
        (-6 * t2 + 6 * t) * rs[i + 1] +
        (3 * t2 - 2 * t) * h * m[i + 1]) /
      h;
    return [r, dr];
  };
}

const outerAt = profileCurve(OUTER);
const innerAt = profileCurve(INNER);

// 輪郭を細かくサンプルした表。シェーダーと CPU 側で同じ値を使う。
const table = new Float32Array(PROFILE_N * 4);
for (let i = 0; i < PROFILE_N; i++) {
  const y = (i / (PROFILE_N - 1)) * LIP_Y;
  const [ro, dro] = outerAt(y);
  const [ri, dri] = innerAt(y);
  table.set([ro, dro, ri, dri], i * 4);
}

// y の高さでの [外径, 外径の傾き, 内径, 内径の傾き]。シェーダーの prof() と同じ線形補間。
export function profileAt(y) {
  const f = Math.min(Math.max(y / LIP_Y, 0), 1) * (PROFILE_N - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, PROFILE_N - 1);
  const a = f - i;
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) out[k] = table[i * 4 + k] * (1 - a) + table[j * 4 + k] * a;
  return out;
}

export function makeProfileTexture() {
  const tex = new THREE.DataTexture(table, PROFILE_N, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- 液面

// 半径 R の円のうち、ある向きへの射影が c より小さい部分の面積。
function segmentArea(c, R) {
  if (c <= -R) return 0;
  if (c >= R) return Math.PI * R * R;
  return R * R * Math.acos(-c / R) + c * Math.sqrt(R * R - c * c);
}

const SLICE = 0.5;
const SLICE_Y0 = BASE.innerY + 0.8;
// 泡は縁の上にもこんもり盛り上がるので、縁の上にも同じ太さの筒が続いているとして数える。
export const DOME_MAX = 10;
const EXT_Y = LIP_Y + DOME_MAX;
const SLICES = [];
for (let y = SLICE_Y0 + SLICE / 2; y < EXT_Y; y += SLICE) SLICES.push([y, profileAt(y)[2]]);

// ジョッキのローカル座標で、上向き up に垂直な面 dot(p, up) = h より下にある体積 (mm³)。
// ext は縁の上に泡が盛り上がれる高さ (mm)。その高さまで、縁の上にも同じ太さの筒が続いているとして数える。
export function volumeBelow(up, h, ext = 0) {
  const s = Math.hypot(up[0], up[2]);
  let v = 0;
  for (const [y, R] of SLICES) {
    if (y > LIP_Y + ext) break;
    if (s < 1e-6) {
      if (up[1] * y < h) v += Math.PI * R * R * SLICE;
    } else {
      v += segmentArea((h - up[1] * y) / s, R) * SLICE;
    }
  }
  return v;
}

// 体積 volume の液が、上向き up のときにつくる水平な面の高さ h を二分法で探す。
export function liquidPlane(up, volume, ext = 0) {
  let lo = -260;
  let hi = 260;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (volumeBelow(up, mid, ext) < volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 縁のいちばん低いところの高さ（上向き up で測る）。液面がこれを越えるとこぼれる＝飲める。
export function rimLow(up) {
  return LIP_Y * up[1] - LIP.rc * Math.hypot(up[0], up[2]);
}

// 縁のいちばん低いところの、ローカル座標での位置。
export function rimLowPoint(up) {
  const s = Math.hypot(up[0], up[2]);
  if (s < 1e-6) return [0, LIP_Y, LIP.rc];
  return [(-up[0] / s) * LIP.rc, LIP_Y, (-up[2] / s) * LIP.rc];
}

export const FULL_VOLUME = volumeBelow([0, 1, 0], FILL_LEVEL);
export const BRIM_VOLUME = volumeBelow([0, 1, 0], LIP_Y);
