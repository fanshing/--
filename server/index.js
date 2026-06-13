const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 2;
const SAVED_SEAT_TOKEN = '__SAVED_SEAT__';

// 彩蛋：用特定名字进入会在局内显示为“星”
const EASTER_EGG_RAW_NAME = '周防有希';
const EASTER_EGG_DISPLAY_NAME = '星';

// JSON body for lightweight local APIs (e.g., icon upload)
app.use(express.json({ limit: '6mb' }));

// Backward compatibility: some older clients load /all.js. We ship a thin bootstrap in /public/all.js.
app.get('/all.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'all.js'));
});

// serve static files from workspace root `public` directory
// NOTE: avoid browser caching during local play/tests; otherwise users may keep running an old JS bundle
// and see confusing runtime errors (e.g. old all.js) after we update client code.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
// expose operators.json for frontend access
app.use('/operators.json', express.static(path.join(__dirname, 'operators.json'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

// --- Icon upload helpers (local use) ---
const CLASS_LIST = ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons', 'classes');
const OPERATOR_ICONS_DIR = path.join(__dirname, '..', 'public', 'icons', 'operators');

function safeOperatorIconBaseFromName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  // Prefer human-readable filenames (e.g. "绮良.png").
  // If it contains Windows-forbidden characters, fallback to encodeURIComponent for safety.
  const unsafe = /[<>:"/\\|?*\x00-\x1F]/g;
  const trimmed = n.replace(/\s+$/g, '');
  const safe = trimmed.replace(unsafe, '_').replace(/[ .]+$/g, '');
  if (!safe) return encodeURIComponent(n);
  // If sanitization changed the name, keep it reversible by encoding.
  if (safe !== trimmed) return encodeURIComponent(n);
  return safe;
}

function pickIconExtFromDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  if (s.startsWith('data:image/png;base64,')) return 'png';
  if (s.startsWith('data:image/webp;base64,')) return 'webp';
  if (s.startsWith('data:image/svg+xml;base64,')) return 'svg';
  return '';
}

function decodeDataUrlBase64(dataUrl) {
  const s = String(dataUrl || '');
  const idx = s.indexOf('base64,');
  if (idx < 0) return null;
  const b64 = s.slice(idx + 'base64,'.length);
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

function listExistingIconExts(dirPath, base) {
  const out = { hasSvg: false, hasPng: false, hasWebp: false };
  try {
    out.hasSvg = fs.existsSync(path.join(dirPath, `${base}.svg`));
    out.hasPng = fs.existsSync(path.join(dirPath, `${base}.png`));
    out.hasWebp = fs.existsSync(path.join(dirPath, `${base}.webp`));
  } catch (_) {
    // ignore
  }
  return out;
}

// Upload a class icon via JSON: { cls: '先锋', dataUrl: 'data:image/png;base64,...' }
app.post('/api/icons/class', (req, res) => {
  try {
    const cls = String(req.body && req.body.cls || '').trim();
    const dataUrl = String(req.body && req.body.dataUrl || '');
    if (!cls || !CLASS_LIST.includes(cls)) {
      return res.status(400).json({ ok: false, error: 'cls 非法或缺失', cls });
    }
    const ext = pickIconExtFromDataUrl(dataUrl);
    if (!ext) {
      return res.status(400).json({ ok: false, error: '仅支持 PNG/WEBP/SVG（base64 DataURL）', cls });
    }
    const buf = decodeDataUrlBase64(dataUrl);
    if (!buf || !buf.length) {
      return res.status(400).json({ ok: false, error: 'dataUrl 解析失败', cls });
    }
    // basic size guard
    if (buf.length > 4 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: '图片过大（>4MB）', cls });
    }

    fs.mkdirSync(ICONS_DIR, { recursive: true });
    const outPath = path.join(ICONS_DIR, `${cls}.${ext}`);
    fs.writeFileSync(outPath, buf);
    return res.json({ ok: true, cls, ext, path: `/icons/classes/${encodeURIComponent(cls)}.${ext}` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写入失败', detail: e && e.message });
  }
});

app.get('/api/icons/status', (req, res) => {
  try {
    const out = [];
    for (const cls of CLASS_LIST) {
      const svg = path.join(ICONS_DIR, `${cls}.svg`);
      const png = path.join(ICONS_DIR, `${cls}.png`);
      const webp = path.join(ICONS_DIR, `${cls}.webp`);
      const hasSvg = fs.existsSync(svg);
      const hasPng = fs.existsSync(png);
      const hasWebp = fs.existsSync(webp);
      out.push({ cls, hasSvg, hasPng, hasWebp });
    }
    return res.json({ ok: true, classes: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '查询失败', detail: e && e.message });
  }
});

// Upload an operator icon via JSON: { name: '能天使', dataUrl: 'data:image/png;base64,...' }
app.post('/api/icons/operator', (req, res) => {
  try {
    const name = String(req.body && req.body.name || '').trim();
    const dataUrl = String(req.body && req.body.dataUrl || '');
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name 缺失' });
    }
    if (name.length > 80) {
      return res.status(400).json({ ok: false, error: 'name 过长', name });
    }
    const ext = pickIconExtFromDataUrl(dataUrl);
    if (!ext) {
      return res.status(400).json({ ok: false, error: '仅支持 PNG/WEBP/SVG（base64 DataURL）', name });
    }
    const buf = decodeDataUrlBase64(dataUrl);
    if (!buf || !buf.length) {
      return res.status(400).json({ ok: false, error: 'dataUrl 解析失败', name });
    }
    if (buf.length > 4 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: '图片过大（>4MB）', name });
    }

    fs.mkdirSync(OPERATOR_ICONS_DIR, { recursive: true });
    const base = safeOperatorIconBaseFromName(name);
    if (!base) {
      return res.status(400).json({ ok: false, error: 'name 非法', name });
    }
    const outPath = path.join(OPERATOR_ICONS_DIR, `${base}.${ext}`);
    fs.writeFileSync(outPath, buf);
    return res.json({ ok: true, name, ext, path: `/icons/operators/${base}.${ext}` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写入失败', detail: e && e.message });
  }
});

// List operator icons that exist locally.
// Returns: { ok: true, items: [{ name, ext }], count }
app.get('/api/icons/operators/status', (req, res) => {
  try {
    const items = [];
    if (!fs.existsSync(OPERATOR_ICONS_DIR)) {
      return res.json({ ok: true, items, count: 0 });
    }
    const files = fs.readdirSync(OPERATOR_ICONS_DIR);
    const byBase = new Map();
    for (const fn of files) {
      const ext = path.extname(fn).replace('.', '').toLowerCase();
      if (!['svg', 'png', 'webp'].includes(ext)) continue;
      const base = path.basename(fn, path.extname(fn));
      if (!base) continue;
      const entry = byBase.get(base) || { base, hasSvg: false, hasPng: false, hasWebp: false };
      if (ext === 'svg') entry.hasSvg = true;
      if (ext === 'png') entry.hasPng = true;
      if (ext === 'webp') entry.hasWebp = true;
      byBase.set(base, entry);
    }

    for (const entry of byBase.values()) {
      // prefer svg > png > webp (same strategy as classes)
      let ext = '';
      if (entry.hasSvg) ext = 'svg';
      else if (entry.hasPng) ext = 'png';
      else if (entry.hasWebp) ext = 'webp';
      if (!ext) continue;
      let name = entry.base;
      try {
        if (/%[0-9A-Fa-f]{2}/.test(entry.base)) name = decodeURIComponent(entry.base);
      } catch (_) {
        name = entry.base;
      }
      items.push({ name, ext });
    }

    items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    return res.json({ ok: true, items, count: items.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '查询失败', detail: e && e.message });
  }
});

let operators = [];
let operatorsAll = [];

function loadOperators() {
  try {
    let raw = fs.readFileSync(__dirname + '/operators.json', 'utf8');
    raw = raw.replace(/^\uFEFF/, '');
    const firstJsonChar = raw.search(/[\{\[]/);
    if (firstJsonChar > 0) raw = raw.slice(firstJsonChar);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      operators = parsed;
      operatorsAll = parsed.slice();
      return true;
    }
  } catch (e) {
    console.warn('Failed to load/parse operators.json:', e && e.message);
  }
  // fallback
  operators = ['干员A', '干员B', '干员C', '干员D', '干员E', '干员F'];
  operatorsAll = operators.slice();
  return false;
}

// initial load
loadOperators();

let initialPoolRemoved = false;
let ROOM = 'lobby';
let round = { current: null, claimedBy: null, callOffers: {}, offerOrder: [], peeked: {} };
let players = {};
let currentPool = [];
let callsFixed = false;
let restDisabled = false;
let endLockOwner = null;
let removedClasses = new Set();
let removedOperatorsHistory = [];
let operatorsExhausted = false;
let continueVotes = new Set();
let roundNumber = 0;

// 多对局：每个 match 都有一套独立状态
const matches = new Map(); // matchId -> state
let matchSeq = 1;
let CURRENT_MATCH_ID = null;

function newMatchState(matchId) {
  return {
    id: String(matchId),
    room: `match:${matchId}`,
    operators: (operatorsAll || []).slice(),
    initialPoolRemoved: false,
    round: { current: null, claimedBy: null, callOffers: {}, offerOrder: [], peeked: {} },
    roundNumber: 0,
    players: {},
    currentPool: [],
    callsFixed: false,
    restDisabled: false,
    endLockOwner: null,
    removedClasses: new Set(),
    removedOperatorsHistory: [],
    operatorsExhausted: false,
    continueVotes: new Set(),
    savedSeat: null
  };
}

function ensureMatch(matchId) {
  const id = String(matchId || '').trim();
  if (!id) return null;
  if (!matches.has(id)) matches.set(id, newMatchState(id));
  return matches.get(id);
}

function listMatches() {
  const out = [];
  for (const m of matches.values()) {
    out.push({
      id: m.id,
      players: Object.keys(m.players || {}).length,
      inProgress: !!(m.round && m.round.current)
    });
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function broadcastMatches() {
  io.emit('matches', { matches: listMatches() });
}

function loadGlobalsFromMatch(m) {
  if (!m) return;
  ROOM = m.room;
  operators = m.operators;
  initialPoolRemoved = m.initialPoolRemoved;
  round = m.round;
  roundNumber = m.roundNumber || 0;
  players = m.players;
  currentPool = m.currentPool;
  callsFixed = m.callsFixed;
  restDisabled = m.restDisabled;
  endLockOwner = m.endLockOwner;
  removedClasses = m.removedClasses;
  removedOperatorsHistory = m.removedOperatorsHistory;
  operatorsExhausted = m.operatorsExhausted;
  continueVotes = m.continueVotes;
  savedSeat = m.savedSeat;
}

function saveGlobalsToMatch(m) {
  if (!m) return;
  m.room = ROOM;
  m.operators = operators;
  m.initialPoolRemoved = initialPoolRemoved;
  m.round = round;
  m.roundNumber = roundNumber;
  m.players = players;
  m.currentPool = currentPool;
  m.callsFixed = callsFixed;
  m.restDisabled = restDisabled;
  m.endLockOwner = endLockOwner;
  m.removedClasses = removedClasses;
  m.removedOperatorsHistory = removedOperatorsHistory;
  m.operatorsExhausted = operatorsExhausted;
  m.continueVotes = continueVotes;
  m.savedSeat = savedSeat;
}

function withMatch(matchId, fn) {
  const m = ensureMatch(matchId);
  if (!m) throw new Error('matchId required');

  const prev = {
    id: CURRENT_MATCH_ID,
    ROOM,
    operators,
    initialPoolRemoved,
    round,
    players,
    currentPool,
    callsFixed,
    restDisabled,
    endLockOwner,
    removedClasses,
    removedOperatorsHistory,
    operatorsExhausted,
    continueVotes,
    savedSeat
  };

  CURRENT_MATCH_ID = m.id;
  loadGlobalsFromMatch(m);
  try {
    return fn(m);
  } finally {
    saveGlobalsToMatch(m);
    CURRENT_MATCH_ID = prev.id;
    ROOM = prev.ROOM;
    operators = prev.operators;
    initialPoolRemoved = prev.initialPoolRemoved;
    round = prev.round;
    players = prev.players;
    currentPool = prev.currentPool;
    callsFixed = prev.callsFixed;
    restDisabled = prev.restDisabled;
    endLockOwner = prev.endLockOwner;
    removedClasses = prev.removedClasses;
    removedOperatorsHistory = prev.removedOperatorsHistory;
    operatorsExhausted = prev.operatorsExhausted;
    continueVotes = prev.continueVotes;
    savedSeat = prev.savedSeat;
  }
}

function runInMatch(matchId, fn) {
  return withMatch(matchId, () => fn());
}

function setTimeoutInMatch(matchId, fn, ms) {
  const id = String(matchId || '').trim();
  if (!id) return setTimeout(fn, ms);
  return setTimeout(() => runInMatch(id, fn), ms);
}

function setTimeoutInCurrentMatch(fn, ms) {
  return setTimeoutInMatch(CURRENT_MATCH_ID, fn, ms);
}

// 默认对局
ensureMatch('房间1');

// 玩家中途退出：缓存其整套数据，供下一位加入者继承
let savedSeat = null; // { oldId, player }

function clonePlain(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return obj ? { ...obj } : obj;
  }
}

function migrateSocketIdInMatchState(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;

  // round keyed maps
  if (round && round.callOffers && Object.prototype.hasOwnProperty.call(round.callOffers, oldId)) {
    round.callOffers[newId] = round.callOffers[oldId];
    delete round.callOffers[oldId];
  }
  if (round && round.peeked && Object.prototype.hasOwnProperty.call(round.peeked, oldId)) {
    round.peeked[newId] = round.peeked[oldId];
    delete round.peeked[oldId];
  }
  if (round && round.rested && Object.prototype.hasOwnProperty.call(round.rested, oldId)) {
    round.rested[newId] = round.rested[oldId];
    delete round.rested[oldId];
  }
  if (round && Array.isArray(round.offerOrder)) {
    round.offerOrder = round.offerOrder.map(x => (x === oldId ? newId : x));
  }
  if (round && round.claimedBy === oldId) {
    round.claimedBy = newId;
  }

  // end lock owner is a socket id
  if (endLockOwner === oldId) endLockOwner = newId;

  // continue votes is a set of socket ids
  if (continueVotes && typeof continueVotes.has === 'function' && continueVotes.has(oldId)) {
    continueVotes.delete(oldId);
    continueVotes.add(newId);
  }
}

function clearSocketIdFromMatchState(id) {
  if (!id) return;

  // round keyed maps
  if (round && round.callOffers && Object.prototype.hasOwnProperty.call(round.callOffers, id)) {
    delete round.callOffers[id];
  }
  if (round && round.peeked && Object.prototype.hasOwnProperty.call(round.peeked, id)) {
    delete round.peeked[id];
  }
  if (round && round.rested && Object.prototype.hasOwnProperty.call(round.rested, id)) {
    delete round.rested[id];
  }
  if (round && Array.isArray(round.offerOrder)) {
    round.offerOrder = round.offerOrder.filter(x => x !== id);
  }
  if (round && round.claimedBy === id) {
    round.claimedBy = null;
  }

  // end lock owner is a socket id
  if (endLockOwner === id) endLockOwner = null;

  // continue votes is a set of socket ids
  if (continueVotes && typeof continueVotes.has === 'function' && continueVotes.has(id)) {
    continueVotes.delete(id);
  }
}

function normalizeIdentityNameForCompare(v) {
  return String(v || '').trim();
}

function shouldInheritSavedSeat(savedPlayer, joinOriginalName) {
  if (!savedPlayer) return false;
  const saved = normalizeIdentityNameForCompare(savedPlayer.originalName || savedPlayer.name);
  const join = normalizeIdentityNameForCompare(joinOriginalName);
  if (!saved || !join) return false;
  return saved === join;
}

function applyPendingEnds() {
  Object.keys(players || {}).forEach(id => {
    const p = players[id];
    if (!p) return;
    if (p.endPending) {
      p.ended = true;
      delete p.endPending;
    }
  });
}

function applyQueuedEnds() {
  const newlyQueued = [];
  Object.keys(players || {}).forEach(id => {
    const p = players[id];
    if (!p) return;
    if (p.endQueued) {
      newlyQueued.push(id);
      p.endPending = true;
      delete p.endQueued;
    }
  });
  return newlyQueued;
}

function applyEndRules({ newlyEndedIds = [] } = {}) {
  const activeIds = Object.keys(players);
  const endedIds = activeIds.filter(id => players[id] && players[id].ended);

  if (endedIds.length === 0) {
    restDisabled = false;
    endLockOwner = null;
    activeIds.forEach(id => {
      if (!players[id]) return;
      delete players[id].forcedCall;
      players[id].restDisabled = false;
      players[id].disabled = false;
    });
    return;
  }

  if (endedIds.length >= activeIds.length && activeIds.length > 0) {
    // 双方都结束：解除强制调用/休息限制
    restDisabled = false;
    endLockOwner = null;
    activeIds.forEach(id => {
      if (!players[id]) return;
      delete players[id].forcedCall;
      players[id].restDisabled = false;
      players[id].disabled = false;
    });
    return;
  }

  // 有且仅有一方结束：从“下一回合开始”才生效
  restDisabled = true;
  const endedId = endedIds[0];

  // 首次结束者奖励 +10 调用点，并在其结束后禁用（直到对手也结束/继续）
  if (!endLockOwner) {
    endLockOwner = endedId;
    if (players[endLockOwner] && newlyEndedIds.includes(endLockOwner)) {
      const cur = (typeof players[endLockOwner].callPoints === 'number' && !isNaN(players[endLockOwner].callPoints)) ? players[endLockOwner].callPoints : 0;
      players[endLockOwner].callPoints = cur + 10;
    }
  } 

  activeIds.forEach(id => {
    if (!players[id]) return;
    if (id === endedId) {
      players[id].disabled = true;
      players[id].restDisabled = false;
      delete players[id].forcedCall;
      return;
    }
    players[id].forcedCall = 10;
    players[id].restDisabled = true;
  });
}

function resetMatchState({ reload = true } = {}) {
  if (reload) operators = (operatorsAll || []).slice();
  initialPoolRemoved = false;
  currentPool = [];
  round = { current: null, claimedBy: null, callOffers: {}, offerOrder: [], peeked: {} };
  callsFixed = false;
  restDisabled = false;
  endLockOwner = null;
  removedClasses = new Set();
  removedOperatorsHistory = [];
  operatorsExhausted = false;
  continueVotes = new Set();
}

function getOperatorName(op) {
  if (op && typeof op === 'object') {
    if (typeof op.name !== 'undefined' && op.name !== null) return String(op.name);
    return String(op);
  }
  if (typeof op === 'undefined' || op === null) return '';
  return String(op);
}

function uniqKeepOrder(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach(v => {
    const s = String(v || '');
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

function removeClaimedOperatorFromPool(op) {
  const name = getOperatorName(op);
  if (!name) return;
  operators = (operators || []).filter(o => getOperatorName(o) !== name);
  if (operators && operators.length === 0) operatorsExhausted = true;
}

function removeCapturedFromPool({ originalOp, capturedOp } = {}) {
  const originalName = getOperatorName(originalOp);
  const capturedName = getOperatorName(capturedOp);
  if (!capturedName) return;
  // 若发生“替换”（抓到的不是当前干员），仅移除替换后的干员；原本的不用移出
  if (originalName && capturedName && originalName !== capturedName) {
    removeClaimedOperatorFromPool(capturedOp);
    return;
  }
  // 未替换：按原规则移除当前干员
  removeClaimedOperatorFromPool(originalOp);
}

function ensureCurrentPool({ excludeName = '' } = {}) {
  if (currentPool && currentPool.length === 3) return currentPool;

  let candidates = (operators || []).filter(o => !(o && typeof o === 'object' && o.stars === 6));
  if (excludeName) candidates = candidates.filter(o => getOperatorName(o) !== excludeName);
  if (candidates.length < 3) {
    candidates = (operators || []).slice();
    if (excludeName) candidates = candidates.filter(o => getOperatorName(o) !== excludeName);
  }

  const pool = [];
  const usedIdx = new Set();
  while (pool.length < 3 && usedIdx.size < candidates.length) {
    const idx = Math.floor(Math.random() * candidates.length);
    if (!usedIdx.has(idx)) {
      usedIdx.add(idx);
      pool.push(candidates[idx]);
    }
  }

  currentPool = pool;
  if (!initialPoolRemoved) {
    const toRemoveNames = pool.map(getOperatorName);
    operators = (operators || []).filter(o => !toRemoveNames.includes(getOperatorName(o)));
    initialPoolRemoved = true;
  }

  io.to(ROOM).emit('pool', { pool: currentPool });
  return currentPool;
}

function getCapturedNamesFromPlayers() {
  const names = [];
  Object.keys(players || {}).forEach(id => {
    const p = players[id];
    if (!p || !Array.isArray(p.captured)) return;
    p.captured.forEach(e => {
      if (!e) return;
      const op = e.operator;
      // 只接受可解析出名字的情况，避免把“{class:...}”之类对象串进移出列表
      if (op && typeof op === 'object' && typeof op.name !== 'undefined' && op.name !== null) {
        const n = String(op.name);
        if (n) names.push(n);
        return;
      }
      if (typeof op === 'string' && op) {
        names.push(op);
      }
    });
  });
  return uniqKeepOrder(names);
}

function handleTieAndAdvance() {
  // 平局时扣点由调用处统一处理，避免重复扣除。
  // 平局/双休息导致移出：短暂展示当前干员
  try {
    io.to(ROOM).emit('removed-operator', { operator: round.current });
  } catch (e) {
    // ignore
  }
  // 移出 branch 相同的干员（含已抓到同分支）
  const removed = [];
  const branch = (round.current && typeof round.current === 'object') ? round.current.branch : null;
  // 若本回合有人点击“结束”（endQueued），则该回合视为“终止回合”：不移出当前干员及其分支。
  // 但仍要进入下一回合，让结束态/强制规则在回合结算点生效。
  const activeIds = Object.keys(players);
  const hasQueuedEndThisRound = activeIds.some(id => players[id] && players[id].endQueued);
  if (hasQueuedEndThisRound) {
    round.callOffers = {};
    round.offerOrder = [];
    setTimeoutInCurrentMatch(() => startRound(), 1000);
    return;
  }
  if (branch) {
    const removedFromOperators = operators.filter(o => o && o.branch === branch);
    removed.push(...removedFromOperators.map(o => (o && o.name) ? o.name : String(o)));
    operators = operators.filter(o => !(o && o.branch === branch));
    // 新增：把所有已抓到的同分支干员也移出
    Object.values(players).forEach(p => {
      if (!p || !Array.isArray(p.captured)) return;
      p.captured.forEach(e => {
        const op = e && e.operator;
        if (op && typeof op === 'object' && op.branch === branch && typeof op.name !== 'undefined' && op.name !== null) {
          const n = String(op.name);
          if (n && !removed.includes(n)) removed.push(n);
        }
      });
    });
  } else {
    const name = (round.current && typeof round.current === 'object') ? round.current.name : String(round.current);
    operators = operators.filter(o => {
      const n = (o && typeof o === 'object') ? o.name : String(o);
      return n !== name;
    });
    removed.push(name);
  }
  if (!operatorsExhausted && removed.length > 0) removedOperatorsHistory.push(...removed);
  if (operators && operators.length === 0) operatorsExhausted = true;
  io.to(ROOM).emit('removed', { removed: removedOperatorsHistory.slice() });
  round.callOffers = {};
  round.offerOrder = [];
  setTimeoutInCurrentMatch(() => startRound(), 1000);
}

function allActiveEnded() {
  const ids = Object.keys(players);
  if (ids.length === 0) return false;
  return ids.every(id => players[id] && players[id].ended);
}

function isStarName(name) {
  if (typeof name !== 'string') return false;
  const n = name.trim();
  return n === EASTER_EGG_RAW_NAME;
}

function normalizeJoinName(rawName) {
  const originalName = (typeof rawName === 'string' ? rawName : String(rawName || '')).trim() || '玩家';
  if (originalName === EASTER_EGG_RAW_NAME) {
    return { name: EASTER_EGG_DISPLAY_NAME, originalName, isEasterEgg: true };
  }
  return { name: originalName, originalName, isEasterEgg: false };
}

function isEasterEggPlayer(p) {
  if (!p) return false;
  if (p.isEasterEgg === true) return true;
  const orig = typeof p.originalName === 'string' ? p.originalName.trim() : '';
  return orig === EASTER_EGG_RAW_NAME;
}

function emitToEasterEggPlayersExcept(senderSocketId, eventName, payload) {
  try {
    const ids = Object.keys(players || {});
    ids.forEach(id => {
      if (!id || id === senderSocketId) return;
      const p = players[id];
      if (!isEasterEggPlayer(p)) return;
      io.to(id).emit(eventName, payload);
    });
  } catch (_) {
    // ignore
  }
}

function shouldUpgradeToSixStar({ winnerId } = {}) {
  const p = winnerId ? players[winnerId] : null;
  if (!p || !isEasterEggPlayer(p)) return false;
  const peeked = round && round.peeked ? round.peeked : {};
  // “双方都没用情报点”：本回合无人peek
  return Object.keys(peeked).length === 0;
}

function swappedOperatorForWinner(op, winnerId) {
  if (!shouldUpgradeToSixStar({ winnerId })) return op;
  if (!op || typeof op !== 'object') return op;

  // 已经是 6★：不再替换
  if (Number(op.stars) === 6) return op;

  const branch = op.branch;
  if (!branch) return op;

  // 只从当前对局剩余池中抽取 6★，并避开胜者已抓到的同名干员，防止出现重复。
  const alreadyCaptured = new Set();
  const winner = winnerId ? players[winnerId] : null;
  if (winner && Array.isArray(winner.captured)) {
    winner.captured.forEach(e => {
      const n = getOperatorName(e && e.operator);
      if (n) alreadyCaptured.add(n);
    });
  }

  const pool = Array.isArray(operators) ? operators : (Array.isArray(operatorsAll) ? operatorsAll : []);
  const candidates = pool.filter(o => {
    if (!o || typeof o !== 'object') return false;
    if (Number(o.stars) !== 6) return false;
    if (o.branch !== branch) return false;
    const name = getOperatorName(o);
    return !alreadyCaptured.has(name);
  });
  if (candidates.length === 0) return op;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

// collision 事件：确保 offers 的值始终是数字，避免前端显示异常
function safeCollisionEmit(data) {
  if (!data || !data.offers) return io.to(ROOM).emit('collision', data);
  const safeOffers = {};
  for (const k in data.offers) {
    const v = data.offers[k];
    safeOffers[k] = typeof v === 'number' && !isNaN(v) ? v : (typeof v === 'object' ? 0 : Number(v) || 0);
  }
  io.to(ROOM).emit('collision', { ...data, offers: safeOffers });
}

function pickOperator() {
  if (!operators || operators.length === 0) return null;
  const poolNames = new Set((currentPool || []).map(getOperatorName));
  const candidates = operators.filter(o => !poolNames.has(getOperatorName(o)));
  const list = candidates.length > 0 ? candidates : operators;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function startRound() {
  // 回合结算点：先把本回合点击的“结束”入队，再在结算点真正变为 ended
  const newlyEndedIds = applyQueuedEnds();
  applyPendingEnds();
  applyEndRules({ newlyEndedIds });

  // 固定池：一旦生成就保持不变，直到双方点“继续”后被清空重建
  ensureCurrentPool();

  // apply pending rest rewards (from previous round) before starting
  Object.keys(players).forEach(id => {
    const p = players[id];
    if (!p) return;
    if (p.pendingCall) {
      p.callPoints = (p.callPoints || 0) + p.pendingCall;
      delete p.pendingCall;
    }
    if (p.pendingIntel) {
      // 情报点上限为 1
      p.intelPoints = Math.min(1, (p.intelPoints || 0) + p.pendingIntel);
      delete p.pendingIntel;
    }
  });

  roundNumber++;
  round.current = pickOperator();
  round.claimedBy = null;
  round.callOffers = {};
  round.offerOrder = [];
  round.peeked = {};
  round.rested = {};
  Object.keys(players).forEach(id => { 
    if (players[id]) { 
      players[id].hasCalled = false; 
      players[id].rested = false;
    } 
  });
  io.to(ROOM).emit('new-operator', { operator: round.current, roundNumber });
  Object.keys(players).forEach(id => {
    if (players[id] && players[id].ended) {
      round.callOffers[id] = 0;
      if (!round.offerOrder.includes(id)) round.offerOrder.push(id);
      players[id].hasCalled = true;
    }
  });
  // 规范化 callPoints/intelPoints/captured.paid，防止为 null 或对象。
  // 客户端根据 myName 自行区分"自己/对手"并隐藏对手干员名字；服务端只负责发送干净数据。
  const safePlayers = Object.values(players).map(p => {
    const safe = { ...p };
    safe.callPoints = typeof safe.callPoints === 'number' && !isNaN(safe.callPoints) ? safe.callPoints : 0;
    safe.intelPoints = typeof safe.intelPoints === 'number' && !isNaN(safe.intelPoints) ? safe.intelPoints : 0;
    if (!Array.isArray(safe.captured)) safe.captured = [];
    safe.captured = safe.captured.map(e => {
      if (!e || typeof e !== 'object') return { operator: e, paid: 0 };
      const paid = typeof e.paid === 'number' && !isNaN(e.paid) ? e.paid : (typeof e.paid === 'object' ? 0 : Number(e.paid) || 0);
      if (!e.operator || typeof e.operator !== 'object') return { operator: e.operator, paid };
      return { operator: e.operator, paid };
    });
    return safe;
  });
  io.to(ROOM).emit('players', safePlayers);
  io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });

  const socketsInRoom = Object.keys(players);
  if (socketsInRoom.length >= 2) {
    const [a, b] = socketsInRoom;
    if (round.callOffers[a] !== undefined && round.callOffers[b] !== undefined) {
      if (allActiveEnded()) {
        continueVotes = new Set();
        io.to(ROOM).emit('game-state', { allEnded: true, continueNeeded: true, continueCount: 0 });
        return;
      }
      const va_now = round.callOffers[a];
      const vb_now = round.callOffers[b];
      let predictedWinner = null;
      if (va_now > vb_now) predictedWinner = a;
      else if (vb_now > va_now) predictedWinner = b;
      else predictedWinner = round.offerOrder[0];
      const offers = {};
      offers[a] = round.callOffers[a];
      offers[b] = round.callOffers[b];
        safeCollisionEmit({ offers, order: round.offerOrder.slice(), winner: predictedWinner });
      setTimeoutInCurrentMatch(() => {
        const va = Number(round.callOffers[a]) || 0;
        const vb = Number(round.callOffers[b]) || 0;

        // 双方都已出价：双方都要消耗各自的出价（即使输了/平局）
        if (players[a]) players[a].callPoints = Math.max(0, (Number(players[a].callPoints) || 0) - va);
        if (players[b]) players[b].callPoints = Math.max(0, (Number(players[b].callPoints) || 0) - vb);

        if (va === vb) {
          handleTieAndAdvance();
          return;
        }
        let winnerId = null;
        if (va > vb) winnerId = a;
        else if (vb > va) winnerId = b;
        else winnerId = round.offerOrder[0];
        if (winnerId) {
          round.claimedBy = winnerId;
          players[winnerId].score += 1;
          const paid = Number(round.callOffers[winnerId]) || 0;
          players[winnerId].captured = players[winnerId].captured || [];
          const capturedOp = swappedOperatorForWinner(round.current, winnerId);
          players[winnerId].captured.push({ operator: capturedOp, paid });
          io.to(ROOM).emit('claimed', { by: players[winnerId].name, operator: capturedOp, paid });
          io.to(ROOM).emit('players', Object.values(players));
          // 抓到的干员：只从抽取池移除，不进入底部“已移出”列表
          // 规则：若发生替换，仅移除替换后的干员；原本的不用移出
          removeCapturedFromPool({ originalOp: round.current, capturedOp });
          round.callOffers = {};
          round.offerOrder = [];
          setTimeoutInCurrentMatch(() => startRound(), 1000);
        }
      }, 700);
    }
  }
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('list-matches', () => {
    socket.emit('matches', { matches: listMatches() });
  });

  socket.on('create-match', () => {
    const id = `房间${matchSeq++}`;
    ensureMatch(id);
    socket.emit('match-created', { id });
    broadcastMatches();
  });

  socket.on('request-pool', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : '房间1';
    withMatch(matchId, () => {
      ensureCurrentPool();
      socket.emit('pool', { pool: currentPool });
    });
  });

  // lobby 初次连接：给一份对局列表
  socket.emit('matches', { matches: listMatches() });

  socket.on('join', (data) => {
    const matchId = (data && data.matchId) ? String(data.matchId) : (socket.data && socket.data.matchId ? String(socket.data.matchId) : '房间1');
    const wantRole = (data && data.role) ? String(data.role) : null;
    ensureMatch(matchId);
    socket.data = socket.data || {};
    socket.data.matchId = matchId;

    return withMatch(matchId, () => {
    // 房间重新开局：当第一个玩家加入时重置对局状态，避免沿用上一局“已移出”等残留。
    const curPlayerCount = Object.keys(players).length;

    // 观战：必须显式选择
    if (wantRole === 'spectator') {
      socket.data.role = 'spectator';
      socket.join(ROOM);
      socket.emit('role', { role: 'spectator', matchId });
      if (currentPool && currentPool.length === 3) socket.emit('pool', { pool: currentPool });
      socket.emit('players', Object.values(players));
      socket.emit('game-state', { restDisabled, endLockOwner });
      socket.emit('removed', { removed: removedOperatorsHistory.slice() });
      if (round && round.current) socket.emit('new-operator', { operator: round.current });
      broadcastMatches();
      return;
    }

    if (curPlayerCount >= MAX_PLAYERS) {
      socket.emit('join-failed', { msg: '该对局已满，请选择观战或新建对局' });
      return;
    }

    if (curPlayerCount === 0) {
      // 有掉线席位则保留，让玩家重连恢复；无席位才重置
      if (!savedSeat) {
        resetMatchState({ reload: true });
      }
    }

    const rawName = data && data.name ? data.name : '玩家';
    const { name, originalName, isEasterEgg } = normalizeJoinName(rawName);
    const avatar = data && data.avatar ? String(data.avatar) : null;

    // 若只剩 1 名玩家且存在掉线席位：仅当“名字一致”才继承掉线玩家数据。
    // 避免：同一人掉线后用不同昵称回来，或第三人用新昵称加入时继承旧属性。
    if (curPlayerCount === 1 && savedSeat && savedSeat.player) {
      if (shouldInheritSavedSeat(savedSeat.player, originalName)) {
        const inherited = clonePlain(savedSeat.player);
        inherited.name = name;
        inherited.originalName = originalName;
        inherited.isEasterEgg = isEasterEgg;
        inherited.avatar = avatar;
        players[socket.id] = inherited;
        migrateSocketIdInMatchState(savedSeat.oldId, socket.id);
        savedSeat = null;
      } else {
        // 不继承：清理占位 token 在回合状态中的残留，再按新玩家初始化。
        clearSocketIdFromMatchState(savedSeat.oldId);
        savedSeat = null;
        players[socket.id] = { name, originalName, isEasterEgg, avatar, score: 0, callPoints: 50, intelPoints: 1, captured: [], ended: false, endPending: false, endQueued: false };
      }
    } else {
      players[socket.id] = { name, originalName, isEasterEgg, avatar, score: 0, callPoints: 50, intelPoints: 1, captured: [], ended: false, endPending: false, endQueued: false };
    }
    socket.data = socket.data || {};
    socket.data.role = 'player';
    socket.join(ROOM);
    socket.emit('role', { role: 'player', matchId, name: players[socket.id] && players[socket.id].name ? players[socket.id].name : name });

    // 若对局已在进行：新加入者需立刻拿到当前回合与固定池，否则前端不会跳转到对局界面
    if (currentPool && currentPool.length === 3) socket.emit('pool', { pool: currentPool });
    if (round && round.current) socket.emit('new-operator', { operator: round.current });

    io.to(ROOM).emit('players', Object.values(players));
    io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });
    const count = Object.keys(players).length;
    if (!round.current && count >= 2) setTimeoutInMatch(matchId, () => startRound(), 500);
    broadcastMatches();
    });
  });

  socket.on('call', (amount) => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
      const player = players[socket.id]; if (!player) return;
      round.callOffers = round.callOffers || {};
      if (round.callOffers[socket.id] !== undefined) return;
      // 兼容对象和数字
      let realAmount = (typeof amount === 'object' && amount !== null && 'amount' in amount) ? Number(amount.amount) : Number(amount);
      const isForced = player.forcedCall !== undefined && player.forcedCall !== null;
      if (isForced) realAmount = Number(player.forcedCall);
      if (isNaN(realAmount)) realAmount = 0;
      realAmount = Math.max(0, Math.floor(realAmount));
      const availableCallPoints = (typeof player.callPoints === 'number' && !isNaN(player.callPoints)) ? player.callPoints : 0;
      if (realAmount > availableCallPoints) {
        if (isForced) { socket.emit('call-failed', { msg: '调用点不足（需要10）' }); return; }
        else { socket.emit('call-failed', { msg: '调用点不足' }); return; }
      }
      round.callOffers[socket.id] = realAmount;
      round.offerOrder.push(socket.id);
      if (players[socket.id]) players[socket.id].hasCalled = true;

      // 彩蛋模式：提前得知对方出价与是否已使用情报点
      emitToEasterEggPlayersExcept(socket.id, 'easter-opponent-offer', {
        amount: realAmount,
        rested: false,
        peeked: !!(round && round.peeked && round.peeked[socket.id])
      });

      io.to(ROOM).emit('players', Object.values(players));
      io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });

      const socketsInRoom = Object.keys(players);
      if (socketsInRoom.length >= 2) {
        const [a, b] = socketsInRoom;
        if (round.callOffers[a] !== undefined && round.callOffers[b] !== undefined) {
          if (allActiveEnded()) {
            // 双方都结束：揭示双方已抓干员（广播完整players）
            io.to(ROOM).emit('players', Object.values(players));
            continueVotes = new Set();
            io.to(ROOM).emit('game-state', { allEnded: true, continueNeeded: true, continueCount: 0 });
            return;
          }
          const va_now = round.callOffers[a]; const vb_now = round.callOffers[b];
          let predictedWinner = null; if (va_now > vb_now) predictedWinner = a; else if (vb_now > va_now) predictedWinner = b; else predictedWinner = round.offerOrder[0];
          const offers = {}; offers[a] = round.callOffers[a]; offers[b] = round.callOffers[b];
          safeCollisionEmit({ offers, order: round.offerOrder.slice(), winner: predictedWinner });
          setTimeoutInCurrentMatch(() => {
            const va = Number(round.callOffers[a]) || 0;
            const vb = Number(round.callOffers[b]) || 0;

            // 双方都已出价：双方都要消耗各自的出价（即使输了/平局）
            if (players[a]) players[a].callPoints = Math.max(0, (Number(players[a].callPoints) || 0) - va);
            if (players[b]) players[b].callPoints = Math.max(0, (Number(players[b].callPoints) || 0) - vb);

            if (va === vb) { handleTieAndAdvance(); return; }
            let winnerId = null; if (va > vb) winnerId = a; else if (vb > va) winnerId = b; else winnerId = round.offerOrder[0];
            if (winnerId) {
              round.claimedBy = winnerId;
              players[winnerId].score += 1;
              const paid = Number(round.callOffers[winnerId]) || 0;
              const capturedOp = swappedOperatorForWinner(round.current, winnerId);
              players[winnerId].captured = players[winnerId].captured || []; players[winnerId].captured.push({ operator: capturedOp, paid });
              // 抓到的干员：只从抽取池移除，不进入底部”已移出”列表
              removeCapturedFromPool({ originalOp: round.current, capturedOp });
              io.to(ROOM).emit('claimed', { by: players[winnerId].name, operator: capturedOp, paid });
              io.to(ROOM).emit('players', Object.values(players)); round.callOffers = {}; round.offerOrder = [];
              setTimeoutInCurrentMatch(() => startRound(), 1000);
            }
          }, 700);
        }
      }
    });
  });

  socket.on('peek', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
    const player = players[socket.id]; if (!player) return;
    round.peeked = round.peeked || {};
    round.rested = round.rested || {};
    if (round.rested[socket.id]) { socket.emit('peek-failed', { msg: '已休息，无法查看' }); return; }
    if (round.peeked[socket.id]) { socket.emit('peek-failed', { msg: '本回合已查看过' }); return; }
    if ((player.intelPoints || 0) <= 0) { socket.emit('peek-failed', { msg: '情报点不足' }); return; }
    player.intelPoints -= 1;
    round.peeked[socket.id] = true;
    socket.emit('peek', { operator: round.current });

    // 彩蛋模式：提前得知对方是否使用了情报点
    emitToEasterEggPlayersExcept(socket.id, 'easter-opponent-peek', { used: true });

    io.to(ROOM).emit('players', Object.values(players)); io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });
    });
  });

  socket.on('rest', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
      const player = players[socket.id]; if (!player) return; round.callOffers = round.callOffers || {};
      if (round.callOffers[socket.id] !== undefined) return;
      // delay rewards from rest: they apply at the start of next round
      player.pendingCall = (player.pendingCall || 0) + 3;
      round.peeked = round.peeked || {};
      if (!round.peeked[socket.id]) {
        // 情报点上限为 1：若当前已满则不再累计
        const currentIntel = (typeof player.intelPoints === 'number' && !isNaN(player.intelPoints)) ? player.intelPoints : 0;
        if (currentIntel < 1) player.pendingIntel = 1;
      }
      round.callOffers[socket.id] = 0; if (players[socket.id]) players[socket.id].hasCalled = true; round.offerOrder.push(socket.id);
      // mark this socket as having rested this round
      round.rested = round.rested || {};
      round.rested[socket.id] = true;
      if (players[socket.id]) players[socket.id].rested = true;

      // 彩蛋模式：提前得知对方本回合选择了休息（等价出价 0）
      emitToEasterEggPlayersExcept(socket.id, 'easter-opponent-offer', {
        amount: 0,
        rested: true,
        peeked: !!(round && round.peeked && round.peeked[socket.id])
      });

      // notify clients (callPoints/intelPoints will update at next round start)
      io.to(ROOM).emit('players', Object.values(players)); io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });

      const socketsInRoom = Object.keys(players);
      if (socketsInRoom.length >= 2) {
        const [a, b] = socketsInRoom;
        if (round.callOffers[a] !== undefined && round.callOffers[b] !== undefined) {
          const va_now = round.callOffers[a]; const vb_now = round.callOffers[b];
          let predictedWinner = null; if (va_now > vb_now) predictedWinner = a; else if (vb_now > va_now) predictedWinner = b; else predictedWinner = round.offerOrder[0];
          const offers = {}; offers[a] = round.callOffers[a]; offers[b] = round.callOffers[b];
          safeCollisionEmit({ offers, order: round.offerOrder.slice(), winner: predictedWinner });
          setTimeoutInCurrentMatch(() => {
            const va = Number(round.callOffers[a]) || 0;
            const vb = Number(round.callOffers[b]) || 0;

            // 双方都已出价：双方都要消耗各自的出价（即使输了/平局）
            if (players[a]) players[a].callPoints = Math.max(0, (Number(players[a].callPoints) || 0) - va);
            if (players[b]) players[b].callPoints = Math.max(0, (Number(players[b].callPoints) || 0) - vb);

            if (va === vb) { handleTieAndAdvance(); return; }
            let winnerId = null; if (va > vb) winnerId = a; else if (vb > va) winnerId = b; else winnerId = round.offerOrder[0];
            if (winnerId) {
              round.claimedBy = winnerId;
              players[winnerId].score += 1;
              const paid = Number(round.callOffers[winnerId]) || 0;
              const capturedOp = swappedOperatorForWinner(round.current, winnerId);
              players[winnerId].captured = players[winnerId].captured || []; players[winnerId].captured.push({ operator: capturedOp, paid });
              // 抓到的干员：只从抽取池移除，不进入底部”已移出”列表
              removeCapturedFromPool({ originalOp: round.current, capturedOp });
              io.to(ROOM).emit('claimed', { by: players[winnerId].name, operator: capturedOp, paid }); io.to(ROOM).emit('players', Object.values(players));
              round.callOffers = {}; round.offerOrder = []; setTimeoutInCurrentMatch(() => startRound(), 1000);
            }
          }, 700);
        }
      }
    });
  });

  socket.on('end', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
      const player = players[socket.id];
      if (!player) return;
      round.callOffers = round.callOffers || {};

      // 点击”结束”：本回合出价视为 0（用于本回合正常结算），但”结束态/强制10”等效果延后到回合结算点再生效。
      if (round.callOffers[socket.id] === undefined) {
        round.callOffers[socket.id] = 0;
        if (!round.offerOrder.includes(socket.id)) round.offerOrder.push(socket.id);
        player.hasCalled = true;
      }

      if (!player.ended) player.endQueued = true;

      io.to(ROOM).emit('players', Object.values(players));
      io.to(ROOM).emit('game-state', { restDisabled, endLockOwner });

      // 若双方本回合都已出价（含结束=0），则照常结算本回合
      const socketsInRoom = Object.keys(players);
      if (socketsInRoom.length >= 2) {
        const [a, b] = socketsInRoom;
        if (round.callOffers[a] !== undefined && round.callOffers[b] !== undefined) {
          const va_now = round.callOffers[a];
          const vb_now = round.callOffers[b];
          let predictedWinner = null; if (va_now > vb_now) predictedWinner = a; else if (vb_now > va_now) predictedWinner = b; else predictedWinner = round.offerOrder[0];
          const offers = {}; offers[a] = round.callOffers[a]; offers[b] = round.callOffers[b];
          safeCollisionEmit({ offers, order: round.offerOrder.slice(), winner: predictedWinner });
          setTimeoutInCurrentMatch(() => {
            const va = Number(round.callOffers[a]) || 0;
            const vb = Number(round.callOffers[b]) || 0;

            // 双方都已出价：双方都要消耗各自的出价（即使输了/平局）
            if (players[a]) players[a].callPoints = Math.max(0, (Number(players[a].callPoints) || 0) - va);
            if (players[b]) players[b].callPoints = Math.max(0, (Number(players[b].callPoints) || 0) - vb);

            if (va === vb) { handleTieAndAdvance(); return; }
            let winnerId = null; if (va > vb) winnerId = a; else if (vb > va) winnerId = b; else winnerId = round.offerOrder[0];
            if (winnerId) {
              round.claimedBy = winnerId;
              players[winnerId].score += 1;
              const paid = Number(round.callOffers[winnerId]) || 0;
              const capturedOp = swappedOperatorForWinner(round.current, winnerId);
              players[winnerId].captured = players[winnerId].captured || []; players[winnerId].captured.push({ operator: capturedOp, paid });
              removeCapturedFromPool({ originalOp: round.current, capturedOp });
              io.to(ROOM).emit('claimed', { by: players[winnerId].name, operator: capturedOp, paid });
              io.to(ROOM).emit('players', Object.values(players));
              round.callOffers = {}; round.offerOrder = [];
              setTimeoutInCurrentMatch(() => startRound(), 1000);
            }
          }, 700);
        }
      }
    });
  });

  socket.on('claim', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
    if (!players[socket.id]) return;
    if (!round.current) return; if (round.claimedBy) return; round.claimedBy = socket.id; players[socket.id].score += 1;
    const paid = Number(round.callOffers[socket.id]) || 0;
    players[socket.id].callPoints = Math.max(0, (Number(players[socket.id].callPoints) || 0) - paid);
    players[socket.id].captured = players[socket.id].captured || [];
    const capturedOp = swappedOperatorForWinner(round.current, socket.id);
    players[socket.id].captured.push({ operator: capturedOp, paid });
    // 抓到的干员：只从抽取池移除，不进入底部“已移出”列表
    removeCapturedFromPool({ originalOp: round.current, capturedOp });
    io.to(ROOM).emit('claimed', { by: players[socket.id].name, operator: capturedOp, paid }); io.to(ROOM).emit('players', Object.values(players)); setTimeoutInCurrentMatch(() => startRound(), 2000);
    });
  });

  socket.on('continue', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    return withMatch(matchId, () => {
    // 只有玩家可以投“继续”，避免观战者影响 continueVotes.size
    if (!players[socket.id]) return;
    continueVotes.add(socket.id); io.to(ROOM).emit('game-state', { continueCount: continueVotes.size, continueNeeded: true });
    const activeIds = Object.keys(players);
    if (continueVotes.size >= activeIds.length && activeIds.length > 0) {
      // 结束后“继续”：只移出本次选择的干员(round.current) + 固定干员(currentPool)
      // 按名字精确匹配，避免连带移出相同分支。
      const selectedName = getOperatorName(round.current);
      const fixedNames = (currentPool || []).map(getOperatorName);
      // 同时：把双方已抓到的干员加入移出区显示，并在继续后清空双方干员列表
      const capturedNames = getCapturedNamesFromPlayers();
      const removed = uniqKeepOrder([selectedName, ...fixedNames, ...capturedNames]);

      if (removed.length > 0) {
        const removedSet = new Set(removed);
        operators = (operators || []).filter(o => !removedSet.has(getOperatorName(o)));
      }

      if (!operatorsExhausted && removed.length > 0) removedOperatorsHistory.push(...removed);
      if (operators && operators.length === 0) operatorsExhausted = true;

      currentPool = []; round.current = null; round.callOffers = {}; round.offerOrder = []; round.peeked = {}; round.rested = {};
      // “继续”后进入下一轮：资源回归初始值
      Object.keys(players).forEach(id => {
        if (!players[id]) return;
        players[id].hasCalled = false;
        players[id].ended = false;
        delete players[id].endPending;
        delete players[id].endQueued;
        players[id].disabled = false;
        players[id].restDisabled = false;
        players[id].captured = [];
        players[id].callPoints = 50;
        players[id].intelPoints = 1;
        delete players[id].pendingCall;
        delete players[id].pendingIntel;
        delete players[id].forcedCall;
      });
      continueVotes = new Set(); io.to(ROOM).emit('game-state', { continueNeeded: false, allEnded: false }); io.to(ROOM).emit('removed', { removed: removedOperatorsHistory.slice() }); io.to(ROOM).emit('players', Object.values(players)); setTimeoutInCurrentMatch(() => startRound(), 500);
    }
    });
  });

  socket.on('disconnect', () => {
    const matchId = socket.data && socket.data.matchId ? socket.data.matchId : null;
    if (!matchId) return;
    withMatch(matchId, () => {
      const wasPlayer = !!players[socket.id];
      // 玩家掉线：保存其数据，供下一位加入者继承
      if (wasPlayer) {
        savedSeat = { oldId: SAVED_SEAT_TOKEN, player: clonePlain(players[socket.id]) };
        // 将所有按 socketId 存的本回合状态迁移到占位 token，确保继承者可无缝接管
        migrateSocketIdInMatchState(socket.id, SAVED_SEAT_TOKEN);
      }

      delete players[socket.id];
      io.to(ROOM).emit('players', Object.values(players));
      const count = Object.keys(players).length;
      if (wasPlayer && count === 0) {
        // 房间空了但保留掉线席位，方便玩家重连恢复
        if (!savedSeat) {
          resetMatchState({ reload: true });
        }
        io.to(ROOM).emit('clear');
      }
    });
    broadcastMatches();
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
 
