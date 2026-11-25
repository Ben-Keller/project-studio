// Real interface, fictional projects: never capture the owner's workspace.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=await fs.mkdtemp(path.join(os.tmpdir(),'studio-readme-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const samples=[['atlas','Atlas','A clearer view of the world.','#519da7'],['field-notes','Field Notes','A home for observations and ideas.','#bc8660'],['signal','Signal','Turn information into decisions.','#8a8cc8'],['horizon','Horizon','Explore a different perspective.','#6da786'],['canvas','Canvas','Make room for your next idea.','#b27783'],['studio-kit','Studio Kit','Small tools. Thoughtful workflows.','#739ebd'],['folio','Folio','Present work with intention.','#aa9570'],['current','Current','Keep ideas moving.','#688fa8'],['north','North','Find your next direction.','#77967c'],['index','Index','A place for everything.','#9d80a3']];
 const links=samples.map(([slug,name,note,color])=>({slug,name,note,url:`https://${slug}.example.com`,icon_glyph:name[0],icon_primary:color,icon_secondary:'#152733',icon_accent:'#c0ede0',icon_motif:'network'}));
 const copy=Object.fromEntries(samples.map(([slug,name,note,color])=>[slug,{headline:note,summary:`${name}: an illustrative project in this demo workspace.`,description:'Collect your work in one place. Give each project a considered presentation, then move between ideas and the tools that bring them to life.',accent:color,role:'Design and development',tags:['Sample project','Design','Prototype'],features:['A focused workspace','Clear navigation','Editable presentation'],featured:slug==='atlas'}]));
 await fs.mkdir(path.join(data,'private'));
 await fs.writeFile(path.join(data,'private/catalog.json'),JSON.stringify({schema_version:1,apps:[],links,planned:[],metadata:{PORTFOLIO_COPY:copy}}));
 await fs.writeFile(path.join(data,'preferences.json'),JSON.stringify({projectStudioMode:'studio',projectStudioActivityGroups:JSON.stringify(Object.fromEntries(samples.map(([id])=>[id,'active']))),projectStudioPortfolioSettings:JSON.stringify({title:'Selected work.',subtitle:'Ideas. Interfaces. Working software.',studioName:'A demonstration workspace',featuredSlug:'atlas',template:'cinematic',theme:'dark',showMetrics:false})}));
 const server=spawn(process.env.PYTHON||'python3',[path.join(root,'local_tools_launcher.py'),'--port',String(port),'--no-open'],{env:{...process.env,PROJECT_STUDIO_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 let logs='',browser;server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 try{
  const base=`http://127.0.0.1:${port}`;let ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error(logs);
  const {bootstrap}=JSON.parse(await fs.readFile(path.join(data,'auth',port+'.json')));
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#studio_bootstrap='+bootstrap);await page.locator('.tool-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1200);
  const out=path.join(root,'docs/images');await fs.mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'studio.png'),clip:{x:0,y:0,width:1440,height:780}});
  await page.locator('[data-app-mode="portfolio"]').click();await page.waitForTimeout(600);await page.locator('.portfolio-project-panel').first().evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-190));await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'portfolio.png')});
  await page.getByRole('link',{name:'Keys',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Connect a project'));await page.locator('[data-tab=connect]').click();await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'keys.png')});
  if(errors.length)throw Error(errors.join('\n'));console.log('Captured three views using fictional projects.');
 }finally{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r);});await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
