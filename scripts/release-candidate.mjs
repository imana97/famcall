/** Keep owner acceptance distinct from measured test results. Native/build identity is checked by the caller. */
export const runtimeChecks = ['twoWaySpeechAndPoorNetwork', 'interruptionAndRecovery', 'physicalAndroidAndIPhone',
  'backgroundPushAndAudioRoutes', 'productionAuthAndAppCheck'];
export const requiredChecks = [...runtimeChecks, 'smsDailyLimit', 'storePrivacyAndLegalDeclarations', 'releaseScreenshotsAndCopy'];
export function validateReleaseCandidate(candidate, platform, ownerReport) {
  if (!['android', 'ios'].includes(platform)) throw new Error('Choose one public store.');
  if (candidate.status !== 'ready') throw new Error('Release evidence is not ready.');
  if (!/^[a-f0-9]{40}$/.test(candidate.sourceCommit ?? '')) throw new Error('A tested source commit is required.');
  if (!/^\d+\.\d+\.\d+$/.test(candidate.version ?? '')) throw new Error('Invalid release version.');
  for (const os of ['ios','android']) if (!/^[1-9]\d*$/.test(String(candidate[os+'BuildNumber'] ?? '')))
    throw new Error('An explicit tested build number is required.');
  const ownerAccepted = ownerReport?.owner === 'silvergrid' && ownerReport.testingConfirmed === true &&
    ownerReport.publicSubmissionAuthorized === true && ownerReport.version === candidate.version &&
    ownerReport.sourceCommit === candidate.sourceCommit && ownerReport.buildNumbers?.ios === candidate.iosBuildNumber &&
    ownerReport.buildNumbers?.android === candidate.androidBuildNumber && typeof ownerReport.scopeLimit === 'string' &&
    Boolean(ownerReport.scopeLimit.trim());
  for (const check of requiredChecks) {
    const entry = candidate.checks?.[check];
    const evidence = check === 'storePrivacyAndLegalDeclarations' && entry?.platforms ? entry.platforms[platform] : entry;
    if (typeof evidence?.reference !== 'string' || !evidence.reference.trim()) throw new Error('Missing release evidence: '+check);
    if (evidence.result === 'pass') continue;
    if (runtimeChecks.includes(check) && evidence.result === 'owner-accepted' && ownerAccepted &&
        evidence.reference === candidate.ownerAcceptanceReference) continue;
    throw new Error('Unresolved release evidence: '+check);
  }
}
