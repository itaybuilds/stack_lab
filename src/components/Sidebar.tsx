import { Braces, Database, Network, PenTool, X } from 'lucide-react';

type SidebarProps = {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenCommunityModal: () => void;
};

export function Sidebar({
  mobileOpen,
  onCloseMobile,
  onOpenCommunityModal,
}: SidebarProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-[#f1f5f9] border-r border-[#e2e8f0] px-3.5 pt-6 pb-4">
      <div className="flex items-center justify-between md:hidden px-2 mb-4">
        <span className="text-xs font-bold tracking-widest uppercase text-[#64748b]">
          Navigation
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-[#475569] hover:bg-slate-200/70 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="text-[10px] font-bold tracking-[1.3px] uppercase text-[#64748b] px-2.5 mb-1.5">
        Workspace
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onCloseMobile}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onCloseMobile();
        }}
        className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] bg-[#dbeafe] text-[#1d4ed8] text-[13px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <PenTool className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
        <span className="whitespace-nowrap">Sketch2Flow</span>
      </div>

      <div className="h-px bg-[#dbe3ed] my-4 mx-2" />

      <div className="text-[10px] font-bold tracking-[1.3px] uppercase text-[#64748b] px-2.5 mb-1.5">
        Coming Later
      </div>

      <div className="flex flex-col gap-1" aria-label="Future tools">
        <div
          aria-disabled="true"
          title="Planned future tool"
          className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-[#94a3b8] select-none"
        >
          <Network className="w-[18px] h-[18px] shrink-0" strokeWidth={1.7} />
          <span className="whitespace-nowrap">System Design</span>
        </div>
        <div
          aria-disabled="true"
          title="Planned future tool"
          className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-[#94a3b8] select-none"
        >
          <Database className="w-[18px] h-[18px] shrink-0" strokeWidth={1.7} />
          <span className="whitespace-nowrap">DB Designer</span>
        </div>
        <div
          aria-disabled="true"
          title="Planned future tool"
          className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[7px] text-[13px] text-[#94a3b8] select-none"
        >
          <Braces className="w-[18px] h-[18px] shrink-0" strokeWidth={1.7} />
          <span className="whitespace-nowrap">JSON Tools</span>
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-[#dbe3ed]">
        <button
          type="button"
          onClick={() => {
            onCloseMobile();
            onOpenCommunityModal();
          }}
          className="w-full text-left px-2.5 py-2 rounded-[7px] hover:bg-slate-200/70 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <strong className="block text-xs font-semibold text-[#334155] mb-0.5">
            Suggest a feature
          </strong>
          <span className="block text-xs text-[#64748b]">One prompt at a time.</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="hidden md:block w-[232px] shrink-0 h-full">{navContent}</aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[264px] max-w-[82vw] h-full shadow-xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
