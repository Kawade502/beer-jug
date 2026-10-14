// ジョッキの「上向き」を決める。ジョッキのローカル座標はスマホ本体と同じ向き（x 右、y 上、z 手前）なので、
// スマホを傾けると、重力の上向きが本体に対して回る。液面はいつもこの向きに垂直になる。
// 画面が自動で横向きになっても、main.js が中身を逆に回して本体の縦向きに合わせるので、ここでは画面の向きを気にしない。
//
// ・スマホ：傾きセンサー（deviceorientation）の beta/gamma から重力の向きを出す。
//   ふだんスマホは少し寝かせて持つので、乾杯したときの前後の傾きを「まっすぐ立てた状態」とみなす。
// ・パソコン：画面をドラッグ、または矢印キーで傾ける。離すと揺れながら戻る。

const TILT_MAX = (150 * Math.PI) / 180;
const PER_PX = 0.0062; // 1px ドラッグしたときの傾き (rad)
const KEY_RATE = 1.6; // キーを押している間の傾く速さ (rad/s)
const PITCH_MAX = (80 * Math.PI) / 180;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// 左右（画面内の回転、右へ倒すと正）と前後（上を手前へ倒すと正）の角度から上向きを作る。
export function upFromAngles(roll, pitch) {
  const cp = Math.cos(pitch);
  const v = [-Math.sin(roll) * cp, Math.cos(roll) * cp, -Math.sin(pitch)];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

// 端末の向き（度）から、本体の座標での重力の上向き。alpha（方位）は関係しない。
export function upFromOrientation(beta, gamma) {
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

// onFirstReading はセンサーの最初の値が届いたときに呼ぶ（main.js が画面の逆回しを始める）。
export function createTilt({ onFirstReading } = {}) {
  const st = {
    up: [0, 1, 0], // 液面が向いている上向き（ばねで目標を追う）
    vel: [0, 0, 0],
    target: [0, 1, 0],
    roll: 0,
    pitch: 0,
    rollV: 0,
    pitchV: 0,
    held: false,
    keys: { left: false, right: false, up: false, down: false },
    sensor: null, // センサーの生の上向き（本体の座標）。使っていなければ null
    frame: 0, // 中身の座標が本体に対して回っている角度（度、反時計回り）。ふつうは 0
    pitchRef: 0,
    test: null,
    // 振る：本体の加速度（重力を除く、m/s²）と、傾きの変わる速さ（rad/s）から、振っている強さ shake (0〜1) を出す。
    motion: 0,
    spin: 0,
    shake: 0,
    shakeKey: false, // パソコンの S キー
    shakeTest: 0,
    lastTarget: null,
    gLow: null,
  };

  // 重力を除いた本体の加速度。取れない端末では、重力込みの値から、ゆっくり変わる重力の分を引く。
  function onMotion(e) {
    const a = e.acceleration;
    let m = 0;
    if (a && a.x !== null && a.y !== null && a.z !== null) {
      m = Math.hypot(a.x, a.y, a.z);
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null) return;
      const v = [g.x, g.y, g.z];
      if (!st.gLow) st.gLow = [...v];
      for (let i = 0; i < 3; i++) st.gLow[i] += (v[i] - st.gLow[i]) * 0.1;
      m = Math.hypot(v[0] - st.gLow[0], v[1] - st.gLow[1], v[2] - st.gLow[2]);
    }
    st.motion = Math.max(st.motion, m);
  }

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    const first = !st.sensor;
    st.sensor = upFromOrientation(e.beta, e.gamma);
    if (st.needRef) calibrate();
    if (first) {
      st.lastTarget = null;
      onFirstReading?.();
    }
  }

  // センサーの上向きを、中身（ジョッキ）の座標にする。
  // スマホでは中身を本体に合わせて描くので回さない。逆回しをしないとき（自然な向きが横のタブレットなど）だけ回す。
  function sensorLocal() {
    const [x, y, z] = st.sensor;
    const a = (st.frame * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c - y * s, x * s + y * c, z];
  }

  // 今の前後の傾き（画面がどれだけ寝ているか）を「まっすぐ」にする。
  // 画面の法線の成分（z）だけで決めるので、縦持ちでも横持ちでも同じ値になる。
  function calibrate() {
    if (!st.sensor) {
      st.needRef = true;
      return false;
    }
    const [x, y, z] = st.sensor;
    st.needRef = false;
    st.lastTarget = null;
    st.pitchRef = clamp(Math.atan2(z, Math.hypot(x, y)), -0.5, (85 * Math.PI) / 180);
    return true;
  }

  // iPhone は、タップの中で許可をもらう必要がある。傾き（orientation）と動き（motion）の許可を、同じタップの中で一緒に聞く。
  async function enableSensor() {
    if (st.sensorOn) return true;
    const DOE = window.DeviceOrientationEvent;
    const DME = window.DeviceMotionEvent;
    if (!DOE) return false;
    const ask = (E) =>
      E && typeof E.requestPermission === 'function'
        ? E.requestPermission().then((r) => r === 'granted', () => false)
        : Promise.resolve(!!E);
    const [orientationOk, motionOk] = await Promise.all([ask(DOE), ask(DME)]);
    if (!orientationOk) return false;
    st.sensorOn = true;
    st.needRef = true;
    window.addEventListener('deviceorientation', onOrientation);
    // 振ったかどうかは加速度で見る。使えなくても、傾きの変わる速さで見る。
    if (motionOk) window.addEventListener('devicemotion', onMotion);
    return true;
  }

  function disableSensor() {
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
    st.sensorOn = false;
    st.sensor = null;
  }

  function sensorUp() {
    const [x, y, z] = sensorLocal();
    const c = Math.cos(st.pitchRef);
    const s = Math.sin(st.pitchRef);
    // ジョッキの x 軸（画面の横）まわりに -pitchRef 回す。乾杯したときの持ち方が「まっすぐ」になる。
    return [x, y * c + z * s, -y * s + z * c];
  }

  function step(dt) {
    // 手で傾ける角度。キーは押している間だけ、離せばばねで戻る。
    const k = st.keys;
    if (k.left || k.right) st.roll = clamp(st.roll + (k.right - k.left) * KEY_RATE * dt, -TILT_MAX, TILT_MAX);
    if (k.up || k.down) st.pitch = clamp(st.pitch + (k.down - k.up) * KEY_RATE * dt, -PITCH_MAX, PITCH_MAX);
    const holding = st.held || k.left || k.right || k.up || k.down;
    if (!holding) {
      st.rollV += (-80 * st.roll - 9 * st.rollV) * dt;
      st.pitchV += (-80 * st.pitch - 9 * st.pitchV) * dt;
      st.roll += st.rollV * dt;
      st.pitch += st.pitchV * dt;
    } else {
      st.rollV = st.pitchV = 0;
    }

    if (st.test) st.target = st.test;
    else if (st.sensor) st.target = sensorUp();
    else st.target = upFromAngles(st.roll, st.pitch);

    // 振っている強さ。加速度は 8〜20 m/s²、傾きの変わる速さは 7〜14 rad/s で 0〜1。
    // ふつうに傾けて飲む動きでは立たない。
    // センサーの値はとびとびに届くので少しならし、1 回で大きく飛んだ分（補正や最初の値など）は数えない。
    if (st.lastTarget) {
      const d = Math.min(Math.hypot(...st.target.map((x, i) => x - st.lastTarget[i])), 0.3);
      st.spin += (d / dt - st.spin) * (1 - Math.exp(-dt / 0.08));
    }
    st.lastTarget = [...st.target];
    const fromMotion = smooth(8, 20, st.motion);
    // 傾きの速さで見るのは、手で動かしているとき（センサー、ドラッグ中）だけ。手を離してばねで戻る動きは数えない。
    const fromSpin = st.sensor || st.held ? smooth(7, 14, st.spin) : 0;
    const now = Math.max(fromMotion, fromSpin, st.shakeKey ? 0.8 : 0, st.shakeTest);
    st.shake = Math.max(st.shake * Math.exp(-dt / 0.25), now);
    st.motion *= Math.exp(-dt / 0.15);

    // 液面は目標の向きを少し遅れて追い、行き過ぎて戻る（ちゃぷんと揺れる）。
    const u = st.up;
    const v = st.vel;
    for (let i = 0; i < 3; i++) {
      v[i] += (120 * (st.target[i] - u[i]) - 13 * v[i]) * dt;
      u[i] += v[i] * dt;
    }
    const l = Math.hypot(...u) || 1;
    for (let i = 0; i < 3; i++) u[i] /= l;
  }

  // テスト用：揺れを飛ばして、すぐその向きにする。
  function snap() {
    st.target = st.test || st.target;
    st.lastTarget = null;
    st.up = [...st.target];
    st.vel = [0, 0, 0];
  }

  const slosh = () => Math.hypot(...st.vel);
  const moving = () =>
    slosh() > 0.002 ||
    Math.abs(st.rollV) > 0.002 ||
    Math.abs(st.pitchV) > 0.002 ||
    Math.abs(st.roll) > 0.002 ||
    Math.abs(st.pitch) > 0.002 ||
    st.held ||
    st.shake > 0.01;

  return {
    state: st,
    get shake() {
      return st.shake;
    },
    step,
    snap,
    slosh,
    moving,
    enableSensor,
    disableSensor,
    calibrate,
    setFrame(deg) {
      if (deg !== st.frame) st.lastTarget = null;
      st.frame = deg;
    },
    PER_PX,
    TILT_MAX,
    PITCH_MAX,
    clamp,
    get up() {
      return st.up;
    },
    get sensorOn() {
      return !!st.sensorOn;
    },
  };
}
