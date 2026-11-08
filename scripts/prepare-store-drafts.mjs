/** Update English store drafts only. Deliberately has no review or track API. */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {createHash, sign} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const meta=JSON.parse(await readFile(resolve(root,'store/metadata/metadata.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(root,'store/assets/public-0.2.0/manifest.json'),'utf8'));
const base='store/assets/public-0.2.0';
const report={version:'0.2.0',locale:'en-US',startedAt:new Date().toISOString(),submittedForReview:false,productionTracksChanged:false};
const apply=process.argv.includes('--apply');
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function assert(value,message){if(!value)throw Error(message);}
for(const asset of manifest.assets){
  const file=resolve(root,asset.file);assert(!relative(root,file).startsWith('..'),'Asset outside repository');
  const b=await readFile(file);assert(hash(b)===asset.sha256,'Asset checksum differs: '+asset.file);
  assert(b.subarray(1,4).toString()==='PNG','PNG required');
  assert(b.readUInt32BE(16)===asset.width&&b.readUInt32BE(20)===asset.height,'Wrong dimensions');
  assert([0,2].includes(b[25]),'Store exports must be opaque');
}
assert(manifest.locale==='en-US'&&!meta.localizations,'English store listings only');
const appleFiles=manifest.assets.filter(a=>a.file.includes('/apple/en-US/iphone-67/'));
const playFiles=manifest.assets.filter(a=>a.file.includes('/google-play/en-US/phone/'));
assert(appleFiles.length===6&&appleFiles.every(a=>a.width===1320&&a.height===2868),'Expected six large iPhone screenshots');
assert(playFiles.length===6&&playFiles.every(a=>a.width===1080&&a.height===1920),'Expected six Play screenshots');
for(const [k,n]of Object.entries({name:30,subtitle:30,promotional_text:170,description:4000,keywords:100}))assert((k==='keywords'?Buffer.byteLength(meta.apple[k]):[...meta.apple[k]].length)<=n,'Apple field too long: '+k);
for(const [k,n]of Object.entries({title:30,short_description:80,full_description:4000}))assert([...meta.google_play[k]].length<=n,'Play field too long: '+k);
if(!apply){console.log('PASS: English metadata, six screenshots per store, PNG dimensions/opacity and all asset hashes. No store mutations.');process.exit(0);}
assert(process.env.GITHUB_REPOSITORY==='silvergrid/famcall'&&process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_ACTOR==='silvergrid'&&process.env.GITHUB_TRIGGERING_ACTOR==='silvergrid','Use the owner-approved main-branch listing workflow.');
const appleKey=JSON.parse(process.env.FAMCALL_APPLE_API_KEY_JSON||'null');
const playKey=JSON.parse(process.env.FAMCALL_PLAY_API_KEY_JSON||'null');
assert(appleKey?.key&&playKey?.private_key,'Protected store credentials required');
async function request(url,init,label){
  const r=await fetch(url,init);const t=await r.text();
  if(!r.ok){let message;try{const e=JSON.parse(t);message=e.errors?.map(x=>x.detail||x.title).join('; ')||e.error?.message;}catch{}throw Error(`${label}: HTTP ${r.status}${message?' '+message.slice(0,600):''}`);}
  return t?JSON.parse(t):{};
}
async function apple(path,method='GET',data){
  const now=Math.floor(Date.now()/1000);const unsigned=encode({alg:'ES256',kid:appleKey.key_id,typ:'JWT'})+'.'+encode({iss:appleKey.issuer_id,iat:now,exp:now+600,aud:'appstoreconnect-v1'});
  const jwt=unsigned+'.'+sign('sha256',Buffer.from(unsigned),{key:appleKey.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return request('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},...(data?{body:JSON.stringify({data})}:{})},'Apple '+method+' '+path.split('?')[0]);
}
async function english(parent,type,attributes){
  const rows=(await apple(parent+'/'+type)).data;let row=rows.find(x=>x.attributes.locale==='en-US');
  if(row)return (await apple('/v1/'+type+'/'+row.id,'PATCH',{type,id:row.id,attributes})).data;
  const [parentType,id]=parent.split('/').slice(-2);
  const relation=parentType==='appInfos'?'appInfo':'appStoreVersion';
  return (await apple('/v1/'+type,'POST',{type,attributes:{locale:'en-US',...attributes},relationships:{[relation]:{data:{type:parentType,id}}}})).data;
}
async function appleDraft(){
  const app='6831551843';
  const versions=(await apple(`/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=50`)).data;
  const version=versions.find(x=>x.attributes.versionString==='0.2.0')||versions.find(x=>x.attributes.appStoreState==='PREPARE_FOR_SUBMISSION');
  assert(version?.attributes.appStoreState==='PREPARE_FOR_SUBMISSION','Apple version must be an editable, unsubmitted draft');
  const build=(await apple('/v1/builds/868dd720-b6aa-4f3e-81d2-dc861a09156b?include=preReleaseVersion')).data;
  assert(build.attributes.version==='5'&&build.attributes.processingState==='VALID','Expected validated TestFlight build 5');
  await apple('/v1/appStoreVersions/'+version.id,'PATCH',{type:'appStoreVersions',id:version.id,attributes:{versionString:'0.2.0',copyright:meta.apple.copyright,releaseType:'MANUAL'},relationships:{build:{data:{type:'builds',id:build.id}}}});
  const infos=(await apple(`/v1/apps/${app}/appInfos`)).data;
  const info=infos.find(x=>x.attributes.appStoreState==='PREPARE_FOR_SUBMISSION');assert(info,'No editable Apple app information');
  const infoLocale=await english('/v1/appInfos/'+info.id,'appInfoLocalizations',{name:meta.apple.name,subtitle:meta.apple.subtitle,privacyPolicyUrl:'https://famcall.web.app/privacy'});
  const loc=await english('/v1/appStoreVersions/'+version.id,'appStoreVersionLocalizations',{description:meta.apple.description,keywords:meta.apple.keywords,promotionalText:meta.apple.promotional_text,supportUrl:'https://famcall.web.app',marketingUrl:'https://famcall.web.app'});
  const sets=(await apple('/v1/appStoreVersionLocalizations/'+loc.id+'/appScreenshotSets')).data;
  let set=sets.find(x=>x.attributes.screenshotDisplayType==='APP_IPHONE_67');
  if(!set)set=(await apple('/v1/appScreenshotSets','POST',{type:'appScreenshotSets',attributes:{screenshotDisplayType:'APP_IPHONE_67'},relationships:{appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:loc.id}}}})).data;
  const previous=(await apple('/v1/appScreenshotSets/'+set.id+'/appScreenshots')).data;
  const expected=await Promise.all(appleFiles.map(async a=>({...a,md5:hash(await readFile(resolve(root,a.file)),'md5')})));
  const complete=previous.length===6&&previous.every((s,i)=>s.attributes.sourceFileChecksum===expected[i].md5&&s.attributes.assetDeliveryState?.state==='COMPLETE');
  if(!complete){
    for(const s of previous)await apple('/v1/appScreenshots/'+s.id,'DELETE');
    for(const a of expected){
      const bytes=await readFile(resolve(root,a.file));
      const screenshot=(await apple('/v1/appScreenshots','POST',{type:'appScreenshots',attributes:{fileName:a.file.split('/').at(-1),fileSize:bytes.length},relationships:{appScreenshotSet:{data:{type:'appScreenshotSets',id:set.id}}}})).data;
      for(const op of screenshot.attributes.uploadOperations){
        const r=await fetch(op.url,{method:op.method,headers:Object.fromEntries(op.requestHeaders.map(h=>[h.name,h.value])),body:bytes.subarray(op.offset,op.offset+op.length)});assert(r.ok,'Apple screenshot transfer failed: '+r.status);
      }
      await apple('/v1/appScreenshots/'+screenshot.id,'PATCH',{type:'appScreenshots',id:screenshot.id,attributes:{sourceFileChecksum:a.md5,uploaded:true}});
      console.log('Apple screenshot uploaded: '+a.file.split('/').at(-1));
    }
  }
  let screenshots;
  for(let attempt=0;attempt<30;attempt++){
    screenshots=(await apple('/v1/appScreenshotSets/'+set.id+'/appScreenshots')).data;
    if(screenshots.length===6&&screenshots.every(x=>x.attributes.assetDeliveryState?.state==='COMPLETE'))break;
    assert(!screenshots.some(x=>x.attributes.assetDeliveryState?.state==='FAILED'),'Apple screenshot processing failed');
    await new Promise(r=>setTimeout(r,5000));
  }
  assert(screenshots.length===6&&screenshots.every(x=>x.attributes.assetDeliveryState?.state==='COMPLETE'),'Apple screenshots still processing');
  const actual=(await apple('/v1/appStoreVersionLocalizations/'+loc.id)).data.attributes;
  assert(actual.description===meta.apple.description&&actual.keywords===meta.apple.keywords&&actual.promotionalText===meta.apple.promotional_text,'Apple copy readback mismatch');
  const infoActual=(await apple('/v1/appInfoLocalizations/'+infoLocale.id)).data.attributes;
  assert(infoActual.name===meta.apple.name&&infoActual.subtitle===meta.apple.subtitle,'Apple title readback mismatch');
  const draft=(await apple('/v1/appStoreVersions/'+version.id)).data.attributes;
  assert(draft.appStoreState==='PREPARE_FOR_SUBMISSION'&&draft.versionString==='0.2.0','Apple draft state changed unexpectedly');
  report.apple={versionId:version.id,state:draft.appStoreState,version:draft.versionString,build:'5',locale:'en-US',screenshots:screenshots.map(x=>({id:x.id,fileName:x.attributes.fileName,state:x.attributes.assetDeliveryState.state})),copyVerified:true};
  console.log('Apple English draft and six processed screenshots verified.');
}
async function playDraft(){
  const now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:playKey.client_email,scope:'https://www.googleapis.com/auth/androidpublisher',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+600});
  const result=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),playKey.private_key).toString('base64url')})},'Play authentication');
  const headers={Authorization:'Bearer '+result.access_token};
  const url='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.silvergridtech.famcall';
  const api=(p,m='GET',data)=>request(url+p,{method:m,headers:{...headers,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})},'Play '+m+' '+p.split('?')[0]);
  const edit=await api('/edits','POST',{});let committed=false;
  try{
    const p='/edits/'+edit.id;
    const tracksBefore=await api(p+'/tracks');
    const listing={language:'en-US',title:meta.google_play.title,shortDescription:meta.google_play.short_description,fullDescription:meta.google_play.full_description};
    await api(p+'/listings/en-US','PUT',listing);
    const images=[['icon',[`${base}/icons/google-play-512.png`]],['featureGraphic',[`${base}/google-play/en-US/feature-graphic-1024x500.png`]],['phoneScreenshots',playFiles.map(a=>a.file)]];
    for(const [type,files]of images){
      await api(p+'/listings/en-US/'+type,'DELETE');
      for(const file of files){
        const bytes=await readFile(resolve(root,file));
        await request(url.replace('/androidpublisher/v3/','/upload/androidpublisher/v3/')+p+'/listings/en-US/'+type+'?uploadType=media',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:bytes},'Play '+type+' upload');
      }
      const actual=await api(p+'/listings/en-US/'+type);assert(actual.images?.length===files.length,'Play image count differs: '+type);
      assert(actual.images.every((image,i)=>image.sha256===manifest.assets.find(a=>a.file===files[i]).sha256),'Play image checksum differs: '+type);
    }
    assert(JSON.stringify(await api(p+'/tracks'))===JSON.stringify(tracksBefore),'Track state unexpectedly changed');
    await api(p+':commit?changesNotSentForReview=true','POST',{});committed=true;
    const verify=await api('/edits','POST',{});
    try{
      const actual=await api('/edits/'+verify.id+'/listings/en-US');
      assert(Object.entries(listing).every(([k,v])=>actual[k]===v),'Play listing readback mismatch');
      const counts={};for(const[type,files]of images){const rows=await api('/edits/'+verify.id+'/listings/en-US/'+type);counts[type]=rows.images?.length||0;assert(counts[type]===files.length,'Play saved image count differs');}
      report.googlePlay={locale:'en-US',changesNotSentForReview:true,copyVerified:true,images:counts,tracksUnchanged:true};
    }finally{await api('/edits/'+verify.id,'DELETE');}
    console.log('Play English listing, icon, feature graphic and six screenshots saved without sending for review.');
  }finally{if(!committed)await api('/edits/'+edit.id,'DELETE').catch(()=>{});}
}
await mkdir(resolve(root,'.local/store-listing-report'),{recursive:true});
try{await appleDraft();await playDraft();report.completedAt=new Date().toISOString();}
catch(e){report.error=e.message;throw e;}
finally{await writeFile(resolve(root,'.local/store-listing-report/result.json'),JSON.stringify(report,null,2)+'\n');}
