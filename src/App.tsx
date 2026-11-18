import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { needleClient } from './ai/needleClient';
import {
  areSuppressedCallsGroundedInPrompt,
  buildCompactSystemPrompt,
  describeToolCall,
  groundNeedleToolCalls,
  isLikelyNonEnglishPrompt,
  SKETCH_TOOL_DEFINITIONS,
  validateToolCalls,
} from './ai/sketchTools';
import { AiAssistantPanel, PendingConfirmation } from './components/AiAssistantPanel';
import { DrawingBoard } from './components/DrawingBoard';
import { DrawingToolbar } from './components/DrawingToolbar';
import { InfoModals } from './components/InfoModals';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { Bounds, PaletteColor, Point, ToolMode } from './domain/diagramModel';
import {
  applyAiCommandBatch,
  createInitialHistoryState,
  diagramReducer,
} from './domain/commands';
import { RecognitionResult } from './domain/recognition';

const TOOLS_JSON = JSON.stringify(SKETCH_TOOL_DEFINITIONS);

export default function App() {
  const [history, dispatch] = useReducer(diagramReducer, undefined, createInitialHistoryState);
  const [tool, setTool] = useState<ToolMode>('pen');
  const [activeColor, setActiveColor] = useState<PaletteColor>('slate');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Ready to draw');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<'about' | 'community' | null>(null);

  const [aiSnapshot, setAiSnapshot] = useState(() => needleClient.getSnapshot());
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const revisionRef = useRef(history.present.revision);
  revisionRef.current = history.present.revision;

  useEffect(() => {
    return needleClient.subscribe(() => {
      setAiSnapshot({ ...needleClient.getSnapshot() });
    });
  }, []);

  // Clear selection if selected node was removed (undo/clear/delete)
  useEffect(() => {
    if (selectedId && !history.present.nodes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
  }, [history.present.nodes, selectedId]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
    setStatusText('Undid last action');
  }, []);

  const handleRedo = useCallback(() => {
    dispatch({ type: 'REDO' });
    setStatusText('Redid action');
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: 'CLEAR_BOARD' });
    setSelectedId(null);
    setPendingConfirmation(null);
    setStatusText('Cleared canvas');
  }, []);

  const handleSelectColor = useCallback(
    (nextColor: PaletteColor) => {
      setActiveColor(nextColor);
      if (selectedId) {
        dispatch({ type: 'SET_NODE_COLOR', id: selectedId, color: nextColor });
      }
    },
    [selectedId]
  );

  const selectedIndex = selectedId
    ? history.present.nodes.findIndex((n) => n.id === selectedId)
    : -1;
  const canMoveLayerUp =
    selectedIndex !== -1 && selectedIndex < history.present.nodes.length - 1;
  const canMoveLayerDown = selectedIndex > 0;

  const handleMoveLayer = useCallback(
    (direction: 'up' | 'down') => {
      if (!selectedId) return;
      dispatch({ type: 'REORDER_NODE_LAYER', id: selectedId, direction });
      setStatusText(
        direction === 'up' ? 'Moved element 1 layer up' : 'Moved element 1 layer down'
      );
    },
    [selectedId]
  );

  // Global keyboard shortcuts (disabled while typing inside inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        dispatch({ type: 'DELETE_NODE', id: selectedId });
        setSelectedId(null);
        setStatusText('Deleted object');
        return;
      }

      if (e.key === 'Escape') {
        setSelectedId(null);
        setOpenModal(null);
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, selectedId]);

  const handleCommitRecognition = useCallback(
    (result: RecognitionResult, sourceStrokes: Point[][]) => {
      dispatch({ type: 'COMMIT_RECOGNITION', result, sourceStrokes });
    },
    []
  );

  const handleAddInk = useCallback((strokes: Point[][], color: PaletteColor) => {
    dispatch({ type: 'ADD_INK', strokes, color });
  }, []);

  const handleMoveNode = useCallback((id: string, dx: number, dy: number) => {
    dispatch({ type: 'MOVE_NODE', id, dx, dy });
  }, []);

  const handleResizeNode = useCallback((id: string, bounds: Bounds) => {
    dispatch({ type: 'RESIZE_NODE', id, bounds });
  }, []);

  const handleResizeConnectorEndpoint = useCallback(
    (id: string, endpoint: 'start' | 'end', point: Point) => {
      dispatch({ type: 'RESIZE_CONNECTOR_ENDPOINT', id, endpoint, point });
    },
    []
  );

  const handleUpdateLabel = useCallback((id: string, label: string) => {
    dispatch({ type: 'UPDATE_LABEL', id, label });
  }, []);

  const handleAddText = useCallback(
    (position: Point, text: string, color: PaletteColor) => {
      dispatch({ type: 'ADD_TEXT', position, text, color });
    },
    []
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      dispatch({ type: 'DELETE_NODE', id });
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId]
  );

  const handleLoadModel = useCallback(() => {
    setAiFeedback(null);
    needleClient.ensureLoaded().catch(() => {
      // Snapshot errorMessage updates panel cleanly
    });
  }, []);

  const handleCancelLoad = useCallback(() => {
    needleClient.cancelLoad();
    setAiFeedback('Model download cancelled. Drawing remains available.');
  }, []);

  const handleSubmitPrompt = useCallback(
    async (promptText: string) => {
      setPendingConfirmation(null);
      setAiFeedback(null);

      if (isLikelyNonEnglishPrompt(promptText)) {
        setAiFeedback(
          'English commands are supported in v1 (e.g., "Add a blue rectangle called API Gateway").'
        );
        return;
      }

      const expectedRevision = revisionRef.current;
      const systemPrompt = buildCompactSystemPrompt(history.present.nodes, selectedId);

      try {
        const outcome = await needleClient.complete(promptText, systemPrompt, TOOLS_JSON);

        if (revisionRef.current !== expectedRevision) {
          setAiFeedback('Diagram changed while AI was running. Re-send your command to apply.');
          return;
        }

        const resp = outcome.response;
        const primary = validateToolCalls(resp.function_calls);
        const suppressed = validateToolCalls(resp.suppressed_calls);
        const groundedPrimary = groundNeedleToolCalls(
          primary.valid,
          promptText,
          history.present.nodes
        );
        const groundedSuppressed = groundNeedleToolCalls(
          suppressed.valid,
          promptText,
          history.present.nodes
        );

        if (
          groundedPrimary.length === 0 &&
          groundedSuppressed.length > 0 &&
          !resp.validation?.negation
        ) {
          const dryRun = applyAiCommandBatch(
            history.present.nodes,
            history.nextId,
            groundedSuppressed
          );
          if (dryRun.ok) {
            if (areSuppressedCallsGroundedInPrompt(groundedSuppressed, promptText)) {
              const summary = dryRun.executedDescriptions.join('; ');
              dispatch({
                type: 'APPLY_AI_BATCH',
                expectedRevision,
                calls: groundedSuppressed,
                summary,
              });
              setAiFeedback(`${summary} (${outcome.latencyMs} ms)`);
              setStatusText(summary);
              return;
            }
            setPendingConfirmation({
              calls: groundedSuppressed,
              expectedRevision,
              confidence: resp.confidence ?? null,
              reason: 'Low-confidence Needle 3 suggestion',
            });
            setAiFeedback(
              `Review suggested change (${outcome.latencyMs} ms) before applying.`
            );
            return;
          }
          if (areSuppressedCallsGroundedInPrompt(groundedSuppressed, promptText)) {
            setAiFeedback(dryRun.error);
            return;
          }
        }

        if (groundedPrimary.length === 0) {
          if (primary.errors.length > 0) {
            setAiFeedback(`Command rejected: ${primary.errors[0]}`);
          } else {
            setAiFeedback(
              'No diagram action matched. Try e.g. "Add a blue rectangle called API Gateway" or "Connect Client to API Gateway".'
            );
          }
          return;
        }

        const dryRun = applyAiCommandBatch(
          history.present.nodes,
          history.nextId,
          groundedPrimary
        );
        if (!dryRun.ok) {
          setAiFeedback(dryRun.error);
          return;
        }

        const hasLowConfDelete =
          groundedPrimary.some((c) => c.name === 'delete_shape') &&
          typeof resp.confidence === 'number' &&
          resp.confidence < 0.35;

        if (hasLowConfDelete) {
          setPendingConfirmation({
            calls: groundedPrimary,
            expectedRevision,
            confidence: resp.confidence ?? null,
            reason: 'Confirm deletion',
          });
          return;
        }

        const summary = dryRun.executedDescriptions.join('; ');
        dispatch({
          type: 'APPLY_AI_BATCH',
          expectedRevision,
          calls: groundedPrimary,
          summary,
        });
        setAiFeedback(`${summary} (${outcome.latencyMs} ms)`);
        setStatusText(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Local AI request failed.';
        setAiFeedback(msg);
      }
    },
    [history.present.nodes, history.nextId, selectedId]
  );

  const handleConfirmPending = useCallback(() => {
    if (!pendingConfirmation) return;
    if (revisionRef.current !== pendingConfirmation.expectedRevision) {
      setAiFeedback('Board changed since suggestion was generated. Please re-run.');
      setPendingConfirmation(null);
      return;
    }
    const dryRun = applyAiCommandBatch(
      history.present.nodes,
      history.nextId,
      pendingConfirmation.calls
    );
    if (!dryRun.ok) {
      setAiFeedback(dryRun.error);
      setPendingConfirmation(null);
      return;
    }
    const summary = pendingConfirmation.calls.map(describeToolCall).join('; ');
    dispatch({
      type: 'APPLY_AI_BATCH',
      expectedRevision: pendingConfirmation.expectedRevision,
      calls: pendingConfirmation.calls,
      summary,
    });
    setAiFeedback(summary);
    setStatusText(summary);
    setPendingConfirmation(null);
  }, [pendingConfirmation, history.present.nodes, history.nextId]);

  return (
    <div className="h-[100dvh] flex flex-col bg-white overflow-hidden">
      <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />

      <div className="flex-1 min-h-0 flex">
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onOpenCommunityModal={() => setOpenModal('community')}
        />

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3.5 md:px-6 py-3 md:py-4 gap-3 shrink-0">
            <div>
              <h1 className="text-[20px] md:text-[23px] font-bold tracking-tight leading-tight text-[#1e293b]">
                Sketch2Flow
              </h1>
              <p className="text-[12px] md:text-[13px] text-[#64748b] mt-0.5">
                Freehand to professional diagrams
              </p>
            </div>

            <div
              className="flex items-center gap-1.5 text-[11px] text-[#64748b] whitespace-nowrap"
              title="All drawing and Needle 3 inference run locally in your browser"
            >
              <ShieldCheck className="w-4 h-4 text-[#16a34a] shrink-0" />
              <span className="hidden sm:inline">Runs locally in your browser</span>
            </div>
          </div>

          <DrawingToolbar
            tool={tool}
            onSelectTool={setTool}
            color={activeColor}
            onSelectColor={handleSelectColor}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            hasNodes={history.present.nodes.length > 0}
            canMoveLayerUp={canMoveLayerUp}
            canMoveLayerDown={canMoveLayerDown}
            onMoveLayerUp={() => handleMoveLayer('up')}
            onMoveLayerDown={() => handleMoveLayer('down')}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClear={handleClear}
          />

          <DrawingBoard
            nodes={history.present.nodes}
            tool={tool}
            activeColor={activeColor}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
            onCommitRecognition={handleCommitRecognition}
            onAddInk={handleAddInk}
            onMoveNode={handleMoveNode}
            onResizeNode={handleResizeNode}
            onResizeConnectorEndpoint={handleResizeConnectorEndpoint}
            onUpdateLabel={handleUpdateLabel}
            onAddText={handleAddText}
            onDeleteNode={handleDeleteNode}
            statusText={statusText}
            onStatusChange={setStatusText}
          />

          <AiAssistantPanel
            status={aiSnapshot.status}
            progress={aiSnapshot.progress}
            errorMessage={aiSnapshot.errorMessage}
            feedback={aiFeedback}
            pendingConfirmation={pendingConfirmation}
            onLoadModel={handleLoadModel}
            onCancelLoad={handleCancelLoad}
            onSubmitPrompt={handleSubmitPrompt}
            onConfirmPending={handleConfirmPending}
            onDismissPending={() => setPendingConfirmation(null)}
          />
        </main>
      </div>

      <InfoModals openModal={openModal} onClose={() => setOpenModal(null)} />
    </div>
  );
}
