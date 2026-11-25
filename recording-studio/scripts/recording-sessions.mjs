import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { RecordingLibrary, safeId } from './recording-library.mjs';

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
const localOrigin = (origin) => {
  try { const url = new URL(origin); return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
  catch { return false; }
};

export function installRecordingStudio(app, { packageRoot, port }) {
  const dataRoot = process.env.RECORDING_STUDIO_DATA_DIR || path.join(packageRoot, 'outputs');
  const library = new RecordingLibrary(path.join(dataRoot, 'recordings'));
  const sessions = new Map();
  const launches = new Map();
  const serviceBase = `http://127.0.0.1:${port}`;
  const wrap = asyncRoute;
  app.use((req, res, next) => {
    // Loopback binding alone does not protect against requests from arbitrary websites.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'Local service only' });
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    req.recordingSession = sessions.get(token);
    if (req.recordingSession && req.headers.origin && req.headers.origin !== new URL(req.recordingSession.appUrl).origin) {
      return res.status(403).json({ error: 'Session origin mismatch' });
    }
    if (req.headers.origin && !localOrigin(req.headers.origin) && !req.recordingSession) return res.status(403).json({ error: 'Untrusted origin' });
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/recording-studio/health', (_req, res) => res.json({ ok: true, version: 1, library: library.root }));
  app.get('/runtime.js', wrap(async (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store').send(await readFile(path.join(packageRoot, 'dist/recorder.js'), 'utf8'));
  }));
  app.post('/api/recording-studio/sessions', wrap(async (req, res) => {
    if (req.recordingSession) return res.status(403).json({ error: 'Cannot launch nested sessions' });
    const appId = safeId(req.body.appId);
    const url = new URL(req.body.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an HTTP app URL');
    if (req.body.attach && (!localOrigin(url.origin) || (req.headers.origin && req.headers.origin !== url.origin))) throw new Error('Attach is limited to the requesting local app');
    if (req.body.recordingId) safeId(req.body.recordingId);
    const token = randomBytes(32).toString('hex');
    const config = { appId, appUrl: url.href, language: req.body.language || 'en', recordingId: req.body.recordingId,
      languages: req.body.languages || ['en'], readySelector: req.body.readySelector || 'body',
      videoExportEnabled: req.body.videoExportEnabled !== false,
      serviceBase, sessionToken: token };
    const session = { ...config, browser: null };
    sessions.set(token, session);
    if (req.body.attach) { res.json(config); return; }
    // Serialize launches per profile so repeated clicks cannot race Chrome's profile lock.
    const previous = launches.get(appId);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    launches.set(appId, pending);
    await previous;
    try {
      for (const [existingToken, existing] of sessions) {
        if (existing === session || existing.appId !== appId || !existing.browser) continue;
        const context = existing.browser;
        const pages = context.pages().filter(page => !page.isClosed());
        const page = pages.find(page => page.url().startsWith(url.origin + '/')) || pages[0];
        if (page && context.browser()?.isConnected() !== false) {
          try {
            await page.bringToFront();
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('moonshot-walkthrough-open-recorder')));
            sessions.delete(token);
            return res.json({ ok: true, appId, url: page.url(), reused: true });
          } catch (error) {
            if (!page.isClosed() && context.browser()?.isConnected() !== false) throw error;
          }
        }
        await context.close();
        sessions.delete(existingToken);
      }
      const profileDir = path.join(dataRoot, 'profiles', appId);
      await mkdir(profileDir, { recursive: true, mode: 0o700 });
      const context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', chromiumSandbox: true,
        headless: process.env.RECORDING_STUDIO_HEADLESS === '1', viewport: null, bypassCSP: true });
      session.browser = context;
      context.on('close', () => sessions.delete(token));
      const watchPage = page => page.on('close', () => {
        // Chrome can remain alive on macOS after its final window closes.
        if (!context.pages().some(openPage => !openPage.isClosed())) {
          void context.close().catch(error => console.warn('[recording-studio] Closing empty browser:', error.message));
        }
      });
      context.pages().forEach(watchPage);
      context.on('page', watchPage);
      await context.exposeBinding('__projectStudioRequest', async (source, request) => {
        if (new URL(source.frame.url()).origin !== url.origin || source.frame !== source.page.mainFrame()) throw new Error('Untrusted recording frame');
        if (!/^\/api\/(recording-studio\/library(?:\/|$)|walkthrough-export\/)/.test(request.path) || request.path.includes('..')) throw new Error('Unsupported recording operation');
        const result = await fetch(`${serviceBase}${request.path}`, { method: request.method, signal: AbortSignal.timeout(30000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: request.body === undefined ? undefined : JSON.stringify(request.body) });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || `Recording service ${result.status}`);
        return data;
      });
      const bundle = await readFile(path.join(packageRoot, 'dist/recorder.js'), 'utf8');
      await context.addInitScript({ content: `if(location.origin===${JSON.stringify(url.origin)}) {window.__projectStudioRecording=${JSON.stringify(config)};\n${bundle}\n}` });
      const page = context.pages()[0] || await context.newPage();
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__moonshotWalkthroughReady, null, { timeout: 65000 });
      res.json({ ok: true, appId, url: url.href });
    } catch (error) {
      try { await session.browser?.close(); } finally { sessions.delete(token); }
      throw error;
    } finally {
      release();
      if (launches.get(appId) === pending) launches.delete(appId);
    }
  }));

  app.use('/api/recording-studio/library', (req, res, next) => {
    if (!req.recordingSession) return res.status(401).json({ error: 'Open Recording Studio from Project Studio first' });
    next();
  });
  app.get('/api/recording-studio/library', wrap(async (req, res) => res.json(await library.list(req.recordingSession.appId))));
  app.post('/api/recording-studio/library/import', wrap(async (req, res) => {
    if (!Array.isArray(req.body.recordings) || req.body.recordings.length > 1000) throw new Error('Invalid import');
    for (const recording of req.body.recordings) await library.save(req.recordingSession.appId, recording, { importing: true, appUrl: req.recordingSession.appUrl });
    res.json({ ok: true });
  }));
  app.post('/api/recording-studio/library', wrap(async (req, res) => res.json(await library.save(req.recordingSession.appId, req.body, { appUrl: req.recordingSession.appUrl }))));
  app.delete('/api/recording-studio/library/:id', wrap(async (req, res) => { await library.delete(req.recordingSession.appId, req.params.id); res.json({ ok: true }); }));
  return { library, close: async () => { await Promise.all([...sessions.values()].map(s => s.browser?.close())); } };
}
