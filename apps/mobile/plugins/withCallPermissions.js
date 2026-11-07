const { withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const line = '          add(com.silvergridtech.famcall.permissions.FamCallPermissionsPackage())';
const fileName = 'FamCallPermissionsPackage.kt';

function configureApplication(contents) {
  if (contents.includes(line)) return contents;
  const anchor = /PackageList\(this\)\.packages\.apply\s*\{/g;
  if ([...contents.matchAll(anchor)].length !== 1)
    throw new Error('Expected one React Native package registration block');
  return contents.replace(anchor, match => `${match}\n${line}`);
}

async function syncSource(projectRoot, platformRoot) {
  const target = path.join(platformRoot, 'app/src/main/java/com/silvergridtech/famcall/permissions', fileName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(projectRoot, 'native/android', fileName), target);
}

module.exports = config => {
  config = withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('FamCall expects a Kotlin MainApplication');
    mod.modResults.contents = configureApplication(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    await syncSource(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
    return mod;
  }]);
};
module.exports.configureApplication = configureApplication;
module.exports.syncSource = syncSource;
