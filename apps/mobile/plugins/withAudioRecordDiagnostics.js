const { withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const begin = '    // FamCall audio recording diagnostics begin';
const end = '    // FamCall audio recording diagnostics end';
const block = `${begin}\n    com.silvergridtech.famcall.diagnostics.FamCallAudioRecordDiagnostics.install(this)\n${end}\n`;
const fileName = 'FamCallAudioRecordDiagnostics.kt';

function configureApplication(contents, enabled) {
  const start = contents.indexOf(begin);
  if (start !== -1) {
    const finish = contents.indexOf(end, start);
    if (finish === -1) throw new Error('Incomplete FamCall audio diagnostic block');
    contents = contents.slice(0, start) + contents.slice(finish + end.length).replace(/^\r?\n/, '');
  }
  if (!enabled) return contents;
  const anchor = '    loadReactNative(this)';
  if (contents.split(anchor).length !== 2) throw new Error('Expected one React Native initialization point');
  return contents.replace(anchor, block + anchor);
}

async function syncSource(projectRoot, platformRoot, enabled) {
  const target = path.join(platformRoot, 'app/src/main/java/com/silvergridtech/famcall/diagnostics', fileName);
  if (enabled) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(projectRoot, 'native/android', fileName), target);
  } else {
    // Switching an existing generated project back to a normal build must also
    // remove the diagnostic class, not just its installation call.
    await fs.rm(target, { force: true });
  }
}

module.exports = (config, { enabled = false } = {}) => {
  if (enabled && config.android?.package !== 'com.silvergridtech.famcall.e2e')
    throw new Error('Audio recording diagnostics require the separate e2e package');
  config = withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('FamCall expects a Kotlin MainApplication');
    mod.modResults.contents = configureApplication(mod.modResults.contents, enabled);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    await syncSource(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot, enabled);
    return mod;
  }]);
};
module.exports.configureApplication = configureApplication;
module.exports.syncSource = syncSource;
