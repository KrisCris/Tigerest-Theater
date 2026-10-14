// Isolated font fallback workload. Compare only on the same OS/font installation.
// No Emby account, network fonts or installed player profile are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const withBrowser = require('./community_browser.cjs');
const routes = {'/':{type:'text/html',body:'<!doctype html><html lang="zh"><body><canvas width="900" height="100"></canvas></body></html>'}};
withBrowser(routes, async ({evaluate,call}) => {
    const result = await evaluate(`(async()=>{
        // Stay on one raster backend: repeated GPU readbacks otherwise switch to
        // CPU rendering and make pixel hashes differ within the control run.
        const canvas=document.querySelector('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
        const words=['第一集 在线观看','继续观看 剧集详情','最新入库 媒体中心','青色天空与海报墙',
            '收藏 设置 播放记录','上一集 下一集 选集','声音 字幕 画面质量','首次布局与流畅转场'];
        const fonts=[13.76,20.64,34,68].flatMap(size=>[400,600,750].map(weight=>weight+' '+size+'px system-ui'));
        const rounds=[];
        for(let round=0;round<3;round++){
            const samples=[];
            for(const font of fonts){
                await new Promise(requestAnimationFrame);
                context.font=font;const started=performance.now();
                let width=0;for(const word of words)width+=context.measureText(word).width;
                samples.push({font,ms:performance.now()-started,width});
            }
            rounds.push(samples);
        }
        // Mixed-script/style output reference protects typography, not just speed.
        const texts=[['zh','青之箱 第１集 初次相遇 / Episode 01'],['ja','青の箱、次のエピソード。'],
            ['ko','첫 번째 에피소드와 다음 영상'],['ar','الحلقة الأولى 123'],
            ['hi','पहला एपिसोड 123'],['en','Player AV fi 123 — → ★ ♥︎ ♥️ 👨‍👩‍👧‍👦']];
        window.fontFallbackPixelReference=()=>{
        const pixels=[];
        for(const [lang,text] of texts){
            document.documentElement.lang=lang;
            for(const weight of [400,600,750])for(const italic of ['', 'italic ']){
                context.clearRect(0,0,900,100);context.fillStyle='#e9e6df';context.textBaseline='alphabetic';
                context.font=italic+weight+' 28px system-ui';context.direction='ltr';
                const width=context.measureText(text).width;context.fillText(text,8,58);
                const data=context.getImageData(0,0,900,100).data;let hash=2166136261;
                for(const byte of data)hash=Math.imul(hash^byte,16777619)>>>0;
                pixels.push({lang,weight,italic:!!italic,width,hash:hash.toString(16).padStart(8,'0')});
            }
        }
        return pixels;};
        return {rounds,pixels:window.fontFallbackPixelReference(),userAgent:navigator.userAgent};
    })()`);
    assert.equal(result.rounds.length,3);
    assert.equal(result.pixels.length,36);
    assert.ok(result.pixels.every(row=>row.width>0));
    // Exercise more distinct variation descriptors than the experimental cache
    // capacity. Integer sizes remain distinct after ComputedPixelSize rounding.
    // Pressure checks output stability; it does not invalidate the main-thread
    // FontCache generation in this Chromium version.
    await evaluate(`(()=>{const c=document.querySelector('canvas').getContext('2d');
        for(let i=0;i<96;i++){c.font='750 '+(16+i)+'px system-ui';c.measureText('字重与中文排版');}
    })()`);
    assert.deepEqual(await evaluate('fontFallbackPixelReference()'),result.pixels,'eviction changes typography');
    await call('Memory.simulatePressureNotification',{level:'critical'});
    assert.deepEqual(await evaluate('fontFallbackPixelReference()'),result.pixels,'memory pressure changes typography');
    result.validated={afterEviction:true,afterMemoryPressure:true};
    if(process.env.TIGEREST_FONT_REFERENCE){
        const reference=JSON.parse(fs.readFileSync(process.env.TIGEREST_FONT_REFERENCE,'utf8'));
        assert.deepEqual(result.pixels,reference.pixels,'font advances and glyph pixels must remain unchanged');
        assert.deepEqual(result.rounds.map(r=>r.map(s=>s.width)),reference.rounds.map(r=>r.map(s=>s.width)));
    }
    if(process.env.TIGEREST_FONT_OUTPUT)fs.writeFileSync(process.env.TIGEREST_FONT_OUTPUT,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({roundTotalMs:result.rounds.map(r=>r.reduce((n,s)=>n+s.ms,0)),
        roundMaxMs:result.rounds.map(r=>Math.max(...r.map(s=>s.ms))),pixelCases:result.pixels.length,
        compared:!!process.env.TIGEREST_FONT_REFERENCE,...result.validated}));
},{gpu:true}).catch(error=>{console.error(error);process.exitCode=1});
