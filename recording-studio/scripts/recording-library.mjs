import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const safeId = (value) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) throw new Error('Invalid recording or app ID');
  return value;
};
export function validateRecording(value) {
  safeId(value?.id);
  if (typeof value.name !== 'string' || value.name.length > 300) throw new Error('Invalid recording name');
  if (!Array.isArray(value.plan?.scenes) || value.plan.scenes.some(s => !Array.isArray(s?.actions))) throw new Error('Invalid recording plan');
  if (value.plan.scenes.reduce((n, s) => n + s.actions.length, 0) > 10000) throw new Error('Too many actions');
}

export class RecordingLibrary {
  constructor(root) { this.root = root; this.queue = Promise.resolve(); }
  directory(appId) { return path.join(this.root, safeId(appId)); }
  async list(appId) {
    const dir = this.directory(appId);
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const records = await Promise.all(files.filter(f => f.endsWith('.json')).map(async f => {
      try {
        const record = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        validateRecording(record);
        if (typeof record.updatedAt !== 'string') throw new Error('Missing update timestamp');
        return record;
      } catch (error) {
        // Never hide corrupt recordings or delete them during a library refresh.
        throw new Error('Cannot read recording ' + f + ': ' + error.message + '. The file has been preserved for recovery.');
      }
    }));
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  transaction(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  save(appId, value, { importing = false, appUrl } = {}) {
    return this.transaction(async () => {
      validateRecording(value);
      const dir = this.directory(appId);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${value.id}.json`);
      let current;
      try { current = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current && importing) return current;
      if ((current?.revision || 0) !== (value.revision || 0)) {
        const error = new Error('This recording was edited in another window. Reopen it before saving.');
        error.status = 409;
        throw error;
      }
      const now = new Date().toISOString();
      const result = { ...value, schemaVersion: 1, appId, appUrl, revision: (current?.revision || 0) + 1,
        createdAt: current?.createdAt || value.createdAt || now, updatedAt: importing ? value.updatedAt || now : now,
        actionCount: value.plan.scenes.reduce((n, s) => n + s.actions.length, 0) };
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(result, null, 2), { mode: 0o600 });
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(() => {}); }
      return result;
    });
  }
  delete(appId, id) {
    return this.transaction(async () => {
      await unlink(path.join(this.directory(appId), `${safeId(id)}.json`));
    });
  }
}
