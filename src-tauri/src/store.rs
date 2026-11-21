// Almacén de datos dentro del propio .exe (flujos NTFS: desguaproterm.exe:state.a, …).
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

pub const STATE_SLOTS: [&str; 2] = ["state.a", "state.b"];

#[derive(Clone)]
pub enum Store {
    /// flujos NTFS del propio .exe (lo normal)
    Exe(PathBuf),
    /// carpeta: para pruebas (CT_DATA_DIR) o si la unidad no admite flujos (FAT32, exFAT…)
    Dir(PathBuf),
}

impl Store {
    pub fn open() -> Store {
        if let Some(d) = std::env::var_os("CT_DATA_DIR") {
            return Store::Dir(d.into());
        }
        if let Ok(exe) = std::env::current_exe() {
            let s = Store::Exe(exe);
            if s.write("probe", b"1").is_ok() {
                s.remove("probe");
                return s;
            }
        }
        let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        Store::Dir(base.join("desguaproterm"))
    }

    fn path(&self, name: &str) -> PathBuf {
        match self {
            Store::Exe(exe) => {
                let mut s = exe.clone().into_os_string();
                s.push(":");
                s.push(name);
                PathBuf::from(s)
            }
            Store::Dir(d) => d.join(name),
        }
    }

    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        fs::read(self.path(name)).ok()
    }

    pub fn read_json(&self, name: &str) -> Option<Value> {
        serde_json::from_slice(&self.read(name)?).ok()
    }

    pub fn write(&self, name: &str, bytes: &[u8]) -> std::io::Result<()> {
        if let Store::Dir(d) = self {
            fs::create_dir_all(d)?;
        }
        fs::write(self.path(name), bytes)
    }

    pub fn remove(&self, name: &str) {
        let _ = fs::remove_file(self.path(name));
    }

    /// Para pasárselo al hook por una variable de entorno.
    pub fn encode(&self) -> String {
        match self {
            Store::Exe(p) => format!("exe:{}", p.display()),
            Store::Dir(p) => format!("dir:{}", p.display()),
        }
    }

    pub fn decode(s: &str) -> Option<Store> {
        s.strip_prefix("exe:")
            .map(|p| Store::Exe(p.into()))
            .or_else(|| s.strip_prefix("dir:").map(|p| Store::Dir(p.into())))
    }

    pub fn in_exe(&self) -> bool {
        matches!(self, Store::Exe(_))
    }

    /// El estado se escribe alternando dos ranuras con un contador: si se fuera la luz a mitad
    /// de una escritura, la otra sigue entera. Devuelve el estado, su contador y su ranura.
    pub fn load_state(&self) -> (Value, u64, usize) {
        STATE_SLOTS
            .iter()
            .enumerate()
            .filter_map(|(i, n)| Some((i, self.read_json(n)?)))
            .filter_map(|(i, v)| Some((v.get("state")?.clone(), v.get("seq")?.as_u64()?, i)))
            .filter(|(s, _, _)| s.is_object())
            .max_by_key(|(_, seq, _)| *seq)
            .unwrap_or_else(|| (json!({}), 0, 1))
    }
}
