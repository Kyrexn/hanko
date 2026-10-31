// Atualização silenciosa no computador:
// 1. baixa a versão nova em segundo plano (o atualizador do Tauri confere a assinatura);
// 2. guarda o instalador já verificado na pasta do app;
// 3. instala sem janela quando o Hanko é fechado — ou na hora, se a pessoa pedir "reiniciar agora".

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct Pending(pub Mutex<Option<(String, PathBuf)>>);

#[derive(serde::Serialize)]
pub struct Ready {
    version: String,
    notes: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Procura versão nova e já baixa. Devolve a versão pronta para instalar (ou nada).
#[tauri::command]
pub async fn update_prepare(app: AppHandle) -> Result<Option<Ready>, String> {
    if let Some((v, p)) = app.state::<Pending>().0.lock().unwrap().clone() {
        if p.exists() {
            return Ok(Some(Ready { version: v, notes: String::new() }));
        }
    }
    let Some(update) = app.updater().map_err(err)?.check().await.map_err(err)? else {
        return Ok(None);
    };
    // Avisa a interface com bytes reais (só quando o número inteiro de % muda).
    let _ = app.emit("update-progress", (0u64, 0u64, update.version.clone()));
    let (mut done, mut last) = (0u64, u64::MAX);
    let emitter = app.clone();
    let version = update.version.clone();
    // download() só devolve os bytes se a assinatura conferir com a chave pública embutida no app.
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                let total = total.unwrap_or(0);
                let pct = if total > 0 { done * 100 / total } else { done / 1_048_576 };
                if pct != last {
                    last = pct;
                    let _ = emitter.emit("update-progress", (done, total, version.clone()));
                }
            },
            || {},
        )
        .await
        .map_err(err)?;
    let dir = app.path().app_local_data_dir().map_err(err)?.join("atualizacao");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("Hanko-{}-Setup.exe", update.version));
    std::fs::write(&path, bytes).map_err(err)?;
    *app.state::<Pending>().0.lock().unwrap() = Some((update.version.clone(), path));
    Ok(Some(Ready { version: update.version.clone(), notes: update.body.clone().unwrap_or_default() }))
}

/// Roda o instalador verificado. `restart`: janela pequena e reabre o app; senão, silencioso.
pub fn run_installer(path: &PathBuf, restart: bool) {
    let args: &[&str] = if restart { &["/P", "/UPDATE", "/R"] } else { &["/S", "/UPDATE"] };
    let _ = std::process::Command::new(path).args(args).spawn();
}

/// "Reiniciar agora": instala e reabre.
#[tauri::command]
pub fn update_apply_now(app: AppHandle) -> Result<(), String> {
    let pending = app.state::<Pending>().0.lock().unwrap().take();
    let Some((_, path)) = pending else { return Err("nenhuma atualização baixada".into()) };
    run_installer(&path, true);
    app.exit(0);
    Ok(())
}

/// Ao fechar o app: se houver versão baixada, instala em silêncio (sem reabrir).
pub fn apply_on_exit(app: &AppHandle) {
    if let Some((_, path)) = app.state::<Pending>().0.lock().unwrap().take() {
        if path.exists() {
            run_installer(&path, false);
        }
    }
}
