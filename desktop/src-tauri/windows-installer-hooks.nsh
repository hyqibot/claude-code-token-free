!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Claude Code token free sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running Claude Code token free processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM claude-code-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-gateway.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM zero-token-webauth-runner.exe'
  Pop $0
  Sleep 1000
!macroend
