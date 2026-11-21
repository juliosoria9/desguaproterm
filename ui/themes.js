'use strict';
// Temas de desguaproterm: colores de la interfaz y de la terminal, tipografía y efectos.
// c: interfaz · ansi: los 16 colores de la terminal · fx: efectos (clases fx-* en <body>)
const FONTS = {
  ui: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  display: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  ind: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
};

const THEMES = {
  brasa: {
    name: 'Brasa', desc: 'Oscuro cálido, sobrio', font: 'ui', fx: [],
    c: { bg: '#0b0b10', panel: '#101017', panel2: '#15151e', panel3: '#1b1b26', line: '#22222e', line2: '#2d2d3b', text: '#e8e8ef', dim: '#9393a6', faint: '#5e5e70', accent: '#ff8a5c', accent2: '#ffb37a', ok: '#5ad19a', work: '#ff8a5c', need: '#6aa7ff', err: '#ff6b6b', term: '#0d0d13' },
    ansi: ['#1b1b24', '#ff6b6b', '#5ad19a', '#f2c66d', '#6aa7ff', '#c792ea', '#5fd4e0', '#cfd0da', '#5b5b6e', '#ff8787', '#7ee2b0', '#ffd98a', '#8fbcff', '#d9a8ff', '#8ae6ef', '#ffffff'],
  },
  hacker: {
    name: 'Hacker', desc: 'Fósforo verde, líneas de barrido', font: 'mono', fx: ['scan', 'glow'],
    c: { bg: '#000500', panel: '#020a03', panel2: '#041206', panel3: '#07200b', line: '#0b3312', line2: '#11501c', text: '#b8ffc9', dim: '#4fd06e', faint: '#237a37', accent: '#00ff66', accent2: '#7dffae', ok: '#00ff66', work: '#d4ff00', need: '#00e5ff', err: '#ff3b3b', term: '#000300' },
    ansi: ['#001a06', '#ff3b3b', '#00ff66', '#d4ff00', '#00c8ff', '#b06bff', '#00ffd5', '#b8ffc9', '#1f6b33', '#ff6b6b', '#5dff95', '#eaff66', '#5ad8ff', '#c99bff', '#66ffe3', '#eafff0'],
  },
  retro: {
    name: 'Retro', desc: 'Monitor ámbar de los 80', font: 'mono', fx: ['scan', 'glow', 'vignette'],
    c: { bg: '#0d0700', panel: '#140b02', panel2: '#1c1004', panel3: '#261607', line: '#3a220a', line2: '#55320f', text: '#ffcc66', dim: '#d39a3a', faint: '#8a6223', accent: '#ffb000', accent2: '#ffd27a', ok: '#ffd27a', work: '#ffb000', need: '#ff7a2f', err: '#ff4d2e', term: '#0a0500' },
    ansi: ['#1a0f00', '#ff5a36', '#ffb000', '#ffd27a', '#e09030', '#ff8c5a', '#ffc860', '#ffcc66', '#5c3d10', '#ff7a5a', '#ffc233', '#ffe0a0', '#f0a850', '#ffa07a', '#ffd890', '#fff0d0'],
  },
  colorido: {
    name: 'Colorido', desc: 'Morado vibrante con toques de color', font: 'display', fx: ['blobs'],
    c: { bg: '#120a24', panel: '#1a1033', panel2: '#22153f', panel3: '#2c1b52', line: '#3a2668', line2: '#4b3285', text: '#fff4fb', dim: '#c7b6e6', faint: '#8c79b8', accent: '#ff4fd8', accent2: '#ffd23f', ok: '#3dffa8', work: '#ff9f1c', need: '#3ec5ff', err: '#ff4f6d', term: '#140c29' },
    ansi: ['#22153f', '#ff4f6d', '#3dffa8', '#ffd23f', '#3ec5ff', '#ff4fd8', '#47f5f0', '#fff4fb', '#6b5a99', '#ff7a90', '#7dffc4', '#ffe27a', '#7ad6ff', '#ff8ae6', '#8afaf6', '#ffffff'],
  },
  neon84: {
    name: 'Neón 84', desc: 'Synthwave: atardecer y rejilla', font: 'display', fx: ['synth', 'glow'],
    c: { bg: '#0c0618', panel: '#120a24', panel2: '#190e30', panel3: '#22133f', line: '#2e1a52', line2: '#43246f', text: '#f6e9ff', dim: '#c3a6e8', faint: '#7c5fa8', accent: '#ff2bd6', accent2: '#2de2e6', ok: '#2de2e6', work: '#ff2bd6', need: '#fcee0c', err: '#ff3864', term: '#0b0517' },
    ansi: ['#1a0f33', '#ff3864', '#2de2e6', '#fcee0c', '#3d7bff', '#ff2bd6', '#2de2e6', '#f6e9ff', '#5a3f8a', '#ff6b8f', '#7ff1f3', '#fff35c', '#6f9bff', '#ff6be3', '#9af5f7', '#ffffff'],
  },
  desguace: {
    name: 'Desguace', desc: 'Acero, óxido y franjas de peligro', font: 'ind', fx: ['hazard'],
    c: { bg: '#121212', panel: '#1a1a1a', panel2: '#212121', panel3: '#2a2a2a', line: '#333333', line2: '#444444', text: '#ececec', dim: '#a8a8a8', faint: '#6b6b6b', accent: '#ffc400', accent2: '#ff7a00', ok: '#8bd450', work: '#ffc400', need: '#4fc3f7', err: '#ff5252', term: '#141414' },
    ansi: ['#1e1e1e', '#ff5252', '#8bd450', '#ffc400', '#4fc3f7', '#ce93d8', '#4dd0e1', '#e0e0e0', '#5a5a5a', '#ff7b7b', '#a9e27a', '#ffd54f', '#81d4fa', '#e1bee7', '#80deea', '#ffffff'],
  },
  abisal: {
    name: 'Abisal', desc: 'Fondo marino bioluminiscente', font: 'ui', fx: ['bubbles'],
    c: { bg: '#020b14', panel: '#06121f', panel2: '#0a1a2b', panel3: '#0f2438', line: '#12304a', line2: '#1a4263', text: '#d9f3ff', dim: '#7fb4d1', faint: '#44718c', accent: '#2ef2e0', accent2: '#7b9cff', ok: '#2ef2a0', work: '#2ef2e0', need: '#c792ff', err: '#ff6b8b', term: '#03101b' },
    ansi: ['#06192a', '#ff6b8b', '#2ef2a0', '#f7d774', '#4aa8ff', '#c792ff', '#2ef2e0', '#d9f3ff', '#2a4d68', '#ff8fa6', '#6ff7bf', '#fae39b', '#7dc1ff', '#d9b3ff', '#6ff6ea', '#ffffff'],
  },
  papel: {
    name: 'Papel', desc: 'Claro, tinta sobre papel', font: 'ui', fx: ['light'], contrast: 4.5,
    c: { bg: '#f3eee3', panel: '#ebe4d6', panel2: '#e3dac8', panel3: '#d9cfba', line: '#d2c6ae', line2: '#bfb092', text: '#2b2620', dim: '#6b6152', faint: '#9a8d76', accent: '#c2410c', accent2: '#a16207', ok: '#15803d', work: '#c2410c', need: '#1d4ed8', err: '#b91c1c', term: '#faf6ee' },
    ansi: ['#2b2620', '#b91c1c', '#15803d', '#a16207', '#1d4ed8', '#7e22ce', '#0e7490', '#e7e0d2', '#6b6152', '#dc2626', '#16a34a', '#ca8a04', '#2563eb', '#9333ea', '#0891b2', '#fffdf8'],
  },
};

const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Aplica un tema a la interfaz y devuelve el tema de xterm correspondiente. */
function applyTheme(id) {
  const t = THEMES[id] || THEMES.brasa;
  const c = t.c;
  const css = {
    '--bg': c.bg, '--panel': c.panel, '--panel-2': c.panel2, '--panel-3': c.panel3, '--line': c.line, '--line-2': c.line2,
    '--text': c.text, '--dim': c.dim, '--faint': c.faint, '--accent': c.accent, '--accent-2': c.accent2,
    '--ok': c.ok, '--work': c.work, '--need': c.need, '--err': c.err, '--term-bg': c.term,
    '--accent-a08': hexA(c.accent, 0.08), '--accent-a15': hexA(c.accent, 0.15), '--accent-a30': hexA(c.accent, 0.3), '--accent-a50': hexA(c.accent, 0.5),
    '--need-a25': hexA(c.need, 0.25), '--work-a40': hexA(c.work, 0.4), '--ui': FONTS[t.font] || FONTS.ui,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(css)) root.style.setProperty(k, v);
  root.style.colorScheme = t.fx.includes('light') ? 'light' : 'dark';
  document.body.className = document.body.className.replace(/\b(fx|theme)-\S+/g, '').trim();
  document.body.classList.add(`theme-${id}`, ...t.fx.map((f) => `fx-${f}`));
  const xt = {
    background: c.term, foreground: c.text, cursor: c.accent, cursorAccent: c.term,
    selectionBackground: hexA(c.accent, 0.3), selectionInactiveBackground: hexA(c.accent, 0.15),
  };
  ANSI_KEYS.forEach((k, i) => { xt[k] = t.ansi[i]; });
  return { xterm: xt, contrast: t.contrast || 1 };
}

/** Miniatura del tema para el selector de Ajustes. */
function themePreview(id) {
  const t = THEMES[id];
  const c = t.c;
  const line = (w, col) => `<i style="width:${w}%;background:${col}"></i>`;
  return `<div class="tp" style="background:${c.bg};border-color:${c.line2}">
    <div class="tp-bar" style="background:${c.panel};border-color:${c.line}"><b style="background:${c.accent}"></b></div>
    <div class="tp-body">
      <div class="tp-side" style="background:${c.panel};border-color:${c.line}">${line(70, c.dim)}${line(50, c.faint)}${line(60, c.faint)}</div>
      <div class="tp-term" style="background:${c.term}">${line(55, t.ansi[2])}${line(80, c.text)}${line(40, t.ansi[4])}${line(65, c.accent)}</div>
    </div></div>`;
}
