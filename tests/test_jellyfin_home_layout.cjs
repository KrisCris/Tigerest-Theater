// Actual browser geometry for the Jellyfin shells observed in 10.9–12.2.
// This catches retained navigation space, missing Modern safe area, and styles
// leaking from the replacement home into favorites/details.
const path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const root = path.resolve(__dirname, '..');
withBrowser({
    '/': {type: 'text/html', body: `<!doctype html><html><head>
      <style>
      html,body {margin:0;font-size:16px;} .hide {display:none!important;}
      #reactRoot {position:relative;display:flex;flex-direction:column;min-height:100vh;}
      .page {box-sizing:border-box;min-height:100vh;}
      .skinHeader {position:fixed;top:0;left:0;right:0;}
      .MuiAppBar-positionFixed {position:fixed;top:0;left:0;right:0;display:flex;flex-direction:column;}
      .toolbar {height:48px;flex:none;} main {position:relative;flex:1;}
      .legacy .page {padding-top:7.5em;} .modern10 .page {padding-top:3.25rem;}
      </style><link rel="stylesheet" href="/android.css">
      <script>window.jmpInfo={settings:{home:{}},capabilities:{desktopWindowControls:false}};</script>
      <script src="/home.js"></script><script src="/jellyfin.js"></script>
      </head><body><div id="reactRoot"></div></body></html>`},
    '/home.js': {path: path.join(root, 'native/homeGallery.js')},
    '/jellyfin.js': {path: path.join(root, 'native/jellyfinPlugin.js')},
    '/android.css': {type: 'text/css', path: path.join(root, 'android/app/src/main/assets/androidResponsive.css')}
}, async ({evaluate, call}) => {
    await call('Emulation.setDeviceMetricsOverride', {width:847,height:948,deviceScaleFactor:1,mobile:true});
    // Isolate layout from the native host's optional page entrance animation.
    await call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    console.log(await evaluate('(' + (async function () {
        const check = (ok, message) => {if (!ok) throw Error(message);};
        // Qt can suspend animation frames for an occluded test window.
        const settle = () => new Promise(resolve => setTimeout(resolve, 100));
        document.documentElement.style.setProperty('--tgs-safe-top', '32px');
        const results = [];
        for (const layout of ['legacy', 'modern10', 'modern12']) {
            const root = document.getElementById('reactRoot');
            root.className = layout;
            const modern = layout !== 'legacy';
            root.innerHTML = `<header class="${modern ? 'MuiAppBar-positionFixed' : 'skinHeader'}"><button class="toolbar">Navigation</button></header>`
                // The real Modern shell reserves its measured 48px toolbar plus
                // the 32px Android safe area. Server/device tests cover its observer.
                + (layout === 'modern12' ? '<div aria-hidden="true" style="height:80px"></div>' : '')
                + '<main><div class="page withTabs pageWithAbsoluteTabs"><div id="homeTab"><div class="sections">Original home</div></div><div id="favorites" class="hide">Favorites</div></div></main>';
            const header = root.querySelector('header'), page = root.querySelector('.page');
            const spacer = layout === 'modern12' ? header.nextElementSibling : null;
            await settle();
            const originalTop = document.getElementById('homeTab').getBoundingClientRect().top;
            check(originalTop > 40, layout + ': fixture includes navigation space');
            const plugin = new _tigerestJellyfinPlugin({events:{on(){}},appRouter:{},ServerConnections:{currentApiClient:()=>null}});
            await settle();
            const homeTop = document.querySelector('.tg-home').getBoundingClientRect().top;
            check(Math.abs(homeTop) < 1, layout + ': home has no navigation gap ' + JSON.stringify({homeTop,
                body:document.body.className,page:page.className,padding:getComputedStyle(page).paddingTop,
                style:document.getElementById('tigerest-jellyfin-home-style')?.textContent}));
            check(getComputedStyle(document.querySelector('.tg-home')).paddingTop === '42px', layout + ': gallery owns safe top once');
            check(header.getBoundingClientRect().height === 0, layout + ': original header hidden');
            document.getElementById('homeTab').classList.add('hide');
            document.getElementById('favorites').classList.remove('hide');
            document.dispatchEvent(new Event('viewshow'));
            await settle();
            check(header.getBoundingClientRect().height > 0, layout + ': favorites restores header');
            check(Math.abs(document.getElementById('favorites').getBoundingClientRect().top - originalTop) < 1, layout + ': favorites restores navigation space');
            if (layout === 'modern12') {
                check(header.querySelector('button').getBoundingClientRect().top >= 32, 'Modern controls clear Android status bar');
                check(spacer.getBoundingClientRect().height === header.getBoundingClientRect().height, 'Modern spacer includes safe area');
            }
            document.getElementById('favorites').classList.add('hide');
            document.getElementById('homeTab').classList.remove('hide');
            document.dispatchEvent(new Event('viewshow'));
            await settle();
            check(Math.abs(document.querySelector('.tg-home').getBoundingClientRect().top) < 1, layout + ': return to home removes gap again');
            plugin.home.destroy();
            await settle();
            check(!document.body.classList.contains('tg-home-active'), layout + ': teardown releases chrome');
            check(!page.classList.contains('tg-jellyfin-home-page'), layout + ': teardown releases shell');
            check(header.getBoundingClientRect().height > 0, layout + ': detail/teardown restores header');
            results.push(layout + ' PASS');
        }
        return results.join(', ');
    }).toString() + ')()'));
}, {gpu:true,visible:process.argv.includes('--webengine'),startupTimeout:30000})
    .catch(error => {console.error(error);process.exitCode = 1;});
