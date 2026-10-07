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

# ======================================================================
# 旧版接管（old installation takeover）—— 仅安装器轮编译
# ======================================================================
# 背景：electron-builder 用 UUID v5(appId, 固定命名空间) 生成 NSIS 安装标识 GUID。
#   namespace = 50e065bc-3134-11e6-9bab-38c9862bdaf3（electron-builder 常量，v25/v26 一致；
#   源码 app-builder-lib/out/targets/nsis/NsisTarget.js 的 ELECTRON_BUILDER_NS_UUID）
#     const {UUID}=require('builder-util-runtime')
#     const NS=UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')
#     UUID.v5('com.zztnbnb.pinaic.imagestudio', NS)  // → 旧 GUID
#     UUID.v5('io.github.helasnai.imagotune', NS)    // → 新 GUID
#   旧身份 appId = com.zztnbnb.pinaic.imagestudio（v1.0.0–v1.5.1 全部历史版本）
#     → 旧 GUID e6c1b9db-0d8d-55aa-8759-84add0da79b0
#   新身份 appId = io.github.helasnai.imagotune
#     → 新 GUID ab929792-f511-5e58-8d66-8a6c7f0c6403
#   安装标识键固定为 Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>
#   （HKCU = 按用户安装；HKLM = 按机器安装；本进程此刻已由 check64BitAndSetRegView 设为 64 位视图）。
#
# 挂钩点与理由：customInit（安装器 .onInit 内、initMultiUser 之后、任何页面之前）。
#   - 此时 $LANGUAGE 已由 MUI_LANGDLL_DISPLAY（若启用）确定，注册表视图已正确；
#   - 早于目录页与安装段执行，确保“先清除旧身份，再安装新身份”，不会产生并存；
#   - 与既有“目录回填”逻辑同处一个宏，但接管代码置于其前，且互不共享寄存器。
#
# 算法：
#   1) 读旧 GUID 的 UninstallString（先 HKCU，再 HKLM）——非空即视为存在旧安装；
#   2) 读 `Software\<旧 GUID>`（INSTALL_REGISTRY_KEY）的 InstallLocation 作为旧目录；
#      为其空时从 UninstallString 提取卸载器路径并回退取其父目录（真实 v1.5.1 的 Uninstall 键
#      不含 InstallLocation，此兜底与"读对键"共同保证目录可得）；
#   3) 把旧卸载器复制到 $PLUGINSDIR 后运行（其安装目录随后会被删除，卸载器需要在目录外生存——
#      与 electron-builder installUtil.nsh 的 uninstallOldVersion 同一范式），复制/启动失败回退原地：
#      ExecWait '"<卸载器>" /S /KEEP_APP_DATA --updated _?=<旧目录>'。
#      旧 UninstallString 已内嵌引号路径与 /currentuser|/allusers，故只追加静默/标志/工作目录；
#      /KEEP_APP_DATA 与 --updated 双保险：即便旧版本定义了 DELETE_APP_DATA_ON_UNINSTALL，用户数据也不删。
#
# 边界处理（任一失败都只 DetailPrint 后继续，绝不阻断安装）：
#   - 旧程序仍在运行：交由旧卸载器自身处理——其静默 onInit 会调用 checkAppRunning 关闭进程，
#     最长数秒即有结果；若无法关闭，/SD IDCANCEL 默认取消并退出，ExecWait 立即返回非 0，不会无限挂起。
#   - 旧版为按机器(HKLM)安装而当前未提权：跳过（避免 /S 静默下弹 UAC 卡死）；交互式按机器安装会在
#     抬升后的内层实例重跑 customInit 完成接管（UAC 内层实例 = UAC_IsAdmin）。
#   - 旧 InstallLocation 为空：先由卸载器路径取父目录兜底；仍无法确定才跳过卸载并 DetailPrint。
#   - temp 副本复制失败或无法启动：回退原地运行（TryInPlace）；再失败则 DetailPrint 后继续。
#   - 卸载器缺失/执行失败/返回非 0：DetailPrint 后继续；旧键仍在，下次安装会重试。
#   - 无旧安装（含新身份自更新 --updated）：不读/不写/不执行（安全 no-op）。
#
# 目录策略：不将旧 InstallLocation 回填进 LastInstallDir —— 旧卸载器删除旧目录后，新装沿用自身
#   默认目录，避免与“保留空目录 / LastInstallDir 回填”这两条既有非标准行为耦合（旧卸载器并不会写
#   HKCU\Software\ImagoTune\LastInstallDir，故既有回填路径本就不会自行触发）。
#
# 手动验证清单（v1.5.1 → 新构建升级演练）：
#   1) 安装 v1.5.1（记下安装目录；进入应用导入/生成点数据，确认 %APPDATA% 下数据存在）。
#   2) 图形界面运行新构建安装包，一路默认 → 期望 DetailPrint 出现接管日志；“应用和功能”只剩一条
#      ImagoTune（无 “AI Image Studio”），桌面/开始菜单无旧快捷方式。
#   3) 注册表：HKCU/HKLM ...\Uninstall\e6c1b9db-... 消失；...\Uninstall\ab929792-... 存在。
#   4) %APPDATA%\AI Image Studio（及 ai-image-studio）用户数据仍在，未被删除。
#   5) 旧安装目录内不残留卸载器临时文件（temp 副本在 $PLUGINSDIR，随安装器退出清理）。
#   6) 静默路径：装 v1.5.1 后以 /S 运行新构建（或模拟自动更新）→ 同样单条且数据在。
#   7) 对照：未装旧版时运行新构建 → 无接管日志，行为与改动前完全一致。
# ======================================================================
!define IMAGOTUNE_OLD_APP_GUID "e6c1b9db-0d8d-55aa-8759-84add0da79b0"
!define IMAGOTUNE_OLD_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${IMAGOTUNE_OLD_APP_GUID}"
# 安装信息键（electron-builder 的 INSTALL_REGISTRY_KEY）：InstallLocation 存放在这里——
# Uninstall 键不含安装目录（真实 v1.5.1 实测确认）；读错键时靠"卸载器路径父目录"兜底仍可工作。
!define IMAGOTUNE_OLD_INSTALL_KEY "Software\${IMAGOTUNE_OLD_APP_GUID}"

# 入参约定：$R1 = 旧 UninstallString，$R2 = 旧 InstallLocation（_?= 目标目录）。
# 本宏仅在安装器轮于 customInit 内展开（customInit 只由 !ifndef BUILD_UNINSTALLER 的 installer.nsi 插入），
# 卸载器轮不会展开，故不会产生任何未用变量/函数警告。
# 注意：本宏会被插入两次（HKCU / HKLM 分支），循环一律使用 LogicLib（${Do}/${Loop}/${Break}，
# 内部标签自动唯一化）；禁止使用自定义 Goto 标签，否则重复定义编译失败。
!macro ImagoTuneRunOldUninstaller
  # ① 提取卸载器路径：UninstallString 恒为 '"<路径>" <上下文参数>'（electron-builder installer.nsh 写入）。
  #    提取失败（无成对引号）时 $R4 保持为空，后续退化为原地运行 $R1。
  StrCpy $R4 ""
  StrCpy $R7 1
  ${Do}
    StrCpy $R8 $R1 1 $R7
    ${If} $R8 == ""
      ${Break}
    ${ElseIf} $R8 == '"'
      IntOp $R7 $R7 - 1
      StrCpy $R4 $R1 $R7 1
      ${Break}
    ${Else}
      IntOp $R7 $R7 + 1
    ${EndIf}
  ${Loop}

  # ② InstallLocation 为空但卸载器路径已知：回退取其父目录（对齐 electron-builder GetFileParent）。
  ${If} $R2 == ""
  ${AndIf} $R4 != ""
    StrCpy $R6 0
    StrCpy $R7 0
    ${Do}
      StrCpy $R8 $R4 1 $R7
      ${If} $R8 == ""
        ${Break}
      ${ElseIf} $R8 == "\"
        StrCpy $R6 $R7
        IntOp $R7 $R7 + 1
      ${Else}
        IntOp $R7 $R7 + 1
      ${EndIf}
    ${Loop}
    StrCpy $R2 $R4 $R6
  ${EndIf}

  ${If} $R2 == ""
    ${If} $LANGUAGE == 1033
      DetailPrint "Previous version found, but its install location is unknown; skipping removal."
    ${Else}
      DetailPrint "检测到旧版本，但无法确定其安装目录，跳过自动卸载。"
    ${EndIf}
  ${Else}
    ${If} $LANGUAGE == 1033
      DetailPrint "Removing previous version (user data is preserved)..."
    ${Else}
      DetailPrint "正在移除旧版本（用户数据保留）…"
    ${EndIf}

    # ③ 优先复制旧卸载器到 $PLUGINSDIR 后运行（其安装目录随后会被删除，卸载器需在目录外生存——
    #    与 electron-builder installUtil.nsh 的 uninstallOldVersion 同范式）；复制失败退回原地。
    StrCpy $R5 ""
    ${If} $R4 != ""
      InitPluginsDir
      ClearErrors
      CopyFiles /SILENT "$R4" "$PLUGINSDIR\old-uninstaller.exe"
      ${IfNot} ${Errors}
        StrCpy $R5 "$PLUGINSDIR\old-uninstaller.exe"
      ${EndIf}
    ${EndIf}

    # /KEEP_APP_DATA 与 --updated 双保险：即便旧版本定义了 DELETE_APP_DATA_ON_UNINSTALL，用户数据也不删。
    ClearErrors
    ${If} $R5 != ""
      ExecWait '"$R5" /S /KEEP_APP_DATA --updated _?=$R2' $R3
    ${Else}
      ExecWait '$R1 /S /KEEP_APP_DATA --updated _?=$R2' $R3
    ${EndIf}

    ${If} ${Errors}
    ${AndIf} $R5 != ""
      # temp 副本无法启动 → 原地重试一次（对齐官方 TryInPlace 回退）
      ClearErrors
      ExecWait '$R1 /S /KEEP_APP_DATA --updated _?=$R2' $R3
    ${EndIf}

    ${If} ${Errors}
      ${If} $LANGUAGE == 1033
        DetailPrint "Previous uninstaller could not be launched; continuing installation."
      ${Else}
        DetailPrint "无法启动旧卸载器，继续安装。"
      ${EndIf}
    ${ElseIf} $R3 != 0
      ${If} $LANGUAGE == 1033
        DetailPrint "Previous uninstaller exited with code $R3; continuing installation."
      ${Else}
        DetailPrint "旧卸载器退出码 $R3，继续安装。"
      ${EndIf}
    ${Else}
      ${If} $LANGUAGE == 1033
        DetailPrint "Previous version removed."
      ${Else}
        DetailPrint "旧版本已移除。"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro ImagoTuneTakeOverOldInstall
  # 按用户(HKCU)旧安装：当前用户上下文即可移除，无需提权。
  ReadRegStr $R1 HKCU "${IMAGOTUNE_OLD_UNINSTALL_KEY}" UninstallString
  ${If} $R1 != ""
    ReadRegStr $R2 HKCU "${IMAGOTUNE_OLD_INSTALL_KEY}" InstallLocation
    !insertmacro ImagoTuneRunOldUninstaller
  ${EndIf}

  # 按机器(HKLM)旧安装：仅已提权时尝试，避免静默模式触发 UAC 而挂起。
  ${If} ${UAC_IsAdmin}
    ReadRegStr $R1 HKLM "${IMAGOTUNE_OLD_UNINSTALL_KEY}" UninstallString
    ${If} $R1 != ""
      ReadRegStr $R2 HKLM "${IMAGOTUNE_OLD_INSTALL_KEY}" InstallLocation
      !insertmacro ImagoTuneRunOldUninstaller
    ${EndIf}
  ${Else}
    ReadRegStr $R1 HKLM "${IMAGOTUNE_OLD_UNINSTALL_KEY}" UninstallString
    ${If} $R1 != ""
      ${If} $LANGUAGE == 1033
        DetailPrint "Previous per-machine installation found, but elevation is unavailable; skipping removal."
      ${Else}
        DetailPrint "检测到旧版机器级安装，但当前未提权，跳过自动卸载（继续安装）。"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

# ----------------------------------------------------------------------
# 安装初始化（在建模式/目录初始化之后、页面显示之前执行）
# ----------------------------------------------------------------------
!macro customInit
  # (0) 接管旧身份安装（appId 由 com.zztnbnb.pinaic.imagestudio 变更为本仓新 appId 引入；
  #     旧/新 GUID 推导与边界说明见上方“旧版接管”注释块）。
  !insertmacro ImagoTuneTakeOverOldInstall

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
