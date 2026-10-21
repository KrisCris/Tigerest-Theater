// Regenerates release_feed_cases.json: Ed25519 vectors and signed release-feed envelopes for
// test_release_feed / test_appupdater (C++) and ReleaseFeedTest (Android). The test key is derived
// from a fixed seed, so the output is reproducible.  node tests/fixtures/make_release_feed_cases.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';

const der = seed => crypto.createPrivateKey({key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8'});
const raw = key => crypto.createPublicKey(key).export({format: 'der', type: 'spki'}).subarray(12);
const sign = (key, message) => crypto.sign(null, message, key);

// RFC 8032 section 7.1, tests 1-3: Node must reproduce the published signatures.
const rfc = [
  ['9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', '',
   'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
  ['4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '72',
   '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
  ['c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'af82',
   '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'],
];
const ed25519 = rfc.map(([seed, message, expected], i) => {
  const key = der(Buffer.from(seed, 'hex'));
  const signature = sign(key, Buffer.from(message, 'hex')).toString('hex');
  if (signature !== expected) throw new Error(`RFC 8032 test ${i + 1} differs: ${signature}`);
  return {name: `rfc8032-${i + 1}`, publicKey: raw(key).toString('hex'), message, signature, valid: true};
});

const testKey = der(Buffer.from(Array.from({length: 32}, (_, i) => i + 1)));
const otherKey = der(Buffer.alloc(32, 7));
const publicKey = raw(testKey);
const long = Buffer.from(Array.from({length: 1023}, (_, i) => (i * 31 + 7) & 255));
const good = sign(testKey, long);
const flip = (buffer, index) => { const copy = Buffer.from(buffer); copy[index] ^= 1; return copy; };
// S + L is the same point but not canonical; RFC 8032 requires rejecting it.
const order = (1n << 252n) + 27742317777372353535851937790883648493n;
const scalar = BigInt('0x' + Buffer.from(good.subarray(32)).reverse().toString('hex')) + order;
const malleable = Buffer.concat([good.subarray(0, 32), Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex').reverse()]);
const vector = (name, message, signature, valid, key = publicKey) =>
  ({name, publicKey: key.toString('hex'), message: message.toString('hex'), signature: signature.toString('hex'), valid});
ed25519.push(
  vector('long-message', long, good, true),
  vector('flipped-r', long, flip(good, 3), false),
  vector('flipped-s', long, flip(good, 40), false),
  vector('flipped-message', flip(long, 500), good, false),
  vector('other-key', long, good, false, raw(otherKey)),
  vector('non-canonical-s', long, malleable, false));

const now = '2026-10-21T10:05:00Z';
// The same release the C++ and Android updater tests offer from GitHub.
const release = tag => ({tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/Tigerest/Tigerest-Theater/releases/tag/${tag}`,
  published_at: '2026-10-21T09:00:00Z', body: 'Notes', assets: ['x64.exe', 'android.apk'].map(suffix => {
    const name = `TigerestTheater-${tag.slice(1)}-${suffix}`;
    return {name, state: 'uploaded', size: 3, digest: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      browser_download_url: `https://github.com/Tigerest/Tigerest-Theater/releases/download/${tag}/${name}`};
  })});
const payload = (fields = {}) => ({schema: 1, repository: 'Tigerest/Tigerest-Theater', issuedAt: '2026-10-21T10:04:00Z',
  fetchedAt: '2026-10-21T10:00:00Z', releases: [release('v2.0.0')], ...fields});
const envelope = (body, {keyId = 'test-1', key = testKey, edit} = {}) => {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const result = {keyId, payload: bytes.toString('base64'), signature: sign(key, bytes).toString('base64')};
  return JSON.stringify(edit ? edit(result) : result);
};
const envelopes = [
  ['valid', envelope(payload()), ''],
  ['issued-ten-minutes-ahead', envelope(payload({issuedAt: '2026-10-21T10:15:00Z'})), ''],
  ['issued-in-the-future', envelope(payload({issuedAt: '2026-10-21T10:15:01Z'})), 'issuedAt in the future'],
  ['fetched-72-hours-ago', envelope(payload({fetchedAt: '2026-10-18T10:05:00Z'})), ''],
  ['stale', envelope(payload({fetchedAt: '2026-10-18T10:04:59Z'})), 'release list older than 72 hours'],
  ['fetched-after-issued', envelope(payload({fetchedAt: '2026-10-21T10:04:01Z'})), 'fetchedAt after issuedAt'],
  ['fractional-timestamp', envelope(payload({issuedAt: '2026-10-21T10:04:00.000Z'})), 'bad timestamps'],
  ['schema-2', envelope(payload({schema: 2})), 'unexpected schema or repository'],
  ['schema-string', envelope(payload({schema: '1'})), 'unexpected schema or repository'],
  ['other-repository', envelope(payload({repository: 'someone/Tigerest-Theater'})), 'unexpected schema or repository'],
  ['releases-missing', envelope(payload({releases: {}})), 'releases missing'],
  ['payload-array', envelope([payload()]), 'payload is not an object'],
  ['unknown-key', envelope(payload(), {keyId: 'test-9'}), 'unknown keyId'],
  ['other-key', envelope(payload(), {key: otherKey}), 'bad signature'],
  ['tampered-payload', envelope(payload(), {edit: e => ({...e, payload: Buffer.from(JSON.stringify(payload({body: 'x'}))).toString('base64')})}), 'bad signature'],
  ['payload-not-base64', envelope(payload(), {edit: e => ({...e, payload: '!' + e.payload})}), 'payload or signature missing or not base64'],
  ['signature-missing', envelope(payload(), {edit: ({signature, ...rest}) => rest}), 'payload or signature missing or not base64'],
  ['not-json', 'releases', 'unknown keyId'],
].map(([name, body, reason]) => ({name, envelope: body, reason}));

const out = new URL('./release_feed_cases.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({now, keyId: 'test-1', publicKey: publicKey.toString('base64'), ed25519, envelopes}, null, 1) + '\n');
console.log(`wrote ${ed25519.length} vectors and ${envelopes.length} envelopes`);
