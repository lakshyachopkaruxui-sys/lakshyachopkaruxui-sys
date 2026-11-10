// Focused inspection of the actual forest class; no physical headset claim.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const output=new URL('../validation/deer-interaction/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-webgl']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5174/validation/deer-interaction/preview.html',{waitUntil:'networkidle',timeout:90000});
 await page.waitForFunction(()=>window.ready,null,{timeout:90000});
 const states=[];
 for(const [name,seconds] of [['watching',0],['head-tilt',2.9],['approaching',2.25],['settled',3.5]]){
  await page.evaluate(seconds=>window.preview.advance(seconds),seconds);
  await page.screenshot({path:new URL(name+'.png',output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  states.push(await page.evaluate(name=>{const f=window.preview.world.fauna;return{name,position:f.root.position.toArray(),head:f.head.quaternion.toArray(),headYaw:f.headYaw,headTilt:f.headRoll,approachDistance:f.approachDistance,status:f.status}},name));
 }
 assert.equal(states[0].status,'ready');assert.ok(states[1].headTilt>.12);assert.ok(states[2].approachDistance>.5);assert.ok(states[3].approachDistance<=1.5);
 assert.deepEqual(errors,[]);
 await writeFile(new URL('results.json',output),JSON.stringify({scope:'Actual WorldTwo rendered in desktop Chromium; scripted local viewer and sampled interaction times, not physical Quest or user-testing evidence',states,errors},null,2));
 console.log(JSON.stringify({states,errors}));
}finally{await browser.close()}
