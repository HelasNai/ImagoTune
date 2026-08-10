Option Explicit

Dim shell, fso, appDir, launcher
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = Chr(34) & appDir & "\launch-image-studio.bat" & Chr(34)
shell.CurrentDirectory = appDir
shell.Run launcher, 0, False
