' Liga o servidor da Comanda sem abrir nenhuma janela.
' Se ele ja estiver ligado, nao faz nada (o servidor sai sozinho).
' Com o argumento /abrir, tambem abre o site no navegador.

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "node """ & root & "\server\server.js""", 0, False

If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/abrir" Then
    WScript.Sleep 1000
    sh.Run "http://localhost:3210", 1, False
  End If
End If
