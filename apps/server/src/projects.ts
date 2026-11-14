import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class ProjectStore {
  constructor(private readonly root: string) {}

  private base(): string {
    return join(this.root, '.ptt', 'projects');
  }

  private projectDir(id: string): string {
    return join(this.base(), id);
  }

  private conversationsDir(id: string): string {
    return join(this.projectDir(id), 'conversations');
  }

  private notesPath(id: string): string {
    return join(this.projectDir(id), 'notes.md');
  }

  async list(): Promise<ProjectMeta[]> {
    let entries;
    try {
      entries = await readdir(this.base(), { withFileTypes: true });
    } catch {
      return [];
    }

    const projects: ProjectMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const project = await readJson<ProjectMeta>(join(this.projectDir(entry.name), 'project.json'));
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(name: string): Promise<ProjectMeta> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const project: ProjectMeta = {
      id,
      name: name.trim().slice(0, 120) || 'Project',
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(this.conversationsDir(id), { recursive: true });
    await writeAtomic(join(this.projectDir(id), 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
    await writeFile(this.notesPath(id), '', 'utf8');
    return project;
  }

  async get(
    id: string,
  ): Promise<{ project: ProjectMeta; notes: string; conversations: ConversationMeta[] } | null> {
    const project = await readJson<ProjectMeta>(join(this.projectDir(id), 'project.json'));
    if (!project) return null;

    const notes = await readFile(this.notesPath(id), 'utf8').catch(() => '');
    return { project, notes, conversations: await this.listConversations(id) };
  }

  async saveNotes(id: string, content: string): Promise<void> {
    await mkdir(this.projectDir(id), { recursive: true });
    await writeAtomic(this.notesPath(id), content);
    await this.touchProject(id);
  }

  async listConversations(projectId: string): Promise<ConversationMeta[]> {
    let entries;
    try {
      entries = await readdir(this.conversationsDir(projectId), { withFileTypes: true });
    } catch {
      return [];
    }

    const conversations: ConversationMeta[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const meta = await readJson<ConversationMeta>(
        join(this.conversationsDir(projectId), entry.name),
      );
      if (meta) conversations.push(meta);
    }
    return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createConversation(projectId: string, title = ''): Promise<ConversationMeta> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const meta: ConversationMeta = { id, title: title.trim().slice(0, 80), createdAt: now, updatedAt: now };

    await mkdir(this.conversationsDir(projectId), { recursive: true });
    await writeAtomic(
      join(this.conversationsDir(projectId), `${id}.json`),
      `${JSON.stringify(meta, null, 2)}\n`,
    );
    await writeFile(join(this.conversationsDir(projectId), `${id}.jsonl`), '', 'utf8');
    await this.touchProject(projectId);
    return meta;
  }

  async getConversation(
    projectId: string,
    conversationId: string,
  ): Promise<{ conversation: ConversationMeta; messages: StoredMessage[] } | null> {
    const meta = await readJson<ConversationMeta>(
      join(this.conversationsDir(projectId), `${conversationId}.json`),
    );
    if (!meta) return null;

    const raw = await readFile(
      join(this.conversationsDir(projectId), `${conversationId}.jsonl`),
      'utf8',
    ).catch(() => '');

    const messages: StoredMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as StoredMessage;
        if (message.role === 'user' || message.role === 'assistant') messages.push(message);
      } catch {
        // skip malformed line
      }
    }

    return { conversation: meta, messages };
  }

  async appendMessage(
    projectId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ConversationMeta | null> {
    const metaPath = join(this.conversationsDir(projectId), `${conversationId}.json`);
    const meta = await readJson<ConversationMeta>(metaPath);
    if (!meta) return null;

    const now = new Date().toISOString();
    const message: StoredMessage = { role, content, at: now };
    await appendFile(
      join(this.conversationsDir(projectId), `${conversationId}.jsonl`),
      `${JSON.stringify(message)}\n`,
      'utf8',
    );

    if (role === 'user' && !meta.title) {
      meta.title = content.trim().slice(0, 60) || 'Conversation';
    }
    meta.updatedAt = now;
    await writeAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    await this.touchProject(projectId);
    return meta;
  }

  private async touchProject(id: string): Promise<void> {
    const path = join(this.projectDir(id), 'project.json');
    const project = await readJson<ProjectMeta>(path);
    if (!project) return;
    project.updatedAt = new Date().toISOString();
    await writeAtomic(path, `${JSON.stringify(project, null, 2)}\n`);
  }
}
