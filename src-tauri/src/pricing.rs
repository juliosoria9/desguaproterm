// Precio por API de lo que gasta Claude Code (lo que costaría pagando por tokens).
// Tarifas de la API de Anthropic en $ por millón de tokens (tabla del 2026-11-03).
// Escritura de caché: 1,25× la entrada (5 min) y 2× (1 h). Lectura de caché: según el modelo.
use serde_json::Value;

/// (modelo, entrada, salida, lectura de caché)
const TABLE: &[(&str, f64, f64, f64)] = &[
    ("fable-5-2", 8.0, 40.0, 0.20),
    ("mythos-5-2", 8.0, 40.0, 0.20),
    ("fable-5-1", 10.0, 50.0, 0.25),
    ("mythos-5-1", 10.0, 50.0, 0.25),
    ("fable-5", 10.0, 50.0, 1.00),
    ("mythos-5", 10.0, 50.0, 1.00),
    ("opus-5-5", 4.0, 20.0, 0.20),
    ("opus-5", 5.0, 25.0, 0.50),
    ("opus-4-8", 5.0, 25.0, 0.50),
    ("opus-4-7", 5.0, 25.0, 0.50),
    ("opus-4-6", 5.0, 25.0, 0.50),
    ("opus-4-5", 5.0, 25.0, 0.50),
    ("opus-4-1", 15.0, 75.0, 1.50),
    ("opus-4", 15.0, 75.0, 1.50),
    ("sonnet-5-5", 2.0, 10.0, 0.10),
    ("sonnet-5", 2.0, 10.0, 0.20),
    ("sonnet-4-6", 3.0, 15.0, 0.30),
    ("sonnet-4-5", 3.0, 15.0, 0.30),
    ("sonnet-4", 3.0, 15.0, 0.30),
    ("sonnet-3-7", 3.0, 15.0, 0.30),
    ("haiku-5-5", 0.10, 0.50, 0.01),
    ("haiku-4-5", 1.0, 5.0, 0.10),
    ("haiku-3-5", 0.80, 4.0, 0.08),
];

/// Tarifa del modelo: (entrada, salida, lectura de caché). Si no está en la tabla se usa la de
/// su familia actual (opus → Opus 5.5, etc.).
fn rates(model: &str) -> Option<(f64, f64, f64)> {
    let m = model.to_ascii_lowercase();
    let m = m.trim_start_matches("claude-");
    let mut best: Option<&(&str, f64, f64, f64)> = None;
    for row in TABLE {
        if m.starts_with(row.0) && best.is_none_or(|b| row.0.len() > b.0.len()) {
            best = Some(row);
        }
    }
    if let Some(r) = best {
        return Some((r.1, r.2, r.3));
    }
    let family = ["fable", "mythos", "opus", "sonnet", "haiku"].into_iter().find(|f| m.contains(f))?;
    let current = match family {
        "fable" | "mythos" => "fable-5-2",
        "opus" => "opus-5-5",
        "sonnet" => "sonnet-5-5",
        _ => "haiku-5-5",
    };
    TABLE.iter().find(|r| r.0 == current).map(|r| (r.1, r.2, r.3))
}

/// Coste en dólares de un mensaje a partir de su `usage`.
pub fn cost(model: &str, u: &Value) -> f64 {
    let Some((input, output, read)) = rates(model) else { return 0.0 };
    let g = |v: &Value, k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0) as f64;
    let (w5, w1h) = match u.get("cache_creation") {
        Some(cc) if cc.is_object() => (g(cc, "ephemeral_5m_input_tokens"), g(cc, "ephemeral_1h_input_tokens")),
        _ => (g(u, "cache_creation_input_tokens"), 0.0),
    };
    let (inp, out, cr) = (g(u, "input_tokens"), g(u, "output_tokens"), g(u, "cache_read_input_tokens"));
    let mut mult = if u.get("speed").and_then(Value::as_str) == Some("fast") { 2.0 } else { 1.0 };
    // Haiku 5.5: los mensajes de más de 100K tokens de entrada van a 0,50 / 2,50 (5×)
    if model.contains("haiku-5-5") && inp + cr + w5 + w1h > 100_000.0 {
        mult *= 5.0;
    }
    let tokens = (inp * input + out * output + w5 * input * 1.25 + w1h * input * 2.0 + cr * read) / 1_000_000.0;
    let searches = u.pointer("/server_tool_use/web_search_requests").and_then(Value::as_u64).unwrap_or(0) as f64 * 0.01;
    tokens * mult + searches
}
