const path = require("node:path");
const { rcedit } = require("rcedit");

module.exports = async function applyWindowsResources(context) {
  if (context.electronPlatformName !== "win32") return;

  const { appInfo } = context.packager;
  const executable = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, "AI Image Studio.ico");

  const options = {
    icon,
    "file-version": appInfo.version,
    "product-version": appInfo.version,
    "version-string": {
      CompanyName: "zztnbnb",
      FileDescription: "AI Image Studio",
      InternalName: "AI Image Studio",
      LegalCopyright: "Copyright (c) zztnbnb",
      OriginalFilename: `${appInfo.productFilename}.exe`,
      ProductName: "AI Image Studio",
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
