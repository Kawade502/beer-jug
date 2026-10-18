// 杯数の記念の一覧と、記念の SBT（譲渡できない記念の NFT）の申請。
// 申請は XBill Web Remake と同じ Worker（xbill-ranking）が受け付け、発行は運営者が後日、手作業で行う。
// 作りと文言は XBill の申請欄（src/game.html の sbtRequestBox）に合わせている。
import { checksumOk } from './eip55.js';

const API = 'https://xbill-ranking.xbill-ranking.workers.dev/beer-sbt-request';
const PUBLIC_HOST = 'kawade502.github.io';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const TEXT = {
  summary: '🎖 記念の SBT を希望する（任意）',
  notes: [
    'SBT は、譲渡できない記念の NFT です。金銭的な価値はありません。',
    '発行すると、アドレス・記念の種類・発行した日・通し番号がブロックチェーン（Polygon）上に公開されます。受け取った SBT は自分で消せますが、発行した記録はチェーン上に残ります。',
    '発行は運営者の判断で後日行います。発行を保証するものではありません。',
    'Ethereum や Polygon で使う、自分のウォレットのアドレス（MetaMask などの、0x で始まる42文字）を入力してください。同じアドレスで Polygon 上の SBT を受け取れます（取引所の入金用アドレスは使えません）。',
    '申請すると、アドレス・記念の種類・杯数がサーバーに送られ、運営者が確認します。杯数はこの端末に記録した自己申告です。いたずら防止のため、通信元の情報を元に戻せない形で2日間だけ記録します。',
  ],
  placeholder: '0x で始まるアドレス',
  consent: '上の注意書きに同意します',
  submit: '申請する',
  sending: '送信しています…',
  done: '受け付けました。発行は後日、運営者が行います。',
  invalid: 'アドレスの形式が正しくありません（0x で始まる42文字）。',
  checksum: 'アドレスに打ち間違いがあるようです（大文字・小文字の並びが合いません）。ウォレットからコピーし直してください。',
  notEvm: 'このアドレスは長すぎます。Aptos や Sui など、別の種類のチェーンのアドレスのようです。Ethereum や Polygon で使うアドレス（MetaMask などの、0x で始まる42文字）を入力してください。',
  duplicate: 'このアドレスは、この記念を申請済みです。',
  limit: '本日の受付数の上限に達しました。明日もう一度お試しください。',
  closed: '現在、申請は受け付けていません。',
  error: '送信できませんでした。通信状況を確認して、もう一度お試しください。',
  publicOnly: `申請は公開ページ（https://${PUBLIC_HOST}/beer-jug/）でだけできます。`,
};

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.filter((c) => c != null));
  return n;
}

// panel: 一覧の箱（#panel）。cups: createCups() の戻り値。
export function createBadges({ panel, list, count, closeButton, opener, cups }) {
  let lastFocus = null;

  function isOpen() {
    return !panel.hidden;
  }

  function open() {
    lastFocus = document.activeElement;
    render();
    panel.hidden = false;
    closeButton.focus();
  }

  function close() {
    panel.hidden = true;
    (lastFocus && document.body.contains(lastFocus) && !lastFocus.hidden ? lastFocus : opener).focus?.();
  }

  // 一覧を作り直す。入力の途中なら消さないよう、杯数が変わったときは文字が入っていない場合だけ作り直す。
  function render() {
    count.textContent = String(cups.count);
    list.replaceChildren(...cups.BADGES.map(item));
  }
  function refresh() {
    if (!isOpen()) return;
    if ([...list.querySelectorAll('input[type=text]')].some((i) => i.value)) {
      count.textContent = String(cups.count);
      return;
    }
    render();
  }

  function item(b) {
    const reached = cups.reached(b.id);
    const applied = cups.applied(b.id);
    const state = applied ? 'applied' : reached ? 'reached' : 'locked';
    let status;
    if (applied) status = `申請済み（${applied.address}、${applied.at}）`;
    else if (reached) status = `${reached} に達成`;
    else status = `あと ${b.cups - cups.count} 杯`;
    const body = el(
      'div',
      { class: 'badge-body' },
      el('p', { class: 'badge-name' }, `「${b.name}」`, el('span', { class: 'badge-need' }, `${b.cups}杯`)),
      el('p', { class: 'badge-status' }, status),
    );
    if (state === 'locked') {
      const bar = el('span');
      bar.style.width = `${Math.round((100 * cups.count) / b.cups)}%`;
      body.append(el('div', { class: 'bar', 'aria-hidden': 'true' }, bar));
    }
    // 申請欄は、絵の下まで幅いっぱいに使う。
    return el(
      'li',
      { class: 'badge', 'data-state': state, 'data-color': b.color },
      el('img', { src: `./sbt/${b.id}-160.png`, alt: '', width: 64, height: 64 }),
      body,
      state === 'reached' ? requestBox(b) : null,
    );
  }

  // 申請欄。XBill の sbtRequestBox と同じ流れ：アドレスを確かめ、同意してから送る。
  function requestBox(b) {
    const id = `sbt-${b.id}`;
    const input = el('input', {
      type: 'text',
      id: `${id}-address`,
      class: 'sbt-address',
      placeholder: TEXT.placeholder,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: 80,
      'aria-label': TEXT.placeholder,
    });
    const consent = el('input', { type: 'checkbox', id: `${id}-consent` });
    const submit = el('button', { type: 'button', class: 'sbt-submit', disabled: true }, TEXT.submit);
    const msg = el('p', { class: 'sbt-msg', role: 'status', 'aria-live': 'polite' });
    const form = el(
      'div',
      { class: 'sbt-form' },
      el('ul', { class: 'sbt-notes' }, ...TEXT.notes.map((t) => el('li', {}, t))),
      el('div', { class: 'sbt-row' }, input),
      el('label', { class: 'sbt-consent', for: consent.id }, consent, ' ', TEXT.consent),
      submit,
      msg,
    );
    const box = el('details', { class: 'sbt-box' }, el('summary', {}, TEXT.summary), form);

    const valid = (v) => ADDRESS_RE.test(v) && !/^0x0{40}$/i.test(v) && checksumOk(v);
    function check() {
      const v = input.value.trim();
      let text = '';
      if (/^0x[0-9a-fA-F]{41,}$/.test(v)) text = TEXT.notEvm; // Aptos・Sui などの長いアドレス
      else if (v.length >= 42 && (!ADDRESS_RE.test(v) || /^0x0{40}$/i.test(v))) text = TEXT.invalid;
      else if (ADDRESS_RE.test(v) && !checksumOk(v)) text = TEXT.checksum; // 大文字小文字の並びが合わない = 打ち間違い
      msg.textContent = text;
      submit.disabled = !(valid(v) && consent.checked);
    }
    input.addEventListener('input', check);
    consent.addEventListener('change', check);

    submit.addEventListener('click', async () => {
      const address = input.value.trim();
      if (!valid(address) || !consent.checked) return;
      if (location.hostname !== PUBLIC_HOST) {
        msg.textContent = TEXT.publicOnly;
        return;
      }
      submit.disabled = true;
      input.disabled = true;
      consent.disabled = true;
      msg.textContent = TEXT.sending;
      let status = 0;
      try {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, badge: b.id, cups: cups.count, consent: true }),
        });
        status = res.status;
      } catch {
        status = 0;
      }
      if (status === 201 || status === 409) {
        // 409 はサーバーにもう申請があるということ。この端末でも申請済みにしておく。
        cups.markApplied(b.id, address);
        msg.textContent = status === 201 ? TEXT.done : TEXT.duplicate;
        form.querySelectorAll('.sbt-row, .sbt-consent, .sbt-submit').forEach((n) => (n.hidden = true));
        const li = box.closest('.badge');
        const applied = cups.applied(b.id);
        if (li) {
          li.dataset.state = 'applied';
          li.querySelector('.badge-status').textContent = `申請済み（${applied.address}、${applied.at}）`;
        }
        return;
      }
      msg.textContent = { 400: TEXT.invalid, 429: TEXT.limit, 503: TEXT.closed }[status] || TEXT.error;
      // 打ち直せば通るもの（形式・通信）は、もう一度送れるようにする。
      input.disabled = false;
      consent.disabled = false;
      submit.disabled = !(valid(input.value.trim()) && consent.checked);
    });
    return box;
  }

  closeButton.addEventListener('click', close);
  // 外側の暗いところを押したら閉じる。アドレスを選ぶドラッグが外で終わったときは閉じない（押し始めも外のときだけ）。
  let downOnBackdrop = false;
  panel.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === panel;
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel && downOnBackdrop) close();
    downOnBackdrop = false;
  });
  // 申請のあとはボタンが隠れて、選択が箱の外へ出ることがあるので、Esc はページ全体で受ける。
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  return { open, close, isOpen, refresh };
}
