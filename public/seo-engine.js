/* Blue Collar AI — SEO & AI Search audit engine (shared module)
   Ported from the seoreview tool so CRMColumbus can audit a shop in the field.
   Exposes window.SEO = { audit, score, findingsHTML }. Browser-only (uses DOMParser/fetch). */
(function(){
'use strict';
const BRAND={ name:'Blue Collar AI, Inc.', tagline:'AI-Powered Local SEO', web:'www.bluecollarai.online', reportPrice:'$49',
  sites:['www.bluecollarai.online','www.ustowalliance.com','www.usautoalliance.com'],
  contacts:[{name:'Chris',phone:'614-633-7935',tel:'+16146337935',email:'chris@bluecollarai.online'},{name:'Dustin',phone:'614-206-3606',tel:'+16142063606',email:'dustin@bluecollarai.online'}] };
function aiExplainerHTML(){
  return '<h3 style="margin:24px 0 8px;font-size:15px">Why AI Search Matters</h3>'
    +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;line-height:1.6;color:#334155">'
    +'<p style="margin:0 0 10px"><b>What it is.</b> AI search tools — ChatGPT, Google\'s AI Overviews, Perplexity, Microsoft Copilot, and Gemini — answer a question in plain language instead of handing back a page of links. You ask, and the AI writes a direct answer, often recommending just one or two businesses by name.</p>'
    +'<div style="display:flex;gap:12px;flex-wrap:wrap;margin:0 0 10px">'
      +'<div style="flex:1;min-width:210px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px"><div style="font-weight:800;margin-bottom:4px">Traditional search — Google &amp; Bing</div>Hands you ~10 links to click through. The site ranking #1 wins the visit — mostly about keywords and backlinks.</div>'
      +'<div style="flex:1;min-width:210px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px"><div style="font-weight:800;margin-bottom:4px">AI search — ChatGPT, AI Overviews, Perplexity…</div>Gives one written answer and names only a few sources — the customer often never clicks a site. The goal isn\'t ranking #1; it\'s being the business the AI recommends, based on clear content, structured data, and reviews.</div>'
    +'</div>'
    +'<p style="margin:0 0 10px"><b>Who\'s using it.</b> The fastest-adopted consumer technology in history — hundreds of millions use these tools every week. Highest among ages 18–44, who ask AI for recommendations before they ever open Google, and growing fast across every age group.</p>'
    +'<p style="margin:0"><b>Why it matters for you.</b> People now research local services through AI the way they used to Google them — "best-reviewed shop near me," "who can tow my car tonight." If the AI can\'t read and understand your site, your business isn\'t part of that conversation. The AI-search items in this report are what put you there.</p>'
  +'</div>';
}
function ctaBlockHTML(){
  var contacts=BRAND.contacts.map(function(c){return '<div style="font-size:14px;color:#cbd5e1;line-height:1.9"><b style="color:#fff">'+esc(c.name)+'</b> · <a href="tel:'+esc(c.tel||c.phone)+'" style="color:#93c5fd;text-decoration:none">'+esc(c.phone)+'</a> · <a href="mailto:'+esc(c.email)+'" style="color:#93c5fd;text-decoration:none">'+esc(c.email)+'</a></div>';}).join('');
  var sites=(BRAND.sites||[BRAND.web]).map(function(s){return '<a href="https://'+esc(s)+'" style="color:#93c5fd;text-decoration:none">'+esc(s)+'</a>';}).join(' &nbsp;·&nbsp; ');
  return '<div style="background:#0f172a;color:#fff;border-radius:10px;padding:20px 22px;margin-top:22px">'
    +'<div style="font-size:17px;font-weight:800;margin-bottom:6px">Ready to fix this?</div>'
    +'<p style="margin:0 0 12px;color:#e2e8f0;font-size:14px;line-height:1.6">Everything in this report is fixable — most of it faster than you\'d think. <b>'+esc(BRAND.name)+'</b> turns audits like this into more calls and higher rankings in Google <i>and</i> the new AI search tools — including the AI-search items most agencies aren\'t even checking yet.</p>'
    +'<div style="font-weight:800;margin-bottom:4px">'+esc(BRAND.name)+'</div>'+contacts
    +'<div style="margin-top:8px;font-size:13px">'+sites+'</div>'
  +'</div>';
}
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

async function auditOne(raw, prefetchedHtml){
  let url=raw.trim(); if(!/^https?:\/\//i.test(url)) url='https://'+url;
  const o=new URL(url); const origin=o.origin;
  // prefetchedHtml lets a caller supply already-rendered HTML (headless-browser seam) instead of a raw fetch.
  const _t0=Date.now();
  const html=(prefetchedHtml!=null)?prefetchedHtml:await fetchHtml(url);
  const loadMs=(prefetchedHtml!=null)?null:(Date.now()-_t0); // server response time (measured during fetch)
  const doc=new DOMParser().parseFromString(html,'text/html');
  const bodyText=(doc.body&&doc.body.textContent||'').trim();
  // JS-rendered shell detection: a page with scripts / SPA markers but almost no readable text is NOT a failed
  // fetch — it's client-side-rendered content that crawlers & AI answer engines can't see. Flag it, don't fail.
  const _scriptCount=doc.querySelectorAll('script').length;
  const _hasBundle=/<script[^>]+\bsrc=/i.test(html);
  const _spaRoot=/id=["'](root|app|__next|__nuxt|__gatsby|q-app|svelte)["']|data-reactroot|__NEXT_DATA__|window\.__NUXT__|ng-version|data-server-rendered/i.test(html);
  const jsShell = bodyText.length<200 && html.length>=500 && (_hasBundle||_spaRoot||_scriptCount>=2);
  if((html.length<500||bodyText.length<30) && !jsShell) throw {blocked:true,reason:'Empty or near-empty response — the real page could not be retrieved.'};
  const tLow=(doc.querySelector('title')&&doc.querySelector('title').textContent||'').trim().toLowerCase();
  const cTitles=['just a moment','one moment','attention required','checking your browser','please wait','verifying you are human','ddos-guard'];
  // Strong interstitial markers only. NOTE: Cloudflare injects "/cdn-cgi/challenge-platform/" into NORMAL fully-served 200 pages,
  // so that substring must NOT be treated as a block. Gate these markers behind an interstitial-sized body so a real page
  // that merely embeds a Turnstile widget (large content) isn't wrongly flagged.
  const cSigs=['cf-browser-verification','__cf_chl','cf_chl_opt','_imperva_','distil_r_captcha','challenges.cloudflare.com/turnstile'];
  const interstitial = bodyText.length < 1500; // genuine challenge pages are tiny; a fully rendered site is not
  if(cTitles.some(t=>tLow.includes(t)) || (interstitial && cSigs.some(s=>html.includes(s)))) throw {blocked:true,reason:'Blocked by bot protection (challenge page returned, not the site).'};
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
  add(AISEARCH,'Content readable without JavaScript',6, jsShell?'fail':'pass', jsShell?('Only ~'+bodyText.length+' characters of text in the raw HTML — this page is JavaScript-rendered'):(words+' words of readable text in the raw HTML'),'Google can render JavaScript, but AI answer engines (ChatGPT, Perplexity, Google AI Overviews) and many crawlers do NOT. If your content only appears after JavaScript runs, they see a near-empty page and cannot read or recommend you.','Serve your main content, headings and business info in the initial HTML via server-side rendering (SSR), static generation, or prerendering.');
  return { url, domain:o.hostname, origin, timestamp:new Date().toLocaleString(), ssl, checks, tracking, schemaTypes,
    title, h1text:(h1[0]&&h1[0].textContent||'').trim(), desc, words, jsShell, loadMs,
    bodySig:bodyText.slice(0,600).replace(/\s+/g,' ').toLowerCase().trim(),
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
  const verdict = s>=90?'Strong SEO foundation with only minor polish needed.' : s>=80?'Solid, but a handful of fixes would meaningfully improve visibility.' : s>=70?'Several important gaps are holding this site back in search.' : s>=55?'Significant SEO problems are limiting how often this site is found.' : 'Major SEO issues — the site is likely losing substantial search traffic.';
  return {score:s,grade,color,counts,byCat,verdict,scored};
}
function reportHTML(r){
  if(!r||r.error) return '<p style="color:#dc2626">Report unavailable.</p>';
  const sc=score(r); const col=sc.color;
  const issues=r.checks.filter(c=>c.status==='fail'||c.status==='warn').sort((a,b)=>a.status===b.status?b.points-a.points:(a.status==='fail'?-1:1));
  const quick=issues.filter(c=>isQuick(c.label)), proj=issues.filter(c=>!isQuick(c.label));
  const passes=r.checks.filter(c=>c.status==='pass');
  const cats=Object.keys(sc.byCat);
  const F="font-family:'Inter',system-ui,Arial,sans-serif;color:#0f172a";
  const card=c=>{const scol=c.status==='fail'?'#dc2626':'#f59e0b';return '<div style="border:1px solid #e2e8f0;border-left:5px solid '+scol+';border-radius:6px;padding:12px 14px;margin:0 0 10px"><div style="font-weight:800">'+esc(c.label)+'</div>'+(c.detail?'<div style="font-size:13px;color:#475569;margin-top:3px"><b>Now:</b> '+esc(c.detail)+'</div>':'')+(c.why?'<div style="font-size:13px;color:#475569;margin-top:3px"><b>Why:</b> '+esc(c.why)+'</div>':'')+(c.fix?'<div style="font-size:13px;margin-top:3px"><b>Fix:</b> '+esc(c.fix)+'</div>':'')+'</div>';};
  let speed='';
  if(r.speed&&((r.speed.mobile&&!r.speed.mobile.error)||(r.speed.desktop&&!r.speed.desktop.error))){
    const m=r.speed.mobile,d=r.speed.desktop;
    const chip=(l,s)=>{ if(!s||s.error||s.score==null)return ''; const c=s.score>=90?'#16a34a':s.score>=50?'#ea580c':'#dc2626'; return '<span style="display:inline-block;margin-right:20px"><b style="font-size:26px;color:'+c+'">'+s.score+'</b><span style="color:#64748b">/100 '+l+'</span></span>'; };
    speed='<h3 style="margin:22px 0 8px;font-size:15px">Page Speed — live Google data</h3><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px">'+chip('Mobile',m)+chip('Desktop',d)+'<div style="color:#7f1d1d;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px;margin-top:10px;font-size:13px">Slow pages bounce customers to competitors and rank lower in Google.</div></div>';
  }
  return '<div style="'+F+';max-width:760px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:18px">'
      +'<div><div style="font-size:20px;font-weight:800;color:#0f172a">'+esc(BRAND.name)+'</div><div style="color:#64748b;font-size:13px">'+esc(BRAND.tagline)+'</div></div>'
      +'<div style="text-align:right;font-size:12px;color:#64748b">SEO &amp; AI Search Audit<br>'+esc(r.domain)+' · '+esc(r.timestamp||'')+'</div>'
    +'</div>'
    +'<div style="border:2px solid '+col+';border-radius:10px;padding:18px 20px;margin-bottom:16px">'
      +'<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Executive summary — '+esc(r.domain)+'</div>'
      +'<div style="font-size:30px;font-weight:800;color:'+col+'">'+sc.score+'/100 · Grade '+sc.grade+'</div>'
      +'<div style="font-size:14px;color:#334155;margin-top:4px">'+esc(sc.verdict||'')+'</div>'
      +'<div style="font-size:13px;margin-top:6px"><b style="color:#16a34a">'+sc.counts.pass+'</b> passing · <b style="color:#b45309">'+sc.counts.warn+'</b> to improve · <b style="color:#b91c1c">'+sc.counts.fail+'</b> critical</div>'
    +'</div>'+speed
    +'<h3 style="margin:22px 0 8px;font-size:15px">Category breakdown</h3>'
    +cats.map(cat=>{const p=Math.round(100*sc.byCat[cat].e/sc.byCat[cat].t);const c=p>=80?'#16a34a':p>=60?'#f59e0b':'#dc2626';return '<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font-size:13px"><span style="flex:0 0 180px;color:#475569">'+esc(cat)+'</span><span style="flex:1;height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden"><span style="display:block;height:100%;width:'+p+'%;background:'+c+'"></span></span><span style="flex:0 0 40px;text-align:right;font-weight:700;color:'+c+'">'+p+'%</span></div>';}).join('')
    +(quick.length?'<h3 style="margin:22px 0 8px;font-size:15px">Quick wins</h3>'+quick.map(card).join(''):'')
    +(proj.length?'<h3 style="margin:22px 0 8px;font-size:15px">Bigger projects</h3>'+proj.map(card).join(''):'')
    +'<h3 style="margin:22px 0 8px;font-size:15px">What\'s working ('+passes.length+')</h3><div style="font-size:13px;color:#334155;line-height:1.7">'+passes.map(c=>'✓ '+esc(c.label)).join('<br>')+'</div>'
    +aiExplainerHTML()
    +ctaBlockHTML()
  +'</div>';
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
// Solicitation email = the REPORT SNAPSHOT (executive summary + live page speed + category breakdown)
// with sales verbiage. Deliberately NO issue list and NO fixes — the category bars show weak areas;
// the exact step-by-step fixes are the paid deliverable.
function emailHTML(clientName,r,opts){
  opts=opts||{};
  const sc=score(r); const col=sc.color; const cats=Object.keys(sc.byCat);
  const contacts=BRAND.contacts.map(c=>esc(c.name)+' · '+esc(c.phone)+' · '+esc(c.email)).join('<br>');
  const F="font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a";
  // Live Page Speed — big number(s) + loss callout (only if we measured it)
  let speed='';
  if(r.speed&&((r.speed.mobile&&!r.speed.mobile.error&&r.speed.mobile.score!=null)||(r.speed.desktop&&!r.speed.desktop.error&&r.speed.desktop.score!=null))){
    const chip=(l,s)=>{ if(!s||s.error||s.score==null)return ''; const c=s.score>=90?'#16a34a':s.score>=50?'#ea580c':'#dc2626'; return '<span style="display:inline-block;margin-right:22px"><b style="font-size:28px;color:'+c+'">'+s.score+'</b><span style="color:#64748b">/100 '+l+'</span></span>'; };
    speed='<h3 style="margin:22px 0 8px;font-size:15px">Page Speed — live Google data</h3>'
      +'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px">'+chip('Mobile',r.speed.mobile)+chip('Desktop',r.speed.desktop)
      +'<div style="color:#7f1d1d;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px;margin-top:10px;font-size:13px">Slow pages bounce customers to competitors and rank lower in Google.</div></div>';
  }
  // Category breakdown — table-based bars (robust across email clients)
  const catRows=cats.map(cat=>{
    const p=Math.round(100*sc.byCat[cat].e/sc.byCat[cat].t); const c=p>=80?'#16a34a':p>=60?'#f59e0b':'#dc2626';
    return '<tr>'
      +'<td style="color:#475569;padding:4px 10px 4px 0;font-size:13px;white-space:nowrap;vertical-align:middle">'+esc(cat)+'</td>'
      +'<td style="padding:4px 0;vertical-align:middle;width:100%"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background:#e2e8f0;border-radius:999px"><tr>'
        +'<td style="height:10px;background:'+c+';border-radius:999px;font-size:0;line-height:0;width:'+p+'%">&nbsp;</td>'+(p<100?'<td style="font-size:0;line-height:0">&nbsp;</td>':'')
      +'</tr></table></td>'
      +'<td style="text-align:right;font-weight:700;color:'+c+';padding:4px 0 4px 10px;font-size:13px;white-space:nowrap;vertical-align:middle">'+p+'%</td>'
    +'</tr>';
  }).join('');
  const breakdown='<h3 style="margin:22px 0 8px;font-size:15px">Category breakdown</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">'+catRows+'</table>';
  const buyBtn=opts.buyUrl?'<div style="margin-top:12px"><a href="'+opts.buyUrl+'" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:6px">Get the full report — $'+((BRAND.reportPrice||'$49').replace(/[^0-9]/g,'')||'49')+' (DIY)</a></div>':'';
  return '<div style="'+F+';max-width:640px;margin:0 auto;padding:8px">'
    +'<div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px"><div style="font-size:22px;font-weight:800">SEO &amp; AI Search Audit</div><div style="color:#64748b;font-size:13px">'+esc(BRAND.name)+' · '+esc(BRAND.tagline)+'</div></div>'
    +(clientName?'<p style="font-size:15px">Hi '+esc(clientName)+',</p>':'')
    +'<p style="font-size:15px;line-height:1.6">We audited your website across Google SEO and AI search (ChatGPT, Google AI Overviews, Perplexity) — where customers now decide who to call. Here is where you stand and what it is costing you.</p>'
    // Executive summary card (outlined in grade color)
    +'<div style="border:2px solid '+col+';border-radius:10px;padding:18px 20px;margin:0 0 16px">'
      +'<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Executive summary — '+esc(r.domain)+'</div>'
      +'<div style="font-size:30px;font-weight:800;color:'+col+';margin-top:2px">'+sc.score+'/100 · Grade '+sc.grade+'</div>'
      +'<div style="font-size:14px;color:#334155;margin-top:4px">'+esc(sc.verdict||'')+'</div>'
      +'<div style="font-size:13px;margin-top:6px"><b style="color:#16a34a">'+sc.counts.pass+'</b> passing · <b style="color:#b45309">'+sc.counts.warn+'</b> to improve · <b style="color:#b91c1c">'+sc.counts.fail+'</b> critical</div>'
    +'</div>'
    +speed
    +breakdown
    // Sales CTA
    +'<div style="background:#0f172a;color:#fff;border-radius:10px;padding:22px 24px;margin:20px 0 16px"><div style="font-size:19px;font-weight:800;margin-bottom:8px">Let us turn this into more calls — this week.</div>'
      +'<p style="margin:0 0 14px;color:#e2e8f0;font-size:14px;line-height:1.6">Your weakest areas above are quietly sending customers to competitors. '+esc(BRAND.name)+' handles the Google SEO and the AI-search work most agencies are not doing yet — so you show up first and win the call. Every one of these is fixable, usually faster than you think.</p>'
      +'<div style="margin-bottom:6px">Reply or call for a <b>free 15-minute walkthrough</b> and we will show you the plan.</div>'+buyBtn
      +'<div style="margin-top:14px;font-size:14px;color:#cbd5e1;line-height:1.7">'+contacts+'</div></div>'
    +'<p style="color:#94a3b8;font-size:12px">'+esc(BRAND.name)+' · '+esc(BRAND.web)+'</p></div>';
}
function emailText(clientName,r){
  const sc=score(r); let t=(clientName?('Hi '+clientName+',\n\n'):'Hi,\n\n');
  t+='We audited your website across Google SEO and AI search (ChatGPT, Google AI Overviews, Perplexity) — where customers now decide who to call.\n\n';
  t+='EXECUTIVE SUMMARY — '+r.domain+'\n'+sc.score+'/100 · Grade '+sc.grade+'\n'+(sc.verdict||'')+'\n'+sc.counts.pass+' passing · '+sc.counts.warn+' to improve · '+sc.counts.fail+' critical\n\n';
  if(r.speed){ const m=r.speed.mobile,d=r.speed.desktop; const parts=[]; if(m&&!m.error&&m.score!=null)parts.push(m.score+'/100 Mobile'); if(d&&!d.error&&d.score!=null)parts.push(d.score+'/100 Desktop'); if(parts.length)t+='Page Speed (live Google data): '+parts.join(' · ')+'\nSlow pages bounce customers to competitors and rank lower in Google.\n\n'; }
  const cats=Object.keys(sc.byCat);
  if(cats.length){ t+='Category breakdown:\n'; cats.forEach(cat=>{ const p=Math.round(100*sc.byCat[cat].e/sc.byCat[cat].t); t+='  '+cat+': '+p+'%\n'; }); t+='\n'; }
  t+='Your weakest areas above are sending customers to competitors — every one is fixable. Reply or call for a free 15-minute walkthrough and we will show you the plan.\n\n'+BRAND.contacts.map(c=>c.name+' · '+c.phone+' · '+c.email).join('\n')+'\n'+BRAND.web+'\n';
  return t;
}
async function audit(url, opts){
  opts=opts||{};
  const r=await auditOne(url);
  try{ await addAux(r); }catch(e){}
  if(opts.speed!==false){ try{ await addSpeed(r, opts.psiKey||''); }catch(e){} }
  return r;
}
// Side-by-side comparison of many businesses (ranked leaderboard from stored audits).
// items: [{ name, report }]. Ranks best-to-worst; color-codes score, speed and each category.
function comparisonHTML(items){
  const F="font-family:'Inter',system-ui,Arial,sans-serif;color:#0f172a";
  const rows=(items||[]).filter(x=>x&&x.report).map(x=>{
    const sc=score(x.report); const sp=x.report.speed||{};
    const mob=(sp.mobile&&!sp.mobile.error&&sp.mobile.score!=null)?sp.mobile.score:null;
    return { name:x.name||x.report.domain, domain:x.report.domain, sc:sc, mobile:mob };
  });
  if(!rows.length) return '<p style="'+F+'">Select two or more audited companies to compare. (Companies without a saved audit can\'t be ranked yet — run their audit first.)</p>';
  rows.sort((a,b)=>(b.sc.score||0)-(a.sc.score||0));
  const catSet={}; rows.forEach(r=>Object.keys(r.sc.byCat).forEach(c=>catSet[c]=1)); const cats=Object.keys(catSet);
  const gcol=s=> s>=90?'#16a34a':s>=80?'#65a30d':s>=70?'#f59e0b':s>=55?'#f97316':'#dc2626';
  const pcol=p=> p>=80?'#16a34a':p>=60?'#f59e0b':'#dc2626';
  const medal=i=> i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'.';
  const CATSHORT={'Indexability & Crawlability':'Index','On-Page Content':'On-Page','Technical & Mobile':'Technical','Local SEO':'Local SEO','Social Sharing':'Social','Images & Accessibility':'Images','Performance Hygiene':'Perf.','AI Search & Answer Engines':'AI Search','Page Speed & Core Web Vitals':'Speed'};
  const th=t=>'<th style="text-align:left;padding:8px 10px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e2e8f0;white-space:nowrap">'+esc(t)+'</th>';
  const thc=(c)=>'<th title="'+esc(c)+'" style="text-align:left;padding:8px 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.03em;border-bottom:2px solid #e2e8f0">'+esc(CATSHORT[c]||c)+'</th>';
  const head='<tr>'+th('#')+th('Company')+th('Grade')+th('Score')+th('Mobile')+cats.map(thc).join('')+'</tr>';
  const body=rows.map((r,i)=>{
    const cells=cats.map(c=>{ const b=r.sc.byCat[c]; if(!b||!b.t) return '<td style="padding:8px 10px;color:#94a3b8">—</td>'; const p=Math.round(100*b.e/b.t); return '<td style="padding:8px 10px;font-weight:700;color:'+pcol(p)+'">'+p+'%</td>'; }).join('');
    const mob=r.mobile==null?'<td style="padding:8px 10px;color:#94a3b8">—</td>':'<td style="padding:8px 10px;font-weight:700;color:'+gcol(r.mobile)+'">'+r.mobile+'</td>';
    return '<tr style="border-bottom:1px solid #eef2f7;'+(i===0?'background:#f0fdf4':'')+'">'
      +'<td style="padding:8px 10px;font-weight:800">'+medal(i)+'</td>'
      +'<td style="padding:8px 10px;font-weight:700;white-space:nowrap">'+esc(r.name)+'<div style="font-size:11px;color:#94a3b8;font-weight:400">'+esc(r.domain)+'</div></td>'
      +'<td style="padding:8px 10px;font-weight:800;color:'+gcol(r.sc.score)+'">'+r.sc.grade+'</td>'
      +'<td style="padding:8px 10px;font-weight:800;color:'+gcol(r.sc.score)+'">'+r.sc.score+'</td>'
      +mob+cells+'</tr>';
  }).join('');
  return '<div style="'+F+'">'
    +'<div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px"><div style="font-size:20px;font-weight:800">SEO &amp; AI Search — Side-by-Side</div><div style="color:#64748b;font-size:13px">'+esc(BRAND.name)+' · '+rows.length+' businesses ranked</div></div>'
    +'<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:13px">'+head+body+'</table></div>'
    +'<div style="font-size:12px;color:#64748b;margin-top:10px">Ranked best to worst by overall score. Green ≥80% · amber 60–79% · red under 60%. The lowest-ranked businesses are your strongest sales prospects.</div>'
  +'</div>';
}
// ---------- Whole-site crawl (SEO Analyzer v2, Phase 1) ----------
// Discover every page (sitemap first, else link-crawl the homepage), capped and reported honestly.
async function discoverPages(root, max, render){
  max=max||150; let base;
  try{ base=new URL(/^https?:\/\//i.test(root)?root:'https://'+root).origin; }catch(e){ return {base:root,urls:[],total:0,capped:false,via:'error'}; }
  const grab=async(u)=>{ try{ return (await fetchAux(u))||''; }catch(e){ return ''; } };
  const locRe=/<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  const linksIn=(html)=>[...new Set([...String(html).matchAll(/href=["']([^"'#]+)["']/gi)].map(m=>m[1])
      .map(h=>{ try{ return new URL(h, base+'/').href.split('#')[0]; }catch(e){ return null; } })
      .filter(u=>u && u.indexOf(base)===0 && !/\.(png|jpe?g|gif|svg|css|js|pdf|zip|ico|webp|mp4|woff2?)(\?|$)/i.test(u)))];
  // Find sitemap(s): robots.txt "Sitemap:" directives first, then /sitemap.xml — each with one retry (flaky origins).
  const grab1=async(u)=>{ let x=await grab(u); if(!x) x=await grab(u); return x; };
  let smList=[];
  const robotsTxt=await grab(base+'/robots.txt');
  [...String(robotsTxt).matchAll(/sitemap:\s*(\S+)/gi)].forEach(m=>{ const s=m[1].trim(); if(/^https?:\/\//i.test(s)) smList.push(s); });
  smList.push(base+'/sitemap.xml'); smList=[...new Set(smList)].slice(0,8);
  let locs=[]; let via='sitemap';
  for(const sm of smList){
    const xml=await grab1(sm); const l=[...String(xml).matchAll(locRe)].map(m=>m[1]);
    const kids=l.filter(u=>/\.xml(\?|$)/i.test(u));
    if(kids.length && kids.length>=l.length-1){ for(const c of kids.slice(0,20)){ const cx=await grab1(c); locs=locs.concat([...String(cx).matchAll(locRe)].map(m=>m[1])); if(locs.length>max*3)break; } }
    else locs=locs.concat(l);
    if(locs.length) break;
  }
  let urls=[...new Set(locs.filter(u=>/^https?:\/\//i.test(u) && !/\.xml(\?|$)/i.test(u)))];
  if(!urls.length){ // fallback: internal links off the homepage (raw HTML)
    via='link-crawl'; let home=await grab(base+'/'); urls=linksIn(home);
    // JS-only nav yields ~no links in raw HTML — if a renderer is available, render the homepage to get the real nav.
    if(urls.length<3 && render){ try{ const rh=await render(base+'/'); if(rh){ const rlinks=linksIn(rh); if(rlinks.length>urls.length){ urls=rlinks; via='link-crawl (rendered)'; } } }catch(e){} }
    urls.unshift(base+'/'); urls=[...new Set(urls)];
  }
  urls=[...new Set(urls.map(u=>u.split('#')[0]).filter(Boolean))];
  return { base, urls:urls.slice(0,max), total:urls.length, capped:urls.length>max, via };
}
function crossPageIssues(pages){
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const group=(key)=>{ const m={}; pages.forEach(p=>{ const k=norm(p[key]); if(k)(m[k]=m[k]||[]).push(p.url); }); return Object.keys(m).filter(k=>m[k].length>1).map(k=>({value:k.slice(0,80),urls:m[k]})); };
  const bodyGroups=(()=>{ const m={}; pages.forEach(p=>{ const k=p.bodySig; if(k)(m[k]=m[k]||[]).push(p.url); }); return Object.keys(m).filter(k=>m[k].length>1).map(k=>({sample:k.slice(0,80),urls:m[k]})); })();
  const stop=['home','page','service','services','ohio','near','the','and','for','with','your'];
  const mismatch=pages.filter(p=>{ if(!p.title||!p.bodySig)return false; const ws=norm(p.title).split(/[^a-z0-9]+/).filter(w=>w.length>=4&&stop.indexOf(w)<0); if(!ws.length)return false; return ws.filter(w=>p.bodySig.indexOf(w)>=0).length/ws.length < 0.34; }).map(p=>p.url);
  return {
    duplicateTitles:group('title'), duplicateH1:group('h1text'), duplicateBodies:bodyGroups,
    titleBodyMismatch:mismatch,
    thin:pages.filter(p=>p.words!=null&&p.words<250).map(p=>({url:p.url,words:p.words})),
    jsRendered:pages.filter(p=>p.jsShell).map(p=>p.url),
    missingH1:pages.filter(p=>!p.h1text).map(p=>p.url)
  };
}
async function crawlSite(root, opts){
  opts=opts||{}; const max=opts.max||150, conc=opts.concurrency||5, onProgress=opts.onProgress||function(){};
  // Rendering seam (the "right way", pluggable): if opts.render(url)->htmlString is supplied, JS-rendered
  // shells get re-audited against the rendered HTML. Off by default → today's crawl runs on raw HTML, no blocker.
  const render=typeof opts.render==='function'?opts.render:null;
  const disc=await discoverPages(root, max, render);
  if(!disc.urls.length) return { error:'No pages discovered (no sitemap and no crawlable links — the site may be a JavaScript app with no sitemap).', root:disc.base };
  const pages=[]; let i=0, done=0, rendered=0;
  async function loadPage(u){
    let r;
    try{ r=await auditOne(u); }
    catch(e1){ // one free retry — most failures are transient (slow origin throttling under concurrency)
      try{ r=await auditOne(u); }
      catch(e2){ // last resort: if a renderer is available, try it (different IP + anti-bot) before giving up
        if(render){ const html=await render(u); if(html){ r=await auditOne(u, html); r._rendered=true; rendered++; return r; } }
        throw e2;
      }
    }
    if(r.jsShell && render){ try{ const html=await render(u); if(html){ r=await auditOne(u, html); r._rendered=true; rendered++; } }catch(e){} }
    return r;
  }
  async function worker(){ while(true){ const idx=i++; if(idx>=disc.urls.length)return; const u=disc.urls[idx];
    try{ const r=await loadPage(u); r._score=score(r); pages.push(r); }
    catch(e){ pages.push({ url:u, error:(e&&e.reason)||(e&&e.message)||'failed' }); }
    done++; onProgress(done, disc.urls.length, u); } }
  const pool=[]; for(let w=0; w<conc; w++) pool.push(worker()); await Promise.all(pool);
  const ok=pages.filter(p=>!p.error);
  const scored=ok.filter(p=>p._score&&p._score.score!=null);
  const siteScore=scored.length?Math.round(scored.reduce((a,p)=>a+p._score.score,0)/scored.length):null;
  // Server speed — response time per page (a top ranking + crawl-budget factor).
  const times=ok.map(p=>p.loadMs).filter(v=>v!=null);
  let perf=null;
  if(times.length){ const sorted=times.slice().sort((a,b)=>a-b); const avg=Math.round(times.reduce((a,b)=>a+b,0)/times.length);
    perf={ avg, median:sorted[Math.floor(sorted.length/2)], max:sorted[sorted.length-1], count:times.length,
      slow:ok.filter(p=>p.loadMs!=null&&p.loadMs>2000).map(p=>({url:p.url,ms:p.loadMs})).sort((a,b)=>b.ms-a.ms) }; }
  // Phase 2 — local/off-site: look up the Google Business Profile (rating, reviews, NAP) when opts.places is supplied.
  let local=null;
  if(typeof opts.places==='function'){
    try{
      const home=ok.find(p=>p.url===disc.base+'/'||p.url===disc.base)||ok[0];
      const bizName=(home&&home.title?home.title.split(/[|\-–—:·]/)[0].trim():'')||disc.base.replace(/^https?:\/\//,'').replace(/^www\./,'').split('.')[0];
      const pl=await opts.places(bizName);
      local=(pl&&(pl.name||pl.rating!=null||pl.address))
        ? { found:true, name:pl.name||bizName, rating:pl.rating, reviews:pl.reviews, address:pl.address, phone:pl.phone, website:pl.website, mapsUrl:pl.mapsUrl }
        : { found:false, query:bizName };
    }catch(e){ local=null; }
  }
  return { root:disc.base, siteScore, perf, local, crossPage:crossPageIssues(ok), pages,
    coverage:{ discovered:disc.total, audited:ok.length, failed:pages.length-ok.length, capped:disc.capped, cap:max, via:disc.via, rendered:rendered, renderAvailable:!!render } };
}
// Site-level report (branded) built from a crawlSite() result.
function siteReportHTML(res){
  if(!res||res.error) return '<p style="color:#dc2626;font-family:Inter,Arial,sans-serif">Crawl failed: '+esc(res&&res.error||'unknown')+'</p>';
  const F="font-family:'Inter',system-ui,Arial,sans-serif;color:#0f172a";
  const cov=res.coverage||{}; const cp=res.crossPage||{};
  const scol=s=> s==null?'#94a3b8':s>=90?'#16a34a':s>=80?'#65a30d':s>=70?'#f59e0b':s>=55?'#f97316':'#dc2626';
  const ok=(res.pages||[]).filter(p=>!p.error);
  // site-level category averages (for per-engine framing)
  const catAgg={}; ok.forEach(p=>{ const bc=p._score&&p._score.byCat||{}; Object.keys(bc).forEach(c=>{ catAgg[c]=catAgg[c]||{e:0,t:0}; catAgg[c].e+=bc[c].e; catAgg[c].t+=bc[c].t; }); });
  const catPct=c=>catAgg[c]&&catAgg[c].t?Math.round(100*catAgg[c].e/catAgg[c].t):null;
  const jsCount=(cp.jsRendered||[]).length;
  const aiPct=catPct('AI Search & Answer Engines');
  const engine=(label,val,note)=>'<div style="flex:1;min-width:150px;border:1px solid #e2e8f0;border-radius:8px;padding:12px"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">'+label+'</div><div style="font-size:24px;font-weight:800;color:'+scol(val)+'">'+(val==null?'—':val)+(val==null?'':'%')+'</div><div style="font-size:12px;color:#64748b;margin-top:2px">'+note+'</div></div>';
  const issue=(title,arr,fmt)=>{ arr=arr||[]; if(!arr.length) return ''; const items=arr.slice(0,8).map(fmt||(u=>esc(String(u)))).join('<br>'); return '<div style="border:1px solid #fee2e2;background:#fff7f7;border-radius:8px;padding:10px 12px;margin:0 0 8px"><div style="font-weight:800;color:#b91c1c">'+esc(title)+' ('+arr.length+')</div><div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.6">'+items+(arr.length>8?'<br>…and '+(arr.length-8)+' more':'')+'</div></div>'; };
  const pageRows=ok.slice(0,60).map(p=>{ var s=p._score||{}; return '<tr style="border-bottom:1px solid #eef2f7"><td style="padding:5px 8px;font-weight:700;color:'+scol(s.score)+'">'+(s.grade||'?')+(s.score!=null?' '+s.score:'')+'</td><td style="padding:5px 8px;font-size:12px">'+esc(p.url.replace(res.root,'')||'/')+'</td><td style="padding:5px 8px;font-size:12px;color:#64748b">'+(p.words||0)+'w'+(p.jsShell?' · JS':'')+(p._rendered?' · rendered':'')+'</td></tr>'; }).join('');
  // Local presence & reviews (Google Business Profile) — Phase 2
  // Server speed panel — response time is a ranking + crawl-budget factor
  const pf=res.perf;
  const speedHTML = !pf ? '' : (function(){
    const v=pf.avg, col= v<800?'#16a34a':v<1800?'#f59e0b':'#dc2626';
    const verdict= v<800?'Fast — good server response.':v<1800?'Moderate — slower than ideal; worth improving.':'Slow — this is hurting rankings and crawl budget. Likely the biggest technical problem.';
    const fmt=ms=>ms>=1000?(ms/1000).toFixed(1)+'s':ms+'ms';
    return '<h3 style="margin:18px 0 8px;font-size:15px">Server speed (how fast pages respond)</h3>'
      +'<div style="border:2px solid '+col+';border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.8">'
        +'<div style="font-size:15px"><b>Average page response: <span style="color:'+col+'">'+fmt(v)+'</span></b> &nbsp;·&nbsp; median '+fmt(pf.median)+' &nbsp;·&nbsp; slowest '+fmt(pf.max)+' &nbsp;<span style="color:#64748b">(across '+pf.count+' pages)</span></div>'
        +'<div style="color:'+col+';font-weight:700;margin-top:2px">'+verdict+'</div>'
        +'<div style="font-size:12px;color:#64748b;margin-top:4px">Measured live while crawling (server + network time to fetch each page). Slow responses mean a slower experience for visitors and search engines, which can hurt rankings and reduce how often your pages get crawled and indexed.</div>'
        +((pf.slow&&pf.slow.length)?('<div style="margin-top:8px"><b style="color:#b91c1c">Slowest pages (over 2s):</b><div style="font-size:12px;color:#475569;margin-top:3px;line-height:1.7">'+pf.slow.slice(0,8).map(o=>esc(o.url.replace(res.root,'')||'/')+' — <b>'+fmt(o.ms)+'</b>').join('<br>')+(pf.slow.length>8?'<br>…and '+(pf.slow.length-8)+' more':'')+'</div></div>'):'')
      +'</div>';
  })();
  const loc=res.local;
  const rcol=r=> r>=4.5?'#16a34a':r>=4?'#65a30d':r>=3?'#f59e0b':'#dc2626';
  const localHTML = !loc ? '' : ('<h3 style="margin:20px 0 8px;font-size:15px">Local presence &amp; reviews (Google)</h3>'
    + (loc.found
      ? '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.8">'
        +'<div><b>Google Business Profile:</b> found — '+esc(loc.name||'')+'</div>'
        +'<div><b>Rating:</b> '+(loc.rating!=null?('<b style="color:'+rcol(loc.rating)+'">'+loc.rating+' ★</b>'):'—')+' &nbsp;·&nbsp; <b>'+(loc.reviews!=null?loc.reviews:0)+'</b> reviews'+((loc.reviews!=null&&loc.reviews<20)?' <span style="color:#b45309">(low — reviews are a top local + AI ranking factor)</span>':'')+'</div>'
        +(loc.address?'<div><b>Address (NAP):</b> '+esc(loc.address)+'</div>':'')
        +(loc.phone?'<div><b>Phone:</b> '+esc(loc.phone)+'</div>':'')
        +(loc.mapsUrl?'<div><a href="'+esc(loc.mapsUrl)+'" style="color:#2563eb;text-decoration:none">View on Google Maps →</a></div>':'')
      +'</div>'
      : '<div style="border:1px solid #fee2e2;background:#fff7f7;border-radius:8px;padding:12px 14px;font-size:13px;color:#b91c1c">No Google Business Profile match found for "'+esc(loc.query||'')+'". If they should have one, it may be unclaimed/misnamed — a major gap for local &amp; AI search. Claiming and optimizing GBP is high priority.</div>'));
  return '<div style="'+F+'">'
    +'<div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:14px"><div style="font-size:20px;font-weight:800">'+esc(BRAND.name)+' — Full-Site SEO &amp; AI Search Audit</div><div style="color:#64748b;font-size:13px">'+esc(res.root)+'</div></div>'
    // Honest coverage line
    +'<div style="font-size:13px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:14px">'
      +'<b>Coverage:</b> audited <b>'+cov.audited+'</b> of <b>'+cov.discovered+'</b> pages found'+(cov.capped?(' (capped at '+cov.cap+' — more exist)'):'')+' · discovery via <b>'+esc(cov.via||'?')+'</b>'+(cov.failed?(' · '+cov.failed+' failed to load'):'')+(cov.renderAvailable?(' · '+cov.rendered+' JS pages rendered'):' · JS-rendering off (raw HTML only)')+'.'
    +'</div>'
    +'<div style="font-size:15px;margin-bottom:6px"><b>Site score:</b> <span style="font-size:26px;font-weight:800;color:'+scol(res.siteScore)+'">'+(res.siteScore==null?'—':res.siteScore)+'</span> / 100 (average across audited pages)</div>'
    +speedHTML
    // Per-engine readiness (basis stated)
    +'<h3 style="margin:18px 0 8px;font-size:15px">Readiness by search engine</h3>'
    +'<div style="display:flex;gap:10px;flex-wrap:wrap">'
      +engine('Google', res.siteScore, 'Overall on-page + technical (Google renders JS).')
      +engine('Bing', res.siteScore==null?null:Math.max(0,res.siteScore-(jsCount?Math.min(25,jsCount*3):0)), jsCount?(jsCount+' JS-only pages hurt Bing more'):'Reads mostly raw HTML.')
      +engine('AI Search', aiPct, jsCount?(jsCount+' pages invisible to AI (JS-only)'):'ChatGPT/Perplexity/AI Overviews.')
    +'</div>'
    // Cross-page findings (the headline value)
    +'<h3 style="margin:20px 0 8px;font-size:15px">Site-wide issues (what a single-page scan misses)</h3>'
    +(function(){ var out='';
      out+=issue('Pages sharing duplicate body content', cp.duplicateBodies, g=>g.urls.length+' pages: '+esc(g.urls.slice(0,3).map(u=>u.replace(res.root,'')).join(', ')));
      out+=issue('Duplicate page titles', cp.duplicateTitles, g=>'"'+esc(g.value)+'" — '+g.urls.length+' pages');
      out+=issue('Duplicate H1 headings', cp.duplicateH1, g=>'"'+esc(g.value)+'" — '+g.urls.length+' pages');
      out+=issue('Title doesn’t match page content', cp.titleBodyMismatch, u=>esc(u.replace(res.root,'')||'/'));
      out+=issue('Thin content (under 250 words)', cp.thin, o=>esc(o.url.replace(res.root,'')||'/')+' — '+o.words+'w');
      out+=issue('JavaScript-rendered (invisible to AI/Bing)', cp.jsRendered, u=>esc(u.replace(res.root,'')||'/'));
      out+=issue('Missing H1', cp.missingH1, u=>esc(u.replace(res.root,'')||'/'));
      return out||'<div style="color:#16a34a;font-size:13px">No site-wide issues detected across audited pages.</div>'; })()
    // Per-page table
    +'<h3 style="margin:20px 0 8px;font-size:15px">Per-page scores ('+ok.length+')</h3>'
    +'<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">Grade</th><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">Page</th><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">Notes</th></tr>'+pageRows+'</table>'+(ok.length>60?'<div style="font-size:12px;color:#64748b;margin-top:6px">Showing first 60 of '+ok.length+'.</div>':'')+'</div>'
    +localHTML
    +aiExplainerHTML()
    +ctaBlockHTML()
  +'</div>';
}
window.SEO = { audit, score, findingsHTML, reportHTML, emailHTML, emailText, comparisonHTML, discoverPages, crawlSite, crossPageIssues, siteReportHTML, BRAND };
})();
