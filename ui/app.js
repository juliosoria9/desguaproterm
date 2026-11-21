'use strict';
// desguaproterm — interfaz: pestañas, cuadrícula, lanzador de proyectos, resumen, agentes y temas.
// `api` es global: lo expone bridge.js (window.api)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- iconos (trazos estilo Lucide) ----------
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICON = {
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  star: svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  folder: svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
  folderPlus: svg('<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  max: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>'),
  grid: svg('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
  single: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>'),
  panel: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  bot: svg('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
  chevRight: svg('<path d="m9 18 6-6-6-6"/>'),
  branch: svg('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
  gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
};
// el logo toma los colores del tema
const LOGO = `<svg viewBox="0 0 64 64"><defs>
  <linearGradient id="lgb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--panel-3)"/><stop offset="1" style="stop-color:var(--bg)"/></linearGradient>
  <linearGradient id="lga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent-2)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient></defs>
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lgb)"/>
  <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="15.25" fill="none" stroke="url(#lga)" stroke-opacity=".55" stroke-width="1.5"/>
  <path d="M17 21.5 29.5 32 17 42.5" fill="none" stroke="url(#lga)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="33" y="38.5" width="15" height="6.5" rx="3.25" fill="url(#lga)"/>
  <circle cx="47" cy="19" r="3.3" style="fill:var(--accent-2)"/></svg>`;

// ---------- estado ----------
const state = {
  tabs: [], activeId: null, layout: 'tabs', favorites: [], extraFolders: [], hidden: [], sidebar: true,
  fontSize: 14, theme: 'brasa', sideView: 'summary', aiTitles: true, lowMemory: false,
  notify: true, limitAlert: 80, costAlert: 0, alerted: [],
  sleepAfter: 30, lazyStart: true,
};
const views = new Map(); // tabId -> vista (terminal + panel)
const info = new Map(); // tabId -> lo último que contó el monitor (estado, tokens, agentes…)
let xtermLook = applyTheme('brasa');
let projects = [];
let sys = { build: 0, home: '' };
let search = '';
let selIndex = 0;
let visibleItems = [];

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const save = debounce(() => api.saveState({
  ...state,
  tabs: state.tabs.map(({ id, cwd, sessionId, name, drawer, drawerGrid, worktree, origin, wtPending, model, effort, mode }) => (
    { id, cwd, sessionId, name: name || null, drawer, drawerGrid, worktree, origin, wtPending, model, effort, mode })),
}), 200);

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortPath = (p) => (sys.home && p.toLowerCase().startsWith(sys.home.toLowerCase()) ? `~${p.slice(sys.home.length)}` : p);
function hue(str) { let h = 7; for (const ch of str.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; }
const colorOf = (p) => `hsl(${hue(baseName(p))} 85% 66%)`;
function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : d < 30 ? `hace ${d} días` : `hace ${Math.round(d / 30)} meses`;
}
/** Nombre del proyecto de la pestaña (numerado si hay varias del mismo; con ⎇ si es un worktree). */
function projLabel(tab) {
  if (tab.worktree) {
    const origin = tab.origin || tab.cwd;
    return samePath(origin, tab.cwd) ? `${baseName(origin)} ⎇ nuevo` : `${baseName(origin)} ⎇ ${baseName(tab.cwd)}`;
  }
  const same = state.tabs.filter((t) => !t.worktree && samePath(t.cwd, tab.cwd));
  return same.length > 1 ? `${baseName(tab.cwd)} · ${same.indexOf(tab) + 1}` : baseName(tab.cwd);
}
const drawerOpen = (tab) => (state.layout === 'grid' ? !!tab.drawerGrid : tab.drawer !== false);

// ---------- vistas de terminal ----------
function createView(tab) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.dataset.id = tab.id;
  pane.style.setProperty('--c', colorOf(tab.cwd));
  pane.innerHTML = `<div class="pane-head"><span class="dot"></span><span class="pane-title"></span><span class="pane-sub"></span>
    <button class="pane-btn max" title="Ver solo esta">${ICON.max}</button><button class="pane-btn close" title="Cerrar sesión">${ICON.x}</button></div>
    <div class="pane-body"><div class="term-host"></div></div>${drawerHTML()}`;
  $('#panes').appendChild(pane);
  const host = $('.term-host', pane);

  const term = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: state.fontSize,
    lineHeight: 1.12,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    rescaleOverlappingGlyphs: true,
    theme: xtermLook.xterm,
    minimumContrastRatio: xtermLook.contrast,
    windowsPty: sys.build ? { backend: 'conpty', buildNumber: sys.build } : undefined,
    // enlaces OSC 8 que pinta Claude (URLs y rutas de archivo): sin el diálogo de confirmación de xterm
    linkHandler: { activate: (_e, uri) => api.openExternal(uri), allowNonHttpProtocols: true },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => api.openExternal(uri)));
  term.open(host);
  if (!state.lowMemory) try {
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose()); // vuelve al renderizado normal si la GPU se queda sin contextos
    term.loadAddon(gl);
  } catch (err) { console.warn('WebGL no disponible', err); }

  const v = {
    tab, term, fit, pane, host, exited: true, cols: 0, rows: 0, images: new Map(), pendingImgs: [],
    sleeping: false, draft: false, lastInput: 0, startedAt: 0, ctl: {},
  };
  views.set(tab.id, v);

  // vista previa al pasar el ratón por "[Image #N]"
  term.registerLinkProvider({
    provideLinks(y, cb) {
      const line = term.buffer.active.getLine(y - 1);
      const text = line ? line.translateToString(true) : '';
      const links = [];
      for (const m of text.matchAll(/\[Image #(\d+)\]/g)) {
        const src = v.images.get(Number(m[1]));
        if (!src) continue;
        links.push({
          range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
          text: m[0],
          decorations: { underline: true, pointerCursor: true },
          activate() {},
          hover(e) { showImagePreview(src, e); },
          leave() { hideImagePreview(); },
        });
      }
      cb(links.length ? links : undefined);
    },
  });

  term.onData((d) => {
    if (v.sleeping) { wake(v); return; }
    if (v.exited) { if (d === '\r') start(v, true); return; }
    // ¿hay un mensaje a medio escribir? (entonces no se duerme ni se le mandan comandos)
    v.lastInput = Date.now();
    if (d === '\r' || d === '\x03') v.draft = false;
    else if (!d.startsWith('\x1b') && /[^\x00-\x1f\x7f]/.test(d)) v.draft = true;
    if (sys.test && sys.test.includes('trace')) window.__TAURI__.core.invoke('log_js', { msg: `in ${tab.id}: ${JSON.stringify(d)}` });
    api.write(tab.id, d);
  });
  term.attachCustomKeyEventHandler((e) => onTermKey(e, v));
  host.addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) copySel(v); else pasteInto(v); });
  host.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    setFontSize(state.fontSize + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false, capture: true });
  pane.addEventListener('mousedown', () => { if (state.activeId !== tab.id) setActive(tab.id, false); }, true);
  $('.d-strip', pane).addEventListener('click', () => toggleDrawer(tab.id));
  $('.d-min', pane).addEventListener('click', () => toggleDrawer(tab.id));

  v.ro = new ResizeObserver(() => fitView(v));
  v.ro.observe(host);
  applyDrawer(v);
  updateTabUI(v);
  return v;
}

function fitView(v) {
  if (!v.host.clientWidth || !v.host.clientHeight) return;
  try { v.fit.fit(); } catch { return; }
  if (v.term.cols === v.cols && v.term.rows === v.rows) return;
  v.cols = v.term.cols;
  v.rows = v.term.rows;
  clearTimeout(v.resizeTimer);
  v.resizeTimer = setTimeout(() => { if (!v.exited) api.resize(v.tab.id, v.cols, v.rows); }, 50);
}

async function start(v, again = false) {
  if (again) v.term.reset();
  v.exited = false;
  v.sleeping = false;
  v.startedAt = Date.now();
  fitView(v);
  scheduleRender(v.tab.id);
  const t = v.tab;
  await api.spawn({
    tabId: t.id, cwd: t.cwd, sessionId: t.sessionId, cols: v.term.cols, rows: v.term.rows,
    worktree: !!t.wtPending, model: t.model, effort: t.effort, mode: t.mode,
  });
}

function applyDrawer(v) {
  v.pane.classList.toggle('drawer-closed', !drawerOpen(v.tab));
  renderDrawer(v);
}
function toggleDrawer(id) {
  const v = views.get(id);
  if (!v) return;
  if (state.layout === 'grid') v.tab.drawerGrid = !v.tab.drawerGrid;
  else v.tab.drawer = !drawerOpen(v.tab);
  applyDrawer(v);
  save();
}

/** Actualiza la pestaña y la cabecera del panel con el estado y el tema de la sesión. */
function updateTabUI(v) {
  const st = statusOf(v.tab);
  const topic = topicOf(v.tab);
  const inf = info.get(v.tab.id) || {};
  const el = $(`.tab[data-id="${v.tab.id}"]`);
  if (el && !$('input', el)) {
    $('.dot', el).className = `dot ${st}`;
    const t = $('.topic', el);
    t.textContent = topic || 'Nueva sesión';
    t.classList.toggle('empty', !topic);
    $('.label', el).textContent = projLabel(v.tab);
    el.title = `${inf.title || topic || 'Nueva sesión'}\n${v.tab.cwd}\n${STATUS[st].label}`;
  }
  $('.pane-head .dot', v.pane).className = `dot ${st}`;
  $('.pane-title', v.pane).textContent = topic || 'Nueva sesión';
  $('.pane-sub', v.pane).textContent = `${projLabel(v.tab)} · ${st === 'working' ? inf.activity || 'Trabajando…' : STATUS[st].label}`;
}

// ---------- teclado, copiar y pegar ----------
function copySel(v) {
  const s = v.term.getSelection();
  if (s) api.clipWrite(s);
  v.term.clearSelection();
}
async function pasteInto(v) {
  if (v.exited) return;
  const t = await api.clipRead();
  if (t) { v.term.paste(t); return; }
  // sin texto: si hay una imagen, Claude la pega con Alt+V (su atajo en Windows)
  if (await rememberClipImage(v)) api.write(v.tab.id, '\x1bv');
}

// ---------- imágenes pegadas o arrastradas: miniatura para la vista previa ----------
/** Números de "[Image #N]" que se ven ahora en la terminal. */
function visibleImageNumbers(v) {
  const b = v.term.buffer.active;
  const nums = new Set();
  for (let y = Math.max(0, b.length - v.term.rows - 200); y < b.length; y++) {
    const line = b.getLine(y);
    if (!line) continue;
    for (const m of line.translateToString(true).matchAll(/\[Image #(\d+)\]/g)) nums.add(Number(m[1]));
  }
  return nums;
}
/** Antes de pegar: apunta qué "[Image #N]" ya había, para reconocer la nueva. */
function imageBaseline(v) {
  if (!v.knownImgs) v.knownImgs = visibleImageNumbers(v);
}
/** Asocia la siguiente "[Image #N]" que aparezca con esta miniatura. */
function expectImage(v, src) {
  if (!src) return;
  imageBaseline(v);
  v.pendingImgs.push(src);
  const scan = () => {
    if (!v.pendingImgs.length || !v.knownImgs) return;
    const fresh = [...visibleImageNumbers(v)].filter((n) => !v.knownImgs.has(n) && !v.images.has(n)).sort((a, b) => a - b);
    for (const n of fresh) {
      if (!v.pendingImgs.length) break;
      v.images.set(n, v.pendingImgs.shift());
      v.knownImgs.add(n);
    }
  };
  for (const ms of [250, 700, 1500, 3000, 5000]) setTimeout(scan, ms);
  clearTimeout(v.imgTimer);
  v.imgTimer = setTimeout(() => { v.pendingImgs = []; v.knownImgs = null; }, 6000);
}
async function rememberClipImage(v) {
  try {
    imageBaseline(v);
    const src = await api.clipImage();
    if (src) expectImage(v, src);
    else if (!v.pendingImgs.length) v.knownImgs = null;
    return !!src;
  } catch { return false; }
}
function showImagePreview(src, e) {
  const box = $('#img-preview');
  $('img', box).src = src;
  box.hidden = false;
  const r = box.getBoundingClientRect();
  const x = Math.min(e.clientX + 16, window.innerWidth - r.width - 12);
  const y = e.clientY - r.height - 16 > 8 ? e.clientY - r.height - 16 : e.clientY + 20;
  box.style.left = `${Math.max(8, x)}px`;
  box.style.top = `${Math.max(8, y)}px`;
}
function hideImagePreview() { $('#img-preview').hidden = true; }
function onTermKey(e, v) {
  if (e.type !== 'keydown') return true;
  if (handleShortcut(e)) { e.preventDefault(); e.stopPropagation(); return false; }
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  if (ctrl && k === 'c' && (e.shiftKey || v.term.hasSelection())) { e.preventDefault(); copySel(v); return false; }
  if (ctrl && k === 'v') { e.preventDefault(); pasteInto(v); return false; }
  // Alt+V a mano (pegar imagen en Claude): guarda también la miniatura para la vista previa
  if (e.altKey && !e.ctrlKey && k === 'v') rememberClipImage(v);
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) { // salto de línea en el mensaje
    e.preventDefault();
    if (!v.exited) api.write(v.tab.id, '\x1b\r');
    return false;
  }
  return true;
}
function handleShortcut(e) {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.altKey && k === 'tab') { cycle(e.shiftKey ? -1 : 1); return true; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && (k === 'pagedown' || k === 'pageup')) { cycle(k === 'pagedown' ? 1 : -1); return true; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ',') { openSettings(); return true; }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    const t = state.tabs[Number(e.code.slice(5)) - 1];
    if (t) setActive(t.id);
    return true;
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    switch (e.code) {
      case 'KeyT': focusSearch(); return true;
      case 'KeyN': newHere(); return true;
      case 'KeyW': if (state.activeId) closeTab(state.activeId); return true;
      case 'KeyG': setLayout(state.layout === 'grid' ? 'tabs' : 'grid'); return true;
      case 'KeyB': toggleSidebar(); return true;
      case 'KeyA': if (state.activeId) toggleDrawer(state.activeId); return true;
      default: return false;
    }
  }
  return false;
}

// ---------- pestañas ----------
function renderTabs() {
  $('#tabs').innerHTML = state.tabs.map((tab) => `<div class="tab${tab.id === state.activeId ? ' active' : ''}" data-id="${tab.id}"
      role="tab" style="--c:${colorOf(tab.origin || tab.cwd)}"><span class="dot"></span>
      <div class="tab-text"><span class="topic"></span><span class="label"></span></div>
      <button class="close" title="Cerrar (Ctrl+Shift+W)">${ICON.x}</button></div>`).join('');
  $('#new-tab').style.display = state.tabs.length ? '' : 'none';
  $('#new-wt').style.display = state.tabs.length ? '' : 'none';
  for (const v of views.values()) updateTabUI(v);
}

function setActive(id, focus = true) {
  if (!id || !views.has(id)) { state.activeId = null; save(); return; }
  state.activeId = id;
  const v = views.get(id);
  if (v.sleeping) wake(v);
  $$('#tabs .tab').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  $$('#panes .pane').forEach((p) => p.classList.toggle('active', p.dataset.id === id));
  const tabEl = $(`.tab[data-id="${id}"]`);
  if (tabEl) tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focus) requestAnimationFrame(() => v.term.focus());
  scheduleRender();
  save();
}

function cycle(dir) {
  const n = state.tabs.length;
  if (!n) return;
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  setActive(state.tabs[(i + dir + n) % n].id);
}

function openSession(cwd, { sessionId = uuid(), name = null, index = null, afterActive = false, worktree = false } = {}) {
  const tab = { id: uuid(), cwd, sessionId, name, ...(worktree ? { worktree: true, origin: cwd, wtPending: true } : {}) };
  let at = index;
  if (at == null) {
    const ai = state.tabs.findIndex((t) => t.id === state.activeId);
    at = afterActive && ai >= 0 ? ai + 1 : state.tabs.length;
  }
  state.tabs.splice(Math.min(at, state.tabs.length), 0, tab);
  const v = createView(tab);
  refreshUI();
  setActive(tab.id);
  requestAnimationFrame(() => start(v));
}

function newHere() {
  const t = state.tabs.find((x) => x.id === state.activeId);
  if (t) openSession(t.origin || t.cwd, { afterActive: true });
  else focusSearch();
}

/** Otra sesión en el mismo proyecto, aislada en su propio worktree de git. */
function newWorktree() {
  const t = state.tabs.find((x) => x.id === state.activeId);
  if (t) openSession(t.origin || t.cwd, { afterActive: true, worktree: true });
  else focusSearch();
}

// ---------- dormir sesiones inactivas (cada Claude abierto ocupa ~0,5 GB) ----------
const DIM = '\x1b[38;2;125;125;145m';
function sleepTab(v, startup = false) {
  v.sleeping = true;
  if (!startup) api.kill(v.tab.id, false); // se cierra Claude; la conversación queda guardada
  else api.watchOnly(v.tab.id, v.tab.sessionId); // aunque duerma, título y tokens siguen al día
  v.term.write(`\r\n${DIM}── ${startup ? 'Dormida: se abrirá al entrar en esta pestaña' : 'Dormida para ahorrar memoria · se despierta al volver a ella'} ──\x1b[0m\r\n`);
  scheduleRender(v.tab.id);
}
function wake(v) {
  if (!v || !v.sleeping) return;
  v.sleeping = false;
  start(v, true);
}
/** Duerme las sesiones que llevan un rato acabadas o en espera y que no estás mirando. */
function checkSleep() {
  const after = Number(state.sleepAfter) || 0;
  if (!after || state.layout === 'grid') return; // en cuadrícula las ves todas: no se duerme ninguna
  const now = Date.now();
  for (const v of views.values()) {
    if (v.sleeping || v.exited || v.draft || v.tab.id === state.activeId) continue;
    const inf = info.get(v.tab.id);
    if (!inf || !['done', 'idle'].includes(inf.status)) continue;
    if ((inf.agents || []).some((a) => a.running)) continue; // tiene agentes en segundo plano
    const quiet = Math.max(inf.since || 0, v.lastInput || 0, v.startedAt || 0);
    if (now - quiet >= after * 60000) sleepTab(v);
  }
}

// ---------- controles rápidos: modelo, esfuerzo y modo ----------
/** Últimas líneas visibles de la terminal (ahí pinta Claude el modo y el esfuerzo). */
function screenText(v, lines) {
  const b = v.term.buffer.active;
  const end = b.baseY + v.term.rows;
  const out = [];
  for (let y = Math.max(0, end - lines); y < end; y++) {
    const l = b.getLine(y);
    if (l) out.push(l.translateToString(true));
  }
  return out.join('\n');
}
/** Modo que muestra Claude: el último "… mode on" de la pantalla (esté abajo o tras la caja de texto). */
function currentMode(v) {
  const t = screenText(v, v.term.rows).toLowerCase();
  const modes = [['plan mode on', 'plan'], ['accept edits on', 'acceptEdits'], ['auto mode on', 'auto'], ['bypass permissions on', 'bypassPermissions'], ['manual mode on', 'manual']];
  let best = ['', -1];
  for (const [text, mode] of modes) {
    const i = t.lastIndexOf(text);
    if (i > best[1]) best = [mode, i];
  }
  return best[0];
}
function currentEffort(v) {
  const all = [...screenText(v, v.term.rows).matchAll(/\b(low|medium|high|xhigh|max)\s*(?:·\s*\/effort|effort\b)/gi)];
  return all.length ? all[all.length - 1][1].toLowerCase() : '';
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** El modo se cambia como lo harías tú: Shift+Tab hasta llegar al que quieres. */
async function cycleMode(v, target) {
  // espera a que Claude haya cargado y enseñe su modo (p. ej. justo después de reabrirse)
  for (let i = 0; i < 20 && !currentMode(v); i++) await wait(400);
  if (!currentMode(v)) return false;
  for (let i = 0; i < 6; i++) {
    if (currentMode(v) === target) return true;
    api.write(v.tab.id, '\x1b[Z');
    await wait(400);
  }
  return currentMode(v) === target;
}
const CTL_NAME = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' };
/** Cambia modelo, esfuerzo o modo SOLO de esta sesión (no toca tus valores por defecto de Claude). */
async function applyControl(tabId, kind, value) {
  const v = views.get(tabId);
  if (!v || !value) return;
  if (!['idle', 'done'].includes(statusOf(v.tab))) {
    showToast('Espera a que Claude termine para cambiarlo', null, null, 3000);
  } else if (v.draft) {
    showToast('Tienes texto escrito en esa sesión: envíalo o bórralo antes', null, null, 4000);
  } else if (kind === 'mode') {
    // el modo se cambia en caliente (Shift+Tab) y se recuerda para cuando se reabra
    if (await cycleMode(v, value)) { v.tab.mode = value; save(); }
    else showToast('No he podido poner ese modo (puede que no esté disponible en tu cuenta)', null, null, 4500);
  } else {
    // modelo y esfuerzo: se reabre este Claude con --model/--effort; la conversación sigue
    v.tab[kind] = value;
    save();
    api.kill(tabId, false);
    await start(v, true);
    showToast(`${kind === 'model' ? 'Modelo' : 'Esfuerzo'} ${CTL_NAME[value] || value} en esta sesión (solo en esta)`, null, null, 3500);
  }
  setTimeout(() => scheduleRender(tabId), 700);
}

// ---------- diff de una acción ----------
async function openDiff(tabId, actionId) {
  const d = await api.actionDiff(tabId, actionId).catch(() => null);
  if (!d || !d.lines.length) return;
  const box = $('#diff-pop');
  $('.dp-file', box).textContent = baseName(d.file || '') || d.text;
  $('.dp-file', box).title = d.file || '';
  $('.dp-stats', box).innerHTML = fmtLines(d, false);
  $('.dp-body', box).innerHTML = d.lines.map((l) => {
    const cls = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l === '…' ? 'gap' : '';
    return `<span class="${cls}">${esc(l) || ' '}</span>`;
  }).join('\n');
  box.hidden = false;
}
function closeDiff() { $('#diff-pop').hidden = true; }

// ---------- responder a una sesión que te necesita (desde el resumen o un aviso) ----------
function respond(tabId, action) {
  const v = views.get(tabId);
  if (!v) return;
  if (action === 'approve' || action === 'deny') {
    const inf = info.get(tabId) || {};
    if (statusOf(v.tab) !== 'needs' || !inf.need || inf.need.kind !== 'permission') {
      showToast('Esa petición ya no está pendiente', null, null, 3000);
      return;
    }
    // el diálogo de permiso de Claude: Enter = "Sí" (la opción marcada), Esc = "No"
    api.write(tabId, action === 'approve' ? '\r' : '\x1b');
    showToast(action === 'approve' ? 'Aprobado' : 'Rechazado: Claude espera que le digas qué hacer', null, null, 3000);
    return;
  }
  setActive(tabId);
}

/** Aviso cuando una sesión que no estás mirando termina, falla o te necesita. */
function onStatusChange(tab, prev, p) {
  const watching = tab.id === state.activeId && document.hasFocus();
  const important = p.status === 'needs' || p.status === 'error' || (p.status === 'done' && prev.status === 'working');
  if (!important || watching) return;
  api.attention();
  if (!state.notify) return;
  const name = topicOf(tab) || projLabel(tab);
  const need = p.need || {};
  if (p.status === 'needs' && need.kind === 'permission') {
    api.notify(tab.id, `${name} te necesita`, need.what ? `Quiere: ${need.what}` : 'Te pide permiso para seguir', [['Aprobar', 'approve'], ['Rechazar', 'deny'], ['Ver', 'view']]);
  } else if (p.status === 'needs') {
    const what = need.what ? `${need.kind === 'question' ? 'Te pregunta' : 'Plan'}: ${need.what}` : 'Te está esperando';
    api.notify(tab.id, `${name} te necesita`, what, [['Ver', 'view']]);
  } else if (p.status === 'error') {
    api.notify(tab.id, `${name}: falló la petición`, 'Mira la terminal para ver el error', [['Ver', 'view']]);
  } else {
    api.notify(tab.id, `${name} ha terminado`, p.lastMessage || 'Ya puedes revisar lo que ha hecho', [['Ver', 'view']]);
  }
}

// ---------- avisos de límites del plan y de tareas caras ----------
function alertOnce(key, title, body) {
  if (state.alerted.includes(key)) return;
  state.alerted = [...state.alerted.slice(-40), key];
  save();
  if (state.notify) api.notify('', title, body, []);
  showToast(body ? `${title}. ${body}` : title, null, null, 8000);
}
function checkAlerts() {
  const l = limits || (report && report.limits);
  const thr = Number(state.limitAlert) || 0;
  if (l && thr) {
    for (const [k, name] of [['five_hour', 'de 5 h'], ['seven_day', 'semanal']]) {
      const x = l[k];
      if (!x || x.used_percentage == null || x.used_percentage < thr) continue;
      alertOnce(`lim:${k}:${x.resets_at}:${thr}`, `Llevas el ${Math.round(x.used_percentage)} % del límite ${name}`, x.resets_at ? `Se renueva ${fmtWhen(x.resets_at * 1000)}` : '');
    }
  }
  const cost = Number(state.costAlert) || 0;
  if (cost && report) {
    for (const t of report.tasks) {
      if (costOf(t.usage) < cost || Date.now() - t.last > 3 * 3600000) continue;
      alertOnce(`task:${t.sessionId}:${t.started}:${cost}`, `Una tarea ha pasado de ${fmtUSD(cost)}`, `${baseName(t.project || '?')}: «${t.prompt.slice(0, 60)}» lleva ${fmtUSD(costOf(t.usage))}`);
    }
  }
}

// ---------- soltar archivos y carpetas ----------
/** En una sesión: se le pasan las rutas a Claude (las imágenes se adjuntan solas). Fuera: una
 *  carpeta se abre como proyecto. */
async function handleDrop(v, paths) {
  if (!paths || !paths.length) return;
  const target = v && !v.exited ? v : null;
  if (!target) {
    let opened = 0;
    for (const p of paths) {
      if ((await api.pathKind(p)) !== 'dir') continue;
      if (!state.extraFolders.some((f) => samePath(f, p))) state.extraFolders.push(p);
      openSession(p);
      opened++;
    }
    if (opened) save();
    else showToast('Suelta los archivos encima de una sesión para pasárselos a Claude', null, null, 4000);
    return;
  }
  imageBaseline(target);
  target.term.paste(`${paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')} `);
  setActive(target.tab.id);
  for (const p of paths.filter((x) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(x))) {
    expectImage(target, await api.filePreview(p).catch(() => null));
  }
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tab = state.tabs[i];
  const label = topicOf(tab) || baseName(tab.cwd);
  const v = views.get(id);
  // el núcleo devuelve la conversación que tenía la pestaña (puede haber cambiado con /clear o /resume)
  api.kill(id, true).then((sid) => { if (sid) tab.sessionId = sid; });
  v.ro.disconnect();
  v.term.dispose();
  v.pane.remove();
  views.delete(id);
  info.delete(id);
  state.tabs.splice(i, 1);
  if (state.activeId === id) state.activeId = (state.tabs[i] || state.tabs[i - 1] || {}).id || null;
  refreshUI();
  setActive(state.activeId);
  // la conversación sigue guardada por Claude: deshacer la reabre con --resume
  showToast(`Sesión «${label}» cerrada`, 'Deshacer', () => openSession(tab.cwd, { sessionId: tab.sessionId, name: tab.name, index: i }), 8000);
}

function startRename(id) {
  const tab = state.tabs.find((t) => t.id === id);
  const el = $(`.tab[data-id="${id}"]`);
  if (!tab || !el) return;
  const topic = $('.topic', el);
  el.draggable = false;
  const input = document.createElement('input');
  input.value = topicOf(tab);
  input.placeholder = 'Nombre de la sesión (vacío = automático)';
  topic.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    if (ok) {
      const val = input.value.trim();
      const inf = info.get(id);
      const auto = inf && (inf.shortTitle || inf.title);
      tab.name = val && val !== auto ? val : null;
      save();
    }
    renderTabs();
    scheduleRender();
    focusActive();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- vistas: una a una / cuadrícula ----------
function applyLayout() {
  const panes = $('#panes');
  panes.className = state.layout;
  $$('.layout-switch button').forEach((b) => b.classList.toggle('on', b.dataset.layout === state.layout));
  const n = state.tabs.length;
  state.tabs.forEach((t, i) => { const v = views.get(t.id); if (v) { v.pane.style.order = i; v.pane.style.gridColumn = ''; } });
  if (state.layout !== 'grid' || !n) { panes.style.gridTemplateColumns = ''; panes.style.gridTemplateRows = ''; return; }
  // reparto que deja cada panel lo más cerca posible de ~80×20 caracteres
  const W = panes.clientWidth || 1200;
  const H = panes.clientHeight || 800;
  let best = 1;
  let bestScore = -1;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const score = Math.min(W / c / 650, H / r / 330);
    if (score > bestScore + 1e-6) { bestScore = score; best = c; }
  }
  const rows = Math.ceil(n / best);
  panes.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
  panes.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  const rest = n % best;
  if (rest) views.get(state.tabs[n - 1].id).pane.style.gridColumn = `span ${best - rest + 1}`;
}
function setLayout(l) {
  state.layout = l;
  applyLayout();
  for (const v of views.values()) applyDrawer(v);
  save();
  focusActive();
}

function refreshUI() {
  renderTabs();
  applyLayout();
  $('#empty').hidden = state.tabs.length > 0;
  renderProjects();
  scheduleRender();
}

// ---------- barra lateral: resumen / proyectos ----------
function setSideView(view) {
  state.sideView = ['summary', 'spend', 'projects'].includes(view) ? view : 'summary';
  for (const v of ['summary', 'spend', 'projects']) $(`#view-${v}`).hidden = state.sideView !== v;
  $$('.side-switch button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.sideView));
  if (state.sideView === 'spend') renderSpend();
  save();
}

function projectItems() {
  const map = new Map();
  const add = (p, lastUsed = 0) => {
    const k = p.toLowerCase();
    const cur = map.get(k);
    if (cur) cur.lastUsed = Math.max(cur.lastUsed, lastUsed);
    else map.set(k, { path: p, name: baseName(p), lastUsed });
  };
  projects.forEach((p) => add(p.path, p.lastUsed));
  state.extraFolders.forEach((p) => add(p));
  state.favorites.forEach((p) => add(p));
  state.tabs.forEach((t) => add(t.cwd));
  const hidden = new Set(state.hidden.map((h) => h.toLowerCase()));
  const favSet = new Set(state.favorites.map((f) => f.toLowerCase()));
  const favs = state.favorites.map((f) => map.get(f.toLowerCase())).filter(Boolean);
  const recents = [...map.values()]
    .filter((p) => !favSet.has(p.path.toLowerCase()) && !hidden.has(p.path.toLowerCase()))
    .sort((a, b) => b.lastUsed - a.lastUsed);
  return { favs, recents };
}

function renderProjects() {
  const q = search.trim().toLowerCase();
  const { favs: allFavs, recents: allRecents } = projectItems();
  const match = (p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
  const favs = allFavs.filter(match);
  const recents = allRecents.filter(match);
  visibleItems = [...favs, ...recents];
  selIndex = Math.max(0, Math.min(selIndex, visibleItems.length - 1));
  const showSel = document.activeElement === $('#search');
  let idx = 0;
  const item = (p, fav) => {
    const open = state.tabs.filter((t) => samePath(t.cwd, p.path)).length;
    const sel = showSel && idx === selIndex;
    idx++;
    return `<div class="project${sel ? ' sel' : ''}" data-path="${esc(p.path)}" title="${esc(p.path)}">
      <div class="avatar" style="--h:${hue(p.name)}">${esc((p.name[0] || '?').toUpperCase())}</div>
      <div class="meta"><div class="name">${esc(p.name)}</div><div class="path">${esc(shortPath(p.path))}</div></div>
      ${open ? `<span class="badge" title="${open} ${open === 1 ? 'sesión abierta' : 'sesiones abiertas'}">${open}</span>` : ''}
      <div class="actions">
        <button class="act fav${fav ? ' on' : ''}" data-act="fav" title="${fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${ICON.star}</button>
        <button class="act" data-act="wt" title="Sesión aislada: trabaja en su propio worktree de git">${ICON.branch}</button>
        <button class="act" data-act="folder" title="Abrir en el Explorador">${ICON.folder}</button>
        ${fav ? '' : `<button class="act" data-act="hide" title="Quitar de la lista">${ICON.x}</button>`}
      </div></div>`;
  };
  let html = '';
  if (favs.length) html += `<div class="section-title">Favoritos</div>${favs.map((p) => item(p, true)).join('')}`;
  if (recents.length) html += `<div class="section-title">${q ? 'Resultados' : 'Recientes'}</div>${recents.map((p) => item(p, false)).join('')}`;
  if (!visibleItems.length) html = q.length >= 3 ? '' : `<div class="empty-list">${q ? 'Ningún proyecto coincide.' : 'Aún no hay proyectos: añade una carpeta abajo.'}</div>`;
  if (q.length >= 3) html += convSection(q);
  $('#project-list').innerHTML = html;

  $('#empty-cards').innerHTML = [...allFavs, ...allRecents].slice(0, 6).map((p) => `
    <div class="card" data-path="${esc(p.path)}" style="--h:${hue(p.name)}" title="${esc(p.path)}">
      <div class="avatar" style="--h:${hue(p.name)}">${esc((p.name[0] || '?').toUpperCase())}</div>
      <div class="meta"><div class="name">${esc(p.name)}</div><div class="when">${p.lastUsed ? ago(p.lastUsed) : esc(shortPath(p.path))}</div></div>
    </div>`).join('');
}

// ---------- buscar en conversaciones antiguas ----------
let conv = { q: '', results: [], busy: false };
const runConvSearch = debounce(async (q) => {
  if (q.trim().length < 3) { conv = { q, results: [], busy: false }; renderProjects(); return; }
  conv.busy = true;
  renderProjects();
  const results = await api.searchConversations(q).catch(() => []);
  if (search === q) { conv = { q, results, busy: false }; renderProjects(); }
}, 350);

function highlight(text, q) {
  const safe = esc(text);
  const needle = esc(q.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return needle ? safe.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`) : safe;
}

function convSection(q) {
  const items = conv.results.map((r, i) => {
    const open = state.tabs.some((t) => t.sessionId === r.sessionId);
    return `<div class="conv" data-ci="${i}" title="${open ? 'Abierta en una pestaña' : 'Pulsa para reabrir esta conversación'}">
      <div class="conv-top"><b>${esc(r.title || (r.hits[0] && r.hits[0].text) || 'Conversación')}</b><span>${fmtWhen(r.last)}</span></div>
      <div class="conv-proj"><span class="s-proj" style="--c:${colorOf(r.project || '?')}">${esc(baseName(r.project || '?'))}</span> · ${r.count} ${r.count === 1 ? 'coincidencia' : 'coincidencias'}${open ? ' · <span class="open-dot">● abierta</span>' : ''}</div>
      ${r.hits.map((h) => `<div class="conv-hit"><span>${esc(h.who)}:</span> ${highlight(h.text, q)}</div>`).join('')}
    </div>`;
  }).join('');
  const empty = !conv.busy && conv.q === search && !conv.results.length ? '<div class="empty-list">No aparece en ninguna conversación.</div>' : '';
  return `<div class="section-title">En conversaciones${conv.busy ? ' · buscando…' : ''}</div>${items}${empty}`;
}

function openConversation(r) {
  if (!r) return;
  const tab = state.tabs.find((t) => t.sessionId === r.sessionId);
  if (tab) setActive(tab.id);
  else if (r.project) openSession(r.project, { sessionId: r.sessionId });
}

function toggleFav(p) {
  const i = state.favorites.findIndex((f) => samePath(f, p));
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(p);
  save();
  renderProjects();
}

function focusSearch() {
  if (!state.sidebar) toggleSidebar();
  setSideView('projects');
  const input = $('#search');
  input.focus();
  input.select();
}
function focusActive() { const v = views.get(state.activeId); if (v) v.term.focus(); }
function toggleSidebar() {
  state.sidebar = !state.sidebar;
  document.body.classList.toggle('no-sidebar', !state.sidebar);
  save();
}
function setFontSize(n) {
  n = Math.max(9, Math.min(26, n));
  if (n === state.fontSize) return;
  state.fontSize = n;
  $('#font-size').textContent = n;
  for (const v of views.values()) { v.term.options.fontSize = n; fitView(v); }
  save();
}

// ---------- ajustes y temas ----------
function setTheme(id) {
  state.theme = THEMES[id] ? id : 'brasa';
  xtermLook = applyTheme(state.theme);
  for (const v of views.values()) {
    v.term.options.theme = xtermLook.xterm;
    v.term.options.minimumContrastRatio = xtermLook.contrast;
  }
  $$('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.theme === state.theme));
  save();
}
function openSettings() {
  $('#theme-grid').innerHTML = Object.entries(THEMES).map(([id, t]) => `
    <button class="theme-card${id === state.theme ? ' on' : ''}" data-theme="${id}">${themePreview(id)}
      <div class="tn">${esc(t.name)}</div><div class="td">${esc(t.desc)}</div></button>`).join('');
  $('#settings').hidden = false;
}
function closeSettings() { $('#settings').hidden = true; focusActive(); }

let toastTimer;
function showToast(msg, actionLabel, action, ms = 5000) {
  const t = $('#toast');
  t.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { t.hidden = true; action(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- eventos ----------
function wireEvents() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = ICON[el.dataset.icon] || ''; });
  $$('.logo, .hero-logo').forEach((el) => { el.innerHTML = LOGO; });

  const tabsBox = $('#tabs');
  let suppressClick = false;
  tabsBox.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || e.target.closest('input') || suppressClick) return;
    if (e.target.closest('.close')) closeTab(t.dataset.id);
    else setActive(t.dataset.id);
  });
  tabsBox.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  tabsBox.addEventListener('auxclick', (e) => {
    const t = e.target.closest('.tab');
    if (e.button === 1 && t) closeTab(t.dataset.id);
  });
  tabsBox.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.tab');
    if (t && !e.target.closest('.close, input')) startRename(t.dataset.id);
  });
  tabsBox.addEventListener('wheel', (e) => { tabsBox.scrollLeft += e.deltaY; }, { passive: true });

  // reordenar pestañas arrastrando con el ratón (el arrastre nativo queda para soltar archivos)
  let drag = null;
  const clearDrag = () => $$('.tab', tabsBox).forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
  tabsBox.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.tab');
    if (t && e.button === 0 && !e.target.closest('.close, input')) drag = { id: t.dataset.id, x: e.clientX, moved: false, over: null };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || (!drag.moved && Math.abs(e.clientX - drag.x) < 6)) return;
    drag.moved = true;
    clearDrag();
    const me = $(`.tab[data-id="${drag.id}"]`);
    if (me) me.classList.add('dragging');
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const over = el && el.closest('.tab');
    drag.over = null;
    if (over && over.dataset.id !== drag.id) {
      const r = over.getBoundingClientRect();
      drag.before = e.clientX < r.left + r.width / 2;
      drag.over = over.dataset.id;
      over.classList.add(drag.before ? 'drop-before' : 'drop-after');
    }
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearDrag();
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!d.over) return;
    const [moved] = state.tabs.splice(state.tabs.findIndex((x) => x.id === d.id), 1);
    state.tabs.splice(state.tabs.findIndex((x) => x.id === d.over) + (d.before ? 0 : 1), 0, moved);
    renderTabs();
    applyLayout();
    scheduleRender();
    save();
  });

  // soltar archivos o carpetas en la ventana
  const hint = $('#drop-hint');
  const paneAt = (pos) => {
    if (!pos) return null;
    const el = document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio);
    const pane = el && el.closest('.pane');
    return pane ? views.get(pane.dataset.id) || null : null;
  };
  const markDrop = (v) => {
    $$('.pane').forEach((p) => p.classList.toggle('drop-over', !!v && p === v.pane));
    hint.hidden = !!v;
    hint.textContent = v ? '' : 'Suelta una carpeta para abrirla como proyecto, o un archivo encima de una sesión';
  };
  api.onDragDrop((p) => {
    if (p.type === 'leave') { markDrop(null); hint.hidden = true; return; }
    const v = paneAt(p.position);
    if (p.type === 'drop') {
      markDrop(null);
      hint.hidden = true;
      handleDrop(v || (state.layout === 'tabs' ? views.get(state.activeId) : null), p.paths);
      return;
    }
    markDrop(v || (state.layout === 'tabs' && p.position && document.elementFromPoint(p.position.x / devicePixelRatio, p.position.y / devicePixelRatio)?.closest('#stage') ? views.get(state.activeId) : null));
  });

  $('#new-tab').addEventListener('click', newHere);
  $('#new-wt').addEventListener('click', newWorktree);
  $('#toggle-sidebar').addEventListener('click', toggleSidebar);
  $$('.layout-switch button').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
  $$('.side-switch button').forEach((b) => b.addEventListener('click', () => setSideView(b.dataset.view)));

  $('#panes').addEventListener('click', (e) => {
    const wk = e.target.closest('[data-wake]');
    if (wk) { const v = views.get(wk.dataset.wake); setActive(wk.dataset.wake); wake(v); return; }
    const df = e.target.closest('[data-diff]');
    if (df) { openDiff(df.dataset.tab, df.dataset.diff); return; }
    const act = e.target.closest('[data-act][data-tab]');
    if (act) { respond(act.dataset.tab, act.dataset.act); return; }
    const b = e.target.closest('.pane-head .pane-btn');
    if (!b) return;
    const id = b.closest('.pane').dataset.id;
    if (b.classList.contains('close')) closeTab(id);
    else { setLayout('tabs'); setActive(id); }
  });
  $('#panes').addEventListener('dblclick', (e) => {
    const h = e.target.closest('.pane-head');
    if (h && !e.target.closest('.pane-btn')) { setLayout('tabs'); setActive(h.closest('.pane').dataset.id); }
  });
  $('#panes').addEventListener('change', (e) => {
    const s = e.target.closest('select[data-ctl]');
    if (!s) return;
    applyControl(s.dataset.tab, s.dataset.ctl, s.value);
    s.blur();
    focusActive();
  });
  $('#diff-pop .dp-close').addEventListener('click', closeDiff);
  document.addEventListener('mousedown', (e) => {
    if (!$('#diff-pop').hidden && !e.target.closest('#diff-pop, [data-diff]')) closeDiff();
  });
  new ResizeObserver(() => { if (state.layout === 'grid') applyLayout(); }).observe($('#stage'));

  $('#summary').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act][data-tab]');
    if (act) { respond(act.dataset.tab, act.dataset.act); return; }
    const card = e.target.closest('.s-card');
    if (card && views.has(card.dataset.id)) setActive(card.dataset.id);
  });
  api.onToastAction(({ tabId, action }) => { if (tabId) respond(tabId, action); });

  // gasto por tarea: filtros y abrir la conversación de una tarea
  $$('#spend-period button').forEach((b) => b.addEventListener('click', () => { spend.period = b.dataset.period; renderSpend(); }));
  $('#spend-project').addEventListener('change', (e) => { spend.project = e.target.value; renderSpend(); });
  $('#spend-sort').addEventListener('change', (e) => { spend.sort = e.target.value; renderSpend(); });
  $('#spend-search').addEventListener('input', (e) => { spend.q = e.target.value; renderSpend(); });
  $('#spend-list').addEventListener('click', (e) => {
    const row = e.target.closest('.task');
    const t = row && (renderSpend.list || [])[Number(row.dataset.i)];
    if (!t) return;
    const tab = state.tabs.find((x) => x.sessionId === t.sessionId);
    if (tab) setActive(tab.id);
    else if (t.project) showToast(`¿Reabrir la conversación de «${t.prompt.slice(0, 40)}…»?`, 'Abrir', () => openSession(t.project, { sessionId: t.sessionId }), 6000);
  });

  const openFromList = (e) => {
    const c = e.target.closest('.conv');
    if (c) { openConversation(conv.results[Number(c.dataset.ci)]); return; }
    const row = e.target.closest('[data-path]');
    if (!row) return;
    const p = row.dataset.path;
    const act = e.target.closest('[data-act]');
    if (!act) return openSession(p);
    if (act.dataset.act === 'fav') toggleFav(p);
    else if (act.dataset.act === 'wt') openSession(p, { worktree: true });
    else if (act.dataset.act === 'folder') api.openFolder(p);
    else if (act.dataset.act === 'hide') { state.hidden.push(p); save(); renderProjects(); }
  };
  $('#project-list').addEventListener('click', openFromList);
  $('#empty-cards').addEventListener('click', openFromList);

  const input = $('#search');
  input.addEventListener('input', () => { search = input.value; selIndex = 0; renderProjects(); runConvSearch(search); });
  input.addEventListener('focus', renderProjects);
  input.addEventListener('blur', () => setTimeout(renderProjects, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selIndex = Math.max(0, Math.min(visibleItems.length - 1, selIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      renderProjects();
      const sel = $('.project.sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const p = visibleItems[selIndex];
      if (!p) return;
      input.value = '';
      search = '';
      openSession(p.path);
    } else if (e.key === 'Escape') {
      input.value = '';
      search = '';
      renderProjects();
      focusActive();
    }
  });

  $('#add-folder').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (!p) return;
    if (!state.extraFolders.some((f) => samePath(f, p))) state.extraFolders.push(p);
    state.hidden = state.hidden.filter((h) => !samePath(h, p));
    save();
    openSession(p);
  });

  // ajustes
  $('#open-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', closeSettings);
  $('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') closeSettings(); });
  $('#theme-grid').addEventListener('click', (e) => {
    const c = e.target.closest('.theme-card');
    if (c) setTheme(c.dataset.theme);
  });
  $('#font-dec').addEventListener('click', () => setFontSize(state.fontSize - 1));
  $('#font-inc').addEventListener('click', () => setFontSize(state.fontSize + 1));
  const lt = $('#login-toggle');
  lt.addEventListener('change', async () => {
    lt.checked = await api.setLogin(lt.checked);
    showToast(lt.checked ? 'Se abrirá sola al encender el PC, con tus sesiones.' : 'Ya no se abrirá al encender el PC.');
  });
  const lm = $('#lowmem-toggle');
  lm.addEventListener('change', () => {
    state.lowMemory = lm.checked;
    save();
    showToast('Se aplicará la próxima vez que abras la app. Tus sesiones se reabren solas.', null, null, 6000);
  });
  $('#notify-toggle').addEventListener('change', (e) => { state.notify = e.target.checked; save(); });
  $('#sleep-after').addEventListener('change', (e) => { state.sleepAfter = Number(e.target.value); save(); });
  $('#lazy-toggle').addEventListener('change', (e) => { state.lazyStart = e.target.checked; save(); });
  $('#limit-alert').addEventListener('change', (e) => { state.limitAlert = Number(e.target.value); save(); checkAlerts(); });
  $('#cost-alert').addEventListener('change', (e) => { state.costAlert = Number(e.target.value); save(); checkAlerts(); });
  const ai = $('#ai-toggle');
  ai.addEventListener('change', () => {
    state.aiTitles = ai.checked;
    api.setPrefs({ aiTitles: state.aiTitles });
    save();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#settings').hidden) { closeSettings(); e.preventDefault(); return; }
    if (e.key === 'Escape' && !$('#diff-pop').hidden) { closeDiff(); e.preventDefault(); return; }
    if (handleShortcut(e)) e.preventDefault();
  });

  api.onData((id, d) => {
    const v = views.get(id);
    if (v) v.term.write(d);
  });
  api.onExit((id, code) => {
    const v = views.get(id);
    if (!v) return;
    v.exited = true;
    const g = '\x1b[38;2;125;125;145m';
    const o = '\x1b[38;2;255;138;92m';
    v.term.write(`\r\n${g}──── Claude se ha cerrado${code > 0 ? ` (código ${code})` : ''}. Pulsa ${o}Enter${g} para reabrir esta conversación ────\x1b[0m\r\n`);
    scheduleRender(id);
  });
  api.onTabInfo((p) => {
    if (!views.has(p.tabId)) return;
    const prev = info.get(p.tabId);
    info.set(p.tabId, p);
    const tab = views.get(p.tabId).tab;
    if (p.sessionId && p.sessionId !== tab.sessionId) { tab.sessionId = p.sessionId; save(); }
    // sesión aislada: Claude ha creado su worktree y trabaja allí; se reabrirá en esa carpeta
    if (tab.worktree && p.cwd && !samePath(p.cwd, tab.cwd)) {
      tab.cwd = p.cwd;
      tab.wtPending = false;
      save();
      renderTabs();
    }
    if (prev && prev.status !== p.status) onStatusChange(tab, prev, p);
    // solo pruebas: usa los controles y abre un diff por el mismo camino que la interfaz
    if (sys.test && p.status === 'done' && !tab.testDone && /ctl|diff/.test(sys.test)) {
      tab.testDone = true;
      if (sys.test.includes('ctl')) setTimeout(async () => { await applyControl(tab.id, 'effort', 'low'); await wait(3000); await applyControl(tab.id, 'mode', 'plan'); }, 1500);
      if (sys.test.includes('diff')) setTimeout(() => { const a = ((info.get(tab.id) || {}).actions || []).find((x) => x.diff); if (a) openDiff(tab.id, a.id); }, 9000);
    }
    // solo pruebas: aprueba sola por el mismo camino que el botón
    if (sys.test && sys.test.includes('approve') && p.status === 'needs' && p.need && p.need.kind === 'permission' && !tab.testApproving) {
      tab.testApproving = true;
      setTimeout(() => { tab.testApproving = false; respond(tab.id, 'approve'); }, 4000);
    }
    scheduleRender(p.tabId);
  });
  api.onLimits((l) => {
    const before = weekStart();
    limits = l;
    if (weekStart() !== before) refreshReport(); // la semana de tu plan empieza en otro momento
    scheduleRender();
    checkAlerts();
  });
  api.onWinFocus(async () => {
    projects = await api.listProjects();
    renderProjects();
  });
}

// ---------- arranque: restaura las sesiones que tenías abiertas ----------
(async function init() {
  const [saved, infoSys, plist, login] = await Promise.all([api.loadState(), api.sysInfo(), api.listProjects(), api.getLogin()]);
  sys = infoSys;
  projects = plist;
  Object.assign(state, saved, { tabs: saved.tabs || [] });
  for (const k of ['favorites', 'extraFolders', 'hidden']) if (!Array.isArray(state[k])) state[k] = [];
  if (!['tabs', 'grid'].includes(state.layout)) state.layout = 'tabs';
  state.fontSize = Number(state.fontSize) || 14;
  state.sidebar = state.sidebar !== false;
  state.aiTitles = state.aiTitles !== false;
  state.notify = state.notify !== false;
  state.limitAlert = Number(state.limitAlert ?? 80);
  state.costAlert = Number(state.costAlert ?? 0);
  if (!Array.isArray(state.alerted)) state.alerted = [];
  state.sleepAfter = Number(state.sleepAfter ?? 30);
  state.lazyStart = state.lazyStart !== false;
  $('#sleep-after').value = String(state.sleepAfter);
  $('#lazy-toggle').checked = state.lazyStart;
  $('#notify-toggle').checked = state.notify;
  $('#limit-alert').value = String(state.limitAlert);
  $('#cost-alert').value = String(state.costAlert);
  xtermLook = applyTheme(THEMES[state.theme] ? state.theme : 'brasa');
  document.body.classList.toggle('no-sidebar', !state.sidebar);
  $('#font-size').textContent = state.fontSize;
  $('#login-toggle').checked = login;
  $('#lowmem-toggle').checked = !!state.lowMemory;
  $('#ai-toggle').checked = state.aiTitles;
  wireEvents();
  setSideView(state.sideView);
  try { await document.fonts.load(`${state.fontSize}px "Cascadia Mono"`); } catch { /* fuente del sistema */ }

  for (const t of state.tabs) createView(t);
  refreshUI();
  setActive(views.has(state.activeId) ? state.activeId : (state.tabs[0] || {}).id);
  api.ready(); // muestra la ventana ya pintada (sin parpadeo blanco)
  if (!sys.claude) showToast('No encuentro Claude Code instalado (claude.exe).', null, null, 15000);
  else if (sys.storeInExe === false) showToast('Esta unidad no deja guardar dentro del .exe: tus datos van a %APPDATA%\\desguaproterm.', null, null, 10000);

  if (sys.test && sys.test.includes('settings')) openSettings();
  if (sys.test && sys.test.includes('toast')) api.notify('', 'desguaproterm', 'Aviso de prueba: los avisos de Windows funcionan', [['Ver', 'view']]);
  const testSearch = sys.test && /search:([^|]+)/.exec(sys.test);
  if (testSearch) { setSideView('projects'); $('#search').value = testSearch[1]; search = testSearch[1]; renderProjects(); runConvSearch(search); }
  refreshReport();
  setInterval(refreshReport, 15000);
  setInterval(() => { for (const id of views.keys()) scheduleRender(id); }, 5000); // tiempos transcurridos

  setInterval(checkSleep, 60000);

  // al encender: arranca la pestaña activa (o todas si así lo prefieres); las demás duermen
  // hasta que entres en ellas, cada una con su conversación
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const lazy = state.lazyStart && Number(state.sleepAfter) > 0 && state.layout === 'tabs';
  for (const v of [...views.values()]) {
    if (lazy && v.tab.id !== state.activeId) { sleepTab(v, true); continue; }
    start(v);
    await new Promise((r) => setTimeout(r, 250));
  }
})();
