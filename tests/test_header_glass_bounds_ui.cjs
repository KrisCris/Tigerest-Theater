// A flat replacement must cover the same area as the original backdrop and
// must not erase paint from a sibling's overflowing pseudo-element.
const assert = require('node:assert/strict');
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const page = `<!doctype html><style>
body{margin:0}.skinHeader{position:fixed;left:0;top:0;width:600px;height:200px;background:rgba(0,0,0,.5);contain:layout style paint}
.headerTop{position:relative;width:600px;height:200px;box-sizing:border-box;background:rgba(220,180,120,.55)!important}
.control{position:absolute;left:200px;top:50px;width:100px;height:100px;appearance:none;backdrop-filter:blur(20px);background:rgba(40,100,50,.2);box-sizing:border-box}
.sibling{position:absolute;left:20px;top:50px;width:40px;height:100px}
.sibling::before{content:"";position:absolute;left:160px;top:0;width:100px;height:100px;background:repeating-linear-gradient(90deg,red 0 5px,blue 5px 10px)}
</style><div class=skinHeader><div class=headerTop><div class=sibling></div><div id=control class=control></div></div></div><script src=/appearance.js></script>`;
withBrowser({'/': {type:'text/html',body:page}, '/appearance.js': {path:path.resolve(__dirname,'../native/webAppearance.js')}},
    async ({evaluate,call}) => {
        await call('Emulation.setDeviceMetricsOverride',{width:600,height:400,deviceScaleFactor:1,mobile:false});
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:350});
        const settle = () => evaluate('new Promise(r=>setTimeout(()=>requestAnimationFrame(r),400))');
        const filter = () => evaluate('getComputedStyle(document.getElementById("control")).backdropFilter');
        await settle();
        assert.equal(await filter(),'blur(20px)','painted sibling pseudo overflowing under the control keeps its real backdrop');
        await evaluate('document.querySelector(".sibling").style.overflow="hidden"');
        await settle();
        assert.equal(await filter(),'none','a sibling that clips its overflowing decoration cannot paint under the control');
        await evaluate(`document.querySelector('.sibling').style.position='static';
            const css=document.createElement('style');css.textContent='.sibling::before{left:200px;top:50px}';document.head.append(css)`);
        await settle();
        assert.equal(await filter(),'blur(20px)','a static overflow owner does not clip a pseudo positioned against the header');
        await evaluate(`{const sibling=document.querySelector('.sibling');sibling.style.cssText='position:absolute;left:20px;top:50px;width:400px;height:100px;overflow:auto';
            sibling.innerHTML='<div style="width:1000px;height:1px"></div>';
            const css=document.createElement('style');css.textContent='.sibling::before{left:400px;top:0}';document.head.append(css);
            sibling.scrollLeft=200}`);
        await settle();
        assert.equal(await filter(),'blur(20px)','scrolling the owner moves its painted pseudo beneath the control');
        await evaluate('document.querySelector(".sibling").remove();document.getElementById("control").style.cssText="background-clip:content-box;padding:25px"');
        await settle();
        assert.equal(await filter(),'blur(20px)','content-box background cannot replace the backdrop across the padding');
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".headerTop")).backdropFilter'),
            'blur(20px) saturate(1.32)', 'a retained child filter must keep its original backdrop root');
        await evaluate('document.getElementById("control").style.cssText="background-clip:padding-box;border:10px solid transparent"');
        await settle();
        assert.equal(await filter(),'blur(20px)','padding-box background cannot replace the backdrop across a transparent border');
        console.log('header glass paint bounds: passed');
    }).catch(error=>{console.error(error);process.exitCode=1;});
