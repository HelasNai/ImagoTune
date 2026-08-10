@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo 正在安装依赖，请稍候...
  call npm.cmd install
  if errorlevel 1 (
    echo 依赖安装失败，请检查 Node.js 和网络连接。
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo 正在首次构建应用，请稍候...
  call npm.cmd run build
  if errorlevel 1 (
    echo 应用构建失败。
    pause
    exit /b 1
  )
)

start "AI Image Studio" /D "%CD%" "%CD%\node_modules\electron\dist\electron.exe" .
exit /b 0
