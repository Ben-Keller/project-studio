import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const root = await mkdtemp(path.join(tmpdir(), 'studio-export-performance-'));
const fixture = createServer((_req, res) => res.end('<!doctype html><html><body style="background:#195591;color:white;font:24px sans-serif"><button id="sample">Export test</button></body></html>'));
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const service = spawn(process.execPath, ['scripts/walkthrough-export-service.mjs'], {
  env: { ...process.env, WALKTHROUGH_EXPORT_PORT: String(port), WALKTHROUGH_EXPORT_OUTPUT_DIR: path.join(root, 'exports'), RECORDING_STUDIO_DATA_DIR: root },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
service.stdout.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
service.stderr.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
const base = `http://127.0.0.1:${port}`;
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
try {
  let ready = false;
  for (let i=0; i<80; i++) {
    try { if ((await fetch(base+'/api/recording-studio/health')).ok) { ready=true; break; } } catch {}
    await pause();
  }
  assert.ok(ready, logs);
  const session = await (await fetch(base+'/api/recording-studio/sessions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({appId:'performance-test',url:`http://127.0.0.1:${fixture.address().port}/`,attach:true}) })).json();
  const headers = {'Content-Type':'application/json',Authorization:`Bearer ${session.sessionToken}`};
  for (const [resolution, quality, expectedWidth] of [['1080p','standard',1920],['1440p','standard',2560],['4k','standard',3840],['1080p','maximum',1920]]) {
    const start=Date.now();
    const submissions=await Promise.all([0,1].map(() => fetch(base+'/api/walkthrough-export/jobs',{method:'POST',headers,body:JSON.stringify({
      name:'Performance verification', languages:['en'], settings:{fps:30,quality,resolution},
      plan:{title:'Performance verification',start:{x:20,y:20},defaults:{moveDurationMs:150,pauseMs:0},exportFrame:{viewport:{width:960,height:540},deviceScaleFactor:4,zoom:1},scenes:[{id:'demo',actions:[{type:'click',target:'#sample'}]}]},
    })})));
    assert.deepEqual(submissions.map(item => item.status).sort(), [202,409], 'Simultaneous submissions must admit exactly one export');
    const response=submissions.find(item => item.status === 202);
    const job=await response.json();assert.equal(response.status,202,JSON.stringify(job));
    const duplicate = await fetch(base+'/api/walkthrough-export/jobs', {method:'POST', headers, body:JSON.stringify({plan:{scenes:[]}})});
    assert.equal(duplicate.status, 409, 'A second export must not overlap the running process');
    let result;
    for(let i=0;i<480;i++) {
      result=await(await fetch(base+'/api/walkthrough-export/jobs/'+job.id,{headers})).json();
      if(result.status==='failed')throw new Error(JSON.stringify(result));
      if(result.status==='completed')break;
      await pause();
    }
    assert.equal(result.status,'completed',JSON.stringify(result));
    assert.equal(result.progress,100);
    assert.equal(result.encoding.frames,result.encoding.totalFrames);
    assert.ok(result.encoding.totalFrames>0);
    assert.equal(result.settings.resolution,resolution);
    if(quality==='maximum')assert.equal(result.encoding.encoder,'libx264');
    const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path.join(result.outputDir,'walkthrough-video.mp4')]));
    const video=info.streams[0];
    assert.equal(video.width,expectedWidth);
    assert.equal(video.height,expectedWidth*9/16);
    assert.equal(video.r_frame_rate,'30/1');
    assert.equal(video.color_transfer,'iec61966-2-1');
    assert.equal(video.color_space,'bt709');
    assert.equal(video.color_range,'tv');
    console.log(`${resolution} ${quality}: ${((Date.now()-start)/1000).toFixed(1)}s, ${result.encoding.encoder}, ${video.width}x${video.height}, ${result.encoding.totalFrames} frames; color/progress verified`);
  }
} finally {
  service.kill('SIGTERM');
  await new Promise(resolve => { if(service.exitCode!==null)resolve();else service.once('exit',resolve); });
  await new Promise(resolve => fixture.close(resolve));
  await rm(root,{recursive:true,force:true});
}
