# Prepara o PC para gerar o app Android do Cofre:
# Java 17, Android SDK (linha de comando, sem Android Studio), NDK e alvos Rust para Android.
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$common = @('--exact','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity')

"=== Java (Microsoft OpenJDK 17) ==="
winget install --id Microsoft.OpenJDK.17 @common
$jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $jdk) { throw 'JDK nao encontrado' }
$env:JAVA_HOME = $jdk.FullName
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk.FullName, 'User')
"JAVA_HOME=$($jdk.FullName)"

"=== Android command-line tools ==="
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$dl = Join-Path $env:TEMP 'cofre-android-dl'
New-Item -ItemType Directory -Force $dl | Out-Null
$zip = Join-Path $dl 'cmdline-tools.zip'
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' -OutFile $zip -UseBasicParsing
$ext = Join-Path $dl 'x'
if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
Expand-Archive $zip -DestinationPath $ext
$dest = Join-Path $sdk 'cmdline-tools\latest'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Move-Item (Join-Path $ext 'cmdline-tools') $dest
$env:ANDROID_HOME = $sdk
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
"ANDROID_HOME=$sdk"

"=== SDK, build-tools e NDK ==="
$sm = Join-Path $dest 'bin\sdkmanager.bat'
$yes = ('y' + "`n") * 40
$yes | & $sm --sdk_root=$sdk --licenses | Out-Null
& $sm --sdk_root=$sdk 'platform-tools' 'platforms;android-35' 'platforms;android-36' 'build-tools;35.0.0' 'ndk;27.2.12479018' | Out-Null
$ndk = Join-Path $sdk 'ndk\27.2.12479018'
if (-not (Test-Path $ndk)) { throw 'NDK nao instalado' }
[Environment]::SetEnvironmentVariable('NDK_HOME', $ndk, 'User')
"NDK_HOME=$ndk"

"=== Alvos Rust para Android ==="
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
"OK"
