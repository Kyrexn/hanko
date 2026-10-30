// O app é uma janela nativa (WebView2 no Windows, WebView no Android) que roda a interface em React.
// Toda a criptografia acontece na interface, com a WebCrypto do sistema.
mod clipboard;
mod secure;
#[cfg(desktop)]
mod extension;
#[cfg(desktop)]
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // No computador: atualização silenciosa assinada (baixa em segundo plano, instala ao fechar).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(updates::Pending::default())
        .invoke_handler(tauri::generate_handler![
            clipboard::copy_secret,
            secure::set_screen_protect,
            secure::bio_available,
            secure::bio_protect,
            secure::bio_unlock,
            updates::update_prepare,
            updates::update_apply_now,
            extension::extension_status,
            extension::extension_install,
            extension::open_browser_extensions,
            extension::open_extension_folder
        ])
        // Mantém a pasta da extensão na versão deste app (se a pessoa já a instalou).
        .setup(|_| {
            std::thread::spawn(|| { let _ = extension::sync(false); });
            Ok(())
        });

    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        clipboard::copy_secret,
        secure::set_screen_protect,
        secure::bio_available,
        secure::bio_protect,
        secure::bio_unlock
    ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Hanko");

    app.run(|_handle, _event| {
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = _event {
            updates::apply_on_exit(_handle);
        }
    });
}
