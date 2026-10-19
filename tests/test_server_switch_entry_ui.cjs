// Exercise the real entry installer; native navigation is the boundary double.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const withBrowser = require('./community_browser.cjs');
const shell = fs.readFileSync(path.join(__dirname, '../native/nativeshell.js'), 'utf8');
const installer = shell.slice(shell.indexOf('function installServerSwitchEntry()'), shell.indexOf('\ninstallServerSwitchEntry();'));
withBrowser({'/': {type:'text/html', body:`<!doctype html><meta charset="utf-8"><body><script>window.switches=0;window.tigerestSwitchServer=()=>switches++;</script><script>${installer};installServerSwitchEntry();</script>`}}, async ({evaluate}) => {
    for (const host of ['headerRight', 'tigerest-header-actions', 'tg-home-nav-heading']) {
        await evaluate(`document.body.innerHTML='<div class="${host}"><button class="headerUserButton">Account</button></div>'`);
        await new Promise(r=>setTimeout(r,80));
        assert.equal(await evaluate(`document.querySelectorAll('.${host} .tigerest-switch-toolbar').length`),1,host+': direct entry exists');
        assert.equal(await evaluate(`document.querySelector('.tigerest-switch-toolbar').textContent`),'服务器');
        assert.equal(await evaluate(`document.querySelector('.tigerest-switch-toolbar').getAttribute('aria-label')`),'切换服务器');
        const before = await evaluate('switches');
        await evaluate(`document.querySelector('.tigerest-switch-toolbar').click()`);
        assert.equal(await evaluate('switches'), before+1,host+': native chooser invoked once');
        await evaluate(`document.querySelector('.${host}').append(document.createElement('span'))`);
        await new Promise(r=>setTimeout(r,80));
        assert.equal(await evaluate(`document.querySelectorAll('.${host} .tigerest-switch-toolbar').length`),1,'mutation does not duplicate');
    }
    await evaluate(`document.body.innerHTML='<div class="standalonePage"><h1>Login</h1></div>'`);
    await new Promise(r=>setTimeout(r,80));
    assert.equal(await evaluate(`document.querySelector('.tigerest-switch-entry').textContent`),'切换服务器','logged-out pages keep their explicit entry');
    console.log(JSON.stringify({passed:true,hosts:3,standalone:true}));
}).catch(error=>{console.error(error);process.exitCode=1;});
