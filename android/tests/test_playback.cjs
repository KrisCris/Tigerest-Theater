const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {connect,run,delay}=require('./cdp.cjs');
const media=path.resolve(__dirname,'../test-artifacts/playback-fixture.mp4');
async function test(){
 const server=http.createServer((req,res)=>{
  if(req.url==='/media.mp4'){
   const total=fs.statSync(media).size,m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=m?+m[1]:0,end=m&&m[2]?+m[2]:total-1;
   res.writeHead(m?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});fs.createReadStream(media,{start,end}).pipe(res);return;
  }
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101010;color:white"><h1>安卓播放器验收</h1></body>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;let c;
 try{
  run('reverse','tcp:'+port,'tcp:'+port);run('shell','am','force-stop','top.tigerest.theater.debug');run('shell','am','start','-n','top.tigerest.theater.debug/top.tigerest.theater.MainActivity','--es','url','http://127.0.0.1:'+port);
  c=await connect();for(let i=0;i<120;i++){if(await c.evaluate('!!window.api'))break;await delay(100);}
  await c.evaluate(`(()=>{window.playEvents=[];for(const n of ['playing','paused','finished','stopped','error','positionUpdate','updateDuration'])api.player[n].connect((...args)=>playEvents.push({name:n,args}));return api.player.load('http://127.0.0.1:${port}/media.mp4',{autoplay:true,startMilliseconds:5000},{type:'video',metadata:{Id:'fixture',Name:'双音轨测试'},headers:{}},1,-1)})()`);
  for(let i=0;i<150;i++){if(await c.evaluate('playEvents.some(e=>e.name==="positionUpdate"&&e.args[0]>6000)'))break;await delay(100);}
  const before=await c.evaluate('({position:playEvents.filter(e=>e.name==="positionUpdate").at(-1)?.args[0],duration:playEvents.find(e=>e.name==="updateDuration")?.args[0],errors:playEvents.filter(e=>e.name==="error")})');assert.ok(before.position>6000,JSON.stringify(before));assert.ok(before.duration>=89000);assert.equal(before.errors.length,0);
  await c.evaluate('api.player.pause()');await delay(350);const paused=await c.evaluate('api.player.getPosition()');await delay(600);assert.ok(Math.abs(await c.evaluate('api.player.getPosition()')-paused)<100,'paused clock');
  await c.evaluate('api.player.seekTo(30000)');await delay(400);assert.ok(Math.abs(await c.evaluate('api.player.getPosition()')-30000)<350,'seek milliseconds');
  await c.evaluate('api.player.setPlaybackRate(1500)');await c.evaluate('api.player.setAudioStream(2)');await c.evaluate('api.player.play()');await delay(1200);const after=await c.evaluate('api.player.getPosition()');assert.ok(after>31000&&after<33000,'speed 1.5');
  const diagnostic=await c.evaluate('api.player.mpvDiagnostics()');assert.ok(diagnostic.version.includes('mpv'));
  assert.equal(diagnostic.audioTrack,2);assert.equal(diagnostic.tracks.filter(t=>t.type==='audio').length,2);
  run('shell','screencap','-p','/sdcard/tigerest-playback.png');run('pull','/sdcard/tigerest-playback.png',path.resolve(__dirname,'../test-artifacts/playback.png'));
  await c.evaluate('api.player.seekTo(89000)');await delay(2000);assert.ok(await c.evaluate('playEvents.some(e=>e.name==="finished")'),'natural EOF distinct from error');assert.ok(await c.evaluate('!playEvents.some(e=>e.name==="error")'));
  await c.evaluate(`api.player.load('http://127.0.0.1:${port}/media.mp4',{autoplay:false,startMilliseconds:7000},{type:'video',metadata:{Name:'暂停启动'}},1,-1)`);await delay(500);assert.ok(await c.evaluate('api.system.debugInformation().then(s=>s.paused)'),'autoplay false remains paused');
  await c.evaluate('api.player.stop()');await delay(200);assert.ok(await c.evaluate('playEvents.some(e=>e.name==="stopped")'));
  console.log(JSON.stringify({passed:true,before,paused,after,diagnostic},null,2));
 }finally{c?.close();run('reverse','--remove','tcp:'+port);await new Promise(r=>server.close(r));}
}
test().catch(e=>{console.error(e);process.exitCode=1;});
