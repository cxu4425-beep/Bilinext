' Launches the BiliNext server with no console window.
' Used by the optional auto-start shortcut; run start.cmd instead if you want
' to see the log output.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run "cmd /c node server\src\index.js", 0, False
