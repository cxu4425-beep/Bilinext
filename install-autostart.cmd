@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Adds a shortcut to your personal Startup folder so the server comes back
REM after a reboot. Affects this Windows account only, and is undone by
REM uninstall-autostart-bilinext.cmd. Nothing else on the system is modified.

powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell); $lnk=$s.CreateShortcut([Environment]::GetFolderPath('Startup')+'\BiliNext.lnk'); $lnk.TargetPath='wscript.exe'; $lnk.Arguments='\"%~dp0start-hidden.vbs\"'; $lnk.WorkingDirectory='%~dp0'; $lnk.Description='BiliNext server'; $lnk.Save()"

if errorlevel 1 (
  echo   Failed to create the startup shortcut.
) else (
  echo   Done. BiliNext will start automatically when you log in.
  echo   Remove it any time with uninstall-autostart-bilinext.cmd
)
pause
