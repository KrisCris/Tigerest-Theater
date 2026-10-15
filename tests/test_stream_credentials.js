const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {console, URL, window: {}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'native', 'mpvVideoPlayer.js'), 'utf8'),
    context, {filename: 'mpvVideoPlayer.js'});
const authorize = context.window._tigerestAuthorizedStreamUrl;
assert.strictEqual(typeof authorize, 'function');

const client = (server, token = 'fixture-token') => ({serverAddress: () => server, accessToken: () => token});
const servers = {
    home: client('https://emby.example.test'),
    other: client('http://192.168.1.2:8096', 'other-token'),
};
const manager = {getApiClient(id) { return servers[id]; }};
const item = {ServerId: 'home'};
const stream = 'https://emby.example.test/emby/videos/34976/stream?Static=true&MediaSourceId=mediasource_34976';

assert.strictEqual(authorize(stream, item, manager), stream + '&api_key=fixture-token',
    'a same-server stream without credentials must carry the session token');
assert.strictEqual(authorize('https://emby.example.test/emby/Audio/7/universal', item, manager),
    'https://emby.example.test/emby/Audio/7/universal?api_key=fixture-token');
assert.strictEqual(authorize('https://emby.example.test/videos/1/stream?', item, manager),
    'https://emby.example.test/videos/1/stream?api_key=fixture-token');
assert.strictEqual(authorize('https://emby.example.test/videos/1/stream?a=1#t=5', item, manager),
    'https://emby.example.test/videos/1/stream?a=1&api_key=fixture-token#t=5');
assert.strictEqual(authorize('https://emby.example.test/videos/1/stream?a=b%20c', {ServerId: 'home'}, manager),
    'https://emby.example.test/videos/1/stream?a=b%20c&api_key=fixture-token',
    'existing query encoding must be preserved');

for (const existing of ['api_key=abc', 'ApiKey=abc', 'X-Emby-Token=abc', 'x-mediabrowser-token=abc']) {
    const url = `${stream}&${existing}`;
    assert.strictEqual(authorize(url, item, manager), url, `${existing} must be kept as the only credential`);
}

for (const foreign of [
    'https://cdnfhnfile.115cdn.net/file.mkv?t=1',
    'http://emby.example.test/emby/videos/1/stream',
    'https://emby.example.test:8920/emby/videos/1/stream',
    'https://sub.emby.example.test/emby/videos/1/stream',
]) {
    assert.strictEqual(authorize(foreign, item, manager), foreign, `token leaked to ${foreign}`);
}

assert.strictEqual(authorize('http://192.168.1.2:8096/videos/1/stream', {ServerId: 'other'}, manager),
    'http://192.168.1.2:8096/videos/1/stream?api_key=other-token',
    'the item server client must be used');
assert.strictEqual(authorize('http://192.168.1.2:8096/videos/1/stream', item, manager),
    'http://192.168.1.2:8096/videos/1/stream', 'another server must not receive this item server token');

context.window.ApiClient = client('https://emby.example.test', 'current-token');
assert.strictEqual(authorize(stream, {}, null), stream + '&api_key=current-token',
    'without a server id the current client is used');
assert.strictEqual(authorize(stream, {ServerId: 'missing'}, manager), stream + '&api_key=current-token');
assert.strictEqual(authorize(stream, item, {getApiClient() { throw new Error('gone'); }}),
    stream + '&api_key=current-token');
context.window.ApiClient = client('https://emby.example.test', '');
assert.strictEqual(authorize(stream, {}, null), stream, 'a signed-out client must not add an empty token');
context.window.ApiClient = client('not a url');
assert.strictEqual(authorize(stream, {}, null), stream);
delete context.window.ApiClient;
assert.strictEqual(authorize(stream, {}, null), stream);
assert.strictEqual(authorize('/videos/1/stream', item, manager), '/videos/1/stream');
assert.strictEqual(authorize('C:\\media\\local.mkv', item, manager), 'C:\\media\\local.mkv');

console.log('stream credential tests passed');
