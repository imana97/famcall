// Require explicit endpoint identities before any app or backend interaction.
if (typeof PHONE !== 'string' || !/^\+1202555010[1-3]$/.test(PHONE)) {
  throw new Error('Set PHONE to a fictional FamCall lab number.');
}
if (typeof CONTACT_PHONE !== 'string' || !/^\+1202555010[1-3]$/.test(CONTACT_PHONE) || CONTACT_PHONE === PHONE) {
  throw new Error('Set CONTACT_PHONE to a different fictional FamCall lab number.');
}
if (typeof CONTACT_NAME !== 'string' || !CONTACT_NAME.trim()) {
  throw new Error('Set CONTACT_NAME for this test run.');
}
if (typeof AUTH_EMULATOR_HOST !== 'string' || AUTH_EMULATOR_HOST !== 'bs-local.com') {
  throw new Error('Cloud tests require the private BrowserStack demo endpoint.');
}
