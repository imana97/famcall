/** Save private reviewer access to the exact prepared Apple version; never log credentials. */
import { sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareAppleReleaseMode } from './apple-release-mode.mjs';
if (process.env.GITHUB_REPOSITORY !== 'silvergrid/famcall' || process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_ACTOR !== 'silvergrid' || process.env.GITHUB_TRIGGERING_ACTOR !== 'silvergrid')
  throw new Error('Use the protected owner workflow.');
const candidate = JSON.parse(await readFile('store/release/candidate.json','utf8'));
const modeOnly = process.env.FAMCALL_IOS_RELEASE_MODE_ONLY === 'true';
if (modeOnly && process.env.FAMCALL_PLATFORM !== 'ios') throw new Error('Apple release mode applies only to iOS.');
const credentials = JSON.parse(process.env.FAMCALL_APPLE_API_KEY_JSON ?? '{}');
const access = JSON.parse(process.env.FAMCALL_REVIEW_ACCESS_JSON ?? '{}');
const contact = access.publisherContact;
if (!credentials.key || !contact?.firstName || !contact.lastName || !/^\+[1-9]\d{7,14}$/.test(contact.phone ?? '') ||
    contact.email !== 'info@silvergridtech.com' || access.accounts?.length !== 2 ||
    access.accounts.some(a => !/^\+1202555018[23]$/.test(a.phone) || !/^\d{6}$/.test(a.code)))
  throw new Error('Expected private publisher and reviewer access is missing.');
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function apple(path, method='GET', data) {
  const now = Math.floor(Date.now()/1000);
  const unsigned = enc({alg:'ES256',kid:credentials.key_id,typ:'JWT'})+'.'+enc({iss:credentials.issuer_id,iat:now,exp:now+600,aud:'appstoreconnect-v1'});
  const token = unsigned+'.'+sign('sha256',Buffer.from(unsigned),{key:credentials.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  const r = await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify({data})}:{})});
  if (!r.ok) throw new Error('Reviewer setup failed: '+method+' '+r.status);
  return r.status===204?{}:r.json();
}
const version = await prepareAppleReleaseMode(apple, candidate, modeOnly);
if (modeOnly) {
  console.log(JSON.stringify({version:candidate.version,build:candidate.iosBuildNumber,releaseType:'AFTER_APPROVAL',reviewResubmitted:false}));
  process.exit(0);
}
const [a,b] = access.accounts;
const attributes = {
  contactFirstName:contact.firstName,contactLastName:contact.lastName,contactPhone:contact.phone,contactEmail:contact.email,
  demoAccountRequired:true,demoAccountName:a.phone,demoAccountPassword:a.code,
  notes:`FamCall ${candidate.version} is a one-to-one internet voice-calling app. Both endpoints need FamCall and internet. It does not call ordinary telephone lines or emergency services.\n\nREUSABLE REVIEW SIGN-IN\nAccount A: ${a.phone}; verification code: ${a.code}.\nAccount B (second device): ${b.phone}; verification code: ${b.code}.\nThese are Firebase fictional review numbers with static codes. No SIM, delivered SMS, staff approval, purchase, or subscription is needed. Enter a full number, tap Send code, and enter its supplied code. They use ordinary user permissions and normal app functionality.\n\nAllow Microphone during calling setup. Contacts access is optional: add the other review number manually with its country code or use the center keypad. Sign into the other account on a second iPhone or Android device, call between the devices, and answer there. There is no automated answering endpoint or promise of a staff member being available. Call history, blocking, editing/removing saved people, and Settings > Log out are available. Settings > Delete account uses the same review verification code.\n\nFamCall uses Firebase Authentication, Firestore, Cloud Functions and App Check; native Apple/Google push notifications; and WebRTC with Cloudflare TURN for relayed calls. Voice is live and is not recorded by FamCall. Language follows the phone by default and can be changed in Settings > Language; all layouts are left-to-right.\n\nSupport, privacy, and deletion: https://famcall.web.app/ and its privacy and delete-account pages. Safety reports: info@silvergridtech.com; unwanted callers can be blocked in the app.`,
};
const current = (await apple('/v1/appStoreVersions/'+version.id+'/appStoreReviewDetail')).data;
const payload = {type:'appStoreReviewDetails',...(current?{id:current.id}:{}),attributes,...(!current?{relationships:{appStoreVersion:{data:{type:'appStoreVersions',id:version.id}}}}:{})};
await apple(current?'/v1/appStoreReviewDetails/'+current.id:'/v1/appStoreReviewDetails',current?'PATCH':'POST',payload);
const check = (await apple('/v1/appStoreVersions/'+version.id+'/appStoreReviewDetail')).data;
for (const [key,value] of Object.entries(attributes)) if (check.attributes[key] !== value) throw new Error('Reviewer information readback mismatch.');
console.log(JSON.stringify({version:candidate.version,build:candidate.iosBuildNumber,reviewAccountCount:2,reviewerInformationVerified:true,credentialsLogged:false}));
