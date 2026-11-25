import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RecordingLibrary } from '../scripts/recording-library.mjs';

test('recording library persists, isolates apps, detects conflicts and imports once', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-library-'));
  try {
    const library = new RecordingLibrary(dir);
    const value = { id: 'test', name: 'Demo', plan: { scenes: [{ actions: [{ type: 'click', target: '#button' }] }] } };
    const saved = await library.save('first', value);
    assert.equal(saved.revision, 1);
    assert.equal(saved.actionCount, 1);
    assert.equal((await new RecordingLibrary(dir).list('first'))[0].name, 'Demo');
    assert.deepEqual(await library.list('second'), []);
    await assert.rejects(library.save('first', value), /another window/);
    assert.equal((await library.save('first', { ...saved, name: 'Edited' })).revision, 2);
    assert.equal((await library.save('first', value, { importing: true })).name, 'Edited');
    await assert.rejects(library.save('../escape', value), /Invalid/);
    await assert.rejects(library.save('first', { ...value, id: '../escape' }), /Invalid/);
    await library.delete('first', 'test');
    assert.deepEqual(await library.list('first'), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid plans and damaged recordings fail with actionable diagnostics without deletion', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-library-damaged-'));
  try {
    const library = new RecordingLibrary(dir);
    await assert.rejects(library.save('test', { id: 'bad', name: 'Bad', plan: { scenes: [null] } }), /Invalid recording plan/);
    await library.list('test');
    const file = path.join(dir, 'test', 'damaged.json');
    await writeFile(file, '{broken');
    await assert.rejects(library.list('test'), /damaged.json.*preserved for recovery/);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
