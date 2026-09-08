const assert = require('node:assert/strict');
const {chromium} = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PULSE_BROWSER_EXECUTABLE?{executablePath:process.env.PULSE_BROWSER_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1100,height:900}}), errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  let config={enabled:true,bot_token:'',chat_id:'123456',offline_seconds:60,excluded_ids:[],script:'async function sendEvent(event) { return true; }'};
  const metrics=[{id:'host',name:'DMIT PRO'},{id:'muted',name:'备用服务器'}];
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname,post=route.request().method()==='POST';
   if(path.startsWith('/api/telegram/')) {
    assert.equal(route.request().headers().authorization,'Bearer ui-test-token');
    if(post){const data=route.request().postDataJSON();posts.push({path,data});if(path.endsWith('/config'))config={...data,bot_token:''};}
    return route.fulfill({json:path.endsWith('/config')?(post?{ok:true}:{config,has_token:true,default_script:'function sendMessage() {}',last_error:''}):{messages:['<b>🔴 服务器离线</b>\n\nDMIT PRO\n持续失联 300 秒。\n<img src=x onerror="window.__unsafe=true">']}});
   }
   return route.fulfill({json:path==='/api/metrics'?metrics:path==='/api/auth/status'?{set:true}:path==='/api/auth/verify'?{valid:true}:path==='/api/tcping/config'?{targets:[]}:path==='/api/privacy/config'?{enabled:false}:{}});
  });
  await page.addInitScript(()=>{localStorage.setItem('admin_auth_token','ui-test-token');localStorage.setItem('preferred-language','zh');localStorage.setItem('theme','light');window.EventSource=class extends EventTarget{close(){}};});
  await page.goto(`${base}/admin/`);await page.locator('#telegram-settings-btn').click();await page.locator('#tg-save:enabled').waitFor();
  assert.equal(await page.locator('#tg-delay-value').inputValue(),'1');assert.equal(await page.locator('#tg-delay-unit').inputValue(),'60');
  assert.equal(await page.locator('#tg-token').inputValue(),'');
  await page.fill('#tg-delay-value','5');await page.locator('summary').filter({hasText:'通知范围'}).click();await page.locator('#tg-hosts input[value=muted]').uncheck();
  await page.click('#tg-save');await page.getByText('设置已保存。',{exact:true}).waitFor();
  assert.equal(posts[0].data.offline_seconds,300);assert.equal(posts[0].data.bot_token,'');assert.deepEqual(posts[0].data.excluded_ids,['muted']);
  await page.selectOption('#tg-delay-unit','1');assert.equal(await page.inputValue('#tg-delay-value'),'300');await page.fill('#tg-delay-value','10');await page.click('#tg-save');assert.equal(posts.length,1,'invalid delay submitted');
  await page.fill('#tg-delay-value','45');await page.click('#tg-save');await page.getByText('设置已保存。',{exact:true}).waitFor();assert.equal(posts.at(-1).data.offline_seconds,45);
  await page.locator('#tg-template-section summary').click();await page.click('#tg-preview');await page.locator('#tg-preview-output').waitFor();assert((await page.textContent('#tg-preview-output')).includes('DMIT PRO'));assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
  assert(!posts.some(p=>p.path.endsWith('/test')),'preview sent external test');
  await page.click('#tg-test');await page.getByText('测试消息已发送。',{exact:true}).waitFor();assert.equal(posts.at(-1).path,'/api/telegram/test');
  await page.locator('#tg-template-section summary').click();await page.locator('summary').filter({hasText:'通知范围'}).click();
  for(const width of [1100,375,320]){
   await page.setViewportSize({width,height:900});
   const fit=await page.locator('#telegram-settings').evaluate(el=>({fit:el.scrollWidth<=el.clientWidth+1,right:el.getBoundingClientRect().right}));assert(fit.fit&&fit.right<=width,`dialog overflows at ${width}`);
   if(process.env.PULSE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/telegram-${width}.png`});
  }
  await page.evaluate(()=>document.documentElement.classList.add('dark'));if(process.env.PULSE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/telegram-dark.png`});
  await page.keyboard.press('Escape');await page.locator('#telegram-settings').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement.id),'telegram-settings-btn');
  assert.deepEqual(errors,[]);console.log('PASS Telegram settings: delay, token preservation, per-host mute, preview/test separation, responsive layout, keyboard');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
