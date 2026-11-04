// H23 — real Chromium runtime against localhost static export, never a field system.
// Run only from dedicated no-secret CI job after a production-independent build.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base='http://127.0.0.1:4173';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{if(browser)await browser.close();});

async function visit({width=1280,height=900,reducedMotion='no-preference'}={}) {
  const context=await browser.newContext({
    viewport:{width,height},
    reducedMotion,
    serviceWorkers:'block',
    colorScheme:'dark'
  });
  const blocked=[];
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(base+'/')) return route.continue();
    blocked.push(url);
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  return {context,page,errors,blocked};
}

async function close(ctx){
  await ctx.context.close();
  assert.deepEqual(ctx.errors,[],'Client runtime errors are not permitted');
}

test('desktop renders unavailable-data static scene, not an invented closed gate',async()=>{
  const ctx=await visit();
  try{
    await ctx.page.goto(base+'/',{waitUntil:'domcontentloaded'});
    const scene=ctx.page.locator('.scene-static-assurance');
    await scene.waitFor({state:'visible'});
    const copy=await scene.innerText();
    assert.match(copy,/3D visualization withheld/);
    assert.match(copy,/POSITION UNKNOWN · SOURCE UNVERIFIED/);
    assert.match(copy,/WATER READING UNKNOWN · SOURCE UNVERIFIED/);
    assert.match(copy,/UNKNOWN · UNVERIFIED/);
    assert.match(copy,/Unknown is not closed/);
    assert.equal(await ctx.page.locator('.dam-scene canvas').count(),0);
    assert.equal(await ctx.page.locator('.scene-static-assurance canvas').count(),0);
    const hero=ctx.page.locator('.home-hero');
    assert.match(await hero.innerText(),/Unsigned IoT engineering prototype/);
    assert.doesNotMatch(await hero.innerText(),/PHYSICAL SAFETY VERIFIED|ACTUAL GATE CLOSED/);
  }finally{await close(ctx);}
});

test('skip link and command navigation support actual Chromium keyboard operations',async()=>{
  const ctx=await visit();
  try{
    const p=ctx.page;
    await p.goto(base+'/',{waitUntil:'domcontentloaded'});
    await p.locator('#main-content main').waitFor({state:'visible'});
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('href')),'#main-content');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(()=>document.activeElement?.id),'main-content');
    await p.getByRole('button',{name:'Open quick navigation'}).click();
    await p.getByRole('dialog',{name:'Quick navigation'}).waitFor({state:'visible'});
    await p.keyboard.press('Escape');
    await p.getByRole('dialog',{name:'Quick navigation'}).waitFor({state:'hidden'});
  }finally{await close(ctx);}
});

test('mobile navigation reaches rainfall and source fields remain unverified',async()=>{
  const ctx=await visit({width:390,height:844});
  try{
    const p=ctx.page;
    await p.goto(base+'/',{waitUntil:'domcontentloaded'});
    const toggle=p.getByRole('button',{name:'Toggle navigation'});
    await toggle.waitFor({state:'visible'});
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await p.locator('.mobile-nav a[href="/rainfall"]').click();
    await p.waitForURL(/\/rainfall\/?$/);
    await p.getByRole('heading',{name:'Rainfall monitoring'}).waitFor({state:'visible'});
    const text=await p.locator('#main-content').innerText();
    assert.match(text,/UNKNOWN|UNAVAILABLE|NOT CURRENT|unverified/i);
    assert.doesNotMatch(text,/Sensor reporting|Verified physical rain safety/);
    const button=p.locator('.status-dock > button');
    await button.click();
    const dock=p.locator('.dock-grid');
    await dock.waitFor({state:'visible'});
    const dockText=await dock.innerText();
    assert.match(dockText,/Water · unsigned/);
    assert.match(dockText,/ESP8266 · unsigned/);
    assert.match(dockText,/Gate · unsigned/);
    assert.doesNotMatch(dockText,/REPORTED ONLINE|REPORTED CLOSED/);
  }finally{await close(ctx);}
});

test('five practical routes remain inside viewport at narrow and desktop widths',async()=>{
  for(const width of [390,1280]){
    const ctx=await visit({width,height:900,reducedMotion:'reduce'});
    try{
      for(const path of ['/','/dashboard/','/devices/','/rainfall/','/gate/']){
        await ctx.page.goto(base+path,{waitUntil:'domcontentloaded'});
        await ctx.page.locator('#main-content main').waitFor({state:'visible'});
        await ctx.page.waitForTimeout(120);
        const geometry=await ctx.page.evaluate(()=>({
          body:document.body.scrollWidth,
          root:document.documentElement.scrollWidth,
          viewport:document.documentElement.clientWidth
        }));
        assert.ok(Math.max(geometry.body,geometry.root)<=geometry.viewport+2,
          'Horizontal overflow at '+path+' width '+width+': '+JSON.stringify(geometry));
      }
    }finally{await close(ctx);}
  }
});

test('prefers-reduced-motion suppresses live Canvas and all animated 3D controls',async()=>{
  const ctx=await visit({width:390,height:844,reducedMotion:'reduce'});
  try{
    const p=ctx.page;
    await p.goto(base+'/',{waitUntil:'domcontentloaded'});
    const scene=p.locator('.scene-static-assurance');
    await scene.waitFor({state:'visible'});
    assert.match(await scene.innerText(),/Motion-free observation/);
    assert.equal(await p.locator('canvas').count(),0);
    assert.equal(await p.locator('.scene-views button').count(),0);
    assert.equal(await p.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  }finally{await close(ctx);}
});
