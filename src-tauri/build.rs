use std::fmt::Write as _;
use std::path::{Path, PathBuf};

fn main() {
    embed_extension();
    tauri_build::build()
}

/// Embute a extensão do navegador (extension/dist) no app do computador: o app mantém a pasta da
/// extensão sempre na versão dele, e a extensão se recarrega sozinha — atualização sem loja.
fn embed_extension() {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    let mut files = Vec::new();
    if dist.join("manifest.json").exists() {
        walk(&dist, &dist, &mut files);
    }
    files.sort();
    let mut code = String::from("pub static FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in &files {
        println!("cargo:rerun-if-changed={}", abs.display());
        writeln!(code, "    ({:?}, include_bytes!({:?})),", rel, abs.to_string_lossy()).unwrap();
    }
    code.push_str("];\n");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("extensao.rs");
    std::fs::write(out, code).unwrap();
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(root, &p, out);
        } else {
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            out.push((rel, p.canonicalize().unwrap()));
        }
    }
}
