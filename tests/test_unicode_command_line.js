'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

// Exercise the actual main/parser, including a Unicode directory and profile.
const root = fs.mkdtempSync(path.join(os.tmpdir(),'tigerest-中文配置-🎬-'));
const id = randomUUID().replaceAll('-','');
const name = '补帧 🎬 验收 '+id;
const profile = path.join(root,'profiles',id);
fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'profile.json'),JSON.stringify({name}));
try {
    const result = spawnSync(path.resolve(process.argv[2]),
        ['--config-dir',root,'--list-profiles'], {encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    assert.ok(result.stdout.includes(id),result.stdout);
    // qPrintable follows the system code page on Windows, so compare the native
    // name through selection success rather than imposing UTF-8 on console text.
    const selected = spawnSync(path.resolve(process.argv[2]),
        ['--config-dir',root,'--set-default-profile',name], {encoding:'utf8',windowsHide:true});
    assert.equal(selected.status,0,selected.stderr);
    console.log('PASS: real command line accepts Chinese config directory and profile name');
} finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('tigerest-中文配置-'));
    fs.rmSync(root,{recursive:true,force:true});
}
