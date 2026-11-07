const { withInfoPlist } = require('expo/config-plugins');
module.exports = config => withInfoPlist(config, mod => {
  // App Store's static check requires this because WebRTC contains camera APIs,
  // even though all FamCall capture requests use video: false.
  mod.modResults.NSCameraUsageDescription =
    'FamCall does not use your camera. Camera access is not needed for voice calls.';
  mod.modResults.UIRequiresFullScreen = true;
  return mod;
});
