' ROC OT Scheduling Tool - Silent Launcher
' Starts the server fully hidden and opens the browser.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strAppDir = fso.GetParentFolderName(WScript.ScriptFullName)
strServerDir = strAppDir & "\server"

' Find Node.js directory
strNodeDir = ""
strLocalNode = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs"
If fso.FileExists(strLocalNode & "\node.exe") Then
    strNodeDir = strLocalNode
ElseIf fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    strNodeDir = "C:\Program Files\nodejs"
End If

' Build command
If strNodeDir <> "" Then
    strCmd = "cmd /c ""set ""PATH=" & strNodeDir & ";%PATH%"" && cd /d """ & strServerDir & """ && """ & strNodeDir & "\npx.cmd"" tsx src/index.ts"""
Else
    strCmd = "cmd /c ""cd /d """ & strServerDir & """ && npx tsx src/index.ts"""
End If

' Run completely hidden (0 = no window)
WshShell.Run strCmd, 0, False

' Wait for server to start, then open browser
WScript.Sleep 3000
WshShell.Run "http://localhost:3000", 1, False
