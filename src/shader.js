import { BASE, HANDLE, LIP, PROFILE_N } from './jug.js';
import { MAX_BUB } from './beer.js';

// 小数点付きの GLSL 定数にする。
const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(5)}`);

// sRGB の色を線形にする。
const lin = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const c = v.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return `vec3(${c.map(f).join(', ')})`;
};

// 光源の向き（キーライトの中心、世界座標）。
export const KEY_AZ = -0.75;
export const KEY_EL = 0.6;

export const VERT = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, gl_FragCoord.xy / uRes);
}
`;

export const TRACE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec3 uCamPos; // ジョッキのローカル座標（＝画面の向き）でのカメラ位置。カメラは -z を向く
uniform vec2 uCamShift;
// 画面の上でジョッキを傾けて描くとき（パソコン）の回転（世界 → ジョッキ）と、その中心。スマホでは単位行列。
uniform mat3 uView;
uniform vec3 uPivot;
uniform float uTanHalf;
uniform sampler2D uProf;
// ローカル → 世界の向き：world = uRot * local。世界の y が重力の上向き。
uniform mat3 uRot;
uniform vec3 uLightL; // キーライトの向き（ローカル座標）
uniform vec4 uLiq; // 液面 dot(p, uLiq.xyz) = uLiq.w（xyz はローカル座標での上向き）
uniform float uFoamD; // 泡の上面 dot(p, uLiq.xyz) = uFoamD
uniform float uDome; // 泡が縁の上に盛り上がれる高さ（立てているときだけ）
uniform vec4 uBub[${MAX_BUB}];
uniform int uBubN;
uniform float uRipple;
uniform float uHaze;
uniform float uTime;
uniform vec3 uStreamC; // 注ぐ流れの軸が通る点（ローカル座標）
uniform vec3 uStream; // x: 半径, y: 下端, z: 上端（上向きに測った高さ）。半径 0 なら流れなし

out vec4 fragColor;

#define PI 3.14159265
#define AIR 0
#define GLASS 1
#define LIQ 2

const float PROF_N = ${f(PROFILE_N)};
const float LIP_Y = ${f(LIP.y)};
const float LIP_RC = ${f(LIP.rc)};
const float LIP_RT = ${f(LIP.rt)};
const float PUNT = ${f(BASE.punt)};
const float PUNT_R2 = ${f(BASE.puntR * BASE.puntR)};
const float BIN_Y = ${f(BASE.innerY)};
const float BIN_RISE = ${f(BASE.innerRise)};
const float BIN_R = ${f(BASE.innerR)};
const vec2 H_C = vec2(${f(HANDLE.cx)}, ${f(HANDLE.cy)});
const vec2 H_H = vec2(${f(HANDLE.hx)}, ${f(HANDLE.hy)});
const float H_ROUND = ${f(HANDLE.round)};
const float H_RX = ${f(HANDLE.rx)};
const float H_RZ = ${f(HANDLE.rz)};

const vec3 BOX_LO = vec3(-42.0, -0.5, -42.0);
const vec3 BOX_HI = vec3(${f(HANDLE.cx + HANDLE.hx + HANDLE.rx + 1)}, LIP_Y + 14.0, 42.0);

const float EPS = 0.015;
const int MAX_STEPS = 200;
const float IOR_GLASS = 1.5;
const float IOR_LIQ = 1.34;

const vec3 ABS_GLASS = vec3(0.0042, 0.0016, 0.0032);
// ビール：青をよく吸い、厚いところほど濃い琥珀色になる。
const vec3 ABS_LIQ = vec3(0.0021, 0.0088, 0.034);

const vec3 WALL_LO = ${lin('#24170d')};
const vec3 WALL_HI = ${lin('#5a3d24')};
const vec3 WOOD = ${lin('#6b4426')};
const vec3 WOOD_DARK = ${lin('#3d2414')};
const vec3 FOAM_COL = ${lin('#fbf3df')};
const vec3 FOAM_SHADE = ${lin('#d8c49a')};
const vec3 HAZE_COL = ${lin('#f6dd9c')};

// ---------------------------------------------------------------- 形

vec4 prof(float y) {
  float fy = clamp(y / LIP_Y, 0.0, 1.0) * (PROF_N - 1.0);
  int i = int(fy);
  vec4 a = texelFetch(uProf, ivec2(i, 0), 0);
  vec4 b = texelFetch(uProf, ivec2(min(i + 1, int(PROF_N) - 1), 0), 0);
  return mix(a, b, fy - float(i));
}

float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// 取っ手：x-y 平面の角丸の長方形の輪郭をなぞる、断面が楕円の管。胴の外側だけ。
float sdHandle(vec3 p) {
  vec2 d = abs(p.xy - H_C) - H_H + H_ROUND;
  float ring = abs(length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - H_ROUND);
  float k = length(vec2(ring / H_RX, p.z / H_RZ));
  return (k - 1.0) * min(H_RX, H_RZ);
}

// x: ガラスまでの距離, y: ジョッキの内部空間までの距離（どちらも負なら内側）。
vec2 sdJug(vec3 p) {
  float r = length(p.xz);
  vec4 P = prof(p.y);
  float dOut = (r - P.x) * inversesqrt(1.0 + P.y * P.y);
  float dIn = (r - P.z) * inversesqrt(1.0 + P.w * P.w);
  float bOut = PUNT * max(0.0, 1.0 - r * r / PUNT_R2) - p.y;
  float q = r / BIN_R;
  q *= q;
  float bIn = BIN_Y + BIN_RISE * q * q - p.y;
  float outer = max(smax(dOut, bOut, 3.0), p.y - LIP_Y);
  float cav = smax(dIn, bIn, 5.0);
  float glass = max(outer, -cav);
  glass = min(glass, length(vec2(r - LIP_RC, p.y - LIP_Y)) - LIP_RT);
  if (p.x > 30.0) glass = smin(glass, max(sdHandle(p), 37.0 - p.x), 5.0);
  return vec2(glass, cav);
}

vec3 glassNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.02;
  return normalize(
    k.xyy * sdJug(p + k.xyy * h).x +
    k.yyx * sdJug(p + k.yyx * h).x +
    k.yxy * sdJug(p + k.yxy * h).x +
    k.xxx * sdJug(p + k.xxx * h).x
  );
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}

// 泡の膜の模様（ボロノイ）。x: いちばん近い泡の中心まで, y: 2 番目まで。
vec2 voronoi(vec3 x, out vec3 off) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  off = vec3(0.0);
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int n = -1; n <= 1; n++) {
    vec3 g = vec3(float(n), float(j), float(k));
    vec3 r = g + hash33(i + g) - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; off = r; }
    else if (d < f2) { f2 = d; }
  }
  return sqrt(vec2(f1, f2));
}

// 泡の上面の高さ（上向きに測る）。縁の上では、まん中がこんもり盛り上がる。
float foamTop(vec3 p) {
  float r2 = dot(p.xz, p.xz) / (LIP_RC * LIP_RC);
  float lift = max(uFoamD - LIP_Y, 0.0) * smoothstep(0.0, 4.0, uDome);
  return uFoamD + lift * (0.4 - r2) + (vnoise(p * 0.22 + vec3(0.0, uTime * 0.05, 0.0)) - 0.5) * 1.6;
}

bool hasFoam() {
  return uFoamD > uLiq.w + 0.3;
}

// 泡の層：内部空間（縁の上は同じ太さの筒）の中で、液面と泡の上面の間。
float sdFoam(vec3 p) {
  // 縁の上は筒にする。傾けているときは縁の高さで切る。
  float cav = p.y > LIP_Y - 2.0 ? max(length(p.xz) - (LIP_RC - 0.6), p.y - LIP_Y - 0.5 - uDome * 1.4) : sdJug(p).y;
  float h = dot(p, uLiq.xyz);
  return max(max(cav, h - foamTop(p)), uLiq.w - h);
}

vec3 foamNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.08;
  return normalize(
    k.xyy * sdFoam(p + k.xyy * h) +
    k.yyx * sdFoam(p + k.yyx * h) +
    k.yxy * sdFoam(p + k.yxy * h) +
    k.xxx * sdFoam(p + k.xxx * h)
  );
}

// 外から球に当たるときの距離。当たらなければ -1。
float sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return -1.0;
  float t = -b - sqrt(h);
  return t > 1e-4 ? t : -1.0;
}

// 球の内側から外へ抜けるまでの距離。
float sphereExit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  return -b + sqrt(max(b * b - dot(oc, oc) + r * r, 0.0));
}

// 注ぐ流れ（上向きの軸を持つ円柱）に入る距離と出る距離。
vec2 streamHit(vec3 ro, vec3 rd) {
  if (uStream.x <= 0.0) return vec2(1.0, -1.0);
  vec3 u = uLiq.xyz;
  vec3 o = ro - uStreamC;
  vec3 op = o - u * dot(o, u);
  vec3 dp = rd - u * dot(rd, u);
  float a = dot(dp, dp);
  if (a < 1e-8) return vec2(1.0, -1.0);
  float b = dot(op, dp);
  float c = dot(op, op) - uStream.x * uStream.x;
  float h = b * b - a * c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  vec2 t = vec2(-b - h, -b + h) / a;
  float lo = max(uStream.y, hasFoam() ? uFoamD : uLiq.w);
  float h0 = dot(ro + rd * t.x, u);
  if (h0 < lo || h0 > uStream.z) return vec2(1.0, -1.0);
  return t;
}

// ---------------------------------------------------------------- 居酒屋

float softbox(vec3 rd, float az0, float el0, float aw, float eh, float soft) {
  float az = atan(rd.x, rd.z);
  float el = asin(clamp(rd.y, -1.0, 1.0));
  float da = abs(mod(az - az0 + PI, 2.0 * PI) - PI);
  return (1.0 - smoothstep(aw - soft, aw + soft, da)) *
         (1.0 - smoothstep(eh - soft, eh + soft, abs(el - el0)));
}

// 店の明かりのぼけ。方向を格子に分けて、ひと升にひとつ丸い光を置く。
// 横方向はちょうど一周 BOKEH_N 升にして、升の番号を一周でつなぐ（真後ろで光が途切れる継ぎ目を作らない）。
const float BOKEH_N = 28.0;
vec3 bokeh(vec3 rd) {
  float az = atan(rd.x, rd.z);
  float el = asin(clamp(rd.y, -1.0, 1.0));
  vec2 g = vec2(az / (2.0 * PI) * BOKEH_N, el / 0.22);
  vec2 cell = floor(g);
  vec3 c = vec3(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 id = cell + vec2(float(i), float(j));
    vec3 h = hash33(vec3(mod(id.x, BOKEH_N), id.y, 3.0));
    if (h.z < 0.45) continue;
    vec2 ctr = id + 0.2 + 0.6 * h.xy;
    float d = length((g - ctr) * vec2(cos(el), 1.0));
    float rad = 0.22 + 0.25 * h.x;
    float disc = 1.0 - smoothstep(rad - 0.06, rad, d);
    vec3 tint = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.86, 0.62), h.y);
    if (h.z > 0.93) tint = vec3(0.65, 0.8, 1.0);
    c += tint * disc * (0.35 + 1.1 * h.z * h.z);
  }
  return c * smoothstep(-0.15, 0.15, rd.y) * (1.0 - smoothstep(0.6, 1.1, el));
}

vec3 skyW(vec3 rd) {
  vec3 c = mix(WALL_LO, WALL_HI, smoothstep(-0.4, 0.6, rd.y));
  // ジョッキの後ろの、やわらかく明るい壁。ビールはこれを透かして金色に光る。
  c += vec3(1.0, 0.78, 0.48) * 0.55 * softbox(rd, PI, 0.05, 0.55, 0.45, 0.45);
  c += bokeh(rd) * 0.7;
  // 正面上のあかり（キーライト）と、左右の細いあかり。ガラスの縁に映り込む。
  c += vec3(1.0, 0.93, 0.82) * 6.0 * softbox(rd, ${f(KEY_AZ)}, ${f(KEY_EL)}, 0.24, 0.3, 0.06);
  c += vec3(1.0, 0.95, 0.88) * 2.6 * softbox(rd, PI - 0.85, 0.3, 0.07, 0.5, 0.03);
  c += vec3(1.0, 0.95, 0.88) * 2.6 * softbox(rd, -(PI - 0.85), 0.3, 0.07, 0.5, 0.03);
  c += vec3(0.8, 0.9, 1.0) * 1.2 * softbox(rd, 1.25, 0.3, 0.16, 0.4, 0.05);
  return c;
}

// ずっと下を向くと木のカウンター。
vec3 backgroundW(vec3 rd) {
  vec3 c = skyW(rd);
  if (rd.y < -0.3) {
    vec2 fp = rd.xz / -rd.y * 300.0;
    float grain = vnoise(vec3(fp.x * 0.02, fp.y * 0.6, 0.0)) * 0.6 + vnoise(vec3(fp.x * 0.004, fp.y * 0.08, 5.0)) * 0.4;
    vec3 w = mix(WOOD_DARK, WOOD, grain) * 0.6;
    float lit = softbox(reflect(rd, vec3(0.0, 1.0, 0.0)), ${f(KEY_AZ)}, ${f(KEY_EL)}, 0.4, 0.4, 0.3);
    w += vec3(1.0, 0.85, 0.65) * lit * 0.5;
    c = mix(c, w, smoothstep(-0.3, -0.5, rd.y));
  }
  return c;
}

vec3 sky(vec3 rdL) {
  return skyW(uRot * rdL);
}

vec3 background(vec3 rdL) {
  return backgroundW(uRot * rdL);
}

// ---------------------------------------------------------------- 光の受け渡し

float fresnel(float cosi, float eta) {
  float st2 = eta * eta * (1.0 - cosi * cosi);
  if (st2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - st2);
  float rs = (eta * cosi - ct) / (eta * cosi + ct);
  float rp = (cosi - eta * ct) / (cosi + eta * ct);
  return 0.5 * (rs * rs + rp * rp);
}

float iorOf(int med) {
  return med == GLASS ? IOR_GLASS : (med == LIQ ? IOR_LIQ : 1.0);
}

vec3 absorbOf(int med) {
  return med == GLASS ? ABS_GLASS : (med == LIQ ? ABS_LIQ : vec3(0.0));
}

// N は光が来た側を向く。屈折して先へ進めば true、全反射して戻れば false。
bool crossSurface(vec3 hp, vec3 N, float n1, float n2, inout vec3 rd, out vec3 p, inout vec3 col, inout vec3 thru) {
  float eta = n1 / n2;
  float cosi = clamp(-dot(rd, N), 0.0, 1.0);
  float F = fresnel(cosi, eta);
  vec3 rf = reflect(rd, N);
  if (F >= 0.999) {
    rd = rf;
    p = hp + N * 2.0 * EPS;
    return false;
  }
  col += thru * F * background(rf);
  thru *= 1.0 - F;
  rd = refract(rd, N, eta);
  p = hp - N * 2.0 * EPS;
  return true;
}

// 液の中の泡を通り抜ける。
void throughBubble(vec3 hp, vec3 c, float R, inout vec3 rd, inout vec3 p, inout vec3 col, inout vec3 thru) {
  vec3 N = normalize(hp - c);
  float F = fresnel(clamp(-dot(rd, N), 0.0, 1.0), IOR_LIQ);
  vec3 rf = reflect(rd, N);
  // 泡は光をよく返すので、明るい点に見える。
  col += thru * F * (background(rf) * 0.8 + vec3(0.9, 0.8, 0.6) * 0.25);
  thru *= 1.0 - F;
  if (F >= 0.999) {
    rd = rf;
    p = hp + N * 2.0 * EPS;
    return;
  }
  vec3 d = refract(rd, N, IOR_LIQ);
  float tt = sphereExit(hp, d, c, R);
  vec3 e = hp + d * tt;
  vec3 Ni = -normalize(e - c);
  vec3 o = refract(d, Ni, 1.0 / IOR_LIQ);
  rd = dot(o, o) > 0.0 ? o : reflect(d, Ni);
  p = e + rd * 2.0 * EPS;
}

// 泡の層の見た目。ガラスに押し付けられた泡の膜（ボロノイ）が透けて見える。
// depth は液面からの高さ。液面に近いほど泡が大きく、ビールの色が混じる。
vec3 foamColor(vec3 hp, vec3 n, float depth, float glassSide) {
  vec3 off;
  float sc = mix(0.32, 0.75, smoothstep(0.0, 12.0, depth));
  vec2 v = voronoi(hp * sc, off);
  float wall = 1.0 - smoothstep(0.0, mix(0.1, 0.22, glassSide), v.y - v.x);
  float cell = pow(clamp(1.0 - v.x * 1.25, 0.0, 1.0), 2.0);
  float wrap = dot(n, uLightL) * 0.5 + 0.5;
  vec3 c = mix(FOAM_SHADE, FOAM_COL, 0.55 + 0.45 * wrap);
  c *= 0.92 + 0.3 * wrap;
  c = mix(c, c * 1.12 + 0.04, wall * glassSide);
  c *= 1.0 - 0.18 * cell * glassSide;
  // 液面の近くは、大きな泡越しにビールの色がのぞく。
  float beer = 1.0 - smoothstep(0.0, 6.0, depth);
  c = mix(c, vec3(0.95, 0.62, 0.16) * (0.5 + 0.4 * wrap), beer * 0.7);
  return c;
}

// 液全体の濁り（注いだ直後の細かい泡）。下から上へ流れる筋になる。ビールのほのかな光も足す。
void liquidHaze(vec3 p, vec3 rd, float t, inout vec3 col, inout vec3 thru) {
  float n = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 q = p + rd * t * (float(i) + 0.5) / 3.0;
    float m = vnoise(vec3(q.x * 0.25, q.y * 0.08 - uTime * 2.6, q.z * 0.25));
    n += m * m;
  }
  n /= 3.0;
  float dens = uHaze * (0.15 + 2.2 * n) + 0.0012;
  float T = exp(-dens * t);
  col += thru * (1.0 - T) * HAZE_COL * mix(0.55, 1.0, uHaze / 0.05);
  thru *= T;
}

// ---------------------------------------------------------------- レイトレース

vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (BOX_LO - ro) * inv;
  vec3 t1 = (BOX_HI - ro) * inv;
  vec3 a = min(t0, t1);
  vec3 b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}

bool outsideBox(vec3 q, vec3 rd) {
  return (q.x < BOX_LO.x && rd.x < 0.0) || (q.x > BOX_HI.x && rd.x > 0.0) ||
         (q.y < BOX_LO.y && rd.y < 0.0) || (q.y > BOX_HI.y && rd.y > 0.0) ||
         (q.z < BOX_LO.z && rd.z < 0.0) || (q.z > BOX_HI.z && rd.z > 0.0);
}

vec3 trace(vec3 ro, vec3 rd) {
  vec2 tb = boxHit(ro, rd);
  if (tb.y <= max(tb.x, 0.0)) return background(rd);
  vec3 p = ro + rd * max(tb.x, 0.0);
  int med = AIR;
  vec3 col = vec3(0.0);
  vec3 thru = vec3(1.0);
  int steps = 0;
  bool foam = hasFoam();
  bool streamOff = false;

  for (int ev = 0; ev < 14; ev++) {
    // 解析的に求まる面：液面、泡、注ぐ流れ。
    float tA = 1e5;
    int aKind = 0;
    int aIdx = 0;
    if (med != GLASS) {
      float dn = dot(rd, uLiq.xyz);
      if (abs(dn) > 1e-6) {
        float tp = (uLiq.w - dot(p, uLiq.xyz)) / dn;
        vec3 qp = p + rd * tp;
        if (tp > 1e-4 && (med == LIQ || (qp.y < LIP_Y && sdJug(qp).y < 0.0))) { tA = tp; aKind = 2; }
      }
      if (med == LIQ) {
        for (int i = 0; i < ${MAX_BUB}; i++) {
          if (i >= uBubN) break;
          vec4 b = uBub[i];
          float tbb = sphereHit(p, rd, b.xyz, b.w);
          if (tbb > 0.0 && tbb < tA) { tA = tbb; aKind = 3; aIdx = i; }
        }
      } else if (!streamOff) {
        vec2 ts = streamHit(p, rd);
        if (ts.x > 1e-4 && ts.x < ts.y && ts.x < tA) { tA = ts.x; aKind = 4; }
      }
    }

    // 距離場をたどる面：ガラスと泡の層。
    float t = 0.0;
    int kind = -1; // -1: 予算切れ, 0: 外へ抜けた, 1: ガラス, 3: 泡, 4: 解析的な面
    for (int s = 0; s < MAX_STEPS; s++) {
      if (++steps > MAX_STEPS) break;
      vec3 q = p + rd * t;
      vec2 B = sdJug(q);
      float d = med == GLASS ? -B.x : B.x;
      int k = 1;
      if (med == AIR && foam) {
        float df = sdFoam(q);
        if (df < d) { d = df; k = 3; }
      }
      if (d < EPS) { kind = k; break; }
      float stepLen = d * 0.9;
      if (t + stepLen >= tA) { t = tA; kind = 4; break; }
      t += stepLen;
      if (med == AIR && outsideBox(p + rd * t, rd)) { kind = 0; break; }
    }

    if (med == LIQ) liquidHaze(p, rd, t, col, thru);
    thru *= exp(-absorbOf(med) * t);
    vec3 hp = p + rd * t;

    if (kind <= 0) return col + thru * background(rd);

    if (kind == 3) {
      // 上から泡の層に当たった。
      vec3 n = foamNormal(hp);
      vec3 c = foamColor(hp * 1.3, n, dot(hp, uLiq.xyz) - uLiq.w, 0.0);
      float F = 0.03 + 0.5 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
      return col + thru * (c * (1.0 - F) + F * sky(reflect(rd, n)));
    }

    if (kind == 1) {
      vec3 n = glassNormal(hp);
      vec3 N = dot(rd, n) < 0.0 ? n : -n;
      int next = GLASS;
      bool intoFoam = false;
      if (med == GLASS) {
        vec3 probe = hp - N * 3.0 * EPS;
        float h = dot(probe, uLiq.xyz);
        next = (sdJug(probe).y < 0.0 && h < uLiq.w) ? LIQ : AIR;
        intoFoam = next == AIR && foam && sdJug(probe).y < 0.0 && h < foamTop(probe);
      }
      if (crossSurface(hp, N, iorOf(med), intoFoam ? IOR_LIQ : iorOf(next), rd, p, col, thru)) {
        if (intoFoam) {
          // ガラス越しに泡の層を見る。ほぼ不透明。液面のすぐ上だけ少し透ける。
          float depth = dot(hp, uLiq.xyz) - uLiq.w;
          vec3 c = foamColor(hp, n, depth, 1.0);
          float op = mix(0.55, 1.0, smoothstep(0.0, 4.0, depth));
          col += thru * op * c;
          thru *= 1.0 - op;
          if (op > 0.98) return col;
          med = LIQ;
          continue;
        }
        med = next;
      }
      continue;
    }

    if (aKind == 2) {
      // 液面。水平（世界の上向き）で、さざ波で少し揺れる。
      vec3 n = uLiq.xyz;
      vec3 t1 = normalize(cross(n, abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
      vec3 t2 = cross(n, t1);
      n += uRipple * 0.12 * (t1 * (sin(hp.x * 0.7 + uTime * 9.0) + sin(hp.z * 1.3 - uTime * 6.0)) +
                             t2 * (sin(hp.z * 0.6 - uTime * 7.0) + sin(hp.x * 1.1 + uTime * 5.0)));
      n = normalize(n);
      if (med == LIQ && foam) {
        // 下から泡の層の底を見上げる。
        // 泡は上からの光を通して、下から見るとビール色を帯びたクリーム色に光る。
        vec3 off;
        vec2 v = voronoi(hp * 0.6, off);
        float cell = 1.0 - smoothstep(0.0, 0.2, v.y - v.x);
        vec3 under = mix(vec3(0.95, 0.72, 0.36), FOAM_COL, 0.45) * (0.75 + 0.2 * cell);
        return col + thru * under;
      }
      vec3 N = dot(rd, n) < 0.0 ? n : -n;
      int next = med == LIQ ? AIR : LIQ;
      if (crossSurface(hp, N, iorOf(med), iorOf(next), rd, p, col, thru)) med = next;
    } else if (aKind == 3) {
      vec4 b = uBub[aIdx];
      throughBubble(hp, b.xyz, b.w, rd, p, col, thru);
    } else if (aKind == 4) {
      // 注ぐ流れ：琥珀色に透ける円柱。表面の流れる筋で、落ちていく動きを見せる。
      vec2 ts = streamHit(p, rd);
      float chord = max(ts.y - ts.x, 0.0);
      vec3 u = uLiq.xyz;
      vec3 o = hp - uStreamC;
      vec3 n = normalize(o - u * dot(o, u));
      float h = dot(hp, u);
      float F = fresnel(clamp(-dot(rd, n), 0.0, 1.0), 1.0 / IOR_LIQ);
      float streak = vnoise(vec3(atan(n.x, n.z) * 3.0, h * 0.12 + uTime * 14.0, 0.0));
      col += thru * (F * sky(reflect(rd, n)) + vec3(1.0, 0.8, 0.45) * 0.12 * streak);
      thru *= (1.0 - F) * exp(-ABS_LIQ * chord * 1.3) * (0.85 + 0.15 * streak);
      p = hp + rd * (chord + 0.05);
      streamOff = true;
    }
  }
  return col + thru * background(rd);
}

// 白飛びの手前でやわらかく丸める。
vec3 tonemap(vec3 c) {
  const float k = 0.78;
  vec3 over = max(c - k, 0.0);
  return min(c, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uView * vec3(uv * uTanHalf + uCamShift, -1.0));
  vec3 ro = uView * (uCamPos - uPivot) + uPivot;
  vec3 c = trace(ro, rd);
  vec2 v = gl_FragCoord.xy / uRes - 0.5;
  c *= 1.0 - 0.3 * dot(v, v) * 2.0;
  c = tonemap(c);
  c = pow(c, vec3(1.0 / 2.2));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  fragColor = vec4(c, 1.0);
}
`;
