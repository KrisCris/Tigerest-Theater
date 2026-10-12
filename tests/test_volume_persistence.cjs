// Exercise both shipped web plugins through the real QWebChannel/mpv bridge.
// The only Emby substitute is a local event bus and isolated localStorage.
const assert=require('node:assert/strict');
const withBrowser=require('./community_browser.cjs');
const frames=48000*20, wav=Buffer.alloc(44+frames*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
const routes={
    '/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Volume persistence fixture</title>'},
    '/silence.wav':{type:'audio/wav',body:wav},
};

async function run(){
    await withBrowser(routes,async({evaluate})=>{
        const result=await evaluate('('+ (async function(){
            const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error(label);};
            await wait(()=>window.api?.player&&window._mpvVideoPlayer&&window._inputPlugin,'native player bridge');
            const subscriptions=new Map();
            const events={
                on(target,name,fn){if(!subscriptions.has(target))subscriptions.set(target,new Map());const names=subscriptions.get(target);if(!names.has(name))names.set(name,new Set());names.get(name).add(fn);},
                off(target,name){subscriptions.get(target)?.delete(name);},
                trigger(target,name,args=[]){for(const fn of subscriptions.get(target)?.get(name)||[])fn({},...args);},
            };
            window.Events=events;
            const item={Id:'volume-fixture',Name:'Volume fixture',MediaType:'Video'};
            const manager={getPlayerState:()=>({NowPlayingItem:item}),currentTime:()=>0,duration:()=>20000,
                getCurrentPlaylistItemId:()=>'',_playQueueManager:{getPlaylist:()=>[],getCurrentPlaylistIndex:()=>-1}};
            window.playbackManager=manager;
            const plugin=new window._inputPlugin({inputManager:{handleCommand(){}},playbackManager:manager});
            await new Promise(r=>setTimeout(r,50));
            const settings={get:key=>localStorage.getItem(key),set:(key,value)=>localStorage.setItem(key,String(value))};
            const create=()=>new window._mpvVideoPlayer({events,appSettings:settings,loading:{show(){},hide(){}},
                appRouter:{showVideoOsd(){}},dashboard:{default:{setBackdropTransparency(){}}}});
            const options={url:location.origin+'/silence.wav',fullscreen:false,playerStartPositionTicks:0,item,
                mediaSource:{DefaultSubtitleStreamIndex:null,DefaultAudioStreamIndex:0,MediaStreams:[]}};
            const rows=[];
            // Reproduce an installed profile already damaged by the old
            // volume feedback bug, not only a pristine browser profile.
            localStorage.setItem('volume','0');
            localStorage.removeItem('tigerest-mpv-volume-v2');
            for(const expected of [100,37,0]){
                let player=create();manager._currentPlayer=player;
                await player.play(options);
                if(expected!==100)player.setVolume(expected);
                events.trigger(manager,'playbackstart',[player]);
                // Native signals are asynchronous, including the erroneous
                // web -> native -> web feedback that used to decay to zero.
                await new Promise(r=>setTimeout(r,350));
                const observed={expected,web:player.getVolume(),native:await window.api.player.volume(),saved:Number(settings.get('volume'))};
                if(observed.web!==expected||observed.native!==expected||observed.saved!==expected/100)
                    throw Error('volume notification corrupted remembered volume: '+JSON.stringify(observed));
                await player.stop(true);player.destroy();
                player=create();manager._currentPlayer=player;
                await player.play(options);
                events.trigger(manager,'playbackstart',[player]);
                await new Promise(r=>setTimeout(r,150));
                observed.restored=await window.api.player.volume();
                if(observed.restored!==expected)throw Error('new player restored wrong volume: '+JSON.stringify(observed));
                rows.push(observed);
                await player.stop(true);player.destroy();
            }
            plugin.destroy();
            return rows;
        }).toString()+')()');
        assert.deepEqual(result.map(row=>row.restored),[100,37,0]);
        console.log(JSON.stringify({volumePersistence:result,scope:'real QWebChannel/mpv; isolated web storage; player recreation'},null,2));
    },{startupTimeout:30000,settings:{mpv:{enableDanmaku:false}}});
}
run().catch(error=>{console.error(error);process.exitCode=1;});
