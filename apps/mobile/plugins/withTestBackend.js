const { withInfoPlist } = require('expo/config-plugins');

module.exports = config => withInfoPlist(config, mod => {
  const ats = { ...mod.modResults.NSAppTransportSecurity };
  const domains = { ...ats.NSExceptionDomains };
  // Remove our old exception even when prebuild reuses a prior test project.
  delete domains['bs-local.com'];
  if (mod.extra?.appMode === 'e2e' && mod.extra?.emulatorHost === 'bs-local.com') {
    if (mod.ios?.bundleIdentifier !== 'com.silvergridtech.famcall.e2e') {
      throw new Error('The hosted demo backend requires the separate test app.');
    }
    domains['bs-local.com'] = {
      NSExceptionAllowsInsecureHTTPLoads: true,
      NSIncludesSubdomains: false,
    };
    ats.NSAllowsArbitraryLoads = false;
  }
  if (Object.keys(domains).length) ats.NSExceptionDomains = domains;
  else delete ats.NSExceptionDomains;
  if (Object.keys(ats).length) mod.modResults.NSAppTransportSecurity = ats;
  else delete mod.modResults.NSAppTransportSecurity;
  return mod;
});
