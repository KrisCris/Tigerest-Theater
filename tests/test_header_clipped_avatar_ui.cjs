// Jellyfin nests a 79px themed avatar inside a clipped 44px button. Its
// uncut box overlaps the next control even though no pixels reach there.
const assert=require('node:assert/strict'),path=require('node:path');
const withBrowser=require('./community_browser.cjs');
withBrowser({'/':{type:'text/html',body:`<!doctype html><style>
body{margin:0}.skinHeader{position:fixed;inset:0 auto auto 0;width:500px;height:160px;background:rgba(13,16,22,.52)}
.headerTop{position:relative;top:40px;width:500px;height:60px;background:transparent!important}
.control{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:44px;border:0;padding:0;backdrop-filter:blur(15px)!important;background:rgba(24,27,33,.78);border-radius:10px}
#menu{position:absolute;left:200px;top:8px;width:66px}
#outer{position:absolute;left:272px;top:8px;width:44px;overflow:hidden;border-radius:50%;box-shadow:inset 0 1px rgba(255,255,255,.06)}
#inner{flex:0 0 79.2px;width:79.2px;height:79.2px;border-radius:50%;background-image:linear-gradient(45deg,rgba(230,30,70,.32),rgba(20,180,230,.32))}
</style><div class=skinHeader><div class=headerTop><button id=menu class=control>Client</button><button id=outer class=control><div id=inner class=control></div></button></div></div><script src=/appearance.js></script>`},
 '/appearance.js':{path:path.resolve(__dirname,'../native/webAppearance.js')}},async({evaluate,call})=>{
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:450,y:300});
 const settle=()=>evaluate('new Promise(r=>setTimeout(()=>requestAnimationFrame(r),350))');
 const filters=()=>evaluate('Object.fromEntries(["menu","outer","inner"].map(id=>[id,getComputedStyle(document.getElementById(id)).backdropFilter]))');
 await settle();
 assert.deepEqual(await filters(),{menu:'none',outer:'blur(15px)',inner:'blur(15px)'},'clipped avatar paint must not block its separated neighbor; its own nonuniform roots stay');
 await evaluate('document.getElementById("outer").style.overflow="visible"');await settle();
 assert.equal((await filters()).menu,'blur(15px)','unclipped artwork really overlaps the neighbor');
 await evaluate('document.getElementById("outer").style.overflow="hidden";document.getElementById("inner").style.position="fixed"');await settle();
 assert.equal((await filters()).menu,'blur(15px)','out-of-flow artwork may escape the clipping owner');
 console.log('clipped avatar paint bounds: passed');
}).catch(e=>{console.error(e);process.exitCode=1;});
