Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strAppDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Set oShortcut = WshShell.CreateShortcut(strDesktop & "\ROC OT Scheduling Tool.lnk")
oShortcut.TargetPath = "wscript.exe"
oShortcut.Arguments = Chr(34) & strAppDir & "\launch.vbs" & Chr(34)
oShortcut.WorkingDirectory = strAppDir
oShortcut.Description = "Launch ROC OT Scheduling Tool"
oShortcut.WindowStyle = 1
oShortcut.Save

WScript.Echo "Desktop shortcut created!"
