; Remove the "open BMS POS at login" entry when the app is uninstalled, so Windows does not keep a
; startup item pointing at a deleted program. Skipped during updates: electron-builder runs the old
; uninstaller before installing the new version, and the operator's choice must survive that.
; The value name must match WINDOWS_LOGIN_ITEM_NAME in src/launch-at-login.mjs.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.bms.pos.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.bms.pos.desktop"
  ${endIf}
!macroend
