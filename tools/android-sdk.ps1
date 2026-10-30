# Aceita (interativamente) as licenças do Android SDK e instala SDK, build-tools e NDK.
# Responda "y" para cada licença do Google.
$env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$sm = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'

& $sm "--sdk_root=$sdk" --licenses
& $sm "--sdk_root=$sdk" 'platform-tools' 'platforms;android-35' 'platforms;android-36' 'build-tools;35.0.0' 'ndk;27.2.12479018'

$ndk = Join-Path $sdk 'ndk\27.2.12479018'
if (Test-Path $ndk) {
  [Environment]::SetEnvironmentVariable('NDK_HOME', $ndk, 'User')
  Write-Host ''
  Write-Host 'PRONTO: SDK e NDK instalados. Pode voltar para o Claude.' -ForegroundColor Green
} else {
  Write-Host 'O NDK nao foi instalado. Veja as mensagens acima.' -ForegroundColor Red
}
