// Reuse the desktop's complete comment acceptance scenario against bundled Android scripts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const withBrowser=require('./android_browser.cjs');
const source=fs.readFileSync(path.join(__dirname,'../../tests/test_community_ui.cjs'),'utf8');
const match=/const result=await evaluate\(`([\s\S]*?)`\);/.exec(source);assert.ok(match,'shared comment scenario');
const expression=vm.runInNewContext('`'+match[1]+'`');
withBrowser({'/':{type:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101010;color:white"><div class="itemView"><div class="itemMainScrollSlider"><h1>评论验收</h1></div></div>'}},async({evaluate})=>{
 const result=await evaluate(expression);assert.equal(result.passed,true);await evaluate('window.fixturePlugin.destroy()');console.log(JSON.stringify(result));
}).catch(e=>{console.error(e);process.exitCode=1;});
