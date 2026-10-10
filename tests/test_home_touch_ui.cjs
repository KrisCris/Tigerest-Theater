const assert=require('node:assert/strict'),path=require('node:path'),withBrowser=require('./community_browser.cjs');
const root=path.resolve(__dirname,'..'),routes={
 '/':{type:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0b0d12}</style><div id="home"></div><script src="/data.js"></script><script src="/gallery.js"></script>'},
 '/data.js':{path:path.join(root,'native/homeData.js')},'/gallery.js':{path:process.env.TIGEREST_GALLERY_SOURCE||path.join(root,'native/homeGallery.js')},
 '/poster.svg':{type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#79623b"/></svg>'}
};
for(const name of ['anime','movies','series','favorites'])routes['/art/'+name+'.png']={type:'image/png',path:path.join(root,'native/home-art',name+'.png')};
withBrowser(routes,async({evaluate,call})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const result=await evaluate('('+ (async function(){
  const check=(value,message)=>{if(!value)throw Error(message);},wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture not ready');};
  window.TigerestHomeMotion=null;
  const opened=[],api={serverId:()=> 'fixture',serverAddress:()=>location.origin,getCurrentUserId:()=> 'one',getUserViews:async()=>({Items:[{Id:'zero',Name:'动漫',CollectionType:'movies'},{Id:'one',Name:'电影',CollectionType:'movies'}]}),
   getResumableItems:async()=>({Items:[]}),getItems:async(user,q)=>({Items:[0,1].map(i=>({Id:q.ParentId+'-'+i,Type:'Movie',Name:'作品'+i,DateCreated:'2026-10-0'+(9-i),ImageTags:{Primary:'art'}}))}),getImageUrl:()=>location.origin+'/poster.svg'};
  const gallery=window.gallery=new TigerestHomeGallery(document.getElementById('home'),{apiProvider:()=>api,router:{showItem:item=>opened.push(item.Id),showFavorites:()=>opened.push('favorites')},artBase:'/art'});
  await gallery.start();await wait(()=>gallery.root.classList.contains('tg-entered'));
  const originalTimings=gallery.animations.map(a=>a.effect.getTiming());
  check(originalTimings.some(a=>a.duration===1380)&&originalTimings.some(a=>a.duration===1460&&a.delay===200),'original entrance keyframes are retained');
  const tap=node=>{node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));node.click();};
  tap(gallery.libraryList.querySelector('[data-library-id=zero]'));check(opened.at(-1)==='zero','the currently focused library opens on the first touch');opened.length=0;
  const library=gallery.libraryList.querySelector('[data-library-id=one]');tap(library);check(opened.length===0,'first library touch must not route');await wait(()=>gallery.cards[0]?.item.Id==='one-0');
  check(opened.length===0&&gallery.selectedLibrary.Id==='one','first library touch previews without routing');
  tap(library);check(opened.at(-1)==='one','second library touch opens the selected library');
  const count=opened.length,cover=gallery.coverList.children[1];tap(cover);
  check(opened.length===count&&gallery.index===1,'first poster touch selects without routing');
  tap(cover);check(opened.at(-1)==='one-1'&&opened.length===count+1,'second poster touch opens the selected work');
  gallery.select(0,false);const beforeCurrent=opened.length;tap(gallery.coverList.children[0]);check(opened.length===beforeCurrent+1&&opened.at(-1)==='one-0','an automatically selected poster opens on the first touch');
  // Native touch focuses the button before click. Previewing that focus must not
  // accidentally turn the first tap on another library into direct navigation.
  const nextLibrary=gallery.libraryList.querySelector('[data-library-id=zero]');nextLibrary.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));nextLibrary.focus();const beforeSwitch=opened.length;nextLibrary.click();check(opened.length===beforeSwitch,'first touch on a different library selects despite the preceding focus event');
  await gallery.preview('zero');gallery.more.click();check(opened.at(-1)==='zero','more follows the currently previewed library');
  check(gallery.more.textContent.includes('查看更多')&&!gallery.root.textContent.includes('再点'),'more is available without a second-tap instruction');
  gallery.coverList.children[0].click();check(opened.at(-1)==='zero-0','mouse and keyboard activation remain immediate');
  gallery.destroy();return {checks:11,navigation:opened};
 }).toString()+')()');assert.equal(result.checks,11);console.log('touch/gallery checks:',JSON.stringify(result));
},{gpu:true,visible:true}).catch(error=>{console.error(error);process.exitCode=1;});
