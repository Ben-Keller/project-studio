import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const server = createServer((_req,res) => res.end('<!doctype html><html><body><button id="sample">Export test</button></body></html>'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:3015';
try {
  const session=await (await fetch(base+'/api/recording-studio/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:'export-smoke',url:`http://127.0.0.1:${server.address().port}/`,attach:true})})).json();
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+session.sessionToken};
  const response=await fetch(base+'/api/walkthrough-export/jobs',{method:'POST',headers,body:JSON.stringify({name:'Shared API verification',languages:['en'],settings:{fps:30,quality:'standard'},plan:{title:'Shared API verification',start:{x:20,y:20},defaults:{moveDurationMs:150,pauseMs:0},exportFrame:{viewport:{width:640,height:480},deviceScaleFactor:1,zoom:0.8},scenes:[{id:'demo',actions:[{type:'click',target:'#sample'}]}]}})});
  const job=await response.json();
  assert.equal(response.status,202,JSON.stringify(job));
  console.log('Export job accepted:',job.id);
  let lastStatus='';
  for(let i=0;i<150;i++) {
    const status=await (await fetch(base+'/api/walkthrough-export/jobs/'+job.id,{headers})).json();
    if(lastStatus!==status.status){console.log(status.status,status.progress,status.outputDir);lastStatus=status.status;}
    if(status.status==='completed'){assert.equal(status.progress,100);console.log('Export API/progress passed.');break;}
    if(status.status==='failed')throw new Error(JSON.stringify(status));
    if(i===149)throw new Error('Export timed out');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
} finally { server.close(); }
