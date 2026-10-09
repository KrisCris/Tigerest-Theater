const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Signal {
    constructor() { this.handlers = new Set(); }
    connect(fn) { this.handlers.add(fn); }
    disconnect(fn) { this.handlers.delete(fn); }
    emit(...args) { for (const fn of this.handlers) fn(...args); }
}
async function verify(isAndroid) {
    const sources = new Map(), selections = [], snapshots = [], intervals = new Map();
    const playlist = [1,2].map(n=>({Id:'media',PlaylistItemId:'q'+n,Name:'Episode '+n,
        IndexNumber:n,ParentIndexNumber:1,MediaSources:[{Path:'private-server-path'}],Overview:'large metadata'}));
    let current = 'q2', index = 1, timer = 0;
    const manager = {
        _currentPlayer: {id:'native'},
        _playQueueManager: {getPlaylist:()=>playlist, getCurrentPlaylistIndex:()=>index},
        getCurrentPlaylistItemId:()=>current, getPlayerState:()=> ({NowPlayingItem:{MediaType:'Video'}}),
        currentTime:()=>0, duration:()=>100000000,
        setCurrentPlaylistItem: (id,player) => { selections.push([id,player.id]); return Promise.resolve(); },
    };
    const signal = new Signal();
    const api = {
        system:{isAndroid,hello(){}},
        player:new Proxy({streamingBitrateRequested:signal, playbackRateChanged:new Signal(),
            setWebPlaylist:(list,id)=>snapshots.push({list,id})},{get:(target,key)=>target[key]||(()=>{})}),
        input:{hostInput:new Signal(),playlistItemRequested:new Signal(),volumeChanged:new Signal(),rateChanged:new Signal(),positionSeek:new Signal()},
    };
    const events = {
        on(source,event,fn) { if(!sources.has(source)) sources.set(source,new Map()); sources.get(source).set(event,fn); },
        off(){}, trigger(source,event,...args) { sources.get(source)?.get(event)?.({},...args); },
    };
    const sandbox = {console,Promise,Number,setInterval:fn=>{intervals.set(++timer,fn);return timer;},clearInterval:id=>intervals.delete(id),
        window:{api,apiPromise:Promise.resolve(api),Events:events,jmpInfo:{settings:{main:{fullscreen:false}},settingsUpdate:[]}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../native/inputPlugin.js'),'utf8'),sandbox);
    const plugin = new sandbox.window._inputPlugin({inputManager:{handleCommand(){}},playbackManager:manager});
    await new Promise(r=>setImmediate(r));
    events.trigger(manager,'playbackstart',manager._currentPlayer);
    assert.equal(snapshots.at(-1)?.id,'q2','playbackstart synchronizes even when playing happened before listener attachment');
    assert.deepEqual(JSON.parse(JSON.stringify(snapshots.at(-1).list)),playlist.map(({Id,PlaylistItemId,Name,IndexNumber,ParentIndexNumber})=>
        ({Id,PlaylistItemId,Name,IndexNumber,ParentIndexNumber})),'native controls receive only queue identity and episode labels');
    const count=snapshots.length;
    events.trigger(manager._currentPlayer,'playing');
    const poll=[...intervals.values()][0];
    assert.ok(poll,'playing starts the guarded queue poll');
    poll();
    assert.equal(snapshots.length,count+1,'unchanged periodic polls do not republish the queue; playing forces one sync after native load');
    current='q1';index=0;
    poll();
    assert.equal(snapshots.at(-1).id,'q1','a silent Emby queue change still updates native controls');
    api.input.hostInput.emit(['playlist-item:q2','playlist-item:media','playlist-item:stale']);
    if(isAndroid) api.input.playlistItemRequested.emit('q1');
    await new Promise(r=>setImmediate(r));
    assert.deepEqual(selections,isAndroid?[['q2','native'],['q1','native']]:[['q2','native']],
        'all platforms select by queue identity and reject stale or media IDs');
    playlist.length=0;current='';index=-1;
    events.trigger(manager,'playlistitemchange');
    assert.equal(snapshots.at(-1).list.length,0,'empty queues clear native episode lists');
    plugin.destroy();
}
(async()=>{await verify(true);await verify(false);console.log('PASS: shared Emby queue synchronization, lean payload and native episode selection');})()
    .catch(error=>{console.error(error);process.exitCode=1;});
