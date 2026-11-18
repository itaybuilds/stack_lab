/// <reference lib="webworker" />
import createCactus, { CactusWasmModule } from './cactusEngine.js';

const NEEDLE3_MODEL_URL =
  'https://huggingface.co/Cactus-Compute/needle3/resolve/c95d25b4efa1e9601e785d92438e4ade0dbddbf8/needle3.cact';
const CACHE_NAME = 'stacklab-needle3-v1';

type WorkerIncoming =
  | { type: 'INIT'; baseUrl: string }
  | { type: 'CANCEL' }
  | {
      type: 'COMPLETE';
      requestId: number;
      prompt: string;
      systemPrompt: string;
      toolsJson: string;
    };

let wasmModule: CactusWasmModule | null = null;
let loadedModelBytes = 0;
let lastContextSignature = '';
let activeAbortController: AbortController | null = null;
let initInFlight: Promise<void> | null = null;

function post(msg: unknown) {
  self.postMessage(msg);
}

async function fetchModelWithProgress(signal: AbortSignal): Promise<Uint8Array> {
  // Check browser Cache API first for instant offline/repeat startup
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(NEEDLE3_MODEL_URL);
      if (cached) {
        const buf = new Uint8Array(await cached.arrayBuffer());
        if (buf.byteLength > 1_000_000) {
          post({
            type: 'PROGRESS',
            loadedBytes: buf.byteLength,
            totalBytes: buf.byteLength,
            fromCache: true,
          });
          return buf;
        }
      }
    } catch {
      // Continue with network fetch if Cache API is unavailable
    }
  }

  const resp = await fetch(NEEDLE3_MODEL_URL, { signal, mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Needle 3 model (${resp.status})`);
  }

  const totalHeader = resp.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : 35_335_380;

  if (!resp.body) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    post({ type: 'PROGRESS', loadedBytes: buf.byteLength, totalBytes: buf.byteLength, fromCache: false });
    return buf;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      post({
        type: 'PROGRESS',
        loadedBytes,
        totalBytes,
        fromCache: false,
      });
    }
  }

  const full = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    full.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Persist into Cache API for future visits
  if (typeof caches !== 'undefined' && loadedBytes > 1_000_000) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        NEEDLE3_MODEL_URL,
        new Response(full.slice().buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(loadedBytes),
          },
        })
      );
    } catch {
      // Ignore quota errors cleanly
    }
  }

  return full;
}

async function ensureInitialized(baseUrl: string): Promise<void> {
  if (wasmModule && wasmModule._cactus_models() > 0) return;
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    try {
      post({ type: 'STATUS', status: 'downloading' });
      const wasmUrl = new URL('ai/cactus.wasm', baseUrl).toString();

      const [wasmResp, modelBytes] = await Promise.all([
        fetch(wasmUrl, { signal }),
        fetchModelWithProgress(signal),
      ]);

      if (!wasmResp.ok) {
        throw new Error(`Failed to fetch WASM engine (${wasmResp.status})`);
      }

      post({ type: 'STATUS', status: 'initializing' });
      const wasmBinary = await wasmResp.arrayBuffer();
      const mod = await createCactus({ wasmBinary });

      const ptr = mod._malloc(modelBytes.byteLength);
      if (!ptr) {
        throw new Error('WASM memory allocation failed while loading model weights.');
      }
      try {
        mod.HEAPU8.set(modelBytes, ptr);
        const rc = mod._cactus_load(ptr, BigInt(modelBytes.byteLength));
        if (rc < 0 || mod._cactus_models() < 1) {
          const errPtr = mod._cactus_last_error();
          const detail = errPtr ? mod.UTF8ToString(errPtr) : '';
          throw new Error(detail || `cactus_load returned error code ${rc}`);
        }
      } finally {
        mod._free(ptr);
      }

      wasmModule = mod;
      loadedModelBytes = modelBytes.byteLength;
      lastContextSignature = '';
      post({ type: 'READY', modelBytes: loadedModelBytes });
    } catch (err) {
      wasmModule = null;
      if (signal.aborted) {
        post({ type: 'CANCELLED' });
      } else {
        post({
          type: 'ERROR',
          message: err instanceof Error ? err.message : 'Failed to initialize local Needle 3.',
        });
      }
      throw err;
    } finally {
      activeAbortController = null;
      initInFlight = null;
    }
  })();

  return initInFlight;
}

self.onmessage = async (event: MessageEvent<WorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === 'CANCEL') {
    activeAbortController?.abort();
    return;
  }

  if (msg.type === 'INIT') {
    try {
      await ensureInitialized(msg.baseUrl);
    } catch {
      // Error/Cancel already posted
    }
    return;
  }

  if (msg.type === 'COMPLETE') {
    if (!wasmModule || wasmModule._cactus_models() < 1) {
      post({
        type: 'COMPLETE_ERROR',
        requestId: msg.requestId,
        message: 'Local Needle 3 model is not loaded yet.',
      });
      return;
    }

    const startMs = performance.now();
    try {
      const signature = `${msg.systemPrompt}\n${msg.toolsJson}`;
      if (signature !== lastContextSignature) {
        const initRc = wasmModule.ccall(
          'cactus_init',
          'number',
          ['string', 'string', 'string'],
          [msg.systemPrompt, msg.toolsJson, null]
        ) as number;
        if (initRc < 0) {
          throw new Error(`cactus_init failed (code ${initRc})`);
        }
        lastContextSignature = signature;
      } else {
        wasmModule._cactus_reset();
      }

      const outCap = 65536;
      const outPtr = wasmModule._malloc(outCap);
      if (!outPtr) {
        throw new Error('Failed to allocate output buffer in WASM memory.');
      }

      try {
        const rc = wasmModule.ccall(
          'cactus_complete',
          'number',
          ['string', 'number', 'number', 'number', 'number', 'number'],
          [msg.prompt, 0, 0, 256, outPtr, outCap]
        ) as number;

        const rawOut = wasmModule.UTF8ToString(outPtr);
        if (rc < 0) {
          throw new Error(rawOut || `cactus_complete failed (code ${rc})`);
        }

        const parsed = JSON.parse(rawOut);
        const latencyMs = Math.round(performance.now() - startMs);
        post({
          type: 'COMPLETE_RESULT',
          requestId: msg.requestId,
          response: parsed,
          latencyMs,
        });
      } finally {
        wasmModule._free(outPtr);
      }
    } catch (err) {
      post({
        type: 'COMPLETE_ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : 'Inference failed.',
      });
    }
  }
};
