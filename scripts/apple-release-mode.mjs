/** Configure only the tested Apple version; do not resubmit a version already in review. */
export async function prepareAppleReleaseMode(apple, candidate, modeOnly = false) {
  const versions = (await apple('/v1/apps/6831551843/appStoreVersions?filter[platform]=IOS&limit=30')).data;
  const version = versions.find(v => v.attributes.versionString === candidate.version);
  const allowed = modeOnly
    ? ['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW']
    : ['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'];
  if (!version || !allowed.includes(version.attributes.appStoreState))
    throw new Error('The exact Apple version is not eligible for this operation.');
  const path = '/v1/appStoreVersions/' + version.id;
  const build = (await apple(path + '/build')).data;
  if (build?.attributes.version !== String(candidate.iosBuildNumber) || build.attributes.processingState !== 'VALID')
    throw new Error('The Apple version has a different or unprocessed build.');
  if (version.attributes.releaseType !== 'AFTER_APPROVAL') {
    await apple(path, 'PATCH', {type:'appStoreVersions',id:version.id,attributes:{releaseType:'AFTER_APPROVAL'}});
  }
  const check = (await apple(path)).data;
  if (check.attributes.releaseType !== 'AFTER_APPROVAL')
    throw new Error('Apple automatic release readback failed.');
  return check;
}
