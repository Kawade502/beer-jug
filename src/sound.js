// 効果音はすべて Web Audio で合成する（音声ファイルは使わない）。
//   トクトク  注いでいる間。満ちるほどジョッキの中の空気の音程が上がる
//   シュワ    泡がはじける、きめ細かいシュワー（注いでいる間と直後だけ、かすかに）
//   ゴクッ    ひと口ごと。縁からビールが流れ込んでいる間、リズムよく続く
//   コポッ    のどに空気が入る音
//   カチン    乾杯（ジョッキどうしが当たる音）
//   コトッ    おかわりでジョッキを置いたとき

function makeNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ビールの泡がはじける音：とても小さな泡が、ごく短い高い音の粒になって、すき間なく敷き詰められたもの。
// 粒の大きさをそろえて、目立つ「パチッ」が出ないようにする（炭酸飲料のような粗い音にしない）。
function makeFizz(ctx, seconds, perSecond) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.round(sr * seconds), sr);
  const d = buf.getChannelData(0);
  const p = perSecond / sr;
  for (let i = 0; i < d.length; i++) {
    if (Math.random() >= p) continue;
    const a = (0.5 + 0.5 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
    const f = 4000 + Math.random() * 7000;
    const tau = sr * (0.00015 + Math.random() * 0.00035);
    const len = Math.min(Math.round(tau * 5), d.length - i);
    for (let k = 0; k < len; k++) d[i + k] += a * Math.exp(-k / tau) * Math.sin((2 * Math.PI * f * k) / sr);
  }
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= 0.9 / (peak || 1);
  return buf;
}

// 注ぐ水音：ばらばらの間隔で落ちる、小さな「ポコッ」の粒（共鳴する泡の音）を重ねたもの。
function makeBabble(ctx, seconds, perSecond) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.round(sr * seconds), sr);
  const d = buf.getChannelData(0);
  const p = perSecond / sr;
  for (let i = 0; i < d.length; i++) {
    if (Math.random() >= p) continue;
    const a = 0.2 + 0.8 * Math.random();
    const f0 = 350 + Math.random() * 900;
    const tau = sr * (0.004 + Math.random() * 0.01);
    const len = Math.min(Math.round(tau * 5), d.length - i);
    let ph = 0;
    for (let k = 0; k < len; k++) {
      // 泡がつぶれながら音程が少し上がる（ミンナート共鳴）。
      ph += (2 * Math.PI * f0 * (1 + (k / tau) * 0.15)) / sr;
      d[i + k] += a * Math.exp(-k / tau) * Math.sin(ph);
    }
  }
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= 0.9 / (peak || 1);
  return buf;
}

// AudioContext でも OfflineAudioContext でも使えるように、音を作る部分だけを分けておく。
export function createVoices(ctx, out) {
  const noise = makeNoise(ctx, 2);
  const fizzBuf = makeFizz(ctx, 4, 2500);
  const babble = makeBabble(ctx, 3, 180);

  const gainAt = (t, peak, attack, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(out);
    return g;
  };

  const noiseAt = (t, dur) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.start(t, Math.random() * Math.max(0, noise.duration - dur), dur);
    return src;
  };

  const tone = (t, type, f0, f1, glide, peak, attack, decay) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + glide);
    osc.connect(gainAt(t, peak, attack, decay));
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  };

  function gulp(t, v = 1) {
    // のどを通る低い「ゴクッ」。ゴとクの 2 段にする。
    const k = 0.92 + Math.random() * 0.16;
    tone(t, 'sine', 190 * k, 85 * k, 0.08, 0.6 * v, 0.004, 0.12);
    tone(t + 0.07, 'sine', 150 * k, 70 * k, 0.07, 0.5 * v, 0.003, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    noiseAt(t, 0.12).connect(lp).connect(gainAt(t, 0.35 * v, 0.003, 0.08));
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 2;
    noiseAt(t + 0.06, 0.02).connect(bp).connect(gainAt(t + 0.06, 0.12 * v, 0.001, 0.012));
  }

  // 空気の泡の「コポッ」。大きい泡ほど低い（半径 r mm）。
  function glug(t, r = 3) {
    const f = Math.min(1400, 3260 / r);
    tone(t, 'sine', f * 0.85, f * 1.5, 0.06, 0.18, 0.002, 0.09);
  }

  // ジョッキどうしが当たる「カチン」。厚いガラスの、整数倍にならない倍音。
  function clink(t) {
    const partials = [
      [1820, 0.45, 0.5],
      [2950, 0.3, 0.35],
      [4370, 0.18, 0.22],
      [6110, 0.1, 0.12],
    ];
    for (const [f, a, d] of partials) {
      tone(t, 'sine', f, f, 0, a * 0.7, 0.001, d);
      tone(t + 0.012, 'sine', f * 1.013, f * 1.013, 0, a * 0.45, 0.001, d * 0.8);
    }
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    noiseAt(t, 0.01).connect(hp).connect(gainAt(t, 0.3, 0.0005, 0.008));
  }

  function thunk(t) {
    tone(t, 'sine', 160, 80, 0.06, 0.55, 0.002, 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450;
    noiseAt(t, 0.05).connect(lp).connect(gainAt(t, 0.4, 0.001, 0.035));
    tone(t, 'sine', 1180, 1180, 0, 0.04, 0.002, 0.3);
  }

  // 鳴らしっぱなしにして、音量だけを動かす音。
  const layer = (buf, rate, type, freq, q = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filt).connect(g).connect(out);
    return { src, filt, g };
  };
  // 注ぐ音：落ちる流れのザーッ、泡のトクトク、ジョッキの中の空気の共鳴。
  const rush = layer(noise, 1, 'lowpass', 900);
  const bubbling = layer(babble, 1, 'bandpass', 900, 0.7);
  const tube = layer(noise, 1, 'bandpass', 600, 9);
  // シュワシュワ：高いところだけを残し、さらに耳に刺さるいちばん高いところを落とす。
  const fizz = layer(fizzBuf, 1, 'highpass', 3000, 0.7);
  const fizzLp = ctx.createBiquadFilter();
  fizzLp.type = 'lowpass';
  fizzLp.frequency.value = 11000;
  fizz.filt.disconnect();
  fizz.filt.connect(fizzLp).connect(fizz.g);

  const loops = {
    start(t) {
      rush.src.start(t);
      bubbling.src.start(t, 0.9);
      tube.src.start(t, 0.3);
      fizz.src.start(t, 1.7);
    },
    // flow: 注ぐ勢い (0〜1), air: 液面から縁までの空気の長さ (mm), fizzy: シュワシュワ (0〜1)
    set(flow, air, fizzy, t) {
      rush.g.gain.setTargetAtTime(0.16 * flow, t, 0.05);
      bubbling.g.gain.setTargetAtTime(0.5 * flow, t, 0.05);
      // 口の開いた筒の共鳴：f ≒ 音速 / (4 × 長さ)。満ちるほど高くなる。
      const f = Math.min(3200, 343000 / (4 * (Math.max(air, 0) + 25)));
      tube.filt.frequency.setTargetAtTime(f, t, 0.08);
      bubbling.filt.frequency.setTargetAtTime(f * 1.4, t, 0.08);
      tube.g.gain.setTargetAtTime(0.5 * flow, t, 0.05);
      fizz.g.gain.setTargetAtTime(0.16 * fizzy, t, 0.25);
    },
  };

  return { gulp, glug, clink, thunk, loops };
}

const MUTE_KEY = 'beer-jug:muted';

export function createSound() {
  let ctx = null;
  let master = null;
  let voices = null;
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // 保存できない環境では毎回音ありで始める。
  }

  // ブラウザは操作があるまで音を出させないので、最初のタップやキー入力で作る。
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      voices = createVoices(ctx, master);
      voices.loops.start(ctx.currentTime);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  const ready = () => ctx && ctx.state === 'running';

  return {
    unlock,
    gulp(v) {
      if (ready()) voices.gulp(ctx.currentTime, v);
    },
    glug(r) {
      if (ready()) voices.glug(ctx.currentTime, r);
    },
    clink() {
      if (ready()) voices.clink(ctx.currentTime);
    },
    thunk() {
      if (ready()) voices.thunk(ctx.currentTime);
    },
    setLoops(flow, air, fizz) {
      if (ready()) voices.loops.set(flow, air, fizz, ctx.currentTime);
    },
    pause() {
      if (ctx && ctx.state === 'running') ctx.suspend();
    },
    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // 保存できなくても切り替え自体はできる。
      }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
