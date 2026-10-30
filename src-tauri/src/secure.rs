// Proteções do sistema no computador:
// • esconder a janela de prints, gravações e compartilhamento de tela;
// • desbloqueio rápido com Windows Hello: a chave do cofre fica guardada pelo DPAPI do Windows
//   (só esta conta do Windows, neste computador, consegue abrir) e só é entregue depois que o
//   Windows Hello confirma a pessoa (rosto, digital ou PIN).

/// Liga ou desliga a proteção contra captura de tela da janela.
#[tauri::command]
pub fn set_screen_protect(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    // No Android quem faz isso é a MainActivity (FLAG_SECURE), chamada direto pela interface.
    #[cfg(desktop)]
    {
        window.set_content_protected(on).map_err(|e| e.to_string())
    }
    #[cfg(not(desktop))]
    {
        let _ = (window, on);
        Ok(())
    }
}

#[cfg(windows)]
mod win {
    use std::ptr::{null, null_mut};
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows_future::IAsyncOperation;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Entropia extra: um blob do Hanko não serve para outro programa que use DPAPI "puro".
    const ENTROPY: &[u8] = b"hanko-desbloqueio-rapido-v1";

    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    /// Pede o Windows Hello presa à janela do Hanko (aparece na frente dela).
    pub fn verify(hwnd: isize, message: &str) -> Result<(), String> {
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.to_string())?;
        let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
            interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut core::ffi::c_void), &HSTRING::from(message))
        }
        .map_err(|e| e.to_string())?;
        match op.join().map_err(|e| e.to_string())? {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::Canceled => Err("cancelado".into()),
            _ => Err("Windows Hello não confirmou".into()),
        }
    }

    unsafe fn run(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        let ok = if protect {
            CryptProtectData(&input, null(), &entropy, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, null_mut(), &entropy, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok == 0 || out.pbData.is_null() {
            return Err("o Windows não conseguiu abrir a chave guardada".into());
        }
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        Ok(bytes)
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe { run(data, true) }
    }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe { run(data, false) }
    }
}

#[cfg(windows)]
fn hwnd_of(window: &tauri::WebviewWindow) -> Result<isize, String> {
    window.hwnd().map(|h| h.0 as isize).map_err(|e| e.to_string())
}

/// O Windows Hello está configurado neste computador?
#[tauri::command]
pub async fn bio_available() -> bool {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::available).await.unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Liga o desbloqueio rápido: confirma com o Windows Hello e devolve a chave protegida pelo DPAPI.
#[tauri::command]
pub async fn bio_protect(window: tauri::WebviewWindow, data: Vec<u8>) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let hwnd = hwnd_of(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            win::verify(hwnd, "Confirme para ativar o desbloqueio rápido do Hanko")?;
            win::protect(&data)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, data);
        Err("indisponível".into())
    }
}

/// Desbloqueio: o Windows Hello confirma a pessoa e só então a chave do cofre é aberta.
#[tauri::command]
pub async fn bio_unlock(window: tauri::WebviewWindow, data: Vec<u8>) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let hwnd = hwnd_of(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            win::verify(hwnd, "Desbloquear o Hanko")?;
            win::unprotect(&data)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, data);
        Err("indisponível".into())
    }
}
