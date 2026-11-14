import { randomUUID } from 'node:crypto';
import {
  syncBackend,
  type BackendEntry,
  type SyncProgress,
  type Target,
} from '@ptt/backends';

export type JobStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled';
export type JobKind = 'install' | 'update';

export interface JobProgress {
  backendId: string;
  label: string;
  phase: string;
  asset: string | null;
  downloaded: number;
  total: number;
}

export interface JobInfo {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface JobItem {
  id: string;
  label: string;
  variant?: string;
  version?: string;
}

export interface JobContext {
  root: string;
  target: Target;
  backends: Record<string, BackendEntry>;
  token?: string;
}

class JobControl {
  paused = false;
  cancelled = false;
  readonly abort = new AbortController();
  private waiters: Array<() => void> = [];

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  async wait(): Promise<void> {
    while (this.paused && !this.cancelled) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.cancelled) throw new Error('cancelled');
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  cancel(): void {
    this.cancelled = true;
    this.resume();
    this.abort.abort();
  }
}

export class JobManager {
  private readonly jobs = new Map<string, JobInfo>();
  private readonly controls = new Map<string, JobControl>();

  get(id: string): JobInfo | undefined {
    return this.jobs.get(id);
  }

  startBackends(kind: JobKind, items: JobItem[], context: JobContext): JobInfo {
    const id = randomUUID();
    const control = new JobControl();
    const first = items[0];

    const job: JobInfo = {
      id,
      kind,
      status: 'running',
      progress: {
        backendId: first?.id ?? '',
        label: first?.label ?? '',
        phase: 'checking',
        asset: null,
        downloaded: 0,
        total: 0,
      },
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(id, job);
    this.controls.set(id, control);
    void this.run(job, control, items, context);
    return job;
  }

  pause(id: string): JobInfo | undefined {
    const job = this.jobs.get(id);
    const control = this.controls.get(id);
    if (job && control && job.status === 'running') {
      control.pause();
      job.status = 'paused';
    }
    return job;
  }

  resume(id: string): JobInfo | undefined {
    const job = this.jobs.get(id);
    const control = this.controls.get(id);
    if (job && control && job.status === 'paused') {
      control.resume();
      job.status = 'running';
    }
    return job;
  }

  cancel(id: string): JobInfo | undefined {
    const job = this.jobs.get(id);
    const control = this.controls.get(id);
    if (job && control && job.status !== 'done' && job.status !== 'error') {
      control.cancel();
      job.status = 'cancelled';
    }
    return job;
  }

  private async run(
    job: JobInfo,
    control: JobControl,
    items: JobItem[],
    context: JobContext,
  ): Promise<void> {
    try {
      for (const item of items) {
        await control.wait();

        const backend = context.backends[item.id];
        if (!backend) throw new Error(`unknown backend: ${item.id}`);

        job.progress = {
          backendId: item.id,
          label: backend.label,
          phase: 'checking',
          asset: null,
          downloaded: 0,
          total: 0,
        };

        await syncBackend({
          id: item.id,
          backend,
          target: context.target,
          root: context.root,
          variants: item.variant ? [item.variant] : [],
          mode: job.kind === 'update' ? 'update' : 'install',
          version: item.version,
          token: context.token,
          signal: control.signal,
          control,
          onProgress: (progress: SyncProgress) => {
            job.progress = {
              ...job.progress,
              phase: progress.phase,
              asset: progress.asset ?? null,
              downloaded: progress.downloaded,
              total: progress.total,
            };
          },
        });
      }

      job.status = control.cancelled ? 'cancelled' : 'done';
    } catch (error) {
      job.status = control.cancelled ? 'cancelled' : 'error';
      if (!control.cancelled) job.error = (error as Error).message;
    } finally {
      job.finishedAt = new Date().toISOString();
      this.controls.delete(job.id);
    }
  }
}
