import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const html = `<!doctype html><html><head><style>body{margin:0;background:#eee;font:18px sans-serif;height:2000px}button{background:#fe0!important;font-size:30px!important}#action{position:absolute;left:650px;top:300px;width:200px;height:70px}</style></head><body><header id="fixed" style="position:fixed;top:0">Generic HTML app</header><button id="action">Click me</button><span id="count">0</span><script>document.querySelector('#action').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);</script></body></html>`;
const server = createServer((_req,res) => { res.setHeader('Content-Type','text/html');res.end(html); });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const dataRoot = await mkdtemp(path.join(tmpdir(), 'studio-runtime-test-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = 'http://127.0.0.1:' + port;
const service = spawn(process.execPath, ['scripts/walkthrough-export-service.mjs'], { env: { ...process.env, WALKTHROUGH_EXPORT_PORT:String(port), RECORDING_STUDIO_DATA_DIR:dataRoot, WALKTHROUGH_EXPORT_OUTPUT_DIR:path.join(dataRoot,'exports'), RECORDING_STUDIO_HEADLESS:'1' }, stdio:['ignore','pipe','pipe'] });
service.stderr.on('data', data=>process.stderr.write(data));
const browser = await chromium.launch({ channel:'chrome',headless:true });
try {
  for (let i=0;i<100;i++) { try { if ((await fetch(base+'/api/recording-studio/health')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert.equal((await fetch(base+'/api/recording-studio/health',{headers:{Origin:'https://evil.example'}})).status,403);
  const config = await (await fetch(base+'/api/recording-studio/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'test-'+Date.now(),url,attach:true})})).json();
  const bundle = await readFile('dist/recorder.js','utf8');
  const context = await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:2});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.evaluate(c=>{window.__projectStudioRecording=c;document.documentElement.style.zoom='0.8';},config);
  await page.addScriptTag({content:bundle});
  await page.waitForFunction(()=>window.__moonshotWalkthroughReady);
  console.log('Runtime mounted');
  assert.notEqual(await page.getByRole('button',{name:'Record new',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'30px');
  await page.getByRole('button',{name:'Record new',exact:true}).click();
  console.log('New recording opened');
  await page.getByRole('textbox',{name:'Recording name'}).fill('Generic demo');
  await page.getByRole('button',{name:'Record from current state',exact:true}).click();
  await page.locator('#action').click();
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await page.getByRole('button',{name:'Back to overview',exact:true}).click();
  await page.getByText('Generic demo',{exact:true}).waitFor({timeout:10000});
  const records=await (await fetch(base+'/api/recording-studio/library',{headers:{Authorization:'Bearer '+config.sessionToken}})).json();
  assert.equal(records.length,1);
  assert.equal(records[0].plan.scenes.flatMap(s=>s.actions).filter(a=>a.type==='click').length,1);
  assert.equal(records[0].plan.scenes.flatMap(s=>s.actions).find(a=>a.type==='click').target,'#action');
  await page.reload();
  await page.evaluate(c=>{window.__projectStudioRecording=c;}, {...config,recordingId:records[0].id});
  await page.addScriptTag({content:bundle});
  await page.getByRole('button',{name:'Play recording',exact:true}).waitFor();
  await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#count').textContent==='1');
  assert.deepEqual(errors,[]);
  console.log('Shared runtime: isolated UI, real recording, central save/reload, exact click playback passed.');

  const managed=await fetch(base+'/api/recording-studio/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:config.appId+'-managed',url})});
  assert.equal(managed.status,200,await managed.text());
  console.log('Managed Chrome injection passed.');

  if(process.argv.includes('--export')) {
    const dir=await mkdtemp(path.join(tmpdir(),'studio-shared-export-'));
    const plan={title:'Shared export',start:{x:10,y:10},defaults:{moveDurationMs:150,pauseMs:0},scenes:[{id:'test',actions:[{type:'circle',target:'#action',radius:50,durationMs:650},{type:'click',target:'#action'}]}]};
    await writeFile(path.join(dir,'plan.json'),JSON.stringify(plan));
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['scripts/run-walkthrough-playwright.mjs','--url',url,'--plan',path.join(dir,'plan.json'),'--output-dir',dir,'--headless','1','--quality','standard','--fps','30','--zoom','0.8','--viewport','1100x700','--manifest','1'],{stdio:'inherit'});
      child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Export exited '+code)));
    });
    console.log('Shared runtime video export:',dir);
  }
 } finally {
  await browser.close();
  service.kill('SIGTERM');
  await new Promise(resolve => { if (service.exitCode !== null) resolve(); else service.once('exit', resolve); });
  server.close();
  await rm(dataRoot, { recursive:true, force:true });
}
