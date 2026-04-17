; NSIS hooks for Forti Fide installer. Injected by Tauri via
; `bundle.windows.nsis.installerHooks` in tauri.conf.json.
;
; Purpose: before any file in the install directory is written, terminate
; any already-running Forti Fide processes. Fixes the "Error opening file
; for writing: fortifide-sidecar.exe" dialog that appears when the app
; crashed previously and left its sidecar orphaned.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running Forti Fide processes..."
  ; /F forces termination; /T also kills child processes. Silently ignore
  ; "not found" errors — the taskkill exit code is non-zero when the
  ; process isn't running, which is fine.
  nsExec::Exec 'taskkill /F /T /IM fortifide.exe'
  nsExec::Exec 'taskkill /F /T /IM fortifide-sidecar.exe'
  ; Small pause so Windows releases the file handles before the file
  ; writes start. Without this, the subsequent File commands can still
  ; race the OS and hit a stale lock.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping any running Forti Fide processes..."
  nsExec::Exec 'taskkill /F /T /IM fortifide.exe'
  nsExec::Exec 'taskkill /F /T /IM fortifide-sidecar.exe'
  Sleep 500
!macroend
