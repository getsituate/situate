!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode == 1
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    StrCpy $4 0

    ; The updater has committed shutdown, but its old process may still be exiting.
    ${Do}
      !insertmacro RestartManager_StartSession $3
      ${If} $3 == ""
        Abort
      ${EndIf}
      !insertmacro RestartManager_RegisterFile $3 "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $0 == 0
        System::Call 'RSTRTMGR::RmGetList(i r3, *i .r1, *i 0.r2, p 0, *i .r5) i .r0'
      ${EndIf}
      StrCpy $2 $0
      !insertmacro RestartManager_EndSession $3
      ${If} $2 == 0
        ${ExitDo}
      ${EndIf}
      ${If} $2 != ${ERROR_MORE_DATA}
        Abort
      ${EndIf}
      ${If} $4 >= 100
        nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${PRODUCTNAME}"
        Pop $0
        Abort $0
      ${EndIf}
      Sleep 200
      IntOp $4 $4 + 1
    ${Loop}

    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
