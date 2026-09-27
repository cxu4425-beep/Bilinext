@echo off
chcp 65001 >nul
title BiliNext
cd /d "%~dp0"

REM The one launcher. It starts the server so that this computer, the phones on
REM your Wi-Fi and (if cloudflared is installed) the outside world can all
REM reach it, then prints the addresses and a QR code for the phone.
REM
REM Keep this window open while you use the app; closing it stops the server.

node scripts\launch.mjs
echo.
pause
