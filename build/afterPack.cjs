// Flip Electron fuses on the packaged binary: switch off ways to run it as something other than Termos.
const fs = require('node:fs')
const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

/** Path of the Electron executable inside appOutDir for the platform being packed. */
function executablePath(context) {
  const { packager, appOutDir, electronPlatformName: platform } = context
  const product = packager.appInfo.productFilename
  if (platform === 'darwin') return path.join(appOutDir, `${product}.app`)
  // executableName lives on the platform config (win.executableName / linux.executableName);
  // only the Linux packager exposes it directly.
  const names = [
    packager.executableName,
    packager.platformSpecificBuildOptions?.executableName,
    packager.config?.[platform === 'win32' ? 'win' : 'linux']?.executableName,
    product
  ].filter(Boolean)
  for (const name of names) {
    const file = path.join(appOutDir, platform === 'win32' ? `${name}.exe` : name)
    if (fs.existsSync(file)) return file
  }
  throw new Error(`afterPack: executable not found in ${appOutDir} (tried ${names.join(', ')})`)
}

exports.default = async function afterPack(context) {
  const exe = executablePath(context)
  console.log(`  • flipping fuses  file=${exe}`)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  })
}
