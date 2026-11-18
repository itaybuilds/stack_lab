import { Layers, Menu } from 'lucide-react';

type TopHeaderProps = {
  onOpenMobileMenu: () => void;
};

export function TopHeader({ onOpenMobileMenu }: TopHeaderProps) {
  return (
    <header className="h-14 md:h-16 bg-[#142038] text-white flex items-center px-3.5 md:px-6 gap-2.5 md:gap-3.5 shrink-0 select-none">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Open navigation menu"
        className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-2 transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-2.5 text-[19px] md:text-[21px] font-bold tracking-tight whitespace-nowrap shrink-0">
        <Layers className="w-6 h-6 md:w-7 md:h-7 text-[#60a5fa]" strokeWidth={1.85} />
        <span>StackLab</span>
      </div>

      <span className="hidden md:inline-block text-[13px] text-[#a9b8cd] border-l border-slate-600 pl-3.5 whitespace-nowrap">
        Developer tools. Reimagined.
      </span>

      <div className="flex-1" />

      <span className="hidden lg:inline-block text-xs text-[#a9b8cd] whitespace-nowrap">
        Built with AI. Shaped by developers.
      </span>
    </header>
  );
}
