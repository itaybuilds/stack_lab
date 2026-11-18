import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { ModelProgress, ModelStatus } from '../ai/needleClient';
import { describeToolCall } from '../ai/sketchTools';
import { AiToolCommand } from '../domain/commands';

export type PendingConfirmation = {
  calls: AiToolCommand[];
  expectedRevision: number;
  confidence: number | null;
  reason: string;
};

type AiAssistantPanelProps = {
  status: ModelStatus;
  progress: ModelProgress | null;
  errorMessage: string | null;
  feedback: string | null;
  pendingConfirmation: PendingConfirmation | null;
  onLoadModel: () => void;
  onCancelLoad: () => void;
  onSubmitPrompt: (prompt: string) => void;
  onConfirmPending: () => void;
  onDismissPending: () => void;
};

const EXAMPLES = [
  'Add a blue rectangle called API Gateway',
  'Create a database below API Gateway',
  'Connect Client to API Gateway',
  'Change API Gateway color to green',
];

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function AiAssistantPanel({
  status,
  progress,
  errorMessage,
  feedback,
  pendingConfirmation,
  onLoadModel,
  onCancelLoad,
  onSubmitPrompt,
  onConfirmPending,
  onDismissPending,
}: AiAssistantPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [prompt, setPrompt] = useState('');

  const isBusy = status === 'downloading' || status === 'initializing' || status === 'thinking';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isBusy) return;
    onSubmitPrompt(trimmed);
  };

  const renderModelStatus = () => {
    if (status === 'unloaded') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-normal text-[#64748b]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#94a3b8]" aria-hidden="true" />
          <span>Local Needle 3 · Not loaded</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLoadModel();
            }}
            className="ml-1 inline-flex items-center gap-1 text-[#2563eb] hover:underline font-medium focus-visible:outline-2 focus-visible:outline-[#2563eb] rounded"
          >
            <Download className="w-3 h-3" />
            <span>Load</span>
          </button>
        </span>
      );
    }

    if (status === 'downloading') {
      const pct =
        progress && progress.totalBytes > 0
          ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
          : 0;
      return (
        <span className="flex items-center gap-2 text-[11px] font-normal text-[#64748b] font-mono-tabular">
          <Loader2 className="w-3 h-3 animate-spin text-[#7c3aed]" />
          <span>
            {progress
              ? `Downloading ${formatMb(progress.loadedBytes)} / ${formatMb(progress.totalBytes)} MB (${pct}%)`
              : 'Downloading Needle 3...'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancelLoad();
            }}
            className="inline-flex items-center gap-0.5 text-[#dc2626] hover:underline font-sans font-medium"
          >
            <X className="w-3 h-3" />
            <span>Cancel</span>
          </button>
        </span>
      );
    }

    if (status === 'initializing') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-normal text-[#64748b]">
          <Loader2 className="w-3 h-3 animate-spin text-[#7c3aed]" />
          <span>Initializing WASM runtime...</span>
        </span>
      );
    }

    if (status === 'thinking') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-normal text-[#7c3aed]">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Local Needle 3 · Thinking...</span>
        </span>
      );
    }

    if (status === 'error') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-normal text-[#dc2626]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" aria-hidden="true" />
          <span>Local Needle 3 · Error</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLoadModel();
            }}
            className="ml-1 inline-flex items-center gap-1 text-[#2563eb] hover:underline font-medium"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1.5 text-[11px] font-normal text-[#16a34a]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" aria-hidden="true" />
        <span>Local Needle 3 · Ready</span>
      </span>
    );
  };

  return (
    <section
      aria-label="AI Assistant"
      className="border-t border-[#e2e8f0] bg-white px-3.5 md:px-6 py-3 md:py-3.5 shrink-0"
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="inline-flex items-center gap-1.5 text-[#7c3aed] text-[13px] md:text-sm font-semibold rounded focus-visible:outline-2 focus-visible:outline-[#2563eb]"
        >
          <Sparkles className="w-4 h-4 shrink-0" strokeWidth={1.85} />
          <span>AI Assistant</span>
        </button>

        <div className="flex-1" />

        {renderModelStatus()}

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand AI Assistant' : 'Collapse AI Assistant'}
          className="p-1 rounded text-[#64748b] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#2563eb]"
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div>
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border border-[#cbd5e1] rounded-lg px-3 py-1.5 focus-within:border-[#2563eb] focus-within:ring-1 focus-within:ring-[#2563eb]"
          >
            <input
              type="text"
              value={prompt}
              maxLength={200}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Add a blue rectangle called API Gateway..."
              aria-label="AI diagram command prompt"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-[#334155] placeholder:text-[#94a3b8] focus:outline-none py-1"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || isBusy}
              aria-label="Send command"
              className="inline-flex items-center justify-center gap-1.5 bg-[#2563eb] hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-medium px-3 py-2 rounded-[7px] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>

          {pendingConfirmation && (
            <div
              role="status"
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              <span>
                {pendingConfirmation.reason}:{' '}
                <strong>
                  {pendingConfirmation.calls.map(describeToolCall).join('; ')}
                </strong>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onConfirmPending}
                  className="px-2.5 py-1 rounded bg-[#2563eb] text-white font-medium hover:bg-blue-700"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={onDismissPending}
                  className="px-2.5 py-1 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {(errorMessage || feedback) && (
            <div
              aria-live="polite"
              className={`mt-2 text-xs ${
                errorMessage ? 'text-[#dc2626]' : 'text-[#475569]'
              }`}
            >
              {errorMessage || feedback}
            </div>
          )}

          <div className="hidden md:flex items-center gap-2 mt-2.5 flex-wrap text-[11px] text-[#64748b]">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="border border-[#e2e8f0] bg-[#f8fafc] hover:bg-slate-100 rounded-[5px] px-2 py-1 text-[#475569] transition-colors"
              >
                {ex}
              </button>
            ))}
            <span className="flex-1" />
            <span>AI runs on your device</span>
          </div>
        </div>
      )}
    </section>
  );
}
