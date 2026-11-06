"""One-time maintainer setup. Uses gcloud/gh sessions; never creates credential files."""
import json
import subprocess

PROJECT = 'famcall'
NUMBER = '635297130023'
REPOSITORY_ID = '1447969272'
OWNER_ID = '240356686'
DEPLOY = f'famcall-deploy@{PROJECT}.iam.gserviceaccount.com'
RUNTIME = f'famcall-runtime@{PROJECT}.iam.gserviceaccount.com'
BASE = ['--project=' + PROJECT, '--billing-project=' + PROJECT, '--quiet']


def cloud(*args):
    p = subprocess.run(['gcloud', *args, *BASE], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout


def ensure(kind, name, create):
    p = subprocess.run(['gcloud', *kind, 'describe', name, *BASE], capture_output=True)
    if p.returncode:
        cloud(*create)
    print('Configured ' + name, flush=True)


ensure(['iam', 'service-accounts'], DEPLOY, ['iam', 'service-accounts', 'create', 'famcall-deploy', '--display-name=FamCall reviewed workflow deployment'])
ensure(['iam', 'service-accounts'], RUNTIME, ['iam', 'service-accounts', 'create', 'famcall-runtime', '--display-name=FamCall backend runtime'])
pools = json.loads(cloud('iam', 'workload-identity-pools', 'list', '--location=global', '--format=json'))
if not any(p['name'].endswith('/famcall-github') for p in pools):
    cloud('iam', 'workload-identity-pools', 'create', 'famcall-github', '--location=global', '--display-name=FamCall GitHub Actions')
providers = json.loads(cloud('iam', 'workload-identity-pools', 'providers', 'list', '--workload-identity-pool=famcall-github', '--location=global', '--format=json'))
condition = (f"assertion.repository_id == '{REPOSITORY_ID}' && assertion.repository_owner_id == '{OWNER_ID}' && "
             f"assertion.actor_id == '{OWNER_ID}' && assertion.ref == 'refs/heads/main' && "
             "assertion.sub == 'repo:silvergrid/famcall:environment:backend' && "
             "assertion.workflow_ref == 'silvergrid/famcall/.github/workflows/backend.yml@refs/heads/main'")
operation = 'update-oidc' if any(p['name'].endswith('/github') for p in providers) else 'create-oidc'
cloud('iam', 'workload-identity-pools', 'providers', operation, 'github', '--location=global', '--workload-identity-pool=famcall-github',
      '--issuer-uri=https://token.actions.githubusercontent.com', '--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id', '--attribute-condition=' + condition)
cloud('iam', 'service-accounts', 'add-iam-policy-binding', DEPLOY,
      '--role=roles/iam.workloadIdentityUser', '--member=' + f'principalSet://iam.googleapis.com/projects/{NUMBER}/locations/global/workloadIdentityPools/famcall-github/attribute.repository_id/{REPOSITORY_ID}')
for role in ['cloudfunctions.admin', 'firebasehosting.admin', 'firebaserules.admin', 'datastore.indexAdmin',
             'serviceusage.serviceUsageConsumer', 'cloudscheduler.admin', 'run.admin', 'eventarc.admin',
             'artifactregistry.admin', 'storage.admin', 'secretmanager.viewer']:
    cloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + DEPLOY, '--role=roles/' + role, '--condition=None')
for role in ['datastore.user', 'firebaseauth.admin', 'firebasecloudmessaging.admin', 'logging.logWriter', 'eventarc.eventReceiver']:
    cloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + RUNTIME, '--role=roles/' + role, '--condition=None')
cloud('iam', 'service-accounts', 'add-iam-policy-binding', RUNTIME, '--member=serviceAccount:' + DEPLOY, '--role=roles/iam.serviceAccountUser')
build = NUMBER + '-compute@developer.gserviceaccount.com'
cloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + build, '--role=roles/cloudbuild.builds.builder', '--condition=None')
cloud('iam', 'service-accounts', 'add-iam-policy-binding', build, '--member=serviceAccount:' + DEPLOY, '--role=roles/iam.serviceAccountUser')
for secret in ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN']:
    cloud('secrets', 'add-iam-policy-binding', secret, '--member=serviceAccount:' + RUNTIME, '--role=roles/secretmanager.secretAccessor')
provider = f'projects/{NUMBER}/locations/global/workloadIdentityPools/famcall-github/providers/github'
for name, value in {'GCP_WORKLOAD_IDENTITY_PROVIDER': provider, 'GCP_DEPLOY_SERVICE_ACCOUNT': DEPLOY}.items():
    subprocess.run(['gh', 'variable', 'set', name, '--repo=silvergrid/famcall', '--env=backend', '--body=' + value], check=True)
print('Configured restricted federation and backend environment variables. No deployment performed.')
