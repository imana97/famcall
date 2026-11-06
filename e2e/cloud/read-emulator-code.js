// This helper can only read fictional-number codes from the demo Auth emulator.
// BrowserStack must route the test runner through Local as well as the device.
if (!/^\+1202555010[1-3]$/.test(PHONE)) {
  throw new Error('Cloud tests require a fictional FamCall lab number.');
}
if (AUTH_EMULATOR_HOST !== 'bs-local.com' && AUTH_EMULATOR_HOST !== '127.0.0.1') {
  throw new Error('Cloud tests require the private demo emulator endpoint.');
}
var response = http.get(
  'http://' + AUTH_EMULATOR_HOST + ':9099/emulator/v1/projects/demo-famcall/verificationCodes'
);
if (!response.ok) throw new Error('The test runner cannot reach the demo Auth emulator.');
var codes = json(response.body).verificationCodes || [];
var matches = codes.filter(function (entry) { return entry.phoneNumber === PHONE; });
var code = matches.length ? matches[matches.length - 1].code : undefined;
if (!/^\d{6}$/.test(String(code))) {
  throw new Error('No valid emulator verification code was issued for this lab number.');
}
output.verificationCode = code;
