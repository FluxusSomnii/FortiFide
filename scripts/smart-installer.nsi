; Smart Forti Fide installer — wraps both GPU and CPU variants in one file,
; detects CUDA at install time, runs the appropriate inner installer silently.
;
; Detection strategy (three layers, in order):
;
;   1. Command-line override. Power users can force a variant:
;        setup.exe /GPU  → install GPU build regardless of detection
;        setup.exe /CPU  → install CPU build regardless of detection
;      No flag → auto-detect.
;
;   2. PowerShell LoadLibrary probe. We invoke Windows's own DLL loader
;      against cublas64_13.dll. If LoadLibrary succeeds, the DLL is
;      findable via the same search order our app will use at launch
;      (exe dir → System dirs → PATH → etc.). This is the gold-standard
;      check: matches reality exactly. Works regardless of where the
;      CUDA Toolkit is installed, as long as its bin folder is on PATH
;      (which the Toolkit installer does by default).
;
;   3. Filesystem fallback. If PowerShell is disabled or fails for any
;      reason, we check known install locations: $WINDIR\SysNative
;      (bypasses 32-bit WOW64 redirection to real System32), and
;      $PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.*\bin[\x64]\.
;
; The inner installers each carry their own kill hook, so file-lock bugs
; on reinstall are handled inside, not here.

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; State for CUDA detection + override — set early in the install section,
; read to decide which inner installer to unpack.
Var GpuDetected
Var CmdLineOverride

!define APP_NAME "Forti Fide"
!define APP_VERSION "0.1.0"
!define APP_ID "com.fluxussomnii.fortifide"

; Caller must pass -DINPUT_DIR="absolute\path\to\bundle\nsis"
!ifndef INPUT_DIR
  !error "INPUT_DIR must be defined. Pass -DINPUT_DIR=<path>"
!endif

!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "Forti Fide_0.1.0_x64-setup.exe"
!endif

Name "${APP_NAME} ${APP_VERSION}"
; Write alongside the two inner installers so everything the release needs
; lives in one folder.
OutFile "${INPUT_DIR}\${OUTPUT_FILE}"

; Match Tauri's default so the wrapper's size ceiling matches the inner
; installers it contains.
SetCompressor /SOLID lzma

; Install the extraction staging area under %TEMP% — we only need it during
; install, the real install goes where the inner installer decides.
InstallDir "$TEMP\FortiFideSmartSetup"
RequestExecutionLevel user
ShowInstDetails show
Unicode true

; ---- UI pages ---------------------------------------------------------------
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

; ---- Parse command-line override flags --------------------------------------
; Called before any pages. Sets $CmdLineOverride to "gpu", "cpu", or "".
Function .onInit
  StrCpy $CmdLineOverride ""
  ${GetParameters} $R0
  ${GetOptions} $R0 "/GPU" $R1
  ${If} ${Errors}
    ClearErrors
  ${Else}
    StrCpy $CmdLineOverride "gpu"
  ${EndIf}
  ${GetOptions} $R0 "/CPU" $R1
  ${If} ${Errors}
    ClearErrors
  ${Else}
    StrCpy $CmdLineOverride "cpu"
  ${EndIf}
FunctionEnd

; ---- Install ----------------------------------------------------------------
Section "Install"
  SetOutPath "$INSTDIR"
  SetOverwrite on

  StrCpy $GpuDetected "0"

  ; --- Layer 1: command-line override ---------------------------------------
  ${If} $CmdLineOverride == "gpu"
    DetailPrint "Command-line /GPU override — forcing GPU build."
    StrCpy $GpuDetected "1"
  ${ElseIf} $CmdLineOverride == "cpu"
    DetailPrint "Command-line /CPU override — forcing CPU build."
    StrCpy $GpuDetected "0"
  ${Else}
    ; --- Layer 2: PowerShell LoadLibrary probe ------------------------------
    ; One-liner: LoadLibrary("cublas64_13.dll"). If it returns non-zero,
    ; Windows can load it via its standard DLL search order — which is
    ; exactly what fortifide.exe does at launch. We write the result to a
    ; temp file instead of capturing stdout because PowerShell's noisy
    ; startup (warnings, etc.) can pollute nsExec's output on some hosts.
    DetailPrint "Probing CUDA 13 runtime via Windows DLL loader..."
    StrCpy $1 "$TEMP\fortifide_cuda_probe.txt"
    Delete "$1"
    ; NOTE on escaping: NSIS treats `$` as introducing a variable reference.
    ; PowerShell variables ($h, $r) must be written `$$h` / `$$r` here so
    ; NSIS emits a literal `$` into the argument string. $1 is a real NSIS
    ; variable (the temp-file path) and stays unescaped.
    nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Add-Type -MemberDefinition ''[System.Runtime.InteropServices.DllImport(\"kernel32\", SetLastError=true)] public static extern System.IntPtr LoadLibrary(string filename); [System.Runtime.InteropServices.DllImport(\"kernel32\")] public static extern bool FreeLibrary(System.IntPtr h);'' -Name N -Namespace W; $$h = [W.N]::LoadLibrary(\"cublas64_13.dll\"); $$r = if ($$h -ne [System.IntPtr]::Zero) { [W.N]::FreeLibrary($$h) | Out-Null; \"GPU\" } else { \"CPU\" }; [System.IO.File]::WriteAllText(\"$1\", $$r)'
    Pop $0  ; exit code

    ${If} ${FileExists} "$1"
      FileOpen $2 "$1" r
      FileRead $2 $3
      FileClose $2
      Delete "$1"
      ; Trim trailing CR/LF
      Push $3
      Call TrimNewlines
      Pop $3

      ${If} $3 == "GPU"
        StrCpy $GpuDetected "1"
        DetailPrint "LoadLibrary succeeded — CUDA runtime available."
      ${ElseIf} $3 == "CPU"
        DetailPrint "LoadLibrary failed — CUDA runtime not available."
      ${Else}
        DetailPrint "Probe returned unexpected result: '$3' — trying filesystem fallback."
        Call FilesystemFallbackProbe
      ${EndIf}
    ${Else}
      DetailPrint "PowerShell probe produced no output — trying filesystem fallback."
      Call FilesystemFallbackProbe
    ${EndIf}
  ${EndIf}

  ; --- Unpack the appropriate inner installer --------------------------------
  ${If} $GpuDetected == "1"
    DetailPrint "Installing GPU-accelerated build."
    File "/oname=inner.exe" "${INPUT_DIR}\Forti Fide_0.1.0_x64-gpu-setup.exe"
  ${Else}
    DetailPrint "Installing CPU build."
    File "/oname=inner.exe" "${INPUT_DIR}\Forti Fide_0.1.0_x64-cpu-setup.exe"
  ${EndIf}

  DetailPrint "Launching Forti Fide installer..."
  ; /S = silent. Inner installer handles its own kill hook, file writes,
  ; shortcuts, registry entries, etc. We just wait for it to complete.
  ExecWait '"$INSTDIR\inner.exe" /S' $0

  ${If} $0 = 0
    DetailPrint "Installation complete."
  ${Else}
    DetailPrint "Inner installer exited with code $0."
    MessageBox MB_OK|MB_ICONSTOP "Installation failed (inner installer exit code $0). Please try again or contact support."
    Abort "Inner installer failed."
  ${EndIf}

  ; Clean up the extraction staging area.
  Delete "$INSTDIR\inner.exe"
  RMDir "$INSTDIR"
SectionEnd

; ---- Filesystem fallback (used when PowerShell probe fails) -----------------
Function FilesystemFallbackProbe
  ${If} ${FileExists} "$WINDIR\SysNative\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found cublas64_13.dll in System32 (via SysNative)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin\x64\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.2 Toolkit (bin\x64)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.1\bin\x64\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.1 Toolkit (bin\x64)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\x64\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.0 Toolkit (bin\x64)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.2 Toolkit (bin)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.1\bin\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.1 Toolkit (bin)."
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\cublas64_13.dll"
    StrCpy $GpuDetected "1"
    DetailPrint "Fallback: found CUDA 13.0 Toolkit (bin)."
  ${Else}
    DetailPrint "Fallback: CUDA 13 runtime not found in known locations."
  ${EndIf}
FunctionEnd

; Trim leading/trailing CR/LF from a string on the NSIS stack.
Function TrimNewlines
  Exch $R0
  Push $R1
  StrCpy $R1 "0"
  loop:
    StrCpy $R1 $R0 1 -1
    ${If} $R1 == "$\r"
    ${OrIf} $R1 == "$\n"
      StrCpy $R0 $R0 -1
      Goto loop
    ${EndIf}
  Pop $R1
  Exch $R0
FunctionEnd
