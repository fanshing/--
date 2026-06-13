const socket = io();
let myName = '';
let myRole = 'player';
let isSpectator = false;
let myAvatar = null; // 玩家头像 (base64)
const btnCreateMatch = document.getElementById('create-match');
const btnJoinPlayer = document.getElementById('join-player');
const btnJoinSpectator = document.getElementById('join-spectator');
const inputName = document.getElementById('name');
const matchSelect = document.getElementById('match-select');
const playersDiv = document.getElementById('players');
const operatorDiv = document.getElementById('operator');
const operatorNameEl = document.getElementById('operator-name');
const operatorStarsEl = document.getElementById('operator-stars');
const operatorBranchEl = document.getElementById('operator-branch');
const claimBtn = document.getElementById('claim');
const btnCall = document.getElementById('btn-call');
const btnPeek = document.getElementById('btn-peek');
const btnRest = document.getElementById('btn-rest');
const btnEnd = document.getElementById('btn-end');
const btnContinue = document.getElementById('btn-continue');
const btnCallIncr = document.getElementById('btn-call-incr');
const btnCallDecr = document.getElementById('btn-call-decr');
const callAmountInput = document.getElementById('call-amount');
const statusDiv = document.getElementById('status');
const easterInfoEl = document.getElementById('easter-info');

// surface unexpected frontend errors to the user (otherwise it looks like buttons do nothing)
window.addEventListener('error', (e) => {
  try {
    const msg = (e && e.message) ? String(e.message) : '未知错误';
    if (statusDiv) statusDiv.textContent = `前端脚本异常：${msg}（建议 Ctrl+F5 强刷）`;
  } catch (_) {
    // ignore
  }
});

const lobbySection = document.getElementById('lobby');
const gameSection = document.getElementById('game');
const leftPlayerNameEl = document.getElementById('left-player-name');
const rightPlayerNameEl = document.getElementById('right-player-name');
const leftOperatorsEl = document.getElementById('left-operators');
const rightOperatorsEl = document.getElementById('right-operators');
const leftRosterTabsEl = document.getElementById('left-roster-tabs');
const rightRosterTabsEl = document.getElementById('right-roster-tabs');
const operatorIconEl = document.getElementById('operator-icon');

// 图标/脚本的简单版本号：用于 cache busting（本地开发常见）
const ASSET_VERSION = '20260114';

// 由服务端 /api/icons/status 提供的可用图标状态（避免 404 风暴）
let classIconAvailability = null; // Map<class, { ext: 'svg'|'png'|'webp' }>

// 由服务端 /api/icons/operators/status 提供的可用干员图标状态（避免 404 风暴）
let operatorIconAvailability = null; // Map<cleanName, { name, ext }>

async function loadClassIconAvailability() {
  try {
    const res = await fetch('/api/icons/status', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (!json || json.ok !== true || !Array.isArray(json.classes)) return;
    const map = new Map();
    for (const it of json.classes) {
      if (!it || !it.cls) continue;
      const cls = String(it.cls).trim();
      // prefer svg > png > webp
      let ext = '';
      if (it.hasSvg) ext = 'svg';
      else if (it.hasPng) ext = 'png';
      else if (it.hasWebp) ext = 'webp';
      if (ext) map.set(cls, { ext });
    }
    classIconAvailability = map;
  } catch (_) {
    // ignore
  }
}

// fire-and-forget
loadClassIconAvailability();

async function loadOperatorIconAvailability() {
  try {
    const res = await fetch('/api/icons/operators/status', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (!json || json.ok !== true || !Array.isArray(json.items)) return;
    const map = new Map();
    for (const it of json.items) {
      if (!it || !it.name || !it.ext) continue;
      map.set(cleanKey(it.name), { name: String(it.name), ext: String(it.ext).toLowerCase() });
    }
    operatorIconAvailability = map;
  } catch (_) {
    // ignore
  }
}

// fire-and-forget
loadOperatorIconAvailability();

let leftCaptured = []; // array of { text, paid }
let rightCaptured = [];

// ROSTER 侧边栏筛选（用于替代旧的下拉框筛选）
let leftRosterClassFilter = '';
let rightRosterClassFilter = '';
const ROSTER_CLASS_ORDER = ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];

// 已抓取干员：支持“置顶”（可多个）。按 key 置顶，渲染时置顶项排在前。
const pinnedCapturedLeft = new Set();
const pinnedCapturedRight = new Set();

let revealAllCaptured = false;
let lastPlayersList = null;

// bottom list uses this state; declare early to avoid TDZ errors in handlers
let removedAllList = []; // 来自服务端的移出历史（名字数组）

// 大厅：对局列表缓存，用于渲染“当前选择对局”的人数/状态
let lastMatchesList = [];

function normalizeOperatorClass(cls) {
  return String(cls || '').trim();
}

function getClassIconSvg(cls) {
  // 轻量自绘 SVG（非任何游戏原图），使用 currentColor 以便 CSS 控制颜色。
  const c = normalizeOperatorClass(cls);
  // default: question mark in a circle
  const unknown = `
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="未知职业">
      <circle cx="32" cy="32" r="26" />
      <path d="M24 24c0-5 4-9 9-9s9 4 9 9c0 7-9 8-9 16" />
      <path d="M33 46h0" />
    </svg>`;

  switch (c) {
    case '先锋':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="先锋">
          <path d="M18 54V10" />
          <path d="M18 12h24l-6 8 6 8H18" />
          <path d="M18 54h28" />
        </svg>`;
    case '近卫':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="近卫">
          <path d="M44 12L22 34" />
          <path d="M50 18l-6-6" />
          <path d="M22 34l-6 18 18-6" />
          <path d="M30 42l-8-8" />
        </svg>`;
    case '重装':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="重装">
          <path d="M32 10l18 8v16c0 12-8 20-18 22C22 54 14 46 14 34V18l18-8z" />
          <path d="M24 30h16" />
          <path d="M32 22v24" />
        </svg>`;
    case '狙击':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="狙击">
          <circle cx="32" cy="32" r="16" />
          <path d="M32 10v12" />
          <path d="M32 42v12" />
          <path d="M10 32h12" />
          <path d="M42 32h12" />
          <path d="M18 46l28-28" />
          <path d="M46 20l2-8-8 2" />
        </svg>`;
    case '术师':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="术师">
          <path d="M24 52V14" />
          <path d="M24 14h16" />
          <path d="M40 14v10" />
          <path d="M40 24c0 7-4 12-8 14-4-2-8-7-8-14" />
          <path d="M44 44l4 4" />
          <path d="M44 52l8-8" />
        </svg>`;
    case '医疗':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="医疗">
          <path d="M28 12h8" />
          <path d="M32 12v40" />
          <path d="M12 28h40" />
          <path d="M12 36h40" />
        </svg>`;
    case '辅助':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="辅助">
          <path d="M32 10l6 14 14 6-14 6-6 14-6-14-14-6 14-6z" />
          <path d="M48 44l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
        </svg>`;
    case '特种':
      return `
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="特种">
          <path d="M22 20c0 10 20 10 20 0" />
          <path d="M42 20c0-6-4-10-10-10S22 14 22 20" />
          <path d="M20 44c8 0 10-6 12-12" />
          <path d="M44 44c-8 0-10-6-12-12" />
          <path d="M16 52h32" />
        </svg>`;
    default:
      return unknown;
  }
}

function getClassIconUrl(cls, ext) {
  const c = normalizeOperatorClass(cls);
  if (!c) return '';
  const safe = encodeURIComponent(c);
  const e = String(ext || 'svg').toLowerCase();
  return `/icons/classes/${safe}.${e}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

function getOperatorIconUrl(name, ext) {
  const n = String(name || '').trim();
  if (!n) return '';
  // Prefer human-readable filenames on disk (e.g. "绮良.png").
  // Request the raw filename (allow browser to percent-encode as needed); some servers
  // serve Unicode filenames better when requested without pre-encoding.
  const base = n;
  const e = String(ext || 'png').toLowerCase();
  return `/icons/operators/${base}.${e}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

function getOperatorIconUrlLegacyEncodedOnDisk(name, ext) {
  const n = String(name || '').trim();
  if (!n) return '';
  // Legacy: file on disk is encodeURIComponent(name) (e.g. "%E7%BB%AE%E8%89%AF.png"), so request must double-encode.
  const base = encodeURIComponent(encodeURIComponent(n));
  const e = String(ext || 'png').toLowerCase();
  return `/icons/operators/${base}.${e}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

function renderOperatorAvatarInto(avatarEl, operatorName, fallbackClass) {
  if (!avatarEl) return;
  const name = String(operatorName || '').trim();
  const cls = normalizeOperatorClass(fallbackClass);

  // Prevent flicker: if we already rendered the same target, don't clear/reload.
  // Key is stable across re-renders caused by unrelated UI updates.
  const renderKey = `opAv:${cleanKey(name)}|cls:${cls}`;
  if (avatarEl.dataset && avatarEl.dataset.renderKey === renderKey) return;
  try { avatarEl.dataset.renderKey = renderKey; } catch (_) {}

  // reset style
  try { avatarEl.classList.remove('is-class-icon'); } catch (_) {}
  avatarEl.innerHTML = '';

  // no name => always class icon
  if (!name) {
    if (cls) {
      try { avatarEl.classList.add('is-class-icon'); } catch (_) {}
      renderClassIconInto(avatarEl, cls);
    }
    return;
  }

  const key = cleanKey(name);
  const info = operatorIconAvailability && operatorIconAvailability instanceof Map
    ? (operatorIconAvailability.get(key) || null)
    : null;

  // Try best-guess order. If status map exists, honor its ext first.
  const tried = new Set();
  const tryOrder = [];
  if (info && info.ext) tryOrder.push(String(info.ext).toLowerCase());
  ['png', 'webp', 'svg'].forEach(e => tryOrder.push(e));

  const img = document.createElement('img');
  img.alt = name;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.style.filter = 'none';

  function fallbackToClass() {
    try {
      avatarEl.innerHTML = '';
      if (cls) {
        avatarEl.classList.add('is-class-icon');
        renderClassIconInto(avatarEl, cls);
      }
    } catch (_) {
      // ignore
    }
  }

  function loadNext() {
    // For each ext, try new naming first, then legacy naming.
    for (const ext of tryOrder) {
      const k1 = `new:${ext}`;
      if (!tried.has(k1)) {
        tried.add(k1);
        img.src = getOperatorIconUrl(name, ext);
        return;
      }
      const k2 = `old:${ext}`;
      if (!tried.has(k2)) {
        tried.add(k2);
        img.src = getOperatorIconUrlLegacyEncodedOnDisk(name, ext);
        return;
      }
    }
    return fallbackToClass();
  }

  img.onerror = () => loadNext();
  avatarEl.appendChild(img);
  loadNext();
}

function renderOperatorIconInto(containerEl, operatorName, fallbackClass) {
  if (!containerEl) return;
  const name = String(operatorName || '').trim();
  const cls = normalizeOperatorClass(fallbackClass);

  // Prevent flicker: if icon target didn't change, keep DOM.
  // Note: ext may change once when operatorIconAvailability loads; include ext when known.
  const baseKey = `opIcon:${cleanKey(name)}|cls:${cls}`;

  // When we don't know the name, always fallback to class icon.
  if (!name) {
    if (containerEl.dataset && containerEl.dataset.renderKey === `${baseKey}|mode:class`) return;
    try { containerEl.dataset.renderKey = `${baseKey}|mode:class`; } catch (_) {}
    containerEl.innerHTML = '';
    if (cls) renderClassIconInto(containerEl, cls);
    return;
  }

  const key = cleanKey(name);
  const info = operatorIconAvailability && operatorIconAvailability instanceof Map
    ? (operatorIconAvailability.get(key) || null)
    : null;

  if (!info || !info.ext) {
    if (containerEl.dataset && containerEl.dataset.renderKey === `${baseKey}|mode:class`) return;
    try { containerEl.dataset.renderKey = `${baseKey}|mode:class`; } catch (_) {}
    containerEl.innerHTML = '';
    if (cls) renderClassIconInto(containerEl, cls);
    return;
  }

  const renderKey = `${baseKey}|mode:op|ext:${String(info.ext)}`;
  if (containerEl.dataset && containerEl.dataset.renderKey === renderKey) return;
  try { containerEl.dataset.renderKey = renderKey; } catch (_) {}

  containerEl.innerHTML = '';
  const img = document.createElement('img');
  img.alt = name;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  // operator portraits/icons should not be inverted
  img.style.filter = 'none';
  img.src = getOperatorIconUrl(name, info.ext);
  img.onerror = () => {
    try {
      containerEl.innerHTML = '';
      if (cls) renderClassIconInto(containerEl, cls);
    } catch (_) {
      // ignore
    }
  };
  containerEl.appendChild(img);
}

function renderClassIconInto(containerEl, cls, options) {
  if (!containerEl) return;
  const c = normalizeOperatorClass(cls);
  const preferExternal = !(options && options.preferExternal === false);
  const extHint = (classIconAvailability && classIconAvailability instanceof Map && c)
    ? ((classIconAvailability.get(c) || {}).ext || '')
    : '';
  const renderKey = `classIcon:${c}|ext:${extHint}|preferExternal:${preferExternal ? '1' : '0'}`;
  if (containerEl.dataset && containerEl.dataset.renderKey === renderKey) return;
  try { containerEl.dataset.renderKey = renderKey; } catch (_) {}

  containerEl.innerHTML = '';
  if (!c) return;
  if (!preferExternal) {
    containerEl.innerHTML = getClassIconSvg(c);
    return;
  }

  // If server reports availability, load exactly one ext to avoid 404 spam.
  if (classIconAvailability && classIconAvailability instanceof Map) {
    const info = classIconAvailability.get(c) || null;
    if (!info || !info.ext) {
      containerEl.innerHTML = getClassIconSvg(c);
      return;
    }
    const img = document.createElement('img');
    img.alt = c;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = getClassIconUrl(c, info.ext);
    img.onerror = () => {
      // if server says exists but still fails (race/cached old status), fallback gracefully
      try {
        containerEl.innerHTML = getClassIconSvg(c);
      } catch (_) {
        // ignore
      }
    };
    containerEl.appendChild(img);
    return;
  }

  // Fallback: probe svg/png/webp (older server without /api/icons/status)
  const img = document.createElement('img');
  img.alt = c;
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.src = getClassIconUrl(c, 'svg');
  img.onerror = () => {
    if (!img.dataset.triedPng) {
      img.dataset.triedPng = '1';
      img.src = getClassIconUrl(c, 'png');
      return;
    }
    if (!img.dataset.triedWebp) {
      img.dataset.triedWebp = '1';
      img.src = getClassIconUrl(c, 'webp');
      return;
    }
    try {
      containerEl.innerHTML = getClassIconSvg(c);
    } catch (_) {
      // ignore
    }
  };
  containerEl.appendChild(img);
}

function updateRosterCost(costEl, paid) {
  if (!costEl) return;
  // Keep it minimal; avoid reconstructing when unchanged.
  const hasPaid = paid !== null && typeof paid !== 'undefined' && typeof paid !== 'object';
  const newText = hasPaid ? `${paid}cp` : '';
  if (costEl.dataset && costEl.dataset.costText === newText) return;
  try { if (costEl.dataset) costEl.dataset.costText = newText; } catch (_) {}
  costEl.innerHTML = '';
  if (!hasPaid) return;
  const num = document.createElement('span');
  num.textContent = String(paid);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'cp';
  costEl.appendChild(num);
  costEl.appendChild(unit);
}

function upsertRosterRow(side, containerEl, item, pinnedSet, baseIndexMap, opts) {
  if (!containerEl || !item || !item.key) return null;
  const key = String(item.key);
  const canReveal = !!(opts && opts.canReveal);

  let row = null;
  // Find existing row by dataset key
  const children = containerEl.children || [];
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el && el.dataset && el.dataset.key === key) { row = el; break; }
  }

  const baseIndex = baseIndexMap && baseIndexMap.has(key) ? (baseIndexMap.get(key) ?? 0) : 0;
  const isPinned = !!(pinnedSet && pinnedSet.has(key));

  if (!row) {
    row = document.createElement('div');
    row.className = 'roster-item' + (isPinned ? ' pinned' : '');
    row.dataset.key = key;
    row.dataset.baseIndex = String(baseIndex);
    row.style.cursor = 'pointer';
    row.onclick = () => {
      togglePinned(side, key);
      applyPinnedClassToRow(row, pinnedSet && pinnedSet.has(key));
      reorderRosterDomByPinned(containerEl, pinnedSet);
    };

    const avatar = document.createElement('div');
    avatar.className = 'roster-avatar';

    const meta = document.createElement('div');
    meta.className = 'roster-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'roster-name';
    const subEl = document.createElement('div');
    subEl.className = 'roster-sub';
    meta.appendChild(nameEl);
    meta.appendChild(subEl);

    const starsEl = document.createElement('div');
    starsEl.className = 'roster-stars';

    const costEl = document.createElement('div');
    costEl.className = 'roster-cost';

    row.appendChild(avatar);
    row.appendChild(meta);
    row.appendChild(starsEl);
    row.appendChild(costEl);
  } else {
    // keep baseIndex in sync so reorder stays stable
    if (row.dataset.baseIndex !== String(baseIndex)) row.dataset.baseIndex = String(baseIndex);
    applyPinnedClassToRow(row, isPinned);
  }

  const op = item.operator;
  const isObj = !!(op && typeof op === 'object');
  const profession = isObj ? (op.class || op.Class || '') : '';
  const stars = isObj && Number.isFinite(Number(op.stars)) ? Number(op.stars) : null;

  const avatarEl = row.querySelector('.roster-avatar');
  const nameEl = row.querySelector('.roster-name');
  const subEl = row.querySelector('.roster-sub');
  const starsEl = row.querySelector('.roster-stars');
  const costEl = row.querySelector('.roster-cost');

  if (side === 'left') {
    const showName = isObj && op.name ? String(op.name) : (item.text ? String(item.text) : '');
    // 左侧始终显示真实名字（自己）
    const nameText = showName && showName !== '？？？' ? showName.replace(/\s*★+\s*$/, '') : '？？？';
    if (nameEl && nameEl.textContent !== nameText) nameEl.textContent = nameText;
    const subText = profession ? String(profession) : '';
    if (subEl && subEl.textContent !== subText) subEl.textContent = subText;
    const starsText = stars ? '★'.repeat(stars) : '';
    if (starsEl && starsEl.textContent !== starsText) starsEl.textContent = starsText;

    if (avatarEl) {
      if (isObj && op.name) {
        renderOperatorAvatarInto(avatarEl, op.name, profession);
      } else if (profession) {
        avatarEl.classList.add('is-class-icon');
        renderClassIconInto(avatarEl, profession);
      } else {
        // unknown
        if (avatarEl.innerHTML) avatarEl.innerHTML = '';
      }
    }
  } else {
    const nameText = (canReveal && isObj && op.name) ? String(op.name) : '？？？';
    if (nameEl && nameEl.textContent !== nameText) nameEl.textContent = nameText;
    const subText = profession ? String(profession) : '';
    if (subEl && subEl.textContent !== subText) subEl.textContent = subText;
    const starsText = (canReveal && stars) ? '★'.repeat(stars) : '';
    if (starsEl && starsEl.textContent !== starsText) starsEl.textContent = starsText;

    if (avatarEl) {
      if (canReveal && isObj && op.name) {
        renderOperatorAvatarInto(avatarEl, op.name, profession);
      } else if (profession) {
        avatarEl.classList.add('is-class-icon');
        renderClassIconInto(avatarEl, profession);
      } else {
        if (avatarEl.innerHTML) avatarEl.innerHTML = '';
      }
    }
  }

  updateRosterCost(costEl, item.paid);
  return row;
}

function setCenterOperatorIconByClass(cls) {
  if (!operatorIconEl) return;
  const c = normalizeOperatorClass(cls);
  if (!c) {
    operatorIconEl.innerHTML = '';
    operatorIconEl.style.display = 'none';
    return;
  }
  operatorIconEl.style.display = '';
  renderClassIconInto(operatorIconEl, c);
}

function setCenterOperatorIconByOperator(op) {
  if (!operatorIconEl) return;
  if (!op || typeof op !== 'object') {
    setCenterOperatorIconByClass('');
    return;
  }
  const name = op.name || '';
  const cls = op.class || op.Class || '';
  operatorIconEl.style.display = '';
  renderOperatorIconInto(operatorIconEl, name, cls);
}

function getProfessionFromCapturedItem(item) {
  if (!item) return '';
  const op = item.operator;
  if (op && typeof op === 'object') return op.class || op.Class || '';
  return '';
}

function getStarsFromCapturedItem(item) {
  if (!item) return null;
  const op = item.operator;
  if (!op || typeof op !== 'object') return null;
  const s = Number(op.stars);
  return Number.isFinite(s) ? s : null;
}

function computeCapturedLists(list) {
  if (!Array.isArray(list)) return;

  let me = null;
  let opponent = null;
  if (myName) {
    me = list.find(p => p.name === myName) || null;
    opponent = list.find(p => p.name !== myName) || null;
  } else {
    me = list[0] || null;
    opponent = list[1] || null;
  }

  leftCaptured = (me && Array.isArray(me.captured)) ? me.captured.map((e, idx) => {
    if (e.operator && typeof e.operator === 'object' && e.operator.name) {
      return {
        key: String(e.operator.name),
        text: `${e.operator.name}${e.operator.stars ? ' ★'.repeat(e.operator.stars) : ''}`,
        paid: e.paid,
        operator: e.operator
      };
    } else if (e.operator && typeof e.operator === 'object' && (e.operator.class || e.operator.Class)) {
      const cls = e.operator.class || e.operator.Class || '';
      return {
        key: `unknown:${cls}:${String(e.paid ?? '')}:${idx}`,
        text: '？？？',
        paid: e.paid,
        operator: e.operator
      };
    } else {
      return { key: `unknown:${String(e.operator)}:${String(e.paid ?? '')}:${idx}`, text: String(e.operator), paid: e.paid, operator: e.operator };
    }
  }) : [];

  rightCaptured = (opponent && Array.isArray(opponent.captured)) ? opponent.captured.map((e, idx) => {
    if (revealAllCaptured && e.operator && typeof e.operator === 'object' && e.operator.name) {
      // 双方结束：揭示对手抓到的干员名字（可带星级）
      return {
        key: String(e.operator.name),
        text: `${e.operator.name}${e.operator.stars ? ' ★'.repeat(e.operator.stars) : ''}`,
        paid: e.paid,
        operator: e.operator
      };
    }

    // 平时：对手不显示名字和星级，只显示职业
    if (e.operator && typeof e.operator === 'object' && (e.operator.class || e.operator.Class)) {
      const cls = e.operator.class || e.operator.Class || '';
      return {
        key: `unknown:${cls}:${String(e.paid ?? '')}:${idx}`,
        text: '？？？',
        paid: e.paid,
        operator: e.operator
      };
    }
    return { key: `unknown:${String(e.operator)}:${String(e.paid ?? '')}:${idx}`, text: String(e.operator), paid: e.paid, operator: e.operator };
  }) : [];
}

function prunePinnedSets() {
  const leftKeys = new Set((leftCaptured || []).map(i => i && i.key).filter(Boolean));
  const rightKeys = new Set((rightCaptured || []).map(i => i && i.key).filter(Boolean));
  Array.from(pinnedCapturedLeft).forEach(k => { if (!leftKeys.has(k)) pinnedCapturedLeft.delete(k); });
  Array.from(pinnedCapturedRight).forEach(k => { if (!rightKeys.has(k)) pinnedCapturedRight.delete(k); });
}

function togglePinned(side, key) {
  if (!key) return;
  const set = side === 'right' ? pinnedCapturedRight : pinnedCapturedLeft;
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function applyPinnedClassToRow(rowEl, pinned) {
  if (!rowEl) return;
  if (pinned) rowEl.classList.add('pinned');
  else rowEl.classList.remove('pinned');
}

function reorderRosterDomByPinned(containerEl, pinnedSet) {
  if (!containerEl) return;
  const children = Array.from(containerEl.children || []);
  const rows = children
    .filter(el => el && el.dataset && el.dataset.key)
    .map((el, idx) => {
      const base = parseInt(el.dataset.baseIndex || '', 10);
      return {
        el,
        idx,
        base: Number.isFinite(base) ? base : idx,
        pinned: !!(pinnedSet && pinnedSet.has(el.dataset.key))
      };
    });
  rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.base - b.base || a.idx - b.idx);
  rows.forEach(r => containerEl.appendChild(r.el));
}

function sortByPinned(items, pinnedSet) {
  const pinned = [];
  const normal = [];
  (items || []).forEach(it => {
    const k = it && it.key;
    if (k && pinnedSet && pinnedSet.has(k)) pinned.push(it);
    else normal.push(it);
  });
  return pinned.concat(normal);
}

function buildRosterClassCounts(items) {
  const counts = new Map();
  (items || []).forEach(item => {
    const cls = normalizeOperatorClass(getProfessionFromCapturedItem(item));
    if (!cls) return;
    counts.set(cls, (counts.get(cls) || 0) + 1);
  });
  return counts;
}

function renderRosterTabs(side, tabsEl, items, activeClass) {
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  const counts = buildRosterClassCounts(items);
  const total = (items || []).length;
  const mk = (name, clsKey, cnt) => {
    const el = document.createElement('div');
    el.className = 'roster-tab' + ((activeClass || '') === (clsKey || '') ? ' active' : '');
    const left = document.createElement('span');
    left.textContent = name;
    const right = document.createElement('span');
    right.className = 'count';
    right.textContent = `(${cnt})`;
    el.appendChild(left);
    el.appendChild(right);
    el.onclick = () => {
      if (side === 'right') rightRosterClassFilter = clsKey || '';
      else leftRosterClassFilter = clsKey || '';
      renderCapturedLists();
    };
    return el;
  };

  tabsEl.appendChild(mk('全部', '', total));
  ROSTER_CLASS_ORDER.forEach(cls => {
    tabsEl.appendChild(mk(cls, cls, counts.get(cls) || 0));
  });
}

// 顶部固定池显示控制：第三个在对局中隐藏名字，双方结束时揭示名字
let revealFixedThirdName = false;
let lastPoolPayload = null;

// 彩蛋情报（仅服务端会推送给彩蛋玩家）
let easterOpponentOffer = null;
let easterOpponentPeeked = null;
let easterOpponentRested = false;

function renderEasterInfo() {
  if (!easterInfoEl) return;
  const parts = [];
  if (easterOpponentRested === true) {
    parts.push('对手选择休息');
  } else
  if (easterOpponentOffer !== null && typeof easterOpponentOffer !== 'undefined') {
    parts.push(`对手出价：${easterOpponentOffer}`);
  }
  // 情报点相关信息：仅在回合结束后揭示（或观战者可见）
  if (easterOpponentPeeked === true && (isSpectator || (lastGameState && lastGameState.allEnded))) {
    parts.push('对手已使用情报点');
  }
  easterInfoEl.textContent = parts.join('｜');
}

function resetEasterInfo() {
  easterOpponentOffer = null;
  easterOpponentPeeked = null;
  easterOpponentRested = false;
  renderEasterInfo();
}

let lastGameState = { restDisabled: false, endLockOwner: null, allEnded: false, continueNeeded: false };
let lastContinueClickAt = 0;

// 对手情报点：对局中可见，但消耗仅在回合结束时揭示。
// 实现：回合进行中固定显示快照；allEnded=true 时再显示真实值。
let opponentIntelSnapshot = null;
let opponentIntelSnapshotFor = '';

function getMeFromPlayersList(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (myName) return list.find(p => p.name === myName) || null;
  return list[0] || null;
}

function syncActionControls() {
  if (isSpectator) {
    if (btnCall) btnCall.disabled = true;
    if (btnPeek) btnPeek.disabled = true;
    if (btnRest) btnRest.disabled = true;
    if (btnEnd) btnEnd.disabled = true;
    if (claimBtn) claimBtn.disabled = true;
    if (btnContinue) btnContinue.disabled = true;
    const callAmountInputEl = document.getElementById('call-amount');
    const btnCallIncrEl = document.getElementById('btn-call-incr');
    const btnCallDecrEl = document.getElementById('btn-call-decr');
    if (callAmountInputEl) callAmountInputEl.disabled = true;
    if (btnCallIncrEl) btnCallIncrEl.disabled = true;
    if (btnCallDecrEl) btnCallDecrEl.disabled = true;
    return;
  }
  const me = getMeFromPlayersList(lastPlayersList);
  const isEndLike = !!(me && (me.ended || me.endPending || me.endQueued));

  if (btnEnd) btnEnd.disabled = !!(me && (me.ended || me.endPending || me.endQueued || me.disabled));

  if (btnRest) {
    const restBlocked = !!(lastGameState && lastGameState.restDisabled);
    btnRest.disabled = restBlocked || isEndLike || !!(me && me.restDisabled);
  }

  if (btnPeek) {
    const hasIntel = me && typeof me.intelPoints !== 'undefined' && me.intelPoints > 0;
    btnPeek.disabled = !hasIntel || isEndLike;
  }

  if (btnCall && isEndLike) btnCall.disabled = true;

  const callAmountInputEl = document.getElementById('call-amount');
  const btnCallIncrEl = document.getElementById('btn-call-incr');
  const btnCallDecrEl = document.getElementById('btn-call-decr');
  if (isEndLike) {
    if (callAmountInputEl) { callAmountInputEl.value = '0'; callAmountInputEl.disabled = true; }
    if (btnCallIncrEl) btnCallIncrEl.disabled = true;
    if (btnCallDecrEl) btnCallDecrEl.disabled = true;
  }
}

function renderPublicPool(payload) {
  const poolEl = document.getElementById('public-pool');
  if (!poolEl) return;
  const data = payload || {};

  function ensurePoolCard(idx) {
    const existing = poolEl.children && poolEl.children[idx] ? poolEl.children[idx] : null;
    if (existing && existing.classList && existing.classList.contains('small-card')) return existing;

    const div = document.createElement('div');
    div.className = 'small-card';
    const icon = document.createElement('div');
    icon.className = 'class-icon';
    icon.setAttribute('aria-hidden', 'true');
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    const starsEl = document.createElement('div');
    starsEl.className = 'stars';
    const subEl = document.createElement('div');
    subEl.className = 'sub';
    div.appendChild(icon);
    div.appendChild(nameEl);
    div.appendChild(starsEl);
    div.appendChild(subEl);
    return div;
  }

  const pool = Array.isArray(data.pool) ? data.pool : [];

  // shrink extra cards (if any)
  while ((poolEl.children ? poolEl.children.length : 0) > pool.length) {
    try { poolEl.lastElementChild && poolEl.lastElementChild.remove(); } catch (_) { break; }
  }

  pool.forEach((op, idx) => {
    const card = ensurePoolCard(idx);
    if (!card.parentNode) poolEl.appendChild(card);

    const isString = (typeof op === 'string');
    const name = isString ? op : (op && op.name ? op.name : '');
    const cls = isString ? '' : (op && op.class ? op.class : '');
    const stars = (!isString && op && op.stars) ? '★'.repeat(op.stars) : '';

    // 规则：前两个始终显示名字；第三个默认显示“未知+职业”，在双方结束时才揭示名字
    const mainLabel = (idx === 2 && !revealFixedThirdName)
      ? '？？？'
      : (name || (cls ? cls : ''));

    // 星级下方显示职业（避免与主标题重复）
    const subLabel = (cls && mainLabel !== cls) ? cls : '';

    const iconEl = card.querySelector('.class-icon');
    const nameEl = card.querySelector('.name');
    const starsEl = card.querySelector('.stars');
    const subEl = card.querySelector('.sub');

    if (nameEl && nameEl.textContent !== String(mainLabel)) nameEl.textContent = String(mainLabel);
    if (starsEl && starsEl.textContent !== String(stars)) starsEl.textContent = String(stars);
    if (subEl && subEl.textContent !== String(subLabel)) subEl.textContent = String(subLabel);

    if (iconEl) {
      if (mainLabel !== '？？？' && name) {
        renderOperatorIconInto(iconEl, name, cls);
      } else if (cls) {
        renderClassIconInto(iconEl, cls);
      } else {
        if (iconEl.innerHTML) iconEl.innerHTML = '';
      }
    }

    // keep order stable
    if (poolEl.children && poolEl.children[idx] !== card) {
      try {
        const ref = poolEl.children[idx] || null;
        poolEl.insertBefore(card, ref);
      } catch (_) {
        // ignore
      }
    }
  });
}

function getSelectedMatchId() {
  if (!matchSelect) return '房间1';
  const v = String(matchSelect.value || '').trim();
  return v || '房间1';
}

function renderSelectedMatchSummary() {
  if (!playersDiv) return;
  const matchId = getSelectedMatchId();
  const list = Array.isArray(lastMatchesList) ? lastMatchesList : [];
  const found = list.find(m => m && String(m.id) === String(matchId)) || null;
  if (!found) {
    playersDiv.innerHTML = `<b>对局：</b>${matchId}（未知）`;
    return;
  }
  const pcount = Number.isFinite(Number(found.players)) ? Number(found.players) : 0;
  const inProg = !!found.inProgress;
  playersDiv.innerHTML = `<b>对局：</b>${matchId}（${pcount}/2${inProg ? '，进行中' : ''}）`;
}

function setLobbyControlsEnabled(enabled) {
  if (btnCreateMatch) btnCreateMatch.disabled = !enabled;
  if (btnJoinPlayer) btnJoinPlayer.disabled = !enabled;
  if (btnJoinSpectator) btnJoinSpectator.disabled = !enabled;
  if (inputName) inputName.disabled = !enabled;
  if (matchSelect) matchSelect.disabled = !enabled;
}

function resetLocalForNewJoin() {
  // 新加入/新开局时，先清空本地显示的“已移出”列表，避免沿用上一局残留状态。
  removedAllList = [];
  renderRemovedList();
  pinnedCapturedLeft.clear();
  pinnedCapturedRight.clear();
  leftRosterClassFilter = '';
  rightRosterClassFilter = '';
}

function doJoin(role) {
  const matchId = getSelectedMatchId();
  myName = inputName.value.trim() || '玩家';
  resetLocalForNewJoin();
  socket.emit('join', { matchId, role, name: myName, avatar: myAvatar });
  setLobbyControlsEnabled(false);
  statusDiv.textContent = role === 'spectator' ? `已进入观战：${matchId}` : `已加入对局：${matchId}，等待其他玩家...`;
}

if (btnJoinPlayer) btnJoinPlayer.onclick = () => doJoin('player');
if (btnJoinSpectator) btnJoinSpectator.onclick = () => doJoin('spectator');

if (btnCreateMatch) {
  btnCreateMatch.onclick = () => {
    socket.emit('create-match');
  };
}

socket.on('matches', (payload) => {
  const list = payload && Array.isArray(payload.matches) ? payload.matches : [];
  lastMatchesList = list;
  if (!matchSelect) return;
  const prev = String(matchSelect.value || '');
  matchSelect.innerHTML = '';
  list.forEach(m => {
    const id = m && m.id ? String(m.id) : '';
    if (!id) return;
    const opt = document.createElement('option');
    const pcount = Number.isFinite(Number(m.players)) ? Number(m.players) : 0;
    const inProg = !!m.inProgress;
    opt.value = id;
    opt.textContent = `${id}（${pcount}/2${inProg ? '，进行中' : ''}）`;
    matchSelect.appendChild(opt);
  });
  // 保持原选择；否则选第一个；再否则回退 房间1
  const hasPrev = Array.from(matchSelect.options).some(o => o.value === prev);
  if (hasPrev) matchSelect.value = prev;
  else if (matchSelect.options.length > 0) matchSelect.selectedIndex = 0;
  else {
    const opt = document.createElement('option');
    opt.value = '房间1';
    opt.textContent = '房间1（0/2）';
    matchSelect.appendChild(opt);
    matchSelect.value = '房间1';
  }

  renderSelectedMatchSummary();
});

if (matchSelect) {
  matchSelect.addEventListener('change', () => {
    renderSelectedMatchSummary();
  });
}

socket.on('match-created', (payload) => {
  const id = payload && payload.id ? String(payload.id) : '';
  if (!id) return;
  if (matchSelect) matchSelect.value = id;
  statusDiv.textContent = `已创建对局：${id}`;
  renderSelectedMatchSummary();
});

socket.on('join-failed', (payload) => {
  const msg = payload && payload.msg ? String(payload.msg) : '加入失败';
  statusDiv.textContent = msg;
  setLobbyControlsEnabled(true);
});

socket.on('role', (data) => {
  const role = data && data.role ? String(data.role) : 'player';
  myRole = role;
  isSpectator = role === 'spectator';
  if (!isSpectator) {
    const serverName = data && data.name ? String(data.name) : '';
    if (serverName) myName = serverName;
  }
  if (isSpectator) {
    // 观战者不属于 players 列表：用“按顺序展示左右玩家”的方式渲染
    myName = '';
    // 观战者：始终揭示双方已抓干员 + 固定池第三个干员
    revealAllCaptured = true;
    revealFixedThirdName = true;
    statusDiv.textContent = '观战中（不参与对局）';
    showGame();
    if (lastPoolPayload) renderPublicPool(lastPoolPayload);
    if (lastPlayersList) { computeCapturedLists(lastPlayersList); renderCapturedLists(); }
    syncActionControls();
  }
});

function showGame() {
  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';
  // 主动请求公共池，保证固定干员显示
  if (typeof socket !== 'undefined') {
    socket.emit('request-pool');
  }
}

function showLobby() {
  lobbySection.style.display = 'block';
  gameSection.style.display = 'none';
}

function updatePlayerStatus() {
  const el = document.getElementById('action-status');
  if (!el) return;

  const me = getMeFromPlayersList(lastPlayersList);
  if (!me) {
    el.innerHTML = '';
    return;
  }

  // 优先级：已结束 > 已休息 > 已调用
  // 结束和休息时不显示已调用
  let status = null;
  
  if (me.ended || me.endPending || me.endQueued) {
    status = { text: '已结束', class: 'ended' };
  } else if (me.rested) {
    status = { text: '已休息', class: 'rested' };
  } else if (me.hasCalled) {
    status = { text: '已调用', class: 'called' };
  }

  if (status) {
    el.innerHTML = `<span class="status-tag ${status.class}">${status.text}</span>`;
  } else {
    el.innerHTML = '';
  }
}

function updatePlayerAvatar(elementId, avatarUrl) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  el.innerHTML = '';
  
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.onerror = function() {
      // 如果加载失败，显示占位符
      el.innerHTML = '<div class="avatar-placeholder-small">?</div>';
    };
    el.appendChild(img);
  } else {
    el.innerHTML = '<div class="avatar-placeholder-small">?</div>';
  }
}

socket.on('players', (list) => {
  if (!Array.isArray(list)) return;
  lastPlayersList = list;
  // 大厅阶段：不显示玩家名字，只显示所选对局人数/状态（来自 matches）
  if (lobbySection && lobbySection.style.display !== 'none') {
    renderSelectedMatchSummary();
  } else {
    playersDiv.innerHTML = '<b>玩家：</b>' + list.map(p => `${p.name}(${p.score})`).join(' | ');
  }
  // update left/right names and scores when in game
  let me = null;
  let opponent = null;
  if (myName) {
    me = list.find(p => p.name === myName) || null;
    opponent = list.find(p => p.name !== myName) || null;
  } else {
    me = list[0] || null;
    opponent = list[1] || null;
  }
  if (leftPlayerNameEl) leftPlayerNameEl.textContent = me ? me.name : '等待玩家';
  if (rightPlayerNameEl) rightPlayerNameEl.textContent = opponent ? opponent.name : '等待中...';
  
  // 更新玩家头像
  updatePlayerAvatar('left-player-avatar', me ? me.avatar : null);
  updatePlayerAvatar('right-player-avatar', opponent ? opponent.avatar : null);
  // 同步捕获干员列表（双方结束时可揭示）
  computeCapturedLists(list);
  renderCapturedLists();
  // update callpoints / intelpoints if provided, otherwise show 0
  const leftCall = document.getElementById('left-callpoints');
  const leftIntel = document.getElementById('left-intelpoints');
  const rightCall = document.getElementById('right-callpoints');
  const rightIntel = document.getElementById('right-intelpoints');
  if (leftCall) leftCall.textContent = me && typeof me.callPoints !== 'undefined' ? String(me.callPoints) : '0';
  if (leftIntel) leftIntel.textContent = me && typeof me.intelPoints !== 'undefined' ? String(me.intelPoints) : '0';
  if (rightCall) rightCall.textContent = opponent && typeof opponent.callPoints !== 'undefined' ? String(opponent.callPoints) : '0';
  if (rightIntel) {
    const oppName = opponent && opponent.name ? String(opponent.name) : '';
    if (opponentIntelSnapshotFor !== oppName) {
      opponentIntelSnapshotFor = oppName;
      opponentIntelSnapshot = null;
    }

    const currentOppIntel = opponent && typeof opponent.intelPoints !== 'undefined'
      ? Number(opponent.intelPoints) : 0;
    const roundEnded = !!(lastGameState && lastGameState.allEnded);

    let displayIntel = currentOppIntel;
    if (!isSpectator && !roundEnded) {
      if (opponentIntelSnapshot === null) opponentIntelSnapshot = currentOppIntel;
      displayIntel = opponentIntelSnapshot;
      rightIntel.title = '回合结束后才显示消耗';
    } else {
      displayIntel = currentOppIntel;
      rightIntel.title = '';
    }

    rightIntel.textContent = String(Number.isFinite(displayIntel) ? displayIntel : 0);
    rightIntel.classList.remove('hidden');
  }

  // 更新玩家状态标签
  updatePlayerStatus();

  // enable/disable peek button based on intel points of current user
  if (btnPeek) {
    const hasIntel = me && typeof me.intelPoints !== 'undefined' && me.intelPoints > 0;
    btnPeek.disabled = !hasIntel || !!(me && (me.endPending || me.endQueued));
  }
  // enable call button if user has callPoints and round active
  if (btnCall) {
    const hasCall = me && typeof me.callPoints !== 'undefined' && (me.callPoints > 0);
    // also honor server-side disabled/restDisabled flags
    const isDisabled = me && me.disabled;
    // 若对手已结束导致 forcedCall（通常为10），则要求本人调用点 >= forcedCall 才能点击调用
    const forced = me && typeof me.forcedCall !== 'undefined' && me.forcedCall !== null;
    const forcedNeed = forced ? Number(me.forcedCall) : 0;
    const forcedOk = !forced || (!isNaN(forcedNeed) && (Number(me.callPoints) || 0) >= forcedNeed);
    btnCall.disabled = !hasCall || !!isDisabled || !forcedOk;
    if (me && me.restDisabled && btnRest) btnRest.disabled = true;
  }
  // show '已结束' badge next to names if ended
  if (leftPlayerNameEl) {
    if (me && me.ended) {
      if (!leftPlayerNameEl.querySelector('.ended-badge')) {
        const span = document.createElement('span');
        span.className = 'ended-badge';
        span.textContent = '已结束';
        leftPlayerNameEl.appendChild(span);
      }
    } else {
      const b = leftPlayerNameEl.querySelector('.ended-badge'); if (b) b.remove();
    }
  }
  if (rightPlayerNameEl) {
    if (opponent && opponent.ended) {
      if (!rightPlayerNameEl.querySelector('.ended-badge')) {
        const span = document.createElement('span');
        span.className = 'ended-badge';
        span.textContent = '已结束';
        rightPlayerNameEl.appendChild(span);
      }
    } else {
      const b = rightPlayerNameEl.querySelector('.ended-badge'); if (b) b.remove();
    }
  }
  // disable end button if user already ended or is temporarily disabled
  if (btnEnd) {
    btnEnd.disabled = !!(me && (me.ended || me.endPending || me.endQueued || me.disabled));
  }
  // control call input per-player: if current user ended, show 0 and disable input
  const callAmountInputEl = document.getElementById('call-amount');
  const btnCallIncrEl = document.getElementById('btn-call-incr');
  const btnCallDecrEl = document.getElementById('btn-call-decr');
  if (me && (me.ended || me.endPending || me.endQueued)) {
    if (callAmountInputEl) { callAmountInputEl.value = '0'; callAmountInputEl.disabled = true; }
    if (btnCallIncrEl) btnCallIncrEl.disabled = true;
    if (btnCallDecrEl) btnCallDecrEl.disabled = true;
    if (btnCall) btnCall.disabled = true; // cannot call when ended (they auto-pay 0)
  } else {
    // if server forces a call value (e.g., opponent clicked end), reflect that
    if (me && typeof me.forcedCall !== 'undefined') {
      if (callAmountInputEl) { callAmountInputEl.value = String(me.forcedCall); callAmountInputEl.disabled = true; }
      if (btnCallIncrEl) btnCallIncrEl.disabled = true;
      if (btnCallDecrEl) btnCallDecrEl.disabled = true;
      // 若调用点不足 forcedCall（默认10），则不允许点击调用
      const need = Number(me.forcedCall);
      const have = Number(me.callPoints) || 0;
      if (btnCall) btnCall.disabled = !(need >= 0 && have >= need);
    } else {
    // restore controls for non-ended players
    if (callAmountInputEl) { callAmountInputEl.disabled = false; if (!callAmountInputEl.value) callAmountInputEl.value = '1'; }
    if (btnCallIncrEl) btnCallIncrEl.disabled = false;
    if (btnCallDecrEl) btnCallDecrEl.disabled = false;
    if (btnCall) btnCall.disabled = false;
    }
  }

  // 兜底：确保按钮状态与当前身份/状态一致（观战者始终禁用）
  syncActionControls();
});

// global game-state updates (restDisabled, endLockOwner)
socket.on('game-state', (state) => {
  if (!state) return;
  lastGameState = { ...lastGameState, ...state };
  const callAmountInput = document.getElementById('call-amount');
  const btnCallIncr = document.getElementById('btn-call-incr');
  const btnCallDecr = document.getElementById('btn-call-decr');
  const actionRow = document.getElementById('action-row');
  const continueRow = document.getElementById('continue-row');
  const roundBanner = document.getElementById('round-banner');
  const roundBannerText = document.getElementById('round-banner-text');
  if (state.peekDisabled) {
    if (btnPeek) btnPeek.disabled = true;
  }
  if (state.restDisabled) {
    if (btnRest) btnRest.disabled = true;
  }
  // show end-of-round UI
  if (state.allEnded) {
    // 回合结束：中间框只显示结束提示
    if (roundBanner) {
      roundBanner.style.display = 'none';
      roundBanner.classList.remove('end');
    }
    if (roundBannerText) roundBannerText.textContent = '';

    if (operatorDiv) operatorDiv.classList.add('is-ended');
    if (operatorIconEl) operatorIconEl.innerHTML = '';
    if (operatorNameEl) operatorNameEl.textContent = '本轮博弈已结束';
    if (operatorStarsEl) operatorStarsEl.textContent = '';
    if (operatorBranchEl) operatorBranchEl.textContent = '';
    if (claimBtn) claimBtn.disabled = true;

    // 双方结束：揭示固定池第三个干员名字
    revealFixedThirdName = true;
    if (lastPoolPayload) renderPublicPool(lastPoolPayload);

    // 双方结束：揭示双方已抓干员（名字/星级）
    revealAllCaptured = true;
    if (lastPlayersList) { computeCapturedLists(lastPlayersList); renderCapturedLists(); }

    // 自动滚动到页面顶部
    if (typeof window !== 'undefined' && window.scrollTo) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  if (typeof state.continueNeeded !== 'undefined') {
    if (state.continueNeeded) {
      if (actionRow) actionRow.style.display = 'none';
      if (continueRow) continueRow.style.display = 'flex';
      // 每次进入“继续”状态都重新启用按钮，避免上一次点击后保持 disabled。
      if (btnContinue) btnContinue.disabled = false;

      // show progress to reduce “no response” confusion
      const total = (Array.isArray(lastPlayersList) && lastPlayersList.length) ? lastPlayersList.length : 2;
      const count = (typeof state.continueCount === 'number' && Number.isFinite(state.continueCount)) ? state.continueCount : null;
      if (statusDiv) statusDiv.textContent = count !== null
        ? `等待继续：${Math.min(count, total)}/${total}`
        : '等待对局继续…';
    } else {
      if (actionRow) actionRow.style.display = 'flex';
      if (continueRow) continueRow.style.display = 'none';
      if (btnContinue) btnContinue.disabled = false;

      // 进入下一轮：隐藏回合结束提示条
      if (roundBanner) {
        roundBanner.style.display = 'none';
        roundBanner.classList.remove('end');
      }
      if (roundBannerText) roundBannerText.textContent = '';

      // 新回合开始：重置对手情报点快照（下一次 players 更新将重新采样）
      opponentIntelSnapshot = null;

      // 进入下一轮：中间框恢复为等待状态（避免停留在“本轮博弈已结束”）
      if (operatorDiv) operatorDiv.classList.remove('is-ended');
      if (operatorIconEl) operatorIconEl.innerHTML = '';
      if (operatorNameEl) operatorNameEl.textContent = '等待开始...';
      if (operatorStarsEl) operatorStarsEl.textContent = '';
      if (operatorBranchEl) operatorBranchEl.textContent = '';

      // 进入下一轮：玩家侧恢复隐藏；观战者保持揭示
      if (!isSpectator) {
        revealFixedThirdName = false;
        if (lastPoolPayload) renderPublicPool(lastPoolPayload);

        revealAllCaptured = false;
        if (lastPlayersList) { computeCapturedLists(lastPlayersList); renderCapturedLists(); }
      } else {
        revealFixedThirdName = true;
        revealAllCaptured = true;
        if (lastPoolPayload) renderPublicPool(lastPoolPayload);
        if (lastPlayersList) { computeCapturedLists(lastPlayersList); renderCapturedLists(); }
      }
    }
  }

  // 对手抓取未揭示前：不允许使用星级筛选
  // do not force call amount globally here. per-player 'ended' will control input state in the 'players' handler.
  // 兜底同步（避免动画事件把按钮错误地 re-enable）
  syncActionControls();
});

// continue button handler
if (btnContinue) btnContinue.onclick = () => {
  if (isSpectator) return;
  if (!socket || socket.connected === false) {
    if (statusDiv) statusDiv.textContent = '连接已断开，无法继续（可刷新页面重连）';
    return;
  }
  lastContinueClickAt = Date.now();
  socket.emit('continue');
  btnContinue.disabled = true;
  if (statusDiv) statusDiv.textContent = '已发送继续，等待对手…';
  // if server-side state doesn't update, keep a gentle hint
  setTimeout(() => {
    if (!lastContinueClickAt) return;
    if (Date.now() - lastContinueClickAt < 1200) return;
    if (lastGameState && lastGameState.continueNeeded) return;
    // no explicit state update; likely opponent not ready or network jitter
    if (statusDiv) statusDiv.textContent = '已发送继续，若无响应请检查网络/按 Ctrl+F5 强刷';
  }, 1500);
};

socket.on('new-operator', (data) => {
  // switch to game view when operator appears
  showGame();
  if (operatorDiv) operatorDiv.classList.remove('is-ended');
  // 新回合出现新干员：重置对手情报点快照（避免沿用上一回合）
  opponentIntelSnapshot = null;
  // 新回合开始：清空彩蛋情报显示
  resetEasterInfo();
  // 更新回合数显示
  const roundNum = data.roundNumber;
  if (roundNum !== undefined) {
    const roundDisplay = document.getElementById('round-display');
    if (roundDisplay) roundDisplay.textContent = String(roundNum);
  }
  const op = data.operator;
  if (op === null) {
    operatorNameEl.textContent = '无';
    operatorStarsEl.textContent = '';
    operatorBranchEl.textContent = '';
    setCenterOperatorIconByClass('');
    if (claimBtn) claimBtn.disabled = true;
    statusDiv.textContent = '无可用干员';
    return;
  }
  // op may be an object {name, stars, branch}
  if (typeof op === 'string') {
    // legacy string operator: show as main label (fallback)
    operatorNameEl.textContent = op;
    operatorStarsEl.textContent = '';
    operatorBranchEl.textContent = '';
    setCenterOperatorIconByClass('');
  } else if (op && typeof op === 'object') {
    // 本轮只显示职业信息：主标题“未知干员”，副标题显示职业；图标与职业一致。
    const cls = op.class || op.Class || '';
    operatorNameEl.textContent = cls ? '未知干员' : (op.name || '');
    operatorStarsEl.textContent = '';
    operatorBranchEl.textContent = cls ? String(cls) : '';
    setCenterOperatorIconByClass(cls);
  }
  if (claimBtn) claimBtn.disabled = false;
  statusDiv.textContent = '快来抢！';
  // 观战者：保持全部操作禁用
  syncActionControls();
  // do NOT refresh public pool here — keep the top-three stable across claims
  // reset local captured offers arrays display (not clearing captured operators)
  // also reset local offer inputs
  if (callAmountInput) callAmountInput.value = '1';
});

// 彩蛋模式：提前得知对方出价/是否已窥视
socket.on('easter-opponent-offer', (payload) => {
  const v = payload && typeof payload.amount !== 'undefined' ? Number(payload.amount) : null;
  if (v === null || !Number.isFinite(v)) return;
  easterOpponentOffer = Math.max(0, Math.floor(v));
  easterOpponentRested = !!(payload && payload.rested === true);
  if (payload && payload.peeked === true) easterOpponentPeeked = true;
  renderEasterInfo();
});

socket.on('easter-opponent-peek', () => {
  easterOpponentPeeked = true;
  renderEasterInfo();
});

// 当平局/双休息导致干员被移出时，短暂展示该干员
socket.on('removed-operator', (data) => {
  const op = data && data.operator;
  if (!op) return;
  showGame();
  if (typeof op === 'string') {
    operatorNameEl.textContent = op;
    operatorStarsEl.textContent = '';
    operatorBranchEl.textContent = '';
    setCenterOperatorIconByClass('');
  } else if (op && typeof op === 'object') {
    operatorNameEl.textContent = op.name || (op.class ? `未知${op.class}` : '');
    operatorStarsEl.textContent = (op.stars ? '★'.repeat(op.stars) : '');
    operatorBranchEl.textContent = op.branch ? op.branch : '';
    setCenterOperatorIconByOperator(op);
  }
});

socket.on('claimed', (data) => {
  const op = data.operator;
  const opName = (op && typeof op === 'object') ? op.name : op;
  statusDiv.textContent = `${data.by} 抢到了 ${opName}`;
  if (claimBtn) claimBtn.disabled = true;
  // add to captured list for the side that got it
  const byName = data.by;
  const displayFull = (op && typeof op === 'object') ? `${op.name}${op.stars ? ' ' + '★'.repeat(op.stars) : ''}` : String(op);
  const paid = typeof data.paid !== 'undefined' ? data.paid : null;
  const clsForKey = (op && typeof op === 'object') ? (op.class || op.Class || '') : '';
  const key = (op && typeof op === 'object' && op.name)
    ? String(op.name)
    : `unknown:${clsForKey}:${String(paid ?? '')}:${Date.now()}`;
  const entry = { key, text: displayFull, paid, operator: op };
  if (byName === myName) {
    leftCaptured.push(entry);
  } else if (rightPlayerNameEl && rightPlayerNameEl.textContent === byName) {
    // 对手抓到：默认隐藏名字，仅显示“未知+职业”；双方结束时再揭示
    if (!revealAllCaptured) {
      rightCaptured.push({ key, text: '？？？', paid, operator: op });
    } else {
      rightCaptured.push(entry);
    }
  } else if (leftPlayerNameEl && leftPlayerNameEl.textContent === byName) {
    leftCaptured.push(entry);
  } else {
    if (!revealAllCaptured) {
      rightCaptured.push({ key, text: '？？？', paid, operator: op });
    } else {
      rightCaptured.push(entry);
    }
  }
  renderCapturedLists();
  // keep top-three pool unchanged here (server controls currentPool)
});

socket.on('clear', () => {
  operatorNameEl.textContent = '等待玩家...';
  operatorStarsEl.textContent = '';
  operatorBranchEl.textContent = '';
  setCenterOperatorIconByClass('');
  if (claimBtn) claimBtn.disabled = true;
  // 回到大厅：玩家侧清空揭示；观战者会在 role 事件中重新设置
  revealFixedThirdName = false;
  revealAllCaptured = false;
  // 服务端通知回到大厅：同步清空“已移出”显示（否则不刷新页面会残留上一局）。
  removedAllList = [];
  renderRemovedList();
  pinnedCapturedLeft.clear();
  pinnedCapturedRight.clear();
  leftRosterClassFilter = '';
  rightRosterClassFilter = '';
  showLobby();
});

// bottom list: 支持“已移出/未移出”切换 + 按职业筛选
const removedMode = document.getElementById('removed-mode');
const removedFilter = document.getElementById('removed-filter');
const bannedBarEl = document.getElementById('banned-bar');
const bannedBarTextEl = document.getElementById('banned-bar-text');
const bannedOverlayEl = document.getElementById('banned-overlay');
const bannedGridEl = document.getElementById('banned-grid');
const bannedDetailEl = document.getElementById('banned-detail');
const bannedDetailTitleEl = document.getElementById('banned-detail-title');
const bannedDetailSubEl = document.getElementById('banned-detail-sub');
const bannedDetailListEl = document.getElementById('banned-detail-list');
const bannedDetailCloseEl = document.getElementById('banned-detail-close');

// Make banned detail window draggable by its header
(function initBannedDetailDrag() {
  if (!bannedDetailEl) return;
  const head = bannedDetailEl.querySelector('.head');
  if (!head) return;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function beginDrag(ev) {
    // ignore dragging when clicking close button
    if (ev.target === bannedDetailCloseEl || (bannedDetailCloseEl && bannedDetailCloseEl.contains(ev.target))) return;
    if (bannedDetailEl.style.display === 'none') return;
    dragging = true;
    bannedDetailEl.classList.add('dragging');

    // Convert from centered (left 50% + transform) to explicit left/top on first drag
    const rect = bannedDetailEl.getBoundingClientRect();
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;

    bannedDetailEl.style.left = rect.left + 'px';
    bannedDetailEl.style.top = rect.top + 'px';
    bannedDetailEl.style.bottom = 'auto';
    bannedDetailEl.style.transform = 'none';

    try { head.setPointerCapture(ev.pointerId); } catch (_) {}
    ev.preventDefault();
  }

  function onMove(ev) {
    if (!dragging) return;
    const rect = bannedDetailEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    let left = ev.clientX - offsetX;
    let top = ev.clientY - offsetY;

    // keep within viewport with small margin
    const margin = 6;
    left = clamp(left, margin, Math.max(margin, vw - rect.width - margin));
    top = clamp(top, margin, Math.max(margin, vh - rect.height - margin));

    bannedDetailEl.style.left = left + 'px';
    bannedDetailEl.style.top = top + 'px';
    ev.preventDefault();
  }

  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    bannedDetailEl.classList.remove('dragging');
    try { head.releasePointerCapture(ev.pointerId); } catch (_) {}
    ev.preventDefault();
  }

  head.addEventListener('pointerdown', beginDrag);
  head.addEventListener('pointermove', onMove);
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
})();

let bannedDetailSelected = null; // { cls, branch }

let bannedDetailLastCount = 0;

function updateBannedDetailCols(count) {
  if (!bannedDetailEl) return;
  const cs = getComputedStyle(bannedDetailEl);
  const raw = cs.getPropertyValue('--banned-detail-cols-max');
  const maxCols = Number.parseInt(String(raw || '').trim(), 10) || 10;
  const n = Math.max(Number(count) || 0, 0);
  let cols = 1;
  if (n > 0 && n <= maxCols) {
    cols = n; // one row
  } else if (n > maxCols) {
    // try to keep it close to 2 rows while shrinking width
    cols = Math.min(maxCols, Math.ceil(n / 2));
  }
  bannedDetailEl.style.setProperty('--banned-detail-cols', String(cols));
}

function cleanKey(s) {
  return String(s || '').replace(/\s/g, '');
}

function getRemovedSet() {
  const set = new Set();
  (removedAllList || []).forEach(n => set.add(cleanKey(n)));
  return set;
}

function hideBannedDetail() {
  bannedDetailSelected = null;
  if (bannedDetailEl) {
    bannedDetailEl.style.display = 'none';
    bannedDetailEl.setAttribute('aria-hidden', 'true');
    bannedDetailEl.style.removeProperty('--banned-detail-cols');
  }
  if (bannedDetailListEl) bannedDetailListEl.innerHTML = '';
}

function showBannedDetail(cls, branch) {
  if (!bannedDetailEl || !bannedDetailTitleEl || !bannedDetailListEl) return;
  const c = normalizeOperatorClass(cls);
  const b = String(branch || '').trim();
  if (!c || !b) return;

  const list = Array.isArray(window.OPERATOR_LIST) ? window.OPERATOR_LIST : [];
  const removedSet = getRemovedSet();

  const ops = list.filter(op => {
    if (!op || typeof op !== 'object') return false;
    if (!op.name) return false;
    const oc = normalizeOperatorClass(op.class || op.Class);
    if (oc !== c) return false;
    const ob = String(op.branch || op.Branch || '').trim();
    return ob === b;
  });

  let bannedCount = 0;
  for (const op of ops) {
    if (removedSet.has(cleanKey(op.name))) bannedCount++;
  }

  bannedDetailLastCount = ops.length;
  updateBannedDetailCols(bannedDetailLastCount);

  bannedDetailTitleEl.textContent = `${c} / ${b}`;
  if (bannedDetailSubEl) {
    const total = ops.length;
    const remain = total - bannedCount;
    bannedDetailSubEl.textContent = `共 ${total} · 可用 ${remain} · 禁用 ${bannedCount}`;
  }

  bannedDetailListEl.innerHTML = '';
  for (const op of ops) {
    const wrap = document.createElement('div');
    wrap.className = 'banned-op' + (removedSet.has(cleanKey(op.name)) ? ' banned' : '');
    wrap.title = op.name;

    const av = document.createElement('div');
    av.className = 'av';
    renderOperatorAvatarInto(av, op.name, c);
    wrap.appendChild(av);

    bannedDetailListEl.appendChild(wrap);
  }

  bannedDetailEl.style.display = '';
  bannedDetailEl.setAttribute('aria-hidden', 'false');
}

// keep banned detail width responsive when resizing
window.addEventListener('resize', () => {
  if (!bannedDetailEl) return;
  if (bannedDetailEl.style.display === 'none') return;
  if (bannedDetailEl.getAttribute('aria-hidden') === 'true') return;
  updateBannedDetailCols(bannedDetailLastCount);
}, { passive: true });

function getAllOperatorsNames() {
  const list = Array.isArray(window.OPERATOR_LIST) ? window.OPERATOR_LIST : [];
  return list
    .map(op => (op && typeof op === 'object') ? op.name : String(op))
    .filter(Boolean);
}

function renderRemovedList() {
  if (!bannedBarTextEl || !bannedGridEl) return;

  const mode = removedMode ? removedMode.value : 'removed';
  const filter = removedFilter ? removedFilter.value : '';

  let baseList = [];
  if (mode === 'remaining') {
    const removedSet = getRemovedSet();
    baseList = getAllOperatorsNames().filter(name => !removedSet.has(cleanKey(name)));
  } else {
    baseList = removedAllList.slice();
  }

  // 映射未就绪：只更新 bar 文案（overlay 留空）
  if (!window.OPERATOR_INFO_MAP) {
    const total = baseList.length;
    bannedBarTextEl.textContent = `禁用协议 / BANNED PROTOCOL [${total} OPERATORS DETECTED]`;
    bannedGridEl.innerHTML = '';
    return;
  }

  // 只保留能映射到职业/分支的干员
  let showArr = baseList.filter(name => !!window.OPERATOR_INFO_MAP[cleanKey(name)]);
  if (filter) {
    showArr = showArr.filter(name => {
      const info = window.OPERATOR_INFO_MAP[cleanKey(name)];
      return info && info.cls === filter;
    });
  }

  const total = showArr.length;
  bannedBarTextEl.textContent = `禁用协议 / BANNED PROTOCOL [${total} OPERATORS DETECTED]`;

  // 统计：class -> branch -> count
  const byClass = new Map();
  const classTotal = new Map();
  for (const name of showArr) {
    const info = window.OPERATOR_INFO_MAP[cleanKey(name)];
    if (!info) continue;
    const cls = normalizeOperatorClass(info.cls);
    if (!cls) continue;
    const branch = String(info.branch || '').trim() || '未知';

    if (!byClass.has(cls)) byClass.set(cls, new Map());
    const inner = byClass.get(cls);
    inner.set(branch, (inner.get(branch) || 0) + 1);
    classTotal.set(cls, (classTotal.get(cls) || 0) + 1);
  }

  const branchIndex = window.OPERATOR_BRANCHES_BY_CLASS || null;
  const classOrder = Array.isArray(ROSTER_CLASS_ORDER) ? ROSTER_CLASS_ORDER : ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];

  bannedGridEl.innerHTML = '';
  for (const cls of classOrder) {
    const card = document.createElement('div');
    card.className = 'banned-card';

    const head = document.createElement('div');
    head.className = 'head';
    const clsEl = document.createElement('div');
    clsEl.className = 'cls';
    clsEl.textContent = cls;
    const cntEl = document.createElement('div');
    cntEl.className = 'cnt';
    cntEl.textContent = `(${classTotal.get(cls) || 0})`;
    head.appendChild(clsEl);
    head.appendChild(cntEl);
    card.appendChild(head);

    const branchesWrap = document.createElement('div');
    branchesWrap.className = 'banned-branches';
    const branchCounts = byClass.get(cls) || new Map();

    let branches = [];
    if (branchIndex && branchIndex[cls] && Array.isArray(branchIndex[cls])) {
      branches = branchIndex[cls].slice();
    } else {
      branches = Array.from(branchCounts.keys());
    }

    // 稳定排序：按 operators.json 出现顺序（branchIndex）优先，否则按字典序
    if (!branchIndex || !branchIndex[cls]) {
      branches.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    }

    for (const br of branches) {
      const count = branchCounts.get(br) || 0;
      const row = document.createElement('div');
      row.className = 'banned-branch' + (count === 0 ? ' zero' : '');
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = br;
      const cEl = document.createElement('div');
      cEl.className = 'count';
      cEl.textContent = `(${count})`;
      row.appendChild(nameEl);
      row.appendChild(cEl);
      row.style.cursor = 'pointer';
      row.title = '点击查看该分支干员头像';
      row.addEventListener('click', (e) => {
        try { if (e && e.stopPropagation) e.stopPropagation(); } catch (_) {}
        const sel = { cls, branch: br };
        const same = bannedDetailSelected && bannedDetailSelected.cls === sel.cls && bannedDetailSelected.branch === sel.branch;
        if (same) {
          hideBannedDetail();
          return;
        }
        bannedDetailSelected = sel;
        showBannedDetail(sel.cls, sel.branch);
      });
      branchesWrap.appendChild(row);
    }

    card.appendChild(branchesWrap);
    bannedGridEl.appendChild(card);
  }
}

if (removedFilter) removedFilter.onchange = renderRemovedList;
if (removedMode) removedMode.onchange = renderRemovedList;

socket.on('removed', (data) => {
  removedAllList = (data && Array.isArray(data.removed)) ? data.removed : [];
  renderRemovedList();
});

function setBannedOverlayVisible(visible) {
  if (!bannedOverlayEl || !bannedBarEl) return;
  bannedOverlayEl.style.display = visible ? '' : 'none';
  bannedOverlayEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
  bannedBarEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (!visible) hideBannedDetail();
}

if (bannedBarEl) {
  bannedBarEl.addEventListener('click', () => {
    const isOpen = bannedOverlayEl && bannedOverlayEl.style.display !== 'none' && bannedOverlayEl.getAttribute('aria-hidden') !== 'true';
    setBannedOverlayVisible(!isOpen);
    // ensure overlay is up-to-date when opening
    if (!isOpen) renderRemovedList();
  });
  bannedBarEl.addEventListener('keydown', (e) => {
    if (!e) return;
    const key = e.key || '';
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      bannedBarEl.click();
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (!e) return;
  if (e.key !== 'Escape') return;
  if (!bannedOverlayEl) return;
  const isOpen = bannedOverlayEl.style.display !== 'none' && bannedOverlayEl.getAttribute('aria-hidden') !== 'true';
  if (isOpen) setBannedOverlayVisible(false);
  else {
    // if overlay already closed, just ensure detail closed too
    hideBannedDetail();
  }
});

document.addEventListener('click', (e) => {
  if (!e) return;
  if (!bannedOverlayEl || !bannedBarEl) return;
  const isOpen = bannedOverlayEl.style.display !== 'none' && bannedOverlayEl.getAttribute('aria-hidden') !== 'true';
  if (!isOpen) return;
  const t = e.target;
  if ((bannedDetailEl && bannedDetailEl.contains(t)) || bannedOverlayEl.contains(t) || bannedBarEl.contains(t)) return;
  setBannedOverlayVisible(false);
});

if (bannedDetailCloseEl) {
  bannedDetailCloseEl.addEventListener('click', (e) => {
    try { if (e && e.stopPropagation) e.stopPropagation(); } catch (_) {}
    hideBannedDetail();
  });
  bannedDetailCloseEl.addEventListener('keydown', (e) => {
    if (!e) return;
    const key = e.key || '';
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      bannedDetailCloseEl.click();
    }
  });
}

// 预加载 operators.json 并建立 name->class 映射 + 全量列表
fetch('/operators.json')
  .then(r => r.json())
  .then(list => {
    window.OPERATOR_LIST = Array.isArray(list) ? list : [];
    window.OPERATOR_CLASS_MAP = {};
    window.OPERATOR_INFO_MAP = {};
    window.OPERATOR_BRANCHES_BY_CLASS = {};
    window.OPERATOR_LIST.forEach(op => {
      if (!op || typeof op !== 'object') return;
      if (!op.name) return;
      const cls = op.class || op.Class;
      if (!cls) return;
      const k = cleanKey(op.name);
      // operators.json 里如果存在重复 name（少数数据错误场景），保留第一条，避免 UI 计数/详情不一致。
      if (window.OPERATOR_INFO_MAP[k]) return;

      window.OPERATOR_CLASS_MAP[k] = cls;

      const branch = op.branch || op.Branch || '';
      window.OPERATOR_INFO_MAP[k] = { cls: String(cls), branch: String(branch || '') };

      const c = String(cls);
      if (!window.OPERATOR_BRANCHES_BY_CLASS[c]) window.OPERATOR_BRANCHES_BY_CLASS[c] = [];
      const b = String(branch || '').trim();
      if (b && !window.OPERATOR_BRANCHES_BY_CLASS[c].includes(b)) {
        window.OPERATOR_BRANCHES_BY_CLASS[c].push(b);
      }
    });
    renderRemovedList();
  })
  .catch(() => {
    // ignore
  });

socket.on('peek', (data) => {
  const op = data && data.operator;
  if (op) {
    // reveal stars and branch only to the peeking player; do NOT reveal name
    operatorStarsEl.textContent = (op.stars ? '★'.repeat(op.stars) : '');
    operatorBranchEl.textContent = op.branch ? op.branch : '';
    // do not change operatorNameEl (keep class or unknown prefix shown)
    if (btnPeek) btnPeek.disabled = true;
  }
});

socket.on('call-failed', (data) => {
  if (data && data.msg) alert(data.msg);
});

socket.on('peek-failed', (data) => {
  if (data && data.msg) alert(data.msg);
});

if (claimBtn) claimBtn.onclick = () => {
  if (isSpectator) return;
  socket.emit('claim');
  claimBtn.disabled = true;
};

// call amount controls
function clampCallAmount() {
  let v = parseInt(callAmountInput.value || '1') || 1;
  if (v < 0) v = 0;
  if (v > 20) v = 20;
  callAmountInput.value = String(v);
  return v;
}
if (btnCallIncr) btnCallIncr.onclick = () => { callAmountInput.value = String(clampCallAmount() + 1); clampCallAmount(); };
if (btnCallDecr) btnCallDecr.onclick = () => { callAmountInput.value = String(Math.max(0, clampCallAmount() - 1)); clampCallAmount(); };

if (btnCall) btnCall.onclick = () => {
  if (isSpectator) return;
  const amt = clampCallAmount();
  socket.emit('call', { amount: amt });
};
if (btnPeek) btnPeek.onclick = () => { if (isSpectator) return; socket.emit('peek'); };
if (btnRest) btnRest.onclick = () => { if (isSpectator) return; socket.emit('rest'); };
if (btnEnd) btnEnd.onclick = () => {
  if (isSpectator) return;
  if (window.confirm('确定要结束本轮吗？此操作不可撤销。')) {
    socket.emit('end');
  }
};

// receive public pool
socket.on('pool', (data) => {
  lastPoolPayload = data || null;
  renderPublicPool(lastPoolPayload);
});

// ask for pool on connect
socket.on('connect', () => {
  socket.emit('request-pool');
});

// ========== 头像相关功能 ==========
const avatarPreview = document.getElementById('avatar-preview');
const avatarUpload = document.getElementById('avatar-upload');
const btnUploadAvatar = document.getElementById('btn-upload-avatar');
const btnRandomAvatar = document.getElementById('btn-random-avatar');

function updateAvatarPreview(src) {
  if (!avatarPreview) return;
  avatarPreview.innerHTML = '';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    avatarPreview.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'avatar-placeholder';
    placeholder.textContent = '头像';
    avatarPreview.appendChild(placeholder);
  }
}

function setAvatar(dataUrl) {
  myAvatar = dataUrl;
  updateAvatarPreview(dataUrl);
}

// 上传头像
if (btnUploadAvatar) {
  btnUploadAvatar.addEventListener('click', () => {
    if (avatarUpload) avatarUpload.click();
  });
}

if (avatarUpload) {
  avatarUpload.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    
    // 使用canvas压缩图片
    const img = new Image();
    const reader = new FileReader();
    
    reader.onload = (ev) => {
      img.src = ev.target.result;
    };
    
    img.onload = () => {
      // 压缩图片到最大512x512，质量0.8
      const maxSize = 512;
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // 转换为base64，质量0.8
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setAvatar(dataUrl);
    };
    
    reader.readAsDataURL(file);
    // 清空input，允许重复选择同一文件
    e.target.value = '';
  });
}

// 随机头像
if (btnRandomAvatar) {
  btnRandomAvatar.addEventListener('click', async () => {
    // 从干员头像中随机选择
    const operatorList = Array.isArray(window.OPERATOR_LIST) ? window.OPERATOR_LIST : [];
    if (operatorList.length === 0) {
      // 如果干员列表还没加载，先请求
      try {
        const res = await fetch('/operators.json');
        const data = await res.json();
        window.OPERATOR_LIST = Array.isArray(data) ? data : [];
      } catch (err) {
        console.error('加载干员列表失败:', err);
        return;
      }
    }
    
    const list = window.OPERATOR_LIST;
    if (list.length === 0) return;
    
    // 随机选择一个干员
    const randomOp = list[Math.floor(Math.random() * list.length)];
    if (!randomOp || !randomOp.name) return;
    
    // 构建头像URL
    const name = randomOp.name;
    const safeName = name.replace(/[<>:"/\\|?*\x00-\x1F .]+$/g, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const avatarUrl = `/icons/operators/${encodeURIComponent(safeName)}.png`;
    
    // 设置为头像（使用URL而不是base64）
    setAvatar(avatarUrl);
  });
}

// 头像预览点击也可以上传
if (avatarPreview) {
  avatarPreview.addEventListener('click', () => {
    if (avatarUpload) avatarUpload.click();
  });
}

socket.on('disconnect', (reason) => {
  if (statusDiv) statusDiv.textContent = `连接已断开：${reason || 'unknown'}（可刷新页面重连）`;
});

socket.on('connect_error', (err) => {
  const msg = err && err.message ? String(err.message) : 'unknown';
  if (statusDiv) statusDiv.textContent = `连接错误：${msg}`;
});

// reset removed list display on reload/ reconnect
socket.on('connect', () => {
  renderRemovedList();
});

function renderCapturedLists() {
  prunePinnedSets();
  const leftFilter = leftRosterClassFilter || '';
  const rightFilter = rightRosterClassFilter || '';

  renderRosterTabs('left', leftRosterTabsEl, leftCaptured, leftFilter);
  renderRosterTabs('right', rightRosterTabsEl, rightCaptured, rightFilter);

  if (leftOperatorsEl) {
    const filteredLeft = leftCaptured.filter(item => {
      if (leftFilter && getProfessionFromCapturedItem(item) !== leftFilter) return false;
      return true;
    });

    const leftBaseIndex = new Map();
    filteredLeft.forEach((it, i) => {
      const k = it && it.key;
      if (k) leftBaseIndex.set(String(k), i);
    });

    const desiredLeft = sortByPinned(filteredLeft, pinnedCapturedLeft);
    const desiredLeftKeys = new Set();
    desiredLeft.forEach(item => {
      if (!item || !item.key) return;
      desiredLeftKeys.add(String(item.key));
      const row = upsertRosterRow('left', leftOperatorsEl, item, pinnedCapturedLeft, leftBaseIndex, { canReveal: true });
      if (row) leftOperatorsEl.appendChild(row);
    });

    // remove stale rows not in desired set
    Array.from(leftOperatorsEl.children || []).forEach(el => {
      const k = el && el.dataset ? el.dataset.key : '';
      if (k && !desiredLeftKeys.has(k)) {
        try { el.remove(); } catch (_) { /* ignore */ }
      }
    });

    // ensure DOM order matches pinned set without reflow flicker
    reorderRosterDomByPinned(leftOperatorsEl, pinnedCapturedLeft);
  }
  if (rightOperatorsEl) {
    const filteredRight = rightCaptured.filter(item => {
      if (rightFilter && getProfessionFromCapturedItem(item) !== rightFilter) return false;
      return true;
    });

    const rightBaseIndex = new Map();
    filteredRight.forEach((it, i) => {
      const k = it && it.key;
      if (k) rightBaseIndex.set(String(k), i);
    });

    const desiredRight = sortByPinned(filteredRight, pinnedCapturedRight);
    const desiredRightKeys = new Set();
    desiredRight.forEach(item => {
      if (!item || !item.key) return;
      desiredRightKeys.add(String(item.key));
      const row = upsertRosterRow('right', rightOperatorsEl, item, pinnedCapturedRight, rightBaseIndex, { canReveal: !!revealAllCaptured });
      if (row) rightOperatorsEl.appendChild(row);
    });

    Array.from(rightOperatorsEl.children || []).forEach(el => {
      const k = el && el.dataset ? el.dataset.key : '';
      if (k && !desiredRightKeys.has(k)) {
        try { el.remove(); } catch (_) { /* ignore */ }
      }
    });

    reorderRosterDomByPinned(rightOperatorsEl, pinnedCapturedRight);
  }
}

// collision animation: show two bubbles with the two offers and a brief impact
socket.on('collision', (data) => {
  // disable action buttons briefly
  if (btnCall) btnCall.disabled = true;
  if (btnPeek) btnPeek.disabled = true;
  if (btnRest) btnRest.disabled = true;
  if (btnEnd) btnEnd.disabled = true;

  const overlay = document.getElementById('collision-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  const bubble = document.createElement('div');
  bubble.className = 'collision-bubble';

  // 点数对比：始终把“自己”显示在左边
  const offers = data.offers || {};
  const myId = socket && socket.id ? socket.id : null;
  const idsFromOffers = Object.keys(offers);
  const fallbackOrder = Array.isArray(data.order) ? data.order : [];
  const otherId = myId
    ? (idsFromOffers.find(id => id !== myId) || fallbackOrder.find(id => id !== myId) || null)
    : (fallbackOrder[0] || idsFromOffers[0] || null);
  const renderOrder = [];
  if (myId) renderOrder.push(myId);
  if (otherId && otherId !== myId) renderOrder.push(otherId);
  // 兜底：如果拿不到myId或otherId，就按服务端order/offer keys补齐
  (fallbackOrder.length ? fallbackOrder : idsFromOffers).forEach(id => {
    if (!id) return;
    if (renderOrder.includes(id)) return;
    renderOrder.push(id);
  });

  // create number elements
  renderOrder.forEach((id) => {
    const num = document.createElement('div');
    num.className = 'collide-num';
    num.textContent = String(offers[id] || 0);
    // mark predicted winner immediately if provided
    if (data.winner && data.winner === id) {
      num.classList.add('winner');
    }
    bubble.appendChild(num);
  });
  overlay.appendChild(bubble);

  // show animation
  const nums = overlay.querySelectorAll('.collide-num');
  setTimeout(() => nums.forEach(n => n.classList.add('show')) , 30);
  // apply hit class at collision moment
  setTimeout(() => nums.forEach(n => n.classList.add('hit')), 350);
  // cleanup and re-enable buttons after animation
  setTimeout(() => {
    overlay.innerHTML = '';
    // 不要强行启用按钮；以服务端广播的 players/game-state 为准
    syncActionControls();
  }, 900);
});
