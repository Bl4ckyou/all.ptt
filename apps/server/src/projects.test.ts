import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore } from './projects.js';

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ptt-projects-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ProjectStore', () => {
  it('creates projects with a notes file', async () => {
    const store = new ProjectStore(await workspace());
    const project = await store.create('My project');

    expect((await store.list()).map((entry) => entry.name)).toEqual(['My project']);
    await store.saveNotes(project.id, 'Initial context');

    const detail = await store.get(project.id);
    expect(detail?.notes).toBe('Initial context');
    expect(detail?.conversations).toEqual([]);
  });

  it('stores conversations as files and titles them from the first message', async () => {
    const store = new ProjectStore(await workspace());
    const project = await store.create('Test');
    const conversation = await store.createConversation(project.id);

    expect(conversation.title).toBe('');

    await store.appendMessage(project.id, conversation.id, 'user', 'Hello there');
    await store.appendMessage(project.id, conversation.id, 'assistant', 'Hi!');

    const loaded = await store.getConversation(project.id, conversation.id);
    expect(loaded?.conversation.title).toBe('Hello there');
    expect(loaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(loaded?.messages[1].content).toBe('Hi!');
  });

  it('returns null for unknown projects and conversations', async () => {
    const store = new ProjectStore(await workspace());
    expect(await store.get('missing')).toBeNull();
    expect(await store.getConversation('missing', 'missing')).toBeNull();
  });
});
