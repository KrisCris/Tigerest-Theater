const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {run, delay} = require('./cdp.cjs');
const media = path.resolve(__dirname, '../test-artifacts/playback-fixture.mp4');
let releaseLoading = false;
const pending = [];

function serveMedia(req, res) {
  if (res.destroyed) return;
  const total = fs.statSync(media).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? +range[1] : 0;
  const end = range?.[2] ? Math.min(+range[2], total - 1) : total - 1;
  if (start >= total) { res.writeHead(416); res.end(); return; }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    ...(range ? {'Content-Range': `bytes ${start}-${end}/${total}`} : {})
  });
  fs.createReadStream(media, {start, end}).pipe(res);
}

require('./media_fixture.cjs')(async ({c, url, wait, shot}) => {
  const info = () => c.evaluate('api.system.debugInformation()');
  const originalHardware = await c.evaluate('api.settings.value("video","hardwareDecoding")');
  if (process.env.TIGEREST_TEST_HWDEC) await c.evaluate(`api.settings.setValue("video","hardwareDecoding",${JSON.stringify(process.env.TIGEREST_TEST_HWDEC)})`);
  const load = (name, autoplay = true) => c.evaluate(`api.player.load(${JSON.stringify(url + '/' + name)}, {autoplay:${autoplay},startMilliseconds:10000}, {type:'video',metadata:{Name:'加载与长按倍速验收'}}, 1, -1)`);
  const touch = (action, x, y) => run('shell', 'input', 'motionevent', action, String(Math.round(x)), String(Math.round(y)));
  await load('loading.mp4');
  await wait('api.system.debugInformation().then(d=>d.videoVisible&&d.controls.loading&&d.controls.opening)', 'opening video displays its native loading indicator');
  shot('player-opening-spinner');
  releaseLoading = true;
  for (const [req, res] of pending.splice(0)) serveMedia(req, res);
  await wait('api.system.debugInformation().then(d=>d.active&&!d.controls.opening&&!d.controls.loading)');
  await wait('api.player.getPosition().then(p=>p>10500)');
  const ready = await info(), originalSpeed = ready.controls.speed;
  const bounds = ready.videoBounds;
  const x = (bounds.left + bounds.right) / 2;
  const y = bounds.top + (bounds.bottom - bounds.top) * .45;
  const rate = async speed => {
    await c.evaluate(`api.player.setPlaybackRate(${speed * 1000})`);
    await wait(`api.system.debugInformation().then(d=>d.controls.speed===${speed})`);
  };
  const hold = async expected => {
    // Keep independent presses outside Android's double-tap window.
    await delay(400);
    touch('DOWN', x, y);
    await wait(`api.system.debugInformation().then(d=>d.controls.temporarySpeed&&d.controls.speed===${expected})`, 'long press enters temporary speed');
    assert.ok((await info()).controls.gesture.includes('松手恢复'), 'hold hint remains visible');
  };
  try {
    await rate(1.25);
    const gestureWidth = bounds.right - bounds.left;
    const gestureHeight = bounds.bottom - bounds.top;
    touch('DOWN', x, y);
    touch('MOVE', x + gestureWidth * .15, y);
    await delay(800);
    assert.equal((await info()).controls.temporarySpeed, false, 'holding a seek preview during playback cannot activate speed');
    assert.ok((await info()).controls.gesture.includes('快进'));
    touch('CANCEL', x + gestureWidth * .15, y);
    await delay(400);
    touch('DOWN', bounds.left + gestureWidth * .25, y);
    touch('MOVE', bounds.left + gestureWidth * .25, y - gestureHeight * .1);
    await delay(800);
    assert.equal((await info()).controls.temporarySpeed, false, 'holding a brightness gesture cannot activate speed');
    assert.ok((await info()).controls.gesture.includes('亮度'));
    touch('CANCEL', bounds.left + gestureWidth * .25, y - gestureHeight * .1);
    if (!(await info()).controlsVisible) {
      run('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
      await wait('api.system.debugInformation().then(d=>d.controlsVisible)');
    }
    const controls = (await info()).controls;
    const speedButton = controls.buttons.find(button => button.label === '倍速');
    assert.ok(speedButton);
    for (const [name, rectangle] of [['button', speedButton], ['slider', controls.seek]]) {
      const cx = (rectangle.left + rectangle.right) / 2, cy = (rectangle.top + rectangle.bottom) / 2;
      touch('DOWN', cx, cy);
      await delay(800);
      assert.equal((await info()).controls.temporarySpeed, false, `holding a ${name} cannot activate speed`);
      touch('CANCEL', cx, cy);
    }
    await hold(2);
    shot('player-long-press-speed');
    touch('UP', x, y);
    await wait('api.system.debugInformation().then(d=>!d.controls.temporarySpeed&&d.controls.speed===1.25)');
    assert.equal((await info()).paused, false, 'releasing a hold does not toggle pause');
    console.log('release restored 1.25x');

    await rate(3);
    await hold(3);
    touch('CANCEL', x, y);
    await wait('api.system.debugInformation().then(d=>!d.controls.temporarySpeed&&d.controls.speed===3)');
    console.log('cancel preserved 3x');

    await rate(1.5);
    await hold(2);
    console.log('held before Home');
    const playbackPid = run('shell', 'pidof', 'top.tigerest.theater.debug');
    run('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    // A background WebView may suspend JS; resume before asking the native bridge
    // for state, and verify the same process retained the paused playback.
    await delay(1500);
    assert.equal(run('shell', 'pidof', 'top.tigerest.theater.debug'), playbackPid);
    console.log('same process after Home');
    run('shell', 'am', 'start', '-W', '--activity-reorder-to-front', '-n', 'top.tigerest.theater.debug/top.tigerest.theater.MainActivity');
    await delay(1500);
    assert.equal(run('shell', 'pidof', 'top.tigerest.theater.debug'), playbackPid);
    await wait('api.system.debugInformation().then(d=>!d.controls.temporarySpeed&&d.controls.speed===1.5&&d.paused)', 'background restores speed and pauses');
    console.log('restored after Home');
    await c.evaluate('api.player.play()');
    await wait('api.system.debugInformation().then(d=>!d.paused)');
    console.log('resumed after Home');

    await hold(2);
    console.log('held before replacement');
    await load('media.mp4');
    await wait(`api.system.debugInformation().then(d=>d.active&&!d.controls.loading&&!d.controls.temporarySpeed&&d.controls.speed===${originalSpeed})`, 'new file clears the old temporary speed');
    console.log('replacement ready');
    touch('UP', x, y);
    await delay(400);
    assert.equal((await info()).controls.speed, originalSpeed, 'old touch release cannot change the new file speed');
    console.log('old touch released');

    await rate(1.25);
    await hold(2);
    console.log('held before stop');
    assert.deepEqual(await c.evaluate(`(async()=>{const order=[];const stopped=()=>order.push('stopped');api.player.stopped.connect(stopped);await api.player.stop();order.push('resolved');api.player.stopped.disconnect(stopped);return order})()`), ['stopped','resolved'], 'stop signal must arrive before the promise allows a new session');
    await wait('api.system.debugInformation().then(d=>!d.active&&!d.controls.loading&&!d.controls.temporarySpeed)');
    touch('CANCEL', x, y);
    console.log('stopped');

    await load('media.mp4', false);
    await wait('api.system.debugInformation().then(d=>d.active&&d.paused&&!d.controls.opening&&!d.controls.loading)', 'paused ready video has no loading indicator');
    console.log('paused load ready');
    await delay(400);
    touch('DOWN', x, y);
    await delay(800);
    assert.equal((await info()).controls.temporarySpeed, false, 'a paused video stays paused at its user speed');
    touch('CANCEL', x, y);
    releaseLoading = false;
    console.log('loading again');
    await load('loading.mp4');
    await wait('api.system.debugInformation().then(d=>d.controls.loading)');
    console.log('stop while loading');
    await c.evaluate('api.player.stop()');
    await wait('api.system.debugInformation().then(d=>!d.active&&!d.controls.loading)');
    for (const [, res] of pending.splice(0)) res.destroy();
    console.log('stopped while loading');

    await load('broken.mp4');
    console.log('loaded broken');
    await wait('api.system.debugInformation().then(d=>!d.active&&!d.controls.loading)', 'failed opening clears the loading indicator');
    const failurePid = run('shell','pidof','top.tigerest.theater.debug');
    for (let attempt=0;attempt<5;attempt++) {
      await load('broken.mp4');
      await wait('api.system.debugInformation().then(d=>!d.active&&!d.controls.loading)', 'repeated failed streams remain recoverable');
      assert.equal(run('shell','pidof','top.tigerest.theater.debug'),failurePid,'failed streams must not launch a crashing extractor');
    }
    console.log(JSON.stringify({passed:true,openingSpinner:true,pausedReady:true,loadFailure:true,stopWhileLoading:true,longPressReleaseCancel:true,fasterSettingPreserved:true,backgroundRestore:true,replacementRestore:true,stopRestore:true}));
  } finally {
    touch('CANCEL', x, y);
    await c.evaluate('api.player.stop()').catch(() => {});
    if (process.env.TIGEREST_TEST_HWDEC) await c.evaluate(`api.settings.setValue("video","hardwareDecoding",${JSON.stringify(originalHardware)})`).catch(() => {});
    for (const [, res] of pending.splice(0)) res.destroy();
  }
}, (req, res) => {
  if (req.url === '/broken.mp4') { res.writeHead(404); res.end(); return true; }
  if (req.url !== '/loading.mp4') return false;
  if (releaseLoading) serveMedia(req, res); else pending.push([req, res]);
  return true;
}).catch(error => { console.error(error); process.exitCode = 1; });
