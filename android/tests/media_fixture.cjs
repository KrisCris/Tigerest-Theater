const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {connect,run,delay}=require('./cdp.cjs');
const media=path.resolve(__dirname,'../test-artifacts/playback-fixture.mp4');
module.exports=async function(work,handler=()=>false,{tutorial=false}={}){
 const requests=[];
 const server=http.createServer((req,res)=>{
  requests.push(req.url);if(handler(req,res))return;
  if(req.url==='/media.mp4'){
   const total=fs.statSync(media).size,m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=m?+m[1]:0,end=m&&m[2]?Math.min(+m[2],total-1):total-1;
   if(start>=total){res.writeHead(416);res.end();return;}
   res.writeHead(m?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});fs.createReadStream(media,{start,end}).pipe(res);return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101010;color:white"><h1>安卓验收</h1><textarea id="draft" placeholder="评论草稿"></textarea></body>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;let c;
 try{
  run('reverse','tcp:'+port,'tcp:'+port);run('shell','am','force-stop','top.tigerest.theater.debug');if(!tutorial)require('./tutorial_fixture.cjs')();run('shell','am','start','--windowingMode','1','-n','top.tigerest.theater.debug/top.tigerest.theater.MainActivity','--es','url','http://127.0.0.1:'+port);
  c=await connect();for(let i=0;i<150;i++){if(await c.evaluate('!!window.api&&document.readyState==="complete"'))break;await delay(100);}
  const wait=async(expression,message=expression)=>{for(let i=0;i<160;i++){if(await c.evaluate(expression))return;await delay(100);}throw Error(message);};
  const tap=async text=>{
   for(let attempt=0;attempt<4;attempt++){
    try{run('shell','uiautomator','dump','/sdcard/tigerest-ui.xml');}catch(e){if(!e.stdout?.includes('hierchary dumped'))throw e;}
    const nodes=run('shell','cat','/sdcard/tigerest-ui.xml').match(/<node[^>]*>/g)||[],node=nodes.find(n=>n.includes(`text="${text}"`));
    const rectangle=n=>/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(n);
    if(node){const b=rectangle(node);run('shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2)));return;}
    const list=nodes.find(n=>n.includes('android.widget.ListView')&&n.includes('scrollable="true"'));if(!list)break;
    const b=rectangle(list),x=Math.round((+b[1]+ +b[3])/2),height=+b[4]- +b[2];run('shell','input','swipe',String(x),String(Math.round(+b[4]-height*.15)),String(x),String(Math.round(+b[2]+height*.15)),'300');
   }
   throw Error('UI text absent: '+text);
  };
  const shot=name=>{run('shell','screencap','-p','/sdcard/tigerest-proof.png');run('pull','/sdcard/tigerest-proof.png',path.resolve(__dirname,'../test-artifacts/'+name+'.png'));};
  await work({c,url:'http://127.0.0.1:'+port,wait,tap,shot,requests,server});
 }finally{
  c?.close();
  try{run('reverse','--remove','tcp:'+port);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
};
