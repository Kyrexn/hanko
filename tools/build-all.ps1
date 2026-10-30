# Gera os instaladores de Windows, Android e a extensão, e copia tudo para a pasta Instaladores.
# 'Continue': o Tauri escreve mensagens informativas no stderr; os erros reais são checados pelo $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot'
$env:ANDROID_HOME = 'C:\Users\Julio\Android\Sdk'
$env:NDK_HOME = 'C:\Users\Julio\Android\Sdk\ndk\27.2.12479018'
# Chave que assina as atualizações do Windows (fica fora do projeto).
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content 'C:\Users\Julio\.cofre\updater.key' -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content 'C:\Users\Julio\.cofre\updater.password' -Raw
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$ver = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$out = Join-Path $root 'Instaladores'
New-Item -ItemType Directory -Force $out | Out-Null

# A extensão vai primeiro: o app do Windows a leva embutida (e mantém a pasta dela atualizada).
"=== Extensão $ver ==="
node extension/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Falha no build da extensão' }

"=== Windows $ver ==="
npx tauri build --no-bundle *>&1 | ForEach-Object { "$_" } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Falha no build do Windows' }

"=== Hanko Setup $ver (instalador próprio) ==="
node installer/ui/build.mjs
Push-Location installer
cargo build --release --target-dir ..\src-tauri\target *>&1 | ForEach-Object { "$_" } | Select-Object -Last 2
$setupExit = $LASTEXITCODE
Pop-Location
if ($setupExit -ne 0) { throw 'Falha no build do instalador' }
$setup = "$out\Hanko-$ver-Setup.exe"
Copy-Item 'src-tauri\target\release\hanko-setup.exe' $setup -Force
# Assinatura que o atualizador automático confere antes de rodar o instalador.
npx tauri signer sign $setup *>&1 | Select-Object -Last 1
if (-not (Test-Path "$setup.sig")) { throw 'Falha ao assinar o instalador' }

"=== Android $ver ==="
npx tauri android build --apk --target aarch64 *>&1 | ForEach-Object { "$_" } | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw 'Falha no build do Android' }
Copy-Item 'src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk' "$out\Hanko-$ver-android.apk" -Force

$extDir = Join-Path $out 'Hanko-extensao-chrome'
if (Test-Path $extDir) { Remove-Item $extDir -Recurse -Force }
Copy-Item 'extension\dist' $extDir -Recurse
Compress-Archive -Path 'extension\dist\*' -DestinationPath "$out\Hanko-$ver-extensao-chrome.zip" -Force

Get-ChildItem $out -File | Where-Object Name -like "*$ver*" | ForEach-Object { "{0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB) }
