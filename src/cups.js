// 飲み干した杯数と、杯数の記念。この端末の localStorage に記録する
// （サーバーに送るのは、記念の SBT を申請したときの杯数だけ。src/badges.js）。
// 記念の SBT を申請したときは、その記念を「申請済み」として覚えておく。

export const BADGES = [
  { id: 'kanpai', name: '乾杯', cups: 2, color: 'bronze' },
  { id: 'joren', name: '常連さん', cups: 5, color: 'silver' },
  { id: 'meiyo', name: '名誉店主', cups: 10, color: 'gold' },
];

const KEY = 'beer-jug:cups:v1';

// 端末の時計の日付（日本なら日本時間）。toISOString だと、日本の朝 9 時までは前の日になる。
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// persist が false（?test）のときは、メモリの中だけで数える。
export function createCups({ persist = true } = {}) {
  let data = blank();
  load();

  // 保存した記録を読む。書く直前にも読み直す（別のタブで開いていて、そちらで数えた分を消さないように）。
  function load() {
    if (!persist) return;
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
      if (v && Number.isInteger(v.count) && v.count >= 0) data = { count: v.count, reached: obj(v.reached), applied: obj(v.applied) };
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
    load();
    data.count++;
    let hit = null;
    for (const b of BADGES) {
      if (data.count >= b.cups && !data.reached[b.id]) {
        data.reached[b.id] = ymd(now);
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
    // 別のタブが書いた記録を読み直す。
    reload: load,
    // 申請を受け付けてもらった。アドレスは全体を残さず、確かめられるだけの形で覚える。
    markApplied(id, address, now = new Date()) {
      load();
      data.applied[id] = { address: `${address.slice(0, 6)}…${address.slice(-4)}`, at: ymd(now) };
      save();
    },
    // テスト用：杯数をそのまま決める（届いた記念も合わせる）。
    set(n) {
      data = blank();
      for (let i = 0; i < n; i++) add();
    },
  };
}
