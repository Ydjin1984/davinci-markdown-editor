; File-association polish for the NSIS installer.
;
; Tauri registers one ProgID per file association, but it points every
; DefaultIcon at the application executable and leaves the shell command
; unquoted. This hook fixes both, and also registers the application in
; "Open with" / "Default apps" so the user can pick it deliberately.
;
; The ProgIDs are the `name` values from `bundle.fileAssociations`; keep the two
; files in sync. Uninstalling removes the ProgIDs (Tauri) and the extra
; registration added here (PREUNINSTALL below).

!define DAVINCI_CAPABILITIES "Software\DaVinci Cyber Engineering\DaVinci Markdown Editor\Capabilities"
!define DAVINCI_STATE "Software\DaVinci Cyber Engineering\DaVinci Markdown Editor\AssociationState"

; Extension → ProgID pairs, kept in one place so the snapshot, the backup fix-up,
; the icon override and the uninstall all agree.
!macro DAVINCI_FOR_EACH_ASSOCIATION MACRO
  !insertmacro ${MACRO} ".md" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".markdown" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mdown" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mkdn" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mkd" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mdx" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mdtxt" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".mdtext" "DaVinci.Markdown.Document"
  !insertmacro ${MACRO} ".json" "DaVinci.Json.Document"
  !insertmacro ${MACRO} ".geojson" "DaVinci.Json.Document"
  !insertmacro ${MACRO} ".webmanifest" "DaVinci.Json.Document"
  !insertmacro ${MACRO} ".csv" "DaVinci.Csv.Document"
  !insertmacro ${MACRO} ".tsv" "DaVinci.Csv.Document"
  !insertmacro ${MACRO} ".log" "DaVinci.Log.Document"
  !insertmacro ${MACRO} ".ndjson" "DaVinci.Log.Document"
  !insertmacro ${MACRO} ".xml" "DaVinci.Xml.Document"
  !insertmacro ${MACRO} ".xsd" "DaVinci.Xml.Document"
  !insertmacro ${MACRO} ".xsl" "DaVinci.Xml.Document"
  !insertmacro ${MACRO} ".xslt" "DaVinci.Xml.Document"
  !insertmacro ${MACRO} ".rss" "DaVinci.Xml.Document"
  !insertmacro ${MACRO} ".atom" "DaVinci.Xml.Document"
!macroend

; Record the association that exists before the very first install. Tauri's own
; APP_ASSOCIATE backs the default up, but on an upgrade it backs up *our*
; previous ProgID, so the original would be lost; rewriting the backup from this
; snapshot keeps uninstall able to restore what the user had.
!macro DAVINCI_SNAPSHOT EXT _PROGID
  ReadRegStr $R8 SHCTX "Software\Classes\${EXT}" ""
  WriteRegStr SHCTX "${DAVINCI_STATE}" "assoc${EXT}" "$R8"
!macroend

!macro DAVINCI_FIX_BACKUP EXT PROGID
  ReadRegStr $R8 SHCTX "${DAVINCI_STATE}" "assoc${EXT}"
  WriteRegStr SHCTX "Software\Classes\${EXT}" "${PROGID}_backup" "$R8"
!macroend

!macro DAVINCI_ICON_PROGID PROGID ICON
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" "$\"$INSTDIR\icons\filetypes\${ICON}$\",0"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro DAVINCI_OPEN_WITH EXT PROGID
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}" ""
!macroend

!macro DAVINCI_CAPABILITY EXT PROGID
  WriteRegStr SHCTX "${DAVINCI_CAPABILITIES}\FileAssociations" "${EXT}" "${PROGID}"
!macroend

!macro DAVINCI_CLEAN_OPEN_WITH EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Snapshot only once: a reinstall must not replace the original associations
  ; with the ones this application installed earlier.
  ReadRegStr $R9 SHCTX "${DAVINCI_STATE}" "snapshot"
  StrCmp $R9 "" 0 davinci_snapshot_done
    !insertmacro DAVINCI_FOR_EACH_ASSOCIATION DAVINCI_SNAPSHOT
    WriteRegStr SHCTX "${DAVINCI_STATE}" "snapshot" "1"
  davinci_snapshot_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Per-format icons and a properly quoted command line for every ProgID.
  !insertmacro DAVINCI_ICON_PROGID "DaVinci.Markdown.Document" "davinci-md.ico"
  !insertmacro DAVINCI_ICON_PROGID "DaVinci.Json.Document" "davinci-json.ico"
  !insertmacro DAVINCI_ICON_PROGID "DaVinci.Csv.Document" "davinci-csv.ico"
  !insertmacro DAVINCI_ICON_PROGID "DaVinci.Log.Document" "davinci-log.ico"
  !insertmacro DAVINCI_ICON_PROGID "DaVinci.Xml.Document" "davinci-xml.ico"

  ; Restore the original default into Tauri's backup slot, so uninstalling
  ; returns the user's previous handler even after several upgrades.
  !insertmacro DAVINCI_FOR_EACH_ASSOCIATION DAVINCI_FIX_BACKUP

  ; Let Explorer offer the application in "Open with" for every claimed type
  ; and let "Default apps" list it with its capabilities.
  !insertmacro DAVINCI_FOR_EACH_ASSOCIATION DAVINCI_OPEN_WITH
  !insertmacro DAVINCI_FOR_EACH_ASSOCIATION DAVINCI_CAPABILITY

  ; "Default apps" needs an application entry with capabilities.
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\SupportedTypes" ".json" ""
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\SupportedTypes" ".csv" ""
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\SupportedTypes" ".log" ""
  WriteRegStr SHCTX "Software\Classes\Applications\davinci-markdown.exe\SupportedTypes" ".xml" ""

  WriteRegStr SHCTX "${DAVINCI_CAPABILITIES}" "ApplicationName" "DaVinci Markdown Editor"
  WriteRegStr SHCTX "${DAVINCI_CAPABILITIES}" "ApplicationDescription" "Markdown, JSON, CSV, LOG and XML editor"
  WriteRegStr SHCTX "${DAVINCI_CAPABILITIES}" "ApplicationIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"

  WriteRegStr SHCTX "Software\RegisteredApplications" "DaVinci Markdown Editor" "${DAVINCI_CAPABILITIES}"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri removes the ProgIDs and restores the extension defaults from the
  ; backup; remove what this hook added so no dangling references stay behind.
  ; Other applications' OpenWithProgids values are left alone.
  DeleteRegValue SHCTX "Software\RegisteredApplications" "DaVinci Markdown Editor"
  DeleteRegKey SHCTX "${DAVINCI_CAPABILITIES}\FileAssociations"
  DeleteRegKey SHCTX "${DAVINCI_CAPABILITIES}"
  DeleteRegKey /ifempty SHCTX "Software\DaVinci Cyber Engineering\DaVinci Markdown Editor"
  DeleteRegKey /ifempty SHCTX "Software\DaVinci Cyber Engineering"
  DeleteRegKey SHCTX "Software\Classes\Applications\davinci-markdown.exe"

  !insertmacro DAVINCI_FOR_EACH_ASSOCIATION DAVINCI_CLEAN_OPEN_WITH
!macroend
