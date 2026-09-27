@echo off
chcp 65001 >nul
title BiliNext Server
cd /d "%~dp0"

REM The server binds to this computer only unless asked otherwise, because a
REM logged-in instance can act on the account. start-bilinext-lan.cmd passes
REM "lan" to opt in; the phone app needs that mode.
if /i "%~1"=="lan" set "HOST=0.0.0.0"

echo.
echo   BiliNext  -  http://localhost:8787

if defined HOST (
  REM The Android app has to be told this machine's address on the Wi-Fi, and
  REM nobody knows it off-hand. Pick the adapter that actually has a default
  REM gateway: ipconfig alone also lists VPN, WSL and Hyper-V adapters, and
  REM typing one of those into the phone reaches nothing.
  REM .Where^(^) rather than a Where-Object pipeline, because every pipe inside
  REM a for /f has to be caret-escaped and one missed escape silently yields
  REM nothing at all.
  for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'})[0].IPv4Address.IPAddress"') do set "LANIP=%%a"
  echo   LAN mode - other devices on this Wi-Fi can reach this server.
) else (
  echo   For your phone, use start-bilinext-lan.cmd instead.
)
if defined LANIP echo   Enter this in the phone app:  http://%LANIP%:8787
echo   ------------------------------------------------

REM Double-clicking this twice is easy to do. If the port is already taken
REM there is nothing to start: show the app instead of letting node fail on
REM bind and dump a stack trace. netstat is used rather than an HTTP probe
REM because it needs no PowerShell and cannot be tripped up by a proxy.
netstat -ano | findstr /r /c:":8787 .*LISTENING" >nul
if not errorlevel 1 (
  echo   BiliNext is already running - opening the browser.
  echo   ^(The other window is the server; keep that one open.^)
  echo.
  start "" "http://localhost:8787"
  ping -n 5 127.0.0.1 >nul
  goto :eof
)

echo   Keep this window open while you use the app.
echo   Close it ^(or press Ctrl+C^) to stop the server.
echo.

REM First run after a fresh clone, or after node_modules was cleared.
if not exist "node_modules\" (
  echo   Installing dependencies, this happens only once...
  call npm install || goto :failed
)

REM The server serves web\dist in production; build it if missing.
if not exist "web\dist\index.html" (
  echo   Building the web app...
  call npm run build || goto :failed
)

REM Open the browser once the port is actually listening. The url must be
REM quoted -- unquoted it is parsed as a bare token and the request fails.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "for($i=0;$i -lt 40;$i++){try{Invoke-WebRequest -UseBasicParsing 'http://localhost:8787/api/health' -TimeoutSec 1|Out-Null;Start-Process 'http://localhost:8787';break}catch{Start-Sleep -Milliseconds 500}}"

REM Only warnings and errors; the per-request log is noise in a window
REM the user is meant to leave open.
set LOG_LEVEL=warn
node server\src\index.js

REM Reaching here means node exited. Hold the window so the reason stays
REM readable instead of the console vanishing.
echo.
echo   Server stopped.
pause
goto :eof

:failed
echo.
echo   Startup failed. Check the messages above.
pause
