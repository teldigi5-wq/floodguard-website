// H35: test the actual statically built Vercel-preview-mode website in Chromium.
// The build injects a synthetic valid-looking Firebase URL, which must never
// trigger a network request or WebSocket, even though it is present at build.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const BASE='http://127.0.0.1:4173';
let browser;

before(async()=>{
  assert.equal(process.env.FG_H35_PREVIEW_BROWSER,'1');
  browser=await chromium.launch({headless:true});
});
after(async()=>{if(browser)await browser.close();});

async function exercise(route){
  const context=await browser.newContext({serviceWorkers:'block',
    viewport:{width:390,height:844},reducedMotion:'reduce'});
  const externalRequests=[],websockets=[],errors=[];
  const page=await context.newPage();
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='4173')
      externalRequests.push(url.origin);
  });
  page.on('websocket',socket=>websockets.push(socket.url()));
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async request=>{
    const url=new URL(request.request().url());
    if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port==='4173')
      return request.continue();
    externalRequests.push(url.origin);
    return request.abort('blockedbyclient');
  });
  try{
    const response=await page.goto(BASE+route,{waitUntil:'domcontentloaded'});
    assert.equal(response?.status(),200);
    // Ensure the React provider actually initialized and failed closed;
    // a static HTML snapshot alone cannot prove the browser SDK behavior.
    await page.waitForFunction(()=>
      document.querySelector('.status-dock button em')?.textContent?.trim().toLowerCase()
        ==='unavailable',{timeout:18000});
    await page.waitForTimeout(500);
    assert.deepEqual(externalRequests,[],'Preview attempted an external request');
    assert.deepEqual(websockets,[],'Preview attempted a WebSocket');
    assert.deepEqual(errors,[],'Preview triggered an uncaught browser error');
    const dock=await page.locator('.status-dock').innerText();
    assert.match(dock,/unavailable/i);
    assert.doesNotMatch(dock,/Recent DB record|REPORTED ONLINE/i);
    const body=await page.locator('body').innerText();
    assert.doesNotMatch(body,/SYNTHETIC_PRIVATE_WIFI_NEVER_PUBLIC/);
  }finally{await context.close();}
}

test('H35 Vercel preview homepage never creates an external Firebase connection',async()=>exercise('/'));
test('H35 Vercel preview dashboard remains unavailable with no network subscriptions',async()=>exercise('/dashboard/'));
test('H35 Vercel preview devices page does not subscribe to ESP/private branches',async()=>exercise('/devices/'));
test('H35 Vercel preview gate remains nonoperational with no Firebase traffic',async()=>exercise('/gate/'));
