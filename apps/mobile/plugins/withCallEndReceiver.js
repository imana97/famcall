const {withDangerousMod, withAppBuildGradle} = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = config => {
  config = withDangerousMod(config, ['android', async mod => {
    const root = mod.modRequest.projectRoot;
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/com/silvergridtech/famcall/calls');
    await fs.mkdir(target, {recursive: true});
    await fs.copyFile(path.join(root, 'native/android/FamCallEndReceiver.kt'), path.join(target, 'FamCallEndReceiver.kt'));
    return mod;
  }]);
  return withAppBuildGradle(config, mod => {
    const marker = '// FamCall native call-end delivery';
    if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += `
${marker}
dependencies {
    implementation platform('com.google.firebase:firebase-bom:35.0.2')
    implementation 'com.google.firebase:firebase-auth'
    implementation 'com.google.firebase:firebase-functions'
    implementation 'com.google.firebase:firebase-appcheck-playintegrity'
    implementation 'androidx.work:work-runtime-ktx:2.12.0'
}
`;
    return mod;
  });
};
