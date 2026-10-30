// Embute o app (vira Hanko.exe) comprimido dentro do instalador e grava a versão.
use std::{env, fs, io::Write, path::PathBuf};

fn main() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = here.parent().unwrap().to_path_buf();

    let payload = env::var("HANKO_PAYLOAD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("src-tauri/target/release/cofre.exe"));
    println!("cargo:rerun-if-env-changed=HANKO_PAYLOAD");
    println!("cargo:rerun-if-changed={}", payload.display());
    let data = fs::read(&payload).unwrap_or_else(|_| panic!("Não achei {} — gere o app antes (tauri build --no-bundle)", payload.display()));

    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&data).unwrap();
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out.join("payload.deflate"), enc.finish().unwrap()).unwrap();
    println!("cargo:rustc-env=PAYLOAD_SIZE={}", data.len());

    let conf_path = root.join("src-tauri/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf_path.display());
    let conf: serde_json::Value = serde_json::from_str(&fs::read_to_string(conf_path).unwrap()).unwrap();
    println!("cargo:rustc-env=HANKO_VERSION={}", conf["version"].as_str().unwrap());

    tauri_build::build();
}
