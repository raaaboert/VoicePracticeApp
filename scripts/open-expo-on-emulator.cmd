@echo off
setlocal enabledelayedexpansion

rem Open the current Expo project on the Android emulator using the stable
rem Android-emulator host address (10.0.2.2).
rem
rem This avoids flaky LAN IP selection and avoids relying on `adb reverse`,
rem which can be unreliable depending on the environment.

set "ADB="

if not "%ANDROID_SDK_ROOT%"=="" if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
if not "%ANDROID_HOME%"=="" if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if "%ADB%"=="" if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if "%ADB%"=="" if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe" set "ADB=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe"
if "%ADB%"=="" set "ADB=adb"

rem If Expo Go is already running, it can get stuck on an old dev URL. Force-stop first.
"%ADB%" shell am force-stop host.exp.exponent >nul 2>&1

rem Open the Expo URL pointing to the host machine from the emulator.
"%ADB%" shell am start -a android.intent.action.VIEW -d "exp://10.0.2.2:8081" >nul 2>&1

echo Requested Expo Go to open exp://10.0.2.2:8081

