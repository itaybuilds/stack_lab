import { ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';

type InfoModalProps = {
  openModal: 'about' | 'community' | null;
  onClose: () => void;
};

export function InfoModals({ openModal, onClose }: InfoModalProps) {
  useEffect(() => {
    if (!openModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal, onClose]);

  if (!openModal) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white border border-[#e2e8f0] shadow-xl p-6 text-[#334155]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            {openModal === 'about' ? (
              <ShieldCheck className="w-5 h-5 text-[#16a34a] shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-[#7c3aed] shrink-0" />
            )}
            <h2 id="modal-title" className="text-lg font-bold text-[#1e293b]">
              {openModal === 'about'
                ? 'StackLab — Browser-Only Architecture'
                : 'Suggest a Feature'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-[#64748b] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#2563eb]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {openModal === 'about' ? (
          <div className="space-y-3 text-sm leading-relaxed text-[#475569]">
            <p>
              <strong className="text-[#1e293b]">StackLab</strong> runs entirely in your browser
              with zero backend servers, no accounts, and no API keys.
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong className="text-[#1e293b]">Sketch2Flow Geometric Engine:</strong>{' '}
                Pure TypeScript stroke resampling, corner/residual analysis, and multi-stroke
                arrow &amp; database recognition.
              </li>
              <li>
                <strong className="text-[#1e293b]">Local Needle 3 AI:</strong>{' '}
                On-device inference powered by Cactus Compute WASM runtime and{' '}
                <code className="font-mono-tabular text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  needle3.cact
                </code>{' '}
                (Apache-2.0) running inside an isolated Web Worker and cached in your browser.
              </li>
              <li>
                <strong className="text-[#1e293b]">Privacy:</strong> Your sketches and prompts
                stay on your device and are never transmitted to any external AI API.
              </li>
            </ul>
          </div>
        ) : (
          <div className="space-y-3 text-sm leading-relaxed text-[#475569]">
            <p>
              StackLab is shaped by developers,{' '}
              <strong className="text-[#1e293b]">one prompt at a time</strong>.
            </p>
            <p>
              Have an idea for a new Sketch2Flow shape, workflow shortcut, or the next
              browser-first tool (System Design, DB Designer, or JSON Tools)?
            </p>
            <div className="rounded-lg bg-[#f8fafc] border border-[#e2e8f0] p-3.5 text-xs text-[#475569] space-y-1.5">
              <div className="font-semibold text-[#1e293b]">How community prompts work:</div>
              <div>1. Try Sketch2Flow and spot what would save you time.</div>
              <div>2. Share a short feature idea + implementation prompt on LinkedIn.</div>
              <div>3. Selected ideas are reviewed, tested, and shipped in the next release.</div>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#142038] text-white text-xs font-semibold hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
