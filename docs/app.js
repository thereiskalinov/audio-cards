'use strict';

/* ============ helpers ============ */
const $ = (id) => document.getElementById(id);
const SILENCE_SRC = 'assets/silence1.mp3';
const LS_SETTINGS = 'ac.settings.v1';
const LS_SELECTED = 'ac.selected.v1';
const AUDIO_CACHE = 'ac-audio-v1';
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const DEFAULTS = {
  mode: 'qa',
  pauseAfterQuestion: 5,
  gap: 1,
  repeat: 1,
  shuffle: false,
  speed: 1.25,
};

const state = {
  content: null,
  settings: { ...DEFAULTS },
  selected: new Set(),
  searchTerm: '',
  prepared: null,
  preparing: null,
  session: null,
  offline: { total: 0, done: 0, busy: false, checked: false },
  audioUnlocked: false,
  dragSeeking: false,
  swReloading: false,
};

const audio = $('audio');
let lastPositionPush = 0;
let toastTimer = null;

/* ============ utils ============ */
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (parsed[k] !== undefined) out[k] = parsed[k];
    }
    if (!SPEEDS.includes(out.speed)) out.speed = DEFAULTS.speed;
    return out;
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (e) {}
}

function saveSelection() {
  try {
    localStorage.setItem(LS_SELECTED, JSON.stringify([...state.selected]));
  } catch (e) {}
}

function restoreSelection() {
  const cards = state.content.cards;
  let ids = null;
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (raw) ids = JSON.parse(raw);
  } catch (e) {}
  if (Array.isArray(ids)) {
    const known = new Set(cards.map((c) => c.id));
    state.selected = new Set(ids.filter((id) => known.has(id)));
  } else {
    state.selected = new Set(cards.map((c) => c.id));
  }
}

function selectedCards() {
  return state.content ? state.content.cards.filter((c) => state.selected.has(c.id)) : [];
}

/* ============ audio cache ============ */
function absUrl(path) {
  return new URL(path, document.baseURI).href;
}

function stripId3(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
    const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
    const footer = (u8[5] & 0x10) ? 10 : 0;
    return buf.slice(10 + size + footer);
  }
  return buf;
}

async function getAudioBuffer(path) {
  const url = absUrl(path);
  const cache = await caches.open(AUDIO_CACHE);
  let res = await cache.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
    await cache.put(url, res.clone());
  }
  return stripId3(await res.arrayBuffer());
}

/* ============ content ============ */
async function loadContent() {
  const res = await fetch('./content/cards.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('content ' + res.status);
  const data = await res.json();
  if (!data || !Array.isArray(data.cards)) throw new Error('bad content');
  return data;
}

function allAudioSources() {
  const out = [];
  const seen = new Set();
  const push = (p) => { if (p && !seen.has(p)) { seen.add(p); out.push(p); } };
  for (const c of state.content.cards) { push(c.aq); push(c.aa); }
  push(SILENCE_SRC);
  return out;
}

/* ============ list ============ */
function renderList() {
  const list = $('list');
  const term = state.searchTerm.trim().toLowerCase();
  list.innerHTML = '';
  const cards = state.content.cards.filter((c) => {
    if (!term) return true;
    return ((c.q || '') + ' ' + (c.a || '') + ' ' + (c.title || '') + ' ' + (c.num || '')).toLowerCase().includes(term);
  });
  if (!cards.length) {
    list.innerHTML = '<div class="empty">Ничего не найдено</div>';
    return;
  }
  let lastSection = null;
  let fragment = document.createDocumentFragment();
  for (const card of cards) {
    if (card.section && card.section !== lastSection) {
      lastSection = card.section;
      const h = document.createElement('div');
      h.className = 'section-title';
      h.textContent = card.section;
      fragment.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'card-row' + (state.selected.has(card.id) ? ' selected' : '');
    row.dataset.id = card.id;
    const dur = (card.dq || 0) + (card.da || 0);
    row.innerHTML =
      '<div class="check"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<div class="card-main">' +
      '<div class="card-num">' + (card.num ? 'Вопрос ' + escapeHtml(card.num) : 'Карточка') + '</div>' +
      '<div class="card-title">' + escapeHtml(card.title || card.q || '') + '</div>' +
      '</div>' +
      '<div class="card-dur">' + (dur > 0 ? fmtTime(dur) : '') + '</div>';
    fragment.appendChild(row);
  }
  list.appendChild(fragment);
  updateLaunchBar();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function updateLaunchBar() {
  const n = selectedCards().length;
  $('sel-count').textContent = n + ' ' + plural(n, ['вопрос', 'вопроса', 'вопросов']);
  $('btn-start').disabled = n === 0;
  if (n === 0) setPrepStatus('');
}

function setPrepStatus(text) {
  $('prep-status').textContent = text || '';
}

/* ============ timeline & preparation ============ */
function buildTimeline(cards, settings, silenceDur) {
  const segs = [];
  const perCard = [];
  let t = 0;
  const pushSeg = (src, dur, cardIdx, part) => {
    const d = Math.max(0.05, dur || 0);
    segs.push({ src, start: t, end: t + d, cardIdx, part });
    t += d;
  };
  const silenceUnits = (sec) => Math.max(1, Math.round(sec / silenceDur));
  cards.forEach((card, idx) => {
    const cardStart = t;
    const reps = Math.max(1, Math.min(5, settings.repeat | 0));
    for (let rep = 0; rep < reps; rep++) {
      const hasAnswer = !!(card.aa && card.da > 0);
      if (card.aq && card.dq > 0) pushSeg(card.aq, card.dq, idx, 'q');
      else if (card.aa && card.da > 0 && !hasAnswer) pushSeg(card.aa, card.da, idx, 'a');
      if (hasAnswer) {
        if (settings.mode === 'qa' && settings.pauseAfterQuestion > 0) {
          const units = silenceUnits(settings.pauseAfterQuestion);
          for (let u = 0; u < units; u++) pushSeg(SILENCE_SRC, silenceDur, idx, 'pause');
        }
        pushSeg(card.aa, card.da, idx, 'a');
      }
      if (settings.gap > 0) {
        const units = silenceUnits(settings.gap);
        for (let u = 0; u < units; u++) pushSeg(SILENCE_SRC, silenceDur, idx, 'gap');
      }
    }
    perCard.push({ start: cardStart, end: t });
  });
  return { segs, perCard, duration: t };
}

function selectionKey() {
  const s = state.settings;
  const ids = selectedCards().map((c) => c.id).join(',');
  return [ids, s.mode, s.pauseAfterQuestion, s.gap, s.repeat, s.shuffle ? 1 : 0].join('|');
}

function schedulePrepare(delay = 500) {
  clearTimeout(state.prepareTimer);
  state.prepareTimer = setTimeout(() => { prepareNow().catch(() => {}); }, delay);
}

async function prepareNow() {
  if (state.preparing) return state.preparing;
  const cards = selectedCards();
  if (!cards.length) { state.prepared = null; setPrepStatus(''); return null; }
  const key = selectionKey();
  const settings = { ...state.settings };
  const silenceDur = state.content.silenceDur || 1.056;
  const queue = cards.slice();
  if (settings.shuffle) {
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
    }
  }
  state.preparing = (async () => {
    try {
      const timeline = buildTimeline(queue, settings, silenceDur);
      const sources = [];
      const seen = new Set();
      for (const seg of timeline.segs) {
        if (!seen.has(seg.src)) { seen.add(seg.src); sources.push(seg.src); }
      }
      const buffers = new Map();
      let done = 0;
      for (const src of sources) {
        buffers.set(src, await getAudioBuffer(src));
        done++;
        setPrepStatus('Готовим звук… ' + done + ' / ' + sources.length);
      }
      const parts = timeline.segs.map((seg) => buffers.get(seg.src));
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const old = state.prepared;
      if (old && old.url && audio.src !== old.url) URL.revokeObjectURL(old.url);
      state.prepared = { key, url, timeline, cards: queue, duration: timeline.duration };
      setPrepStatus('Готово · ' + fmtTime(timeline.duration));
      return state.prepared;
    } catch (e) {
      console.error(e);
      setPrepStatus('Не удалось подготовить звук');
      throw e;
    } finally {
      state.preparing = null;
    }
  })();
  return state.preparing;
}

/* ============ player ============ */
function openPlayer() {
  $('player').classList.remove('hidden');
}

function closePlayer() {
  audio.pause();
  $('player').classList.add('hidden');
}

function cardIndexAt(perCard, time) {
  for (let i = 0; i < perCard.length; i++) {
    if (time < perCard[i].end) return i;
  }
  return perCard.length - 1;
}

function renderSpeedChips() {
  const wrap = $('p-speed');
  wrap.innerHTML = '';
  SPEEDS.forEach((sp) => {
    const b = document.createElement('button');
    b.textContent = String(sp).replace('.', ',') + '×';
    if (Math.abs(sp - state.settings.speed) < 0.001) b.classList.add('active');
    b.addEventListener('click', () => setSpeed(sp));
    wrap.appendChild(b);
  });
}

function setSpeed(sp, silent) {
  state.settings.speed = sp;
  saveSettings();
  audio.playbackRate = sp;
  renderSpeedChips();
  $('s-speed').value = sp;
  $('s-speed-val').textContent = String(sp).replace('.', ',') + '×';
  if (!silent && state.session) {
    // keep player in sync
  }
}

function renderPlayerCard() {
  const s = state.session;
  if (!s) return;
  const card = s.cards[s.cardIndex];
  if (!card) return;
  $('p-count').textContent = (s.cardIndex + 1) + ' / ' + s.cards.length;
  $('p-num').textContent = card.num ? 'Вопрос ' + card.num : 'Карточка';
  $('p-title').textContent = card.title || '';
  $('p-q').textContent = card.q || '';
  const a = $('p-a');
  if (card.a) {
    a.textContent = card.a;
    a.classList.remove('hidden');
  } else {
    a.classList.add('hidden');
  }
  renderSpeedChips();
  updateMediaMetadata(card);
}

function updatePlayIcon() {
  const playing = !audio.paused;
  $('p-play-icon').innerHTML = playing
    ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

function updateMediaMetadata(card) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const s = state.session;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: card.title || (card.num ? 'Вопрос ' + card.num : 'Карточка'),
      artist: 'Карточка ' + (s.cardIndex + 1) + ' из ' + s.cards.length,
      album: state.content.title || 'Аудиокарточки',
      artwork: [{ src: absUrl('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
    });
  } catch (e) {}
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const safe = (name, fn) => { try { ms.setActionHandler(name, fn); } catch (e) {} };
  safe('play', () => { audio.play().catch(() => {}); });
  safe('pause', () => { audio.pause(); });
  safe('previoustrack', () => jumpCard(-1));
  safe('nexttrack', () => jumpCard(1));
  safe('seekbackward', () => seekBy(-10));
  safe('seekforward', () => seekBy(10));
}

function pushPositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const now = Date.now();
  if (now - lastPositionPush < 900) return;
  lastPositionPush = now;
  const s = state.session;
  const d = s ? s.duration : (audio.duration || 0);
  if (!isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      position: Math.max(0, Math.min(audio.currentTime || 0, d)),
      playbackRate: audio.playbackRate || 1,
    });
  } catch (e) {}
}

function onTimeUpdate() {
  const s = state.session;
  if (!s) return;
  const t = audio.currentTime || 0;
  const idx = cardIndexAt(s.timeline.perCard, t);
  if (idx !== s.cardIndex) {
    s.cardIndex = idx;
    renderPlayerCard();
  }
  const part = currentPart(t);
  $('p-part').textContent = part === 'a' ? 'ответ' : part === 'q' ? 'вопрос' : part === 'pause' ? 'пауза' : '';
  if (!state.dragSeeking && s.duration > 0) {
    $('p-seek').value = Math.round((t / s.duration) * 1000);
    $('p-cur').textContent = fmtTime(t);
  }
  pushPositionState();
}

function currentPart(t) {
  const s = state.session;
  const segs = s.timeline.segs;
  let lo = 0, hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < segs[mid].start) hi = mid - 1;
    else if (t >= segs[mid].end) lo = mid + 1;
    else return segs[mid].part;
  }
  return '';
}

function goToCard(i) {
  const s = state.session;
  if (!s) return;
  i = Math.max(0, Math.min(s.cards.length - 1, i));
  const start = s.timeline.perCard[i].start;
  try { audio.currentTime = start + 0.01; } catch (e) {}
  s.cardIndex = i;
  renderPlayerCard();
}

function jumpCard(delta) {
  const s = state.session;
  if (!s) return;
  if (delta < 0) {
    const start = s.timeline.perCard[s.cardIndex].start;
    if ((audio.currentTime || 0) - start > 2.5) { goToCard(s.cardIndex); return; }
  }
  goToCard(s.cardIndex + delta);
}

function seekBy(delta) {
  const s = state.session;
  if (!s) return;
  audio.currentTime = Math.max(0, Math.min(s.duration - 0.05, (audio.currentTime || 0) + delta));
}

async function startPlayback() {
  if (!state.content) return;
  const hasSelection = selectedCards().length > 0;
  if (!hasSelection) return;
  const key = selectionKey();
  let prepared = state.prepared && state.prepared.key === key ? state.prepared : null;

  if (!prepared) {
    unlockAudio();
    setPrepStatus('Готовим звук…');
    try { prepared = await prepareNow(); } catch (e) { toast('Не удалось подготовить звук'); return; }
  }
  if (!prepared) return;

  state.session = {
    timeline: prepared.timeline,
    cards: prepared.cards,
    cardIndex: 0,
    duration: prepared.duration,
    startedAt: Date.now(),
  };
  openPlayer();
  renderPlayerCard();
  $('p-dur').textContent = fmtTime(prepared.duration);
  $('p-cur').textContent = '0:00';
  $('p-seek').value = 0;

  state.unlocking = false;
  audio.pause();
  audio.volume = 1;
  audio.src = prepared.url;
  audio.playbackRate = state.settings.speed;
  try { audio.currentTime = 0; } catch (e) {}
  const p = audio.play();
  if (p && p.catch) {
    p.catch(() => {
      updatePlayIcon();
      toast('Нажмите ▶, чтобы начать');
    });
  }
  updatePlayIcon();
  setupMediaSession();
}

function unlockAudio() {
  if (state.audioUnlocked) return;
  state.audioUnlocked = true;
  state.unlocking = true;
  try {
    audio.src = SILENT_WAV;
    audio.volume = 0.001;
    const p = audio.play();
    if (p && p.then) {
      p.then(() => {
        if (state.unlocking) { audio.pause(); audio.volume = 1; }
      }).catch(() => { audio.volume = 1; });
    }
  } catch (e) {
    state.unlocking = false;
  }
}

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

/* ============ settings sheet ============ */
function syncSettingsUI() {
  const s = state.settings;
  $('s-mode').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === s.mode);
  });
  $('s-pause').value = s.pauseAfterQuestion;
  $('s-pause-val').textContent = s.pauseAfterQuestion + ' с';
  $('s-gap').value = s.gap;
  $('s-gap-val').textContent = s.gap + ' с';
  $('s-repeat').value = s.repeat;
  $('s-repeat-val').textContent = String(s.repeat);
  $('s-shuffle').checked = !!s.shuffle;
  $('s-speed').value = s.speed;
  $('s-speed-val').textContent = String(s.speed).replace('.', ',') + '×';
  const v = state.content && state.content.voice;
  $('s-voice').textContent = v || 'по умолчанию';
}

function openSettings() { $('settings').classList.remove('hidden'); }
function closeSettings() { $('settings').classList.add('hidden'); }

function settingsChanged() {
  saveSettings();
  syncSettingsUI();
  renderSpeedChips();
  if (state.session) audio.playbackRate = state.settings.speed;
  schedulePrepare(350);
  if (state.session) toast('Новые параметры применятся при следующем запуске');
}

/* ============ offline ============ */
async function countCached() {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const urls = allAudioSources();
    let done = 0;
    for (const u of urls) {
      const hit = await cache.match(absUrl(u));
      if (hit) done++;
    }
    return { total: urls.length, done };
  } catch (e) {
    return { total: 0, done: 0 };
  }
}

function updateOfflineUI() {
  const o = state.offline;
  const text = o.busy
    ? (o.done + ' / ' + o.total + '…')
    : (o.total > 0 && o.done >= o.total ? 'готова' : (o.done + ' / ' + o.total));
  $('s-offline').textContent = text;
}

async function probeOffline() {
  const r = await countCached();
  state.offline = { total: r.total, done: r.done, busy: false, checked: true };
  updateOfflineUI();
}

async function prefetchAudio(force) {
  if (!state.content || state.offline.busy) return;
  if (!navigator.onLine) return;
  const urls = allAudioSources();
  state.offline = { total: urls.length, done: 0, busy: true, checked: true };
  updateOfflineUI();
  const cache = await caches.open(AUDIO_CACHE);
  let done = 0;
  for (const u of urls) {
    const abs = absUrl(u);
    try {
      const hit = await cache.match(abs);
      if (!hit || force) {
        const res = await fetch(abs);
        if (res.ok) await cache.put(abs, res.clone());
      }
    } catch (e) {}
    done++;
    state.offline = { total: urls.length, done, busy: true, checked: true };
    updateOfflineUI();
  }
  state.offline = { total: urls.length, done, busy: false, checked: true };
  updateOfflineUI();
}

/* ============ service worker ============ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || state.swReloading) return;
    state.swReloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    if (reg.update) reg.update();
    setInterval(() => { if (reg.update) reg.update(); }, 30 * 60 * 1000);
  }).catch((e) => console.warn('SW register failed', e));
}

/* ============ init & events ============ */
async function init() {
  state.settings = loadSettings();
  bindEvents();
  try {
    state.content = await loadContent();
  } catch (e) {
    console.error(e);
    $('content-title').textContent = 'не удалось загрузить карточки';
    $('list').innerHTML = '<div class="empty">Нет соединения и нет сохранённой копии.<br>Откройте приложение один раз с интернетом.</div>';
    return;
  }
  document.title = state.content.title || 'Аудиокарточки';
  $('content-title').textContent = state.content.subtitle || state.content.title || '';
  if (!state.content.cards.some((c) => c.a && c.da)) state.settings.mode = 'solid';
  restoreSelection();
  renderList();
  syncSettingsUI();
  renderSpeedChips();
  updateLaunchBar();
  setupMediaSession();
  setupInstallHint();
  registerSW();
  probeOffline();
  schedulePrepare(700);
  setTimeout(() => { prefetchAudio(false).catch(() => {}); }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!state.offline.busy) probeOffline();
    }
  });
}

function isStandalone() {
  return (window.navigator.standalone === true) ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function setupInstallHint() {
  const hint = $('install-hint');
  if (!hint) return;
  let hidden = false;
  try { hidden = localStorage.getItem('ac.hint.hidden') === '1'; } catch (e) {}
  if (isStandalone() || hidden) return;
  hint.classList.remove('hidden');
  $('ih-close').addEventListener('click', () => {
    hint.classList.add('hidden');
    try { localStorage.setItem('ac.hint.hidden', '1'); } catch (e) {}
  });
}

function bindEvents() {
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.card-row');
    if (!row) return;
    const id = row.dataset.id;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    row.classList.toggle('selected', state.selected.has(id));
    saveSelection();
    updateLaunchBar();
    schedulePrepare(450);
  });

  $('btn-start').addEventListener('click', () => { startPlayback(); });
  $('btn-select-all').addEventListener('click', () => {
    state.content.cards.forEach((c) => state.selected.add(c.id));
    saveSelection();
    renderList();
    schedulePrepare(450);
  });
  $('btn-clear').addEventListener('click', () => {
    state.selected.clear();
    saveSelection();
    renderList();
    schedulePrepare(50);
  });
  $('search').addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    renderList();
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('p-settings').addEventListener('click', openSettings);
  $('s-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });

  $('p-close').addEventListener('click', closePlayer);
  $('p-play').addEventListener('click', () => {
    if (!state.session) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });
  $('p-prev').addEventListener('click', () => jumpCard(-1));
  $('p-next').addEventListener('click', () => jumpCard(1));
  $('p-back10').addEventListener('click', () => seekBy(-10));
  $('p-fwd10').addEventListener('click', () => seekBy(10));

  $('p-seek').addEventListener('input', (e) => {
    state.dragSeeking = true;
    const s = state.session;
    if (s) $('p-cur').textContent = fmtTime((e.target.value / 1000) * s.duration);
  });
  $('p-seek').addEventListener('change', (e) => {
    const s = state.session;
    state.dragSeeking = false;
    if (!s) return;
    audio.currentTime = (e.target.value / 1000) * s.duration;
  });

  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('play', updatePlayIcon);
  audio.addEventListener('pause', updatePlayIcon);
  audio.addEventListener('error', () => {
    if (!state.session) return;
    console.warn('audio error', audio.error);
    toast('Ошибка воспроизведения');
  });
  audio.addEventListener('ended', () => {
    updatePlayIcon();
    toast('Сессия завершена');
  });

  $('s-mode').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { state.settings.mode = b.dataset.mode; settingsChanged(); });
  });
  $('s-pause').addEventListener('input', (e) => {
    state.settings.pauseAfterQuestion = Number(e.target.value);
    $('s-pause-val').textContent = state.settings.pauseAfterQuestion + ' с';
  });
  $('s-pause').addEventListener('change', settingsChanged);
  $('s-gap').addEventListener('input', (e) => {
    state.settings.gap = Number(e.target.value);
    $('s-gap-val').textContent = state.settings.gap + ' с';
  });
  $('s-gap').addEventListener('change', settingsChanged);
  $('s-repeat').addEventListener('input', (e) => {
    state.settings.repeat = Number(e.target.value);
    $('s-repeat-val').textContent = String(state.settings.repeat);
  });
  $('s-repeat').addEventListener('change', settingsChanged);
  $('s-shuffle').addEventListener('change', (e) => {
    state.settings.shuffle = e.target.checked;
    settingsChanged();
  });
  $('s-speed').addEventListener('input', (e) => {
    state.settings.speed = Number(e.target.value);
    $('s-speed-val').textContent = String(state.settings.speed).replace('.', ',') + '×';
    audio.playbackRate = state.settings.speed;
  });
  $('s-speed').addEventListener('change', () => { saveSettings(); renderSpeedChips(); });
  $('s-cache').addEventListener('click', () => { prefetchAudio(true).catch(() => {}); toast('Обновляю офлайн-копию…'); });
}

init();

/* debug hook: open a screen directly (used only for testing) */
try {
  const dbg = new URLSearchParams(location.search);
  const screen = dbg.get('screen');
  if (screen === 'player') setTimeout(() => { startPlayback(); }, 1200);
  if (screen === 'settings') setTimeout(() => { openSettings(); }, 600);
  if (dbg.get('size')) setTimeout(() => {
    document.title = 'SZ ' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio +
      ' scrollW=' + document.documentElement.scrollWidth + ' bodyW=' + document.body.getBoundingClientRect().width +
      ' appW=' + document.getElementById('app').getBoundingClientRect().width;
  }, 500);
} catch (e) {}
