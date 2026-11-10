import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateArtifactSource(run, jobs) {
  if (run.repository?.full_name !== 'silvergrid/famcall' || run.head_repository?.full_name !== 'silvergrid/famcall' ||
      run.head_branch !== 'main' || run.event !== 'workflow_dispatch' || run.actor?.login !== 'silvergrid' ||
      run.triggering_actor?.login !== 'silvergrid' || run.path !== '.github/workflows/apk-website.yml' ||
      !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') ||
      !jobs.jobs?.some(job => job.name === 'prepare' && job.conclusion === 'success'))
    throw new Error('APK artifact must come from successful owner-approved preparation on main.');
  return run.head_sha;
}

async function main() {
  const run = process.env.FAMCALL_APK_RUN_ID;
  if (!/^[1-9]\d*$/.test(run ?? '') || !process.env.GITHUB_TOKEN || !process.env.GITHUB_ENV)
    throw new Error('An approved APK run and workflow authentication are required.');
  async function api(path) {
    const response = await fetch('https://api.github.com/repos/silvergrid/famcall/actions/runs/' + run + path, {
      headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error('Cannot verify APK workflow provenance: ' + response.status);
    return response.json();
  }
  const sha = validateArtifactSource(await api(''), await api('/jobs'));
  execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD']);
  await appendFile(process.env.GITHUB_ENV, 'FAMCALL_APK_SOURCE_SHA=' + sha + '\n');
  console.log('Verified APK preparation run ' + run + ' from reviewed main history.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
