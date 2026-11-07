CONTACT SELECTION REGRESSION (ANDROID)

Use a standalone APP_VARIANT=e2e build and the local demo-famcall Firebase
emulators described in the repository README. No real SMS, production service,
provider credentials or personal phone is needed.

1. Boot only the dedicated famcall_a emulator (emulator-5554).
2. Install the test APK built from the branch under test.
3. Run: node scripts/seed-contact-fixtures.mjs emulator-5554
4. Run: PHONE=+12025550103 node scripts/e2e-sign-in.mjs
5. Run: maestro --device emulator-5554 test --test-output-dir .local/maestro/contact-selection e2e/maestro/contact-number-selection.yaml

The seed command refuses non-emulator devices and unrelated AVD names. It
replaces only its own fictional contact fixtures, never the full address book.
Fixtures cover no number, one number, and nine numbers. Contact numbers are
fictional +1 202 555 01xx entries, not real people.

The flow verifies that picker cancellation, chooser Cancel, Android back, and
selecting a contact with no number preserve both original form fields. It then
checks single-number replacement and selecting/saving the ninth number. Three
screenshots go under the chosen test output directory in
screenshots/.local/contact-selection-*.png. Independently check the saved
name and canonical phone in the demo Firestore before claiming an end-to-end pass.

This is Android contact-import coverage only. It is not evidence of production
authentication, real-device permissions, voice transport or iOS native behavior.
