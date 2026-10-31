// Hanko Setup — instalador próprio do Hanko para Windows.
//
// Modos:
//   (sem argumentos)  interface completa: instalar / atualizar / desinstalar
//   --uninstall       interface de desinstalação (chamado por "Aplicativos instalados")
//   /P /UPDATE /R     modo passivo do atualizador automático: janela pequena, instala e reabre
//   /S                silencioso, sem janela
// Os argumentos /P /S /R /UPDATE são os que o atualizador do Tauri usa (ele já conferiu a assinatura).
#![windows_subsystem = "windows"]

use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const VERSION: &str = env!("HANKO_VERSION");
const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.deflate"));
const APP_EXE: &str = "Hanko.exe";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Hanko";
const APP_DATA_ID: &str = "com.julio.hanko";
const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Install,
    Uninstall,
    Update,
}

struct Opts {
    mode: Mode,
    restart: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    mode: Mode,
    version: &'static str,
    default_dir: String,
    installed_version: Option<String>,
    installed_dir: Option<String>,
    size_mb: f64,
}

/// Progresso real: `pct` vem de bytes copiados ou arquivos removidos de verdade (não de tempo).
#[derive(Serialize, Clone)]
struct Progress {
    pct: f64,
    step: u32,
    text: String,
    done: u64,
    total: u64,
}

/// Conta unidades de trabalho reais (bytes ou arquivos) e avisa a interface só quando o número muda.
struct Meter<'a> {
    app: Option<&'a AppHandle>,
    total: u64,
    done: u64,
    last: f64,
    step: u32,
}

impl<'a> Meter<'a> {
    fn new(app: Option<&'a AppHandle>, total: u64) -> Self {
        Meter { app, total: total.max(1), done: 0, last: -1.0, step: 0 }
    }
    fn add(&mut self, n: u64, step: u32, text: &str) {
        self.done = (self.done + n).min(self.total);
        let pct = (self.done as f64 * 1000.0 / self.total as f64).floor() / 10.0;
        if pct != self.last || step != self.step || self.done == self.total {
            self.last = pct;
            self.step = step;
            if let Some(app) = self.app {
                let _ = app.emit("progress", Progress { pct, step, text: text.into(), done: self.done, total: self.total });
            }
        }
    }
}

/// Peso de uma etapa sem bytes (atalho, registro): 256 KB, para aparecer no progresso sem distorcer.
const STEP_UNIT: u64 = 256 * 1024;

fn payload_size() -> u64 {
    env!("PAYLOAD_SIZE").parse().unwrap_or(1)
}

fn default_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(r"C:\Hanko")).join("Hanko")
}

fn installed() -> Option<(String, PathBuf)> {
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()?;
    let ver: String = key.get_value("DisplayVersion").unwrap_or_default();
    let dir: String = key.get_value("InstallLocation").ok()?;
    Some((ver, PathBuf::from(dir.trim_matches('"'))))
}

fn start_menu_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs\Hanko"))
}

fn desktop_link() -> Option<PathBuf> {
    dirs::desktop_dir().map(|d| d.join("Hanko.lnk"))
}


/// Fecha o Hanko se estiver aberto (senão o arquivo fica travado).
fn close_app() {
    let _ = Command::new("taskkill").args(["/IM", APP_EXE, "/F"]).creation_flags(NO_WINDOW).output();
    std::thread::sleep(Duration::from_millis(500));
}

/// Remove a instalação antiga com o nome "Cofre" (até a 0.5): programa, atalhos e registro.
/// Os dados antigos (%LOCALAPPDATA%\com.julio.cofre) ficam onde estão — a conta na nuvem traz tudo de volta.
fn remove_legacy() {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let legacy_key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Cofre";
    let old_dir = hkcu
        .open_subkey(legacy_key)
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
        .map(|d| PathBuf::from(d.trim_matches('"')))
        .or_else(|| dirs::data_local_dir().map(|d| d.join("Cofre")));
    let _ = Command::new("taskkill").args(["/IM", "Cofre.exe", "/F"]).creation_flags(NO_WINDOW).output();
    if let Some(sm) = dirs::data_dir() {
        let _ = fs::remove_dir_all(sm.join(r"Microsoft\Windows\Start Menu\Programs\Cofre"));
    }
    if let Some(dt) = dirs::desktop_dir() {
        let _ = fs::remove_file(dt.join("Cofre.lnk"));
    }
    if let Some(dir) = old_dir {
        // Só apaga se for mesmo a pasta do app antigo.
        if dir.join("Cofre.exe").exists() && dir != default_dir() {
            let _ = fs::remove_file(dir.join("Cofre.exe"));
            let _ = fs::remove_file(dir.join("uninstall.exe"));
            let _ = fs::remove_dir(&dir);
        }
    }
    let _ = hkcu.delete_subkey_all(legacy_key);
}

fn make_link(target: &Path, link: &Path) -> Result<(), String> {
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut sl = mslnk::ShellLink::new(target).map_err(|e| e.to_string())?;
    sl.set_working_dir(target.parent().map(|p| p.to_string_lossy().into_owned()));
    sl.set_icon_location(Some(target.to_string_lossy().into_owned()));
    sl.set_name(Some("Hanko — senhas e 2FA, selados".into()));
    sl.create_lnk(link).map_err(|e| e.to_string())
}

/// Copia um arquivo em pedaços, somando os bytes no medidor.
fn copy_counted(from: &Path, to: &Path, m: &mut Meter, step: u32, text: &str) -> Result<(), String> {
    let mut src = fs::File::open(from).map_err(|e| e.to_string())?;
    let mut dst = fs::File::create(to).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = src.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        m.add(n as u64, step, text);
    }
    dst.flush().map_err(|e| e.to_string())
}

fn do_install(app: Option<&AppHandle>, dir: &Path, desktop: bool, start_menu: bool) -> Result<(), String> {
    // Trabalho total, em bytes reais: o app descomprimido + a cópia do desinstalador + etapas pequenas.
    let me = std::env::current_exe().ok();
    let un_path = dir.join("uninstall.exe");
    let self_size = me.as_ref().filter(|p| **p != un_path).and_then(|p| fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
    let mut m = Meter::new(app, payload_size() + self_size + STEP_UNIT * 4);

    m.add(0, 1, "Fechando o Hanko, se estiver aberto");
    close_app();
    remove_legacy();
    fs::create_dir_all(dir).map_err(|e| format!("Não consegui criar a pasta: {e}"))?;
    m.add(STEP_UNIT, 1, "Pasta pronta");

    // Descomprime o app: cada pedaço escrito no disco conta no progresso.
    let tmp = dir.join("Hanko.exe.novo");
    {
        let mut dec = flate2::read::DeflateDecoder::new(PAYLOAD);
        let mut out = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = dec.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            m.add(n as u64, 2, "Copiando o Hanko");
        }
        out.flush().map_err(|e| e.to_string())?;
    }
    let exe = dir.join(APP_EXE);
    let mut tries = 0;
    while let Err(e) = fs::rename(&tmp, &exe) {
        tries += 1;
        if tries > 6 {
            return Err(format!("O Hanko parece estar aberto e não pôde ser substituído ({e})."));
        }
        close_app();
    }

    // O próprio instalador vira o desinstalador.
    if let Some(me) = me.as_ref().filter(|p| **p != un_path) {
        if copy_counted(me, &un_path, &mut m, 3, "Guardando o desinstalador").is_err() {
            let _ = fs::copy(me, &un_path);
        }
    }
    m.add(0, 3, "Criando atalhos");
    if start_menu {
        if let Some(sm) = start_menu_dir() {
            make_link(&exe, &sm.join("Hanko.lnk"))?;
        }
    }
    if let Some(dl) = desktop_link() {
        if desktop {
            make_link(&exe, &dl)?;
        } else if dl.exists() && app.is_some() {
            let _ = fs::remove_file(dl);
        }
    }

    m.add(STEP_UNIT, 3, "Atalhos criados");
    m.add(0, 4, "Registrando no Windows");
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(UNINSTALL_KEY).map_err(|e| e.to_string())?;
    let un = format!("\"{}\" --uninstall", dir.join("uninstall.exe").display());
    let set = |k: &str, v: &str| key.set_value(k, &v.to_string()).map_err(|e| e.to_string());
    set("DisplayName", "Hanko")?;
    set("DisplayVersion", VERSION)?;
    set("Publisher", "Hanko")?;
    set("DisplayIcon", &exe.display().to_string())?;
    set("InstallLocation", &dir.display().to_string())?;
    set("UninstallString", &un)?;
    set("QuietUninstallString", &un)?;
    key.set_value("EstimatedSize", &((payload_size() / 1024) as u32)).map_err(|e| e.to_string())?;
    key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
    m.add(STEP_UNIT, 4, "Registrado");

    m.add(STEP_UNIT, 5, "Pronto");
    Ok(())
}

/// Todos os arquivos dentro de uma pasta (para remover um a um e contar de verdade).
fn files_in(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            files_in(&p, out);
        } else {
            out.push(p);
        }
    }
}

fn do_uninstall(app: Option<&AppHandle>, remove_data: bool) -> Result<(), String> {
    let dir = installed().map(|(_, d)| d).unwrap_or_else(default_dir);
    let me = std::env::current_exe().ok();

    // Lista tudo o que vai sair: o progresso é o número de arquivos removidos de verdade.
    let mut shortcuts = Vec::new();
    if let Some(sm) = start_menu_dir() {
        files_in(&sm, &mut shortcuts);
    }
    if let Some(dl) = desktop_link().filter(|d| d.exists()) {
        shortcuts.push(dl);
    }
    let mut program = Vec::new();
    files_in(&dir, &mut program);
    program.retain(|p| Some(p) != me.as_ref()); // este desinstalador sai por último, depois de fechar
    let mut data = Vec::new();
    if remove_data {
        if let Some(local) = dirs::data_local_dir() {
            files_in(&local.join(APP_DATA_ID), &mut data);
        }
    }
    let mut m = Meter::new(app, (shortcuts.len() + program.len() + data.len()) as u64 + 2);

    m.add(0, 1, "Fechando o Hanko");
    close_app();
    m.add(1, 1, "Hanko fechado");

    for f in &shortcuts {
        let _ = fs::remove_file(f);
        m.add(1, 2, "Removendo atalhos");
    }
    if let Some(sm) = start_menu_dir() {
        let _ = fs::remove_dir_all(sm);
    }

    for f in &program {
        let _ = fs::remove_file(f);
        m.add(1, 3, "Removendo o programa");
    }
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);

    if remove_data {
        for f in &data {
            let _ = fs::remove_file(f);
            m.add(1, 4, "Apagando os dados deste computador");
        }
        if let Some(local) = dirs::data_local_dir() {
            let _ = fs::remove_dir_all(local.join(APP_DATA_ID));
        }
    }
    // A pasta (com este desinstalador dentro) é apagada logo depois que ele fechar.
    let _ = Command::new("cmd")
        .args(["/C", &format!("ping 127.0.0.1 -n 4 >nul & rmdir /S /Q \"{}\"", dir.display())])
        .creation_flags(NO_WINDOW)
        .spawn();
    m.add(1, 5, "Pronto");
    Ok(())
}

fn launch_app(dir: &Path) {
    let _ = Command::new(dir.join(APP_EXE)).current_dir(dir).spawn();
}

/* ---------- Comandos chamados pela interface ---------- */

#[tauri::command]
fn info(opts: State<Opts>) -> Info {
    let inst = installed();
    Info {
        mode: opts.mode,
        version: VERSION,
        default_dir: inst.as_ref().map(|(_, d)| d.clone()).unwrap_or_else(default_dir).display().to_string(),
        installed_version: inst.as_ref().map(|(v, _)| v.clone()),
        installed_dir: inst.map(|(_, d)| d.display().to_string()),
        size_mb: (payload_size() as f64 / 1_048_576.0 * 10.0).round() / 10.0,
    }
}

#[tauri::command]
async fn install(app: AppHandle, dir: String, desktop: bool, start_menu: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || do_install(Some(&app), Path::new(&dir), desktop, start_menu))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn uninstall(app: AppHandle, remove_data: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || do_uninstall(Some(&app), remove_data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch(dir: String) {
    launch_app(Path::new(&dir));
}

#[tauri::command]
fn should_restart(opts: State<Opts>) -> bool {
    opts.restart
}

#[tauri::command]
fn finish(app: AppHandle) {
    app.exit(0);
}

fn main() {
    let args: Vec<String> = std::env::args().map(|a| a.to_uppercase()).collect();
    let has = |f: &str| args.iter().any(|a| a == f);
    let is_uninstaller = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().eq_ignore_ascii_case("uninstall")))
        .unwrap_or(false);

    // Silencioso: sem janela nenhuma.
    if has("/S") {
        let dir = installed().map(|(_, d)| d).unwrap_or_else(default_dir);
        let desktop = desktop_link().map(|d| d.exists()).unwrap_or(false);
        if do_install(None, &dir, desktop, true).is_ok() && has("/R") {
            launch_app(&dir);
        }
        return;
    }

    let mode = if has("--UNINSTALL") || is_uninstaller {
        Mode::Uninstall
    } else if has("/P") || has("/UPDATE") {
        Mode::Update
    } else {
        Mode::Install
    };
    let restart = has("/R") || mode == Mode::Update;

    tauri::Builder::default()
        .manage(Opts { mode, restart })
        .invoke_handler(tauri::generate_handler![info, install, uninstall, launch, should_restart, finish])
        .setup(move |app| {
            let (w, h) = if mode == Mode::Update { (520.0, 360.0) } else { (860.0, 540.0) };
            let title = match mode {
                Mode::Uninstall => "Desinstalar o Hanko",
                Mode::Update => "Atualizando o Hanko",
                Mode::Install => "Instalar o Hanko",
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(w, h)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .build()?;
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o instalador");
}
