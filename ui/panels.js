'use strict';
// Panel de resumen y de gasto (izquierda) y panel de agentes de cada sesión (derecha).
// Los datos llegan del monitor en Rust: evento "tab-info" (se guarda en `info`, app.js) y el
// informe de gasto (`report`).

const STATUS = {
  needs: { label: 'Te necesita', group: 'Te necesitan' },
  error: { label: 'Error', group: 'Te necesitan' },
  working: { label: 'Trabajando', group: 'Trabajando' },
  done: { label: 'Acabada', group: 'Acabadas' },
  idle: { label: 'En espera', group: 'En espera' },
  sleeping: { label: 'Dormida', group: 'Dormidas' },
  exited: { label: 'Cerrada', group: 'Cerradas' },
};
const GROUPS = [['needs', ['needs', 'error']], ['working', ['working']], ['done', ['done']], ['idle', ['idle']], ['sleeping', ['sleeping']], ['exited', ['exited']]];
/** Memoria aproximada que libera cada sesión dormida (medida: ~490 MB por Claude). */
const SLEEP_SAVING_GB = 0.49;

// ---------- formatos ----------
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtTok(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n < 1e4 ? nf1 : nf0).format(n / 1e3)}k`;
  return `${nf1.format(n / 1e6)} M`;
}
function fmtUSD(n) {
  n = n || 0;
  return n > 0 && n < 0.01 ? '<0,01 US$' : usd.format(n);
}
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return new Date().toDateString() === d.toDateString() ? `hoy ${hm}` : `${DAYS[d.getDay()]} ${hm}`;
}
/** "claude-opus-5-5" → "opus 5.5" */
function prettyModel(m) {
  if (!m) return '';
  const parts = m.replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '').split('-');
  const name = parts.filter((p) => !/^\d+$/.test(p)).join(' ');
  const ver = parts.filter((p) => /^\d+$/.test(p)).join('.');
  return ver ? `${name} ${ver}` : name;
}
const usageSum = (u) => (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
const costOf = (u) => (u && u.cost) || 0;
/** Líneas añadidas/quitadas: "+120 −34 · 3 archivos" */
function fmtLines(x, withFiles = true) {
  if (!x || (!x.added && !x.removed)) return '';
  const files = withFiles && x.files ? ` · ${x.files} ${x.files === 1 ? 'archivo' : 'archivos'}` : '';
  return `<span class="lines" title="Líneas que ha escrito y quitado Claude"><b class="add">+${nf0.format(x.added || 0)}</b> <b class="del">−${nf0.format(x.removed || 0)}</b>${files}</span>`;
}
/** Qué parte del gasto de la semana es esto (ponderado por precio). */
function weekPct(cost) {
  const total = report && report.week ? report.week.cost : 0;
  if (!total || !cost) return '';
  const p = (cost / total) * 100;
  return `${p < 0.1 ? '<0,1' : nf1.format(p)}%`;
}
const PCT_TIP = 'Parte de todo lo gastado esta semana, ponderado por precio (un token generado cuenta más que uno leído de caché)';
const statusOf = (tab) => {
  const inf = info.get(tab.id);
  const v = views.get(tab.id);
  if (v && v.sleeping) return 'sleeping';
  if (v && v.exited) return 'exited';
  return (inf && inf.status) || 'idle';
};
const topicOf = (tab) => {
  const inf = info.get(tab.id);
  return tab.name || (inf && (inf.shortTitle || inf.title)) || '';
};
const agentIcon = (a) => (a.running ? '<span class="a-icon spin"></span>' : `<span class="a-icon check">${ICON.check}</span>`);

/** Qué te pide una sesión que te necesita, con botones para responder sin ir a la pestaña. */
function needBlock(tab) {
  const inf = info.get(tab.id) || {};
  const need = inf.need;
  if (statusOf(tab) !== 'needs' || !need) return '';
  const label = { permission: 'Quiere', question: 'Te pregunta', plan: 'Plan' }[need.kind] || 'Te necesita';
  const buttons = need.kind === 'permission'
    ? `<div class="need-btns"><button class="btn ok" data-act="approve" data-tab="${tab.id}">Aprobar</button><button class="btn no" data-act="deny" data-tab="${tab.id}">Rechazar</button></div>`
    : '';
  return `<div class="need">${need.what ? `<div class="need-what"><span>${label}:</span> ${esc(need.what)}</div>` : ''}${buttons}</div>`;
}

// ---------- informe de gasto ----------
let report = null; // { today, week, weekStart, byModel, tasks, days, limits }
let limits = null; // % usado de los límites del plan (de la barra de estado de Claude)

/** Inicio de la semana: la ventana de 7 días de tu plan si se conoce; si no, el lunes a las 0:00. */
function weekStart() {
  const r = limits && limits.seven_day && limits.seven_day.resets_at;
  if (r) return r * 1000 - 7 * 86400000;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

async function refreshReport() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const chartFrom = new Date(midnight);
  chartFrom.setDate(chartFrom.getDate() - 13);
  try {
    report = await api.usageReport(midnight.getTime(), weekStart(), chartFrom.getTime(), -new Date().getTimezoneOffset() * 60000);
    if (report.limits && !limits) limits = report.limits;
  } catch { /* sin datos */ }
  scheduleRender();
  if (state.sideView === 'spend') renderSpend();
  if (typeof checkAlerts === 'function') checkAlerts();
}

/** Gasto de esta semana de una conversación (suma de sus tareas). */
function sessionWeekCost(sessionId) {
  if (!report) return 0;
  return report.tasks.reduce((s, t) => s + (t.sessionId === sessionId ? costOf(t.usage) : 0), 0);
}

// ---------- resumen general ----------
function limitRow(label, l) {
  if (!l || l.used_percentage == null) return '';
  const p = Math.max(0, Math.min(100, l.used_percentage));
  const when = l.resets_at ? `se renueva ${fmtWhen(l.resets_at * 1000)}` : '';
  return `<div class="lim"><div class="lim-label"><span>${label}</span><b>${nf0.format(p)}%</b></div>
    <div class="meter${p >= 80 ? ' hot' : ''}"><i style="width:${p}%"></i></div><div class="lim-when">${when}</div></div>`;
}

function tokenCard() {
  if (!report) return '<div class="tok-card"><div class="tok-head"><span>Gasto de hoy</span><b>…</b></div></div>';
  const t = report.today;
  const w = report.week;
  const total = usageSum(t) || 1;
  const seg = (n, k) => (n ? `<i class="${k}" style="width:${(n / total) * 100}%;min-width:3px"></i>` : '');
  const lim = limits || report.limits;
  const limHtml = lim ? limitRow('Límite de 5 h', lim.five_hour) + limitRow('Límite semanal', lim.seven_day) : '';
  return `<div class="tok-card">
    <div class="tok-head"><span>Gasto de hoy</span><b>${fmtTok(usageSum(t))}</b></div>
    <div class="tok-sub"><span title="Lo que costaría por la API de Anthropic">${fmtUSD(t.cost)} por API</span><span title="${PCT_TIP}">${weekPct(t.cost) || '0%'} de la semana</span></div>
    <div class="tok-bar">${seg(t.output, 'k-out')}${seg(t.input, 'k-in')}${seg(t.cacheWrite, 'k-cw')}${seg(t.cacheRead, 'k-cr')}</div>
    <div class="tok-legend">
      <span><i class="k-out"></i>Generados<b>${fmtTok(t.output)}</b></span>
      <span><i class="k-in"></i>Entrada<b>${fmtTok(t.input)}</b></span>
      <span><i class="k-cw"></i>Caché escrita<b>${fmtTok(t.cacheWrite)}</b></span>
      <span><i class="k-cr"></i>Caché leída<b>${fmtTok(t.cacheRead)}</b></span>
    </div>
    <div class="tok-week"><span>Esta semana</span><b>${fmtTok(usageSum(w))}</b><b class="usd">${fmtUSD(w.cost)}</b></div>
    <div class="tok-models">${(report.byModel || []).slice(0, 4).map((m) => `<span class="chip" title="Esta semana">${esc(prettyModel(m.model))} <b>${fmtUSD(costOf(m.usage))}</b></span>`).join('')}</div>
    ${limHtml ? `<div class="lims" title="Uso de los límites de tu plan, según Claude Code (lo mismo que /usage)">${limHtml}</div>` : ''}
  </div>`;
}

function agentLine(a) {
  return `<div class="s-agent ${a.running ? 'run' : 'done'}">${agentIcon(a)}
    <span class="a-desc"><b>${esc(a.kind || 'agente')}</b>${esc(a.description || '')}</span>
    ${a.running && a.activity ? `<span class="a-act">${esc(a.activity)}</span>` : ''}</div>`;
}

function sessionCard(tab, now) {
  const inf = info.get(tab.id) || {};
  const st = statusOf(tab);
  const topic = topicOf(tab) || 'Nueva sesión';
  const sub = { working: inf.activity || 'Trabajando…', error: 'Falló la última petición' }[st] || '';
  const agents = (inf.agents || []).filter((a) => !a.old);
  const shown = agents.slice(0, 4);
  const pct = weekPct(sessionWeekCost(tab.sessionId));
  return `<div class="s-card st-${st}${tab.id === state.activeId ? ' active' : ''}" data-id="${tab.id}" style="--c:${colorOf(tab.cwd)}">
    <div class="s-top"><span class="dot ${st}"></span><span class="s-title">${esc(topic)}</span>
      <span class="s-time" title="${STATUS[st].label} desde hace">${inf.since ? fmtDur(now - inf.since) : ''}</span></div>
    <div class="s-sub"><span class="s-proj">${esc(projLabel(tab))}</span>${sub ? ` · ${esc(sub)}` : ''}</div>
    ${needBlock(tab)}
    ${st === 'done' && inf.lastMessage ? `<div class="s-msg">${esc(inf.lastMessage)}</div>` : ''}
    ${shown.length ? `<div class="s-agents">${shown.map(agentLine).join('')}${agents.length > shown.length ? `<div class="s-agent done"><span></span><span class="a-act">y ${agents.length - shown.length} más…</span></div>` : ''}</div>` : ''}
    <div class="s-meta"><span title="Tokens de esta conversación y sus subagentes">Σ ${fmtTok(usageSum(inf.usage))}</span>
      <span class="usd" title="Lo que costaría por API">${fmtUSD(costOf(inf.usage))}</span>
      ${pct ? `<span title="${PCT_TIP}">${pct} sem.</span>` : ''}${fmtLines(inf.lines, false)}</div>
  </div>`;
}

function renderSummary() {
  const box = $('#summary');
  const now = Date.now();
  let html = tokenCard();
  if (!state.tabs.length) {
    html += '<div class="s-empty">No hay sesiones abiertas.<br>Abre un proyecto desde <b>Proyectos</b>.</div>';
  }
  for (const [key, statuses] of GROUPS) {
    const tabs = state.tabs.filter((t) => statuses.includes(statusOf(t)));
    if (!tabs.length) continue;
    const saving = key === 'sleeping' ? `<span class="save" title="Memoria que no ocupan mientras duermen">≈ ${nf1.format(tabs.length * SLEEP_SAVING_GB)} GB libres</span>` : '';
    html += `<div class="s-group ${key}"><div class="s-group-title">${STATUS[statuses[0]].group}<span class="n">${tabs.length}</span>${saving}</div>
      ${tabs.map((t) => sessionCard(t, now)).join('')}</div>`;
  }
  box.innerHTML = html;
  const needs = state.tabs.filter((t) => ['needs', 'error'].includes(statusOf(t))).length;
  $('#needs-count').textContent = needs || '';
  $('#foot-info').textContent = report ? `hoy ${fmtUSD(report.today.cost)} · sem. ${fmtUSD(report.week.cost)}` : '';
}

// ---------- gráfica: gasto por día (14 días) ----------
function niceMax(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * e).find((m) => v <= m) || 10 * e;
}

function renderChart() {
  const box = $('#spend-chart');
  const days = (report && report.days) || [];
  if (!days.length) { box.innerHTML = ''; return; }
  const costs = days.map((d) => costOf(d.usage));
  const top = niceMax(Math.max(...costs, 0.01));
  const todayCost = costs[costs.length - 1];
  const iMax = costs.indexOf(Math.max(...costs));
  const maxDay = new Date(days[iMax].start);
  const cols = days.map((d, i) => {
    const c = costs[i];
    const date = new Date(d.start);
    const h = c ? Math.max(2, (c / top) * 100) : 0;
    const today = i === days.length - 1;
    return `<div class="ch-col${today ? ' today' : ''}" data-i="${i}">
      <div class="ch-slot">${h ? `<i style="height:${h}%"></i>` : ''}</div>
      <span class="ch-day">${today ? 'hoy' : DAY_LETTER[date.getDay()]}</span></div>`;
  }).join('');
  box.innerHTML = `
    <div class="ch-head"><span>Gasto por día</span><small>últimos 14 días · precio por API</small></div>
    <div class="ch-sub"><span>Hoy <b>${fmtUSD(todayCost)}</b></span><span>Máx. <b>${fmtUSD(costs[iMax])}</b> ${DAYS[maxDay.getDay()]} ${maxDay.getDate()}</span></div>
    <div class="ch-plot">
      <div class="ch-grid" style="bottom:100%"><span>${fmtUSD(top).replace(',00', '')}</span></div>
      <div class="ch-grid" style="bottom:50%"><span>${fmtUSD(top / 2).replace(',00', '')}</span></div>
      <div class="ch-cols">${cols}</div>
      <div class="ch-tip" hidden></div>
    </div>`;
  const tip = $('.ch-tip', box);
  $$('.ch-col', box).forEach((col) => {
    col.addEventListener('mouseenter', () => {
      const d = days[Number(col.dataset.i)];
      const date = new Date(d.start);
      tip.innerHTML = `<b>${DAYS[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}</b>
        <div>${fmtUSD(costOf(d.usage))} · ${fmtTok(usageSum(d.usage))} tokens</div>
        ${d.models.map((m) => `<div class="tm">${esc(prettyModel(m.model))} <span>${fmtUSD(m.cost)}</span></div>`).join('')}`;
      tip.hidden = false;
      const plot = col.parentElement.getBoundingClientRect();
      const r = col.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(0, r.left - plot.left + r.width / 2 - 70), plot.width - 140)}px`;
    });
    col.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

// ---------- gasto por tarea (vista "Gasto") ----------
const spend = { period: 'week', project: '', sort: 'cost', q: '' };

function spendTasks() {
  if (!report) return [];
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const q = spend.q.trim().toLowerCase();
  const list = report.tasks.filter((t) => (spend.period === 'week' || t.last >= midnight.getTime())
    && (!spend.project || samePath(t.project, spend.project))
    && (!q || t.prompt.toLowerCase().includes(q) || t.project.toLowerCase().includes(q)));
  const key = { cost: (t) => costOf(t.usage), tokens: (t) => usageSum(t.usage), lines: (t) => (t.added || 0) + (t.removed || 0), recent: (t) => t.started }[spend.sort];
  return list.sort((a, b) => key(b) - key(a));
}

function renderSpend() {
  renderChart();
  if (!report) { $('#spend-list').innerHTML = '<div class="s-empty">Calculando…</div>'; return; }
  const sel = $('#spend-project');
  const projects = [...new Set(report.tasks.map((t) => t.project).filter(Boolean))].sort((a, b) => baseName(a).localeCompare(baseName(b)));
  const opts = `<option value="">Todos los proyectos</option>${projects.map((p) => `<option value="${esc(p)}"${samePath(p, spend.project || '#') ? ' selected' : ''}>${esc(baseName(p))}</option>`).join('')}`;
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  $$('#spend-period button').forEach((b) => b.classList.toggle('on', b.dataset.period === spend.period));

  const tasks = spendTasks();
  const sum = tasks.reduce((s, t) => { s.tok += usageSum(t.usage); s.cost += costOf(t.usage); s.added += t.added || 0; s.removed += t.removed || 0; return s; }, { tok: 0, cost: 0, added: 0, removed: 0 });
  $('#spend-total').innerHTML = `<span><b>${tasks.length}</b> ${tasks.length === 1 ? 'tarea' : 'tareas'}</span>
    <span>${fmtTok(sum.tok)} tokens</span><span class="usd">${fmtUSD(sum.cost)}</span>
    <span title="${PCT_TIP}">${weekPct(sum.cost) || '0%'} de la semana</span>${fmtLines(sum, false)}`;
  const open = new Map(state.tabs.map((t) => [t.sessionId, t]));
  $('#spend-list').innerHTML = tasks.slice(0, 300).map((t, i) => {
    const tab = open.get(t.sessionId);
    return `<div class="task" data-i="${i}" title="${esc(t.prompt)}">
      <div class="task-main">
        <div class="task-prompt">${esc(t.prompt)}</div>
        <div class="task-meta"><span class="s-proj" style="--c:${colorOf(t.project || '?')}">${esc(baseName(t.project || '?'))}</span>
          <span>${fmtWhen(t.started)}</span>${t.agents ? `<span>${t.agents} ${t.agents === 1 ? 'agente' : 'agentes'}</span>` : ''}
          ${fmtLines(t)}${tab ? '<span class="open-dot" title="Abierta en una pestaña">●</span>' : ''}</div>
      </div>
      <div class="task-nums"><b class="usd">${fmtUSD(costOf(t.usage))}</b><span>${fmtTok(usageSum(t.usage))}</span>
        <span class="pct" title="${PCT_TIP}">${weekPct(costOf(t.usage)) || '—'}</span></div>
    </div>`;
  }).join('') || '<div class="s-empty">No hay tareas con gasto en este periodo.</div>';
  renderSpend.list = tasks;
}

// ---------- panel de agentes de cada sesión ----------
function drawerHTML() {
  return `<aside class="drawer">
    <div class="d-strip" title="Agentes de esta sesión (Ctrl+Shift+A)">${ICON.bot}<span class="n zero">0</span><span class="vt">Agentes</span></div>
    <div class="d-full"><div class="d-head"><h3>Agentes</h3><button class="pane-btn d-min" title="Minimizar (Ctrl+Shift+A)">${ICON.chevRight}</button></div>
    <div class="d-scroll"></div></div></aside>`;
}

function agentCard(a, now) {
  const dur = a.started ? fmtDur((a.ended || now) - a.started) : '';
  return `<div class="agent ${a.running ? 'run' : 'done'}">
    <div class="d-row">${agentIcon(a)}<b>${esc(a.kind || 'agente')}</b><span class="a-time">${dur}</span></div>
    ${a.description ? `<div class="a-desc2">${esc(a.description)}</div>` : ''}
    <div class="a-now">${esc(a.running ? (a.activity || 'Empezando…') : 'Terminado')}</div>
    <div class="a-foot">${a.model ? `<span class="chip">${esc(prettyModel(a.model))}</span>` : ''}<span class="chip">Σ <b>${fmtTok(usageSum(a.usage))}</b></span><span class="chip usd">${fmtUSD(costOf(a.usage))}</span></div>
  </div>`;
}

// ---------- controles rápidos: modelo, esfuerzo y modo ----------
const CTL_OPTIONS = {
  model: [['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']],
  effort: [['low', 'Bajo'], ['medium', 'Medio'], ['high', 'Alto'], ['xhigh', 'Muy alto'], ['max', 'Máximo']],
  mode: [['manual', 'Pedir permiso'], ['acceptEdits', 'Aceptar ediciones'], ['plan', 'Plan'], ['auto', 'Auto']],
};
const CTL_LABEL = { model: 'Modelo', effort: 'Esfuerzo', mode: 'Modo' };
function modelFamily(m) {
  if (!m) return '';
  if (/fable|mythos/.test(m)) return 'fable';
  return ['opus', 'sonnet', 'haiku'].find((f) => m.includes(f)) || '';
}
function controlsRow(v, inf, st) {
  const off = !['idle', 'done'].includes(st);
  const cur = {
    model: v.tab.model || modelFamily(inf.liveModel || inf.model),
    effort: v.tab.effort || currentEffort(v),
    mode: currentMode(v) || v.tab.mode || '',
  };
  const sel = (kind) => `<label class="ctl"><span>${CTL_LABEL[kind]}</span><select data-ctl="${kind}" data-tab="${v.tab.id}"${off ? ' disabled' : ''}>
      ${cur[kind] ? '' : '<option value="" selected>—</option>'}${CTL_OPTIONS[kind].map(([val, txt]) => `<option value="${val}"${val === cur[kind] ? ' selected' : ''}>${txt}</option>`).join('')}</select></label>`;
  const tip = off ? 'Se puede cambiar cuando Claude no está trabajando' : 'Solo para esta sesión: no cambia tus valores por defecto de Claude';
  return `<div class="ctls" title="${tip}">${sel('model')}${sel('effort')}${sel('mode')}</div>`;
}

// ---------- actividad: lo que ha hecho (compacto; el resto, plegado) ----------
const hm = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
function activityBlock(v, inf, openDetails) {
  const acts = inf.actions || [];
  if (!acts.length) return '';
  const row = (a) => `<div class="act-row${a.diff ? ' has-diff' : ''}"${a.diff ? ` data-diff="${esc(a.id)}" data-tab="${v.tab.id}" title="Ver el cambio"` : ''}>
      <span class="act-t">${hm(a.ts)}</span><span class="act-x">${esc(a.text)}</span>${fmtLines(a, false)}</div>`;
  const rest = acts.slice(3);
  return `<div class="d-section">Actividad</div><div class="acts">${acts.slice(0, 3).map(row).join('')}
    ${rest.length ? `<details class="d-old" data-k="acts"${openDetails.has('acts') ? ' open' : ''}><summary>Ver ${rest.length} más</summary>${rest.map(row).join('')}</details>` : ''}</div>`;
}

function taskRow(t) {
  const dur = t.last && t.started ? fmtDur(t.last - t.started) : '';
  return `<div class="d-task" title="${esc(t.prompt)}">
    <div class="task-prompt">${esc(t.prompt)}</div>
    <div class="d-task-meta"><span class="usd">${fmtUSD(costOf(t.usage))}</span><span>${fmtTok(usageSum(t.usage))}</span>
      ${weekPct(costOf(t.usage)) ? `<span title="${PCT_TIP}">${weekPct(costOf(t.usage))} sem.</span>` : ''}
      ${t.agents ? `<span>${t.agents} ag.</span>` : ''}${fmtLines(t)}<span class="when">${fmtWhen(t.started)}${dur ? ` · ${dur}` : ''}</span></div>
  </div>`;
}

function renderDrawer(v) {
  const inf = info.get(v.tab.id) || {};
  const st = statusOf(v.tab);
  const agents = inf.agents || [];
  const running = agents.filter((a) => a.running).length;
  const n = $('.d-strip .n', v.pane);
  n.textContent = running;
  n.classList.toggle('zero', !running);
  if (v.pane.classList.contains('drawer-closed')) return; // no se pinta lo que no se ve
  const now = Date.now();
  const ctx = inf.ctx || 0;
  const ctxMax = ctx > 200000 ? 1000000 : 200000;
  const cur = agents.filter((a) => !a.old);
  const old = agents.filter((a) => a.old);
  // los comandos que no gastan nada (/clear, /effort…) no son tareas que interesen
  const tasks = (inf.tasks || []).filter((t) => usageSum(t.usage) > 0 || !t.prompt.startsWith('/'));
  const what = {
    working: inf.activity || 'Trabajando…',
    needs: inf.need && inf.need.what ? '' : 'Esperando tu respuesta en la terminal',
    done: inf.lastMessage || 'Terminó',
    error: 'Falló la última petición',
    exited: 'Sesión cerrada',
  }[st] ?? 'Esperando tu mensaje';
  const scroll = $('.d-scroll', v.pane);
  // no repintar mientras eliges en un desplegable (se cerraría); si se queda con el foco, a los
  // pocos segundos se repinta igual para que el panel no se quede congelado
  const focused = document.activeElement;
  if (scroll.contains(focused) && focused.tagName === 'SELECT') {
    if (!focused.dataset.since) focused.dataset.since = String(Date.now());
    if (Date.now() - Number(focused.dataset.since) < 6000) return;
    focused.blur();
  }
  const openDetails = new Set($$('details[open]', scroll).map((d) => d.dataset.k));
  const pct = weekPct(sessionWeekCost(v.tab.sessionId));
  const sleeping = st === 'sleeping';
  scroll.innerHTML = `
    <div class="d-main">
      <div class="d-row"><span class="dot ${st}"></span><span class="d-name">Claude</span><span class="pill ${st}">${STATUS[st].label}</span></div>
      ${sleeping
        ? `<div class="d-act dim">Dormida para ahorrar memoria (≈ ${nf1.format(SLEEP_SAVING_GB)} GB). Se despierta sola al volver a ella.</div>
           <div class="need-btns"><button class="btn ok" data-wake="${v.tab.id}">Despertar ahora</button></div>`
        : (what ? `<div class="d-act${st === 'working' ? '' : ' dim'}">${esc(what)}</div>` : '')}
      ${needBlock(v.tab)}
      ${sleeping || st === 'exited' ? '' : controlsRow(v, inf, st)}
      <div class="d-ctx"><div class="d-ctx-label"><span>Contexto</span><span>${fmtTok(ctx)} / ${fmtTok(ctxMax)}</span></div>
        <div class="meter"><i style="width:${Math.min(100, (ctx / ctxMax) * 100)}%"></i></div></div>
      <div class="d-stats">
        <div class="stat"><span>Precio API</span><b class="usd">${fmtUSD(costOf(inf.usage))}</b></div>
        <div class="stat" title="${PCT_TIP}"><span>De la semana</span><b>${pct || '0%'}</b></div>
        <div class="stat"><span>Generados</span><b>${fmtTok(inf.usage && inf.usage.output)}</b></div>
        <div class="stat"><span>Procesados</span><b>${fmtTok(usageSum(inf.usage))}</b></div>
      </div>
      ${inf.lines && (inf.lines.added || inf.lines.removed) ? `<div class="d-lines">Código tocado: ${fmtLines(inf.lines)}</div>` : ''}
      <div class="a-foot" style="margin-top:8px">${inf.model ? `<span class="chip">${esc(prettyModel(inf.model))}</span>` : ''}${inf.since ? `<span class="chip">${STATUS[st].label.toLowerCase()} · ${fmtDur(now - inf.since)}</span>` : ''}</div>
    </div>
    ${activityBlock(v, inf, openDetails)}
    <div class="d-section">Subagentes${cur.length ? ` · ${cur.length}` : ''}</div>
    ${cur.length ? cur.map((a) => agentCard(a, now)).join('') : '<div class="d-none">Ningún subagente todavía.<br>Aparecerán aquí cuando Claude los lance.</div>'}
    ${old.length ? `<details class="d-old" data-k="old"${openDetails.has('old') ? ' open' : ''}><summary>${old.length} de antes de abrir la sesión</summary>${old.map((a) => agentCard(a, now)).join('')}</details>` : ''}
    <div class="d-section">Tareas${tasks.length ? ` · ${tasks.length}` : ''}</div>
    ${tasks.length ? tasks.slice(0, 6).map(taskRow).join('') : '<div class="d-none">Cada mensaje que le mandes a Claude aparecerá aquí con lo que costó.</div>'}
    ${tasks.length > 6 ? `<details class="d-old" data-k="tasks"${openDetails.has('tasks') ? ' open' : ''}><summary>${tasks.length - 6} anteriores</summary>${tasks.slice(6).map(taskRow).join('')}</details>` : ''}`;
}

// ---------- repintado agrupado ----------
let renderQueued = false;
const dirtyTabs = new Set();
function scheduleRender(tabId) {
  if (tabId) dirtyTabs.add(tabId);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSummary();
    for (const id of dirtyTabs) {
      const v = views.get(id);
      if (v) { renderDrawer(v); updateTabUI(v); }
    }
    dirtyTabs.clear();
  });
}
