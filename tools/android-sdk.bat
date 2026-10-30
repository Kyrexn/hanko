@echo off
rem Aceita as licencas do Android SDK (responda "y" a cada uma) e instala SDK, build-tools e NDK.
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot"
set "SDK=C:\Users\Julio\Android\Sdk"
set "SM=%SDK%\cmdline-tools\latest\bin\sdkmanager.bat"

call "%SM%" --sdk_root="%SDK%" --licenses
call "%SM%" --sdk_root="%SDK%" platform-tools "platforms;android-35" "platforms;android-36" "build-tools;35.0.0" "ndk;27.2.12479018"

setx JAVA_HOME "%JAVA_HOME%" >nul
setx ANDROID_HOME "%SDK%" >nul
if exist "%SDK%\ndk\27.2.12479018" (
  setx NDK_HOME "%SDK%\ndk\27.2.12479018" >nul
  echo.
  echo PRONTO: SDK e NDK instalados. Pode voltar para o Claude.
) else (
  echo O NDK nao foi instalado. Veja as mensagens acima.
)
