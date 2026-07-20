/* Blue Collar AI — SEO & AI Search audit engine (shared module)
   Ported from the seoreview tool so CRMColumbus can audit a shop in the field.
   Exposes window.SEO = { audit, score, findingsHTML }. Browser-only (uses DOMParser/fetch). */
(function(){
'use strict';
const PROXIES = [
  { name:'self',           build:u=>`/api/proxy?url=${encodeURIComponent(u)}`, json:false },
  { name:'allorigins-raw', build:u=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, json:false },
  { name:'corsproxy',      build:u=>`https://corsproxy.io/?url=${encodeURIComponent(u)}`, json:false },
  { name:'allorigins-get', build:u=>`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json:true },
];
const TAGS = {
  'Google Analytics':['google-analytics.com','gtag(','/g/collect','_gaq'],
  'Google Tag Manager':['googletagmanager.com'],
  'Google Ads':['googleadservices.com','gtag/js?id=AW-'],
  'Meta / Facebook Pixel':['connect.facebook.net','fbq(','facebook.com/tr'],
  'Microsoft Clarity':['clarity.ms'], 'Hotjar':['hotjar.com'],
  'TikTok Pixel':['analytics.tiktok.com','ttq.'], 'LinkedIn Insight':['snap.licdn.com'],
};
const AI_BOTS = ['GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot','anthropic-ai','Claude-Web','PerplexityBot','Perplexity-User','Google-Extended','CCBot','Applebot-Extended','Amazonbot','Bytespider','Meta-ExternalAgent'];
const AISEARCH = 'AI Search & Answer Engines';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const PROJECT_FIXES = new Set(['Sufficient content','Served over HTTPS','No mixed (insecure) content','LocalBusiness structured data','Reasonable page weight','Limited render-blocking scripts','Q&A / FAQ structured data','Semantic main-content region','Review / rating schema (stars)','Mobile speed score','Desktop speed score','Largest Contentful Paint (mobile)','Layout stability (mobile CLS)']);
function isQuick(label){ return !PROJECT_FIXES.has(label); }

async function fetchHtml(targetUrl){
  let lastErr;
  for(const p of PROXIES){
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),12000);
    try{
      const res=await fetch(p.build(targetUrl),{signal:ctrl.signal});
      if(!res.ok){lastErr=new Error(p.name+' HTTP '+res.status);continue;}
      const html=p.json?(await res.json()).contents:await res.text();
      if(html&&html.length>50)return html;
      lastErr=new Error(p.name+' empty');
    }catch(e){lastErr=e;}finally{clearTimeout(t);}
  }
  throw lastErr||new Error('All proxies failed');
}
async function fetchAux(u){
  for(const p of PROXIES.slice(0,3)){
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),8000);
    try{ const res=await fetch(p.build(u),{signal:ctrl.signal}); if(res.ok){const txt=p.json?(await res.json()).contents:await res.text();clearTimeout(t);return txt||'';} }
    catch(e){}finally{clearTimeout(t);}
  }
  return null;
}
function aiCrawlerStatus(robots){
  const lines=String(robots).split(/\r?\n/); let groups=[]; let cur=null;
  for(const raw of lines){
    const line=raw.replace(/#.*/,'').trim(); if(!line)continue;
    const ua=line.match(/^user-agent:\s*(.+)$/i);
    if(ua){ if(!cur||cur.hasRules){cur={agents:[],hasRules:false,disallowAll:false};groups.push(cur);} cur.agents.push(ua[1].trim().toLowerCase()); continue; }
    const dis=line.match(/^disallow:\s*(.*)$/i);
    if(dis&&cur){ cur.hasRules=true; if(dis[1].trim()==='/') cur.disallowAll=true; }
    if(/^allow:/i.test(line)&&cur) cur.hasRules=true;
  }
  const globalBlocked = groups.some(g=>g.agents.includes('*')&&g.disallowAll);
  const blocked=[]; AI_BOTS.forEach(bot=>{ const lb=bot.toLowerCase(); if(groups.some(g=>g.agents.includes(lb)&&g.disallowAll)) blocked.push(bot); });
  return {blocked, globalBlocked};
}

async function auditOne(raw){
  let url=raw.trim(); if(!/^https?:\/\//i.test(url)) url='https://'+url;
  const o=new URL(url); const origin=o.origin;
  const html=await fetchHtml(url);
  const doc=new DOMParser().parseFromString(html,'text/html');
  const bodyText=(doc.body&&doc.body.textContent||'').trim();
  if(html.length<500||bodyText.length<30) throw {blocked:true,reason:'Empty or near-empty response — the real page could not be retrieved.'};
  const tLow=(doc.querySelector('title')&&doc.querySelector('title').textContent||'').trim().toLowerCase();
  const cTitles=['just a moment','one moment','attention required','checking your browser','please wait','verifying you are human','ddos-guard'];
  const cSigs=['challenges.cloudflare.com','cf-browser-verification','__cf_chl','cf_chl_opt','/cdn-cgi/challenge','ddos-guard','_imperva_','distil_r_captcha'];
  if(cTitles.some(t=>tLow.includes(t))||cSigs.some(s=>html.includes(s))) throw {blocked:true,reason:'Blocked by bot protection (challenge page returned, not the site).'};
  const checks=[]; const add=(cat,label,points,status,detail,why,fix)=>checks.push({cat,label,points,status,detail,why,fix});
  const titleEl=doc.querySelector('title'); const title=(titleEl&&titleEl.textContent||'').trim();
  const titleCount=doc.querySelectorAll('title').length;
  const desc=(doc.querySelector('meta[name="description"]')&&doc.querySelector('meta[name="description"]').getAttribute('content')||'').trim();
  const h1=doc.querySelectorAll('h1'); const h2=doc.querySelectorAll('h2');
  const robotsMeta=(doc.querySelector('meta[name="robots"]')&&doc.querySelector('meta[name="robots"]').getAttribute('content')||'').toLowerCase();
  const noindex=robotsMeta.includes('noindex');
  const canonical=doc.querySelector('link[rel="canonical"]');
  const viewport=doc.querySelector('meta[name="viewport"]');
  const charset=doc.querySelector('meta[charset]')||doc.querySelector('meta[http-equiv="Content-Type" i]');
  const lang=doc.documentElement.getAttribute('lang');
  const favicon=doc.querySelector('link[rel~="icon"]');
  const ogT=doc.querySelector('meta[property="og:title"]'), ogD=doc.querySelector('meta[property="og:description"]'), ogI=doc.querySelector('meta[property="og:image"]');
  const ogCount=[ogT,ogD,ogI].filter(Boolean).length;
  const twCard=doc.querySelector('meta[name="twitter:card"]');
  const imgs=[].slice.call(doc.querySelectorAll('img'));
  const withAlt=imgs.filter(i=>(i.getAttribute('alt')||'').trim()).length;
  const withDim=imgs.filter(i=>i.getAttribute('width')&&i.getAttribute('height')).length;
  const words=bodyText.split(/\s+/).filter(Boolean).length;
  const tel=doc.querySelectorAll('a[href^="tel:"]').length;
  const hasMap=/google\.com\/maps|maps\.google|goo\.gl\/maps/i.test(html);
  const ssl=url.startsWith('https');
  const mixed= ssl ? [].slice.call(doc.querySelectorAll('[src],[href]')).filter(el=>/^http:\/\//i.test(el.getAttribute('src')||el.getAttribute('href')||'')).length : 0;
  const blocking=doc.querySelectorAll('head script[src]:not([async]):not([defer])').length;
  const sizeKb=Math.round(html.length/1024);
  let schemaTypes=[];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(n=>{try{const j=JSON.parse(n.textContent);const arr=Array.isArray(j)?j:[j];arr.forEach(x=>{const t=x['@type'];if(t)schemaTypes=schemaTypes.concat(Array.isArray(t)?t:[t]);if(x['@graph'])x['@graph'].forEach(g=>{if(g['@type'])schemaTypes=schemaTypes.concat(g['@type'])})});}catch(e){}});
  if(doc.querySelector('[itemtype]')) schemaTypes.push((doc.querySelector('[itemtype]').getAttribute('itemtype')||'').split('/').pop());
  schemaTypes=[...new Set(schemaTypes.filter(Boolean))]; const schemaStr=schemaTypes.join(' ');
  const localSchema=schemaTypes.some(t=>/LocalBusiness|AutoRepair|AutomotiveBusiness|Store|Organization|ProfessionalService|HomeAndConstructionBusiness|EmergencyService/i.test(t));
  const hasFaq = /FAQPage|QAPage|Question/i.test(schemaStr) || /"@type"\s*:\s*"(FAQPage|QAPage|Question)"/i.test(html);
  const hasOrg = schemaTypes.some(t=>/Organization|LocalBusiness|AutoRepair|AutomotiveBusiness|Store|ProfessionalService|HomeAndConstructionBusiness|EmergencyService/i.test(t));
  const hasSameAs = /"sameAs"/i.test(html);
  const hasReview = /AggregateRating|"@type"\s*:\s*"Review"|"reviewRating"|"ratingValue"/i.test(html);
  const hasMain = !!(doc.querySelector('main')||doc.querySelector('article'));
  const tracking=Object.keys(TAGS).filter(name=>TAGS[name].some(s=>html.includes(s)));
  const INDEX='Indexability & Crawlability', CONTENT='On-Page Content', TECH='Technical & Mobile', LOCAL='Local SEO', SOCIAL='Social Sharing', MEDIA='Images & Accessibility', PERF='Performance Hygiene';
  add(INDEX,'Page is indexable',14, noindex?'fail':'pass', noindex?'A "noindex" directive is present':'No noindex directive','A "noindex" tag tells Google to hide this page. If present by mistake, nothing else matters.','Remove the "noindex" value from the robots meta tag.');
  add(INDEX,'Canonical URL set',6, canonical?'pass':'fail', canonical?('→ '+canonical.getAttribute('href')):'No canonical link','Tells Google which URL is the real one so ranking power is not split.','Add <link rel="canonical"> pointing to the preferred URL.');
  add(CONTENT,'Title tag present',12, title?'pass':'fail', title?('"'+title+'"'):'Missing','The title is the blue headline in Google — strongest on-page ranking + click factor.','Add a unique <title> ~50–60 chars naming the business + service + city.');
  if(title){ const tl=title.length; add(CONTENT,'Title length optimal',4,(tl>=30&&tl<=60)?'pass':'warn',tl+' characters','Under ~30 wastes space; over ~60 gets cut off.','Aim for 50–60 characters.'); if(titleCount>1) add(CONTENT,'Single title tag',2,'warn',titleCount+' title tags found','Multiple titles confuse search engines.','Keep exactly one <title>.'); }
  add(CONTENT,'Meta description present',9, desc?'pass':'fail', desc?('"'+desc.slice(0,90)+(desc.length>90?'…':'')+'"'):'Missing','The grey summary under your title — convinces people to click you over competitors.','Write a 120–155 char summary with service, location, and a reason to click.');
  if(desc) add(CONTENT,'Description length optimal',3,(desc.length>=80&&desc.length<=160)?'pass':'warn',desc.length+' characters','Too short under-sells; over ~160 gets cut.','Target 120–155 characters.');
  add(CONTENT,'Exactly one H1 heading',8, h1.length===1?'pass':'fail', h1.length+' H1 tag(s)','The H1 tells Google the page topic. None or several muddies it.', h1.length===0?'Add a single visible <h1> with your main service + city.':'Keep one <h1>, demote the rest to <h2>.');
  add(CONTENT,'Uses subheadings (H2)',3, h2.length>0?'pass':'warn',h2.length+' H2 tag(s)','Subheadings help customers skim and engines/AI understand.','Break content into sections with descriptive H2s.');
  add(CONTENT,'Sufficient content',5, words>=250?'pass':'warn',words+' words of visible text','Thin pages rarely rank.','Add useful content — services, areas served, FAQs — 300+ words.');
  add(TECH,'Served over HTTPS',9, ssl?'pass':'fail', ssl?'Secure':'Not secure','The padlock. Google ranks secure sites higher; browsers warn on insecure ones.','Install an SSL certificate and force HTTPS.');
  add(TECH,'Mobile viewport set',7, viewport?'pass':'fail', viewport?'Configured':'Missing','Without it the site looks broken on phones — and Google is mobile-first.','Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  add(TECH,'No mixed (insecure) content',4, mixed===0?'pass':'warn', mixed===0?'Clean':(mixed+' http:// resources'),'Insecure files on a secure page trigger warnings.','Update http:// links to https://.');
  add(TECH,'Character encoding declared',2, charset?'pass':'warn', charset?'Declared':'Missing','Prevents garbled characters.','Add <meta charset="UTF-8"> first in head.');
  add(TECH,'Language declared',2, lang?'pass':'warn', lang?('lang="'+lang+'"'):'Missing','Tells engines your language.','Add lang="en" to the <html> tag.');
  add(TECH,'Favicon present',1, favicon?'pass':'warn', favicon?'Present':'Missing','The browser-tab icon — small but looks established.','Add a favicon link in the head.');
  add(LOCAL,'LocalBusiness structured data',12, localSchema?'pass':'fail', schemaTypes.length?('Schema: '+schemaTypes.join(', ')):'No schema found','Powers the Google Map pack and "near me" — the biggest local win.','Add JSON-LD LocalBusiness/AutoRepair schema with name, address, phone, hours, geo.');
  add(LOCAL,'Review / rating schema (stars)',4, hasReview?'pass':'warn', hasReview?'Rating / review markup found':'No review or rating schema','Puts gold stars under your listing — boosts clicks and AI trust.','Add AggregateRating / Review JSON-LD from your real Google reviews.');
  add(LOCAL,'Click-to-call phone link',4, tel>0?'pass':'warn', tel>0?(tel+' tel: link(s)'):'None found','A tappable number turns a visitor into a call.','Wrap the phone number in <a href="tel:+1...">.');
  add(LOCAL,'Map / location reference',3, hasMap?'pass':'warn', hasMap?'Map detected':'No map embed found','A map + address proves where you serve.','Embed a Google Map and show the full address.');
  add(SOCIAL,'Open Graph tags',5, ogCount>=2?'pass':(ogCount===1?'warn':'fail'), ogCount+' of 3 core OG tags','Controls how your link looks when shared.','Add og:title, og:description, og:image.');
  add(SOCIAL,'Twitter / X card',3, twCard?'pass':'warn', twCard?'Configured':'Missing','Controls the preview on X.','Add <meta name="twitter:card" content="summary_large_image">.');
  add(MEDIA,'Images have alt text',6, !imgs.length?'warn':(withAlt/imgs.length>=0.8?'pass':(withAlt/imgs.length>=0.4?'warn':'fail')), imgs.length?(withAlt+' of '+imgs.length+' images have alt text'):'No images detected in HTML','Alt text aids accessibility and Google Images.','Add descriptive alt text to meaningful images.');
  add(MEDIA,'Images have dimensions',2, !imgs.length?'pass':(withDim/Math.max(1,imgs.length)>=0.6?'pass':'warn'), imgs.length?(withDim+' of '+imgs.length+' images set width/height'):'n/a','Sizes stop layout jump as the page loads.','Add width and height to images.');
  add(PERF,'Reasonable page weight',3, sizeKb<500?'pass':'warn', sizeKb+' KB of HTML','Heavy pages are slow, especially on phones.','Trim inline content; lazy-load below the fold.');
  add(PERF,'Limited render-blocking scripts',3, blocking<=3?'pass':'warn', blocking+' blocking script(s) in head','Blocking scripts delay the visible page.','Add async/defer to non-critical head scripts.');
  add(AISEARCH,'Q&A / FAQ structured data',5, hasFaq?'pass':'warn', hasFaq?'FAQ / Q&A schema found':'No FAQ or Q&A schema','AI answer engines pull answers from FAQ/Q&A markup.','Add an FAQ section with FAQPage JSON-LD.');
  add(AISEARCH,'Organization / entity data',4, (hasOrg&&hasSameAs)?'pass':(hasOrg?'warn':'fail'), hasOrg?(hasSameAs?'Organization schema with linked profiles':'Organization schema, no sameAs'):'No Organization schema','AI builds a profile from Organization schema + sameAs links.','Add Organization JSON-LD with name, logo, sameAs links.');
  add(AISEARCH,'Semantic main-content region',2, hasMain?'pass':'warn', hasMain?'Uses <main> / <article>':'No <main> or <article>','Helps AI crawlers find your real content.','Wrap primary content in <main> or <article>.');
  return { url, domain:o.hostname, origin, timestamp:new Date().toLocaleString(), ssl, checks, tracking, schemaTypes,
    stats:{images:imgs.length, scripts:doc.querySelectorAll('script').length, stylesheets:doc.querySelectorAll('link[rel="stylesheet"]').length, sizeKb, words} };
}
async function addAux(r){
  const INDEX='Indexability & Crawlability';
  const robots=await fetchAux(r.origin+'/robots.txt');
  if(robots===null){
    r.checks.push({cat:INDEX,label:'robots.txt present',points:0,status:'info',detail:'Could not verify',why:'',fix:''});
    r.checks.push({cat:AISEARCH,label:'AI search crawlers allowed',points:0,status:'info',detail:'Could not verify robots.txt',why:'',fix:''});
  }else{
    const ok=/user-agent|disallow|sitemap/i.test(robots)&&!/<html/i.test(robots.slice(0,200));
    r.checks.push({cat:INDEX,label:'robots.txt present',points:4,status:ok?'pass':'warn',detail:ok?'Found':'Not found / invalid',why:'Guides search engines and lists your sitemap.',fix:'Add a /robots.txt that allows crawling and lists your sitemap.'});
    let smUrl=(robots.match(/sitemap:\s*(\S+)/i)||[])[1]; let sm=null;
    if(smUrl) sm=await fetchAux(smUrl); if(!sm) sm=await fetchAux(r.origin+'/sitemap.xml');
    const smOk= sm!==null && /<urlset|<sitemapindex/i.test(sm);
    r.checks.push({cat:INDEX,label:'XML sitemap present',points:5,status: sm===null?'info':(smOk?'pass':'warn'),detail: sm===null?'Could not verify':(smOk?'Found':'Not found'),why:'A sitemap helps Google find all your pages.',fix:'Generate /sitemap.xml and reference it in robots.txt.'});
    const ai=aiCrawlerStatus(robots); let st,det;
    if(ai.globalBlocked){ st='fail'; det='robots.txt blocks all crawlers (Disallow: /)'; }
    else if(ai.blocked.length){ st='warn'; det='Blocking: '+ai.blocked.join(', '); }
    else { st='pass'; det='No AI crawlers blocked'; }
    r.checks.push({cat:AISEARCH,label:'AI search crawlers allowed',points:5,status:st,detail:det,why:'If robots.txt blocks GPTBot/ClaudeBot/PerplexityBot/Google-Extended, AI tools cannot read or recommend you.',fix:'Avoid disallowing AI crawlers in robots.txt.'});
  }
  const llms=await fetchAux(r.origin+'/llms.txt');
  const llmsOk = llms!==null && llms.length>20 && !/<html/i.test(llms.slice(0,200));
  r.checks.push({cat:AISEARCH,label:'llms.txt AI guide file',points:3,status: llms===null?'info':(llmsOk?'pass':'warn'),detail: llms===null?'Could not verify':(llmsOk?'Found':'Not found'),why:'llms.txt tells AI assistants what your site offers and which pages matter.',fix:'Add a /llms.txt summarizing your business and key pages.'});
}
async function fetchPSI(url, strategy, key){
  let api=`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
  if(key) api+=`&key=${encodeURIComponent(key)}`;
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),60000);
  try{
    const res=await fetch(api,{signal:ctrl.signal}); if(!res.ok) return {error:'HTTP '+res.status};
    const j=await res.json(); const lh=j.lighthouseResult; if(!lh) return {error:'no data'};
    const a=lh.audits||{}; const perf=lh.categories&&lh.categories.performance?lh.categories.performance.score:null;
    return { score: perf==null?null:Math.round(perf*100),
      lcp:a['largest-contentful-paint']?a['largest-contentful-paint'].numericValue:null, lcpTxt:a['largest-contentful-paint']?a['largest-contentful-paint'].displayValue:null,
      cls:a['cumulative-layout-shift']?a['cumulative-layout-shift'].numericValue:null, clsTxt:a['cumulative-layout-shift']?a['cumulative-layout-shift'].displayValue:null,
      field:j.loadingExperience&&j.loadingExperience.overall_category?j.loadingExperience.overall_category:null };
  }catch(e){ return {error:e.name==='AbortError'?'timeout':'fetch failed'}; } finally{ clearTimeout(t); }
}
async function addSpeed(r, key){
  const SPEED='Page Speed & Core Web Vitals';
  const [m,d]=await Promise.all([fetchPSI(r.url,'mobile',key), fetchPSI(r.url,'desktop',key)]);
  r.speed={mobile:m, desktop:d};
  const st=s=> s==null?'info' : s>=90?'pass' : s>=50?'warn':'fail';
  if(m.error){ r.checks.push({cat:SPEED,label:'Mobile speed score',points:0,status:'info',detail:'Could not measure ('+m.error+')',why:'',fix:''}); }
  else{
    r.checks.push({cat:SPEED,label:'Mobile speed score',points:6,status:st(m.score),detail:(m.score!=null?m.score+'/100':'n/a')+(m.field?' · real users: '+m.field.toLowerCase().replace('_',' '):''),why:'Google is mobile-first and most local searches are on phones. A slow mobile site loses customers and rank.',fix:'Compress/lazy-load images, enable caching/CDN, defer non-critical scripts.'});
    if(m.lcp!=null){ const s=m.lcp<=2500?'pass':m.lcp<=4000?'warn':'fail'; r.checks.push({cat:SPEED,label:'Largest Contentful Paint (mobile)',points:4,status:s,detail:(m.lcpTxt||Math.round(m.lcp)+' ms')+' (good ≤ 2.5s)',why:'LCP is time to main content. Over 2.5s feels slow and hurts conversions + rank.',fix:'Optimize the hero image, use WebP/AVIF, remove render-blocking CSS/JS.'}); }
    if(m.cls!=null){ const s=m.cls<=0.1?'pass':m.cls<=0.25?'warn':'fail'; r.checks.push({cat:SPEED,label:'Layout stability (mobile CLS)',points:2,status:s,detail:(m.clsTxt!=null?String(m.clsTxt):String(m.cls))+' (good ≤ 0.1)',why:'CLS measures page jump while loading. Jumpy pages are penalized.',fix:'Set width/height on images; reserve space for ads/embeds.'}); }
  }
  if(d.error){ r.checks.push({cat:SPEED,label:'Desktop speed score',points:0,status:'info',detail:'Could not measure ('+d.error+')',why:'',fix:''}); }
  else{ r.checks.push({cat:SPEED,label:'Desktop speed score',points:3,status:st(d.score),detail:(d.score!=null?d.score+'/100':'n/a'),why:'Desktop speed matters for at-home/office research.',fix:'Same wins as mobile.'}); }
}
function score(r){
  if(!r||r.error) return {score:null,grade:'—',color:'#94a3b8',counts:{pass:0,warn:0,fail:0},byCat:{},scored:0};
  let earned=0,total=0,scored=0; const counts={pass:0,warn:0,fail:0}; const byCat={};
  r.checks.forEach(c=>{
    if(c.status==='pass')counts.pass++; else if(c.status==='warn')counts.warn++; else if(c.status==='fail')counts.fail++;
    if(c.status==='info'||!c.points) return; scored++;
    const w= c.status==='pass'?1: c.status==='warn'?0.5:0; earned+=c.points*w; total+=c.points;
    if(!byCat[c.cat])byCat[c.cat]={e:0,t:0}; byCat[c.cat].e+=c.points*w; byCat[c.cat].t+=c.points;
  });
  const s= total? Math.round(100*earned/total):0;
  let grade,color;
  if(s>=90){grade='A';color='#16a34a';} else if(s>=80){grade='B';color='#65a30d';} else if(s>=70){grade='C';color='#f59e0b';} else if(s>=55){grade='D';color='#f97316';} else {grade='F';color='#dc2626';}
  return {score:s,grade,color,counts,byCat,scored};
}
function findingsHTML(r){
  if(!r||r.error) return '<p style="color:#dc2626">Audit unavailable.</p>';
  const sc=score(r);
  const issues=r.checks.filter(c=>c.status==='fail'||c.status==='warn').sort((a,b)=>(a.status===b.status?b.points-a.points:(a.status==='fail'?-1:1)));
  const col=sc.score>=91?'#16a34a':sc.score>=80?'#ea580c':'#dc2626';
  const rows=issues.map(c=>`<li style="margin:6px 0"><b style="color:${c.status==='fail'?'#b91c1c':'#b45309'}">${esc(c.label)}</b>${c.fix?`<br><span style="opacity:.8">${esc(c.fix)}</span>`:''}</li>`).join('');
  return `<div>
    <div style="font-size:20px;font-weight:800;color:${col}">Grade ${sc.grade} · ${sc.score}/100</div>
    <div style="opacity:.8;font-size:13px;margin:2px 0 8px">${sc.counts.fail} critical · ${sc.counts.warn} to improve · ${sc.counts.pass} passing</div>
    ${issues.length?`<ul style="margin:0;padding-left:18px;font-size:13px">${rows}</ul>`:'<div style="color:#16a34a">No major issues found.</div>'}
  </div>`;
}
async function audit(url, opts){
  opts=opts||{};
  const r=await auditOne(url);
  try{ await addAux(r); }catch(e){}
  if(opts.speed!==false){ try{ await addSpeed(r, opts.psiKey||''); }catch(e){} }
  return r;
}
window.SEO = { audit, score, findingsHTML };
})();
