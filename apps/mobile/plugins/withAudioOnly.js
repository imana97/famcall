const { withInfoPlist } = require('expo/config-plugins');
module.exports = config => withInfoPlist(config, mod => {
  delete mod.modResults.NSCameraUsageDescription;
  mod.modResults.UIRequiresFullScreen = true;
  return mod;
});
