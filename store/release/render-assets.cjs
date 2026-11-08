/* Genuine app captures are composed with text; no app UI is synthesized here. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const deps = createRequire(path.resolve(process.env.FAMCALL_ASSET_TOOLS || path.join(__dirname, 'tools'), 'package.json'));
const {chromium} = deps('playwright-core');
const sharp = deps('sharp');
const base = 'store/assets/public-0.3.0';
const marketing = 'store/marketing/0.3.0';
const cream = '#f6f5ed', green = '#193e35', sage = '#c4db96';
const scenes = [
  ['01-people', 'A little signal.<br>A familiar voice.', 'Simple voice calls for imperfect connections.'],
  ['02-dial', 'No saved contact?<br>Just dial.', 'Call another FamCall user by phone number.'],
  ['03-history', 'Recent calls.<br>Right here.', 'See your calls, including the ones you missed.'],
  ['04-add', 'Your people.<br>One simple list.', 'Add a name and number. Then tap to call.'],
  ['05-dark', 'Light or dark.<br>Always familiar.', 'A clear, simple app that follows your phone’s theme.'],
  ['06-language', 'Your language.<br>Your familiar voice.', '12 languages. One simple app.'],
];
const records = [];
async function data(file) {const bytes=await fs.readFile(path.join(root,file)); return 'data:image/png;base64,'+bytes.toString('base64');}
function html(w,h,body,extra=''){return `<!doctype html><html lang="en"><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}body{background:${cream};color:${green};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}img{display:block}.brand{display:flex;align-items:center;font-weight:700;gap:18px}.brand img{border-radius:23%;width:66px;height:66px}h1,p{margin:0}h1{font-weight:700;letter-spacing:-.045em;line-height:1.06}p{line-height:1.4;letter-spacing:-.015em}.motif{position:absolute;border:3px solid ${sage};border-radius:50%;opacity:.35}.eyebrow{font-size:22px;letter-spacing:.13em;font-weight:600;text-transform:uppercase}${extra}</style><body>${body}</body></html>`;}
async function render(browser,file,w,h,body,css='') {
  const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  await page.setContent(html(w,h,body,css));
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('[data-fit]')].filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>e.textContent));
  if(overflow.length)throw Error('Overflow in '+file+': '+overflow);
  const buffer=await page.screenshot({type:'png'});await page.close();
  const output=path.join(root,file);await fs.mkdir(path.dirname(output),{recursive:true});
  await sharp(buffer).removeAlpha().png({compressionLevel:9}).toFile(output);
  const bytes=await fs.readFile(output), meta=await sharp(bytes).metadata();
  records.push({file,width:meta.width,height:meta.height,alpha:meta.hasAlpha,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const icon=await data('store/assets/icons/apple-icon-1024.png');
  for(const platform of ['android','ios']){
    const apple=platform==='ios', w=apple?1320:1080,h=apple?2868:1920;
    const phoneW=apple?996:700, border=apple?14:12, top=apple?620:414;
    const rawH=apple?2868:2160,rawW=apple?1320:1080,phoneH=(phoneW-2*border)*rawH/rawW+2*border;
    for(const [name,title,subtitle] of scenes){
      const image=await data(`${base}/raw/${platform}/${name}.png`);
      const body=`<div class="motif" style="width:1400px;height:1400px;left:-900px;top:950px"></div><div class="brand" style="position:absolute;left:${apple?90:72}px;top:${apple?76:55}px;font-size:${apple?40:32}px"><img src="${icon}" style="width:${apple?72:55}px;height:${apple?72:55}px">FamCall</div><h1 data-fit style="position:absolute;left:${apple?90:72}px;right:60px;top:${apple?206:155}px;height:${apple?250:184}px;font-size:${apple?102:78}px">${title}</h1><p data-fit style="position:absolute;left:${apple?94:76}px;right:60px;top:${apple?465:342}px;height:100px;font-size:${apple?37:29}px;color:#5e746a">${subtitle}</p><div style="position:absolute;top:${top}px;left:${(w-phoneW)/2}px;width:${phoneW}px;height:${phoneH}px;border:${border}px solid #1e3832;border-radius:${apple?90:68}px;overflow:hidden;box-shadow:0 28px 50px #183b2e22;background:${cream}"><img src="${image}" style="width:100%;height:100%"></div><p style="position:absolute;bottom:${apple?43:27}px;left:0;width:100%;text-align:center;font-size:${apple?23:18}px;color:#68796e">${['01-people','03-history','04-add'].includes(name)?'Illustrative contacts and call history.':'FamCall · Voice calls, simply.'}</p>`;
      await render(browser,`${base}/${apple?'apple/en-US/iphone-67':'google-play/en-US/phone'}/${name}.png`,w,h,body);
    }
  }
  for(const [size,name] of [[1024,'apple-1024'],[512,'google-play-512']]){
    const file=`${base}/icons/${name}.png`;await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
    const source=sharp(path.join(root,'store/assets/icons/apple-icon-1024.png')).resize(size,size);
    await (size===512?source.ensureAlpha():source.removeAlpha()).png().toFile(path.join(root,file));
    const bytes=await fs.readFile(path.join(root,file));records.push({file,width:size,height:size,alpha:size===512,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  const feature=`<div class="motif" style="width:650px;height:650px;right:-300px;top:-70px;border-width:40px;opacity:.2"></div><div class="brand" style="position:absolute;left:65px;top:46px;font-size:38px"><img src="${icon}">FamCall</div><h1 data-fit style="position:absolute;left:65px;top:165px;width:760px;height:166px;font-size:72px">A little signal.<br>A familiar voice.</h1><p data-fit style="position:absolute;left:69px;top:360px;width:830px;height:75px;font-size:27px">Simple voice calls for imperfect connections.</p>`;
  await render(browser,`${base}/google-play/en-US/feature-graphic-1024x500.png`,1024,500,feature);
  const photo=await data(`${marketing}/family-call-photo.png`);
  for(const [name,w,h] of [['social-landscape-1200x630',1200,630],['social-square-1080',1080,1080],['social-portrait-1080x1350',1080,1350],['social-story-1080x1920',1080,1920]]){
    const wide=w>h, story=h===1920,photoTop=wide?115:story?620:Math.max(Math.round(h*.45),h-720),photoH=wide?400:story?720:h-photoTop, copyW=wide?620:w;
    const body=`<img src="${photo}" style="position:absolute;left:${wide?600:0}px;top:${photoTop}px;width:${wide?600:w}px;height:${photoH}px;object-fit:cover;object-position:center;border-radius:${wide?28:0}px"><div style="position:absolute;inset:0;${wide?'background:linear-gradient(90deg,'+cream+' 48%,transparent 50%)':story?'background:none':'background:linear-gradient(180deg,'+cream+' 42%,transparent 53%)'}"></div><div class="brand" style="position:absolute;left:64px;top:${wide?50:60}px;font-size:38px"><img src="${icon}">FamCall</div><h1 data-fit style="position:absolute;left:64px;top:${wide?175:174}px;width:${copyW-95}px;height:${wide?175:190}px;font-size:${wide?68:82}px">A little signal.<br>A familiar voice.</h1><p data-fit style="position:absolute;left:68px;top:${wide?390:390}px;width:${wide?490:920}px;height:110px;font-size:${wide?28:32}px">Simple voice calls, built with weak<br>and unstable internet in mind.</p>${story?'<h1 style="position:absolute;left:64px;top:1455px;font-size:82px">Meet FamCall.</h1><p style="position:absolute;left:68px;top:1580px;font-size:32px">Your people. One simple list.</p>':''}<div style="position:absolute;left:${wide?68:58}px;bottom:${wide?45:42}px;border-radius:24px;background:${wide?'transparent':cream};padding:${wide?'0':'14px 22px'};font-size:26px;font-weight:700">famcall.web.app</div>`;
    await render(browser,`${marketing}/${name}.png`,w,h,body);
  }
  // A compact preview is for review only; it is not uploaded to either store.
  const thumbs=[];
  for(const platform of ['apple/en-US/iphone-67','google-play/en-US/phone'])for(const [name]of scenes)thumbs.push(`<div><img src="${await data(`${base}/${platform}/${name}.png`)}"><p>${platform.startsWith('apple')?'iPhone':'Android'} · ${name.slice(3)}</p></div>`);
  await render(browser,`${base}/preview.png`,1800,1580,`<div class="grid">${thumbs.join('')}</div>`,'.grid{padding:25px;display:grid;grid-template-columns:repeat(6,1fr);gap:24px}.grid img{width:100%;height:690px;object-fit:contain;background:#ebece2}.grid p{font-size:20px;margin-top:12px;text-align:center}');
  const rawCaptures=[];for(const platform of ['android','ios'])for(const[name]of scenes){const file=`${base}/raw/${platform}/${name}.png`,b=await fs.readFile(path.join(root,file)),m=await sharp(b).metadata();rawCaptures.push({file,width:m.width,height:m.height,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
  const manifest={rawCaptures,version:'0.3.0',locale:'en-US',generatedOn:new Date().toISOString(),status:'Listing preparation only; no review submission or public store publication.',sourceAppCommit:'914112a72d93c23399613661379ded6d150ddb0c',captureMode:'Current release UI, isolated E2E native builds with local demo-famcall authentication/contacts/history. Fictional 202-555-01xx numbers. App screens are genuine captures; not evidence of production calling.',appleDisplayType:'APP_IPHONE_67',photography:{file:`${marketing}/family-call-photo.png`,origin:'AI-generated editorial illustration; no customer testimonial or app UI.',creativeBrief:'Two adult family members in separate warm cream, sage and forest-green homes, each holding a phone to the ear. Natural editorial photography, no text, marks, screens or identifiable location.'},assets:records};
  await fs.writeFile(path.join(root,base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Rendered ${records.length} opaque PNG assets; verified image and text bounds.`);
}finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
