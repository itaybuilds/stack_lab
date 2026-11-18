import {
  BringToFront,
  Eraser,
  MousePointer,
  Pencil,
  PenTool,
  Redo2,
  SendToBack,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import {
  PALETTE_ORDER,
  PALETTE_STYLES,
  PaletteColor,
  ToolMode,
} from '../domain/diagramModel';

type DrawingToolbarProps = {
  tool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  color: PaletteColor;
  onSelectColor: (color: PaletteColor) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasNodes: boolean;
  canMoveLayerUp: boolean;
  canMoveLayerDown: boolean;
  onMoveLayerUp: () => void;
  onMoveLayerDown: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

const TOOLS: Array<{ id: ToolMode; label: string; icon: typeof PenTool; shortcut: string }> = [
  { id: 'pen', label: 'Smart Pen', icon: PenTool, shortcut: 'Draw any shape or arrow' },
  { id: 'ink', label: 'Pen', icon: Pencil, shortcut: 'Draw regular freehand ink' },
  { id: 'select', label: 'Select', icon: MousePointer, shortcut: 'Select, drag, resize, or double-click to label' },
  { id: 'erase', label: 'Erase', icon: Eraser, shortcut: 'Click an object to delete it' },
  { id: 'text', label: 'Text', icon: Type, shortcut: 'Click canvas or shape to add label' },
];

export function DrawingToolbar({
  tool,
  onSelectTool,
  color,
  onSelectColor,
  canUndo,
  canRedo,
  hasNodes,
  canMoveLayerUp,
  canMoveLayerDown,
  onMoveLayerUp,
  onMoveLayerDown,
  onUndo,
  onRedo,
  onClear,
}: DrawingToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools and palette"
      className="flex items-center gap-1 md:gap-1.5 px-2.5 md:px-5 py-2 border-y border-[#e2e8f0] bg-white flex-wrap min-h-[56px] shrink-0"
    >
      <div className="flex items-center gap-1">
        {TOOLS.map((item) => {
          const Icon = item.icon;
          const active = tool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTool(item.id)}
              aria-pressed={active}
              aria-label={item.label}
              title={`${item.label} — ${item.shortcut}`}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 md:px-3 py-1.5 rounded-[7px] text-xs transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 ${
                active
                  ? 'bg-[#dbeafe] text-[#1d4ed8] font-semibold'
                  : 'text-[#475569] hover:bg-slate-100'
              }`}
            >
              <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.75} />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="hidden sm:block h-6 w-px bg-[#e2e8f0] mx-1.5" aria-hidden="true" />

      <div
        role="group"
        aria-label="Color palette"
        className="flex items-center gap-2 md:gap-2.5 px-1.5 py-1"
      >
        {PALETTE_ORDER.map((c) => {
          const style = PALETTE_STYLES[c];
          const selected = color === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onSelectColor(c)}
              aria-label={`${style.name} color`}
              aria-pressed={selected}
              title={style.name}
              style={{ backgroundColor: style.stroke }}
              className={`w-[20px] h-[20px] md:w-[19px] md:h-[19px] rounded-full p-0 border-0 cursor-pointer transition-transform focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 ${
                selected ? 'ring-2 ring-[#2563eb] ring-offset-[3px] scale-105' : 'hover:scale-105'
              }`}
            />
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <div role="group" aria-label="Layer order" className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveLayerUp}
            disabled={!canMoveLayerUp}
            aria-label="Move layer up"
            title="Move selected element one layer up"
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-[7px] text-xs text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 transition-colors"
          >
            <BringToFront className="w-[17px] h-[17px]" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={onMoveLayerDown}
            disabled={!canMoveLayerDown}
            aria-label="Move layer down"
            title="Move selected element one layer down"
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-[7px] text-xs text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 transition-colors"
          >
            <SendToBack className="w-[17px] h-[17px]" strokeWidth={1.75} />
          </button>
        </div>

        <div className="hidden sm:block h-6 w-px bg-[#e2e8f0] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-[7px] text-xs text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 transition-colors"
        >
          <Undo2 className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-[7px] text-xs text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 transition-colors"
        >
          <Redo2 className="w-[17px] h-[17px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={!hasNodes}
          aria-label="Clear canvas"
          title="Clear canvas (undoable)"
          className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 md:px-3 py-1.5 rounded-[7px] text-xs text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#2563eb] focus-visible:outline-offset-2 transition-colors"
        >
          <Trash2 className="w-[17px] h-[17px] shrink-0" strokeWidth={1.75} />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
