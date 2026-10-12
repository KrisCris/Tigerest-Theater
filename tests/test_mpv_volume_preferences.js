const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const context = vm.createContext({window: {}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/mpvVideoPlayer.js'), 'utf8'), context);
const prototype = context.window._mpvVideoPlayer.prototype;

function playerFor(entries = []) {
    const saved = new Map(entries);
    const player = Object.create(prototype);
    player.appSettings = {get: key => saved.get(key), set: (key, value) => saved.set(key, value)};
    return {player, saved};
}

test('first initialization starts at 100 despite a legacy zero from the old feedback bug', () => {
    for (const old of [undefined, null, '', '0', 0, 'invalid', -1]) {
        const {player} = playerFor([['volume', old]]);
        assert.equal(player.getSavedVolume(), 1, 'legacy value ' + String(old));
    }
});

test('existing nonzero volume is retained while starting the new persistence format', () => {
    assert.equal(playerFor([['volume', '0.37']]).player.getSavedVolume(), 0.37);
});

test('an intentional zero saved by the fixed player survives recreation and later legacy writes', () => {
    const {player, saved} = playerFor([['volume', 0]]);
    player.saveVolume(0);
    saved.set('volume', 1); // A different Emby web player can write the shared legacy key.
    const restarted = playerFor(saved).player;
    assert.equal(restarted.getSavedVolume(), 0);
});

test('native volume observations save the new value and maintain the Emby compatibility value', () => {
    const {player, saved} = playerFor();
    player.saveVolume(0.37);
    assert.equal(saved.get('volume'), 0.37);
    saved.set('volume', 0);
    assert.equal(playerFor(saved).player.getSavedVolume(), 0.37);
    player.saveVolume(NaN);
    player.saveVolume(-1);
    assert.equal(playerFor(saved).player.getSavedVolume(), 0.37);
});

test('preference write failures do not block initial playback or manual volume changes', async () => {
    const {player} = playerFor([['volume', 0]]);
    const writes = [];
    player.appSettings.set = key => { writes.push(key); throw Error('QuotaExceededError'); };
    let nativeVolume, loaded = false;
    context.jmpInfo = {userAgent: 'VolumeTest'};
    context.window.api = {player: {
        setVolume: value => { nativeVolume = value; },
        load: (...args) => { loaded = true; args.at(-1)(true); }
    }};
    player.events = {trigger() {}};
    await player.setCurrentSrc(null, {url: 'fixture.wav', item: {}, mediaSource: {MediaStreams: []}});
    assert.equal(loaded, true);
    assert.equal(nativeVolume, 100);
    assert.equal(player._volumeInitialized, true);
    player.setVolume(37);
    assert.equal(nativeVolume, 37);
    assert.deepEqual(writes, ['tigerest-mpv-volume-v2', 'volume', 'tigerest-mpv-volume-v2', 'volume']);
});
