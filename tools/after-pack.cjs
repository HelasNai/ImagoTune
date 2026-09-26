const path = require("node:path");
const { rcedit } = require("rcedit");

module.exports = async function applyWindowsResources(context) {
  if (context.electronPlatformName !== "win32") return;

  const { appInfo } = context.packager;
  const executable = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, "ImagoTune.ico");

  // 发布者名称单一来源：package.json 的 author（electron-builder 已规范化为 appInfo.companyName）
  const companyName = appInfo.companyName || appInfo.productName;

  const options = {
    icon,
    "file-version": appInfo.version,
    "product-version": appInfo.version,
    "version-string": {
      CompanyName: companyName,
      FileDescription: "ImagoTune",
      InternalName: "ImagoTune",
      LegalCopyright: `Copyright (c) ${companyName}`,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      ProductName: "ImagoTune",
    },
    "requested-execution-level": "asInvoker",
  };

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rcedit(executable, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
};
