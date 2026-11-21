// desguaproterm — núcleo en Rust (Tauri 2).
// Lanza Claude Code dentro de pseudo-terminales (ConPTY), vigila qué hace cada sesión y recuerda
// las que tenías abiertas para reabrirlas, cada una con su conversación, al encender el PC.
//
// Todo va dentro del .exe: la configuración fija está compilada y lo que cambia (pestañas,
// favoritos, ajustes, ventana, títulos) se guarda en flujos NTFS del propio archivo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod monitor;
mod pricing;
mod store;

use monitor::Monitor;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use store::{Store, STATE_SLOTS};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, State, UserAttentionType, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

// ---------- estado ----------
struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    gen: u64,
}

struct Core {
    ptys: Mutex<HashMap<String, Pty>>,
    next_gen: AtomicU64,
    store: Store,
    /// contador y ranura de la última escritura del estado (la siguiente va a la otra)
    state_seq: Mutex<(u64, usize)>,
    home: PathBuf,
    claude: Option<PathBuf>,
    hook_settings: Option<String>,
    hook_ipc: Option<String>,
    win_rect: Mutex<Option<[i32; 4]>>,
    win_max: AtomicBool,
    win_dirty: AtomicBool,
    start_max: bool,
    toast_icon: Option<PathBuf>,
}

/// Identidad de la app para los avisos de Windows.
const AUMID: &str = "dev.julio.desguaproterm";

/// Los avisos de Windows necesitan que la app esté registrada (nombre e icono) en tu usuario.
fn register_toasts() -> Option<PathBuf> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let icon = std::env::temp_dir().join("desguaproterm-icon.png");
    if !icon.is_file() {
        fs::write(&icon, include_bytes!("../icons/128x128.png")).ok()?;
    }
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}")).ok()?;
    key.set_value("DisplayName", &"desguaproterm").ok()?;
    key.set_value("IconUri", &icon.to_string_lossy().to_string()).ok()?;
    Some(icon)
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

impl Core {
    fn claude_projects(&self) -> PathBuf {
        self.home.join(".claude").join("projects")
    }
    fn read_session(&self, tab: &str) -> Option<String> {
        self.store.read_json(&format!("s-{tab}"))?.get("sessionId")?.as_str().map(String::from)
    }
    fn take_pty(&self, tab: &str) -> Option<Pty> {
        self.ptys.lock().unwrap().remove(tab)
    }
    fn save_window(&self) {
        if !self.win_dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let rect = *self.win_rect.lock().unwrap();
        let v = json!({ "rect": rect, "max": self.win_max.load(Ordering::Relaxed) });
        let _ = self.store.write("window", v.to_string().as_bytes());
    }
}

// ---------- utilidades ----------
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(p).ok()?).ok()
}

/// IDs de pestaña y de sesión: solo letras, números, '-' y '_' (se usan en nombres de flujo).
fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn normalize(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let t = s.trim_end_matches('\\');
    if t.ends_with(':') { format!("{t}\\") } else { t.to_string() }
}

fn which(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    names.iter().find_map(|n| std::env::split_paths(&path).map(|d| d.join(n)).find(|p| p.is_file()))
}

fn find_claude(home: &Path) -> Option<PathBuf> {
    let local = home.join(".local").join("bin").join("claude.exe");
    if local.is_file() { Some(local) } else { which(&["claude.exe", "claude.cmd"]) }
}

/// Programa y primeros argumentos para lanzar Claude. Instalado con npm es un `claude.cmd` que
/// solo llama a su .exe (o a node con cli.js): se lanza eso directamente, porque pasar por cmd
/// rompe los argumentos con comillas o `|`.
pub(crate) fn claude_command(claude: &Path) -> (PathBuf, Vec<OsString>) {
    if !claude.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        return (claude.to_path_buf(), vec![]);
    }
    let dir = claude.parent().unwrap_or(Path::new("."));
    // el shim de npm termina en: "%dp0%\node_modules\...\bin\claude.exe" %*
    let target = fs::read_to_string(claude)
        .ok()
        .and_then(|t| t.rsplit("\"%dp0%\\").next().and_then(|s| s.split('"').next()).map(|rel| dir.join(rel)))
        .filter(|p| p.is_file());
    let node = || Some(dir.join("node.exe")).filter(|p| p.is_file()).or_else(|| which(&["node.exe"]));
    match target {
        Some(t) if t.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) => (t, vec![]),
        Some(t) if node().is_some() => (node().unwrap(), vec![t.into_os_string()]),
        _ => (
            std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()).into(),
            vec!["/d".into(), "/s".into(), "/c".into(), claude.as_os_str().to_owned()],
        ),
    }
}

/// La configuración de las sesiones va en un archivo temporal y no como texto en la línea de
/// comandos: así no la rompe nada que tenga que pasar por cmd.
fn settings_arg(json: &str) -> OsString {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    json.hash(&mut h);
    let f = std::env::temp_dir().join(format!("desguaproterm-{:016x}.json", h.finish()));
    let ok = fs::read_to_string(&f).is_ok_and(|s| s == json) || fs::write(&f, json).is_ok();
    if ok { f.into_os_string() } else { json.into() }
}

fn windows_build() -> u32 {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn transcript_exists(projects: &Path, id: &str) -> bool {
    if !valid_id(id) {
        return false;
    }
    let file = format!("{id}.jsonl");
    fs::read_dir(projects).map(|rd| rd.flatten().any(|e| e.path().join(&file).is_file())).unwrap_or(false)
}

/// Variables que Claude Code pone a sus procesos hijos: si la app se abrió desde dentro de una
/// sesión de Claude no deben heredarse, o las sesiones nuevas creerían estar anidadas.
fn strip_env(k: &str) -> bool {
    matches!(k, "CLAUDECODE" | "CLAUDE_PID" | "CLAUDE_CODE_ENTRYPOINT")
        || ["CLAUDE_CODE_SESSION_", "CLAUDE_CODE_CHILD_", "CLAUDE_CODE_MESSAGING_"].iter().any(|p| k.starts_with(p))
}

// ---------- hooks ----------
// Claude Code ejecuta `desguaproterm.exe --hook` en cada evento de las sesiones abiertas desde
// aquí. La configuración se pasa con --settings (en un archivo temporal) y solo afecta a esas
// sesiones (tu configuración global de Claude no se toca).
fn hook_settings_json() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let cmd = json!({ "type": "command", "command": format!("\"{}\" --hook", exe.to_string_lossy().replace('\\', "/")) });
    let mut hooks = serde_json::Map::new();
    for ev in ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "Notification", "PermissionRequest", "SubagentStart", "SubagentStop"] {
        hooks.insert(ev.into(), json!([{ "hooks": [cmd.clone()] }]));
    }
    // solo las herramientas que te preguntan algo
    hooks.insert("PreToolUse".into(), json!([{ "matcher": "AskUserQuestion|ExitPlanMode", "hooks": [cmd] }]));
    // la barra de estado de Claude: trae el % usado de los límites de tu plan
    let status = format!("\"{}\" --statusline", exe.to_string_lossy().replace('\\', "/"));
    Some(json!({ "hooks": hooks, "statusLine": { "type": "command", "command": status, "padding": 0 } }).to_string())
}

/// Envía un mensaje a la app por la conexión local (si está abierta).
fn send_to_app(msg: &Value) {
    let Some((port, _)) = std::env::var("CLAUDE_TERM_IPC").ok().and_then(|s| s.split_once(':').map(|(a, b)| (a.to_string(), b.to_string()))) else { return };
    if let Ok(addr) = format!("127.0.0.1:{port}").parse::<SocketAddr>() {
        if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
            let _ = s.write_all(msg.to_string().as_bytes());
        }
    }
}

/// Barra de estado de Claude Code en las sesiones de desguaproterm: pasa a la app los límites
/// del plan y pinta una línea corta con el modelo, el contexto y el uso de 5 h y de la semana.
fn run_statusline() {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let v: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    if let (Ok(tab), Some(token)) = (
        std::env::var("CLAUDE_TERM_TAB"),
        std::env::var("CLAUDE_TERM_IPC").ok().and_then(|s| s.split_once(':').map(|(_, t)| t.to_string())),
    ) {
        send_to_app(&json!({ "t": token, "tab": tab, "ev": "StatusLine", "rl": v.get("rate_limits"), "model": v.pointer("/model/id") }));
    }
    let pct = |p: &str| v.pointer(p).and_then(Value::as_f64).map(|x| format!("{}%", x.round()));
    let model = v.pointer("/model/display_name").and_then(Value::as_str).unwrap_or("");
    let mut parts = Vec::new();
    if let Some(c) = pct("/context_window/used_percentage") {
        parts.push(format!("contexto {c}"));
    }
    if let Some(h) = pct("/rate_limits/five_hour/used_percentage") {
        parts.push(format!("5 h {h}"));
    }
    if let Some(w) = pct("/rate_limits/seven_day/used_percentage") {
        parts.push(format!("semana {w}"));
    }
    let rest = if parts.is_empty() { String::new() } else { format!(" \x1b[2m· {}\x1b[22m", parts.join(" · ")) };
    print!("\x1b[1m{model}\x1b[22m{rest}");
}

fn run_hook() {
    // No escribe nada por stdout: Claude lo tomaría como respuesta del hook.
    let Ok(tab) = std::env::var("CLAUDE_TERM_TAB") else { return };
    if !valid_id(&tab) {
        return;
    }
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(&input) else { return };
    let ev = v.get("hook_event_name").and_then(Value::as_str).unwrap_or("SessionStart");

    // qué conversación tiene la pestaña: se guarda dentro del .exe para reabrirla al encender
    if ev == "SessionStart" {
        if let (Some(store), Some(sid)) = (
            std::env::var("CLAUDE_TERM_STORE").ok().and_then(|s| Store::decode(&s)),
            v.get("session_id").and_then(Value::as_str),
        ) {
            let rec = json!({ "sessionId": sid, "cwd": v.get("cwd"), "source": v.get("source"), "at": now_ms() });
            let _ = store.write(&format!("s-{tab}"), rec.to_string().as_bytes());
        }
    }
    // aviso al instante a la app (si está abierta)
    if let Some(token) = std::env::var("CLAUDE_TERM_IPC").ok().and_then(|s| s.split_once(':').map(|(_, t)| t.to_string())) {
        send_to_app(&monitor::hook_message(&tab, &token, &v));
    }
}

// ---------- terminales ----------
fn kill_tab(core: &Core, tab: &str) {
    if let Some(mut p) = core.take_pty(tab) {
        // cerrar la ConPTY puede tardar un poco: fuera del hilo de la interfaz
        thread::spawn(move || {
            let _ = p.killer.kill();
            drop(p);
        });
    }
}

fn spawn_failed(on_data: &Channel<InvokeResponseBody>, on_exit: &Channel<i64>, msg: &str) -> Result<Value, String> {
    let text = format!("\r\n\x1b[38;2;255;120;120m{msg}\x1b[0m\r\n");
    let _ = on_data.send(InvokeResponseBody::Raw(text.into_bytes()));
    let _ = on_exit.send(-1);
    Ok(json!({ "ok": false }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn pty_spawn(
    app: AppHandle,
    tab_id: String,
    cwd: String,
    session_id: String,
    cols: u16,
    rows: u16,
    worktree: Option<bool>,
    model: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<i64>,
) -> Result<Value, String> {
    if !valid_id(&tab_id) || !valid_id(&session_id) {
        return Err("identificador no válido".into());
    }
    let core = app.state::<Core>();
    kill_tab(&core, &tab_id);
    let Some(claude) = core.claude.clone() else {
        return spawn_failed(&on_data, &on_exit, "No encuentro \"claude\" en este PC. Instala Claude Code y vuelve a abrir la app.");
    };
    if !Path::new(&cwd).is_dir() {
        return spawn_failed(&on_data, &on_exit, &format!("La carpeta ya no existe: {cwd}"));
    }

    // Si la conversación ya existe se retoma; si no, se crea con este ID para poder retomarla luego.
    let resume = transcript_exists(&core.claude_projects(), &session_id);
    let mut args: Vec<OsString> = vec![if resume { "--resume" } else { "--session-id" }.into(), session_id.clone().into()];
    if let Some(hook) = &core.hook_settings {
        args.push("--settings".into());
        args.push(settings_arg(hook));
    }
    // sesión aislada: Claude crea un worktree de git y trabaja en él sin pisar a las demás
    if !resume && worktree == Some(true) {
        args.push("--worktree".into());
    }
    // modelo, esfuerzo y modo elegidos para ESTA sesión (con flags: no cambian tus valores por defecto)
    let pick = |v: &Option<String>, allowed: &[&str]| v.as_deref().filter(|x| allowed.contains(x)).map(String::from);
    let model = pick(&model, &["opus", "sonnet", "haiku", "fable"]);
    if let Some(m) = &model {
        args.extend(["--model".into(), m.into()]);
    }
    if let Some(e) = pick(&effort, &["low", "medium", "high", "xhigh", "max"]) {
        args.extend(["--effort".into(), e.into()]);
    }
    if let Some(m) = pick(&mode, &["manual", "acceptEdits", "plan", "auto"]) {
        args.extend(["--permission-mode".into(), m.into()]);
    }
    // solo para pruebas: arranca la sesión nueva con un mensaje (y con Haiku, que gasta poco)
    if let (false, Ok(p)) = (resume, std::env::var("CT_TEST_PROMPT")) {
        if let Ok(mode) = std::env::var("CT_TEST_PERM") {
            args.extend(["--permission-mode".into(), mode.into()]);
        }
        if model.is_none() {
            args.extend(["--model".into(), "haiku".into()]);
        }
        args.push(p.into());
    }
    let (program, pre) = claude_command(&claude);
    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&pre);
    cmd.args(&args);
    cmd.cwd(&cwd);
    for (k, _) in std::env::vars_os() {
        if strip_env(&k.to_string_lossy()) {
            cmd.env_remove(&k);
        }
    }
    cmd.env("CLAUDE_TERM_TAB", &tab_id);
    cmd.env("CLAUDE_TERM_STORE", core.store.encode());
    if let Some(ipc) = &core.hook_ipc {
        cmd.env("CLAUDE_TERM_IPC", ipc);
    }
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM", "xterm-256color");

    let size = PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system().openpty(size).map_err(|e| e.to_string())?;
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => return spawn_failed(&on_data, &on_exit, &format!("No se pudo abrir Claude: {e}")),
    };
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let gen = core.next_gen.fetch_add(1, Ordering::Relaxed) + 1;
    core.ptys
        .lock()
        .unwrap()
        .insert(tab_id.clone(), Pty { master: pair.master, writer, killer: child.clone_killer(), gen });
    monitor::watch(&app, &tab_id, &session_id);

    // salida de la terminal → interfaz, en binario y sin conversiones
    thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // cuando Claude se cierra: avisa a la interfaz (salvo que la hayamos cerrado nosotros)
    let app2 = app.clone();
    thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
        thread::sleep(Duration::from_millis(150)); // deja llegar lo último que pintó
        let core = app2.state::<Core>();
        let mine = {
            let mut m = core.ptys.lock().unwrap();
            if m.get(&tab_id).is_some_and(|p| p.gen == gen) { m.remove(&tab_id) } else { None }
        };
        if let Some(p) = mine {
            drop(p);
            monitor::set_status(&app2, &tab_id, "exited");
            let _ = on_exit.send(code);
        }
    });

    Ok(json!({ "ok": true, "resume": resume }))
}

#[tauri::command]
fn pty_write(core: State<Core>, tab_id: String, data: String) {
    if let Some(p) = core.ptys.lock().unwrap().get_mut(&tab_id) {
        let _ = p.writer.write_all(data.as_bytes());
        let _ = p.writer.flush();
    }
}

#[tauri::command]
fn pty_resize(core: State<Core>, tab_id: String, cols: u16, rows: u16) {
    if let Some(p) = core.ptys.lock().unwrap().get(&tab_id) {
        let _ = p.master.resize(PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 });
    }
}

/// Cierra la sesión de una pestaña y devuelve el ID de su conversación (para poder deshacer).
#[tauri::command]
fn pty_kill(app: AppHandle, core: State<Core>, tab_id: String, forget: bool) -> Option<String> {
    if !valid_id(&tab_id) {
        return None;
    }
    kill_tab(&core, &tab_id);
    let sid = core.read_session(&tab_id);
    if forget {
        core.store.remove(&format!("s-{tab_id}"));
        monitor::unwatch(&app, &tab_id);
    }
    sid
}

// ---------- monitor ----------
#[tauri::command]
fn monitor_snapshot(mon: State<Monitor>) -> Vec<Value> {
    mon.snapshot_all()
}

/// Gasto de hoy y de la semana (desde `week`), por modelo, por tarea y por día, con su precio por API.
#[tauri::command]
async fn usage_report(app: AppHandle, today: u64, week: u64, chart_from: u64, tz: i64) -> Value {
    app.state::<Monitor>().usage_report(today, week, chart_from, tz)
}

#[tauri::command]
fn action_diff(mon: State<Monitor>, tab_id: String, action_id: String) -> Option<Value> {
    mon.action_diff(&tab_id, &action_id)
}

/// Vigila una sesión dormida (sin Claude abierto): título, tokens y tareas siguen al día.
#[tauri::command]
fn monitor_watch(app: AppHandle, tab_id: String, session_id: String) {
    if valid_id(&tab_id) && valid_id(&session_id) {
        monitor::watch(&app, &tab_id, &session_id);
    }
}

#[tauri::command]
async fn search_conversations(app: AppHandle, query: String) -> Vec<Value> {
    app.state::<Monitor>().search(&query)
}

/// Aviso de Windows con botones; al pulsar uno, la interfaz recibe "toast-action".
#[tauri::command]
fn notify(app: AppHandle, core: State<Core>, tab_id: String, title: String, body: String, buttons: Vec<(String, String)>) {
    use tauri_winrt_notification::{IconCrop, Toast};
    let mut t = Toast::new(AUMID).title(&title).text1(&body);
    if let Some(icon) = &core.toast_icon {
        t = t.icon(icon, IconCrop::Square, "desguaproterm");
    }
    for (label, action) in &buttons {
        t = t.add_button(label, action);
    }
    let app2 = app.clone();
    t = t.on_activated(move |action| {
        let action = action.unwrap_or_else(|| "view".into());
        if action == "view" {
            if let Some(w) = app2.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        let _ = app2.emit("toast-action", json!({ "tabId": tab_id, "action": action }));
        Ok(())
    });
    let _ = t.show();
}

/// Miniatura (PNG en data URL) de la imagen del portapapeles, si hay una.
#[tauri::command]
async fn clip_image() -> Option<String> {
    let img = arboard::Clipboard::new().ok()?.get_image().ok()?;
    let (w, h) = (img.width as u32, img.height as u32);
    let rgba = image::RgbaImage::from_raw(w, h, img.bytes.into_owned())?;
    let thumb = if w > 640 { image::imageops::thumbnail(&rgba, 640, ((h as u64 * 640) / w as u64).max(1) as u32) } else { rgba };
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(thumb).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", b64(&png)))
}

/// "dir", "file" o nada: para saber si lo que sueltas en la ventana es una carpeta.
#[tauri::command]
fn path_kind(path: String) -> Option<&'static str> {
    let m = fs::metadata(&path).ok()?;
    Some(if m.is_dir() { "dir" } else { "file" })
}

/// Vista previa de un archivo de imagen que arrastras (data URL), si es una imagen razonable.
#[tauri::command]
async fn file_preview(path: String) -> Option<String> {
    let ext = Path::new(&path).extension()?.to_string_lossy().to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    };
    if fs::metadata(&path).ok()?.len() > 15 * 1024 * 1024 {
        return None;
    }
    Some(format!("data:{mime};base64,{}", b64(&fs::read(&path).ok()?)))
}

#[tauri::command]
fn set_prefs(app: AppHandle, ai_titles: bool) {
    monitor::set_ai_titles(&app, ai_titles);
}

// ---------- estado guardado ----------
#[tauri::command]
fn state_load(core: State<Core>) -> Value {
    let (mut s, _, _) = core.store.load_state();
    let tabs: Vec<Value> = s
        .get("tabs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| ["id", "cwd", "sessionId"].iter().all(|k| t.get(k).and_then(Value::as_str).is_some()))
        .filter(|t| valid_id(t["id"].as_str().unwrap_or("")))
        .map(|mut t| {
            // lo que apuntó el hook manda: es la conversación que tenía la pestaña al apagar
            let id = t["id"].as_str().unwrap_or("").to_string();
            if let Some(sid) = core.read_session(&id) {
                t["sessionId"] = json!(sid);
            }
            t
        })
        .collect();
    s["tabs"] = Value::Array(tabs);
    s
}

#[tauri::command]
fn state_save(core: State<Core>, state: Value) -> Result<(), String> {
    let mut last = core.state_seq.lock().unwrap();
    let (seq, slot) = (last.0 + 1, 1 - last.1);
    let bytes = serde_json::to_vec(&json!({ "seq": seq, "state": state })).map_err(|e| e.to_string())?;
    core.store.write(STATE_SLOTS[slot], &bytes).map_err(|e| e.to_string())?;
    *last = (seq, slot);
    Ok(())
}

// ---------- proyectos que conoce Claude Code ----------
fn read_cwd(p: &Path) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let mut buf = vec![0u8; 64 * 1024];
    let n = f.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let rest = &text[text.find("\"cwd\":\"")? + 7..];
    let mut escaped = false;
    let end = rest.char_indices().find_map(|(i, c)| {
        if escaped {
            escaped = false;
            None
        } else if c == '\\' {
            escaped = true;
            None
        } else if c == '"' {
            Some(i)
        } else {
            None
        }
    })?;
    serde_json::from_str::<String>(&format!("\"{}\"", &rest[..end])).ok()
}

fn mtime_ms(e: &fs::DirEntry) -> u64 {
    e.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
async fn projects_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let core = app.state::<Core>();
    let mut found: HashMap<String, (String, u64)> = HashMap::new();
    let mut add = |p: &Path, t: u64| {
        if !p.is_dir() {
            return;
        }
        let path = normalize(p);
        let e = found.entry(path.to_lowercase()).or_insert((path, t));
        e.1 = e.1.max(t);
    };
    if let Ok(rd) = fs::read_dir(core.claude_projects()) {
        for d in rd.flatten() {
            let newest = fs::read_dir(d.path()).ok().and_then(|files| {
                files
                    .flatten()
                    .filter(|f| f.path().extension().is_some_and(|x| x == "jsonl"))
                    .map(|f| (f.path(), mtime_ms(&f)))
                    .max_by_key(|x| x.1)
            });
            if let Some((p, t)) = newest {
                if let Some(cwd) = read_cwd(&p) {
                    add(Path::new(&cwd), t);
                }
            }
        }
    }
    if let Some(cj) = read_json(&core.home.join(".claude.json")) {
        if let Some(obj) = cj.get("projects").and_then(Value::as_object) {
            for k in obj.keys() {
                add(Path::new(k), 0);
            }
        }
    }
    let mut list: Vec<(String, u64)> = found.into_values().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(list
        .into_iter()
        .map(|(path, t)| {
            let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
            json!({ "path": path, "name": name, "lastUsed": t })
        })
        .collect())
}

// ---------- sistema ----------
#[tauri::command]
fn sys_info(core: State<Core>) -> Value {
    json!({
        "build": windows_build(),
        "claude": core.claude,
        "hook": core.hook_settings.is_some(),
        "live": core.hook_ipc.is_some(),
        "home": core.home,
        "storeInExe": core.store.in_exe(),
        "test": std::env::var("CT_TEST_UI").ok(), // solo para pruebas
    })
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_title("Elige la carpeta del proyecto");
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    Ok(dialog.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| normalize(&p)))
}

#[tauri::command]
fn clip_read() -> String {
    arboard::Clipboard::new().and_then(|mut c| c.get_text()).unwrap_or_default()
}

#[tauri::command]
fn clip_write(text: String) {
    if let Ok(mut c) = arboard::Clipboard::new() {
        let _ = c.set_text(text);
    }
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    } else if lower.starts_with("file:") {
        // rutas que enlaza Claude: se muestran en el Explorador, nunca se ejecutan
        if let Some(p) = tauri::Url::parse(&url).ok().and_then(|u| u.to_file_path().ok()) {
            if p.exists() {
                let _ = app.opener().reveal_item_in_dir(p);
            }
        }
    }
}

#[tauri::command]
fn open_folder(app: AppHandle, path: String) {
    if Path::new(&path).is_dir() {
        let _ = app.opener().open_path(path, None::<&str>);
    }
}

#[tauri::command]
fn login_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn login_set(app: AppHandle, on: bool) -> bool {
    let m = app.autolaunch();
    let _ = if on { m.enable() } else { m.disable() };
    m.is_enabled().unwrap_or(false)
}

#[tauri::command]
fn attention(window: WebviewWindow) {
    if !window.is_focused().unwrap_or(true) {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

#[tauri::command]
fn ui_ready(window: WebviewWindow, core: State<Core>) {
    if !window.is_visible().unwrap_or(true) {
        if core.start_max {
            let _ = window.maximize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn log_js(core: State<Core>, msg: String) {
    let mut log = core.store.read("log").unwrap_or_default();
    if log.len() > 64 * 1024 {
        log.drain(..log.len() - 32 * 1024);
    }
    log.extend_from_slice(format!("[{}] {msg}\n", now_ms()).as_bytes());
    let _ = core.store.write("log", &log);
}

// ---------- ventana ----------
/// "Ahorrar memoria": WebView2 sin GPU (unos 80 MB menos; se dibuja con el procesador).
/// Hay que decidirlo antes de crear la ventana.
fn apply_low_memory_mode(state: &Value) {
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some() {
        return; // ya lo controla quien lanzó la app
    }
    if state.get("lowMemory").and_then(Value::as_bool) == Some(true) {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu",
        );
    }
}

/// Coloca la ventana donde estaba, si ese sitio sigue existiendo (pantallas cambiadas, etc.).
fn restore_window(win: &WebviewWindow, saved: Option<Value>) -> (Option<[i32; 4]>, bool) {
    let Some(saved) = saved else { return (None, false) };
    let max = saved.get("max").and_then(Value::as_bool).unwrap_or(false);
    let rect: Option<[i32; 4]> = saved.get("rect").and_then(|r| serde_json::from_value(r.clone()).ok());
    let Some([x, y, w, h]) = rect else { return (None, max) };
    let visible = win.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x < p.x + s.width as i32 - 80 && x + w > p.x + 80 && y < p.y + s.height as i32 - 40 && y + h > p.y
    });
    if visible && w >= 400 && h >= 300 {
        let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
        let _ = win.set_position(PhysicalPosition::new(x, y));
        (Some([x, y, w, h]), max)
    } else {
        (None, max)
    }
}

fn main() {
    if std::env::args().any(|a| a == "--hook") {
        run_hook();
        return;
    }
    if std::env::args().any(|a| a == "--statusline") {
        run_statusline();
        return;
    }
    let store = Store::open();
    let (initial_state, initial_seq, initial_slot) = store.load_state();
    apply_low_memory_mode(&initial_state);
    let ai_titles = initial_state.get("aiTitles").and_then(Value::as_bool).unwrap_or(true);
    // en pruebas (variables CT_*) puede convivir con la app de verdad abierta
    let testing = ["CT_DATA_DIR", "CT_TEST_UI", "CT_TEST_PROMPT"].iter().any(|k| std::env::var_os(k).is_some());
    let webview_dir = std::env::temp_dir().join(if testing { "desguaproterm-WebView2-test" } else { "desguaproterm-WebView2" });

    let mut builder = tauri::Builder::default();
    if !testing {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let home = app.path().home_dir()?;
            // WebView2 exige una carpeta mientras funciona: va a Temp y en modo privado (solo caché)
            let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("falta la ventana")?;
            let win = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .data_directory(webview_dir)
                .build()?;
            let (rect, start_max) = restore_window(&win, store.read_json("window"));

            // si arranca con Windows, apunta siempre al .exe actual (por si se movió de sitio)
            if app.autolaunch().is_enabled().unwrap_or(false) {
                let _ = app.autolaunch().enable();
            }
            let claude = find_claude(&home);
            app.manage(Monitor::new(home.join(".claude").join("projects"), claude.clone(), store.clone(), ai_titles));
            let hook_ipc = monitor::start_hook_server(app.handle().clone());
            app.manage(Core {
                ptys: Mutex::new(HashMap::new()),
                next_gen: AtomicU64::new(0),
                store: store.clone(),
                state_seq: Mutex::new((initial_seq, initial_slot)),
                claude,
                home,
                hook_settings: hook_settings_json(),
                hook_ipc,
                win_rect: Mutex::new(rect),
                win_max: AtomicBool::new(start_max),
                win_dirty: AtomicBool::new(false),
                start_max,
                toast_icon: register_toasts(),
            });
            monitor::start(app.handle());

            // guarda la posición de la ventana sin escribir en cada píxel que se mueve
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(1500));
                if let Some(core) = handle.try_state::<Core>() {
                    core.save_window();
                }
            });
            Ok(())
        })
        .on_window_event(|w, e| match e {
            WindowEvent::Focused(true) => {
                let _ = w.emit("win-focus", ());
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                let Some(core) = w.try_state::<Core>() else { return };
                if w.is_minimized().unwrap_or(false) || !w.is_visible().unwrap_or(false) {
                    return;
                }
                let max = w.is_maximized().unwrap_or(false);
                if !max {
                    if let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) {
                        *core.win_rect.lock().unwrap() = Some([p.x, p.y, s.width as i32, s.height as i32]);
                    }
                }
                core.win_max.store(max, Ordering::Relaxed);
                core.win_dirty.store(true, Ordering::Relaxed);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            sys_info,
            state_load,
            state_save,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            monitor_snapshot,
            usage_report,
            search_conversations,
            action_diff,
            monitor_watch,
            notify,
            clip_image,
            file_preview,
            path_kind,
            set_prefs,
            projects_list,
            pick_folder,
            clip_read,
            clip_write,
            open_external,
            open_folder,
            login_get,
            login_set,
            attention,
            ui_ready,
            log_js
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo arrancar desguaproterm");

    app.run(|app, ev| {
        if let RunEvent::Exit = ev {
            let core = app.state::<Core>();
            core.save_window();
            let all: Vec<Pty> = core.ptys.lock().unwrap().drain().map(|(_, p)| p).collect();
            for mut p in all {
                let _ = p.killer.kill();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    /// El claude.cmd que crea npm no debe lanzarse con cmd: se lanza el claude.exe que llama.
    #[test]
    fn npm_shim_launches_its_exe() {
        let dir = std::env::temp_dir().join(format!("dgp-shim-{}", std::process::id()));
        let bin = dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("claude.exe"), b"").unwrap();
        let shim = dir.join("claude.cmd");
        std::fs::write(&shim, "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n").unwrap();
        let (prog, pre) = super::claude_command(&shim);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(prog, bin.join("claude.exe"));
        assert!(pre.is_empty());
    }
}