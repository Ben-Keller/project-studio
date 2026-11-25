import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/moonshot/**', route => route.fulfill({status:200,contentType:'application/json',body:'{"ok":false,"configured":false}'}));
  await page.goto('http://127.0.0.1:3000/fe-energy-moonshot/');
  await page.locator('[data-walkthrough-target="dashboard"]').waitFor({timeout:60000});
  await page.waitForFunction(() => window.__moonshotWalkthroughState);
  await page.keyboard.press('Control+r');
  await page.getByRole('button',{name:'Record new',exact:true}).waitFor({timeout:15000});
  assert.ok(await page.evaluate(() => document.querySelector('#local-walkthrough-studio-root').shadowRoot));
  assert.equal(await page.evaluate(() => window.__projectStudioRecording.appId),'fe-moonshot');
  await page.evaluate(() => window.__moonshotWalkthroughState.applyState({dashboardFilters:{bureau:'RBAP'},language:'es'}));
  await page.waitForFunction(() => window.__moonshotWalkthroughState.getState().dashboardFilters.bureau === 'RBAP' && window.__moonshotWalkthroughState.getState().language === 'es');
  await page.screenshot({path:'/tmp/project-studio-tracker-integration.png'});
  assert.deepEqual(errors,[]);
  console.log('Tracker: shared shortcut loader, Shadow DOM, filter and language adapter passed.');
  await page.close();
  for (const endpoint of ['/api/project-studio/setup','/api/apps','/api/resources','/api/recording-studio']) {
    const response=await fetch('http://127.0.0.1:8765'+endpoint);assert.equal(response.status,200);
    const result=await response.json();
    console.log(endpoint, endpoint.includes('setup') ? JSON.stringify(result.validation) : 'OK');
  }
  const launch=await fetch('http://127.0.0.1:8765/api/apps/fe-moonshot/launch',{method:'POST'});assert.equal(launch.status,200);
  const state=await (await fetch('http://127.0.0.1:8765/api/apps/fe-moonshot/status')).json();
  assert.equal(state.ready,true); console.log('Project Studio app launch/status passed.');
  const capturePage=await (await fetch('http://127.0.0.1:8765/apps/fe-moonshot/open?capture=1')).text();
  assert.ok(capturePage.includes('/api/recording-studio/sessions'));assert.ok(!capturePage.includes('getDisplayMedia'));
  console.log('Project Studio capture route uses the shared runtime, not screen sharing.');
} finally { await browser.close(); }
