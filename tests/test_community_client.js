const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(crypto = require('node:crypto').webcrypto) {
    const context = { URL, AbortController, setTimeout, clearTimeout, crypto };
    context.window = context;
    const file = path.join(__dirname, '../native/communityClient.js');
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    assert.equal(typeof context.TigerestCommunityClient, 'function', 'comment API client must be available');
    return context.TigerestCommunityClient;
}
function session(address = 'http://nas.tigerest.top:8095', token = 'test-only-token') {
    return { serverId: '62526c3bf747439c99327ddec5fed4a8', userId: 'user1', token, address };
}
function ok(data) { return new Response(JSON.stringify({data}), {status: 200}); }

test('trusted server routes LAN and remote on shared HTTP18443; other servers never receive tokens', async () => {
    const Client = load(), calls = [];
    const client = new Client({fetch: async (url, options) => {calls.push({url, options}); return ok({});}});
    client.setContext(session('http://192.168.5.150:8095'), 'item1');
    await client.me();
    assert.equal(calls[0].url, 'http://192.168.5.150:18443/community/v1/me');
    assert.equal(calls[0].options.headers['X-Emby-Token'], 'test-only-token');
    client.setContext(session(), 'item2');
    await client.resolve('episode');
    assert.equal(calls[1].url, 'http://nas.tigerest.top:18443/community/v1/topics/resolve');
    assert.deepEqual(JSON.parse(calls[1].options.body), {itemId:'item2', scope:'episode'});
    assert.equal(client.setContext({...session(), serverId:'other'}, 'item1'), false);
    await assert.rejects(client.me(), /登录/);
    assert.equal(calls.length, 2);
});
test('comments and replies carry item authorization and encode opaque cursors', async () => {
    const Client = load(), calls = [];
    const client = new Client({fetch:async (url, options) => {calls.push({url, options}); return ok({items:[]});}});
    client.setContext(session(), 'a/b');
    await client.comments('topic1', 'a+/=');
    await client.replies('root1', 'opaque cursor');
    await client.remove('comment1');
    for (const call of calls) assert.equal(call.options.headers['X-Tigerest-Item-Id'], 'a/b');
    assert.equal(new URL(calls[0].url).searchParams.get('cursor'), 'a+/=');
    assert.equal(calls[2].options.method, 'DELETE');
});
test('lost response retry reuses payload UUID; different text uses a new UUID', async () => {
    const Client = load(), bodies = []; let now = 1000;
    const client = new Client({now:() => now, fetch:async (url, options) => {
        bodies.push(JSON.parse(options.body));
        if (bodies.length === 1) throw new TypeError('network details containing test-only-token');
        return ok({comment:{id:'saved'}});
    }});
    client.setContext(session(), 'item');
    await assert.rejects(client.send('topic', ' 你好 ', null), /网络/);
    await client.send('topic', ' 你好 ', null);
    assert.equal(bodies[0].clientRequestId, bodies[1].clientRequestId);
    assert.match(bodies[0].clientRequestId, /^[0-9a-f-]{36}$/);
    now += 3000;
    await client.send('topic', '另一条', {rootId:'root', id:'reply'});
    assert.notEqual(bodies[2].clientRequestId, bodies[1].clientRequestId);
    assert.equal(bodies[2].replyToId, 'reply');
});
test('account/item change aborts in-flight reads and rejects stale responses', async () => {
    const Client = load(); let release, signal;
    const client = new Client({fetch: (url, options) => {signal=options.signal; return new Promise(r => release=r);}});
    client.setContext(session(), 'old');
    const pending = client.comments('old-topic');
    client.setContext(session(undefined, 'new-token'), 'new');
    assert.equal(signal.aborted, true);
    release(ok({items:[{body:'old private text'}]}));
    await assert.rejects(pending, error => error.name === 'AbortError');
});
test('429 blocks writes until Retry-After and errors do not expose server messages or tokens', async () => {
    const Client = load(); let now = 1000, calls=0;
    const client = new Client({now:() => now, fetch:async () => {
        calls++; return new Response(JSON.stringify({error:{code:'RATE_LIMITED', message:'test-only-token'}}),
            {status:429, headers:{'Retry-After':'5'}});
    }});
    client.setContext(session(), 'item');
    await assert.rejects(client.send('topic', 'text'), error => error.retryAfter===5 && !error.message.includes('test-only-token'));
    await assert.rejects(client.send('topic', 'text'), /5 秒/);
    assert.equal(calls, 1);
    now += 5000;
    await assert.rejects(client.send('topic', 'text'));
    assert.equal(calls, 2);
});
test('avatar paths cannot exfiltrate credentials and plaintext length counts Unicode', async () => {
    const Client = load(); let calls=0;
    const client = new Client({fetch:async () => {calls++; return new Response(new Uint8Array([1]), {headers:{'Content-Type':'image/png'}});}});
    client.setContext(session(), 'item');
    await assert.rejects(client.avatar('https://evil.invalid/avatar'));
    await assert.rejects(client.send('topic', '😀'.repeat(2001)), /2000/);
    assert.equal(calls, 0);
    const blob = await client.avatar('/community/v1/avatars/author?v=123');
    assert.equal(blob.type, 'image/png');
});
test('HTTP pages without randomUUID still generate valid idempotency UUIDs', async () => {
    const webcrypto=require('node:crypto').webcrypto;
    const Client=load({getRandomValues:webcrypto.getRandomValues.bind(webcrypto)});
    let payload;
    const client=new Client({fetch:async (url,options)=>{payload=JSON.parse(options.body);return ok({});}});
    client.setContext(session(),'item');await client.send('topic','HTTP 正文');
    assert.match(payload.clientRequestId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
