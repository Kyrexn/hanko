// Extensão do navegador sem loja: o app traz os arquivos dela embutidos (mesma versão do app,
// cobertos pela assinatura da atualização) e mantém a pasta %LOCALAPPDATA%\Hanko\Extensao.
// O Chrome/Edge carrega essa pasta uma vez ("Carregar sem compactação"); quando o app atualiza,
// a pasta é reescrita e a extensão percebe a versão nova e se recarrega sozinha.

use std::path::PathBuf;

include!(concat!(env!("OUT_DIR"), "/extensao.rs"));

fn dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Hanko").join("Extensao"))
}

fn embedded_version() -> Option<String> {
    let (_, bytes) = FILES.iter().find(|(n, _)| *n == "manifest.json")?;
    let v: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    v.get("version")?.as_str().map(String::from)
}

fn installed_version(d: &PathBuf) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(d.join("manifest.json")).ok()?).ok()?;
    v.get("version")?.as_str().map(String::from)
}

/// Escreve a extensão na pasta. `force`: cria a pasta se ainda não existe (primeira instalação).
/// Sem `force`, só atualiza quem já instalou. O manifest.json vai por último: é ele que anuncia a versão nova.
pub fn sync(force: bool) -> Result<Option<PathBuf>, String> {
    let (Some(d), Some(version)) = (dir(), embedded_version()) else { return Ok(None) };
    if !force && !d.join("manifest.json").exists() {
        return Ok(None);
    }
    if installed_version(&d).as_deref() == Some(version.as_str()) && !force {
        return Ok(Some(d));
    }
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mut manifest: Option<&[u8]> = None;
    for (name, bytes) in FILES {
        if *name == "manifest.json" {
            manifest = Some(bytes);
            continue;
        }
        let path = d.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    remove_stale(&d, &d);
    if let Some(m) = manifest {
        std::fs::write(d.join("manifest.json"), m).map_err(|e| e.to_string())?;
    }
    Ok(Some(d))
}

/// Apaga arquivos de versões antigas (os nomes dos pedaços mudam a cada versão).
fn remove_stale(root: &PathBuf, dir: &PathBuf) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            remove_stale(root, &p);
            let _ = std::fs::remove_dir(&p); // só some se ficou vazia
        } else if let Ok(rel) = p.strip_prefix(root) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel != "manifest.json" && !FILES.iter().any(|(n, _)| *n == rel) {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

#[derive(serde::Serialize)]
pub struct Status {
    available: bool,
    installed: bool,
    path: String,
    version: String,
}

#[tauri::command]
pub fn extension_status() -> Status {
    let d = dir().unwrap_or_default();
    let installed = installed_version(&d);
    Status {
        available: !FILES.is_empty(),
        installed: installed.is_some(),
        path: d.to_string_lossy().into_owned(),
        version: installed.or_else(embedded_version).unwrap_or_default(),
    }
}

/// Prepara (ou repara) a pasta da extensão e devolve o caminho.
#[tauri::command]
pub fn extension_install() -> Result<String, String> {
    sync(true)?.map(|d| d.to_string_lossy().into_owned()).ok_or_else(|| "extensão indisponível nesta versão".into())
}

/// Abre a página de extensões do navegador escolhido (o Windows não deixa abrir chrome:// por link comum).
#[tauri::command]
pub fn open_browser_extensions(browser: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let (exe, url) = if browser == "edge" { ("msedge", "edge://extensions") } else { ("chrome", "chrome://extensions") };
        std::process::Command::new("cmd")
            .args(["/C", "start", "", exe, url])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = browser;
        Err("indisponível".into())
    }
}

/// Mostra a pasta da extensão no Explorador de Arquivos.
#[tauri::command]
pub fn open_extension_folder() -> Result<(), String> {
    let d = dir().ok_or("pasta indisponível")?;
    std::process::Command::new("explorer").arg(&d).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
