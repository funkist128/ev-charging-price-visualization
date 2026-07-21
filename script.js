/* 車主端電價 — 依台電時間電價規則計算社區充電站目前費率
 * 社區收費 = 台電電價 + 1.02 + 0.5（各時段皆同，四筆範例已驗證）
 */

const RATES = {
  summer: {
    peak: { taipower: 5.01, community: 6.53 },
    offpeak: { taipower: 1.96, community: 3.48 },
  },
  nonSummer: {
    peak: { taipower: 4.78, community: 6.3 },
    offpeak: { taipower: 1.89, community: 3.41 },
  },
};

const OVER_2000_RATE = 1.02;

// Taiwan (Asia/Taipei) has no DST, fixed UTC+8 — shift the instant and read UTC fields.
function getTaipeiNow() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const seconds = shifted.getUTCSeconds();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    date: shifted.getUTCDate(),
    dow: shifted.getUTCDay(), // 0 = Sun ... 6 = Sat
    hours,
    minutes,
    seconds,
    minuteOfDay: hours * 60 + minutes + seconds / 60,
  };
}

function isSummerMonth(month) {
  return month >= 6 && month <= 9; // 6/1–9/30 covers these four full months
}

/** Ordered, non-overlapping segments covering 0–1440 minutes for one calendar day. */
function getDaySegments(summer, weekend) {
  const r = summer ? RATES.summer : RATES.nonSummer;
  if (weekend) {
    return [{ start: 0, end: 1440, type: 'offpeak', ...r.offpeak }];
  }
  if (summer) {
    return [
      { start: 0, end: 540, type: 'offpeak', ...r.offpeak }, // 00:00–09:00
      { start: 540, end: 1440, type: 'peak', ...r.peak }, // 09:00–24:00
    ];
  }
  return [
    { start: 0, end: 360, type: 'offpeak', ...r.offpeak }, // 00:00–06:00
    { start: 360, end: 660, type: 'peak', ...r.peak }, // 06:00–11:00
    { start: 660, end: 840, type: 'offpeak', ...r.offpeak }, // 11:00–14:00
    { start: 840, end: 1440, type: 'peak', ...r.peak }, // 14:00–24:00
  ];
}

function fmtHM(totalMin) {
  const h = Math.floor(totalMin / 60) % 24;
  const m = Math.round(totalMin % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m} 分`;
  if (m <= 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分`;
}

function bandLabel(seg, summer, weekend) {
  const season = summer ? '夏月' : '非夏月';
  if (weekend) return `週六・日離峰日・${season}`;
  const time = seg.type === 'peak' ? '尖峰時間' : '離峰時間';
  return `平日${time}・${season}`;
}

function timeRangeLabel(seg, weekend) {
  if (weekend) return '全日';
  return `${fmtHM(seg.start)}–${seg.end === 1440 ? '24:00' : fmtHM(seg.end)}`;
}

let state; // { seasonOverride: bool|null, dayOverride: 'weekday'|'weekend'|null }

function computeView() {
  const now = getTaipeiNow();
  const actualSummer = isSummerMonth(now.month);
  const actualWeekend = now.dow === 0 || now.dow === 6;

  const summer = state.seasonOverride === null ? actualSummer : state.seasonOverride;
  const weekend = state.dayOverride === null ? actualWeekend : state.dayOverride === 'weekend';
  const isLive = summer === actualSummer && weekend === actualWeekend;

  const segments = getDaySegments(summer, weekend);
  const current =
    segments.find((s) => now.minuteOfDay >= s.start && now.minuteOfDay < s.end) ||
    segments[segments.length - 1];

  return { now, actualSummer, actualWeekend, summer, weekend, isLive, segments, current };
}

function render() {
  const v = computeView();
  renderHero(v);
  renderToggles(v);
  renderStrip(v);
  renderTable(v);
  renderMeta(v);
}

function renderMeta({ now }) {
  const el = document.getElementById('clock');
  el.textContent = `現在時間 ${String(now.hours).padStart(2, '0')}:${String(now.minutes).padStart(2, '0')}（台灣時間）`;
}

function renderHero(v) {
  const { current, summer, weekend, isLive, now } = v;
  const price = document.getElementById('heroPrice');
  const badges = document.getElementById('heroBadges');
  const bandLabelEl = document.getElementById('heroBandLabel');
  const bandTimeEl = document.getElementById('heroBandTime');
  const breakdownEl = document.getElementById('heroBreakdown');
  const countdownEl = document.getElementById('heroCountdown');

  price.textContent = current.community.toFixed(2);
  price.style.color = current.type === 'peak' ? 'var(--peak)' : 'var(--offpeak)';

  badges.innerHTML = '';
  badges.appendChild(makeBadge(weekend ? '週六・日' : '平日', ''));
  badges.appendChild(makeBadge(summer ? '夏月 6/1–9/30' : '非夏月', ''));
  badges.appendChild(makeBadge(current.type === 'peak' ? '尖峰' : '離峰', current.type));
  if (!isLive) badges.appendChild(makeBadge('預覽模式', ''));

  bandLabelEl.textContent = bandLabel(current, summer, weekend);
  bandTimeEl.textContent = timeRangeLabel(current, weekend);

  breakdownEl.textContent = `台電電價 ${current.taipower.toFixed(2)} + 1.02 + 0.5 = ${current.community.toFixed(2)} 元/度`;

  if (!isLive) {
    countdownEl.innerHTML = `此為預覽時段，非目前實際費率。`;
  } else if (current.end >= 1440) {
    countdownEl.innerHTML = `下一時段切換於 <strong>00:00</strong>（次日，${fmtDuration(1440 - now.minuteOfDay)}後）`;
  } else {
    countdownEl.innerHTML = `下一時段切換於 <strong>${fmtHM(current.end)}</strong>（${fmtDuration(current.end - now.minuteOfDay)}後）`;
  }
}

function makeBadge(text, type) {
  const span = document.createElement('span');
  span.className = 'badge' + (type ? ` badge--${type}` : '');
  span.textContent = text;
  return span;
}

function renderToggles(v) {
  const dayGroup = document.getElementById('dayToggle');
  const seasonGroup = document.getElementById('seasonToggle');
  const preview = document.getElementById('previewFlag');

  [...dayGroup.children].forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.value === (v.weekend ? 'weekend' : 'weekday')));
  });
  [...seasonGroup.children].forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.value === (v.summer ? 'summer' : 'nonSummer')));
  });

  preview.hidden = v.isLive;
}

function renderStrip(v) {
  const strip = document.getElementById('strip');
  const ticks = document.getElementById('stripTicks');
  strip.innerHTML = '';
  ticks.innerHTML = '';

  v.segments.forEach((seg) => {
    const div = document.createElement('div');
    div.className = `strip__segment strip__segment--${seg.type}`;
    div.style.flex = `${seg.end - seg.start} 0 0`;
    div.title = `${timeRangeLabel(seg, v.weekend)} · ${seg.community.toFixed(2)} 元/度`;

    if (v.isLive && v.now.minuteOfDay >= seg.start && v.now.minuteOfDay < seg.end) {
      const marker = document.createElement('div');
      marker.className = 'strip__now';
      const pct = ((v.now.minuteOfDay - seg.start) / (seg.end - seg.start)) * 100;
      marker.style.left = `${pct}%`;
      div.appendChild(marker);
    }
    strip.appendChild(div);
  });

  const bounds = [0, ...v.segments.map((s) => s.end)];
  bounds.forEach((b) => {
    const s = document.createElement('span');
    s.textContent = b === 1440 ? '24' : String(Math.floor(b / 60)).padStart(2, '0');
    ticks.appendChild(s);
  });
}

function renderTable(v) {
  const tbody = document.getElementById('ratesBody');
  tbody.innerHTML = '';

  const rows = [
    { label: '尖峰時間・夏月 6/1–9/30', time: '09:00–24:00', ...RATES.summer.peak, type: 'peak', dayType: 'weekday' },
    { label: '尖峰時間・非夏月', time: '06:00–11:00、14:00–24:00', ...RATES.nonSummer.peak, type: 'peak', dayType: 'weekday' },
    { label: '離峰時間・夏月 6/1–9/30', time: '00:00–09:00', ...RATES.summer.offpeak, type: 'offpeak', dayType: 'weekday' },
    { label: '離峰時間・非夏月', time: '00:00–06:00、11:00–14:00', ...RATES.nonSummer.offpeak, type: 'offpeak', dayType: 'weekday' },
    { label: '週六・日離峰日・夏月', time: '全日', ...RATES.summer.offpeak, type: 'offpeak', dayType: 'weekend' },
    { label: '週六・日離峰日・非夏月', time: '全日', ...RATES.nonSummer.offpeak, type: 'offpeak', dayType: 'weekend' },
  ];

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.type = row.type;
    const isCurrent =
      v.isLive &&
      row.dayType === (v.weekend ? 'weekend' : 'weekday') &&
      row.type === v.current.type &&
      ((v.summer && row.label.includes('夏月') && !row.label.includes('非夏月')) ||
        (!v.summer && row.label.includes('非夏月')));
    if (isCurrent) tr.classList.add('current-row');

    tr.innerHTML = `
      <td><div>${row.label}</div><div class="time-sub">${row.time}</div></td>
      <td class="num">${row.taipower.toFixed(2)}</td>
      <td class="num community">${row.community.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setupToggles() {
  document.getElementById('dayToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const v = computeView();
    const wantWeekend = btn.dataset.value === 'weekend';
    state.dayOverride = wantWeekend === v.actualWeekend ? null : btn.dataset.value;
    render();
  });
  document.getElementById('seasonToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const v = computeView();
    const wantSummer = btn.dataset.value === 'summer';
    state.seasonOverride = wantSummer === v.actualSummer ? null : wantSummer;
    render();
  });
}

function init() {
  state = { seasonOverride: null, dayOverride: null };
  setupToggles();
  render();
  setInterval(render, 15000);
}

document.addEventListener('DOMContentLoaded', init);
