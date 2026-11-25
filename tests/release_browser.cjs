const { chromium } = require('../recording-studio/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-packaged-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const executable = path.resolve('release/build/Project Studio.app/Contents/Resources/runtime/studio');
  const service = spawn(executable, ['serve','--port',String(port),'--no-open'], {env:{...process.env, PROJECT_STUDIO_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  let logs = '';service.stdout.on('data',v=>logs+=v);service.stderr.on('data',v=>logs+=v);
  let browser;
  try {
    const base='http://127.0.0.1:'+port;
    let ready=false;
    for(let i=0;i<100;i++) { try {ready=(await fetch(base+'/healthz')).ok;} catch {} if(ready)break; await new Promise(r=>setTimeout(r,100)); }
    assert.ok(ready,logs);
    const {bootstrap}=JSON.parse(await fs.readFile(path.join(data,'auth',port+'.json'),'utf8'));
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#studio_bootstrap='+bootstrap);
    await page.locator('#addProjectButton').waitFor();
    await page.locator('[data-app-mode="portfolio"]').click();
    await page.locator('[data-app-mode="studio"]').click();
    await page.locator('#addProjectButton').click();
    await page.locator('[name="name"]').fill('Example Project');
    await page.locator('[name="slug"]').fill('example-project');
    await page.locator('[name="url"]').fill('https://example.com/');
    await page.locator('#addProjectForm [type="submit"]').click();
    await page.locator('.tool-card[data-slug="example-project"]').waitFor();
    await page.screenshot({path:path.join(data,'studio.png')});
    await page.getByRole('link',{name:'Keys',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('Connect a project'));
    await page.waitForTimeout(500);
    assert.deepEqual(errors,[],logs);
    const stored=JSON.parse(await fs.readFile(path.join(data,'private/catalog.json'),'utf8'));
    assert.equal(stored.apps.length,1);
    console.log('Packaged service: isolated auth, Studio, Portfolio, Keys, registration and persistence passed. Screenshot:',path.join(data,'studio.png'));
  } finally {
    if(browser)await browser.close(); service.kill('SIGTERM');
    await new Promise(resolve=>{if(service.exitCode!==null)resolve();else service.once('exit',resolve)});
    if(service.exitCode!==0 && logs.includes('Traceback')) console.error(logs);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
