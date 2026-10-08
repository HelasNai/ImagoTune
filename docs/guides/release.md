# ImagoTune 发布与自动更新手册

- **版本**: v1.0
- **日期**: 2026-10-08
- **范围**: 版本发布流程、GitHub Release 资产清单、electron-updater 更新渠道（正式版 / 测试版 Beta）、CHANGELOG 维护约定
- **方法**: 源码阅读 + 实际发布验证（以 v2.0.0-beta.1 发布为准）

> 本文件是维护者手册，不属于用户文档。发布相关行为以 `electron/main.ts`（更新检查）、`package.json`（`build.publish`）与实测为准。

---

## 一、发布前检查

1. **更新 [CHANGELOG.md](../../CHANGELOG.md)**：新增当前版本的条目（版本号 + 日期 + 变更列表）。这是更新日志的唯一维护点；`docs/releases/` 的既有文件作为历史存档保留，新版本不再单独创建发布说明文件。
2. 更新 README 头部的「当前版本」行与 `package.json` 的 `version`。
3. 完整检查与打包：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run package:win
```

`package:win` 会先执行 `build`，再用 electron-builder 生成 NSIS 安装包，并做安装包完整性校验（`package:verify`）。

4. 涉及安装器改动（`tools/installer.nsh`）或应用标识变更时，先演练「旧版 → 新版」升级路径，确认安装接管与用户数据迁移符合预期，再对外发布。

## 二、GitHub Release 资产

公开仓库：https://github.com/HelasNai/ImagoTune

每个 GitHub Release 需要同时上传：

- `ImagoTune-Setup-版本号.exe`
- `ImagoTune-Setup-版本号.exe.blockmap`
- `latest.yml`

`latest.yml` 包含更新地址和校验信息；缺少它时，已安装用户无法收到新版本提醒。发布为纯手动流程（无 CI）。

## 三、发布 Beta 测试版

测试版与正式版共用同一套安装包，但只有把更新渠道选为「测试版 Beta」的用户才会收到。v2.0.0-beta.1 即通过该渠道发布。

- Beta 构建必须以 GitHub prerelease 发布，例如 electron-builder 发布时设置 `EP_PRE_RELEASE=true`，或在 `publish` 配置中设置 `releaseType: "prerelease"`。正式版用户读取的是 GitHub 的 `/releases/latest`，因此不会看到 prerelease。
- Beta 版本号必须带预发布后缀，例如 `2.1.0-beta.1`，否则会被当作正式版。
- 客户端通过 electron-updater 的 `channel = "beta"` 加 `allowPrerelease = true` 进入测试版渠道；应用内「测试版 Beta」选项做的就是这件事。
- 如果没有上传 `beta.yml` 资产，beta 渠道会回退读取该 Release 自己的 `latest.yml`。所以每个 Release 至少仍要上传 `latest.yml`、`.exe` 和 `.exe.blockmap` 三件套。
