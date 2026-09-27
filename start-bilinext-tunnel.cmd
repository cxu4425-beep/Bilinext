@echo off
chcp 65001 >nul
title BiliNext Server (public tunnel)
cd /d "%~dp0"

REM Runs the server behind a Cloudflare quick tunnel, which gives it an https
REM address reachable from anywhere. Two things make that safe enough to do:
REM the server listens on 127.0.0.1 only (the tunnel is the sole way in), and
REM an access key is required on every API call.

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo.
  echo   cloudflared is not installed. Install it once with:
  echo.
  echo       winget install --id Cloudflare.cloudflared -e
  echo.
  echo   Then open a NEW terminal and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "data\" mkdir "data"
REM One key per machine, kept out of git with the rest of data\.
if not exist "data\access-key" (
  for /f %%k in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')"') do (
    >"data\access-key" echo %%k
  )
)
set /p ACCESS_KEY=<"data\access-key"

set "BILI_ACCESS_KEY=%ACCESS_KEY%"
REM Lets the GitHub Pages copy of the front end call this server.
set "BILI_ALLOWED_ORIGINS=https://cxu4425-beep.github.io"
REM Loopback only: everything from outside must come through the tunnel.
set "HOST=127.0.0.1"
set LOG_LEVEL=warn

echo.
echo   BiliNext  -  public tunnel mode
echo   ------------------------------------------------
echo   Access key:  %ACCESS_KEY%
echo.
echo   A second window is opening with the tunnel. It prints a line like
echo       https://something-random.trycloudflare.com
echo   That address plus the key above is what you enter in the app.
echo.
echo   The address changes every time you start this. Keep both windows open.
echo   ------------------------------------------------
echo.

start "BiliNext tunnel" cloudflared tunnel --url http://localhost:8787

if not exist "web\dist\index.html" (
  echo   Building the web app...
  call npm run build || goto :failed
)

node server\src\index.js

echo.
echo   Server stopped. Close the tunnel window too.
pause
goto :eof

:failed
echo.
echo   Startup failed. Check the messages above.
pause
