import { RawNeedleResponse } from './sketchTools';

export type ModelStatus =
  | 'unloaded'
  | 'downloading'
  | 'initializing'
  | 'ready'
  | 'thinking'
  | 'error';

export type ModelProgress = {
  loadedBytes: number;
  totalBytes: number;
  fromCache: boolean;
};

export type CompletionOutcome = {
  response: RawNeedleResponse;
  latencyMs: number;
};

type Listener = () => void;

export class NeedleClient {
  private worker: Worker | null = null;
  private status: ModelStatus = 'unloaded';
  private progress: ModelProgress | null = null;
  private errorMessage: string | null = null;
  private modelBytes = 0;
  private nextRequestId = 1;
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private pendingRequests = new Map<
    number,
    { resolve: (res: CompletionOutcome) => void; reject: (err: Error) => void }
  >();
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  getSnapshot() {
    return {
      status: this.status,
      progress: this.progress,
      errorMessage: this.errorMessage,
      modelBytes: this.modelBytes,
    };
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./needleWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'STATUS') {
        this.status = msg.status;
        this.errorMessage = null;
        this.emit();
      } else if (msg.type === 'PROGRESS') {
        this.progress = {
          loadedBytes: msg.loadedBytes,
          totalBytes: msg.totalBytes,
          fromCache: Boolean(msg.fromCache),
        };
        this.emit();
      } else if (msg.type === 'READY') {
        this.status = 'ready';
        this.modelBytes = msg.modelBytes ?? 0;
        this.errorMessage = null;
        this.emit();
        this.initResolve?.();
        this.initResolve = null;
        this.initReject = null;
        this.initPromise = null;
      } else if (msg.type === 'CANCELLED') {
        this.status = 'unloaded';
        this.progress = null;
        this.errorMessage = null;
        this.emit();
        this.initReject?.(new Error('Model download cancelled.'));
        this.initResolve = null;
        this.initReject = null;
        this.initPromise = null;
      } else if (msg.type === 'ERROR') {
        const errMsg = msg.message || 'Failed to load local Needle 3.';
        this.status = 'error';
        this.errorMessage = errMsg;
        this.emit();
        this.initReject?.(new Error(errMsg));
        this.initResolve = null;
        this.initReject = null;
        this.initPromise = null;
      } else if (msg.type === 'COMPLETE_RESULT') {
        this.status = 'ready';
        this.emit();
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          this.pendingRequests.delete(msg.requestId);
          pending.resolve({
            response: msg.response,
            latencyMs: msg.latencyMs,
          });
        }
      } else if (msg.type === 'COMPLETE_ERROR') {
        this.status = 'ready';
        this.emit();
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          this.pendingRequests.delete(msg.requestId);
          pending.reject(new Error(msg.message || 'Inference failed.'));
        }
      }
    };

    worker.onerror = (err) => {
      const errMsg = err.message || 'Web Worker encountered an error.';
      this.status = 'error';
      this.errorMessage = errMsg;
      this.emit();
      this.initReject?.(new Error(errMsg));
      this.initResolve = null;
      this.initReject = null;
      this.initPromise = null;
      for (const [, p] of this.pendingRequests) {
        p.reject(new Error(errMsg));
      }
      this.pendingRequests.clear();
    };

    this.worker = worker;
    return worker;
  }

  async ensureLoaded(): Promise<void> {
    if (this.status === 'ready') return;
    if (this.initPromise) return this.initPromise;

    const worker = this.ensureWorker();
    const baseUrl = new URL(import.meta.env.BASE_URL || './', window.location.href).toString();

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      worker.postMessage({ type: 'INIT', baseUrl });
    });

    return this.initPromise;
  }

  cancelLoad() {
    this.worker?.postMessage({ type: 'CANCEL' });
  }

  async complete(
    prompt: string,
    systemPrompt: string,
    toolsJson: string
  ): Promise<CompletionOutcome> {
    if (this.status === 'thinking') {
      throw new Error('Wait for the current AI request to finish.');
    }
    await this.ensureLoaded();

    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    this.status = 'thinking';
    this.emit();

    return new Promise<CompletionOutcome>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      worker.postMessage({
        type: 'COMPLETE',
        requestId,
        prompt,
        systemPrompt,
        toolsJson,
      });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pendingRequests.clear();
  }
}

export const needleClient = new NeedleClient();
