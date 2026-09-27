@echo off
chcp 65001 >nul
powershell -NoProfile -Command ^
  "$p=[Environment]::GetFolderPath('Startup')+'\BiliNext.lnk'; if(Test-Path $p){Remove-Item $p; 'Removed.'}else{'Was not installed.'}"
pause
