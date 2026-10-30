// Cópia "secreta" no Windows: o texto vai para a área de transferência marcado para ficar FORA
// do histórico (Win+V) e da área de transferência na nuvem — senhas não ficam guardadas lá.
// Formatos documentados pela Microsoft: ExcludeClipboardContentFromMonitorProcessing,
// CanIncludeInClipboardHistory = 0 e CanUploadToCloudClipboard = 0.

#[cfg(windows)]
mod win {
    use std::ptr::{copy_nonoverlapping, null_mut};
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Copia `bytes` para um bloco global e entrega à área de transferência no formato `format`.
    unsafe fn put(format: u32, bytes: &[u8]) -> bool {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if h.is_null() {
            return false;
        }
        let p = GlobalLock(h) as *mut u8;
        if p.is_null() {
            GlobalFree(h);
            return false;
        }
        copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        GlobalUnlock(h);
        // Se der certo, o sistema passa a ser dono do bloco; se falhar, liberamos.
        if SetClipboardData(format, h).is_null() {
            GlobalFree(h);
            return false;
        }
        true
    }

    pub fn write(text: &str) -> Result<(), String> {
        unsafe {
            // Outro programa pode estar com a área de transferência aberta por um instante.
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(null_mut()) != 0 {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            if !opened {
                return Err("área de transferência ocupada".into());
            }
            EmptyClipboard();
            let text_bytes: Vec<u8> = wide(text).iter().flat_map(|c| c.to_le_bytes()).collect();
            let ok = put(CF_UNICODETEXT as u32, &text_bytes);
            if ok && !text.is_empty() {
                let zero = 0u32.to_le_bytes();
                let exclude = RegisterClipboardFormatW(wide("ExcludeClipboardContentFromMonitorProcessing").as_ptr());
                let history = RegisterClipboardFormatW(wide("CanIncludeInClipboardHistory").as_ptr());
                let cloud = RegisterClipboardFormatW(wide("CanUploadToCloudClipboard").as_ptr());
                if exclude != 0 { put(exclude, &zero); }
                if history != 0 { put(history, &zero); }
                if cloud != 0 { put(cloud, &zero); }
            }
            CloseClipboard();
            if ok { Ok(()) } else { Err("não consegui copiar".into()) }
        }
    }
}

/// Chamado pela interface ao copiar senha, código 2FA etc. Texto vazio limpa a área de transferência.
#[tauri::command]
pub fn copy_secret(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::write(&text)
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("indisponível".into())
    }
}
