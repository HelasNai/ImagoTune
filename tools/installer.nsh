# ImagoTune — electron-builder NSIS 自定义脚本
# 接入方式：package.json → build.nsis.include（安装器与卸载器两轮编译均生效）
#
# 三段刻意的非标准行为（改动前先同步根 AGENTS.md）：
# 1) 卸载欢迎页询问「是否删除用户数据」，默认不勾选 = 保留。
#    用户数据 = %APPDATA%\imagotune（设置、模板、队列、本地 AI 模型）。
# 2) 真卸载后保留安装根文件夹（删除内容后重建空目录），便于识别原路径。
# 3) 卸载前把安装路径记入 HKCU\Software\ImagoTune\LastInstallDir；
#    重装时若该目录仍存在，则回填 $INSTDIR 并把路径写回 InstallLocation 键——
#    安装模式页 leave 会重读 InstallLocation 并重置 $INSTDIR，不写回则回填被覆盖。
#
# 双语（zh_CN + en_US，配置见 package.json → build.nsis.installerLanguages）：
# - 自定义文案按运行时 $LANGUAGE 分支：en_US = 1033 走英文，其余（zh_CN = 2052）走中文。
# - addLangs 宏在 installer.nsi 中无条件插入，故 $LANGUAGE 在安装器与卸载器运行时均可用；
#   注意本文件现有可见文案全部位于卸载器宏内。
# - 字体保持 Microsoft YaHei UI（中英文均覆盖）。此处不用 LangString：electron-builder 已按
#   installerLanguages 生成内置 LangString，自定义串用 $LANGUAGE 分支更直观且两轮均零警告。
#
# 编译约束（勿破坏）：
# - 本文件在 MUI2 加载之前被 include，函数体必须放在宏内、
#   随 customUnWelcomePage 在页面区展开后再编译（否则 MUI_HEADER_TEXT 未定义）
# - 所有删除/回填逻辑均以 ${isUpdated} 排除升级（--updated）场景
# - 用户数据删除只针对当前用户漫游目录（$PROFILE 不受 shell context 影响）
# - 静默卸载（/S）不显示页面，变量保持空值 → 不会误删用户数据

!include nsDialogs.nsh

# 仅在卸载器编译轮（BUILD_UNINSTALLER）声明：安装器轮无引用会导致 NSIS 6001 警告，
# 而 electron-builder 将警告视为错误。默认空值；静默卸载不执行欢迎页，判断 "== 1" 不会误删。
!ifdef BUILD_UNINSTALLER
  Var /GLOBAL ImagoTuneDeleteUserData   # "1" = 用户在卸载欢迎页勾选了删除用户数据
  Var /GLOBAL ImagoTuneDeleteDataCheck  # 复选框控件句柄
!endif

# ----------------------------------------------------------------------
# 卸载欢迎页（替换默认 MUI_UNPAGE_WELCOME；宏在页面区展开，此时 MUI2 已就绪）
# ----------------------------------------------------------------------
!macro customUnWelcomePage
  Function un.ImagoTuneUnWelcomeCreate
    # $LANGUAGE: en_US = 1033 → 英文；其余（zh_CN = 2052）→ 中文
    ${If} $LANGUAGE == 1033
      !insertmacro MUI_HEADER_TEXT "Uninstall ImagoTune" "Choose uninstall options"
    ${Else}
      !insertmacro MUI_HEADER_TEXT "卸载 ImagoTune" "选择卸载选项"
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${If} $LANGUAGE == 1033
      ${NSD_CreateLabel} 0 0 100% 12u "This wizard will remove ImagoTune from your computer."
    ${Else}
      ${NSD_CreateLabel} 0 0 100% 12u "此向导将从您的计算机上移除 ImagoTune。"
    ${EndIf}
    Pop $0
    ${If} $LANGUAGE == 1033
      ${NSD_CreateLabel} 0 13u 100% 12u "Click Uninstall to continue; click Cancel to exit."
    ${Else}
      ${NSD_CreateLabel} 0 13u 100% 12u "点击“卸载”继续；点击“取消”退出。"
    ${EndIf}
    Pop $0

    # 复选框置于页面底部（约 143u 页面高度），并缩小字号（默认 9pt → 8pt）
    ${If} $LANGUAGE == 1033
      ${NSD_CreateCheckbox} 0 118u 100% 16u "Also delete user data (settings, templates, queue, local AI models)"
    ${Else}
      ${NSD_CreateCheckbox} 0 118u 100% 16u "同时删除用户数据（设置、模板、队列、本地 AI 模型）"
    ${EndIf}
    Pop $ImagoTuneDeleteDataCheck
    CreateFont $0 "Microsoft YaHei UI" 8
    SendMessage $ImagoTuneDeleteDataCheck ${WM_SETFONT} $0 1

    nsDialogs::Show
  FunctionEnd

  Function un.ImagoTuneUnWelcomeLeave
    ${NSD_GetState} $ImagoTuneDeleteDataCheck $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $ImagoTuneDeleteUserData "1"
    ${Else}
      StrCpy $ImagoTuneDeleteUserData "0"
    ${EndIf}
  FunctionEnd

  UninstPage custom un.ImagoTuneUnWelcomeCreate un.ImagoTuneUnWelcomeLeave
!macroend

# ----------------------------------------------------------------------
# 卸载段（在内置文件删除逻辑之前执行）
# ----------------------------------------------------------------------
!macro customUnInstall
  # (3) 记录安装路径供重装回填；标准 InstallLocation 键会被内置逻辑清除，故另存
  WriteRegStr HKCU "Software\ImagoTune" "LastInstallDir" "$INSTDIR"

  # (1) 真卸载且用户勾选时删除用户数据；升级（--updated）绝不触发
  ${IfNot} ${isUpdated}
  ${AndIf} $ImagoTuneDeleteUserData == "1"
    ${If} $LANGUAGE == 1033
      DetailPrint "Deleting user data..."
    ${Else}
      DetailPrint "正在删除用户数据…"
    ${EndIf}
    RMDir /r "$PROFILE\AppData\Roaming\imagotune"
    RMDir /r "$PROFILE\AppData\Roaming\ImagoTune"
  ${EndIf}
!macroend

# ----------------------------------------------------------------------
# 文件删除（替换内置的 RMDir /r $INSTDIR）
# ----------------------------------------------------------------------
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r "$INSTDIR"
  ${IfNot} ${isUpdated}
    # (2) 真卸载后保留空文件夹，便于识别原路径
    CreateDirectory "$INSTDIR"
  ${EndIf}
!macroend

# ----------------------------------------------------------------------
# 安装初始化（在建模式/目录初始化之后、页面显示之前执行）
# ----------------------------------------------------------------------
!macro customInit
  # (3) 回填上次卸载记录的路径（目录仍存在时），并写回 InstallLocation——
  # 安装模式页 leave 会再次执行 setInstallModePerUser/AllUsers，从该键重读并重置
  # $INSTDIR；只写回"无活动安装"的一侧（HKLM 无权限时静默失败，提权重入后重试）。
  ReadRegStr $2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $3 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation

  ReadRegStr $0 HKCU "Software\ImagoTune" "LastInstallDir"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\*.*"
    ${If} $2 == ""
    ${AndIf} $3 == ""
      StrCpy $INSTDIR $0
    ${EndIf}
    ${If} $2 == ""
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
    ${EndIf}
    ${If} $3 == ""
      WriteRegStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
    ${EndIf}
  ${EndIf}
!macroend
