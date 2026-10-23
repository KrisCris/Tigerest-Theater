'use strict';
// Poster transition demo: the shipping renderer (native/homeTransitions.js)
// next to the parallel prototype (transitions-next.js), on the Emby-scale
// fixture of tests/bench_home_motion.cjs.
//   node dev/transition-demo/demo.cjs build                 -> dev/transition-demo/demo.html (open it in a browser)
//   node dev/transition-demo/demo.cjs measure <chrome> [--rounds=5]
//   node dev/transition-demo/demo.cjs record <chrome> <out-dir>
const fs = require('node:fs'), path = require('node:path');
const here = __dirname, repo = path.resolve(here, '../..');
const [command = 'build', browser, outDir] = process.argv.slice(2);
const argument = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=') ?? fallback;

const poster = (hue, n) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,45%)"/><stop offset="1" stop-color="hsl(${(hue+80)%360},45%,20%)"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><circle cx="300" cy="330" r="180" fill="hsl(${(hue+160)%360},40%,60%)" opacity=".7"/><text x="40" y="820" font-size="64" fill="#fff">作品 ${n}</text></svg>`;
const uri = (hue, n) => 'data:image/svg+xml,' + encodeURIComponent(poster(hue, n));
function sheet(seed, n) { let s = ''; for (let i = 0; i < n; i++) s += `.s${seed}-${i} .k${i%97}>.m${i%31}:not(.hide),.skinBody .z${i}[data-a="${i%13}"]{margin:${i%7}px ${i%5}px;padding:${i%3}px;color:rgb(${i%255},${(i*7)%255},${(i*13)%255});border-radius:${i%9}px;font-size:${10+i%8}px}\n`; return s; }
const layout = `body{margin:0;background:#101722;color:#ddd;font:14px "Microsoft YaHei",sans-serif;overflow:hidden}
.backgroundContainer,.backdropContainer{position:fixed;inset:0}.backdropImage{position:absolute;inset:0;background-size:cover;opacity:.35}
.skinHeader{position:fixed;left:0;right:0;top:0;height:48px;background:#0d1118cc;z-index:5;display:flex;gap:12px;align-items:center;padding:0 16px}
.page{position:fixed;inset:48px 0 0 0;overflow:auto;background:linear-gradient(120deg,#22313f,#101722)}.hide{display:none!important}
.tg-home{display:grid;grid-template-columns:220px 1fr;grid-template-rows:1fr 240px;height:100%}
.tg-home-nav{grid-row:1/3;display:flex;flex-direction:column;gap:8px;padding:12px;overflow:auto}.tg-library{display:flex;gap:8px;align-items:center;height:64px;background:#ffffff10;border:0;color:#ddd;cursor:pointer}.tg-library img{width:96px;height:54px;object-fit:cover}
.tg-home-stage{position:relative;overflow:hidden}.tg-home-stage .hero{position:absolute;right:40px;top:30px;width:220px;height:330px;object-fit:cover}.tg-home-stage h2{font-size:42px;margin:60px 40px 10px}.tg-home-stage p{margin:8px 40px;max-width:520px}
.tg-home-rail{overflow:hidden}.tg-cover-list{display:flex;gap:12px;overflow-x:auto;padding:12px}.tg-cover{flex:0 0 120px;height:180px;position:relative;border:0;padding:0;background:#000;cursor:pointer}.tg-cover img{width:100%;height:100%;object-fit:cover}.tg-cover-label{position:absolute;left:4px;bottom:4px;font-size:11px}
.itemsContainer{display:flex;flex-wrap:wrap;gap:14px;padding:20px}.card{width:150px;cursor:pointer}.cardBox{margin:0}.cardScalable{position:relative}.cardPadder{padding-bottom:150%}.cardImageContainer{position:absolute;inset:0}.cardImage{width:100%;height:100%;object-fit:cover;display:block}.cardFooter{height:40px}.cardText{white-space:nowrap;overflow:hidden;font-size:12px}
.detailMainContainer{display:flex;gap:24px;padding:40px}.detailImageContainer-main{width:240px;flex:0 0 240px}.detailImageContainer-main img{width:240px;height:360px;object-fit:cover}.detailTextContainer h1{font-size:36px;margin-top:0}.castList{display:flex;flex-wrap:wrap;gap:10px;padding:20px 40px}.cast{width:90px}.cast img{width:90px;height:90px;border-radius:50%;object-fit:cover}
.back{position:absolute;right:40px;top:40px;padding:8px 18px;background:#ffffff20;color:#fff;border:0;cursor:pointer}
#panel{position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:10;display:flex;gap:10px;align-items:center;background:#000c;padding:6px 12px;border-radius:8px;font-size:13px}
#panel select,#panel button{font:inherit}#stats{position:fixed;left:12px;bottom:10px;z-index:10;background:#000c;padding:6px 10px;border-radius:6px;font:12px monospace;white-space:pre}`;
let id = 0;
const img = (cls, hue, lazy = false, label = '') => `<img class="${cls}" ${lazy ? 'loading="lazy" ' : ''}src="${uri(hue, label || id)}" data-n="${id++}">`;
const card = i => `<div class="card s1-${i}" data-id="w${i}"><div class="cardBox"><div class="cardScalable"><div class="cardPadder"></div><div class="cardImageContainer">${img('cardImage', i*7, i > 40, i)}</div></div><div class="cardFooter"><div class="cardText">作品 ${i}</div><div class="cardText">2024</div></div></div></div>`;
const home = `<div class="page mainAnimatedPage" id="home"><div class="tg-home-host"><div class="tg-home tg-entered">
<nav class="tg-home-nav">${Array.from({length: 10}, (_, i) => `<button class="tg-library" data-library-id="lib${i}">${img('', i*30)}<span>媒体夹 ${i}</span></button>`).join('')}</nav>
<section class="tg-home-stage">${img('hero', 200)}<div class="hero-content"><div>动画 / 继续观看</div><h2>作品标题</h2><div>2024 · 最新入库 S1:E12</div><p>${'简介文字。'.repeat(40)}</p></div></section>
<section class="tg-home-rail"><div>动画 / 继续观看</div><div class="tg-cover-list">${Array.from({length: 24}, (_, i) => `<button class="tg-cover" data-item-id="w${i}" data-index="${i}">${img('', i*7, i > 9, i)}<span class="tg-cover-label">作品 ${i}</span></button>`).join('')}</div></section>
</div></div></div>`;
const library = `<div class="page mainAnimatedPage hide" id="library"><div class="itemsContainer">${Array.from({length: 240}, (_, i) => card(i)).join('')}</div></div>`;
// Detail sections that a real server fills in after the route (cast, similar, extras).
const late = [
    `<div class="castList">${Array.from({length: 30}, (_, i) => `<div class="cast">${img('', i*11, false, '演员'+i)}<div>演员 ${i}</div></div>`).join('')}</div>`,
    `<div class="castList">${Array.from({length: 30}, (_, i) => `<div class="cast">${img('', i*13, false, '演员'+(30+i))}<div>演员 ${30+i}</div></div>`).join('')}</div>`,
    ...Array.from({length: 3}, (_, s) => `<div class="itemsContainer">${Array.from({length: 20}, (_, i) => card(300+s*20+i)).join('')}</div>`)];
const detail = `<div class="page mainAnimatedPage hide view-item-item" id="detail"><button class="back">← 返回</button><div class="detailMainContainer"><div class="detailImageContainer detailImageContainer-main"><img class="cardImage" id="detail-poster"></div><div class="detailTextContainer"><h1 id="detail-title">作品</h1>${Array.from({length: 30}, (_, i) => `<div class="detail-row k${i}"><span>字段 ${i}</span><span>${'值'.repeat(i%9+1)}</span></div>`).join('')}<p>${'剧情介绍。'.repeat(80)}</p></div></div><div id="detail-late"></div></div>`;
const hidden = n => `<div class="page mainAnimatedPage hide" id="old${n}">${Array.from({length: 150}, (_, i) => `<div class="row s2-${i}"><span>${i}</span><span>${'x'.repeat(i%20)}</span></div>`).join('')}</div>`;
const script = name => fs.readFileSync(name, 'utf8').replace(/<\/script/gi, '<\\/script');
const controller = `
window.demo={engine:'next',routeDelay:400,late:true};
const engines={current:()=>window.TigerestHomeTransitions,lean:()=>window.TigerestHomeTransitionsLean,next:()=>window.TigerestHomeTransitionsNext};
const engineNames={current:'现版本',lean:'现版+点击即切路由',next:'重写版'};
window.state={from:null,source:null,itemId:null};
window.show=name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('hide',n.id!==name));document.body.classList.toggle('tg-home-active',name==='home');};
const lateTemplates=${JSON.stringify(late)};
let lateTimers=[];
function fillDetail(itemId,artwork){
  lateTimers.forEach(clearTimeout);lateTimers=[];
  const host=document.getElementById('detail-late');host.innerHTML='';
  const img=document.getElementById('detail-poster');document.getElementById('detail-title').textContent='作品 '+itemId.slice(1);
  if(!demo.late){img.src=artwork;host.innerHTML=lateTemplates.join('');return;}
  // A real detail view loads its primary image and fills sections in batches.
  img.removeAttribute('src');lateTimers.push(setTimeout(()=>{img.src=artwork;},90));
  lateTemplates.forEach((html,i)=>lateTimers.push(setTimeout(()=>host.insertAdjacentHTML('beforeend',html),140+i*130)));
}
window.route=(name,data)=>new Promise(r=>setTimeout(()=>{if(name==='detail')fillDetail(data.itemId,data.artwork);show(name);r();},demo.routeDelay));
function sourceFor(from,itemId){return from==='home'?document.querySelector('.tg-cover[data-item-id="'+itemId+'"] img'):document.querySelector('#library .card[data-id="'+itemId+'"] img');}
window.openItem=(from,itemId)=>{
  const source=sourceFor(from,itemId);state.from=from;state.itemId=itemId;
  return engines[demo.engine]().poster({source,itemId,direction:'enter',findTarget:()=>document.querySelector('#detail #detail-poster'),
    navigate:()=>route('detail',{itemId,artwork:source.currentSrc||source.src})});
};
window.goBack=()=>{
  const from=state.from||'library',itemId=state.itemId||'w3';
  return engines[demo.engine]().poster({source:document.querySelector('#detail #detail-poster'),itemId,direction:'return',
    findTarget:()=>sourceFor(from,itemId),navigate:()=>route(from)});
};
document.addEventListener('click',e=>{
  if(Object.values(engines).some(e=>e().busy))return;
  const cover=e.target.closest('.tg-cover'),c=e.target.closest('#library .card'),lib=e.target.closest('.tg-library');
  if(cover)openItem('home',cover.dataset.itemId).then(stats);
  else if(c)openItem('library',c.dataset.id).then(stats);
  else if(e.target.closest('.back'))goBack().then(stats);
  else if(lib){show('library');document.querySelector('#library').scrollTop=0;}
});
function stats(){const m=engines[demo.engine]().last||{};document.getElementById('stats').textContent=engineNames[demo.engine]+'  点击→结束 '+Math.round(m.totalMs||0)+' ms';}
document.getElementById('engine').onchange=e=>{demo.engine=e.target.value;};
document.getElementById('delay').onchange=e=>{demo.routeDelay=+e.target.value;};
document.getElementById('late').onchange=e=>{demo.late=e.target.checked;};
document.getElementById('home-btn').onclick=()=>show('home');
document.getElementById('lib-btn').onclick=()=>{show('library');document.querySelector('#library').scrollTop=0;};
show('home');`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>海报转场对比</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${layout}</style>${[1,2,3,4,5].map(n => `<style>${sheet(n, 900)}</style>`).join('')}</head>
<body class="skinBody tg-home-active"><div class="backgroundContainer"></div><div class="backdropContainer"><div class="backdropImage" style="background-image:url('${uri(99,'bd')}')"></div></div>
<div class="skinHeader"><b>Emby</b>${Array.from({length: 8}, (_, i) => `<button>btn${i}</button>`).join('')}</div>
<div id="panel">转场 <select id="engine"><option value="next">重写版</option><option value="current">现版本</option><option value="lean">现版+点击即切路由</option></select>
服务器响应 <select id="delay"><option>150</option><option selected>400</option><option>800</option></select> ms
<label><input type="checkbox" id="late" checked>详情页分批加载</label><button id="home-btn">首页</button><button id="lib-btn">媒体夹</button></div>
<div id="stats">点首页下方海报或媒体夹卡片；详情页右上角返回</div>
${home}${library}${detail}${hidden(1)}${hidden(2)}
<script>${script(path.join(repo, 'native/homeBackdrop.js'))}</script>
<script>${script(path.join(repo, 'native/homeTransitions.js'))}</script>
<script>${require('./lean.cjs')(script(path.join(repo, 'native/homeTransitions.js')))}</script>
<script>${script(path.join(here, 'transitions-next.js'))}</script>
<script>${controller}</script></body></html>`;
fs.writeFileSync(path.join(here, 'demo.html'), html);
if (command === 'build') { console.log('wrote', path.join(here, 'demo.html'), (html.length / 1024 / 1024).toFixed(1) + ' MB'); return; }

process.argv[2] = browser; // community_browser takes the executable from argv[2]
const withBrowser = require(path.join(repo, 'tests/community_browser.cjs'));
const {frameMetrics} = require(path.join(repo, 'tests/frame_metrics.cjs'));
const routes = {'/': {type: 'text/html; charset=utf-8', body: html}};
const pause = ms => new Promise(r => setTimeout(r, ms));
withBrowser(routes, async ({call, evaluate, profile}) => {
    await call('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
    await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
    await pause(800);
    await evaluate(`(async()=>{await Promise.all(Array.from(document.images).filter(i=>!i.complete&&i.loading!=='lazy').map(i=>new Promise(r=>{i.onload=i.onerror=r;})));
      window.timed=async(fn)=>{const iv=[];let prev=await new Promise(requestAnimationFrame),run=true;const t0=performance.now();
        const tick=t=>{iv.push(t-prev);prev=t;if(run)requestAnimationFrame(tick);};requestAnimationFrame(tick);
        await fn();run=false;const e=engines[demo.engine]().last||{};return {intervals:iv,wall:performance.now()-t0,m:e,hidden:document.visibilityState!=='visible'};};
      return true;})()`);
    const prepare = async (engine, delay, late, from) => {
        await evaluate(`Object.values(engines).forEach(e=>e().cancel());demo.engine='${engine}';demo.routeDelay=${delay};demo.late=${late};show('${from}');document.querySelector('#${from}').scrollTop=0;true`);
        await pause(300);
        // The shipping renderer is measured with its cache warm, its best case.
        if (engine !== 'next') await evaluate(`(async()=>{const t=engines['${engine}'](),until=performance.now()+6000;while(performance.now()<until){await t.prewarm();if(t.cacheState.ready)return;await new Promise(r=>setTimeout(r,100));}})()`);
    };
    const scenarios = {
        homeDetail: {from: 'home', run: `openItem('home','w3')`},
        libraryDetail: {from: 'library', run: `openItem('library','w3')`},
        detailReturn: {from: 'detail', setup: `state.from='library';state.itemId='w3';fillDetail('w3',document.querySelector('#library .card[data-id="w3"] img').src);demo.late=false;fillDetail('w3',document.querySelector('#library .card[data-id="w3"] img').src);`, run: `goBack()`}
    };
    if (command === 'record') {
        fs.mkdirSync(outDir, {recursive: true});
        const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page');
        const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, {once: true}));
        let seq = 0, frames = [];
        ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Page.screencastFrame') { frames.push({data: m.params.data, t: m.params.metadata.timestamp}); ws.send(JSON.stringify({id: ++seq, method: 'Page.screencastFrameAck', params: {sessionId: m.params.sessionId}})); } });
        for (const [engine, delay] of [['current', 400], ['lean', 400], ['next', 400]]) for (const [name, s] of Object.entries({homeDetail: scenarios.homeDetail, detailReturn: {...scenarios.detailReturn, setup: `state.from='home';state.itemId='w3';`}})) {
            await prepare(engine, delay, true, s.from === 'detail' ? 'detail' : s.from);
            if (name === 'detailReturn') { await evaluate(`demo.late=false;fillDetail('w3',document.querySelector('.tg-cover[data-item-id="w3"] img').src);show('detail');${s.setup}true`); await pause(400); }
            frames = [];
            ws.send(JSON.stringify({id: ++seq, method: 'Page.startScreencast', params: {format: 'jpeg', quality: 85, everyNthFrame: 1}}));
            await pause(500);
            await evaluate(`demo.late=true;${s.run}.then(()=>true)`);
            await pause(700);
            ws.send(JSON.stringify({id: ++seq, method: 'Page.stopScreencast'})); await pause(200);
            const dir = path.join(outDir, `${engine}-${name}`); fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir);
            const list = []; frames.forEach((f, i) => { const file = `f${String(i).padStart(5, '0')}.jpg`; fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64')); if (i) list[list.length - 1].d = f.t - frames[i - 1].t; list.push({file, d: 1 / 60}); });
            fs.writeFileSync(path.join(dir, 'frames.txt'), list.map(x => `file '${x.file}'\nduration ${x.d.toFixed(4)}`).join('\n') + `\nfile '${list.at(-1).file}'\n`);
            console.log(engine, name, frames.length, 'frames');
        }
        ws.close(); return;
    }
    const rounds = Number(argument('rounds', 5)), rows = {};
    for (const late of [false, true]) for (const delay of [150, 400]) for (const [name, s] of Object.entries(scenarios)) for (const variant of argument('variants', 'current,lean,next,cold').split(',')) {
        const engine = variant === 'cold' ? 'next' : variant;
        const samples = [];
        for (let r = 0; r < rounds + 1; r++) {
            await prepare(engine, delay, late, s.from === 'detail' ? 'library' : s.from);
            if (s.setup) { await evaluate(`${s.setup}show('detail');true`); await pause(400); if (engine !== 'next') await evaluate(`engines['${engine}']().prewarm()`); }
            await evaluate(`demo.late=${late};${variant === 'cold' ? 'TigerestHomeTransitionsNext.forget();' : ''}true`);
            const x = await evaluate(`timed(()=>${s.run})`);
            if (r === 0) continue; // the first run teaches the prototype its landing; report the repeat visits
            samples.push(x);
        }
        const med = f => { const v = samples.map(f).filter(n => typeof n === 'number').sort((a, b) => a - b); return v.length ? Math.round(v[v.length >> 1]) : null; };
        const frames = frameMetrics(samples.flatMap(x => x.intervals), 120);
        rows[`${late ? '分批' : '一次'}/${delay}ms/${name}/${{current: '现版', lean: '现版+点击即切路由', next: '重写', cold: '重写无记忆'}[variant]}`] = {
            '点击→结束': med(x => x.m.totalMs),
            '新页面开始显现': med(x => engine === 'next' ? x.m.revealStartMs : (x.m.posterFlightStartsMs ?? NaN) + 720 * .16),
            '路由开始': med(x => x.m.routeStartMs), '海报起飞': med(x => engine === 'next' ? 0 : x.m.posterFlightStartsMs),
            '首次猜测误差px': engine === 'next' ? med(x => x.m.guessErrorPx) : '-', '落点误差px': med(x => x.m.landingErrorPx), '后台': samples.some(x => x.hidden) ? '是' : '', 'p95帧ms': +frames.p95Ms.toFixed(1), '最长帧ms': +frames.maxMs.toFixed(1)};
    }
    console.table(rows);
    fs.writeFileSync(path.join(here, 'measure.json'), JSON.stringify(rows, null, 2));
}, {gpu: true, visible: argument('visible', '') === '1', args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']}).catch(e => { console.error(e); process.exitCode = 1; });
