package com.julio.hanko

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // A interface (React) fala com o Android por este objeto: window.HankoAndroid.
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(HankoBridge(this, webView), "HankoAndroid")
  }
}

/**
 * Ponte nativa do Hanko no Android:
 * • bloquear prints e gravação de tela (FLAG_SECURE);
 * • desbloqueio com digital/rosto: a chave do cofre é cifrada por uma chave do Android Keystore
 *   que só funciona depois da biometria (e é apagada se uma digital nova for cadastrada).
 */
class HankoBridge(private val activity: MainActivity, private val webView: WebView) {
  private val alias = "hanko_desbloqueio_rapido"
  private val UPDATES = "https://kldvivevydcbjhveqibf.supabase.co/storage/v1/object/public/updates/android/"

  @JavascriptInterface
  fun setSecure(on: Boolean) {
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

  /**
   * Atualização de 1 toque: baixa o APK novo (só do endereço oficial de updates) e abre o instalador do Android.
   * O próprio Android recusa um APK que não tenha a mesma assinatura do Hanko instalado.
   */
  @JavascriptInterface
  fun installUpdate(reqId: String, url: String) {
    if (!url.startsWith(UPDATES)) return reply(reqId, false, "endereço não autorizado")
    if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
      activity.runOnUiThread {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
      }
      return reply(reqId, false, "permita instalar apps do Hanko e toque em Atualizar de novo")
    }
    Thread {
      try {
        val dir = File(activity.cacheDir, "atualizacao").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, "Hanko.apk")
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        val total = conn.contentLengthLong
        var done = 0L
        var last = -1
        conn.inputStream.use { input ->
          apk.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              done += n
              val pct = if (total > 0) (done * 100 / total).toInt() else -1
              if (pct != last) { last = pct; progress(pct) }
            }
          }
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", apk)
        activity.runOnUiThread {
          activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          })
        }
        reply(reqId, true, "ok")
      } catch (e: Exception) {
        reply(reqId, false, e.message ?: "falha no download")
      }
    }.start()
  }

  private fun progress(pct: Int) {
    webView.post { webView.evaluateJavascript("window.__hankoProgress && window.__hankoProgress($pct)", null) }
  }

  @JavascriptInterface
  fun bioAvailable(): Boolean =
    BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

  @JavascriptInterface
  fun bioReset() {
    try { keyStore().deleteEntry(alias) } catch (_: Exception) { }
  }

  /** Cifra `dataB64` com a chave protegida por biometria. Resposta: "ivB64:ctB64". */
  @JavascriptInterface
  fun bioEncrypt(reqId: String, dataB64: String) {
    activity.runOnUiThread {
      try {
        bioReset()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, newKey())
        prompt(reqId, "Ativar desbloqueio rápido", cipher) { c ->
          val ct = c.doFinal(Base64.decode(dataB64, Base64.NO_WRAP))
          b64(c.iv) + ":" + b64(ct)
        }
      } catch (e: Exception) {
        reply(reqId, false, e.message ?: "erro")
      }
    }
  }

  /** Abre o que `bioEncrypt` guardou, depois da digital/rosto. */
  @JavascriptInterface
  fun bioDecrypt(reqId: String, payload: String) {
    activity.runOnUiThread {
      try {
        val parts = payload.split(":")
        val key = keyStore().getKey(alias, null) as? SecretKey ?: return@runOnUiThread reply(reqId, false, "invalida")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        prompt(reqId, "Desbloquear o Hanko", cipher) { c -> b64(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))) }
      } catch (e: KeyPermanentlyInvalidatedException) {
        bioReset()
        reply(reqId, false, "invalida")
      } catch (e: Exception) {
        reply(reqId, false, e.message ?: "erro")
      }
    }
  }

  private fun prompt(reqId: String, title: String, cipher: Cipher, done: (Cipher) -> String) {
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .setSubtitle("Hanko · 判子")
      .setNegativeButtonText("Usar senha mestra")
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .build()
    val bp = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        try { reply(reqId, true, done(result.cryptoObject!!.cipher!!)) } catch (e: Exception) { reply(reqId, false, e.message ?: "erro") }
      }
      override fun onAuthenticationError(code: Int, msg: CharSequence) {
        reply(reqId, false, if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_USER_CANCELED) "cancelado" else msg.toString())
      }
    })
    bp.authenticate(info, BiometricPrompt.CryptoObject(cipher))
  }

  private fun newKey(): SecretKey {
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        .setInvalidatedByBiometricEnrollment(true)
        .build()
    )
    return gen.generateKey()
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)

  private fun reply(reqId: String, ok: Boolean, value: String) {
    webView.post {
      webView.evaluateJavascript("window.__hankoBio && window.__hankoBio(${JSONObject.quote(reqId)}, $ok, ${JSONObject.quote(value)})", null)
    }
  }
}
