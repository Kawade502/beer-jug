// 飲み干した杯数と、杯数の記念。この端末の localStorage にだけ記録する（サーバーには送らない）。
// 記念の SBT を申請したときは、その記念を「申請済み」として覚えておく。

export const BADGES = [
  { id: 'kanpai', name: '乾杯', cups: 2, color: 'bronze' },
  { id: 'joren', name: '常連さん', cups: 5, color: 'silver' },
  { id: 'meiyo', name: '名誉店主', cups: 10, color: 'gold' },
];

const KEY = 'beer-jug:cups:v1';

// persist が false（?test）のときは、メモリの中だけで数える。
export function createCups({ persist = true } = {}) {
  let data = blank();
  if (persist) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (v && Number.isInteger(v.count) && v.count >= 0) data = { ...blank(), ...v };
    } catch {
      // 読めない環境（プライベートブラウズなど）では、この回だけ数える。
    }
  }

  function blank() {
    return { count: 0, reached: {}, applied: {} };
  }

  function save() {
    if (!persist) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // 保存できなくても、この回のあいだは数える。
    }
  }

  // 1 杯飲み干した。ちょうど届いた記念があれば返す。
  function add(now = new Date()) {
    data.count++;
    let hit = null;
    for (const b of BADGES) {
      if (data.count >= b.cups && !data.reached[b.id]) {
        data.reached[b.id] = now.toISOString().slice(0, 10);
        hit = b;
      }
    }
    save();
    return hit;
  }

  return {
    BADGES,
    get count() {
      return data.count;
    },
    reached: (id) => data.reached[id] || '',
    applied: (id) => data.applied[id] || null,
    add,
    // 申請を受け付けてもらった。アドレスは全体を残さず、確かめられるだけの形で覚える。
    markApplied(id, address, now = new Date()) {
      data.applied[id] = { address: `${address.slice(0, 6)}…${address.slice(-4)}`, at: now.toISOString().slice(0, 10) };
      save();
    },
    // テスト用：杯数をそのまま決める（届いた記念も合わせる）。
    set(n) {
      data = blank();
      for (let i = 0; i < n; i++) add();
    },
  };
}
