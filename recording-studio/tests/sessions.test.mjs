import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { installRecordingStudio } from '../scripts/recording-sessions.mjs';

test('managed recording launches reuse live windows and recover closed sessions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-session-test-'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/recorder.js'), '');
  const original = chromium.launchPersistentContext;
  const contexts = [];
  chromium.launchPersistentContext = async () => {
    const context = new EventEmitter();
    const page = new EventEmitter();
    let closed = false;
    let connected = true;
    page.isClosed = () => closed;
    page.url = () => 'http://127.0.0.1/example';
    page.bringToFront = async () => { context.focuses++; };
    page.evaluate = async () => {};
    page.goto = async () => {};
    page.waitForFunction = async () => {};
    context.focuses = 0;
    context.pages = () => closed ? [] : [page];
    context.browser = () => ({ isConnected: () => connected });
    context.exposeBinding = async () => {};
    context.addInitScript = async () => {};
    context.close = async () => { connected = false; closed = true; context.emit('close'); };
    context.closeWindow = () => { closed = true; page.emit('close'); };
    context.abandonWindow = () => { closed = true; };
    contexts.push(context);
    return context;
  };
  const app = express();
  app.use(express.json());
  const studio = installRecordingStudio(app, { packageRoot: root, port: 0 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const launch = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/recording-studio/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'example', url: 'http://127.0.0.1/example' }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const first = await Promise.all([launch(), launch(), launch()]);
    assert.equal(contexts.length, 1);
    assert.equal(first.filter(result => result.reused).length, 2);
    assert.equal(contexts[0].focuses, 2);
    contexts[0].abandonWindow();
    assert.equal((await launch()).reused, undefined);
    assert.equal(contexts.length, 2);
    contexts[1].closeWindow();
    assert.equal((await launch()).reused, undefined);
    assert.equal(contexts.length, 3);
  } finally {
    await studio.close();
    await new Promise(resolve => server.close(resolve));
    chromium.launchPersistentContext = original;
    await rm(root, { recursive: true, force: true });
  }
});
