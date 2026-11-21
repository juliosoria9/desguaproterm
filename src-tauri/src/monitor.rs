// Monitor de sesiones: qué está haciendo cada Claude, cuánto gasta y qué subagentes tiene.
//
// Fuentes:
//  - hooks de Claude Code (llegan al instante por una conexión local): empieza a trabajar,
//    termina, te pide permiso o te pregunta, arranca o acaba un subagente…
//  - la barra de estado de Claude Code, que trae el % usado de los límites de tu plan
//  - las transcripciones .jsonl que Claude va escribiendo: tokens y precio de cada mensaje,
//    título de la conversación, tareas (cada mensaje tuyo), herramienta en uso y subagentes.
use crate::{now_ms, pricing, read_json, store::Store, strip_env};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

// ---------- tokens y precio ----------
#[derive(Default, Clone, Copy)]
pub struct Usage {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: f64,
}

impl Usage {
    fn from(model: &str, v: &Value) -> Usage {
        let g = |k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0);
        Usage {
            input: g("input_tokens"),
            output: g("output_tokens"),
            cache_read: g("cache_read_input_tokens"),
            cache_write: g("cache_creation_input_tokens"),
            cost: pricing::cost(model, v),
        }
    }
    fn add(&mut self, o: &Usage) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.cost += o.cost;
    }
    fn sub(&mut self, o: &Usage) {
        self.input = self.input.saturating_sub(o.input);
        self.output = self.output.saturating_sub(o.output);
        self.cache_read = self.cache_read.saturating_sub(o.cache_read);
        self.cache_write = self.cache_write.saturating_sub(o.cache_write);
        self.cost = (self.cost - o.cost).max(0.0);
    }
    fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
    fn context(&self) -> u64 {
        self.input + self.cache_read + self.cache_write
    }
    fn json(&self) -> Value {
        json!({ "input": self.input, "output": self.output, "cacheRead": self.cache_read,
                "cacheWrite": self.cache_write, "cost": (self.cost * 10_000.0).round() / 10_000.0 })
    }
}

// ---------- utilidades ----------
/// "2026-11-20T10:00:00.457Z" → milisegundos Unix (UTC).
fn iso_ms(s: &str) -> Option<u64> {
    let n = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    let ms = if s.as_bytes().get(19) == Some(&b'.') { n(20, 23).unwrap_or(0) } else { 0 };
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from((days * 86_400 + h * 3_600 + mi * 60 + se) * 1_000 + ms).ok()
}

fn clip(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > n { format!("{}…", s.chars().take(n).collect::<String>()) } else { s }
}

fn file_name(p: &str) -> String {
    Path::new(p).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}

fn between<'a>(s: &'a str, a: &str, b: &str) -> Option<&'a str> {
    let i = s.find(a)? + a.len();
    Some(&s[i..i + s[i..].find(b)?])
}

/// Qué está haciendo, en una frase corta, a partir de la herramienta que usa.
pub(crate) fn describe_tool(name: &str, input: &Value) -> String {
    let s = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("");
    let text = match name {
        "Read" => format!("Leyendo {}", file_name(s("file_path"))),
        "Edit" | "MultiEdit" => format!("Editando {}", file_name(s("file_path"))),
        "Write" => format!("Escribiendo {}", file_name(s("file_path"))),
        "NotebookEdit" => format!("Editando {}", file_name(s("notebook_path"))),
        "Bash" | "PowerShell" => format!("Ejecutando: {}", if s("description").is_empty() { s("command") } else { s("description") }),
        "Grep" => format!("Buscando «{}»", s("pattern")),
        "Glob" => format!("Buscando archivos {}", s("pattern")),
        "WebFetch" => format!("Leyendo {}", s("url").split("//").nth(1).unwrap_or(s("url")).split('/').next().unwrap_or("")),
        "WebSearch" => format!("Buscando en la web «{}»", s("query")),
        "Agent" | "Task" => format!("Lanzando agente: {}", s("description")),
        "AskUserQuestion" => "Preguntándote algo".into(),
        "ExitPlanMode" => "Esperando que apruebes el plan".into(),
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => "Organizando tareas".into(),
        "Skill" => format!("Usando la skill {}", s("skill")),
        "ToolSearch" => "Cargando herramientas".into(),
        n if n.starts_with("mcp__") => {
            let mut p = n.splitn(3, "__").skip(1);
            format!("{}: {}", p.next().unwrap_or(""), p.next().unwrap_or(""))
        }
        n => n.to_string(),
    };
    clip(&text, 90)
}

/// Texto de un mensaje de usuario (cadena o lista de bloques).
fn prompt_text(content: &Value) -> Option<String> {
    match content {
        Value::String(s) => Some(s.clone()),
        Value::Array(blocks) => {
            let parts: Vec<String> = blocks
                .iter()
                .filter_map(|b| match b.get("type").and_then(Value::as_str) {
                    Some("text") => b.get("text").and_then(Value::as_str).map(String::from),
                    Some("image") => Some("[imagen]".into()),
                    _ => None,
                })
                .collect();
            (!parts.is_empty()).then(|| parts.join(" "))
        }
        _ => None,
    }
}

/// Cómo se llama la tarea que empieza con este mensaje (None si no es una petición tuya).
fn task_label(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() || ["<task-notification", "<local-command", "<system-reminder", "[Request interrupted"].iter().any(|p| t.starts_with(p)) {
        return None;
    }
    if let Some(cmd) = between(t, "<command-name>", "</command-name>") {
        let args = between(t, "<command-args>", "</command-args>").unwrap_or("");
        return Some(clip(&format!("{} {}", cmd.trim(), args.trim()), 140));
    }
    Some(clip(t, 140))
}

const STOPWORDS: &[&str] = &[
    "de", "del", "la", "el", "los", "las", "en", "y", "e", "o", "u", "para", "por", "con", "un", "una", "unos", "unas", "a",
    "al", "que", "su", "sus", "the", "of", "for", "and", "to", "in", "on", "with", "an",
];

/// Resumen sin IA: las 3 primeras palabras con significado.
fn heuristic_title(title: &str) -> String {
    let words: Vec<&str> = title
        .split_whitespace()
        .filter(|w| !STOPWORDS.contains(&w.to_lowercase().as_str()))
        .take(3)
        .collect();
    if words.is_empty() { clip(title, 24) } else { words.join(" ") }
}

fn file_times(p: &Path) -> (u64, u64) {
    let ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
    };
    fs::metadata(p).map(|m| (ms(m.created()), ms(m.modified()))).unwrap_or((0, 0))
}

// ---------- transcripción (.jsonl) ----------
struct Msg {
    u: Usage,
    ts: u64,
    model: String,
}

struct Task {
    prompt: String,
    started: u64,
    last: u64,
}

/// Una acción de Claude (herramienta que usó) para el historial de la sesión.
struct Action {
    ts: u64,
    id: String,
    text: String,
    added: u32,
    removed: u32,
    file: String,
    /// líneas del cambio ("+…"/"-…"), solo para enseñar el diff si lo pides
    patch: Vec<String>,
}

const MAX_ACTIONS: usize = 150;
const MAX_PATCH_LINES: usize = 400;

/// Un archivo creado o editado por Claude, con las líneas que añadió y quitó.
struct Edit {
    ts: u64,
    file: String,
    added: u32,
    removed: u32,
}

/// Líneas tocadas según el resultado de Edit/Write que guarda Claude (parche exacto).
fn edit_from(v: &Value) -> Option<Edit> {
    let r = v.get("toolUseResult")?;
    let file = r.get("filePath")?.as_str()?.to_string();
    let (mut added, mut removed) = (0u32, 0u32);
    for hunk in r.get("structuredPatch").and_then(Value::as_array).into_iter().flatten() {
        for l in hunk.get("lines").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if l.starts_with('+') {
                added += 1;
            } else if l.starts_with('-') {
                removed += 1;
            }
        }
    }
    if added == 0 && removed == 0 && r.get("type").and_then(Value::as_str) == Some("create") {
        added = r.get("content").and_then(Value::as_str).map(|c| c.lines().count() as u32).unwrap_or(0);
    }
    let ts = v["timestamp"].as_str().and_then(iso_ms).unwrap_or(0);
    Some(Edit { ts, file, added, removed })
}

/// Lee lo nuevo de una transcripción y lleva la cuenta de tokens, precio, título, tareas y actividad.
#[derive(Default)]
struct Transcript {
    path: Option<PathBuf>,
    offset: u64,
    msgs: HashMap<String, Msg>,
    tasks: Vec<Task>,
    edits: Vec<Edit>,
    /// historial de acciones (solo en las sesiones abiertas, no en el registro de la semana)
    keep_actions: bool,
    actions: std::collections::VecDeque<Action>,
    usage: Usage,
    ctx: u64,
    model: String,
    activity: String,
    title: Option<String>,
    cwd: Option<String>,
    primed: bool,
    // de la última lectura:
    first_read: bool,
    interrupted: bool,
    new_assistant: bool,
    last_ts: u64,
}

impl Transcript {
    fn at(path: PathBuf) -> Transcript {
        Transcript { path: Some(path), ..Default::default() }
    }

    /// La de una sesión abierta: además lleva el historial de acciones.
    fn watched(path: PathBuf) -> Transcript {
        Transcript { path: Some(path), keep_actions: true, ..Default::default() }
    }

    /// Lee las líneas nuevas. Devuelve true si cambió algo.
    fn poll(&mut self) -> bool {
        self.first_read = false;
        self.interrupted = false;
        self.new_assistant = false;
        self.last_ts = 0;
        let Some(path) = self.path.clone() else { return false };
        let Ok(mut f) = File::open(&path) else { return false };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            let keep = self.keep_actions;
            *self = Transcript::at(path); // reescrita: se vuelve a leer entera
            self.keep_actions = keep;
            return true;
        }
        if len == self.offset || f.seek(SeekFrom::Start(self.offset)).is_err() {
            return false;
        }
        let mut buf = Vec::new();
        if (&mut f).take(len - self.offset).read_to_end(&mut buf).is_err() {
            return false;
        }
        let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { return false };
        self.offset += end as u64 + 1;
        self.first_read = !self.primed;
        self.primed = true;
        let mut changed = false;
        for raw in buf[..end].split(|&b| b == b'\n') {
            if let Ok(line) = std::str::from_utf8(raw) {
                changed |= self.line(line);
            }
        }
        changed
    }

    fn line(&mut self, line: &str) -> bool {
        // filtro rápido: hay líneas enormes (peticiones guardadas) que no interesan
        if line.contains("\"type\":\"ai-title\"") {
            let Ok(v) = serde_json::from_str::<Value>(line) else { return false };
            let t = v.get("aiTitle").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
            if t.is_some() && t != self.title.as_deref() {
                self.title = t.map(String::from);
                return true;
            }
            return false;
        }
        if line.contains("\"role\":\"assistant\"") && line.contains("\"usage\"") {
            let Ok(v) = serde_json::from_str::<Value>(line) else { return false };
            let m = &v["message"];
            let model = m.get("model").and_then(Value::as_str).unwrap_or("");
            let ts = v["timestamp"].as_str().and_then(iso_ms).unwrap_or(0);
            if !model.starts_with('<') {
                let u = Usage::from(model, &m["usage"]);
                if let Some(id) = m.get("id").and_then(Value::as_str) {
                    if let Some(old) = self.msgs.insert(id.to_string(), Msg { u, ts, model: model.to_string() }) {
                        self.usage.sub(&old.u);
                    }
                    self.usage.add(&u);
                }
                if u.context() > 0 {
                    self.ctx = u.context();
                }
                self.model = model.to_string();
            }
            if let Some(task) = self.tasks.last_mut() {
                task.last = task.last.max(ts);
            }
            for b in m.get("content").and_then(Value::as_array).into_iter().flatten() {
                match b.get("type").and_then(Value::as_str) {
                    Some("tool_use") => {
                        self.activity = describe_tool(b["name"].as_str().unwrap_or(""), &b["input"]);
                        let id = b.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                        if self.keep_actions && !self.actions.iter().any(|a| a.id == id) {
                            self.actions.push_back(Action {
                                ts, id, text: self.activity.clone(), added: 0, removed: 0, file: String::new(), patch: Vec::new(),
                            });
                            if self.actions.len() > MAX_ACTIONS {
                                self.actions.pop_front();
                            }
                        }
                    }
                    Some("text") if b["text"].as_str().is_some_and(|t| !t.trim().is_empty()) => {
                        self.activity = "Escribiendo la respuesta".into()
                    }
                    Some("thinking") => self.activity = "Pensando".into(),
                    _ => {}
                }
            }
            self.new_assistant = true;
            self.last_ts = self.last_ts.max(ts);
            return true;
        }
        // una petición tuya = una tarea nueva
        if line.contains("\"type\":\"user\"")
            && !line.contains("\"isSidechain\":true")
            && !line.contains("\"tool_result\"")
            && !line.contains("\"isMeta\":true")
            && (!line.contains("\"turnOrigin\":") || line.contains("\"turnOrigin\":\"human\""))
        {
            let Ok(v) = serde_json::from_str::<Value>(line) else { return false };
            let ts = v["timestamp"].as_str().and_then(iso_ms).unwrap_or(0);
            if self.cwd.is_none() {
                self.cwd = v.get("cwd").and_then(Value::as_str).map(String::from);
            }
            let text = prompt_text(&v["message"]["content"]).unwrap_or_default();
            if text.trim_start().starts_with("[Request interrupted") {
                self.interrupted = true;
                self.last_ts = self.last_ts.max(ts);
                return true;
            }
            if let Some(prompt) = task_label(&text) {
                self.tasks.push(Task { prompt, started: ts, last: ts });
                return true;
            }
            return false;
        }
        if line.contains("\"tool_result\"") {
            let Ok(v) = serde_json::from_str::<Value>(line) else { return true };
            if let Some(ts) = v["timestamp"].as_str().and_then(iso_ms) {
                self.last_ts = self.last_ts.max(ts);
            }
            if line.contains("\"structuredPatch\"") {
                if let Some(e) = edit_from(&v) {
                    if self.keep_actions {
                        self.attach_patch(&v, &e);
                    }
                    self.edits.push(e);
                }
            }
            return true;
        }
        false
    }

    /// Guarda en la acción que editó el archivo sus líneas cambiadas (para el diff).
    fn attach_patch(&mut self, v: &Value, e: &Edit) {
        let Some(id) = v.pointer("/message/content/0/tool_use_id").and_then(Value::as_str) else { return };
        let Some(a) = self.actions.iter_mut().rev().find(|a| a.id == id) else { return };
        let r = &v["toolUseResult"];
        let mut patch: Vec<String> = Vec::new();
        for hunk in r.get("structuredPatch").and_then(Value::as_array).into_iter().flatten() {
            if !patch.is_empty() {
                patch.push("…".into());
            }
            patch.extend(hunk.get("lines").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(String::from));
        }
        if patch.is_empty() {
            if let Some(c) = r.get("content").and_then(Value::as_str) {
                patch = c.lines().map(|l| format!("+{l}")).collect();
            }
        }
        patch.truncate(MAX_PATCH_LINES);
        (a.added, a.removed, a.file, a.patch) = (e.added, e.removed, e.file.clone(), patch);
    }

    /// Índice de la tarea en curso en un momento dado.
    fn task_at(&self, ts: u64) -> Option<usize> {
        self.tasks.partition_point(|t| t.started <= ts).checked_sub(1)
    }
}

/// Lo que hizo una tarea: tokens y precio, subagentes y líneas tocadas.
#[derive(Default, Clone)]
struct TaskAgg {
    usage: Usage,
    agents: u32,
    added: u32,
    removed: u32,
    files: HashSet<String>,
}

impl TaskAgg {
    fn json(&self, t: &Task) -> Value {
        json!({ "prompt": t.prompt, "started": t.started, "last": t.last, "usage": self.usage.json(), "agents": self.agents,
                "added": self.added, "removed": self.removed, "files": self.files.len() })
    }
}

/// Suma lo de cada tarea: lo del Claude principal y lo de los subagentes que corrían en ella.
/// Solo cuenta lo hecho desde `since`.
fn task_aggs<'a>(main: &Transcript, subs: impl Iterator<Item = &'a Transcript>, since: u64) -> Vec<TaskAgg> {
    let mut aggs = vec![TaskAgg::default(); main.tasks.len()];
    let mut add_from = |t: &Transcript, is_sub: bool| {
        let mut seen = HashSet::new();
        for m in t.msgs.values().filter(|m| m.ts >= since) {
            if let Some(i) = main.task_at(m.ts) {
                aggs[i].usage.add(&m.u);
                seen.insert(i);
            }
        }
        for e in t.edits.iter().filter(|e| e.ts >= since) {
            if let Some(i) = main.task_at(e.ts) {
                aggs[i].added += e.added;
                aggs[i].removed += e.removed;
                aggs[i].files.insert(e.file.to_lowercase());
            }
        }
        if is_sub {
            for i in seen {
                aggs[i].agents += 1;
            }
        }
    };
    add_from(main, false);
    for t in subs {
        add_from(t, true);
    }
    aggs
}

// ---------- subagentes ----------
struct Agent {
    kind: String,
    description: String,
    model: String,
    running: bool,
    old: bool,
    started: u64,
    ended: Option<u64>,
    t: Transcript,
}

// ---------- una sesión (pestaña) ----------
struct Watch {
    session_id: String,
    status: &'static str,
    since: u64,
    main: Transcript,
    agents: HashMap<String, Agent>,
    agents_scanned: bool,
    short_title: Option<String>,
    title_requested: bool,
    last_message: Option<String>,
    /// carpeta real donde trabaja Claude (otra si es un worktree)
    cwd: Option<String>,
    /// por qué te necesita: "permission", "question" o "plan", y qué pide
    need_kind: &'static str,
    need_what: String,
    /// modelo que dice la barra de estado de Claude ahora mismo
    live_model: String,
    dirty: bool,
}

impl Watch {
    fn new(session_id: &str) -> Watch {
        Watch {
            session_id: session_id.to_string(),
            status: "idle",
            since: now_ms(),
            main: Transcript::default(),
            agents: HashMap::new(),
            agents_scanned: false,
            short_title: None,
            title_requested: false,
            last_message: None,
            cwd: None,
            need_kind: "",
            need_what: String::new(),
            live_model: String::new(),
            dirty: true,
        }
    }

    fn needs(&mut self, kind: &'static str, what: &str) {
        self.set("needs");
        self.need_kind = kind;
        if !what.is_empty() {
            self.need_what = clip(what, 160);
        }
    }

    fn set(&mut self, status: &'static str) {
        if self.status != status {
            self.status = status;
            self.since = now_ms();
            self.dirty = true;
            if status != "needs" {
                self.need_kind = "";
                self.need_what.clear();
            }
        }
    }

    fn agents_dir(&self) -> Option<PathBuf> {
        Some(self.main.path.as_ref()?.with_extension("").join("subagents"))
    }

    fn poll(&mut self) -> bool {
        let title_before = self.main.title.clone();
        let mut changed = self.main.poll();
        if changed {
            if self.main.title != title_before {
                self.short_title = None;
                self.title_requested = false;
            }
            if !self.main.first_read {
                // lo que se lee al abrir (historial) no cambia el estado
                let fresh = self.main.last_ts > self.since + 300;
                if self.main.interrupted && matches!(self.status, "working" | "needs") {
                    self.set("done");
                } else if fresh && self.status == "needs" {
                    self.set("working"); // ya respondiste
                } else if fresh && self.main.new_assistant && matches!(self.status, "done" | "idle" | "error") {
                    self.set("working"); // sigue sola (p. ej. al acabar un agente en segundo plano)
                }
            }
        }
        if let Some(dir) = self.agents_dir() {
            changed |= self.poll_agents(&dir);
        }
        changed
    }

    fn poll_agents(&mut self, dir: &Path) -> bool {
        let mut changed = false;
        let first = !self.agents_scanned;
        self.agents_scanned = true;
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let Some(id) = name.strip_prefix("agent-").and_then(|s| s.strip_suffix(".meta.json")) else { continue };
                let a = self.agents.entry(id.to_string()).or_insert_with(|| {
                    changed = true;
                    Agent {
                        kind: String::new(),
                        description: String::new(),
                        model: String::new(),
                        running: true,
                        old: first,
                        started: now_ms(),
                        ended: None,
                        t: Transcript::at(dir.join(format!("agent-{id}.jsonl"))),
                    }
                });
                if a.kind.is_empty() || a.running {
                    let Some(m) = read_json(&e.path()) else { continue };
                    let g = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                    let (kind, description, model) = (g("agentType"), g("description"), g("model"));
                    if a.kind != kind || a.description != description || a.model != model {
                        (a.kind, a.description, a.model) = (kind, description, model);
                        changed = true;
                    }
                    let (created, modified) = file_times(&e.path());
                    if created > 0 {
                        a.started = created;
                    }
                    if m.get("finished").and_then(Value::as_bool) == Some(true) && a.running {
                        a.running = false;
                        a.ended = Some(if a.old { modified } else { now_ms() });
                        changed = true;
                    }
                }
            }
        }
        for a in self.agents.values_mut() {
            changed |= a.t.poll();
        }
        changed
    }

    fn total_usage(&self) -> Usage {
        let mut u = self.main.usage;
        for a in self.agents.values() {
            u.add(&a.t.usage);
        }
        u
    }

    fn snapshot(&self, tab: &str) -> Value {
        let mut agents: Vec<&Agent> = self.agents.values().collect();
        agents.sort_by(|a, b| b.started.cmp(&a.started));
        let agents_json: Vec<Value> = agents
            .iter()
            .map(|a| {
                json!({
                    "kind": a.kind, "description": a.description,
                    "model": if a.t.model.is_empty() { &a.model } else { &a.t.model },
                    "running": a.running, "old": a.old, "started": a.started, "ended": a.ended,
                    "activity": a.t.activity, "usage": a.t.usage.json(),
                })
            })
            .collect();
        let aggs = task_aggs(&self.main, self.agents.values().map(|a| &a.t), 0);
        let tasks: Vec<Value> = self.main.tasks.iter().enumerate().rev().take(30).map(|(i, t)| aggs[i].json(t)).collect();
        let edits = self.main.edits.iter().chain(self.agents.values().flat_map(|a| a.t.edits.iter()));
        let (mut added, mut removed, mut files) = (0u32, 0u32, HashSet::new());
        for e in edits {
            added += e.added;
            removed += e.removed;
            files.insert(e.file.to_lowercase());
        }
        json!({
            "tabId": tab, "sessionId": self.session_id, "status": self.status, "since": self.since,
            "title": self.main.title, "shortTitle": self.short_title,
            "activity": self.main.activity, "lastMessage": self.last_message,
            "model": self.main.model, "liveModel": self.live_model, "ctx": self.main.ctx, "cwd": self.cwd,
            "need": if self.status == "needs" { json!({ "kind": self.need_kind, "what": self.need_what }) } else { Value::Null },
            "usage": self.total_usage().json(), "mainUsage": self.main.usage.json(),
            "lines": { "added": added, "removed": removed, "files": files.len() },
            "agents": agents_json, "tasks": tasks,
            "actions": self.main.actions.iter().rev().take(40).map(|a| json!({
                "ts": a.ts, "id": a.id, "text": a.text, "added": a.added, "removed": a.removed, "diff": !a.patch.is_empty(),
            })).collect::<Vec<_>>(),
        })
    }
}

// ---------- registro de la semana (todas las sesiones del PC) ----------
#[derive(Default)]
struct Ledger {
    since: u64,
    files: HashMap<PathBuf, Transcript>,
}

// ---------- el monitor ----------
pub struct Monitor {
    tabs: Mutex<HashMap<String, Watch>>,
    projects: PathBuf,
    claude: Option<PathBuf>,
    store: Store,
    titles: Mutex<HashMap<String, String>>,
    pending_titles: Mutex<HashSet<String>>,
    pub ai_titles: AtomicBool,
    title_tx: Mutex<Option<mpsc::Sender<String>>>,
    ledger: Mutex<Ledger>,
    limits: Mutex<Value>,
}

impl Monitor {
    pub fn new(projects: PathBuf, claude: Option<PathBuf>, store: Store, ai_titles: bool) -> Monitor {
        let titles: HashMap<String, String> = store
            .read_json("titles")
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let limits = store.read_json("limits").unwrap_or(Value::Null);
        Monitor {
            tabs: Mutex::new(HashMap::new()),
            projects,
            claude,
            store,
            titles: Mutex::new(titles),
            pending_titles: Mutex::new(HashSet::new()),
            ai_titles: AtomicBool::new(ai_titles),
            title_tx: Mutex::new(None),
            ledger: Mutex::new(Ledger::default()),
            limits: Mutex::new(limits),
        }
    }

    /// Las líneas cambiadas por una acción (para enseñar el diff al pulsarla).
    pub fn action_diff(&self, tab: &str, id: &str) -> Option<Value> {
        let tabs = self.tabs.lock().unwrap();
        let a = tabs.get(tab)?.main.actions.iter().find(|a| a.id == id)?;
        Some(json!({ "file": a.file, "text": a.text, "added": a.added, "removed": a.removed, "lines": a.patch }))
    }

    pub fn snapshot_all(&self) -> Vec<Value> {
        self.tabs.lock().unwrap().iter().map(|(id, w)| w.snapshot(id)).collect()
    }

    pub fn limits(&self) -> Value {
        self.limits.lock().unwrap().clone()
    }

    fn find_transcript(&self, sid: &str) -> Option<PathBuf> {
        let file = format!("{sid}.jsonl");
        fs::read_dir(&self.projects).ok()?.flatten().map(|d| d.path().join(&file)).find(|p| p.is_file())
    }

    fn request_title(&self, title: String) {
        if self.ai_titles.load(Ordering::Relaxed) && self.claude.is_some() {
            if self.pending_titles.lock().unwrap().insert(title.clone()) {
                if let Some(tx) = self.title_tx.lock().unwrap().as_ref() {
                    let _ = tx.send(title);
                }
            }
        } else {
            self.titles.lock().unwrap().insert(title.clone(), heuristic_title(&title));
        }
    }

    /// Gasto de hoy y de la semana en todo el PC, por modelo, por tarea y por día.
    /// `today` y `week` son los inicios de cada periodo (ms Unix); `chart_from`, el primer día de
    /// la gráfica; `tz`, el desfase de tu hora local en ms (para cortar los días a medianoche).
    pub fn usage_report(&self, today: u64, week: u64, chart_from: u64, tz: i64) -> Value {
        let since = week.min(chart_from);
        let mut led = self.ledger.lock().unwrap();
        if led.since != since {
            *led = Ledger { since, ..Default::default() };
        }
        let week_files_since = since;
        // archivos tocados desde el inicio de la semana: conversaciones y sus subagentes
        let mut found = Vec::new();
        for proj in fs::read_dir(&self.projects).into_iter().flatten().flatten() {
            for e in fs::read_dir(proj.path()).into_iter().flatten().flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "jsonl") {
                    found.push(p);
                } else if p.is_dir() {
                    for a in fs::read_dir(p.join("subagents")).into_iter().flatten().flatten() {
                        if a.path().extension().is_some_and(|x| x == "jsonl") {
                            found.push(a.path());
                        }
                    }
                }
            }
        }
        for p in found {
            if file_times(&p).1 >= week_files_since || led.files.contains_key(&p) {
                led.files.entry(p.clone()).or_insert_with(|| Transcript::at(p)).poll();
            }
        }

        let (mut day, mut wk) = (Usage::default(), Usage::default());
        let mut by_model: HashMap<String, Usage> = HashMap::new();
        // gasto por día (hora local) para la gráfica
        let day_of = |ts: u64| (ts as i64 + tz).div_euclid(86_400_000);
        let (first_day, last_day) = (day_of(chart_from), day_of(today));
        let mut days: HashMap<i64, (Usage, HashMap<String, f64>)> = HashMap::new();
        for t in led.files.values() {
            for m in t.msgs.values() {
                if m.ts >= chart_from {
                    let d = days.entry(day_of(m.ts)).or_default();
                    d.0.add(&m.u);
                    *d.1.entry(m.model.clone()).or_default() += m.u.cost;
                }
                if m.ts < week {
                    continue;
                }
                wk.add(&m.u);
                by_model.entry(m.model.clone()).or_default().add(&m.u);
                if m.ts >= today {
                    day.add(&m.u);
                }
            }
        }
        let mut models: Vec<(String, Usage)> = by_model.into_iter().collect();
        models.sort_by(|a, b| b.1.cost.total_cmp(&a.1.cost));
        let days_json: Vec<Value> = (first_day..=last_day)
            .map(|d| {
                let (u, per_model) = days.get(&d).cloned().unwrap_or_default();
                let mut pm: Vec<(String, f64)> = per_model.into_iter().collect();
                pm.sort_by(|a, b| b.1.total_cmp(&a.1));
                json!({
                    "start": d * 86_400_000 - tz, "usage": u.json(),
                    "models": pm.iter().take(3).map(|(m, c)| json!({ "model": m, "cost": (c * 10_000.0).round() / 10_000.0 })).collect::<Vec<_>>(),
                })
            })
            .collect();

        // tareas: cada mensaje tuyo, con lo que gastaron Claude y sus subagentes
        let mut subs_of: HashMap<PathBuf, Vec<&Transcript>> = HashMap::new();
        for (p, t) in &led.files {
            if p.parent().and_then(Path::file_name).is_some_and(|n| n == "subagents") {
                if let Some(session_dir) = p.parent().and_then(Path::parent) {
                    subs_of.entry(session_dir.with_extension("jsonl")).or_default().push(t);
                }
            }
        }
        let mut tasks = Vec::new();
        for (p, t) in &led.files {
            if t.tasks.is_empty() {
                continue;
            }
            let subs = subs_of.get(p).map(|v| v.as_slice()).unwrap_or(&[]);
            let aggs = task_aggs(t, subs.iter().copied(), week);
            let sid = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let project = t.cwd.clone().unwrap_or_default();
            for (i, task) in t.tasks.iter().enumerate() {
                if aggs[i].usage.tokens() == 0 {
                    continue;
                }
                let mut j = aggs[i].json(task);
                j["sessionId"] = json!(sid);
                j["project"] = json!(project);
                tasks.push(j);
            }
        }
        tasks.sort_by_key(|t| std::cmp::Reverse(t["started"].as_u64().unwrap_or(0)));
        tasks.truncate(1000);
        json!({
            "today": day.json(), "week": wk.json(), "weekStart": week,
            "byModel": models.iter().map(|(m, u)| json!({ "model": m, "usage": u.json() })).collect::<Vec<_>>(),
            "tasks": tasks, "days": days_json,
            "limits": self.limits(),
        })
    }
}

/// Trozo de texto alrededor de una coincidencia (en caracteres, no bytes).
fn snippet(body: &str, at_char: usize, len: usize) -> String {
    let chars: Vec<char> = body.chars().collect();
    let a = at_char.saturating_sub(50);
    let b = (at_char + len + 90).min(chars.len());
    let s: String = chars[a..b].iter().collect();
    format!("{}{}{}", if a > 0 { "…" } else { "" }, clip(&s, 400), if b < chars.len() { "…" } else { "" })
}

impl Monitor {
    /// Busca un texto en todas tus conversaciones: lo que escribiste y lo que respondió Claude.
    pub fn search(&self, query: &str) -> Vec<Value> {
        let q = query.trim().to_lowercase();
        if q.chars().count() < 2 {
            return Vec::new();
        }
        let q_chars = q.chars().count();
        let mut out = Vec::new();
        for proj in fs::read_dir(&self.projects).into_iter().flatten().flatten() {
            for e in fs::read_dir(proj.path()).into_iter().flatten().flatten() {
                let p = e.path();
                if !p.extension().is_some_and(|x| x == "jsonl") {
                    continue;
                }
                let Ok(text) = fs::read_to_string(&p) else { continue };
                let (mut title, mut cwd, mut hits, mut count, mut last) = (None::<String>, None::<String>, Vec::new(), 0u32, 0u64);
                for line in text.lines() {
                    if line.len() > 400_000 {
                        continue; // peticiones guardadas enteras: no son texto de la conversación
                    }
                    if line.contains("\"type\":\"ai-title\"") {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            title = v.get("aiTitle").and_then(Value::as_str).map(String::from);
                        }
                        continue;
                    }
                    let user = line.contains("\"type\":\"user\"")
                        && !line.contains("\"isSidechain\":true")
                        && !line.contains("\"tool_result\"")
                        && !line.contains("\"isMeta\":true");
                    let assistant = !user && line.contains("\"role\":\"assistant\"");
                    if !user && !assistant {
                        continue;
                    }
                    let matches = line.to_lowercase().contains(&q);
                    if !matches && (cwd.is_some() || !user) {
                        continue;
                    }
                    let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                    if cwd.is_none() {
                        cwd = v.get("cwd").and_then(Value::as_str).map(String::from);
                    }
                    if !matches {
                        continue;
                    }
                    let body = if user {
                        prompt_text(&v["message"]["content"]).filter(|t| task_label(t).is_some())
                    } else {
                        let parts: Vec<&str> = v["message"]["content"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                            .filter_map(|b| b.get("text").and_then(Value::as_str))
                            .collect();
                        (!parts.is_empty()).then(|| parts.join("\n"))
                    };
                    let Some(body) = body else { continue };
                    let lower = body.to_lowercase();
                    let Some(pos) = lower.find(&q) else { continue };
                    count += 1;
                    let ts = v["timestamp"].as_str().and_then(iso_ms).unwrap_or(0);
                    last = last.max(ts);
                    if hits.len() < 3 {
                        let at = lower[..pos].chars().count();
                        hits.push(json!({ "who": if user { "Tú" } else { "Claude" }, "text": snippet(&body, at, q_chars), "ts": ts }));
                    }
                }
                if count > 0 {
                    let sid = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    out.push(json!({ "sessionId": sid, "project": cwd, "title": title, "last": last.max(file_times(&p).1), "count": count, "hits": hits }));
                }
            }
        }
        out.sort_by_key(|r| std::cmp::Reverse(r["last"].as_u64().unwrap_or(0)));
        out.truncate(40);
        out
    }
}

/// Empieza a vigilar una pestaña (o la deja como estaba si es la misma conversación).
pub fn watch(app: &AppHandle, tab: &str, session_id: &str) {
    let mon = app.state::<Monitor>();
    let mut tabs = mon.tabs.lock().unwrap();
    match tabs.get_mut(tab) {
        Some(w) if w.session_id == session_id => {
            if w.status == "exited" {
                w.set("idle");
            }
        }
        _ => {
            let mut w = Watch::new(session_id);
            if let Some(p) = mon.find_transcript(session_id) {
                w.main = Transcript::watched(p);
            }
            tabs.insert(tab.to_string(), w);
        }
    }
}

pub fn unwatch(app: &AppHandle, tab: &str) {
    app.state::<Monitor>().tabs.lock().unwrap().remove(tab);
}

pub fn set_status(app: &AppHandle, tab: &str, status: &'static str) {
    let mon = app.state::<Monitor>();
    let snap = {
        let mut tabs = mon.tabs.lock().unwrap();
        let Some(w) = tabs.get_mut(tab) else { return };
        w.set(status);
        w.dirty = false;
        w.snapshot(tab)
    };
    let _ = app.emit("tab-info", snap);
}

/// Un hook de Claude Code (lo envía `desguaproterm.exe --hook` / `--statusline` desde la sesión).
fn on_hook(app: &AppHandle, v: &Value) {
    let mon = app.state::<Monitor>();
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("");

    // la barra de estado trae el % usado de los límites de tu plan (5 h y semana) y el modelo actual
    if s("ev") == "StatusLine" {
        if let Some(rl) = v.get("rl").filter(|r| r.is_object() && !r.as_object().unwrap().is_empty()) {
            let mut limits = mon.limits.lock().unwrap();
            if *limits != *rl {
                *limits = rl.clone();
                let _ = mon.store.write("limits", rl.to_string().as_bytes());
                let _ = app.emit("limits", rl.clone());
            }
        }
        let (tab, model) = (s("tab"), s("model"));
        if !model.is_empty() {
            let snap = {
                let mut tabs = mon.tabs.lock().unwrap();
                tabs.get_mut(tab).filter(|w| w.live_model != model).map(|w| {
                    w.live_model = model.to_string();
                    w.snapshot(tab)
                })
            };
            if let Some(snap) = snap {
                let _ = app.emit("tab-info", snap);
            }
        }
        return;
    }

    let Some(tab) = v["tab"].as_str() else { return };
    let snap = {
        let mut tabs = mon.tabs.lock().unwrap();
        let Some(w) = tabs.get_mut(tab) else { return };
        let sid = s("sid");
        if !sid.is_empty() && sid != w.session_id {
            *w = Watch::new(sid); // /clear o /resume: otra conversación en la misma pestaña
        }
        let tp = s("tp");
        if !tp.is_empty() && w.main.path.as_deref() != Some(Path::new(tp)) {
            w.main = Transcript::watched(tp.into());
        }
        let cwd = s("cwd");
        if !cwd.is_empty() {
            w.cwd = Some(cwd.to_string());
        }
        match s("ev") {
            "SessionStart" => w.set("idle"),
            "UserPromptSubmit" => {
                w.set("working");
                w.last_message = None;
            }
            "Stop" => {
                w.set("done");
                let lm = s("lm");
                if !lm.is_empty() {
                    w.last_message = Some(clip(lm, 200));
                }
            }
            "StopFailure" => w.set("error"),
            "PermissionRequest" => w.needs("permission", s("what")),
            "PreToolUse" => match s("tool") {
                "ExitPlanMode" => w.needs("plan", "Tiene un plan listo para que lo revises"),
                _ => w.needs("question", s("what")),
            },
            "Notification" => match s("nt") {
                "permission_prompt" | "worker_permission_prompt" => {
                    let what = if w.need_what.is_empty() { s("msg").to_string() } else { String::new() };
                    w.needs(if w.need_kind.is_empty() { "permission" } else { w.need_kind }, &what);
                }
                "elicitation_dialog" => w.needs("question", s("msg")),
                "idle_prompt" if w.status == "working" => w.set("done"),
                _ => {}
            },
            "SubagentStart" => {
                let id = s("aid").to_string();
                if !id.is_empty() {
                    let path = w.agents_dir().map(|d| d.join(format!("agent-{id}.jsonl"))).unwrap_or_default();
                    w.agents.entry(id).or_insert_with(|| Agent {
                        kind: s("atype").to_string(),
                        description: String::new(),
                        model: String::new(),
                        running: true,
                        old: false,
                        started: now_ms(),
                        ended: None,
                        t: Transcript::at(path),
                    });
                }
            }
            "SubagentStop" => {
                if let Some(a) = w.agents.get_mut(s("aid")) {
                    a.running = false;
                    a.ended.get_or_insert(now_ms());
                }
            }
            _ => {}
        }
        w.dirty = false;
        w.snapshot(tab)
    };
    let _ = app.emit("tab-info", snap);
}

/// Servidor local (solo 127.0.0.1) por el que llegan los hooks. Devuelve "puerto:clave".
pub fn start_hook_server(app: AppHandle) -> Option<String> {
    use std::hash::{BuildHasher, Hasher};
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let key = |salt: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(now_ms() ^ salt);
        h.write_u32(std::process::id());
        h.finish()
    };
    let token = format!("{:016x}{:016x}", key(1), key(2));
    let expected = token.clone();
    thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut s) = conn else { continue };
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = Vec::new();
            let _ = (&mut s).take(256 * 1024).read_to_end(&mut buf);
            let Ok(v) = serde_json::from_slice::<Value>(&buf) else { continue };
            if v["t"].as_str() == Some(expected.as_str()) {
                on_hook(&app, &v);
            }
        }
    });
    Some(format!("{port}:{token}"))
}

/// Resume el título de la conversación en 2-3 palabras con Haiku (una llamada mínima, sin
/// herramientas ni guardar sesión). Se hace una sola vez por título: queda guardado en el .exe.
fn ai_short_title(claude: &Path, title: &str) -> Option<String> {
    let prompt = format!(
        "Resume este título en 2 o 3 palabras, en su mismo idioma. Responde solo con esas palabras, sin comillas ni punto final.\nTítulo: {title}"
    );
    let mut cmd = Command::new(claude);
    cmd.args(["-p", &prompt, "--model", "haiku", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands", "--tools", ""]);
    cmd.current_dir(std::env::temp_dir());
    for (k, _) in std::env::vars_os() {
        if strip_env(&k.to_string_lossy()) {
            cmd.env_remove(&k);
        }
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // sin ventana de consola
    }
    let mut child = cmd.spawn().ok()?;
    let mut out = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut s = Vec::new();
        let _ = out.read_to_end(&mut s);
        let _ = tx.send(s);
    });
    let Ok(bytes) = rx.recv_timeout(Duration::from_secs(90)) else {
        let _ = child.kill();
        return None;
    };
    let _ = child.wait();
    let text = String::from_utf8_lossy(&bytes);
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let clean = line.trim_matches(|c: char| "\"'«».*`".contains(c)).trim();
    let words: Vec<&str> = clean.split_whitespace().collect();
    (!words.is_empty() && words.len() <= 5 && clean.len() <= 48).then(|| words.join(" "))
}

fn title_job(app: &AppHandle, title: String) {
    let mon = app.state::<Monitor>();
    let short = mon.claude.as_deref().and_then(|c| ai_short_title(c, &title)).unwrap_or_else(|| heuristic_title(&title));
    {
        let mut titles = mon.titles.lock().unwrap();
        if titles.len() > 400 {
            titles.clear();
        }
        titles.insert(title.clone(), short.clone());
        let _ = mon.store.write("titles", &serde_json::to_vec(&*titles).unwrap_or_default());
    }
    mon.pending_titles.lock().unwrap().remove(&title);
    let snaps: Vec<Value> = {
        let mut tabs = mon.tabs.lock().unwrap();
        tabs.iter_mut()
            .filter(|(_, w)| w.main.title.as_deref() == Some(title.as_str()))
            .map(|(id, w)| {
                w.short_title = Some(short.clone());
                w.snapshot(id)
            })
            .collect()
    };
    for s in snaps {
        let _ = app.emit("tab-info", s);
    }
}

fn poll_all(app: &AppHandle, search: bool) {
    let mon = app.state::<Monitor>();
    let mut out = Vec::new();
    let mut want = Vec::new();
    {
        let mut tabs = mon.tabs.lock().unwrap();
        let titles = mon.titles.lock().unwrap();
        for (id, w) in tabs.iter_mut() {
            if w.main.path.is_none() && search {
                if let Some(p) = mon.find_transcript(&w.session_id) {
                    w.main = Transcript::watched(p);
                }
            }
            let mut changed = w.poll();
            if let (Some(t), None) = (&w.main.title, &w.short_title) {
                if let Some(short) = titles.get(t) {
                    w.short_title = Some(short.clone());
                    changed = true;
                } else if !w.title_requested {
                    w.title_requested = true;
                    want.push(t.clone());
                }
            }
            if changed || w.dirty {
                w.dirty = false;
                out.push(w.snapshot(id));
            }
        }
    }
    for t in want {
        mon.request_title(t);
    }
    for s in out {
        let _ = app.emit("tab-info", s);
    }
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = mpsc::channel::<String>();
    *app.state::<Monitor>().title_tx.lock().unwrap() = Some(tx);
    let a = app.clone();
    thread::spawn(move || {
        for title in rx {
            title_job(&a, title);
        }
    });
    let a = app.clone();
    thread::spawn(move || {
        let mut tick = 0u64;
        loop {
            thread::sleep(Duration::from_millis(700));
            tick += 1;
            poll_all(&a, tick % 4 == 0);
        }
    });
}

/// Ajustes que afectan al monitor.
pub fn set_ai_titles(app: &AppHandle, on: bool) {
    app.state::<Monitor>().ai_titles.store(on, Ordering::Relaxed);
}

/// Mensaje que el hook (o la barra de estado) envía a la app.
pub fn hook_message(tab: &str, token: &str, v: &Value) -> Value {
    let s = |k: &str| v.get(k).cloned().unwrap_or(Value::Null);
    let cut = |k: &str, n: usize| v.get(k).and_then(Value::as_str).map(|t| t.chars().take(n).collect::<String>());
    let mut m = Map::new();
    m.insert("t".into(), json!(token));
    m.insert("tab".into(), json!(tab));
    m.insert("ev".into(), s("hook_event_name"));
    m.insert("sid".into(), s("session_id"));
    m.insert("tp".into(), s("transcript_path"));
    m.insert("tool".into(), s("tool_name"));
    m.insert("nt".into(), s("notification_type"));
    m.insert("aid".into(), s("agent_id"));
    m.insert("atype".into(), s("agent_type"));
    m.insert("src".into(), s("source"));
    m.insert("cwd".into(), s("cwd"));
    m.insert("lm".into(), json!(cut("last_assistant_message", 300)));
    m.insert("msg".into(), json!(cut("message", 200)));
    // qué pide: la herramienta descrita en una frase, o la pregunta que te hace
    let tool = v.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let input = v.get("tool_input").cloned().unwrap_or(Value::Null);
    let what = if tool == "AskUserQuestion" {
        input.pointer("/questions/0/question").and_then(Value::as_str).map(|q| clip(q, 160)).unwrap_or_default()
    } else if tool.is_empty() {
        String::new()
    } else {
        describe_tool(tool, &input)
    };
    m.insert("what".into(), json!(what));
    Value::Object(m)
}
