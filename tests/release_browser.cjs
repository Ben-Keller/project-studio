const { chromium } = require('playwright');
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
  const runtimeEnv={...process.env, PROJECT_STUDIO_DATA_DIR:data, PATH:'/usr/bin:/bin'};
  const service = spawn(executable, ['serve','--port',String(port),'--no-open'], {env:runtimeEnv,stdio:['ignore','pipe','pipe']});
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
    assert.equal(await page.locator('#detailCapture').count(), 0);
    await page.locator('[data-app-mode="portfolio"]').click();
    await page.locator('[data-app-mode="studio"]').click();
    await page.waitForTimeout(500);
    const prefs=JSON.parse(await fs.readFile(path.join(data,'preferences.json'),'utf8'));
    assert.equal(prefs.projectStudioMode,'studio');
    await page.locator('#addProjectButton').click();
    await page.locator('[name="name"]').fill('Example Project');
    await page.locator('[name="slug"]').fill('example-project');
    await page.locator('[name="url"]').fill('https://example.com/');
    await page.locator('#addProjectForm [type="submit"]').click();
    await page.locator('.tool-card[data-slug="example-project"]').waitFor();
    await page.locator('.tool-card[data-slug="example-project"] h2').click();
    await page.locator('#detailLaunch').waitFor({state:'visible'});
    assert.ok(!(await page.locator('#detailLaunch').getAttribute('href')).includes('capture='));
    await page.keyboard.press('Escape');
    const {spawnSync}=require('node:child_process');
    const added=JSON.parse(await fs.readFile(path.join(data,'private/catalog.json'),'utf8'));
    added.apps.push({slug:'second-project',name:'Second Project',url:'https://example.org/',processes:[]});
    await fs.writeFile(path.join(data,'private/catalog.json'),JSON.stringify(added));
    await page.reload();
    await page.locator('.tool-card[data-slug="second-project"]').waitFor();
    const backup=spawnSync(executable,['backup',path.join(data,'..',path.basename(data)+'-backup')],{env:{...process.env,PROJECT_STUDIO_DATA_DIR:data},encoding:'utf8'});
    assert.equal(backup.status,0,backup.stderr);
    const fixture=path.join(data,'fixture');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'index.html'),'<h1>Packaged helper works</h1>');
    const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const appPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const current=JSON.parse(await fs.readFile(path.join(data,'private/catalog.json'),'utf8'));
    current.apps.push({slug:'helper-test',name:'Helper Test',url:`http://127.0.0.1:${appPort}/`,processes:[{name:'web',repo:fixture,command:`@studio:spa --directory "${fixture}" --port ${appPort}`,ports:[appPort]}]});
    await fs.writeFile(path.join(data,'private/catalog.json'),JSON.stringify(current));
    const invoke=action=>spawnSync(executable,[action,'helper-test'],{env:runtimeEnv,encoding:'utf8',timeout:120000});
    try {
      const launch=invoke('launch');assert.equal(launch.status,0,launch.stderr);assert.equal(JSON.parse(launch.stdout).ready,true,launch.stdout);
      assert.match(await (await fetch(`http://127.0.0.1:${appPort}/deep-link`)).text(),/Packaged helper works/);
      const status=invoke('status');assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).ready,true);
    } finally {const stop=invoke('stop');assert.equal(stop.status,0,stop.stderr);}
    await page.screenshot({path:path.join(data,'studio.png')});
    await page.getByRole('link',{name:'Keys',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent.includes('Connect a project'));
    await page.waitForTimeout(500);
    assert.deepEqual(errors,[],logs);
    const stored=JSON.parse(await fs.readFile(path.join(data,'private/catalog.json'),'utf8'));
    assert.equal(stored.apps.length,3);
    console.log('Packaged service: isolated auth, Studio, Portfolio, Keys, registration and persistence passed. Screenshot:',path.join(data,'studio.png'));
  } finally {
    if(browser)await browser.close(); service.kill('SIGTERM');
    await new Promise(resolve=>{if(service.exitCode!==null)resolve();else service.once('exit',resolve)});
    if(service.exitCode!==0 && logs.includes('Traceback')) console.error(logs);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
