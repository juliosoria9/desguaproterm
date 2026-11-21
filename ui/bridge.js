'use strict';
// Puente entre la interfaz y el núcleo en Rust (Tauri). Expone `window.api`.
(() => {
  const T = window.__TAURI__;
  const { invoke, Channel } = T.core;
  const handlers = { data: null, exit: null };
  const live = new Map(); // tabId -> token de la sesión actual (descarta salida de sesiones ya cerradas)

  window.api = {
    sysInfo: () => invoke('sys_info'),
    loadState: () => invoke('state_load'),
    saveState: (state) => invoke('state_save', { state }).catch((e) => console.error('guardar estado', e)),
    spawn: ({ tabId, cwd, sessionId, cols, rows, worktree, model, effort, mode }) => {
      const token = {};
      live.set(tabId, token);
      const onData = new Channel();
      onData.onmessage = (buf) => { if (live.get(tabId) === token && handlers.data) handlers.data(tabId, new Uint8Array(buf)); };
      const onExit = new Channel();
      onExit.onmessage = (code) => { if (live.get(tabId) === token && handlers.exit) handlers.exit(tabId, code); };
      return invoke('pty_spawn', {
        tabId, cwd, sessionId, cols, rows, worktree: !!worktree,
        model: model || null, effort: effort || null, mode: mode || null, onData, onExit,
      });
    },
    write: (tabId, data) => invoke('pty_write', { tabId, data }),
    resize: (tabId, cols, rows) => invoke('pty_resize', { tabId, cols, rows }),
    kill: (tabId, forget) => { live.delete(tabId); return invoke('pty_kill', { tabId, forget: !!forget }); },
    onData: (cb) => { handlers.data = cb; },
    onExit: (cb) => { handlers.exit = cb; },
    onWinFocus: (cb) => T.event.listen('win-focus', () => cb()),
    // monitor: estado, tokens y subagentes de cada sesión
    onTabInfo: (cb) => T.event.listen('tab-info', (e) => cb(e.payload)),
    snapshot: () => invoke('monitor_snapshot'),
    usageReport: (today, week, chartFrom, tz) => invoke('usage_report', { today, week, chartFrom, tz }),
    onLimits: (cb) => T.event.listen('limits', (e) => cb(e.payload)),
    searchConversations: (query) => invoke('search_conversations', { query }),
    actionDiff: (tabId, actionId) => invoke('action_diff', { tabId, actionId }),
    watchOnly: (tabId, sessionId) => invoke('monitor_watch', { tabId, sessionId }),
    // avisos de Windows con botones
    notify: (tabId, title, body, buttons) => invoke('notify', { tabId, title, body, buttons }).catch(() => {}),
    onToastAction: (cb) => T.event.listen('toast-action', (e) => cb(e.payload)),
    // imágenes: portapapeles y archivos arrastrados
    clipImage: () => invoke('clip_image'),
    filePreview: (path) => invoke('file_preview', { path }),
    pathKind: (path) => invoke('path_kind', { path }),
    onDragDrop: (cb) => T.webview.getCurrentWebview().onDragDropEvent((e) => cb(e.payload)),
    setPrefs: (p) => invoke('set_prefs', { aiTitles: !!p.aiTitles }),
    listProjects: () => invoke('projects_list'),
    pickFolder: () => invoke('pick_folder'),
    clipRead: () => invoke('clip_read'),
    clipWrite: (text) => invoke('clip_write', { text: String(text) }),
    openExternal: (url) => invoke('open_external', { url }),
    openFolder: (path) => invoke('open_folder', { path }),
    getLogin: () => invoke('login_get'),
    setLogin: (on) => invoke('login_set', { on: !!on }),
    attention: () => invoke('attention'),
    ready: () => invoke('ui_ready'),
  };

  // errores de la interfaz → flujo "log" dentro del .exe
  const log = (msg) => invoke('log_js', { msg: String(msg) }).catch(() => {});
  window.addEventListener('error', (e) => log(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log(`promesa: ${e.reason && (e.reason.stack || e.reason)}`));

  // red de seguridad: la ventana empieza oculta; si la interfaz fallara al arrancar, se muestra igual
  setTimeout(() => invoke('ui_ready').catch(() => {}), 4000);

  // botones de la ventana (la barra de título es nuestra)
  const win = T.window.getCurrentWindow();
  document.getElementById('win-min').addEventListener('click', () => win.minimize());
  document.getElementById('win-max').addEventListener('click', () => win.toggleMaximize());
  document.getElementById('win-close').addEventListener('click', () => win.close());
  const syncMax = async () => document.body.classList.toggle('maximized', await win.isMaximized());
  win.onResized(syncMax);
  syncMax();
})();
