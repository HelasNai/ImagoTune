@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo Building the app for the first run...
  call npm.cmd run build
  if errorlevel 1 (
    echo App build failed.
    pause
    exit /b 1
  )
)

start "AI Image Studio" /D "%CD%" "%CD%\node_modules\electron\dist\electron.exe" .
exit /b 0
