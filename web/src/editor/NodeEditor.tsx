import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  ConnectionMode,
  ControlButton,
  Controls,
  EdgeChange,
  HandleType,
  NodeChange,
  OnConnectEnd,
  OnConnectStartParams,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  Viewport,
  type CoordinateExtent,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { compilePatchToDspProgram } from '../audio/dspProgram';
import { useAudioEngine, type LinkMeterReading, type MidiControlChange, type MidiInputState } from '../audio/useAudioEngine';
import { normalizeCustomWave } from '../graph/customWave';
import { demoPatch } from '../graph/demoPatch';
import { extractExpressionInputs } from '../graph/expression';
import { defaultParamsFor, getDefinition, getNodeDefinition, sequencerShape } from '../graph/nodeTypes';
import { normalizePatchCompatibility } from '../graph/patchCompatibility';
import { patchToJson } from '../graph/serialize';
import { DEFAULT_SPREAD_SIZE, SPREAD_PORTS_HEIGHT } from '../graph/spread';
import type { CustomWaveSettings, ImageAsset, LinkMode, NodeType, Patch, PatchLink, PatchNode, PortDefinition, SampleAsset } from '../graph/types';
import { EdgeOverlayProvider } from './EdgeOverlayContext';
import { canvasHeaderTitleScale, USER_ZOOM_BASELINE } from './canvasZoom';
import { scopedDspNodeId } from './dspNodeScope';
import {
  edgeFromLink,
  edgeId,
  clampControlNodeSize,
  clampCustomWaveNodeSize,
  clampImageNodeSize,
  clampKeysNodeSize,
  clampSequencerNodeSize,
  clampScopeNodeSize,
  DEFAULT_CUSTOM_WAVE_NODE_SIZE,
  DEFAULT_FFT_NODE_SIZE,
  DEFAULT_KEYS_NODE_SIZE,
  DEFAULT_SEQUENCER_NODE_SIZE,
  DEFAULT_SCOPE_NODE_SIZE,
  editorStateToFlowEdges,
  editorStateToFlowNodes,
  flowToEditorState,
  linkFromEdge,
  patchFromFlow,
  type PersistedEditorState,
  type EditorArea,
  type ScopeNodeSize,
  type ShaderFlowEdge,
  type ShaderFlowNode,
  toFlowEdges,
  toFlowNodes,
} from './flowPatch';
import { ShaderEdge } from './ShaderEdge';
import { makeNodeId, ShaderNode } from './ShaderNode';

const nodeTypes = { shaderNode: ShaderNode };
const edgeTypes = { shaderEdge: ShaderEdge };
const STORAGE_KEY = 'visual-fm-2.editor-state.v1';
const HISTORY_LIMIT = 100;
const DRAFT_NODE_PREVIEW_ID = '__draft_node_preview__';
const DUPLICATE_NODE_PREVIEW_PREFIX = '__duplicate_node_preview__:';
const COMPACT_NODE_Z_INDEX = 0;
const EXPANDED_NODE_Z_INDEX = 1;
const SELECTED_NODE_Z_INDEX = 2;
const SELECTED_EDGE_Z_INDEX = 10000;
const DEFAULT_FIT_VIEW_PADDING = 0.2;
const MIN_CANVAS_ZOOM = 0.05;
const ZOOM_RESET_TARGET = USER_ZOOM_BASELINE;
const ZOOM_SETTLE_THRESHOLD = USER_ZOOM_BASELINE * 0.1;
const ZOOM_CHANGE_EPSILON = 0.0001;
const GRAPH_DETAIL_ZOOM_SETTLE_MS = 80;
const PASTE_OFFSET = { x: 36, y: 36 };
const DRAFT_NODE_WIDTH = 168;
const DRAFT_NODE_HANDLE_X_OFFSET = 13;
const DRAFT_NODE_FIRST_PORT_Y = 52;
const DEFAULT_EXPRESSION = 'a';
const FLOW_INFINITE_EXTENT: CoordinateExtent = [[Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]];
const MAX_EMPTY_SCREEN_RATIO = 0.7;
const DEFAULT_NODE_BOUNDS_SIZE = { width: 240, height: 96 };
const NODE_HEADER_HEIGHT = 32;
const DSP_ERROR_PANEL_LIMIT = 4;
const FIT_VIEW_OPTIONS = { padding: DEFAULT_FIT_VIEW_PADDING };
const CONNECTION_LINE_COLORS: Record<LinkMode, string> = {
  set: 'var(--color-link-set)',
  add: 'var(--color-link-add)',
  multiply: 'var(--color-link-multiply)',
};
const DELETE_KEY_CODES = ['Backspace', 'Delete'];
const MULTI_SELECTION_KEY_CODES = ['Meta', 'Shift'];
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };

let subpatchCloneSequence = 0;

type GraphSnapshot = Pick<PersistedEditorState, 'nodes' | 'edges' | 'areas'>;
type HistoryState = { past: GraphSnapshot[]; future: GraphSnapshot[] };

interface DraftNodeConnection {
  originNodeId: string;
  originHandleId: string;
  originHandleType: HandleType;
  pointer: { x: number; y: number };
  modifierActive: boolean;
  mode: LinkMode;
}

interface DuplicateDragState {
  nodeIds: Set<string>;
  originalPositions: Record<string, { x: number; y: number }>;
  currentPositions: Record<string, { x: number; y: number }>;
  duplicating: boolean;
  linkExternal: boolean;
}

interface NodeDragSelectionSnapshot {
  nodeId: string;
  preserveSelection: boolean;
  nodeSelection: Record<string, boolean>;
  edgeSelection: Record<string, boolean>;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface AreaDrawState {
  start: ScreenPoint;
  current: ScreenPoint;
}

interface AreaDragState {
  areaId: string;
  start: ScreenPoint;
  areaPositions: Record<string, { x: number; y: number }>;
  nodePositions: Record<string, { x: number; y: number }>;
  historyCommitted: boolean;
}

interface AreaResizeState {
  areaId: string;
  start: ScreenPoint;
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  originalPosition: { x: number; y: number };
  originalSize: { width: number; height: number };
  historyCommitted: boolean;
}

interface AreaUiResizeState {
  areaId: string;
  start: ScreenPoint;
  originalUiHeight: number;
  historyCommitted: boolean;
}

interface SubpatchEditFrame {
  groupId: string;
  parentNodes: ShaderFlowNode[];
  parentEdges: ShaderFlowEdge[];
  parentPatchName: string;
  parentHistory: HistoryState;
}

interface BoundaryPortSelection {
  nodeId: string;
  side: 'input' | 'output';
  port: string;
}

interface DspEditorDiagnostics {
  nodeErrors: Map<string, string[]>;
  edgeErrors: Map<string, string[]>;
  globalErrors: string[];
}

interface LocalPatchVersion {
  id: string;
  savedAt: string;
}

interface LocalPatchEntry {
  name: string;
  versionCount: number;
  versions: LocalPatchVersion[];
}

interface LocalPatchLibraryState {
  patches: LocalPatchEntry[];
  selectedPatchName: string | null;
  selectedVersionId: string | null;
  loading: boolean;
  error: string | null;
}

interface SampleLibraryState {
  nodeId: string;
  samples: SampleAsset[];
  selectedUrl: string | null;
  loading: boolean;
  error: string | null;
}

type SampleRecordingStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'naming' | 'saving';

interface SampleRecordingState {
  status: SampleRecordingStatus;
  blob: Blob | null;
  extension: string;
  elapsedSeconds: number;
  name: string;
}

const IDLE_SAMPLE_RECORDING: SampleRecordingState = {
  status: 'idle',
  blob: null,
  extension: '.wav',
  elapsedSeconds: 0,
  name: 'recording',
};

interface ImageLibraryState {
  nodeId: string;
  images: ImageAsset[];
  selectedUrl: string | null;
  loading: boolean;
  error: string | null;
}

interface ImportedSubpatchCandidate {
  key: string;
  name: string;
  path: string;
  subpatch: Patch;
  inputCount: number;
  outputCount: number;
  nodeCount: number;
}

interface SubpatchImportModalState {
  fileName: string;
  candidates: ImportedSubpatchCandidate[];
  selectedKey: string | null;
  error: string | null;
}

interface LocalSubpatchImportSource {
  key: string;
  patchName: string;
  versionId: string;
  savedAt: string;
  candidate: ImportedSubpatchCandidate;
}

interface LocalSubpatchImportEntry {
  name: string;
  sources: LocalSubpatchImportSource[];
}

interface LocalSubpatchImportState {
  subpatches: LocalSubpatchImportEntry[];
  selectedSubpatchName: string | null;
  selectedSourceKey: string | null;
  loading: boolean;
  error: string | null;
}

interface MidiControlVisualState {
  sliderValue?: number;
  buttonPressed?: number;
  lastRawValue?: number;
}

interface CopiedGraph {
  nodes: ShaderFlowNode[];
  edges: ShaderFlowEdge[];
}

export function NodeEditor() {
  return (
    <ReactFlowProvider>
      <NodeEditorInner />
    </ReactFlowProvider>
  );
}

function NodeEditorInner() {
  const initialState = useMemo(() => loadInitialEditorState(), []);
  const [patchName, setPatchName] = useState(initialState?.ui?.patchName ?? 'single-patch');
  const [viewport, setViewport] = useState<Viewport>(initialState?.ui?.viewport ?? { x: 0, y: 0, zoom: USER_ZOOM_BASELINE });
  const [settledGraphZoom, setSettledGraphZoom] = useState(viewport.zoom);
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 });
  const [editingTypeNodeId, setEditingTypeNodeId] = useState<string | null>(null);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<ShaderFlowNode, ShaderFlowEdge> | null>(null);
  const [edgeOverlayElement, setEdgeOverlayElement] = useState<HTMLElement | null>(null);
  const [nodes, setNodes] = useState<ShaderFlowNode[]>(() => {
    const callbacks = nodeCallbacksPlaceholder();
    return initialState
      ? editorStateToFlowNodes(initialState, callbacks, null)
      : toFlowNodes(demoPatch, callbacks, null);
  });
  const [areas, setAreas] = useState<EditorArea[]>(() => initialState?.areas ?? []);
  const [nodeStackOrder, setNodeStackOrder] = useState<string[]>(() => nodes.map((node) => node.id));
  const [edges, setEdges] = useState<ShaderFlowEdge[]>(() => {
    return initialState
      ? editorStateToFlowEdges(initialState, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder)
      : toFlowEdges(demoPatch, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  });
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });
  const zoomInteractionRef = useRef({ zoomChanged: false, lastZoom: viewport.zoom });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSettledGraphZoom(viewport.zoom);
    }, GRAPH_DETAIL_ZOOM_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [viewport.zoom]);
  const nodesRef = useRef(nodes);
  const areasRef = useRef(areas);
  const edgesRef = useRef(edges);
  const editorShellRef = useRef<HTMLElement | null>(null);
  const historyGroupRef = useRef<{ key: string; time: number } | null>(null);
  const draftNodeConnectionRef = useRef<DraftNodeConnection | null>(null);
  const provisionalNodeIdsRef = useRef(new Set<string>());
  const duplicateDragRef = useRef<DuplicateDragState | null>(null);
  const pendingNodeDragSelectionRef = useRef<NodeDragSelectionSnapshot | null>(null);
  const activeNodeDragSelectionRef = useRef<NodeDragSelectionSnapshot | null>(null);
  const selectionDragStartRef = useRef<ScreenPoint | null>(null);
  const canvasDragPointerRef = useRef<ScreenPoint | null>(null);
  const canvasDragActiveRef = useRef(false);
  const canvasDragPointerIdRef = useRef<number | null>(null);
  const ignoreSyntheticSelectionPointerDownRef = useRef(false);
  const ignoreSyntheticSelectionPointerUpRef = useRef(false);
  const areaDrawRef = useRef<AreaDrawState | null>(null);
  const areaDragRef = useRef<AreaDragState | null>(null);
  const areaResizeRef = useRef<AreaResizeState | null>(null);
  const areaUiResizeRef = useRef<AreaUiResizeState | null>(null);
  const pendingBoundaryPortRef = useRef<BoundaryPortSelection | null>(null);
  const [draftNodeConnection, setDraftNodeConnection] = useState<DraftNodeConnection | null>(null);
  const [duplicateDrag, setDuplicateDrag] = useState<DuplicateDragState | null>(null);
  const [editingStack, setEditingStack] = useState<SubpatchEditFrame[]>([]);
  const [pendingBoundaryPort, setPendingBoundaryPort] = useState<BoundaryPortSelection | null>(null);
  const [selectedBoundaryPort, setSelectedBoundaryPort] = useState<BoundaryPortSelection | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [saveFeedbackActive, setSaveFeedbackActive] = useState(false);
  const [localPatchLibrary, setLocalPatchLibrary] = useState<LocalPatchLibraryState | null>(null);
  const [sampleLibrary, setSampleLibrary] = useState<SampleLibraryState | null>(null);
  const [sampleRecording, setSampleRecording] = useState<SampleRecordingState>(IDLE_SAMPLE_RECORDING);
  const [imageLibrary, setImageLibrary] = useState<ImageLibraryState | null>(null);
  const [subpatchImportModal, setSubpatchImportModal] = useState<SubpatchImportModalState | null>(null);
  const [localSubpatchImport, setLocalSubpatchImport] = useState<LocalSubpatchImportState | null>(null);
  const [midiSettingsOpen, setMidiSettingsOpen] = useState(false);
  const [selectedMidiInputDeviceIds, setSelectedMidiInputDeviceIds] = useState<string[]>(() => (
    normalizeSelectedMidiDeviceIds(initialState?.ui?.midiInput?.selectedDeviceIds)
  ));
  const [midiControlVisuals, setMidiControlVisuals] = useState<Record<string, MidiControlVisualState>>({});
  const copiedGraphRef = useRef<CopiedGraph | null>(null);
  const pasteCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const sampleFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSampleUploadNodeIdRef = useRef<string | null>(null);
  const sampleRecorderRef = useRef<MediaRecorder | null>(null);
  const sampleRecordingStreamRef = useRef<MediaStream | null>(null);
  const sampleRecordingChunksRef = useRef<Blob[]>([]);
  const sampleRecordingCancelledRef = useRef(false);
  const sampleRecordingStartedAtRef = useRef(0);
  const sampleRecordingTimerRef = useRef<number | null>(null);
  const sampleRecordingSessionIdRef = useRef(0);
  const pendingImageUploadNodeIdRef = useRef<string | null>(null);
  const saveFeedbackTimeoutRef = useRef<number | null>(null);
  const selectedLocalPatchOptionRef = useRef<HTMLButtonElement | null>(null);
  const reconnectingEdgeRef = useRef(false);
  const reconnectDuplicateRef = useRef(false);
  const reconnectingEdgeSnapshotRef = useRef<ShaderFlowEdge | null>(null);
  const rootPatchName = editingStack[0]?.parentPatchName ?? patchName;
  const audio = useAudioEngine({ selectedMidiInputDeviceIds, recordingPatchName: rootPatchName });
  const selectedMidiInputDeviceKey = useMemo(() => selectedMidiInputDeviceIds.join('\n'), [selectedMidiInputDeviceIds]);
  const audioPlaybackActive = audio.status === 'running' || audio.status === 'starting';
  const cpuLoad = audio.status === 'running' ? Math.min(1, audio.cpuLoad) : 0;
  const cpuPercentage = Math.round(cpuLoad * 100);
  const audioRecordingActive = audio.recording.status === 'waiting' || audio.recording.status === 'recording';
  const recordingButtonLabel = audioRecordingActive
    ? formatRecordingTimestamp(audio.recording.elapsedSeconds)
    : 'RC';
  const localPatchStorageEnabled = useMemo(() => canUseLocalPatchStorage(), []);
  const [reconnectPreviewEdge, setReconnectPreviewEdge] = useState<ShaderFlowEdge | null>(null);
  const [areaDraw, setAreaDraw] = useState<AreaDrawState | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const areaTitleInputRef = useRef<HTMLInputElement | null>(null);
  const areaTitlePointerStartRef = useRef<ScreenPoint | null>(null);

  useEffect(() => {
    if (!editingAreaId) return;
    const animationFrame = requestAnimationFrame(() => {
      areaTitleInputRef.current?.focus();
      areaTitleInputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editingAreaId]);

  const toggleAudioPlayback = useCallback(() => {
    if (audioPlaybackActive) {
      audio.stop();
      return;
    }
    void audio.start();
  }, [audioPlaybackActive, audio.start, audio.stop]);

  const toggleAudioRecording = useCallback(() => {
    if (audioRecordingActive) {
      audio.stopRecording();
      return;
    }
    audio.startRecording();
  }, [audio.startRecording, audio.stopRecording, audioRecordingActive]);

  const toggleMidiInputDevice = useCallback((deviceId: string, selected: boolean) => {
    setSelectedMidiInputDeviceIds((current) => {
      if (selected) {
        return current.includes(deviceId) ? current : [...current, deviceId];
      }
      return current.filter((entry) => entry !== deviceId);
    });
    if (selected) {
      void audio.refreshMidiInputDevices();
    }
  }, [audio.refreshMidiInputDevices]);

  useEffect(() => {
    if (selectedMidiInputDeviceIds.length === 0) return;
    void audio.refreshMidiInputDevices();
  }, [audio.refreshMidiInputDevices, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey]);

  useEffect(() => {
    const controlChange = audio.midiInput.lastControlChange;
    if (!controlChange) return;
    setMidiControlVisuals((current) => midiControlVisualsForChange(current, nodesRef.current, edgesRef.current, controlChange));
  }, [audio.midiInput.lastControlChange]);

  useEffect(() => {
    const handlePlaybackKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target) && !isPlaybackShortcutControlEventTarget(event.target)) return;

      event.preventDefault();
      toggleAudioPlayback();
    };

    window.addEventListener('keydown', handlePlaybackKeyDown);
    return () => window.removeEventListener('keydown', handlePlaybackKeyDown);
  }, [toggleAudioPlayback]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    areasRef.current = areas;
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.data.patchNode.type !== 'Spread') return node;
        const area = areas.find((candidate) => candidate.kind === 'spread' && candidate.spreadNodeId === node.id);
        const spreadNodeIds = area?.locked ? [...(area.nodeIds ?? [])] : undefined;
        if (optionalStringArraysEqual(node.data.patchNode.spreadNodeIds, spreadNodeIds)) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            patchNode: { ...node.data.patchNode, spreadNodeIds },
          },
        };
      });
      return changed ? next : current;
    });
  }, [areas]);

  useEffect(() => {
    setAreas((current) => reconcileSpreadAreas(current, nodesRef.current));
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const element = editorShellRef.current;
    if (!element) return;

    const updateEditorSize = () => {
      const rect = element.getBoundingClientRect();
      setEditorSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };

    updateEditorSize();
    const observer = new ResizeObserver(updateEditorSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    pendingBoundaryPortRef.current = pendingBoundaryPort;
  }, [pendingBoundaryPort]);

  const updateDraftNodeConnection = useCallback((
    value: DraftNodeConnection | null | ((current: DraftNodeConnection | null) => DraftNodeConnection | null),
  ) => {
    const next = typeof value === 'function' ? value(draftNodeConnectionRef.current) : value;
    draftNodeConnectionRef.current = next;
    setDraftNodeConnection(next);
  }, []);

  const updateDuplicateDrag = useCallback((
    value: DuplicateDragState | null | ((current: DuplicateDragState | null) => DuplicateDragState | null),
  ) => {
    const next = typeof value === 'function' ? value(duplicateDragRef.current) : value;
    duplicateDragRef.current = next;
    setDuplicateDrag(next);
  }, []);

  const commitHistory = useCallback((groupKey?: string) => {
    const now = Date.now();
    const lastGroup = historyGroupRef.current;
    if (groupKey && lastGroup?.key === groupKey && now - lastGroup.time < 800) {
      historyGroupRef.current = { key: groupKey, time: now };
      return;
    }

    const snapshot = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
    const snapshotKey = graphSnapshotKey(snapshot);
    setHistory((current) => {
      const lastSnapshot = current.past[current.past.length - 1];
      if (lastSnapshot && graphSnapshotKey(lastSnapshot) === snapshotKey) return current;
      return {
        past: [...current.past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
    historyGroupRef.current = groupKey ? { key: groupKey, time: now } : null;
  }, []);

  const updateNodeParam = useCallback((nodeId: string, port: string, value: number) => {
    commitHistory(`param:${nodeId}:${port}`);
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    const nextPatchNode = relatedNode?.data.patchNode.type === 'Sequencer'
      ? {
          ...relatedNode.data.patchNode,
          params: { ...relatedNode.data.patchNode.params, [port]: value },
        }
      : null;
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              params: { ...node.data.patchNode.params, [port]: value },
              outputs: node.data.patchNode.type === 'Ins'
                ? setPortDefaultValue(node.data.patchNode.outputs, port, value)
                : node.data.patchNode.outputs,
            },
          },
        }
      : node,
    ));
    if (nextPatchNode) {
      const nextDefinition = getNodeDefinition(nextPatchNode as PatchNode);
      setEdges((current) => dedupeEdges(current.flatMap((edge) => {
        const link = linkFromEdge(edge);
        if (!link || link.from.node !== nodeId) return [edge];
        return nextDefinition.outputs.some((output) => output.name === link.from.port) ? [edge] : [];
      })));
    }
  }, [commitHistory]);

  const updateNodeParams = useCallback((nodeId: string, values: Record<string, number>) => {
    if (Object.keys(values).length === 0) return;
    commitHistory(`params:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              params: { ...node.data.patchNode.params, ...values },
            },
          },
        }
      : node));
  }, [commitHistory]);

  const updateNodeCustomWave = useCallback((nodeId: string, customWave: CustomWaveSettings, historyKey?: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'CustomWave') return;

    commitHistory(historyKey ?? `custom-wave:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              customWave: normalizeCustomWave(customWave),
            },
          },
        }
      : node,
    ));
  }, [commitHistory]);

  const updateExpression = useCallback((nodeId: string, expression: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Expression') return;

    const inputs = expressionInputDefinitions(expression);
    const nextParams = syncParamsToInputs(relatedNode.data.patchNode.params, inputs);
    const previousInputs = relatedNode.data.patchNode.inputs ?? [];
    const inputsChanged = !samePortDefinitions(previousInputs, inputs);
    if (
      relatedNode.data.patchNode.expression === expression &&
      !inputsChanged
    ) {
      return;
    }

    commitHistory(`expression:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              expression,
              inputs,
              params: nextParams,
            },
          },
        }
      : node,
    ));

    if (inputsChanged) {
      const nextInputNames = new Set(inputs.map((input) => input.name));
      setEdges((current) => current.filter((edge) => {
        const link = linkFromEdge(edge);
        return !link || link.to.node !== nodeId || nextInputNames.has(link.to.port);
      }));
    }
  }, [commitHistory]);

  const updateGroupSubpatchName = useCallback((nodeId: string, requestedName: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Group') return;

    const nextName = normalizeSubpatchName(requestedName, relatedNode.data.patchNode.subpatchName ?? nodeId);
    if (nextName === relatedNode.data.patchNode.subpatchName) return;

    const cloneId = relatedNode.data.patchNode.subpatchCloneId;
    commitHistory(`subpatch-name:${nodeId}`);
    setNodes((current) => current.map((node) => {
      const isLinkedGroup = node.id === nodeId || (
        node.data.patchNode.type === 'Group' &&
        cloneId !== undefined &&
        node.data.patchNode.subpatchCloneId === cloneId
      );
      if (!isLinkedGroup) return node;

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            subpatchName: nextName,
          },
        },
      };
    }));
  }, [commitHistory]);

  const updateNodeSample = useCallback((nodeId: string, sample: SampleAsset) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'SamplePlayer') return;

    commitHistory(`sample:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              sample,
            },
          },
        }
      : node,
    ));
  }, [commitHistory]);

  const updateNodeImage = useCallback((nodeId: string, image: ImageAsset) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Image') return;
    commitHistory(`image:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, patchNode: { ...node.data.patchNode, image } } }
      : node));
  }, [commitHistory]);

  const resetSampleRecording = useCallback(() => {
    sampleRecordingSessionIdRef.current += 1;
    sampleRecordingCancelledRef.current = true;
    if (sampleRecordingTimerRef.current !== null) {
      window.clearInterval(sampleRecordingTimerRef.current);
      sampleRecordingTimerRef.current = null;
    }
    const recorder = sampleRecorderRef.current;
    sampleRecorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    sampleRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    sampleRecordingStreamRef.current = null;
    sampleRecordingChunksRef.current = [];
    sampleRecordingStartedAtRef.current = 0;
    setSampleRecording(IDLE_SAMPLE_RECORDING);
  }, []);

  useEffect(() => resetSampleRecording, [resetSampleRecording]);

  const startSampleRecording = useCallback(async () => {
    if (!sampleLibrary || sampleRecording.status !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSampleLibrary((current) => current ? { ...current, error: 'Microphone recording is not supported by this browser.' } : current);
      return;
    }

    sampleRecordingCancelledRef.current = false;
    const recordingSessionId = sampleRecordingSessionIdRef.current + 1;
    sampleRecordingSessionIdRef.current = recordingSessionId;
    setSampleRecording((current) => ({ ...current, status: 'requesting', elapsedSeconds: 0 }));
    setSampleLibrary((current) => current ? { ...current, error: null } : current);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (sampleRecordingCancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recordingFormat = preferredSampleRecordingFormat();
      const recorder = recordingFormat.mimeType
        ? new MediaRecorder(stream, { mimeType: recordingFormat.mimeType })
        : new MediaRecorder(stream);
      sampleRecordingStreamRef.current = stream;
      sampleRecorderRef.current = recorder;
      sampleRecordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) sampleRecordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        resetSampleRecording();
        setSampleLibrary((current) => current ? { ...current, error: 'Microphone recording failed.' } : current);
      };
      recorder.onstop = async () => {
        if (sampleRecordingTimerRef.current !== null) {
          window.clearInterval(sampleRecordingTimerRef.current);
          sampleRecordingTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        sampleRecordingStreamRef.current = null;
        sampleRecorderRef.current = null;
        if (sampleRecordingCancelledRef.current) return;

        const chunks = sampleRecordingChunksRef.current;
        sampleRecordingChunksRef.current = [];
        const recordedBlob = new Blob(chunks, { type: recorder.mimeType || recordingFormat.mimeType || 'audio/webm' });
        if (recordedBlob.size === 0) {
          setSampleRecording(IDLE_SAMPLE_RECORDING);
          setSampleLibrary((current) => current ? { ...current, error: 'The microphone recording was empty.' } : current);
          return;
        }
        try {
          const wavBlob = await convertRecordedAudioToWav(recordedBlob);
          if (sampleRecordingCancelledRef.current || sampleRecordingSessionIdRef.current !== recordingSessionId) return;
          setSampleRecording((current) => ({
            ...current,
            status: 'naming',
            blob: wavBlob,
            extension: '.wav',
            name: 'recording',
          }));
        } catch (error) {
          if (sampleRecordingCancelledRef.current || sampleRecordingSessionIdRef.current !== recordingSessionId) return;
          setSampleRecording(IDLE_SAMPLE_RECORDING);
          const message = error instanceof Error ? error.message : 'Could not convert the microphone recording to WAV.';
          setSampleLibrary((current) => current ? { ...current, error: message } : current);
        }
      };

      recorder.start(250);
      sampleRecordingStartedAtRef.current = performance.now();
      sampleRecordingTimerRef.current = window.setInterval(() => {
        setSampleRecording((current) => ({
          ...current,
          elapsedSeconds: Math.floor((performance.now() - sampleRecordingStartedAtRef.current) / 1000),
        }));
      }, 250);
      setSampleRecording((current) => ({ ...current, status: 'recording', extension: '.wav' }));
    } catch (error) {
      resetSampleRecording();
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied.'
        : error instanceof Error ? error.message : 'Could not access the microphone.';
      setSampleLibrary((current) => current ? { ...current, error: message } : current);
    }
  }, [resetSampleRecording, sampleLibrary, sampleRecording.status]);

  const stopSampleRecording = useCallback(() => {
    const recorder = sampleRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setSampleRecording((current) => ({ ...current, status: 'processing' }));
    recorder.stop();
  }, []);

  const openSampleLibrary = useCallback(async (nodeId: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'SamplePlayer') return;

    resetSampleRecording();
    const currentSample = relatedNode.data.patchNode.sample ?? null;
    setSampleLibrary({
      nodeId,
      samples: currentSample ? [currentSample] : [],
      selectedUrl: currentSample?.url ?? null,
      loading: true,
      error: null,
    });

    try {
      const samples = await fetchLocalSampleLibrary();
      const visibleSamples = currentSample && !samples.some((sample) => sample.url === currentSample.url)
        ? [currentSample, ...samples]
        : samples;
      setSampleLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        samples: visibleSamples,
        selectedUrl: current.selectedUrl ?? visibleSamples[0]?.url ?? null,
        loading: false,
        error: visibleSamples.length === 0 ? 'No samples found in samples/.' : null,
      } : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        samples: currentSample ? [currentSample] : [],
        loading: false,
        error: message,
      } : current);
      setImportError(message);
    }
  }, [resetSampleRecording]);

  const closeSampleLibrary = useCallback(() => {
    resetSampleRecording();
    setSampleLibrary(null);
  }, [resetSampleRecording]);

  const selectSampleFromLibrary = useCallback((sample: SampleAsset) => {
    if (!sampleLibrary) return;
    updateNodeSample(sampleLibrary.nodeId, sample);
    setSampleLibrary(null);
    setImportError(null);
  }, [sampleLibrary, updateNodeSample]);

  const requestSampleUpload = useCallback((nodeId: string) => {
    pendingSampleUploadNodeIdRef.current = nodeId;
    sampleFileInputRef.current?.click();
  }, []);

  const requestSampleUploadFromLibrary = useCallback(() => {
    if (!sampleLibrary) return;
    requestSampleUpload(sampleLibrary.nodeId);
  }, [requestSampleUpload, sampleLibrary]);

  const uploadSampleForNode = useCallback(async (nodeId: string, file: File) => {
    if (!file || !nodeId) return false;

    try {
      setSampleLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: true, error: null } : current);
      const formData = new FormData();
      formData.append('sample', file);
      const response = await fetch('/api/local-samples', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await response.text() || `Sample upload failed (${response.status}).`);
      }
      const payload = await response.json() as unknown;
      if (!isRecord(payload) || typeof payload.name !== 'string' || typeof payload.url !== 'string') {
        throw new Error('Sample upload returned an invalid response.');
      }
      const sample = { name: payload.name, url: payload.url };
      updateNodeSample(nodeId, sample);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? null : current);
      setImportError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: false, error: message } : current);
      setImportError(message);
      return false;
    }
  }, [updateNodeSample]);

  const saveSampleRecording = useCallback(async () => {
    if (!sampleLibrary || sampleRecording.status !== 'naming' || !sampleRecording.blob) return;
    const trimmedName = sampleRecording.name.trim();
    if (!trimmedName) {
      setSampleLibrary((current) => current ? { ...current, error: 'Enter a name for the recording.' } : current);
      return;
    }

    setSampleRecording((current) => ({ ...current, status: 'saving' }));
    const fileName = sampleRecordingFileName(trimmedName, sampleRecording.extension);
    const file = new File([sampleRecording.blob], fileName, { type: sampleRecording.blob.type });
    const saved = await uploadSampleForNode(sampleLibrary.nodeId, file);
    if (!saved) setSampleRecording((current) => ({ ...current, status: 'naming' }));
  }, [sampleLibrary, sampleRecording, uploadSampleForNode]);

  const uploadDroppedSampleFiles = useCallback((nodeId: string, files: FileList) => {
    const file = files[0];
    if (!file) return;
    void uploadSampleForNode(nodeId, file);
  }, [uploadSampleForNode]);

  const uploadSampleFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const nodeId = pendingSampleUploadNodeIdRef.current;
    pendingSampleUploadNodeIdRef.current = null;
    if (!file || !nodeId) return;

    await uploadSampleForNode(nodeId, file);
  }, [uploadSampleForNode]);

  const handleSampleLibraryDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!sampleLibrary || !hasDraggedFiles(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, [sampleLibrary]);

  const handleSampleLibraryDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!sampleLibrary || event.dataTransfer.files.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    uploadDroppedSampleFiles(sampleLibrary.nodeId, event.dataTransfer.files);
  }, [sampleLibrary, uploadDroppedSampleFiles]);

  const openImageLibrary = useCallback(async (nodeId: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Image') return;
    const currentImage = relatedNode.data.patchNode.image ?? null;
    setImageLibrary({ nodeId, images: currentImage ? [currentImage] : [], selectedUrl: currentImage?.url ?? null, loading: true, error: null });
    try {
      const images = await fetchLocalImageLibrary();
      const visibleImages = currentImage && !images.some((image) => image.url === currentImage.url) ? [currentImage, ...images] : images;
      setImageLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        images: visibleImages,
        selectedUrl: current.selectedUrl ?? visibleImages[0]?.url ?? null,
        loading: false,
        error: visibleImages.length === 0 ? 'No images found in images/.' : null,
      } : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, images: currentImage ? [currentImage] : [], loading: false, error: message } : current);
      setImportError(message);
    }
  }, []);

  const requestImageUpload = useCallback((nodeId: string) => {
    pendingImageUploadNodeIdRef.current = nodeId;
    imageFileInputRef.current?.click();
  }, []);

  const uploadImageForNode = useCallback(async (nodeId: string, file: File) => {
    if (!file || !nodeId) return;
    try {
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: true, error: null } : current);
      const formData = new FormData();
      formData.append('image', file);
      const response = await fetch('/api/local-images', { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.text() || `Image upload failed (${response.status}).`);
      const payload = await response.json() as unknown;
      if (!isRecord(payload) || typeof payload.name !== 'string' || typeof payload.url !== 'string') throw new Error('Image upload returned an invalid response.');
      updateNodeImage(nodeId, { name: payload.name, url: payload.url });
      setImageLibrary((current) => current && current.nodeId === nodeId ? null : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: false, error: message } : current);
      setImportError(message);
    }
  }, [updateNodeImage]);

  const uploadImageFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const nodeId = pendingImageUploadNodeIdRef.current;
    pendingImageUploadNodeIdRef.current = null;
    if (file && nodeId) await uploadImageForNode(nodeId, file);
  }, [uploadImageForNode]);

  const handleImageLibraryDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!imageLibrary || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, [imageLibrary]);

  const handleImageLibraryDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!imageLibrary || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadImageForNode(imageLibrary.nodeId, event.dataTransfer.files[0]);
  }, [imageLibrary, uploadImageForNode]);

  const selectImageFromLibrary = useCallback((image: ImageAsset) => {
    if (!imageLibrary) return;
    updateNodeImage(imageLibrary.nodeId, image);
    setImageLibrary(null);
    setImportError(null);
  }, [imageLibrary, updateNodeImage]);

  const requestImageUploadFromLibrary = useCallback(() => {
    if (imageLibrary) requestImageUpload(imageLibrary.nodeId);
  }, [imageLibrary, requestImageUpload]);

  const updateEdgeWeight = useCallback((edgeIdToUpdate: string, weight: number) => {
    commitHistory(`weight:${edgeIdToUpdate}`);
    setEdges((current) => current.map((edge) => edge.id === edgeIdToUpdate
      ? {
          ...edge,
          data: {
            ...edge.data,
            weight,
            mode: edge.data?.mode ?? 'set',
            enabled: edge.data?.enabled !== false,
            onWeightChange: updateEdgeWeightPlaceholder,
            onModeChange: updateEdgeModePlaceholder,
            onInsertNode: insertNodeOnEdgePlaceholder,
          },
        }
      : edge,
    ));
  }, [commitHistory]);

  const updateEdgeMode = useCallback((edgeIdToUpdate: string, mode: LinkMode) => {
    commitHistory(`mode:${edgeIdToUpdate}`);
    setEdges((current) => current.map((edge) => edge.id === edgeIdToUpdate
      ? {
          ...edge,
          data: {
            ...edge.data,
            weight: edge.data?.weight ?? 1,
            mode,
            enabled: edge.data?.enabled !== false,
            onWeightChange: updateEdgeWeightPlaceholder,
            onModeChange: updateEdgeModePlaceholder,
            onInsertNode: insertNodeOnEdgePlaceholder,
          },
        }
      : edge,
    ));
  }, [commitHistory]);

  const updateEdgeEnabled = useCallback((edgeIdToUpdate: string, enabled: boolean) => {
    commitHistory();
    setEdges((current) => current.map((edge) => edge.id === edgeIdToUpdate
      ? {
          ...edge,
          data: {
            ...edge.data,
            weight: edge.data?.weight ?? 1,
            mode: edge.data?.mode ?? 'set',
            enabled,
            onWeightChange: updateEdgeWeightPlaceholder,
            onModeChange: updateEdgeModePlaceholder,
            onInsertNode: insertNodeOnEdgePlaceholder,
          },
        }
      : edge,
    ));
  }, [commitHistory]);

  const toggleSelectedEdges = useCallback(() => {
    const selectedEdgeIds = new Set(
      edgesRef.current.filter((edge) => edge.selected === true).map((edge) => edge.id),
    );
    if (selectedEdgeIds.size === 0) return false;

    commitHistory();
    setEdges((current) => current.map((edge) => (
      selectedEdgeIds.has(edge.id)
        ? {
            ...edge,
            data: {
              ...edge.data,
              weight: edge.data?.weight ?? 1,
              mode: edge.data?.mode ?? 'set',
              enabled: edge.data?.enabled === false,
              onWeightChange: updateEdgeWeightPlaceholder,
              onModeChange: updateEdgeModePlaceholder,
              onInsertNode: insertNodeOnEdgePlaceholder,
            },
          }
        : edge
    )));
    return true;
  }, [commitHistory]);

  const setSelectedEdgesMode = useCallback((mode: LinkMode) => {
    const selectedEdgeIds = new Set(
      edgesRef.current
        .filter((edge) => edge.selected === true && (edge.data?.mode ?? 'set') !== mode)
        .map((edge) => edge.id),
    );
    if (selectedEdgeIds.size === 0) return false;

    commitHistory(`mode:${mode}`);
    setEdges((current) => current.map((edge) => (
      selectedEdgeIds.has(edge.id)
        ? {
            ...edge,
            data: {
              ...edge.data,
              weight: edge.data?.weight ?? 1,
              mode,
              enabled: edge.data?.enabled !== false,
              onWeightChange: updateEdgeWeightPlaceholder,
              onModeChange: updateEdgeModePlaceholder,
              onInsertNode: insertNodeOnEdgePlaceholder,
            },
          }
        : edge
    )));
    return true;
  }, [commitHistory]);

  const updateNodeId = useCallback((nodeId: string, requestedId: string) => {
    const nextId = uniqueNodeId(requestedId, nodeId, nodesRef.current);
    if (!nextId || nextId === nodeId) return;

    commitHistory();
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          id: nextId,
          data: {
            ...node.data,
            patchNode: { ...node.data.patchNode, id: nextId },
          },
        }
      : node,
    ));
    setEdges((current) => dedupeEdges(current.map((edge) => renameEdgeNode(edge, nodeId, nextId))));
    setEditingTypeNodeId((current) => current === nodeId ? nextId : current);
  }, [commitHistory]);

  const updateNodeType = useCallback((nodeId: string, type: NodeType) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;

    provisionalNodeIdsRef.current.delete(nodeId);

    const previousDefinition = relatedNode.data.patchNode.type
      ? getNodeDefinition(relatedNode.data.patchNode as PatchNode)
      : null;
    const nextId = shouldAutoRenameForTypeChange(nodeId, relatedNode.data.patchNode.type)
      ? nextTypeNodeId(nodeId, type, nodesRef.current)
      : nodeId;
    const expression = type === 'Expression' ? DEFAULT_EXPRESSION : undefined;
    const expressionInputs = expression ? expressionInputDefinitions(expression) : undefined;
    const nextDefinition = expressionInputs
      ? { ...getDefinition(type), inputs: expressionInputs }
      : getDefinition(type);
    const groupPatchNode = type === 'Group'
      ? {
          id: nextId,
          type: 'Group' as const,
          params: {},
          position: relatedNode.position,
          inputs: [] as PortDefinition[],
          outputs: [] as PortDefinition[],
        }
      : null;
    const groupSubpatch = groupPatchNode ? emptySubpatchForGroup(groupPatchNode, relatedNode.position) : undefined;
    const nextParams = expressionInputs
      ? syncParamsToInputs({}, expressionInputs)
      : defaultParamsFor(type);

    previousDefinition?.inputs.forEach((input, index) => {
      const nextInput = nextDefinition.inputs[index];
      if (!nextInput) return;
      const previousValue = relatedNode.data.patchNode.params[input.name];
      if (previousValue !== undefined) nextParams[nextInput.name] = previousValue;
    });

    commitHistory();
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          id: nextId,
          data: {
            ...node.data,
            patchNode: {
              id: nextId,
              type,
              ...(node.data.patchNode.customLabel ? { customLabel: node.data.patchNode.customLabel } : {}),
              ...(type === 'Group' ? {
                subpatchName: node.data.patchNode.subpatchName ?? nextId,
                subpatchCloneId: node.data.patchNode.subpatchCloneId ?? makeSubpatchCloneId(nextId),
                inputs: [] as PortDefinition[],
                outputs: [] as PortDefinition[],
                subpatch: groupSubpatch,
              } : {}),
              ...(expression !== undefined ? { expression } : {}),
              ...(type === 'CustomWave' ? {
                customWave: normalizeCustomWave(node.data.patchNode.customWave, node.data.patchNode.params),
              } : {}),
              ...(type === 'Spread' ? { scopeSize: { ...DEFAULT_SPREAD_SIZE } } : {}),
              params: nextParams,
              position: node.position,
              ...(expressionInputs ? { inputs: expressionInputs } : {}),
            },
          },
        }
      : node,
    ));
    setEdges((current) => dedupeEdges(current.flatMap((edge) => {
      const renamed = renameEdgeNode(edge, nodeId, nextId);
      const remapped = remapEdgeForNodeType(renamed, nextId, previousDefinition, nextDefinition);
      return remapped ? [remapped] : [];
    })));
    setAreas((current) => {
      const withoutPreviousSpread = current.filter((area) => area.spreadNodeId !== nodeId);
      if (type !== 'Spread') return withoutPreviousSpread;
      return [...withoutPreviousSpread, spreadAreaForNode({
        ...relatedNode,
        id: nextId,
        data: {
          ...relatedNode.data,
          patchNode: {
            ...relatedNode.data.patchNode,
            id: nextId,
            type: 'Spread',
            scopeSize: { ...DEFAULT_SPREAD_SIZE },
          },
        },
      })];
    });
    setEditingTypeNodeId((current) => current === nodeId ? nextId : current);
  }, [commitHistory]);

  const convertNodeToArea = useCallback((nodeId: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;

    const nodeSize = viewportNodeSize(relatedNode);
    const areaId = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    provisionalNodeIdsRef.current.delete(nodeId);
    commitHistory();
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setAreas((current) => [...current, {
      id: areaId,
      title: 'Area',
      position: { ...relatedNode.position },
      size: {
        width: Math.max(48, nodeSize.width),
        height: Math.max(48, nodeSize.height),
      },
    }]);
    setEditingTypeNodeId(null);
    setSelectedAreaId(areaId);
  }, [commitHistory]);

  const updateNodeCustomLabel = useCallback((nodeId: string, requestedLabel: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;

    const customLabel = requestedLabel.trim();
    if ((relatedNode.data.patchNode.customLabel ?? '') === customLabel) return;

    commitHistory(`label:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              ...(customLabel ? { customLabel } : { customLabel: undefined }),
            },
          },
        }
      : node,
    ));
  }, [commitHistory]);

  const updateBoundaryPortName = useCallback((nodeId: string, side: 'input' | 'output', port: string, requestedPort: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode as PatchNode, side)) return;

    const ports = side === 'input'
      ? relatedNode.data.patchNode.inputs ?? []
      : relatedNode.data.patchNode.outputs ?? [];
    const nextPort = uniqueBoundaryPortName(requestedPort, port, ports.map((entry) => entry.name));
    if (!nextPort || nextPort === port) return;

    commitHistory(`port-name:${nodeId}:${side}:${port}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: side === 'input'
              ? renamePortDefinitions(node.data.patchNode.inputs, port, nextPort)
              : node.data.patchNode.inputs,
            outputs: side === 'output'
              ? renamePortDefinitions(node.data.patchNode.outputs, port, nextPort)
              : node.data.patchNode.outputs,
            params: nextBoundaryPortParams(node.data.patchNode as PatchNode, side, port, nextPort),
          },
        },
      };
    }));
    setEdges((current) => dedupeEdges(current.map((edge) => renameEdgePort(edge, nodeId, side, port, nextPort))));
  }, [commitHistory]);

  const updateBoundaryPortOrder = useCallback((nodeId: string, side: 'input' | 'output', port: string, direction: -1 | 1) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode as PatchNode, side)) return;

    commitHistory(`port-order:${nodeId}:${side}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: side === 'input'
              ? movePortDefinitions(node.data.patchNode.inputs, port, direction)
              : node.data.patchNode.inputs,
            outputs: side === 'output'
              ? movePortDefinitions(node.data.patchNode.outputs, port, direction)
              : node.data.patchNode.outputs,
          },
        },
      };
    }));
  }, [commitHistory]);

  const updateNodeCompactPorts = useCallback((nodeId: string, compact: boolean) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.compactPorts === compact) return;

    commitHistory(`compact:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? {
          ...node,
          selected: compact ? false : node.selected,
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              compactPorts: compact,
            },
          },
        }
      : node,
    ));
  }, [commitHistory]);

  const updateNodeScopeSize = useCallback((nodeId: string, size: ScopeNodeSize, anchor: 'left' | 'right') => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (
      !relatedNode ||
      (
        relatedNode.data.patchNode.type !== 'Scope' &&
        relatedNode.data.patchNode.type !== 'Meter' &&
        relatedNode.data.patchNode.type !== 'FFT' &&
        relatedNode.data.patchNode.type !== 'CustomWave' &&
        relatedNode.data.patchNode.type !== 'SamplePlayer' &&
        relatedNode.data.patchNode.type !== 'Image' &&
        relatedNode.data.patchNode.type !== 'Slider' &&
        relatedNode.data.patchNode.type !== 'Button' &&
        relatedNode.data.patchNode.type !== 'Keys' &&
        relatedNode.data.patchNode.type !== 'Sequencer' &&
        relatedNode.data.patchNode.type !== 'Spread'
      )
    ) {
      return;
    }

    const nextSize = relatedNode.data.patchNode.type === 'Spread'
      ? { width: Math.max(240, Math.round(size.width)), height: Math.max(140, Math.round(size.height)) }
      : relatedNode.data.patchNode.type === 'Sequencer'
      ? (() => {
          const shape = sequencerShape(relatedNode.data.patchNode.params);
          return clampSequencerNodeSize(size, shape.steps, shape.rows);
        })()
      : relatedNode.data.patchNode.type === 'Image'
      ? clampImageNodeSize(size, size.width / Math.max(1, size.height))
      : relatedNode.data.patchNode.type === 'CustomWave' || relatedNode.data.patchNode.type === 'SamplePlayer'
      ? clampCustomWaveNodeSize(size)
      : relatedNode.data.patchNode.type === 'Keys'
        ? clampKeysNodeSize(size)
      : relatedNode.data.patchNode.type === 'Slider' || relatedNode.data.patchNode.type === 'Button'
        ? clampControlNodeSize(size)
        : clampScopeNodeSize(size);
    const previousSize = relatedNode.data.patchNode.scopeSize;
    if (
      previousSize?.width === nextSize.width &&
      previousSize.height === nextSize.height
    ) {
      return;
    }

    commitHistory(`node-size:${nodeId}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;

      const currentSize = node.data.patchNode.scopeSize ?? (
        node.data.patchNode.type === 'Spread'
          ? DEFAULT_SPREAD_SIZE
        : node.data.patchNode.type === 'Sequencer'
          ? clampSequencerNodeSize(
              DEFAULT_SEQUENCER_NODE_SIZE,
              sequencerShape(node.data.patchNode.params).steps,
              sequencerShape(node.data.patchNode.params).rows,
            )
        : node.data.patchNode.type === 'Keys'
          ? DEFAULT_KEYS_NODE_SIZE
        : node.data.patchNode.type === 'FFT'
          ? DEFAULT_FFT_NODE_SIZE
        : node.data.patchNode.type === 'CustomWave' || node.data.patchNode.type === 'SamplePlayer' || node.data.patchNode.type === 'Image'
          ? DEFAULT_CUSTOM_WAVE_NODE_SIZE
          : DEFAULT_SCOPE_NODE_SIZE
      );
      const positionDeltaX = anchor === 'left' ? currentSize.width - nextSize.width : 0;
      const position = positionDeltaX === 0
        ? node.position
        : { ...node.position, x: node.position.x + positionDeltaX };

      return {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scopeSize: nextSize,
          },
        },
      };
    }));
  }, [commitHistory]);

  const addSelectorInput = useCallback((nodeId: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Selector') return;

    const definition = getNodeDefinition(relatedNode.data.patchNode as PatchNode);
    const valueInputs = selectorValueInputs(definition.inputs);
    const nextIndex = Math.max(0, ...valueInputs.map((input) => Number(input.name))) + 1;
    const nextPort = String(nextIndex);
    if (definition.inputs.some((input) => input.name === nextPort)) return;

    commitHistory(`selector-input:${nodeId}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;

      const currentInputs = getNodeDefinition(node.data.patchNode as PatchNode).inputs;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: [...currentInputs, { name: nextPort, defaultValue: 0 }],
            params: {
              ...node.data.patchNode.params,
              [nextPort]: 0,
            },
          },
        },
      };
    }));
  }, [commitHistory]);

  const clearSelectorInput = useCallback((nodeId: string, port: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'Selector') return;
    if (!isSelectorValuePortName(port)) return;

    const definition = getNodeDefinition(relatedNode.data.patchNode as PatchNode);
    const valueInputs = selectorValueInputs(definition.inputs);
    if (!valueInputs.some((input) => input.name === port)) return;

    if (valueInputs.length <= 1) {
      updateNodeParam(nodeId, port, 0);
      return;
    }

    const removedIndex = Number(port);
    const orderedPorts = valueInputs
      .map((input) => input.name)
      .sort((left, right) => Number(left) - Number(right));
    const portMap = selectorPortMapAfterRemoval(orderedPorts, removedIndex);

    commitHistory(`selector-input-clear:${nodeId}:${port}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;

      const currentDefinition = getNodeDefinition(node.data.patchNode as PatchNode);
      const currentValuePorts = selectorValueInputs(currentDefinition.inputs)
        .map((input) => input.name)
        .sort((left, right) => Number(left) - Number(right));
      const currentPortMap = selectorPortMapAfterRemoval(currentValuePorts, removedIndex);
      const nextInputs = currentDefinition.inputs.flatMap((input) => {
        const nextName = currentPortMap.get(input.name);
        if (nextName === undefined) return isSelectorValuePortName(input.name) ? [] : [input];
        return [{ ...input, name: nextName }];
      });
      const nextParams = remapSelectorParamsAfterRemoval(
        node.data.patchNode.params,
        currentValuePorts,
        currentPortMap,
        removedIndex,
      );

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: nextInputs,
            params: nextParams,
          },
        },
      };
    }));
    setEdges((current) => dedupeEdges(current.flatMap((edge) => remapSelectorEdgeAfterRemoval(edge, nodeId, portMap, removedIndex))));
  }, [commitHistory, updateNodeParam]);

  const addDraftNode = useCallback((position: { x: number; y: number }) => {
    const id = makeNodeId('node', new Set(nodesRef.current.map((node) => node.id)));
    provisionalNodeIdsRef.current.add(id);
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: 'shaderNode',
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true,
        },
      },
    ]);
    setEditingTypeNodeId(id);
  }, [commitHistory]);

  const cancelProvisionalNode = useCallback((nodeId: string) => {
    if (!provisionalNodeIdsRef.current.delete(nodeId)) {
      setEditingTypeNodeId(null);
      return;
    }

    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => {
      const link = linkFromEdge(edge);
      return !link || (link.from.node !== nodeId && link.to.node !== nodeId);
    }));
    setEditingTypeNodeId((current) => current === nodeId ? null : current);
    setHistory((current) => ({
      ...current,
      past: current.past.slice(0, -1),
    }));
  }, []);

  const insertNodeOnEdges = useCallback((relatedEdges: ShaderFlowEdge[]) => {
    if (relatedEdges.length === 0) return;

    const firstLink = linkFromEdge(relatedEdges[0]);
    if (!firstLink) return;

    const sourceNode = nodesRef.current.find((node) => node.id === firstLink.from.node);
    const targetNode = nodesRef.current.find((node) => node.id === firstLink.to.node);
    const position = midpointPosition(sourceNode?.position, targetNode?.position);
    const id = makeNodeId('node', new Set(nodesRef.current.map((node) => node.id)));
    const relatedEdgeIds = new Set(relatedEdges.map((edge) => edge.id));

    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: 'shaderNode',
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true,
        },
      },
    ]);
    setEdges((current) => dedupeEdges(current.flatMap((edge) => {
      if (!relatedEdgeIds.has(edge.id)) return [{ ...edge, selected: false }];
      const link = linkFromEdge(edge);
      if (!link) return [];

      return [
        edgeFromLink({
          from: link.from,
          to: { node: id, port: 'value' },
          weight: 1,
          mode: 'set',
          enabled: link.enabled,
        }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder),
        edgeFromLink({
          from: { node: id, port: 'value' },
          to: link.to,
          weight: link.weight,
          mode: link.mode,
          enabled: link.enabled,
        }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder),
      ];
    })));
    setEditingTypeNodeId(id);
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);

  const insertNodeOnEdge = useCallback((edgeIdToInsert: string) => {
    const edge = edgesRef.current.find((candidate) => candidate.id === edgeIdToInsert);
    if (!edge) return;
    insertNodeOnEdges([edge]);
  }, [insertNodeOnEdges]);

  const insertNodeOnPort = useCallback((nodeId: string, side: 'input' | 'output', port: string) => {
    const relatedEdges = edgesRef.current.filter((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return false;
      return side === 'output'
        ? link.from.node === nodeId && link.from.port === port
        : link.to.node === nodeId && link.to.port === port;
    });
    insertNodeOnEdges(relatedEdges);
  }, [insertNodeOnEdges]);

  const deleteSelectedNodesWithBridge = useCallback(() => {
    const selectedNodeIds = new Set(
      nodesRef.current
        .filter((node) => node.selected)
        .map((node) => node.id),
    );
    if (selectedNodeIds.size === 0) return false;

    const bridgeEdges = buildBridgeEdges(nodesRef.current, edgesRef.current, selectedNodeIds, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder);
    const remainingEdges = edgesRef.current.filter((edge) => {
      const link = linkFromEdge(edge);
      return link && !selectedNodeIds.has(link.from.node) && !selectedNodeIds.has(link.to.node);
    });

    commitHistory();
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges(dedupeEdges([...remainingEdges, ...bridgeEdges]));
    setEditingTypeNodeId((current) => current && selectedNodeIds.has(current) ? null : current);
    return true;
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);

  const deleteSelectedBoundaryPort = useCallback(() => {
    const selected = selectedBoundaryPort;
    if (!selected) return false;

    const relatedNode = nodesRef.current.find((node) => node.id === selected.nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode as PatchNode, selected.side)) return false;

    commitHistory();
    setNodes((current) => current.map((node) => {
      if (node.id !== selected.nodeId) return node;

      const nextInputs = selected.side === 'input'
        ? (node.data.patchNode.inputs ?? []).filter((port) => port.name !== selected.port)
        : node.data.patchNode.inputs;
      const nextOutputs = selected.side === 'output'
        ? (node.data.patchNode.outputs ?? []).filter((port) => port.name !== selected.port)
        : node.data.patchNode.outputs;
      const nextParams = boundaryPortHasDefaultValue(node.data.patchNode as PatchNode, selected.side) || selected.side === 'input'
        ? Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port))
        : node.data.patchNode.params;

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            params: nextParams,
            ...(nextInputs ? { inputs: nextInputs } : {}),
            ...(nextOutputs ? { outputs: nextOutputs } : {}),
          },
        },
      };
    }));
    setEdges((current) => dedupeEdges(current.filter((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return true;

      if (selected.side === 'input') {
        return !(link.to.node === selected.nodeId && link.to.port === selected.port);
      }

      return !(link.from.node === selected.nodeId && link.from.port === selected.port);
    })));

    const frame = editingStack[editingStack.length - 1];
    if (frame) {
      setEditingStack((current) => current.map((entry, index) => {
        if (index !== current.length - 1) return entry;

        const parentEdges = dedupeEdges(entry.parentEdges.filter((edge) => {
          const link = linkFromEdge(edge);
          if (!link) return true;

          if (relatedNode.data.patchNode.type === 'Ins' && selected.side === 'output') {
            return !(link.to.node === entry.groupId && link.to.port === selected.port);
          }

          if (relatedNode.data.patchNode.type === 'Outs' && selected.side === 'input') {
            return !(link.from.node === entry.groupId && link.from.port === selected.port);
          }

          return true;
        }));

        const parentNodes = entry.parentNodes.map((node) => {
          if (node.id !== entry.groupId) return node;

          if (relatedNode.data.patchNode.type === 'Ins' && selected.side === 'output') {
            return {
              ...node,
              data: {
                ...node.data,
                patchNode: {
                  ...node.data.patchNode,
                  params: Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port)),
                  inputs: (node.data.patchNode.inputs ?? []).filter((port) => port.name !== selected.port),
                },
              },
            };
          }

          if (relatedNode.data.patchNode.type === 'Outs' && selected.side === 'input') {
            return {
              ...node,
              data: {
                ...node.data,
                patchNode: {
                  ...node.data.patchNode,
                  params: Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port)),
                  outputs: (node.data.patchNode.outputs ?? []).filter((port) => port.name !== selected.port),
                },
              },
            };
          }

          return node;
        });

        return {
          ...entry,
          parentEdges,
          parentNodes,
        };
      }));
    }

    setPendingBoundaryPort((current) => (
      current && current.nodeId === selected.nodeId && current.side === selected.side && current.port === selected.port
        ? null
        : current
    ));
    setSelectedBoundaryPort(null);
    return true;
  }, [commitHistory, editingStack, selectedBoundaryPort]);

  const copySelectedNodes = useCallback(() => {
    const selectedGraph = selectedGraphFromNodes(nodesRef.current, edgesRef.current);
    if (!selectedGraph) return false;

    copiedGraphRef.current = selectedGraph;
    pasteCountRef.current = 1;
    void writeCopiedGraphToClipboard(selectedGraph);
    return true;
  }, []);

  const groupSelectedNodes = useCallback(() => {
    const groupedGraph = groupSelectedGraph(nodesRef.current, edgesRef.current, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder);
    if (!groupedGraph) return false;

    commitHistory();
    setNodes(groupedGraph.nodes);
    setEdges(groupedGraph.edges);
    setEditingTypeNodeId(null);
    return true;
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);

  const scaleSelectedNodes = useCallback((factor: number) => {
    const selectedNodes = nodesRef.current.filter((node) => node.selected);
    if (selectedNodes.length === 0) return false;

    const bounds = selectedNodes.map((node) => {
      const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_BOUNDS_SIZE.width;
      const height = node.measured?.height ?? node.height ?? DEFAULT_NODE_BOUNDS_SIZE.height;
      return { node, width, height };
    });
    const minX = Math.min(...bounds.map(({ node }) => node.position.x));
    const minY = Math.min(...bounds.map(({ node }) => node.position.y));
    const maxX = Math.max(...bounds.map(({ node, width }) => node.position.x + width));
    const maxY = Math.max(...bounds.map(({ node, height }) => node.position.y + height));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const selectedById = new Map(bounds.map((entry) => [entry.node.id, entry]));

    commitHistory();
    setNodes((current) => current.map((node) => {
      const entry = selectedById.get(node.id);
      if (!entry) return node;

      const nextWidth = entry.width * factor;
      const nextHeight = entry.height * factor;
      const currentCenter = {
        x: node.position.x + entry.width / 2,
        y: node.position.y + entry.height / 2,
      };
      const nextCenter = {
        x: center.x + (currentCenter.x - center.x) * factor,
        y: center.y + (currentCenter.y - center.y) * factor,
      };
      const position = { x: nextCenter.x - nextWidth / 2, y: nextCenter.y - nextHeight / 2 };
      return {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scale: (node.data.patchNode.scale ?? 1) * factor,
          },
        },
      };
    }));
    return true;
  }, [commitHistory]);

  const pasteCopiedNodes = useCallback(async () => {
    const clipboardGraph = await readCopiedGraphFromClipboard();
    const copiedGraph = clipboardGraph ?? copiedGraphRef.current;
    if (!copiedGraph) return false;

    if (clipboardGraph) {
      copiedGraphRef.current = clipboardGraph;
      if (pasteCountRef.current === 0) pasteCountRef.current = 1;
    }
    const pasteOffset = {
      x: PASTE_OFFSET.x * pasteCountRef.current,
      y: PASTE_OFFSET.y * pasteCountRef.current,
    };
    const duplicatedGraph = duplicateCopiedGraph(
      copiedGraph,
      nodesRef.current,
      pasteOffset,
      updateEdgeWeight,
      updateEdgeMode,
      insertNodeOnEdgePlaceholder,
    );
    if (duplicatedGraph.nodes.length === 0) return false;

    pasteCountRef.current += 1;
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...duplicatedGraph.nodes.map((node) => ({ ...node, selected: true })),
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicatedGraph.edges,
    ]));
    setEditingTypeNodeId(null);
    return true;
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);

  const createDraftNodeFromConnection = useCallback((draftConnection = draftNodeConnectionRef.current) => {
    if (!draftConnection || !draftConnection.modifierActive || !reactFlow) return;

    const id = makeNodeId('node', new Set(nodesRef.current.map((node) => node.id)));
    const position = draftNodePosition(draftConnection, reactFlow);
    const link = linkForDraftNodeConnection(draftConnection, id);
    if (!link) return;

    provisionalNodeIdsRef.current.add(id);
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: 'shaderNode',
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true,
        },
      },
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      edgeFromLink(link, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder),
    ]));
    setEditingTypeNodeId(id);
  }, [commitHistory, reactFlow, updateEdgeMode, updateEdgeWeight]);

  const materializePendingBoundaryPort = useCallback((pending: BoundaryPortSelection): void => {
    const relatedNode = nodesRef.current.find((node) => node.id === pending.nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode as PatchNode, pending.side)) return;

    setNodes((current) => current.map((node) => {
      if (node.id !== pending.nodeId) return node;

      const nextPort: PortDefinition = boundaryPortHasDefaultValue(relatedNode.data.patchNode as PatchNode, pending.side)
        ? { name: pending.port, defaultValue: 0 }
        : { name: pending.port };
      const ports = pending.side === 'input'
        ? node.data.patchNode.inputs ?? []
        : node.data.patchNode.outputs ?? [];
      if (ports.some((port) => port.name === pending.port)) return node;

      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: pending.side === 'input'
              ? [...ports, nextPort]
              : node.data.patchNode.inputs,
            outputs: pending.side === 'output'
              ? [...ports, nextPort]
              : node.data.patchNode.outputs,
            params: boundaryPortHasDefaultValue(node.data.patchNode as PatchNode, pending.side)
              ? { ...node.data.patchNode.params, [pending.port]: 0 }
              : node.data.patchNode.params,
          },
        },
      };
    }));
  }, []);

  const enterGroupNode = useCallback((node: ShaderFlowNode) => {
    const patchNode = node.data.patchNode;
    if (patchNode.type !== 'Group') return false;

    const subpatch = patchNode.subpatch ?? emptySubpatchForGroup(patchNode as PatchNode, node.position);
    setEditingStack((current) => [
      ...current,
      {
        groupId: node.id,
        parentNodes: nodesRef.current.map(cloneFlowNodeSnapshot),
        parentEdges: edgesRef.current.map(cloneFlowEdgeSnapshot),
        parentPatchName: patchName,
        parentHistory: history,
      },
    ]);
    const callbacks = nodeCallbacksPlaceholder();
    setNodes(toFlowNodes(subpatch, callbacks, null));
    setEdges(toFlowEdges(subpatch, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder));
    setPatchName(patchNode.subpatchName ?? node.id);
    setEditingTypeNodeId(null);
    setPendingBoundaryPort(null);
    copiedGraphRef.current = null;
    pasteCountRef.current = 0;
    historyGroupRef.current = null;
    setHistory({ past: [], future: [] });
    return true;
  }, [history, patchName, updateEdgeMode, updateEdgeWeight]);

  const exitSubpatch = useCallback(() => {
    const frame = editingStack[editingStack.length - 1];
    if (!frame) return false;

    const subpatch = patchFromFlow(nodesRef.current, edgesRef.current);
    const parentGraph = applySubpatchToParent(frame, subpatch, patchName);
    const previousParentSnapshot = graphSnapshot(frame.parentNodes, frame.parentEdges, areasRef.current);

    setEditingStack((current) => current.slice(0, -1));
    setNodes(parentGraph.nodes);
    setEdges(parentGraph.edges);
    setPatchName(frame.parentPatchName);
    setEditingTypeNodeId(null);
    setPendingBoundaryPort(null);
    copiedGraphRef.current = null;
    pasteCountRef.current = 0;
    historyGroupRef.current = null;
    setHistory({
      past: [...frame.parentHistory.past, previousParentSnapshot].slice(-HISTORY_LIMIT),
      future: [],
    });
    return true;
  }, [editingStack, patchName]);

  const selectedLinkPortsByNode = useMemo(() => {
    const portsByNode = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
    const ensureEntry = (nodeId: string) => {
      const existing = portsByNode.get(nodeId);
      if (existing) return existing;
      const entry = { inputs: new Set<string>(), outputs: new Set<string>() };
      portsByNode.set(nodeId, entry);
      return entry;
    };

    for (const edge of edges) {
      if (edge.selected !== true) continue;
      const link = linkFromEdge(edge);
      if (!link) continue;
      ensureEntry(link.from.node).outputs.add(link.from.port);
      ensureEntry(link.to.node).inputs.add(link.to.port);
    }

    return new Map([...portsByNode].map(([nodeId, ports]) => [
      nodeId,
      {
        inputs: [...ports.inputs],
        outputs: [...ports.outputs],
      },
    ]));
  }, [edges]);

  const connectedPortsByNode = useMemo(() => {
    const portsByNode = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
    const ensureEntry = (nodeId: string) => {
      const existing = portsByNode.get(nodeId);
      if (existing) return existing;
      const entry = { inputs: new Set<string>(), outputs: new Set<string>() };
      portsByNode.set(nodeId, entry);
      return entry;
    };

    for (const edge of edges) {
      const link = linkFromEdge(edge);
      if (!link) continue;
      ensureEntry(link.from.node).outputs.add(link.from.port);
      ensureEntry(link.to.node).inputs.add(link.to.port);
    }

    return new Map([...portsByNode].map(([nodeId, ports]) => [
      nodeId,
      {
        inputs: [...ports.inputs],
        outputs: [...ports.outputs],
      },
    ]));
  }, [edges]);

  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const selectedAreaNodeIds = useMemo(() => (
    selectedAreaId
      ? nodeIdsContainedByAreaHierarchy(areas, nodes, selectedAreaId)
      : new Set<string>()
  ), [areas, nodes, selectedAreaId]);
  const nodeStackRanks = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const orderedNodeIds = nodeStackOrder.filter((nodeId) => nodeIds.has(nodeId));
    const rankedNodeIds = new Set(orderedNodeIds);

    for (const node of nodes) {
      if (rankedNodeIds.has(node.id)) continue;
      orderedNodeIds.push(node.id);
      rankedNodeIds.add(node.id);
    }

    return new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));
  }, [nodes, nodeStackOrder]);

  const nodesWithCallbacks = useMemo(() => nodes.map((node) => {
    const compactPorts = node.data.patchNode.compactPorts === true;

    return {
      ...node,
      ...(node.data.patchNode.type === 'Spread' ? { draggable: false, selectable: false } : {}),
      zIndex: node.data.patchNode.type === 'Spread'
        ? 0
        : 1 + nodeZIndex(
            node.selected === true || selectedAreaNodeIds.has(node.id),
            compactPorts,
            nodeStackRanks.get(node.id) ?? 0,
            nodes.length,
          ),
      data: {
        ...node.data,
        onParamChange: updateNodeParam,
        onParamsChange: updateNodeParams,
        onCustomWaveChange: updateNodeCustomWave,
        onAudioInputDeviceChange: audio.setAudioInputDeviceId,
        onAudioInputRefresh: audio.refreshAudioInputDevices,
        onMidiInputRefresh: audio.refreshMidiInputDevices,
        onTypeChange: updateNodeType,
        onConvertToArea: convertNodeToArea,
        onCustomLabelChange: updateNodeCustomLabel,
        onExpressionCommit: updateExpression,
        onTypeEditStart: setEditingTypeNodeId,
        onTypeEditEnd: () => setEditingTypeNodeId(null),
        onTypeEditCancel: cancelProvisionalNode,
        onIdChange: updateNodeId,
        onSubpatchNameChange: updateGroupSubpatchName,
        onSampleSelect: openSampleLibrary,
        onSampleDrop: uploadDroppedSampleFiles,
        onImageSelect: openImageLibrary,
        onPortDoubleClick: insertNodeOnPort,
        onPortSelect: (nodeId: string, side: 'input' | 'output', port: string) => {
          setSelectedBoundaryPort({ nodeId, side, port });
        },
        onPortNameChange: updateBoundaryPortName,
        onPortMove: updateBoundaryPortOrder,
        onCompactToggle: updateNodeCompactPorts,
        onScopeResize: updateNodeScopeSize,
        onSelectorInputAdd: addSelectorInput,
        onSelectorInputClear: clearSelectorInput,
        selectedLinkPorts: selectedLinkPortsByNode.get(node.id),
        ...(node.data.patchNode.type === 'AudioInput' ? { audioInput: audio.audioInput } : {}),
        ...(node.data.patchNode.type === 'MidiNote'
          || node.data.patchNode.type === 'MidiCc'
          || node.data.patchNode.type === 'Slider'
          || node.data.patchNode.type === 'Button'
          || node.data.patchNode.type === 'Tempo'
          ? { midiInput: audio.midiInput }
          : {}),
        connectedPorts: connectedPortsByNode.get(node.id),
        canvasZoom: settledGraphZoom,
        previewPort: pendingBoundaryPort && pendingBoundaryPort.nodeId === node.id
          ? { side: pendingBoundaryPort.side, name: pendingBoundaryPort.port }
          : null,
        selectedPort: selectedBoundaryPort && selectedBoundaryPort.nodeId === node.id
          ? { side: selectedBoundaryPort.side, name: selectedBoundaryPort.port }
          : null,
        isOnlySelected: node.selected === true && selectedNodeCount === 1,
        isConnecting: draftNodeConnection !== null,
        isTypePickerOpen: editingTypeNodeId === node.id,
        isEditingSubpatch: editingStack.length > 0,
      },
    };
  }), [
    connectedPortsByNode,
    draftNodeConnection,
    editingStack.length,
    editingTypeNodeId,
    insertNodeOnPort,
    nodes,
    pendingBoundaryPort,
    openSampleLibrary,
    uploadDroppedSampleFiles,
    openImageLibrary,
    nodeStackRanks,
    selectedAreaNodeIds,
    selectedBoundaryPort,
    selectedLinkPortsByNode,
    settledGraphZoom,
    updateBoundaryPortName,
    updateBoundaryPortOrder,
    updateExpression,
    updateGroupSubpatchName,
    addSelectorInput,
    clearSelectorInput,
    cancelProvisionalNode,
    convertNodeToArea,
    audio.audioInput,
    audio.midiInput,
    audio.refreshAudioInputDevices,
    audio.refreshMidiInputDevices,
    audio.setAudioInputDeviceId,
    updateNodeCompactPorts,
    updateNodeCustomWave,
    updateNodeScopeSize,
    updateNodeId,
    updateNodeParam,
    updateNodeParams,
    updateNodeCustomLabel,
    updateNodeType,
    selectedNodeCount,
  ]);

  const edgesWithCallbacks = useMemo(() => {
    const selectedEdgeCount = edges.filter((edge) => edge.selected).length;
    return edges.map((edge) => ({
      ...edge,
      reconnectable: edge.selected === true,
      zIndex: edge.selected ? SELECTED_EDGE_Z_INDEX : undefined,
      data: {
        ...edge.data,
        weight: edge.data?.weight ?? 1,
        mode: edge.data?.mode ?? 'set',
        enabled: edge.data?.enabled !== false,
        onWeightChange: updateEdgeWeight,
        onModeChange: updateEdgeMode,
        onEnabledChange: updateEdgeEnabled,
        onInsertNode: insertNodeOnEdge,
        showLinkControls: edge.selected === true && selectedEdgeCount === 1,
      },
    }));
  }, [edges, insertNodeOnEdge, updateEdgeEnabled, updateEdgeMode, updateEdgeWeight]);

  const materializedGraph = useMemo(
    () => materializeRootGraph(nodesWithCallbacks, edgesWithCallbacks, editingStack, patchName),
    [edgesWithCallbacks, editingStack, nodesWithCallbacks, patchName],
  );
  const isEditingSubpatch = editingStack.length > 0;
  const canGroupSelection = useMemo(() => (
    nodes.some((node) => node.selected) &&
    nodes.filter((node) => node.selected).every((node) => node.data.patchNode.type !== null)
  ), [nodes]);
  const canScaleSelection = selectedNodeCount > 0;
  const patch = useMemo(() => ({
    ...patchFromFlow(materializedGraph.nodes, materializedGraph.edges),
    name: rootPatchName,
    ...(selectedMidiInputDeviceIds.length > 0
      ? { midiInput: { selectedDeviceIds: selectedMidiInputDeviceIds } }
      : {}),
  }), [materializedGraph, rootPatchName, selectedMidiInputDeviceIds]);
  const patchJson = useMemo(() => patchToJson(patch), [patch]);
  const trimmedRootPatchName = rootPatchName.trim();
  const selectedLocalPatch = localPatchLibrary?.patches.find((entry) => entry.name === localPatchLibrary.selectedPatchName) ?? null;
  const selectedSample = sampleLibrary?.samples.find((sample) => sample.url === sampleLibrary.selectedUrl) ?? null;
  const selectedImage = imageLibrary?.images.find((image) => image.url === imageLibrary.selectedUrl) ?? null;
  const selectedSubpatchCandidate = subpatchImportModal?.candidates.find((candidate) => candidate.key === subpatchImportModal.selectedKey) ?? null;
  const selectedLocalSubpatch = localSubpatchImport?.subpatches.find((entry) => entry.name === localSubpatchImport.selectedSubpatchName) ?? null;
  const dspPatch = useMemo(() => stripPatchForDsp(patch), [patch]);
  const liveDspPatch = useMemo(() => patchWithMidiControlVisuals(dspPatch, midiControlVisuals), [dspPatch, midiControlVisuals]);
  const dspPatchKey = useMemo(() => patchToDspKey(liveDspPatch), [liveDspPatch]);
  const audioGraph = useMemo(() => compilePatchToDspProgram(liveDspPatch), [dspPatchKey, liveDspPatch]);
  const dspDiagnostics = useMemo(() => classifyDspErrors(audioGraph.errors, dspPatch), [audioGraph.errors, dspPatch]);
  const monitorLinkIdByNode = useMemo(() => {
    const linkIdsByNode = new Map<string, string>();
    for (const nodeId of Object.keys(audioGraph.monitorIds)) {
      linkIdsByNode.set(nodeId, nodeId);
    }
    return linkIdsByNode;
  }, [audioGraph]);
  const activeDspGroupIds = useMemo(() => editingStack.map((frame) => frame.groupId), [editingStack]);

  const renderedNodes = useMemo(() => nodesWithCallbacks.map((node) => {
    const dspNodeId = scopedDspNodeId(node.id, activeDspGroupIds);
    const monitorLinkId = monitorLinkIdByNode.get(dspNodeId);
    const audioOutputLeft = audio.linkMeters[`${dspNodeId}:left`]?.output ?? 0;
    const audioOutputRight = audio.linkMeters[`${dspNodeId}:right`]?.output ?? 0;
    const dspErrors = dspDiagnostics.nodeErrors.get(dspNodeId) ?? [];
    const hasAudioMonitor = Boolean(monitorLinkId);
    const hasAudioOutputMeter = node.data.patchNode.type === 'AudioOut';
    const midiControlVisual = midiControlVisuals[node.id];
    const audioSelectorIndex = node.data.patchNode.type === 'Selector'
      ? audio.linkMeters[`${dspNodeId}:selector`]?.output
      : undefined;
    const audioAccumulatorValue = node.data.patchNode.type === 'Accumulator'
      ? audio.linkMeters[`${dspNodeId}:accumulator`]?.output
      : undefined;
    const audioImageX = node.data.patchNode.type === 'Image'
      ? audio.linkMeters[`${dspNodeId}:image-x`]?.output
      : undefined;
    const audioImageY = node.data.patchNode.type === 'Image'
      ? audio.linkMeters[`${dspNodeId}:image-y`]?.output
      : undefined;
    const audioImagePosition = typeof audioImageX === 'number' && typeof audioImageY === 'number'
      ? { x: audioImageX, y: audioImageY }
      : undefined;
    const showsPlaybackVisual = node.data.patchNode.type === 'CustomWave' || node.data.patchNode.type === 'SamplePlayer';
    const audioPlayheads = showsPlaybackVisual ? audio.playheads[dspNodeId] : undefined;
    const audioSampleParams = node.data.patchNode.type === 'SamplePlayer'
      ? samplePlayerVisualizationParams(dspNodeId, audio.linkMeters)
      : undefined;
    if (!hasAudioMonitor && !hasAudioOutputMeter && audioSelectorIndex === undefined && audioAccumulatorValue === undefined && !audioImagePosition && !midiControlVisual && dspErrors.length === 0 && !showsPlaybackVisual) return node;

    return {
      ...node,
      data: {
        ...node.data,
        ...(dspErrors.length > 0 ? { dspErrors } : {}),
        ...(hasAudioOutputMeter ? { audioOutputMeter: { left: audioOutputLeft, right: audioOutputRight } } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Meter' ? { audioMeter: audio.linkMeters[monitorLinkId] } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Scope' ? { audioScope: audio.linkScopes[dspNodeId] } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'FFT' ? { audioSpectrum: audio.linkScopes[dspNodeId] } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Slider' ? { audioSliderValue: audio.linkMeters[monitorLinkId]?.output } : {}),
        ...(audioSelectorIndex !== undefined ? { audioSelectorIndex } : {}),
        ...(audioAccumulatorValue !== undefined ? { audioAccumulatorValue } : {}),
        ...(audioImagePosition ? { audioImagePosition } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Sequencer' ? { audioSequencerStep: audio.linkMeters[monitorLinkId]?.output } : {}),
        ...(audioPlayheads !== undefined ? { audioPlayheads } : {}),
        ...(audioSampleParams ? { audioSampleParams } : {}),
        ...(midiControlVisual?.sliderValue !== undefined ? { midiSliderValue: midiControlVisual.sliderValue } : {}),
        ...(midiControlVisual?.buttonPressed !== undefined ? { midiButtonPressed: midiControlVisual.buttonPressed } : {}),
      },
    };
  }), [activeDspGroupIds, audio.linkMeters, audio.linkScopes, audio.playheads, dspDiagnostics, midiControlVisuals, monitorLinkIdByNode, nodesWithCallbacks]);

  const renderedEdges = useMemo(() => edgesWithCallbacks.map((edge) => {
    const dspErrors = dspDiagnostics.edgeErrors.get(edge.id) ?? [];
    if (dspErrors.length === 0) return edge;

    return {
      ...edge,
      data: {
        ...edge.data,
        dspErrors,
      },
    };
  }), [dspDiagnostics, edgesWithCallbacks]);

  const collapsedAreaByNode = useMemo(() => {
    const collapsedAreas = areas.filter((area) => area.collapsed);
    return new Map(renderedNodes.flatMap((node) => {
      const area = collapsedAreaContainingNode(collapsedAreas, node);
      return area ? [[node.id, area] as const] : [];
    }));
  }, [areas, renderedNodes]);

  const collapsedUiAreaByNode = useMemo(() => new Map(renderedNodes.flatMap((node) => {
    const area = collapsedAreaByNode.get(node.id);
    return area && (
      nodeIsInAreaUiSection(area, node)
      || (area.kind === 'spread' && area.spreadNodeId === node.id)
    ) ? [[node.id, area] as const] : [];
  })), [collapsedAreaByNode, renderedNodes]);

  const collapsedRenderedNodes = useMemo(() => renderedNodes.map((node) => (
    collapsedAreaByNode.has(node.id) && !collapsedUiAreaByNode.has(node.id) ? {
      ...node,
      selected: false,
      draggable: false,
      selectable: false,
      connectable: false,
      data: { ...node.data, isAreaCollapsedPresentation: true },
    } : collapsedUiAreaByNode.has(node.id) ? {
      ...node,
      selected: false,
      draggable: false,
      selectable: false,
      connectable: node.data.patchNode.type === 'Spread',
      data: { ...node.data, isAreaUiCollapsedPresentation: true },
    } : node
  )), [collapsedAreaByNode, collapsedUiAreaByNode, renderedNodes]);

  const collapsedRenderedEdges = useMemo(() => renderedEdges.flatMap((edge) => {
    const containedSourceArea = collapsedAreaByNode.get(edge.source);
    const containedTargetArea = collapsedAreaByNode.get(edge.target);
    if (
      containedSourceArea?.kind === 'spread'
      && containedSourceArea.spreadNodeId === edge.source
      && containedSourceArea.id === containedTargetArea?.id
    ) {
      return [];
    }
    const sourceArea = containedSourceArea?.kind === 'spread' && containedSourceArea.spreadNodeId === edge.source
      ? undefined
      : containedSourceArea;
    const targetArea = containedTargetArea?.kind === 'spread' && containedTargetArea.spreadNodeId === edge.target
      ? undefined
      : containedTargetArea;

    // Links completely inside one collapsed area have no external presentation.
    if (sourceArea && sourceArea.id === targetArea?.id) return [];

    if (!sourceArea && !targetArea) return [edge];
    return [{
      ...edge,
      reconnectable: false,
      data: {
        ...edge.data,
        isAreaCollapsedPresentation: true,
        showLinkControls: false,
        ...(sourceArea ? { visualSource: collapsedAreaOutputPin(sourceArea) } : {}),
        ...(targetArea ? { visualTarget: collapsedAreaInputPin(targetArea) } : {}),
      },
    }];
  }), [collapsedAreaByNode, renderedEdges]);

  const duplicateDragPreview = useMemo(() => {
    if (!duplicateDrag?.duplicating) return null;

    const idMap = new Map([...duplicateDrag.nodeIds].map((nodeId) => [nodeId, duplicatePreviewNodeId(nodeId)]));
    const previewNodes = renderedNodes
      .filter((node) => duplicateDrag.nodeIds.has(node.id))
      .map((node): ShaderFlowNode => {
        const id = idMap.get(node.id) ?? duplicatePreviewNodeId(node.id);
        const position = duplicateDrag.currentPositions[node.id] ?? node.position;

        return {
          ...node,
          id,
          position,
          draggable: false,
          selectable: false,
          connectable: false,
          deletable: false,
          className: ['shader-node-preview', node.className ?? ''].filter(Boolean).join(' '),
          data: {
            ...node.data,
            patchNode: {
              ...node.data.patchNode,
              id: node.data.patchNode.id,
              params: { ...node.data.patchNode.params },
              position,
            },
            ...nodeCallbacksPlaceholder(),
            isTypePickerOpen: false,
          },
        };
      });

    const previewEdges = renderedEdges.flatMap((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return [];

      const fromSelected = duplicateDrag.nodeIds.has(link.from.node);
      const toSelected = duplicateDrag.nodeIds.has(link.to.node);
      if (!fromSelected && !toSelected) return [];
      if (fromSelected !== toSelected && !duplicateDrag.linkExternal) return [];

      const fromNode = idMap.get(link.from.node) ?? link.from.node;
      const toNode = idMap.get(link.to.node) ?? link.to.node;
      if (fromNode === link.from.node && toNode === link.to.node) return [];

      return [{
        ...edgeFromLink({
          from: { ...link.from, node: fromNode },
          to: { ...link.to, node: toNode },
          weight: link.weight,
          mode: link.mode,
          enabled: link.enabled,
        }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
        selectable: false,
        deletable: false,
        className: 'shader-edge shader-edge-preview',
      }];
    });

    return { nodes: previewNodes, edges: previewEdges };
  }, [duplicateDrag, renderedEdges, renderedNodes]);

  const draftNodePreview = useMemo(() => {
    if (!draftNodeConnection?.modifierActive || !reactFlow) return null;

    const position = draftNodePosition(draftNodeConnection, reactFlow);
    const link = linkForDraftNodeConnection(draftNodeConnection, DRAFT_NODE_PREVIEW_ID);
    if (!link) return null;

    const node: ShaderFlowNode = {
      id: DRAFT_NODE_PREVIEW_ID,
      type: 'shaderNode',
      position,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      className: 'shader-node-preview',
      data: {
        patchNode: {
          id: 'new',
          type: null,
          params: {},
          position,
        },
        ...nodeCallbacksPlaceholder(),
        isTypePickerOpen: false,
      },
    };

    return {
      node,
      edge: {
        ...edgeFromLink(link, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
        id: `preview:${edgeId(link)}`,
        selectable: false,
        deletable: false,
        className: 'shader-edge shader-edge-preview',
      },
    };
  }, [draftNodeConnection, reactFlow]);

  const displayNodes = useMemo(() => [
    ...collapsedRenderedNodes,
    ...(duplicateDragPreview?.nodes ?? []),
    ...(draftNodePreview ? [draftNodePreview.node] : []),
  ], [collapsedRenderedNodes, draftNodePreview, duplicateDragPreview]);

  const displayEdges = useMemo(() => [
    ...collapsedRenderedEdges,
    ...(duplicateDragPreview?.edges ?? []),
    ...(reconnectPreviewEdge ? [reconnectPreviewEdge] : []),
    ...(draftNodePreview ? [draftNodePreview.edge] : []),
  ], [collapsedRenderedEdges, draftNodePreview, duplicateDragPreview, reconnectPreviewEdge]);

  const panTranslateExtent = useMemo(
    () => translateExtentForVisibleContent(renderedNodes, viewport, editorSize),
    [editorSize, renderedNodes, viewport.zoom],
  );

  useEffect(() => {
    audio.syncGraph(audioGraph);
  }, [audio.syncGraph, audioGraph]);

  useEffect(() => {
    if (!reactFlow || !isFiniteCoordinateExtent(panTranslateExtent)) return;

    const clampedViewport = clampViewportToTranslateExtent(viewport, panTranslateExtent, editorSize);
    if (clampedViewport.x === viewport.x && clampedViewport.y === viewport.y && clampedViewport.zoom === viewport.zoom) {
      return;
    }

    setViewport(clampedViewport);
    void reactFlow.setViewport(clampedViewport);
  }, [editorSize, panTranslateExtent, reactFlow, viewport]);

  useEffect(() => {
    const scopeRequests = nodesWithCallbacks.flatMap((node) => {
      const type = node.data.patchNode.type;
      if (type !== 'Scope' && type !== 'FFT') return [];
      const dspNodeId = scopedDspNodeId(node.id, activeDspGroupIds);
      const linkId = monitorLinkIdByNode.get(dspNodeId);
      if (!linkId) return [];
      return type === 'FFT'
        ? [{ id: dspNodeId, length: 0.012, points: 512 }]
        : [{ id: dspNodeId, length: node.data.patchNode.params.length ?? 0.08 }];
    });
    audio.setLinkScopes(scopeRequests);
  }, [activeDspGroupIds, audio.setLinkScopes, monitorLinkIdByNode, nodesWithCallbacks]);

  useEffect(() => {
    const state = flowToEditorState(materializedGraph.nodes, materializedGraph.edges, {
      patchName: rootPatchName,
      viewport,
      ...(selectedMidiInputDeviceIds.length > 0
        ? { midiInput: { selectedDeviceIds: selectedMidiInputDeviceIds } }
        : {}),
    });
    state.areas = areas;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [areas, materializedGraph, rootPatchName, selectedMidiInputDeviceIds, viewport]);

  const onNodesChange = useCallback((changes: NodeChange<ShaderFlowNode>[]) => {
    const duplicateState = duplicateDragRef.current;
    if (duplicateState?.duplicating) {
      updateDuplicateDrag(syncDuplicateDragPositionsFromChanges(duplicateState, changes));
      setNodes((current) => applyNodeChanges(
        anchorDuplicatedNodePositionChanges(changes, duplicateState.originalPositions),
        current,
      ));
      return;
    }

    if (changes.some((change) => change.type === 'position' && change.dragging === false)) {
      commitHistory('node-position');
    }
    if (changes.some((change) => change.type === 'remove')) {
      commitHistory();
    }
    setNodes((current) => restoreNodeSelectionAfterDeselectedDrag(
      applyNodeChanges(changes, current),
      activeNodeDragSelectionRef.current,
    ));
  }, [commitHistory, updateDuplicateDrag]);

  const onEdgesChange = useCallback((changes: EdgeChange<ShaderFlowEdge>[]) => {
    if (changes.some((change) => change.type === 'remove')) {
      commitHistory();
    }
    setEdges((current) => applyEdgeChanges(changes, current));
  }, [commitHistory]);

  const onNodeDragStart = useCallback((
    event: globalThis.MouseEvent | TouchEvent,
    node: ShaderFlowNode,
    dragNodes: ShaderFlowNode[],
  ) => {
    const selectionSnapshot = pendingNodeDragSelectionRef.current;
    const duplicating = isDuplicateModifierPressed(event);
    activeNodeDragSelectionRef.current = !duplicating && selectionSnapshot?.nodeId === node.id && selectionSnapshot.preserveSelection
      ? selectionSnapshot
      : null;
    const relatedNodes = dragNodes.length > 0 ? dragNodes : [node];
    const positions = Object.fromEntries(relatedNodes.map((entry) => [
      entry.id,
      { ...entry.position },
    ]));
    updateDuplicateDrag({
      nodeIds: new Set(relatedNodes.map((entry) => entry.id)),
      originalPositions: positions,
      currentPositions: positions,
      duplicating,
      linkExternal: isCommandModifierPressed(event),
    });
    if (!activeNodeDragSelectionRef.current) return;

    setNodes((current) => restoreNodeSelectionAfterDeselectedDrag(current, activeNodeDragSelectionRef.current));
    setEdges((current) => restoreEdgeSelectionAfterDeselectedDrag(current, activeNodeDragSelectionRef.current));
  }, [updateDuplicateDrag]);

  const onNodeDrag = useCallback((
    _event: globalThis.MouseEvent | TouchEvent,
    _node: ShaderFlowNode,
    dragNodes: ShaderFlowNode[],
  ) => {
    updateDuplicateDrag((current) => syncDuplicateDragPositions(current, dragNodes));
  }, [updateDuplicateDrag]);

  const onNodeDragStop = useCallback((
    _event: globalThis.MouseEvent | TouchEvent,
    _node: ShaderFlowNode,
    dragNodes: ShaderFlowNode[],
  ) => {
    const dragState = duplicateDragRef.current;
    activeNodeDragSelectionRef.current = null;
    pendingNodeDragSelectionRef.current = null;
    updateDuplicateDrag(null);
    if (!dragState?.duplicating) return;

    const restoredNodes = restoreGraphNodePositions(nodesRef.current, dragState.originalPositions);
    nodesRef.current = restoredNodes;

    const duplicatedGraph = duplicateDraggedGraph(
      restoredNodes,
      edgesRef.current,
      dragState,
      dragState.currentPositions,
      updateEdgeWeight,
      updateEdgeMode,
      insertNodeOnEdgePlaceholder,
    );
    if (duplicatedGraph.nodes.length === 0) return;

    commitHistory();
    setNodes((current) => [
      ...restoreGraphNodePositions(current, dragState.originalPositions)
        .map((node) => ({ ...node, selected: false })),
      ...duplicatedGraph.nodes,
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicatedGraph.edges,
    ]));
    setEditingTypeNodeId(null);
  }, [commitHistory, updateDuplicateDrag, updateEdgeMode, updateEdgeWeight]);

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      const dragState = duplicateDragRef.current;
      if (!dragState) return;

      if (event.key === 'Alt') {
        if (event.altKey && !dragState.duplicating) {
          setNodes((current) => restoreGraphNodePositions(current, dragState.originalPositions));
          updateDuplicateDrag({ ...dragState, duplicating: true });
          return;
        }

        if (!event.altKey && dragState.duplicating) {
          commitHistory('node-position');
          setNodes((current) => applyGraphNodePositions(current, dragState.currentPositions));
          updateDuplicateDrag({ ...dragState, duplicating: false });
          return;
        }
      }
      if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Shift') {
        updateDuplicateDrag({ ...dragState, linkExternal: isCommandModifierPressed(event) });
      }
    };

    window.addEventListener('keydown', updateModifier);
    window.addEventListener('keyup', updateModifier);
    return () => {
      window.removeEventListener('keydown', updateModifier);
      window.removeEventListener('keyup', updateModifier);
    };
  }, [commitHistory, updateDuplicateDrag]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === DRAFT_NODE_PREVIEW_ID || connection.target === DRAFT_NODE_PREVIEW_ID) {
      setPendingBoundaryPort(null);
      return;
    }

    const pending = pendingBoundaryPortRef.current;
    if (pending) {
      const isPendingSource = pending.side === 'output'
        && connection.source === pending.nodeId
        && connection.sourceHandle === `out:${pending.port}`;
      const isPendingTarget = pending.side === 'input'
        && connection.target === pending.nodeId
        && connection.targetHandle === `in:${pending.port}`;
      if (isPendingSource || isPendingTarget) {
        materializePendingBoundaryPort(pending);
      }
    }

    const link = linkFromConnection(connection, draftNodeConnectionRef.current?.mode);
    if (!link) {
      setPendingBoundaryPort(null);
      return;
    }
    const spreadSource = nodesRef.current.find((node) => (
      node.id === link.from.node
      && node.data.patchNode.type === 'Spread'
      && link.from.port === 'item index'
    ));
    const targetNode = nodesRef.current.find((node) => node.id === link.to.node);
    if (spreadSource && (!targetNode || !flowNodeIsInsideSpread(spreadSource, targetNode))) {
      setPendingBoundaryPort(null);
      return;
    }

    commitHistory();
    const edge = edgeFromLink(link, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge);
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => dedupeEdges([
      ...current.map((candidate) => ({ ...candidate, selected: false })),
      { ...edge, selected: true },
    ]));
    setPendingBoundaryPort(null);
  }, [commitHistory, insertNodeOnEdge, materializePendingBoundaryPort, updateEdgeMode, updateEdgeWeight]);

  const onConnectStart = useCallback((event: globalThis.MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    if (reconnectingEdgeRef.current) {
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      return;
    }

    const pointer = clientPointFromEvent(event);
    if (!pointer || !params.nodeId || !params.handleId || !params.handleType) {
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      return;
    }

    if (editingStack.length > 0) {
      const insNode = nodesRef.current.find((node) => node.data.patchNode.type === 'Ins');
      const outsNode = nodesRef.current.find((node) => node.data.patchNode.type === 'Outs');
      let nextPending: BoundaryPortSelection | null = null;

      if (params.handleType === 'target' && insNode && params.nodeId !== insNode.id) {
        const usedNames = new Set((insNode.data.patchNode.outputs ?? []).map((port) => port.name));
        nextPending = {
          nodeId: insNode.id,
          side: 'output',
          port: uniquePortName('new_input', usedNames),
        };
      }

      if (params.handleType === 'source' && outsNode && params.nodeId !== outsNode.id) {
        const usedNames = new Set((outsNode.data.patchNode.inputs ?? []).map((port) => port.name));
        nextPending = {
          nodeId: outsNode.id,
          side: 'input',
          port: uniquePortName('new_output', usedNames),
        };
      }

      setPendingBoundaryPort(nextPending);
    } else {
      setPendingBoundaryPort(null);
    }

    updateDraftNodeConnection({
      originNodeId: params.nodeId,
      originHandleId: params.handleId,
      originHandleType: params.handleType,
      pointer,
      modifierActive: isCommandModifierPressed(event),
      mode: 'set',
    });
  }, [editingStack.length, updateDraftNodeConnection]);

  const onConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    if (reconnectingEdgeRef.current) {
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      return;
    }

    let draftConnection = draftNodeConnectionRef.current;
    const pointer = clientPointFromEvent(event);
    if (pointer && draftConnection) {
      draftConnection = {
        ...draftConnection,
        pointer,
        modifierActive: draftConnection.modifierActive || isCommandModifierPressed(event),
      };
    }

    updateDraftNodeConnection(null);
    if (!connectionState.toHandle || connectionState.toHandle.nodeId === DRAFT_NODE_PREVIEW_ID) {
      createDraftNodeFromConnection(draftConnection);
    }
    setPendingBoundaryPort(null);
  }, [createDraftNodeFromConnection, updateDraftNodeConnection]);

  useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      const draft = draftNodeConnectionRef.current;
      if (!draft) return;
      updateDraftNodeConnection({
        ...draft,
        pointer: { x: event.clientX, y: event.clientY },
        modifierActive: isCommandModifierPressed(event),
      });
    };
    const updateModifier = (event: KeyboardEvent) => {
      const draft = draftNodeConnectionRef.current;
      if (!draft) return;
      updateDraftNodeConnection({
        ...draft,
        modifierActive: isCommandModifierPressed(event),
      });
    };

    window.addEventListener('pointermove', updatePointer);
    window.addEventListener('keydown', updateModifier);
    window.addEventListener('keyup', updateModifier);
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.removeEventListener('keydown', updateModifier);
      window.removeEventListener('keyup', updateModifier);
    };
  }, [updateDraftNodeConnection]);

  const onReconnectStart = useCallback((event: ReactMouseEvent, edge?: ShaderFlowEdge) => {
    const duplicateActive = isReconnectDuplicateModifierPressed(event);
    reconnectingEdgeRef.current = true;
    reconnectDuplicateRef.current = duplicateActive;
    reconnectingEdgeSnapshotRef.current = edge ? cloneFlowEdgeSnapshot(edge) : null;
    setReconnectPreviewEdge(duplicateActive && edge ? reconnectPreviewEdgeFromEdge(edge) : null);
    updateDraftNodeConnection(null);
  }, [updateDraftNodeConnection]);

  const onReconnectEnd = useCallback(() => {
    reconnectingEdgeRef.current = false;
    reconnectDuplicateRef.current = false;
    reconnectingEdgeSnapshotRef.current = null;
    setReconnectPreviewEdge(null);
    updateDraftNodeConnection(null);
  }, [updateDraftNodeConnection]);

  useEffect(() => {
    const updateReconnectDuplicateModifier = (event: KeyboardEvent) => {
      if (!reconnectingEdgeRef.current) return;
      const duplicateActive = isReconnectDuplicateModifierPressed(event);
      reconnectDuplicateRef.current = duplicateActive;
      setReconnectPreviewEdge(
        duplicateActive && reconnectingEdgeSnapshotRef.current
          ? reconnectPreviewEdgeFromEdge(reconnectingEdgeSnapshotRef.current)
          : null,
      );
    };

    window.addEventListener('keydown', updateReconnectDuplicateModifier);
    window.addEventListener('keyup', updateReconnectDuplicateModifier);
    return () => {
      window.removeEventListener('keydown', updateReconnectDuplicateModifier);
      window.removeEventListener('keyup', updateReconnectDuplicateModifier);
    };
  }, []);

  const onReconnect = useCallback((oldEdge: ShaderFlowEdge, connection: Connection) => {
    const candidate: ShaderFlowEdge = {
      ...oldEdge,
      source: connection.source ?? '',
      sourceHandle: connection.sourceHandle,
      target: connection.target ?? '',
      targetHandle: connection.targetHandle,
    };
    const link = linkFromEdge(candidate);
    if (!link) return;

    const oldLink = linkFromEdge(oldEdge);
    const weight = oldEdge.data?.weight ?? oldLink?.weight ?? 1;
    const mode = oldEdge.data?.mode ?? oldLink?.mode ?? 'set';
    const enabled = oldEdge.data?.enabled ?? oldLink?.enabled ?? true;
    const nextEdge = {
      ...edgeFromLink({ from: link.from, to: link.to, weight, mode, enabled }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge),
      selected: true,
      reconnectable: true,
    };
    const nextLink = linkFromEdge(nextEdge);
    if (!nextLink) return;
    const nextEdgeId = edgeId(nextLink);
    if (oldEdge.id === nextEdgeId && oldLink && samePatchLink(oldLink, nextLink)) return;

    const shouldDuplicate = reconnectDuplicateRef.current;
    commitHistory();
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => {
      const duplicate = current.find((edge) => {
        if (edge.id === oldEdge.id) return false;
        const existing = linkFromEdge(edge);
        return existing ? samePatchLink(existing, nextLink) : false;
      });

      if (duplicate) {
        return current
          .filter((edge) => shouldDuplicate || edge.id !== oldEdge.id)
          .map((edge) => ({ ...edge, selected: edge.id === duplicate.id }));
      }

      if (shouldDuplicate) {
        return dedupeEdges([
          ...current.map((edge) => ({ ...edge, selected: false })),
          nextEdge,
        ]);
      }

      return dedupeEdges(current.map((edge) => (
        edge.id === oldEdge.id ? nextEdge : { ...edge, selected: false }
      )));
    });
  }, [commitHistory, insertNodeOnEdge, updateEdgeMode, updateEdgeWeight]);

  const addNodeAt = useCallback((event: ReactMouseEvent) => {
    if (!reactFlow) return;
    addDraftNode(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addDraftNode, reactFlow]);

  const showSaveFeedback = useCallback(() => {
    setSaveFeedbackActive(true);
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
    saveFeedbackTimeoutRef.current = window.setTimeout(() => {
      setSaveFeedbackActive(false);
      saveFeedbackTimeoutRef.current = null;
    }, 900);
  }, []);

  const loadPatchJson = useCallback((json: string) => {
    let loadedPatch: Patch;
    try {
      loadedPatch = parsePatchJson(json);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
      return;
    }

    commitHistory();
    const callbacks = nodeCallbacksPlaceholder();
    setEditingStack([]);
    setPendingBoundaryPort(null);
    setNodes(toFlowNodes(loadedPatch, callbacks, null));
    setEdges(toFlowEdges(loadedPatch, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder));
    setPatchName(loadedPatch.name ?? 'single-patch');
    setSelectedMidiInputDeviceIds(normalizeSelectedMidiDeviceIds(loadedPatch.midiInput?.selectedDeviceIds));
    setMidiControlVisuals({});
    setEditingTypeNodeId(null);
    setImportError(null);
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);

  const openLocalPatchLibrary = useCallback(async () => {
    setLocalPatchLibrary({
      patches: [],
      selectedPatchName: null,
      selectedVersionId: null,
      loading: true,
      error: null,
    });

    try {
      const patches = await fetchLocalPatchLibrary();
      const selectedPatch = selectInitialLocalPatch(patches, rootPatchName);
      setLocalPatchLibrary({
        patches,
        selectedPatchName: selectedPatch?.name ?? null,
        selectedVersionId: selectedPatch?.versions[0]?.id ?? null,
        loading: false,
        error: patches.length === 0 ? 'No saved patches found in patches/.' : null,
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalPatchLibrary({
        patches: [],
        selectedPatchName: null,
        selectedVersionId: null,
        loading: false,
        error: message,
      });
      setImportError(message);
    }
  }, [rootPatchName]);

  const closeLocalPatchLibrary = useCallback(() => {
    setLocalPatchLibrary(null);
  }, []);

  const selectLocalPatch = useCallback((patchEntry: LocalPatchEntry) => {
    setLocalPatchLibrary((current) => current ? {
      ...current,
      selectedPatchName: patchEntry.name,
      selectedVersionId: patchEntry.versions[0]?.id ?? null,
    } : current);
  }, []);

  const selectLocalPatchVersion = useCallback((version: LocalPatchVersion) => {
    setLocalPatchLibrary((current) => current ? {
      ...current,
      selectedVersionId: version.id,
    } : current);
  }, []);

  const loadSelectedLocalPatch = useCallback(async () => {
    const selectedPatchName = localPatchLibrary?.selectedPatchName;
    const selectedVersionId = localPatchLibrary?.selectedVersionId;
    if (!selectedPatchName || !selectedVersionId) return;

    try {
      loadPatchJson(await fetchLocalPatchVersion(selectedPatchName, selectedVersionId));
      setLocalPatchLibrary(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalPatchLibrary((current) => current ? { ...current, error: message } : current);
      setImportError(message);
    }
  }, [loadPatchJson, localPatchLibrary]);

  const openLocalSubpatchImport = useCallback(async () => {
    setSubpatchImportModal(null);
    setLocalSubpatchImport({
      subpatches: [],
      selectedSubpatchName: null,
      selectedSourceKey: null,
      loading: true,
      error: null,
    });

    try {
      const patches = await fetchLocalPatchLibrary();
      const subpatches = await buildLocalSubpatchImportEntries(patches);
      const selectedSubpatch = subpatches[0] ?? null;
      setLocalSubpatchImport({
        subpatches,
        selectedSubpatchName: selectedSubpatch?.name ?? null,
        selectedSourceKey: selectedSubpatch?.sources[0]?.key ?? null,
        loading: false,
        error: subpatches.length === 0 ? 'No saved subpatches found in patches/.' : null,
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalSubpatchImport({
        subpatches: [],
        selectedSubpatchName: null,
        selectedSourceKey: null,
        loading: false,
        error: message,
      });
      setImportError(message);
    }
  }, []);

  const closeLocalSubpatchImport = useCallback(() => {
    setLocalSubpatchImport(null);
  }, []);

  const selectLocalSubpatch = useCallback((entry: LocalSubpatchImportEntry) => {
    setLocalSubpatchImport((current) => current ? {
      ...current,
      selectedSubpatchName: entry.name,
      selectedSourceKey: entry.sources[0]?.key ?? null,
    } : current);
  }, []);

  const selectLocalSubpatchSource = useCallback((source: LocalSubpatchImportSource) => {
    setLocalSubpatchImport((current) => current ? {
      ...current,
      selectedSourceKey: source.key,
    } : current);
  }, []);

  const savePatchJson = useCallback(async () => {
    if (localPatchStorageEnabled) {
      if (trimmedRootPatchName.length === 0) {
        setImportError('Enter a patch name before saving locally.');
        return;
      }

      try {
        await saveLocalPatchVersion(trimmedRootPatchName, patchJson);
        setImportError(null);
        showSaveFeedback();
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const blob = new Blob([patchJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizePatchFilename(rootPatchName)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showSaveFeedback();
  }, [localPatchStorageEnabled, patchJson, rootPatchName, showSaveFeedback, trimmedRootPatchName]);

  const requestPatchLoad = useCallback(() => {
    if (localPatchStorageEnabled) {
      void openLocalPatchLibrary();
      return;
    }
    fileInputRef.current?.click();
  }, [localPatchStorageEnabled, openLocalPatchLibrary]);

  const loadPatchFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      loadPatchJson(await file.text());
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }, [loadPatchJson]);

  const importSubpatchCandidate = useCallback((candidate: ImportedSubpatchCandidate) => {
    const existingIds = new Set(nodesRef.current.map((node) => node.id));
    const id = makeNodeId('Group', existingIds);
    const position = flowPositionForNewImport(reactFlow, nodesRef.current);
    const inputDefinitions = boundaryPortDefinitions(candidate.subpatch, 'Ins', 'outputs');
    const outputDefinitions = boundaryPortDefinitions(candidate.subpatch, 'Outs', 'inputs').map((port) => ({
      name: port.name,
      ...(port.connectable === undefined ? {} : { connectable: port.connectable }),
      ...(port.min === undefined ? {} : { min: port.min }),
      ...(port.max === undefined ? {} : { max: port.max }),
      ...(port.integer === undefined ? {} : { integer: port.integer }),
    }));

    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: 'shaderNode',
        position,
        selected: true,
        data: {
          patchNode: {
            id,
            type: 'Group',
            subpatchName: candidate.name,
            subpatchCloneId: makeSubpatchCloneId(id),
            params: Object.fromEntries(inputDefinitions.map((port) => [port.name, port.defaultValue ?? 0])),
            position,
            inputs: inputDefinitions,
            outputs: outputDefinitions,
            subpatch: clonePatch(candidate.subpatch),
          },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: false,
        },
      },
    ]);
    setSubpatchImportModal(null);
    setLocalSubpatchImport(null);
    setImportError(null);
  }, [commitHistory, reactFlow]);

  const importSelectedLocalSubpatch = useCallback(() => {
    const selectedSourceKey = localSubpatchImport?.selectedSourceKey;
    const source = localSubpatchImport?.subpatches
      .flatMap((entry) => entry.sources)
      .find((entry) => entry.key === selectedSourceKey);
    if (!source) return;

    importSubpatchCandidate(source.candidate);
  }, [importSubpatchCandidate, localSubpatchImport]);

  const requestSubpatchImport = useCallback(() => {
    if (!localPatchStorageEnabled) {
      importFileInputRef.current?.click();
      return;
    }

    void openLocalSubpatchImport();
  }, [localPatchStorageEnabled, openLocalSubpatchImport]);

  const loadSubpatchImportFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      const importedPatch = parsePatchJson(await file.text());
      const candidates = collectSubpatchImportCandidates(importedPatch);
      setLocalSubpatchImport(null);
      setSubpatchImportModal({
        fileName: file.name,
        candidates,
        selectedKey: candidates[0]?.key ?? null,
        error: candidates.length === 0 ? 'No subpatches found in this patch.' : null,
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalSubpatchImport(null);
      setSubpatchImportModal({
        fileName: file.name,
        candidates: [],
        selectedKey: null,
        error: message,
      });
      setImportError(message);
    }
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      const now = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
      restoreGraphSnapshot(previous, setNodes, setEdges, setAreas);
      setSelectedAreaId(null);
      setEditingAreaId(null);
      return {
        past: current.past.slice(0, -1),
        future: [now, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      const now = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
      restoreGraphSnapshot(next, setNodes, setEdges, setAreas);
      setSelectedAreaId(null);
      setEditingAreaId(null);
      return {
        past: [...current.past, now].slice(-HISTORY_LIMIT),
        future: current.future.slice(1),
      };
    });
  }, []);

  const newPatch = useCallback(() => {
    commitHistory();
    const callbacks = nodeCallbacksPlaceholder();
    setEditingStack([]);
    setPendingBoundaryPort(null);
    setSelectedBoundaryPort(null);
    setPatchName('single-patch');
    setSelectedMidiInputDeviceIds([]);
    setMidiControlVisuals({});
    setNodes(toFlowNodes(demoPatch, callbacks, null));
    setEdges(toFlowEdges(demoPatch, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge));
    setAreas([]);
    setSelectedAreaId(null);
    setEditingAreaId(null);
    setEditingTypeNodeId(null);
  }, [commitHistory, insertNodeOnEdge, updateEdgeMode, updateEdgeWeight]);

  useEffect(() => {
    const handleHistoryKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleHistoryKeyDown);
    return () => window.removeEventListener('keydown', handleHistoryKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    if (!selectedBoundaryPort) return;

    const node = nodes.find((entry) => entry.id === selectedBoundaryPort.nodeId);
    if (!node) {
      setSelectedBoundaryPort(null);
      return;
    }

    const ports = selectedBoundaryPort.side === 'input'
      ? node.data.patchNode.inputs ?? []
      : node.data.patchNode.outputs ?? [];
    if (!ports.some((port) => port.name === selectedBoundaryPort.port)) {
      setSelectedBoundaryPort(null);
    }
  }, [nodes, selectedBoundaryPort]);

  useEffect(() => {
    if (!selectedBoundaryPort) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.port-name-label')) return;
      setSelectedBoundaryPort(null);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [selectedBoundaryPort]);

  useEffect(() => {
    const handleSelectedEdgeModeKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;

      const modeByKey: Record<string, LinkMode> = {
        a: 'add',
        s: 'set',
        m: 'multiply',
      };
      const mode = modeByKey[event.key.toLowerCase()];
      if (!mode) return;

      if (draftNodeConnectionRef.current) {
        updateDraftNodeConnection((current) => current ? { ...current, mode } : null);
      } else if (!setSelectedEdgesMode(mode)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleSelectedEdgeModeKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleSelectedEdgeModeKeyDown, { capture: true });
  }, [setSelectedEdgesMode, updateDraftNodeConnection]);

  useEffect(() => {
    const handleToggleSelectedEdgesKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target) || event.key.toLowerCase() !== 'x') return;
      if (!toggleSelectedEdges()) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleToggleSelectedEdgesKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleToggleSelectedEdgesKeyDown, { capture: true });
  }, [toggleSelectedEdges]);

  useEffect(() => {
    const handleBoundaryPortDeleteKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!deleteSelectedBoundaryPort()) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleBoundaryPortDeleteKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleBoundaryPortDeleteKeyDown, { capture: true });
  }, [deleteSelectedBoundaryPort]);

  useEffect(() => {
    const handleBridgeDeleteKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (!deleteSelectedNodesWithBridge()) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleBridgeDeleteKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleBridgeDeleteKeyDown, { capture: true });
  }, [deleteSelectedNodesWithBridge]);

  useEffect(() => {
    const handleClipboardKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier || event.shiftKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === 'c' && copySelectedNodes()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (key === 'v') {
        event.preventDefault();
        event.stopPropagation();
        void pasteCopiedNodes();
      }
    };

    window.addEventListener('keydown', handleClipboardKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleClipboardKeyDown, { capture: true });
  }, [copySelectedNodes, pasteCopiedNodes]);

  useEffect(() => {
    const handleSelectorIndexKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;

      const index = selectorIndexFromKeyboardEvent(event);
      if (index === null) return;

      const selectedSelectors = nodesRef.current.filter((node) => (
        node.selected === true && node.data.patchNode.type === 'Selector'
      ));
      if (selectedSelectors.length !== 1) return;

      const selector = selectedSelectors[0];
      const definition = getNodeDefinition(selector.data.patchNode as PatchNode);
      const port = String(index);
      if (!definition.inputs.some((input) => input.name === port)) return;

      event.preventDefault();
      event.stopPropagation();
      updateNodeParam(selector.id, 'select', index);
    };

    window.addEventListener('keydown', handleSelectorIndexKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleSelectorIndexKeyDown, { capture: true });
  }, [updateNodeParam]);

  useEffect(() => () => {
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
  }, []);

  const promoteNodeFromTarget = useCallback((eventTarget: EventTarget | null) => {
    const target = eventTarget instanceof Element ? eventTarget : null;
    const nodeElement = target?.closest<HTMLElement>('.react-flow__node[data-id]');
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId) return;

    setNodeStackOrder((current) => {
      const currentNodeIds = new Set(nodesRef.current.map((node) => node.id));
      const activeOrder = current.filter((entry) => entry !== nodeId && currentNodeIds.has(entry));
      if (activeOrder.length === current.length - 1 && current.at(-1) === nodeId) return current;
      return [...activeOrder, nodeId];
    });
  }, []);

  const promoteAreaFromTarget = useCallback((eventTarget: EventTarget | null) => {
    const target = eventTarget instanceof Element ? eventTarget : null;
    const areaId = target?.closest<HTMLElement>('.canvas-area[data-area-id]')?.dataset.areaId;
    if (!areaId) return;

    const containedNodeIds = nodeIdsContainedByAreaHierarchy(
      areasRef.current,
      nodesRef.current,
      areaId,
    );
    setSelectedAreaId(areaId);
    setNodeStackOrder((current) => promoteNodeIdsInStackOrder(
      current,
      nodesRef.current.map((node) => node.id),
      containedNodeIds,
    ));
  }, []);

  const handleEditorFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    promoteNodeFromTarget(event.target);
    promoteAreaFromTarget(event.target);
  }, [promoteAreaFromTarget, promoteNodeFromTarget]);

  const handleEditorPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!event.nativeEvent.isTrusted && ignoreSyntheticSelectionPointerDownRef.current) {
      ignoreSyntheticSelectionPointerDownRef.current = false;
      return;
    }
    promoteNodeFromTarget(event.target);
    promoteAreaFromTarget(event.target);
    const target = event.target instanceof Element ? event.target : null;
    const nodeElement = target?.closest<HTMLElement>('.react-flow__node[data-id]');
    const nodeId = nodeElement?.dataset.id;

    if (event.button !== 0) {
      pendingNodeDragSelectionRef.current = null;
      selectionDragStartRef.current = null;
      return;
    }

    if (!target?.closest('.canvas-area')) setSelectedAreaId(null);

    const isCanvasPointerDown = target?.classList.contains('react-flow__pane') === true;
    canvasDragActiveRef.current = isCanvasPointerDown;
    canvasDragPointerRef.current = isCanvasPointerDown ? { x: event.clientX, y: event.clientY } : null;
    canvasDragPointerIdRef.current = isCanvasPointerDown ? event.pointerId : null;

    // Cmd/Ctrl-drag reserves the canvas gesture for a visual area rather than
    // React Flow's normal selection rectangle.
    if ((event.metaKey || event.ctrlKey) && isCanvasPointerDown) {
      event.preventDefault();
      event.stopPropagation();
      const draw = { start: { x: event.clientX, y: event.clientY }, current: { x: event.clientX, y: event.clientY } };
      areaDrawRef.current = draw;
      setAreaDraw(draw);
      selectionDragStartRef.current = null;
      return;
    }

    if (isCanvasPointerDown) {
      selectionDragStartRef.current = { x: event.clientX, y: event.clientY };
    } else {
      selectionDragStartRef.current = null;
    }
    if (!nodeId) {
      pendingNodeDragSelectionRef.current = null;
      return;
    }

    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node) {
      pendingNodeDragSelectionRef.current = null;
      return;
    }

    pendingNodeDragSelectionRef.current = {
      nodeId,
      preserveSelection: node.selected !== true,
      nodeSelection: selectionById(nodesRef.current),
      edgeSelection: selectionById(edgesRef.current),
    };
  }, [promoteAreaFromTarget, promoteNodeFromTarget]);

  const screenToFlow = useCallback((point: ScreenPoint) => {
    const rect = editorShellRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (point.x - rect.left - viewport.x) / viewport.zoom, y: (point.y - rect.top - viewport.y) / viewport.zoom };
  }, [viewport]);

  const endNativeSelection = useCallback(() => {
    const pane = editorShellRef.current?.querySelector<HTMLElement>('.react-flow__pane');
    const point = canvasDragPointerRef.current;
    const pointerId = canvasDragPointerIdRef.current;
    if (!pane || !point || pointerId === null) return;
    ignoreSyntheticSelectionPointerUpRef.current = true;
    pane.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      isPrimary: true,
    }));
  }, []);

  const startNativeSelection = useCallback((start: ScreenPoint) => {
    const pane = editorShellRef.current?.querySelector<HTMLElement>('.react-flow__pane');
    const pointerId = canvasDragPointerIdRef.current;
    if (!pane || pointerId === null) return;
    ignoreSyntheticSelectionPointerDownRef.current = true;
    pane.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
      pointerId,
      isPrimary: true,
    }));
  }, []);

  const updateAreaDraw = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = areaDrawRef.current;
    if (!current) return false;
    // Releasing Cmd/Ctrl during the gesture returns to the ordinary selection
    // rectangle, retaining the original pointer-down point.
    if (!event.metaKey && !event.ctrlKey) {
      areaDrawRef.current = null;
      selectionDragStartRef.current = current.start;
      setAreaDraw(null);
      startNativeSelection(current.start);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = { ...current, current: { x: event.clientX, y: event.clientY } };
    areaDrawRef.current = next;
    setAreaDraw(next);
    return true;
  }, [startNativeSelection]);

  const finishAreaDraw = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const draw = areaDrawRef.current;
    if (!draw) return false;
    event.preventDefault();
    event.stopPropagation();
    const end = { x: event.clientX, y: event.clientY };
    const start = screenToFlow(draw.start);
    const finish = screenToFlow(end);
    const width = Math.abs(finish.x - start.x);
    const height = Math.abs(finish.y - start.y);
    if (width >= 24 && height >= 24) {
      commitHistory();
      const id = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const newArea: EditorArea = {
        id,
        title: 'Area',
        position: { x: Math.min(start.x, finish.x), y: Math.min(start.y, finish.y) },
        size: { width, height },
      };
      const nextAreas = [...areasRef.current, newArea];
      const containedNodeIds = nodeIdsContainedByAreaHierarchy(nextAreas, nodesRef.current, id);
      setAreas((current) => [...current, newArea]);
      setSelectedAreaId(id);
      setNodeStackOrder((current) => promoteNodeIdsInStackOrder(
        current,
        nodesRef.current.map((node) => node.id),
        containedNodeIds,
      ));
    }
    areaDrawRef.current = null;
    setAreaDraw(null);
    return true;
  }, [commitHistory, screenToFlow]);

  const startAreaDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, area: EditorArea) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    const movedAreaIds = connectedAreaIds(areas, area.id);
    const movedAreas = areas.filter((candidate) => movedAreaIds.has(candidate.id));
    const areaPositions = Object.fromEntries(movedAreas.map((candidate) => [candidate.id, { ...candidate.position }]));
    const nodePositions = Object.fromEntries(nodesRef.current
      .filter((node) => movedAreas.some((candidate) => (
        areaContainsNode(candidate, node) || candidate.spreadNodeId === node.id
      )))
      .map((node) => [node.id, { ...node.position }]));
    areaDragRef.current = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      areaPositions,
      nodePositions,
      historyCommitted: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [areas]);

  const dragArea = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = areaDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const delta = { x: (event.clientX - drag.start.x) / viewport.zoom, y: (event.clientY - drag.start.y) / viewport.zoom };
    if (!drag.historyCommitted && (delta.x !== 0 || delta.y !== 0)) {
      commitHistory();
      drag.historyCommitted = true;
    }
    setAreas((current) => current.map((area) => {
      const original = drag.areaPositions[area.id];
      return original ? { ...area, position: { x: original.x + delta.x, y: original.y + delta.y } } : area;
    }));
    setNodes((current) => current.map((node) => {
      const original = drag.nodePositions[node.id];
      return original ? { ...node, position: { x: original.x + delta.x, y: original.y + delta.y } } : node;
    }));
  }, [commitHistory, viewport.zoom]);

  const stopAreaDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!areaDragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    areaDragRef.current = null;
  }, []);

  const startAreaResize = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    area: EditorArea,
    corner: AreaResizeState['corner'],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    areaResizeRef.current = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      corner,
      originalPosition: area.position,
      originalSize: area.size,
      historyCommitted: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const resizeArea = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = areaResizeRef.current;
    if (!resize) return;
    event.preventDefault();
    const delta = { x: (event.clientX - resize.start.x) / viewport.zoom, y: (event.clientY - resize.start.y) / viewport.zoom };
    if (!resize.historyCommitted && (delta.x !== 0 || delta.y !== 0)) {
      commitHistory();
      resize.historyCommitted = true;
    }
    const resizedArea = areasRef.current.find((area) => area.id === resize.areaId);
    const containedBounds = resizedArea?.locked
      ? lockedAreaNodeBounds(resizedArea, nodesRef.current)
      : null;
    const minimumWidth = Math.max(
      resizedArea?.kind === 'spread' ? 240 : 48,
      containedBounds?.width ?? 0,
    );
    const minimumHeight = Math.max(
      resizedArea?.kind === 'spread' ? NODE_HEADER_HEIGHT + SPREAD_PORTS_HEIGHT + 48 : 48,
      containedBounds?.height ?? 0,
    );
    const originalRight = resize.originalPosition.x + resize.originalSize.width;
    const originalBottom = resize.originalPosition.y + resize.originalSize.height;
    const resizingLeft = resize.corner.includes('left');
    const resizingTop = resize.corner.includes('top');
    const left = resizingLeft
      ? Math.min(
        resize.originalPosition.x + delta.x,
        originalRight - minimumWidth,
        containedBounds?.x ?? Number.POSITIVE_INFINITY,
      )
      : resize.originalPosition.x;
    const right = resizingLeft
      ? originalRight
      : Math.max(
        originalRight + delta.x,
        resize.originalPosition.x + minimumWidth,
        containedBounds ? containedBounds.x + containedBounds.width : Number.NEGATIVE_INFINITY,
      );
    const top = resizingTop
      ? Math.min(
        resize.originalPosition.y + delta.y,
        originalBottom - minimumHeight,
        containedBounds?.y ?? Number.POSITIVE_INFINITY,
      )
      : resize.originalPosition.y;
    const bottom = resizingTop
      ? originalBottom
      : Math.max(
        originalBottom + delta.y,
        resize.originalPosition.y + minimumHeight,
        containedBounds ? containedBounds.y + containedBounds.height : Number.NEGATIVE_INFINITY,
      );
    const width = right - left;
    const height = bottom - top;
    const position = {
      x: left,
      y: top,
    };
    setAreas((current) => current.map((area) => area.id === resize.areaId ? {
      ...area,
      position,
      size: { width, height },
      ...(area.uiHeight === undefined ? {} : { uiHeight: Math.min(area.uiHeight, Math.max(0, height - NODE_HEADER_HEIGHT)) }),
    } : area));
    if (resizedArea?.spreadNodeId) {
      setNodes((current) => current.map((node) => node.id === resizedArea.spreadNodeId ? {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scopeSize: {
              width,
              height: Math.max(SPREAD_PORTS_HEIGHT, height - NODE_HEADER_HEIGHT),
            },
          },
        },
      } : node));
    }
  }, [commitHistory, viewport.zoom]);

  const stopAreaResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!areaResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    areaResizeRef.current = null;
  }, []);

  const startAreaUiResize = useCallback((event: ReactPointerEvent<HTMLDivElement>, area: EditorArea) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    areaUiResizeRef.current = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      originalUiHeight: area.uiHeight ?? 0,
      historyCommitted: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const resizeAreaUi = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = areaUiResizeRef.current;
    if (!resize) return;
    event.preventDefault();
    const delta = (event.clientY - resize.start.y) / viewport.zoom;
    const nextUiHeight = Math.max(0, resize.originalUiHeight + delta);
    if (!resize.historyCommitted && nextUiHeight !== resize.originalUiHeight) {
      commitHistory();
      resize.historyCommitted = true;
    }
    setAreas((current) => current.map((area) => area.id === resize.areaId ? {
      ...area,
      uiHeight: Math.min(Math.max(0, area.size.height - NODE_HEADER_HEIGHT), nextUiHeight),
    } : area));
  }, [commitHistory, viewport.zoom]);

  const stopAreaUiResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!areaUiResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    areaUiResizeRef.current = null;
  }, []);

  const renameArea = useCallback((areaId: string, title: string) => {
    commitHistory(`area-title:${areaId}`);
    setAreas((current) => current.map((area) => area.id === areaId ? { ...area, title } : area));
  }, [commitHistory]);

  const finishAreaRename = useCallback((areaId: string) => {
    setAreas((current) => current.map((area) => (
      area.id === areaId && !area.title
        ? { ...area, title: area.kind === 'spread' ? 'Spread' : 'Area' }
        : area
    )));
    setEditingAreaId(null);
  }, []);

  const toggleAreaCollapsed = useCallback((areaId: string) => {
    commitHistory(`area-collapse:${areaId}`);
    setEditingAreaId(null);
    setEditingTypeNodeId(null);
    setAreas((current) => current.map((area) => {
      if (area.id !== areaId) return area;
      if (area.collapsed || area.locked) return { ...area, collapsed: !area.collapsed };
      return {
        ...area,
        collapsed: true,
        locked: true,
        nodeIds: nodesRef.current
          .filter((node) => areaContainsPoint(area, node.position))
          .map((node) => node.id),
      };
    }));
  }, [commitHistory]);

  const toggleAreaLocked = useCallback((areaId: string) => {
    const area = areasRef.current.find((candidate) => candidate.id === areaId);
    if (!area) return;

    commitHistory(`area-lock:${areaId}`);
    setAreas((current) => current.map((candidate) => {
      if (candidate.id !== areaId) return candidate;
      if (candidate.locked) return { ...candidate, locked: false };
      return {
        ...candidate,
        locked: true,
        nodeIds: nodesRef.current
          .filter((node) => areaContainsPoint(candidate, node.position))
          .map((node) => node.id),
      };
    }));
  }, [commitHistory]);

  const areaDrawBounds = useMemo(() => {
    if (!areaDraw) return null;
    const start = screenToFlow(areaDraw.start);
    const end = screenToFlow(areaDraw.current);
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }, [areaDraw, screenToFlow]);

  const clearPendingNodeDragSelection = useCallback(() => {
    if (!activeNodeDragSelectionRef.current) {
      pendingNodeDragSelectionRef.current = null;
    }
  }, []);

  const syncRectangleSelection = useCallback((end: ScreenPoint) => {
    const start = selectionDragStartRef.current;
    const editorShell = editorShellRef.current;
    if (!start || !editorShell) return;

    const selectedNodeIds = selectedNodeIdsInScreenRect(
      editorShell,
      start,
      end,
      new Set(nodesRef.current.map((node) => node.id)),
    );
    const selectedEdgeIds = new Set(edgesRef.current.flatMap((edge) => {
      const link = linkFromEdge(edge);
      return link && (selectedNodeIds.has(link.from.node) || selectedNodeIds.has(link.to.node)) ? [edge.id] : [];
    }));

    setNodes((current) => updateSelection(current, selectedNodeIds));
    setEdges((current) => updateSelection(current, selectedEdgeIds));
  }, []);

  const handleRectangleSelectionMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.buttons !== 1 || !selectionDragStartRef.current) return;
    if (event.metaKey || event.ctrlKey) {
      const draw = { start: selectionDragStartRef.current, current: { x: event.clientX, y: event.clientY } };
      event.preventDefault();
      event.stopPropagation();
      areaDrawRef.current = draw;
      selectionDragStartRef.current = null;
      setAreaDraw(draw);
      endNativeSelection();
      setNodes((current) => updateSelection(current, new Set()));
      setEdges((current) => updateSelection(current, new Set()));
      return;
    }
    syncRectangleSelection({ x: event.clientX, y: event.clientY });
  }, [endNativeSelection, syncRectangleSelection]);

  const validateRectangleSelection = useCallback((event: ReactMouseEvent) => {
    syncRectangleSelection({ x: event.clientX, y: event.clientY });
    selectionDragStartRef.current = null;
  }, [syncRectangleSelection]);

  useEffect(() => {
    const updateModeForModifier = (modifierActive: boolean) => {
      if (!canvasDragActiveRef.current || !canvasDragPointerRef.current) return;

      if (modifierActive && !areaDrawRef.current && selectionDragStartRef.current) {
        const draw = { start: selectionDragStartRef.current, current: canvasDragPointerRef.current };
        areaDrawRef.current = draw;
        selectionDragStartRef.current = null;
        setAreaDraw(draw);
        endNativeSelection();
        setNodes((current) => updateSelection(current, new Set()));
        setEdges((current) => updateSelection(current, new Set()));
        return;
      }

      if (!modifierActive && areaDrawRef.current) {
        const draw = areaDrawRef.current;
        areaDrawRef.current = null;
        selectionDragStartRef.current = draw.start;
        setAreaDraw(null);
        startNativeSelection(draw.start);
        syncRectangleSelection(canvasDragPointerRef.current);
      }
    };

    const handleModifierKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || event.key === 'Control') updateModeForModifier(true);
    };
    const handleModifierKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || event.key === 'Control') updateModeForModifier(false);
    };

    window.addEventListener('keydown', handleModifierKeyDown, { capture: true });
    window.addEventListener('keyup', handleModifierKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleModifierKeyDown, { capture: true });
      window.removeEventListener('keyup', handleModifierKeyUp, { capture: true });
    };
  }, [endNativeSelection, startNativeSelection, syncRectangleSelection]);

  const handleMove = useCallback((event: globalThis.MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    if (event !== null && Math.abs(nextViewport.zoom - zoomInteractionRef.current.lastZoom) > ZOOM_CHANGE_EPSILON) {
      zoomInteractionRef.current.zoomChanged = true;
    }
    zoomInteractionRef.current.lastZoom = nextViewport.zoom;
    setViewport(nextViewport);
  }, []);

  const handleMoveEnd = useCallback((event: globalThis.MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    const zoomChanged = zoomInteractionRef.current.zoomChanged
      || (event !== null && Math.abs(nextViewport.zoom - zoomInteractionRef.current.lastZoom) > ZOOM_CHANGE_EPSILON);
    zoomInteractionRef.current = { zoomChanged: false, lastZoom: nextViewport.zoom };
    setViewport(nextViewport);

    // React Flow reports programmatic viewport changes with a null event. Only
    // settle direct pinch/zoom gestures; otherwise a reset animation can start
    // another zoom transition and interrupt its own absolute 100% target.
    if (event !== null && zoomChanged && shouldSettleZoomToBaseline(nextViewport.zoom)) {
      void reactFlow?.zoomTo(ZOOM_RESET_TARGET, { duration: 120 });
    }
  }, [reactFlow]);

  const resetZoom = useCallback(() => {
    void reactFlow?.zoomTo(ZOOM_RESET_TARGET);
  }, [reactFlow]);

  useEffect(() => {
    const handleResetZoomKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key !== '0' && event.code !== 'Digit0' && event.code !== 'Numpad0') return;

      event.preventDefault();
      event.stopPropagation();
      resetZoom();
    };

    window.addEventListener('keydown', handleResetZoomKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleResetZoomKeyDown, { capture: true });
  }, [resetZoom]);

  useEffect(() => {
    const deleteSelectedArea = (event: KeyboardEvent) => {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || isEditableEventTarget(event.target)) return;
      if (!selectedAreaId) return;
      event.preventDefault();
      event.stopPropagation();
      commitHistory();
      const selectedArea = areasRef.current.find((area) => area.id === selectedAreaId);
      if (selectedArea?.spreadNodeId) {
        setNodes((current) => current.filter((node) => node.id !== selectedArea.spreadNodeId));
        setEdges((current) => current.filter((edge) => (
          edge.source !== selectedArea.spreadNodeId && edge.target !== selectedArea.spreadNodeId
        )));
      }
      setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
      setSelectedAreaId(null);
    };

    window.addEventListener('keydown', deleteSelectedArea, { capture: true });
    return () => window.removeEventListener('keydown', deleteSelectedArea, { capture: true });
  }, [commitHistory, selectedAreaId]);

  return (
    <div className="app-shell app-shell-panel-closed">
      <EdgeOverlayProvider target={edgeOverlayElement}>
        <main
          ref={editorShellRef}
          className={`editor-shell${areaDraw ? ' editor-shell-area-drawing' : ''}`}
          onFocusCapture={handleEditorFocusCapture}
          onPointerDownCapture={handleEditorPointerDownCapture}
          onPointerMove={(event) => {
            if (canvasDragActiveRef.current && event.buttons === 1) {
              canvasDragPointerRef.current = { x: event.clientX, y: event.clientY };
            }
            if (!updateAreaDraw(event)) handleRectangleSelectionMove(event);
          }}
          onPointerUpCapture={(event) => {
            if (!event.nativeEvent.isTrusted && ignoreSyntheticSelectionPointerUpRef.current) {
              ignoreSyntheticSelectionPointerUpRef.current = false;
              return;
            }
            if (!finishAreaDraw(event)) clearPendingNodeDragSelection();
            canvasDragActiveRef.current = false;
            canvasDragPointerRef.current = null;
            canvasDragPointerIdRef.current = null;
          }}
          onPointerCancelCapture={() => {
            clearPendingNodeDragSelection();
            canvasDragActiveRef.current = false;
            canvasDragPointerRef.current = null;
            canvasDragPointerIdRef.current = null;
          }}
          onDoubleClick={(event) => {
            const target = event.target as HTMLElement;
            if (!target.classList.contains('react-flow__pane')) return;

            event.preventDefault();
            event.stopPropagation();
            addNodeAt(event);
          }}
        >
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setReactFlow}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onSelectionEnd={validateRectangleSelection}
            onNodeDoubleClick={(event, node) => {
              if (!enterGroupNode(node)) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onReconnectEnd={onReconnectEnd}
            reconnectRadius={12}
            connectionLineStyle={{
              '--connection-line-color': draftNodePreview
                ? 'transparent'
                : CONNECTION_LINE_COLORS[draftNodeConnection?.mode ?? 'set'],
            } as CSSProperties}
            onEdgeDoubleClick={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              if (edge.data?.isAreaCollapsedPresentation) return;
              insertNodeOnEdge(edge.id);
            }}
            onMove={handleMove}
            onMoveEnd={handleMoveEnd}
            connectionMode={ConnectionMode.Loose}
            panOnScroll
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            selectionOnDrag={!areaDraw}
            selectionMode={SelectionMode.Partial}
            selectionKeyCode={null}
            panActivationKeyCode={null}
            defaultViewport={initialState?.ui?.viewport}
            minZoom={MIN_CANVAS_ZOOM}
            fitView={!initialState?.ui?.viewport}
            fitViewOptions={FIT_VIEW_OPTIONS}
            translateExtent={panTranslateExtent}
            nodeExtent={FLOW_INFINITE_EXTENT}
            deleteKeyCode={DELETE_KEY_CODES}
            multiSelectionKeyCode={MULTI_SELECTION_KEY_CODES}
            snapToGrid={false}
            proOptions={REACT_FLOW_PRO_OPTIONS}
          >
            <ViewportPortal>
              <div
                className="area-layer"
                style={{
                  '--canvas-header-title-scale': String(canvasHeaderTitleScale(settledGraphZoom)),
                } as CSSProperties}
              >
                {areaDrawBounds && (
                  <div
                    className="canvas-area canvas-area-drawing"
                    style={{ left: areaDrawBounds.x, top: areaDrawBounds.y, width: areaDrawBounds.width, height: areaDrawBounds.height }}
                  />
                )}
                {areas.map((area) => (
                  <div
                    key={area.id}
                    data-area-id={area.id}
                    className={`canvas-area${area.kind === 'spread' ? ' canvas-area-spread' : ''}${area.collapsed ? ' canvas-area-collapsed' : ''}${selectedAreaId === area.id ? ' canvas-area-selected' : ''}`}
                    style={{ left: area.position.x, top: area.position.y, width: area.size.width, height: area.collapsed ? NODE_HEADER_HEIGHT + (area.uiHeight ?? 0) : area.size.height }}
                  >
                    <div
                      className="canvas-area-header nodrag nopan"
                      onPointerDown={(event) => startAreaDrag(event, area)}
                      onPointerMove={dragArea}
                      onPointerUp={stopAreaDrag}
                      onPointerCancel={stopAreaDrag}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleAreaCollapsed(area.id);
                      }}
                    >
                      {editingAreaId === area.id ? (
                        <input
                          ref={areaTitleInputRef}
                          className="canvas-area-title-input"
                          value={area.title}
                          aria-label={area.kind === 'spread' ? 'Spread name' : 'Area name'}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            event.currentTarget.select();
                          }}
                          onBlur={() => finishAreaRename(area.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === 'Escape') {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => renameArea(area.id, event.target.value)}
                        />
                      ) : (
                        <button
                          className="canvas-area-title nodrag nopan"
                          type="button"
                          onPointerDown={(event) => {
                            areaTitlePointerStartRef.current = { x: event.clientX, y: event.clientY };
                          }}
                          onPointerCancel={() => {
                            areaTitlePointerStartRef.current = null;
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            const pointerStart = areaTitlePointerStartRef.current;
                            areaTitlePointerStartRef.current = null;
                            const moved = pointerStart
                              ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4
                              : false;
                            if (moved) {
                              event.preventDefault();
                              return;
                            }

                            event.stopPropagation();
                            setSelectedAreaId(area.id);
                            setEditingAreaId(area.id);
                          }}
                        >
                          {area.title}
                        </button>
                      )}
                      {!area.collapsed ? (
                        <button
                          className={`area-lock-toggle nodrag nopan${area.locked ? ' area-lock-toggle-locked' : ''}`}
                          type="button"
                          aria-label={area.locked ? 'Unlock area membership' : 'Lock area membership'}
                          title={area.locked ? 'Unlock area membership' : 'Lock area membership'}
                          aria-pressed={area.locked === true}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleAreaLocked(area.id);
                          }}
                        >
                          <span className="area-lock-icon" aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        className="area-compact-toggle nodrag nopan"
                        type="button"
                        aria-label={area.collapsed ? 'Expand area' : 'Collapse area'}
                        title={area.collapsed ? 'Expand area' : 'Collapse area'}
                        aria-pressed={area.collapsed === true}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleAreaCollapsed(area.id);
                        }}
                      >
                        <span
                          className={`node-compact-icon ${area.collapsed ? 'node-compact-icon-compact' : 'node-compact-icon-expanded'}`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    {!area.collapsed && area.kind !== 'spread' && (
                      <div
                        className="canvas-area-ui-resize-handle nodrag nopan"
                        aria-label="Resize area UI section"
                        title="Drag to create or resize the user-facing section"
                        style={{ top: area.uiHeight && area.uiHeight > 0 ? NODE_HEADER_HEIGHT + area.uiHeight - 4 : 28 }}
                        onPointerDown={(event) => startAreaUiResize(event, area)}
                        onPointerMove={resizeAreaUi}
                        onPointerUp={stopAreaUiResize}
                        onPointerCancel={stopAreaUiResize}
                      />
                    )}
                    {area.uiHeight !== undefined && area.uiHeight > 0 && (
                      <div className="canvas-area-ui-divider" style={{ top: NODE_HEADER_HEIGHT + area.uiHeight }} />
                    )}
                    {!area.collapsed && (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
                      <div
                        key={corner}
                        className={`canvas-area-resize-handle canvas-area-resize-${corner} nodrag nopan`}
                        aria-label={`Resize area from ${corner}`}
                        onPointerDown={(event) => startAreaResize(event, area, corner)}
                        onPointerMove={resizeArea}
                        onPointerUp={stopAreaResize}
                        onPointerCancel={stopAreaResize}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </ViewportPortal>
            <Background color="var(--color-foreground-08)" gap={28} size={1} />
            <Controls showInteractive={false}>
              <ControlButton
                className="react-flow__controls-zoom-percentage"
                type="button"
                onClick={resetZoom}
                aria-label={`Reset zoom to 100% (currently ${formatZoomPercentage(viewport.zoom)})`}
                title={`Reset zoom to 100% (currently ${formatZoomPercentage(viewport.zoom)})`}
              >
                {formatZoomPercentage(viewport.zoom)}
              </ControlButton>
              <div
                className={`react-flow__controls-cpu-meter${audio.status === 'running' ? ' is-running' : ''}`}
                style={{ '--cpu-load': cpuLoad } as CSSProperties}
                role="meter"
                aria-label={audio.status === 'running' ? `CPU usage ${cpuPercentage}%` : 'CPU usage, audio stopped'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={audio.status === 'running' ? cpuPercentage : 0}
                title={audio.status === 'running' ? `Audio CPU: ${cpuPercentage}%` : 'Audio CPU: stopped'}
              >
                <span className="cpu-meter-label">CPU</span>
                <span className="cpu-meter-percentage" aria-hidden="true">{cpuPercentage}%</span>
              </div>
            </Controls>
          </ReactFlow>
          <div ref={setEdgeOverlayElement} className="edge-overlay-layer" />
          <div className="viewport-buttons">
            <input
              className="patch-name-input"
              value={patchName}
              onChange={(event) => setPatchName(event.target.value)}
              aria-label={isEditingSubpatch ? 'Subpatch name' : 'Patch name'}
              title={isEditingSubpatch ? 'Subpatch name' : 'Patch name'}
              placeholder={isEditingSubpatch ? 'subpatch name' : 'patch name'}
              spellCheck={false}
            />
            {isEditingSubpatch ? (
              <button className="viewport-button viewport-button-history" type="button" onClick={exitSubpatch} aria-label="Exit subpatch" title="Exit subpatch">EXIT</button>
            ) : null}
            <button
              className="viewport-button"
              type="button"
              role="switch"
              aria-checked={audioPlaybackActive}
              aria-label={audioPlaybackActive ? 'Stop audio' : 'Play audio'}
              title={audioPlaybackActive ? 'Stop audio' : 'Play audio'}
              onClick={toggleAudioPlayback}
            >
              PL
            </button>
            <button
              className="viewport-button viewport-button-record"
              type="button"
              role="switch"
              aria-checked={audioRecordingActive}
              aria-label={audioRecordingActive ? 'Stop recording' : 'Record audio'}
              title={audio.recording.message}
              onClick={toggleAudioRecording}
            >
              {recordingButtonLabel}
            </button>
            <button
              className="viewport-button"
              type="button"
              role="switch"
              aria-checked={selectedMidiInputDeviceIds.length > 0}
              aria-label="MIDI settings"
              title={audio.midiInput.message}
              onClick={() => setMidiSettingsOpen(true)}
            >
              MD
            </button>
            <button
              className={['viewport-button', saveFeedbackActive ? 'viewport-button-save-confirmed' : ''].filter(Boolean).join(' ')}
              type="button"
              onClick={() => void savePatchJson()}
              aria-label="Save patch"
              title="Save patch"
            >
              SV
            </button>
            <button className="viewport-button" type="button" onClick={requestPatchLoad} aria-label="Load patch" title="Load patch">LD</button>
            <button className="viewport-button" type="button" onClick={undo} disabled={history.past.length === 0}>UN</button>
            <button className="viewport-button" type="button" onClick={redo} disabled={history.future.length === 0}>RE</button>
            {!isEditingSubpatch ? (
              <button className="viewport-button" type="button" onClick={groupSelectedNodes} disabled={!canGroupSelection} aria-label="Group to subpatch" title="Group to subpatch">GR</button>
            ) : null}
            <button className="viewport-button" type="button" onClick={newPatch} aria-label="New patch" title="New patch">NW</button>
            <button className="viewport-button" type="button" onClick={() => void requestSubpatchImport()} aria-label="Import subpatch" title="Import subpatch">IM</button>
            <button className="viewport-button" type="button" onClick={() => scaleSelectedNodes(2)} disabled={!canScaleSelection} aria-label="Increase selected node scale" title="Increase selected node scale">S+</button>
            <button className="viewport-button" type="button" onClick={() => scaleSelectedNodes(0.5)} disabled={!canScaleSelection} aria-label="Decrease selected node scale" title="Decrease selected node scale">S-</button>
          </div>
          <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" onChange={loadPatchFile} />
          <input ref={importFileInputRef} className="file-input" type="file" accept="application/json,.json" onChange={loadSubpatchImportFile} />
          <input ref={sampleFileInputRef} className="file-input" type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.flac,.ogg,.m4a" onChange={uploadSampleFile} />
          <input ref={imageFileInputRef} className="file-input" type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp,.avif,.gif,.jpg,.jpeg,.png,.webp" onChange={uploadImageFile} />
          {importError ? <p className="import-error-floating">{importError}</p> : null}
          {audioGraph.errors.length > 0 ? (
            <section className="dsp-error-panel" aria-live="polite" aria-label="DSP compile errors">
              <div className="dsp-error-panel-heading">
                <span>DSP errors</span>
                <span>{audioGraph.errors.length}</span>
              </div>
              <ul className="dsp-error-list">
                {audioGraph.errors.slice(0, DSP_ERROR_PANEL_LIMIT).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              {audioGraph.errors.length > DSP_ERROR_PANEL_LIMIT ? (
                <p className="dsp-error-more">+{audioGraph.errors.length - DSP_ERROR_PANEL_LIMIT} more</p>
              ) : null}
            </section>
          ) : null}
          {midiSettingsOpen ? (
            <MidiSettingsModal
              state={audio.midiInput}
              selectedDeviceIds={selectedMidiInputDeviceIds}
              onToggleDevice={toggleMidiInputDevice}
              onRefresh={() => void audio.refreshMidiInputDevices()}
              onClose={() => setMidiSettingsOpen(false)}
            />
          ) : null}
          {sampleLibrary ? (
            <div
              className="import-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeSampleLibrary();
              }}
            >
              <section
                className="import-modal sample-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="sample-modal-title"
                onDragOver={handleSampleLibraryDragOver}
                onDrop={handleSampleLibraryDrop}
              >
                <header className="import-modal-header">
                  <div>
                    <h2 id="sample-modal-title">Select sample</h2>
                    <p>samples/</p>
                  </div>
                  <button className="import-modal-close" type="button" onClick={closeSampleLibrary} aria-label="Close sample picker" title="Close">X</button>
                </header>
                {sampleLibrary.loading || sampleLibrary.error ? (
                  <p className={['import-modal-message', sampleLibrary.error ? 'error' : ''].filter(Boolean).join(' ')}>
                    {sampleLibrary.error ?? 'Reading samples...'}
                  </p>
                ) : null}
                {sampleRecording.status === 'naming' || sampleRecording.status === 'saving' ? (
                  <form
                    className="sample-recording-name-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveSampleRecording();
                    }}
                  >
                    <label htmlFor="sample-recording-name">Name this recording</label>
                    <div className="sample-recording-name-row">
                      <input
                        id="sample-recording-name"
                        type="text"
                        value={sampleRecording.name}
                        onChange={(event) => setSampleRecording((current) => ({ ...current, name: event.target.value }))}
                        autoFocus
                        disabled={sampleRecording.status === 'saving'}
                      />
                      <span>{sampleRecording.extension}</span>
                    </div>
                    <footer className="import-modal-actions">
                      <button type="button" onClick={resetSampleRecording} disabled={sampleRecording.status === 'saving'}>Discard</button>
                      <button type="submit" disabled={sampleRecording.status === 'saving' || !sampleRecording.name.trim()}>
                        {sampleRecording.status === 'saving' ? 'Saving...' : 'Save and select'}
                      </button>
                    </footer>
                  </form>
                ) : (
                  <>
                    {sampleRecording.status !== 'idle' ? (
                      <p className="sample-recording-status" aria-live="polite">
                        {sampleRecording.status === 'requesting'
                          ? 'Waiting for microphone permission...'
                          : sampleRecording.status === 'processing'
                            ? 'Finishing recording...'
                            : `Recording ${formatRecordingTimestamp(sampleRecording.elapsedSeconds)}`}
                      </p>
                    ) : null}
                    {sampleLibrary.samples.length > 0 ? (
                      <div className="sample-list" role="listbox" aria-label="Samples">
                        {sampleLibrary.samples.map((sample) => (
                          <button
                            className={[
                              'sample-option',
                              sample.url === sampleLibrary.selectedUrl ? 'sample-option-selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={sample.url}
                            type="button"
                            role="option"
                            aria-selected={sample.url === sampleLibrary.selectedUrl}
                            onClick={() => setSampleLibrary((current) => current ? { ...current, selectedUrl: sample.url } : current)}
                            onDoubleClick={() => selectSampleFromLibrary(sample)}
                          >
                            <span>{sample.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <footer className="import-modal-actions">
                      <button type="button" onClick={closeSampleLibrary}>Cancel</button>
                      <button
                        className="viewport-button-record"
                        type="button"
                        aria-checked={sampleRecording.status !== 'idle'}
                        onClick={sampleRecording.status === 'recording' ? stopSampleRecording : () => void startSampleRecording()}
                        disabled={sampleRecording.status === 'requesting' || sampleRecording.status === 'processing'}
                      >
                        {sampleRecording.status === 'recording' ? 'Stop' : 'Record'}
                      </button>
                      <button type="button" onClick={requestSampleUploadFromLibrary} disabled={sampleRecording.status !== 'idle'}>Upload new</button>
                      <button type="button" onClick={() => selectedSample && selectSampleFromLibrary(selectedSample)} disabled={!selectedSample || sampleRecording.status !== 'idle'}>Select</button>
                    </footer>
                  </>
                )}
              </section>
            </div>
          ) : null}
          {imageLibrary ? (
            <div className="import-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImageLibrary(null); }}>
              <section className="import-modal image-modal" role="dialog" aria-modal="true" aria-labelledby="image-modal-title" onDragOver={handleImageLibraryDragOver} onDrop={handleImageLibraryDrop}>
                <header className="import-modal-header">
                  <div><h2 id="image-modal-title">Select image</h2><p>images/</p></div>
                  <button className="import-modal-close" type="button" onClick={() => setImageLibrary(null)} aria-label="Close image picker" title="Close">X</button>
                </header>
                {imageLibrary.loading || imageLibrary.error ? <p className={['import-modal-message', imageLibrary.error ? 'error' : ''].filter(Boolean).join(' ')}>{imageLibrary.error ?? 'Reading images...'}</p> : null}
                <div className="image-library-browser">
                  {imageLibrary.images.length > 0 ? (
                    <div className="image-list" role="listbox" aria-label="Images">
                      {imageLibrary.images.map((image) => (
                        <button className={['image-option', image.url === imageLibrary.selectedUrl ? 'image-option-selected' : ''].filter(Boolean).join(' ')} key={image.url} type="button" role="option" aria-selected={image.url === imageLibrary.selectedUrl} onClick={() => setImageLibrary((current) => current ? { ...current, selectedUrl: image.url } : current)} onDoubleClick={() => selectImageFromLibrary(image)}>
                          <img src={image.url} alt="" /><span>{image.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="image-modal-preview" aria-label="Selected image preview">
                    {selectedImage ? <img src={selectedImage.url} alt={selectedImage.name} /> : <span>No image selected</span>}
                  </div>
                </div>
                <footer className="import-modal-actions">
                  <button type="button" onClick={() => setImageLibrary(null)}>Cancel</button>
                  <button type="button" onClick={requestImageUploadFromLibrary}>Upload new</button>
                  <button type="button" onClick={() => selectedImage && selectImageFromLibrary(selectedImage)} disabled={!selectedImage}>Select</button>
                </footer>
              </section>
            </div>
          ) : null}
          {localPatchLibrary ? (
            <div
              className="import-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeLocalPatchLibrary();
              }}
            >
              <section className="import-modal local-patch-modal" role="dialog" aria-modal="true" aria-labelledby="local-patch-modal-title">
                <header className="import-modal-header">
                  <div>
                    <h2 id="local-patch-modal-title">Load patch</h2>
                    <p>patches/</p>
                  </div>
                  <button className="import-modal-close" type="button" onClick={closeLocalPatchLibrary} aria-label="Close patch loader" title="Close">X</button>
                </header>
                {localPatchLibrary.loading || localPatchLibrary.error ? (
                  <p className={['import-modal-message', localPatchLibrary.error ? 'error' : ''].filter(Boolean).join(' ')}>
                    {localPatchLibrary.error ?? 'Reading saved patches...'}
                  </p>
                ) : (
                  <div className="local-patch-browser">
                    <section className="local-patch-column" aria-label="Patches">
                      <h3>PATCH</h3>
                      <div className="local-patch-list" role="listbox" aria-label="Patches">
                        {localPatchLibrary.patches.map((patchEntry) => (
                          <button
                            className={[
                              'local-patch-option',
                              patchEntry.name === localPatchLibrary.selectedPatchName ? 'local-patch-option-selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={patchEntry.name}
                            ref={patchEntry.name === localPatchLibrary.selectedPatchName ? selectedLocalPatchOptionRef : null}
                            type="button"
                            role="option"
                            aria-selected={patchEntry.name === localPatchLibrary.selectedPatchName}
                            onClick={() => selectLocalPatch(patchEntry)}
                          >
                            <span>{patchEntry.name}</span>
                            <span>{patchEntry.versionCount}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="local-patch-column" aria-label="Saved versions">
                      <h3>SAVED AT</h3>
                      <div className="local-patch-list" role="listbox" aria-label="Saved versions">
                        {selectedLocalPatch?.versions.map((version) => (
                          <button
                            className={[
                              'local-patch-option',
                              version.id === localPatchLibrary.selectedVersionId ? 'local-patch-option-selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={version.id}
                            type="button"
                            role="option"
                            aria-selected={version.id === localPatchLibrary.selectedVersionId}
                            onClick={() => selectLocalPatchVersion(version)}
                            onDoubleClick={() => void loadSelectedLocalPatch()}
                          >
                            <span>{formatSavedPatchTimestamp(version.savedAt)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
                <footer className="import-modal-actions">
                  <button type="button" onClick={closeLocalPatchLibrary}>Cancel</button>
                  <button type="button" onClick={() => void loadSelectedLocalPatch()} disabled={!localPatchLibrary.selectedPatchName || !localPatchLibrary.selectedVersionId}>Load</button>
                </footer>
              </section>
            </div>
          ) : null}
          {localSubpatchImport ? (
            <div
              className="import-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeLocalSubpatchImport();
              }}
            >
              <section className="import-modal local-patch-modal" role="dialog" aria-modal="true" aria-labelledby="local-subpatch-import-title">
                <header className="import-modal-header">
                  <div>
                    <h2 id="local-subpatch-import-title">Import subpatch</h2>
                    <p>patches/</p>
                  </div>
                  <button className="import-modal-close" type="button" onClick={closeLocalSubpatchImport} aria-label="Close subpatch import" title="Close">X</button>
                </header>
                {localSubpatchImport.loading || localSubpatchImport.error ? (
                  <p className={['import-modal-message', localSubpatchImport.error ? 'error' : ''].filter(Boolean).join(' ')}>
                    {localSubpatchImport.error ?? 'Reading saved subpatches...'}
                  </p>
                ) : (
                  <div className="local-patch-browser">
                    <section className="local-patch-column" aria-label="Subpatches">
                      <h3>SUBPATCH</h3>
                      <div className="local-patch-list" role="listbox" aria-label="Subpatches">
                        {localSubpatchImport.subpatches.map((entry) => (
                          <button
                            className={[
                              'local-patch-option',
                              entry.name === localSubpatchImport.selectedSubpatchName ? 'local-patch-option-selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={entry.name}
                            type="button"
                            role="option"
                            aria-selected={entry.name === localSubpatchImport.selectedSubpatchName}
                            onClick={() => selectLocalSubpatch(entry)}
                          >
                            <span>{entry.name}</span>
                            <span>{entry.sources.length}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="local-patch-column" aria-label="Subpatch versions">
                      <h3>SAVED AT</h3>
                      <div className="local-patch-list" role="listbox" aria-label="Subpatch versions">
                        {selectedLocalSubpatch?.sources.map((source) => (
                          <button
                            className={[
                              'local-patch-option',
                              source.key === localSubpatchImport.selectedSourceKey ? 'local-patch-option-selected' : '',
                            ].filter(Boolean).join(' ')}
                            key={source.key}
                            type="button"
                            role="option"
                            aria-selected={source.key === localSubpatchImport.selectedSourceKey}
                            onClick={() => selectLocalSubpatchSource(source)}
                            onDoubleClick={importSelectedLocalSubpatch}
                          >
                            <span>{formatSavedPatchTimestamp(source.savedAt)}</span>
                            <span>{source.patchName}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
                <footer className="import-modal-actions">
                  <button type="button" onClick={closeLocalSubpatchImport}>Cancel</button>
                  <button type="button" onClick={importSelectedLocalSubpatch} disabled={!localSubpatchImport.selectedSourceKey || localSubpatchImport.subpatches.length === 0}>Import</button>
                </footer>
              </section>
            </div>
          ) : null}
          {subpatchImportModal ? (
            <div
              className="import-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setSubpatchImportModal(null);
              }}
            >
              <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
                <header className="import-modal-header">
                  <div>
                    <h2 id="import-modal-title">Import subpatch</h2>
                    <p>{subpatchImportModal.fileName}</p>
                  </div>
                  <button className="import-modal-close" type="button" onClick={() => setSubpatchImportModal(null)} aria-label="Close subpatch import" title="Close">X</button>
                </header>
                {subpatchImportModal.error ? (
                  <p className="import-modal-message error">{subpatchImportModal.error}</p>
                ) : (
                  <div className="import-subpatch-list" role="listbox" aria-label="Subpatches">
                    {subpatchImportModal.candidates.map((candidate) => (
                      <button
                        className={[
                          'import-subpatch-option',
                          candidate.key === subpatchImportModal.selectedKey ? 'import-subpatch-option-selected' : '',
                        ].filter(Boolean).join(' ')}
                        key={candidate.key}
                        type="button"
                        role="option"
                        aria-selected={candidate.key === subpatchImportModal.selectedKey}
                        onClick={() => setSubpatchImportModal((current) => current ? { ...current, selectedKey: candidate.key } : current)}
                        onDoubleClick={() => importSubpatchCandidate(candidate)}
                      >
                        <span className="import-subpatch-name">{candidate.name}</span>
                        <span className="import-subpatch-path">{candidate.path}</span>
                        <span className="import-subpatch-meta">{candidate.inputCount} in / {candidate.outputCount} out / {candidate.nodeCount} nodes</span>
                      </button>
                    ))}
                  </div>
                )}
                <footer className="import-modal-actions">
                  <button type="button" onClick={() => setSubpatchImportModal(null)}>Cancel</button>
                  <button type="button" onClick={() => selectedSubpatchCandidate && importSubpatchCandidate(selectedSubpatchCandidate)} disabled={!selectedSubpatchCandidate}>Import</button>
                </footer>
              </section>
            </div>
          ) : null}
        </main>
      </EdgeOverlayProvider>
    </div>
  );
}

function canUseLocalPatchStorage(): boolean {
  const viteEnv = (import.meta as ImportMeta & {
    env?: {
      DEV?: boolean;
      VITE_VISUAL_FM_PATCH_STORAGE?: string;
      VITE_VISUAL_VISUAL_PATCH_STORAGE?: string;
    };
  }).env;
  const storageMode = viteEnv?.VITE_VISUAL_VISUAL_PATCH_STORAGE
    ?? viteEnv?.VITE_VISUAL_FM_PATCH_STORAGE;
  if (storageMode === 'browser') return false;
  if (storageMode === 'local') return true;
  return viteEnv?.DEV === true;
}

async function fetchLocalPatchLibrary(): Promise<LocalPatchEntry[]> {
  const response = await fetch('/api/local-patches', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.patches)) {
    throw new Error('Local patch library response was not valid.');
  }

  return payload.patches.flatMap((entry): LocalPatchEntry[] => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.versions)) return [];
    const versions = entry.versions.flatMap((version): LocalPatchVersion[] => (
      isRecord(version) && typeof version.id === 'string' && typeof version.savedAt === 'string'
        ? [{ id: version.id, savedAt: version.savedAt }]
        : []
    ));
    return [{
      name: entry.name,
      versionCount: typeof entry.versionCount === 'number' ? entry.versionCount : versions.length,
      versions,
    }];
  });
}

async function fetchLocalSampleLibrary(): Promise<SampleAsset[]> {
  const response = await fetch('/api/local-samples', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.samples)) {
    throw new Error('Local sample library response was not valid.');
  }

  return payload.samples.flatMap((entry): SampleAsset[] => (
    isRecord(entry) && typeof entry.name === 'string' && typeof entry.url === 'string'
      ? [{ name: entry.name, url: entry.url }]
      : []
  ));
}

async function fetchLocalImageLibrary(): Promise<ImageAsset[]> {
  const response = await fetch('/api/local-images', { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await localPatchStorageError(response));
  const payload = await response.json() as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.images)) throw new Error('Local image library response was not valid.');
  return payload.images.flatMap((entry): ImageAsset[] => (
    isImageAsset(entry) ? [{ name: entry.name, url: entry.url }] : []
  ));
}

function selectInitialLocalPatch(patches: LocalPatchEntry[], currentPatchName: string): LocalPatchEntry | null {
  const trimmedName = currentPatchName.trim();
  if (!trimmedName) return patches[0] ?? null;

  const storageName = sanitizeLocalPatchStorageSegment(trimmedName);
  const normalizedName = trimmedName.toLowerCase();
  const normalizedStorageName = storageName.toLowerCase();

  return patches.find((entry) => (
    entry.name === trimmedName ||
    entry.name === storageName ||
    entry.name.toLowerCase() === normalizedName ||
    entry.name.toLowerCase() === normalizedStorageName
  )) ?? patches[0] ?? null;
}

async function saveLocalPatchVersion(patchName: string, patchJson: string): Promise<void> {
  const response = await fetch('/api/local-patches', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: patchName, patchJson }),
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
}

async function fetchLocalPatchVersion(patchName: string, versionId: string): Promise<string> {
  const params = new URLSearchParams({ patch: patchName, version: versionId });
  const response = await fetch(`/api/local-patches/version?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
  return response.text();
}

async function localPatchStorageError(response: Response): Promise<string> {
  const message = await response.text();
  return message || `Local patch storage failed with HTTP ${response.status}.`;
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function sanitizeLocalPatchStorageSegment(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned || 'untitled-patch';
}

function sanitizePatchFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned || 'untitled-patch';
}

function formatSavedPatchTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatRecordingTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${padDatePart(minutes)}:${padDatePart(seconds)}`;
}

function preferredSampleRecordingFormat(): { mimeType: string; extension: string } {
  const formats = [
    { mimeType: 'audio/webm;codecs=opus', extension: '.webm' },
    { mimeType: 'audio/ogg;codecs=opus', extension: '.ogg' },
    { mimeType: 'audio/mp4', extension: '.m4a' },
    { mimeType: 'audio/webm', extension: '.webm' },
    { mimeType: 'audio/ogg', extension: '.ogg' },
  ];
  return formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType))
    ?? { mimeType: '', extension: '.webm' };
}

function sampleRecordingFileName(name: string, extension: string): string {
  const stem = name.replace(/\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|wav|wave|webm)$/i, '').trim() || 'recording';
  return `${stem}${extension}`;
}

async function convertRecordedAudioToWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(await recording.arrayBuffer());
    return encodeAudioBufferAsWav(audioBuffer);
  } catch (error) {
    throw new Error('Could not convert the microphone recording to WAV.', { cause: error });
  } finally {
    await context.close();
  }
}

function encodeAudioBufferAsWav(audioBuffer: AudioBuffer): Blob {
  const channelCount = audioBuffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = audioBuffer.length * blockAlign;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  writeWavText(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWavText(view, 8, 'WAVE');
  writeWavText(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeWavText(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channel) => audioBuffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([wav], { type: 'audio/wav' });
}

function writeWavText(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

interface MidiSettingsModalProps {
  state: MidiInputState;
  selectedDeviceIds: string[];
  onToggleDevice: (deviceId: string, selected: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function MidiSettingsModal({
  state,
  selectedDeviceIds,
  onToggleDevice,
  onRefresh,
  onClose,
}: MidiSettingsModalProps) {
  const selectedDeviceIdSet = new Set(selectedDeviceIds);
  const knownDeviceIds = new Set(state.devices.map((device) => device.id));
  const missingSelectedDeviceIds = selectedDeviceIds.filter((deviceId) => !knownDeviceIds.has(deviceId));
  const unavailable = state.status === 'unsupported' || state.status === 'denied' || state.status === 'error';
  const refreshLabel = state.status === 'inactive' || state.status === 'needs-permission'
    ? 'Enable'
    : 'Refresh';

  return (
    <div
      className="import-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="import-modal midi-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-settings-modal-title"
      >
        <header className="import-modal-header">
          <div>
            <h2 id="midi-settings-modal-title">MIDI</h2>
            <p>{midiInputModalStatusLabel(state.status)}</p>
          </div>
          <button className="import-modal-close" type="button" onClick={onClose} aria-label="Close MIDI settings" title="Close">X</button>
        </header>

        <p className={['import-modal-message', unavailable ? 'error' : ''].filter(Boolean).join(' ')}>
          {state.message}
        </p>

        <div className="midi-settings-device-list">
          {state.devices.map((device) => (
            <label className="midi-settings-device" key={device.id}>
              <input
                type="checkbox"
                checked={selectedDeviceIdSet.has(device.id)}
                onChange={(event) => onToggleDevice(device.id, event.currentTarget.checked)}
              />
              <span>{device.label}</span>
              <small>{device.state}</small>
            </label>
          ))}
          {missingSelectedDeviceIds.map((deviceId) => (
            <label className="midi-settings-device midi-settings-device-missing" key={deviceId}>
              <input
                type="checkbox"
                checked
                onChange={(event) => onToggleDevice(deviceId, event.currentTarget.checked)}
              />
              <span>{deviceId}</span>
              <small>missing</small>
            </label>
          ))}
        </div>

        <footer className="import-modal-actions">
          <button type="button" onClick={onClose}>Close</button>
          {state.canRequestAccess ? (
            <button type="button" onClick={onRefresh}>{refreshLabel}</button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function midiInputModalStatusLabel(status: MidiInputState['status']): string {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'requesting':
      return 'requesting';
    case 'needs-permission':
      return 'permission';
    case 'denied':
      return 'denied';
    case 'unsupported':
      return 'unavailable';
    case 'error':
      return 'check input';
    case 'inactive':
    default:
      return 'idle';
  }
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function parsePatchJson(json: string): Patch {
  const parsed = JSON.parse(json) as unknown;
  return parsePatchObject(parsed, 'Patch JSON');
}

function parsePatchObject(value: unknown, label: string): Patch {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  if (!Array.isArray(value.nodes)) {
    throw new Error(`${label} must contain a nodes array.`);
  }
  if (!Array.isArray(value.links)) {
    throw new Error(`${label} must contain a links array.`);
  }

  return normalizePatchCompatibility({
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...parseMidiInputPreferences(value.midiInput),
    nodes: value.nodes.flatMap((node, index) => {
      const parsedNode = parsePatchNode(node, index);
      return parsedNode ? [parsedNode] : [];
    }),
    links: value.links.map((link, index) => parsePatchLink(link, index)),
  });
}

function parseMidiInputPreferences(value: unknown): Pick<Patch, 'midiInput'> {
  if (!isRecord(value)) return {};
  const selectedDeviceIds = normalizeSelectedMidiDeviceIds(value.selectedDeviceIds);
  return selectedDeviceIds.length > 0 ? { midiInput: { selectedDeviceIds } } : {};
}

function patchToDspKey(patch: Patch): string {
  return JSON.stringify(patch);
}

function stripPatchForDsp(patch: Patch): Patch {
  return {
    nodes: patch.nodes.map(stripPatchNodeForDsp),
    links: patch.links.map((link) => ({
      from: { ...link.from },
      to: { ...link.to },
      weight: link.weight,
      mode: link.mode,
      ...(link.enabled === false ? { enabled: false } : {}),
    })),
  };
}

function classifyDspErrors(errors: string[], patch: Patch): DspEditorDiagnostics {
  const diagnostics: DspEditorDiagnostics = {
    nodeErrors: new Map(),
    edgeErrors: new Map(),
    globalErrors: [],
  };
  const nodeById = new Set(patch.nodes.map((node) => node.id));
  const nodeIdsByType = new Map<NodeType, string[]>();
  for (const node of patch.nodes) {
    nodeIdsByType.set(node.type, [...(nodeIdsByType.get(node.type) ?? []), node.id]);
  }

  for (const error of errors) {
    let localized = false;

    const explicitNodeId = extractDspErrorNodeId(error);
    if (explicitNodeId && nodeById.has(explicitNodeId)) {
      addDiagnostic(diagnostics.nodeErrors, explicitNodeId, error);
      localized = true;
    }

    const unsupportedType = error.match(/^Node type "([^"]+)"/)?.[1] as NodeType | undefined;
    if (unsupportedType) {
      for (const nodeId of nodeIdsByType.get(unsupportedType) ?? []) {
        addDiagnostic(diagnostics.nodeErrors, nodeId, error);
        localized = true;
      }
    }

    for (const edgeKey of edgeKeysForDspError(error, patch)) {
      addDiagnostic(diagnostics.edgeErrors, edgeKey, error);
      localized = true;
    }

    if (!localized) diagnostics.globalErrors.push(error);
  }

  return diagnostics;
}

function extractDspErrorNodeId(error: string): string | null {
  return error.match(/^(?:Expression node|Audio Out node|Node) "([^"]+)"/)?.[1]
    ?? error.match(/^Link (?:source|target) node "([^"]+)"/)?.[1]
    ?? error.match(/ on node "([^"]+)"/)?.[1]
    ?? null;
}

function edgeKeysForDspError(error: string, patch: Patch): string[] {
  const formattedLink = error.match(/^Link "([^"]+)"/)?.[1];
  if (formattedLink) {
    const key = edgeKeyFromFormattedLink(formattedLink);
    return key ? [key] : [];
  }

  const sourceNode = error.match(/^Link source node "([^"]+)"/)?.[1];
  if (sourceNode) {
    return patch.links
      .filter((link) => link.from.node === sourceNode)
      .map(edgeId);
  }

  const targetNode = error.match(/^Link target node "([^"]+)"/)?.[1];
  if (targetNode) {
    return patch.links
      .filter((link) => link.to.node === targetNode)
      .map(edgeId);
  }

  const unsupportedOutput = error.match(/^Node "([^"]+)" does not have supported output "([^"]+)"/);
  if (unsupportedOutput) {
    const [, nodeId, port] = unsupportedOutput;
    return patch.links
      .filter((link) => link.from.node === nodeId && link.from.port === port)
      .map(edgeId);
  }

  return [];
}

function edgeKeyFromFormattedLink(value: string): string | null {
  const match = value.match(/^(.+):([^:]+) -> (.+):([^:]+)$/);
  if (!match) return null;
  const [, fromNode, fromPort, toNode, toPort] = match;
  return edgeId({
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  });
}

function addDiagnostic(map: Map<string, string[]>, key: string, error: string): void {
  map.set(key, [...(map.get(key) ?? []), error]);
}

function stripPatchNodeForDsp(node: PatchNode): PatchNode {
  return {
    id: node.id,
    type: node.type,
    ...(node.subpatchName ? { subpatchName: node.subpatchName } : {}),
    ...(node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {}),
    ...(node.expression !== undefined ? { expression: node.expression } : {}),
    ...(node.sample ? { sample: { ...node.sample } } : {}),
    ...(node.image ? { image: { ...node.image } } : {}),
    ...(node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {}),
    params: { ...node.params },
    ...(node.position ? { position: { ...node.position } } : {}),
    ...(node.scopeSize ? { scopeSize: { ...node.scopeSize } } : {}),
    ...(node.spreadNodeIds ? { spreadNodeIds: [...node.spreadNodeIds] } : {}),
    ...(node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {}),
    ...(node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {}),
    ...(node.subpatch ? { subpatch: stripPatchForDsp(node.subpatch) } : {}),
  };
}

function parsePatchNode(value: unknown, index: number): PatchNode | null {
  if (!isRecord(value)) {
    throw new Error(`Node ${index} must be an object.`);
  }
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new Error(`Node ${index} needs a string id.`);
  }
  if (!isNodeType(value.type)) {
    return null;
  }
  if (!isNumberRecord(value.params)) {
    throw new Error(`Node "${value.id}" needs numeric params.`);
  }
  if (value.expression !== undefined && typeof value.expression !== 'string') {
    throw new Error(`Node "${value.id}" expression must be a string.`);
  }
  if (value.subpatchName !== undefined && typeof value.subpatchName !== 'string') {
    throw new Error(`Node "${value.id}" subpatchName must be a string.`);
  }
  if (value.customLabel !== undefined && typeof value.customLabel !== 'string') {
    throw new Error(`Node "${value.id}" customLabel must be a string.`);
  }
  if (value.subpatchCloneId !== undefined && typeof value.subpatchCloneId !== 'string') {
    throw new Error(`Node "${value.id}" subpatchCloneId must be a string.`);
  }
  if (value.sample !== undefined && !isSampleAsset(value.sample)) {
    throw new Error(`Node "${value.id}" sample must include a string name and url.`);
  }
  if (value.image !== undefined && !isImageAsset(value.image)) {
    throw new Error(`Node "${value.id}" image must include a string name and url.`);
  }
  if (value.compactPorts !== undefined && typeof value.compactPorts !== 'boolean') {
    throw new Error(`Node "${value.id}" compactPorts must be a boolean.`);
  }
  if (value.spreadNodeIds !== undefined && (
    !Array.isArray(value.spreadNodeIds)
    || !value.spreadNodeIds.every((entry) => typeof entry === 'string')
  )) {
    throw new Error(`Node "${value.id}" spreadNodeIds must be an array of strings.`);
  }
  if (value.scale !== undefined && (typeof value.scale !== 'number' || !Number.isFinite(value.scale) || value.scale <= 0)) {
    throw new Error(`Node "${value.id}" scale must be a positive finite number.`);
  }

  const position = value.position === undefined ? undefined : parsePosition(value.position, value.id);
  const scopeSize = value.scopeSize === undefined ? undefined : parseNodeDisplaySize(value.scopeSize, value.id, value.type);
  const parsedInputs = value.inputs === undefined ? undefined : parsePortDefinitions(value.inputs, `Node "${value.id}" inputs`);
  const outputs = value.outputs === undefined ? undefined : parsePortDefinitions(value.outputs, `Node "${value.id}" outputs`);
  const subpatch = value.subpatch === undefined ? undefined : parsePatchObject(value.subpatch, `Node "${value.id}" subpatch`);
  const expression = value.type === 'Expression'
    ? (value.expression ?? DEFAULT_EXPRESSION)
    : value.expression;
  const inputs = value.type === 'Expression' && expression !== undefined
    ? (parsedInputs ?? expressionInputDefinitions(expression))
    : normalizeLegacyInputDefinitions(value.type, parsedInputs);
  const params = value.type === 'Expression' && inputs
    ? syncParamsToInputs(value.params, inputs)
    : normalizeLegacyNodeParams(value.type, value.params);
  const customWave = value.type === 'CustomWave'
    ? normalizeCustomWave(parseCustomWaveLike(value.customWave, value.id), params)
    : undefined;

  return {
    id: value.id,
    type: value.type,
    ...(typeof value.customLabel === 'string' && value.customLabel.trim() ? { customLabel: value.customLabel.trim() } : {}),
    ...(value.subpatchName ? { subpatchName: value.subpatchName } : {}),
    ...(value.subpatchCloneId ? { subpatchCloneId: value.subpatchCloneId } : {}),
    ...(expression !== undefined ? { expression } : {}),
    ...(isSampleAsset(value.sample) ? { sample: value.sample } : {}),
    ...(isImageAsset(value.image) ? { image: value.image } : {}),
    ...(customWave ? { customWave } : {}),
    params,
    ...(position ? { position } : {}),
    ...(typeof value.scale === 'number' ? { scale: value.scale } : {}),
    ...(scopeSize ? { scopeSize } : {}),
    ...(inputs ? { inputs } : {}),
    ...(outputs ? { outputs } : {}),
    ...(subpatch ? { subpatch } : {}),
    ...(typeof value.compactPorts === 'boolean' ? { compactPorts: value.compactPorts } : {}),
    ...(Array.isArray(value.spreadNodeIds) ? { spreadNodeIds: value.spreadNodeIds as string[] } : {}),
  };
}

function normalizeLegacyNodeParams(type: NodeType, params: Record<string, number>): Record<string, number> {
  if (type !== 'SamplePlayer' || params.originalFrequency !== undefined || params.originalPitch === undefined) {
    return params;
  }

  const { originalPitch, ...nextParams } = params;
  return {
    ...nextParams,
    originalFrequency: midiNoteFrequency(originalPitch),
  };
}

function normalizeLegacyInputDefinitions(type: NodeType, inputs: PortDefinition[] | undefined): PortDefinition[] | undefined {
  if (type !== 'SamplePlayer') return inputs;
  return inputs?.map((input) => (
    input.name === 'originalPitch'
      ? { ...input, name: 'originalFrequency', defaultValue: input.defaultValue === 60 ? 440 : input.defaultValue }
      : input
  ));
}

function midiNoteFrequency(note: number): number {
  return 440 * (2 ** ((note - 69) / 12));
}

function parseCustomWaveLike(value: unknown, nodeId: string): Partial<CustomWaveSettings> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`Node "${nodeId}" customWave must be an object.`);
  }
  if (value.points !== undefined && !Array.isArray(value.points)) {
    throw new Error(`Node "${nodeId}" customWave.points must be an array.`);
  }
  return value as Partial<CustomWaveSettings>;
}

function isSampleAsset(value: unknown): value is SampleAsset {
  return isRecord(value) && typeof value.name === 'string' && typeof value.url === 'string';
}

function isImageAsset(value: unknown): value is ImageAsset {
  return isRecord(value) && typeof value.name === 'string' && typeof value.url === 'string';
}

function parsePosition(value: unknown, nodeId: string): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw new Error(`Node "${nodeId}" position must have numeric x and y.`);
  }
  return { x: value.x, y: value.y };
}

function parseNodeDisplaySize(value: unknown, nodeId: string, type: NodeType): ScopeNodeSize {
  if (!isRecord(value) || typeof value.width !== 'number' || typeof value.height !== 'number') {
    throw new Error(`Node "${nodeId}" scopeSize must have numeric width and height.`);
  }

  const size = { width: value.width, height: value.height };
  if (type === 'Image') return clampImageNodeSize(size, size.width / Math.max(1, size.height));
  if (type === 'CustomWave' || type === 'SamplePlayer') return clampCustomWaveNodeSize(size);
  if (type === 'Slider' || type === 'Button') return clampControlNodeSize(size);
  return clampScopeNodeSize(size);
}

function parsePortDefinitions(value: unknown, label: string): PortDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error(`${label} entry ${index} needs a string name.`);
    }
    return {
      name: entry.name,
      ...(typeof entry.defaultValue === 'number' ? { defaultValue: entry.defaultValue } : {}),
      ...(typeof entry.connectable === 'boolean' ? { connectable: entry.connectable } : {}),
      ...(typeof entry.valueEditor === 'boolean' ? { valueEditor: entry.valueEditor } : {}),
      ...(typeof entry.min === 'number' ? { min: entry.min } : {}),
      ...(typeof entry.max === 'number' ? { max: entry.max } : {}),
      ...(typeof entry.integer === 'boolean' ? { integer: entry.integer } : {}),
    };
  });
}

function parsePatchLink(value: unknown, index: number): PatchLink {
  if (!isRecord(value)) {
    throw new Error(`Link ${index} must be an object.`);
  }
  return {
    from: parseEndpoint(value.from, `Link ${index} source`),
    to: parseEndpoint(value.to, `Link ${index} target`),
    ...(typeof value.weight === 'number' ? { weight: value.weight } : {}),
    ...(value.mode === 'set' || value.mode === 'add' || value.mode === 'multiply' ? { mode: value.mode } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
  };
}

function parseEndpoint(value: unknown, label: string): PatchLink['from'] {
  if (!isRecord(value) || typeof value.node !== 'string' || typeof value.port !== 'string') {
    throw new Error(`${label} must have string node and port.`);
  }
  return { node: value.node, port: value.port };
}

function isNodeType(value: unknown): value is NodeType {
  if (typeof value !== 'string') return false;
  const definition = getDefinition(value as NodeType) as ReturnType<typeof getDefinition> | undefined;
  return definition?.type === value;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectSubpatchImportCandidates(patch: Patch): ImportedSubpatchCandidate[] {
  const candidates: ImportedSubpatchCandidate[] = [];

  function visit(currentPatch: Patch, pathParts: string[]) {
    currentPatch.nodes.forEach((node, index) => {
      if (node.type !== 'Group' || !node.subpatch) return;

      const name = node.subpatchName ?? node.id;
      const path = [...pathParts, name];
      const inputCount = boundaryPortDefinitions(node.subpatch, 'Ins', 'outputs').length;
      const outputCount = boundaryPortDefinitions(node.subpatch, 'Outs', 'inputs').length;
      candidates.push({
        key: `${path.join('/')}:${node.id}:${index}`,
        name,
        path: path.join(' / '),
        subpatch: node.subpatch,
        inputCount,
        outputCount,
        nodeCount: node.subpatch.nodes.length,
      });

      visit(node.subpatch, path);
    });
  }

  visit(patch, []);
  return candidates;
}

async function buildLocalSubpatchImportEntries(patches: LocalPatchEntry[]): Promise<LocalSubpatchImportEntry[]> {
  const sourcesBySubpatchName = new Map<string, LocalSubpatchImportSource[]>();
  const versionTasks = patches.flatMap((patchEntry) => patchEntry.versions.map(async (version) => {
    const patch = parsePatchJson(await fetchLocalPatchVersion(patchEntry.name, version.id));
    collectSubpatchImportCandidates(patch).forEach((candidate) => {
      const key = `${patchEntry.name}/${version.id}/${candidate.key}`;
      const source: LocalSubpatchImportSource = {
        key,
        patchName: patchEntry.name,
        versionId: version.id,
        savedAt: version.savedAt,
        candidate: {
          ...candidate,
          key,
          path: `${patchEntry.name} / ${formatSavedPatchTimestamp(version.savedAt)} / ${candidate.path}`,
        },
      };
      const sources = sourcesBySubpatchName.get(candidate.name);
      if (sources) {
        sources.push(source);
      } else {
        sourcesBySubpatchName.set(candidate.name, [source]);
      }
    });
  }));
  await Promise.all(versionTasks);

  return Array.from(sourcesBySubpatchName.entries())
    .map(([name, sources]) => ({
      name,
      sources: sources.sort(compareLocalSubpatchSources),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compareLocalSubpatchSources(a: LocalSubpatchImportSource, b: LocalSubpatchImportSource): number {
  const savedAtDelta = Date.parse(b.savedAt) - Date.parse(a.savedAt);
  if (Number.isFinite(savedAtDelta) && savedAtDelta !== 0) return savedAtDelta;

  const patchNameDelta = a.patchName.localeCompare(b.patchName);
  if (patchNameDelta !== 0) return patchNameDelta;

  return b.versionId.localeCompare(a.versionId);
}

function flowPositionForNewImport(
  reactFlow: ReactFlowInstance<ShaderFlowNode, ShaderFlowEdge> | null,
  nodes: ShaderFlowNode[],
): { x: number; y: number } {
  if (reactFlow) {
    return reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }

  if (nodes.length === 0) return { x: 0, y: 0 };
  const bounds = nodeBounds(nodes);
  return { x: bounds.x + bounds.width + 180, y: bounds.y };
}

function loadInitialEditorState(): PersistedEditorState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEditorState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeSelectedMidiDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
}

function patchWithMidiControlVisuals(patch: Patch, visuals: Record<string, MidiControlVisualState>): Patch {
  if (Object.keys(visuals).length === 0) return patch;

  let changed = false;
  const nodes = patch.nodes.map((node) => {
    const visual = visuals[node.id];
    if (!visual) return node;

    if (node.type === 'Slider' && visual.sliderValue !== undefined) {
      changed = true;
      return {
        ...node,
        params: {
          ...node.params,
          value: clampNumber(visual.sliderValue, 0, 1),
        },
      };
    }

    if (node.type === 'Button' && visual.buttonPressed !== undefined) {
      const mode = clampInteger(node.params.mode ?? 0, 0, 2);
      if (mode === 1) return node;
      changed = true;
      return {
        ...node,
        params: {
          ...node.params,
          pressed: visual.buttonPressed >= 0.5 ? 1 : 0,
        },
      };
    }

    return node;
  });

  return changed ? { ...patch, nodes } : patch;
}

function midiControlVisualsForChange(
  current: Record<string, MidiControlVisualState>,
  nodes: ShaderFlowNode[],
  edges: ShaderFlowEdge[],
  controlChange: MidiControlChange,
): Record<string, MidiControlVisualState> {
  let next = current;

  for (const node of nodes) {
    const patchNode = node.data.patchNode;
    if (patchNode.type !== 'Slider' && patchNode.type !== 'Button') continue;

    const channel = clampInteger(patchNode.params.midiChannel ?? 0, 0, 16);
    const cc = clampInteger(patchNode.params.midiCc ?? 1, 0, 127);
    if (channel === 0 || channel !== controlChange.channel || cc !== controlChange.cc) continue;

    if (patchNode.type === 'Slider') {
      if (nodeInputIsConnected(edges, patchNode.id, 'value')) continue;
      next = setMidiControlVisual(next, patchNode.id, {
        ...(next[patchNode.id] ?? {}),
        sliderValue: clampNumber(controlChange.value, 0, 1),
        lastRawValue: controlChange.value,
      });
      continue;
    }

    const previous = next[patchNode.id] ?? {};
    const rawPressed = controlChange.value >= 0.5;
    const rawWasPressed = (previous.lastRawValue ?? 0) >= 0.5;
    const mode = clampInteger(patchNode.params.mode ?? 0, 0, 2);
    const currentPressed = previous.buttonPressed ?? patchNode.params.pressed ?? 0;
    let buttonPressed = currentPressed;

    if (mode === 0) {
      buttonPressed = rawPressed && !rawWasPressed ? (currentPressed >= 0.5 ? 0 : 1) : currentPressed;
    } else {
      buttonPressed = rawPressed ? 1 : 0;
    }

    next = setMidiControlVisual(next, patchNode.id, {
      ...previous,
      buttonPressed,
      lastRawValue: controlChange.value,
    });
  }

  return next;
}

function setMidiControlVisual(
  current: Record<string, MidiControlVisualState>,
  nodeId: string,
  visual: MidiControlVisualState,
): Record<string, MidiControlVisualState> {
  const previous = current[nodeId];
  if (
    previous?.sliderValue === visual.sliderValue &&
    previous?.buttonPressed === visual.buttonPressed &&
    previous?.lastRawValue === visual.lastRawValue
  ) {
    return current;
  }
  return { ...current, [nodeId]: visual };
}

function nodeInputIsConnected(edges: ShaderFlowEdge[], nodeId: string, port: string): boolean {
  return edges.some((edge) => {
    const link = linkFromEdge(edge);
    return link?.to.node === nodeId && link.to.port === port;
  });
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(Number.isFinite(value) ? value : min, min, max));
}

function graphSnapshot(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[], areas: EditorArea[] = []): GraphSnapshot {
  const state = flowToEditorState(nodes, edges);
  return {
    nodes: state.nodes,
    edges: state.edges,
    areas: structuredClone(areas),
  };
}

function graphSnapshotKey(snapshot: GraphSnapshot): string {
  return JSON.stringify(snapshot);
}

function expressionInputDefinitions(expression: string): PortDefinition[] {
  return extractExpressionInputs(expression).map((name) => ({
    name,
    defaultValue: 0,
  }));
}

function syncParamsToInputs(
  params: Record<string, number>,
  inputs: PortDefinition[],
): Record<string, number> {
  return Object.fromEntries(inputs.map((input) => [
    input.name,
    params[input.name] ?? input.defaultValue ?? 0,
  ]));
}

function samePortDefinitions(left: PortDefinition[], right: PortDefinition[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((port, index) => (
    port.name === right[index]?.name &&
    port.defaultValue === right[index]?.defaultValue &&
    port.connectable === right[index]?.connectable &&
    port.valueEditor === right[index]?.valueEditor &&
    port.min === right[index]?.min &&
    port.max === right[index]?.max &&
    port.integer === right[index]?.integer
  ));
}

function restoreGraphSnapshot(
  snapshot: GraphSnapshot,
  setNodes: (value: ShaderFlowNode[]) => void,
  setEdges: (value: ShaderFlowEdge[]) => void,
  setAreas: (value: EditorArea[]) => void,
): void {
  const state: PersistedEditorState = { version: 1, nodes: snapshot.nodes, edges: snapshot.edges, areas: snapshot.areas };
  const callbacks = nodeCallbacksPlaceholder();
  setNodes(editorStateToFlowNodes(state, callbacks, null));
  setEdges(editorStateToFlowEdges(state, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder));
  setAreas(snapshot.areas ? structuredClone(snapshot.areas) : []);
}

function linkFromConnection(connection: Connection, mode: LinkMode = 'set'): PatchLink | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return null;
  const edge = {
    id: '',
    source: connection.source,
    sourceHandle: connection.sourceHandle,
    target: connection.target,
    targetHandle: connection.targetHandle,
    data: { mode },
  };
  return linkFromEdge(edge);
}

function linkForDraftNodeConnection(connection: DraftNodeConnection, nodeId: string): PatchLink | null {
  const originPort = parseHandleId(connection.originHandleId);
  if (!originPort) return null;

  if (connection.originHandleType === 'source') {
    return {
      from: { node: connection.originNodeId, port: originPort.port },
      to: { node: nodeId, port: 'value' },
      weight: 1,
      mode: connection.mode,
    };
  }

  return {
    from: { node: nodeId, port: 'value' },
    to: { node: connection.originNodeId, port: originPort.port },
    weight: 1,
    mode: connection.mode,
  };
}

function parseHandleId(handleId: string): { kind: 'in' | 'out'; port: string } | null {
  const [kind, port] = handleId.split(':');
  if ((kind !== 'in' && kind !== 'out') || !port) return null;
  return { kind, port };
}

function clientPointFromEvent(event: globalThis.MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('touches' in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  return { x: event.clientX, y: event.clientY };
}

function isCommandModifierPressed(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}

function isReconnectDuplicateModifierPressed(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function isDuplicateModifierPressed(event: globalThis.MouseEvent | TouchEvent): boolean {
  return event instanceof MouseEvent ? event.altKey : false;
}

function samePatchLink(a: PatchLink, b: PatchLink): boolean {
  return (
    a.from.node === b.from.node &&
    a.from.port === b.from.port &&
    a.to.node === b.to.node &&
    a.to.port === b.to.port
  );
}

function materializeRootGraph(
  activeNodes: ShaderFlowNode[],
  activeEdges: ShaderFlowEdge[],
  editingStack: SubpatchEditFrame[],
  activePatchName: string,
): { nodes: ShaderFlowNode[]; edges: ShaderFlowEdge[] } {
  if (editingStack.length === 0) {
    return { nodes: activeNodes, edges: activeEdges };
  }

  let subpatch = patchFromFlow(activeNodes, activeEdges);
  let requestedGroupName = activePatchName;
  let materialized: { nodes: ShaderFlowNode[]; edges: ShaderFlowEdge[] } | null = null;

  for (let index = editingStack.length - 1; index >= 0; index -= 1) {
    const frame = editingStack[index];
    materialized = applySubpatchToParent(frame, subpatch, requestedGroupName);
    subpatch = patchFromFlow(materialized.nodes, materialized.edges);
    requestedGroupName = frame.parentPatchName;
  }

  return materialized ?? { nodes: activeNodes, edges: activeEdges };
}

function applySubpatchToParent(
  frame: SubpatchEditFrame,
  subpatch: ReturnType<typeof patchFromFlow>,
  requestedGroupName: string,
): { nodes: ShaderFlowNode[]; edges: ShaderFlowEdge[] } {
  const inputDefinitions = boundaryPortDefinitions(subpatch, 'Ins', 'outputs');
  const outputDefinitions = boundaryPortDefinitions(subpatch, 'Outs', 'inputs').map((port) => ({
    name: port.name,
    ...(port.connectable === undefined ? {} : { connectable: port.connectable }),
    ...(port.min === undefined ? {} : { min: port.min }),
    ...(port.max === undefined ? {} : { max: port.max }),
    ...(port.integer === undefined ? {} : { integer: port.integer }),
  }));
  const groupNode = frame.parentNodes.find((node) => node.id === frame.groupId);
  if (!groupNode) {
    return { nodes: frame.parentNodes, edges: frame.parentEdges };
  }

  const cloneId = groupNode.data.patchNode.subpatchCloneId;
  const linkedGroupIds = new Set(
    frame.parentNodes
      .filter((node) => (
        node.data.patchNode.type === 'Group' &&
        cloneId !== undefined &&
        node.data.patchNode.subpatchCloneId === cloneId
      ))
      .map((node) => node.id),
  );
  linkedGroupIds.add(frame.groupId);

  const nextSubpatchName = normalizeSubpatchName(requestedGroupName, groupNode.data.patchNode.subpatchName ?? frame.groupId);
  const inputNames = new Set(inputDefinitions.map((port) => port.name));
  const outputNames = new Set(outputDefinitions.map((port) => port.name));
  const nodes: ShaderFlowNode[] = frame.parentNodes.map((node) => {
    if (!linkedGroupIds.has(node.id)) return { ...node, selected: false };

    const previousParams = node.data.patchNode.params;
    const previousInputs = new Map((node.data.patchNode.inputs ?? []).map((port) => [port.name, port]));
    const params = Object.fromEntries(inputDefinitions.map((port) => [
      port.name,
      nextGroupInputParam(previousParams, previousInputs.get(port.name), port),
    ]));

    return {
      ...node,
      selected: node.id === frame.groupId,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          id: node.id,
          type: 'Group',
          subpatchName: nextSubpatchName,
          subpatchCloneId: node.data.patchNode.subpatchCloneId ?? cloneId ?? makeSubpatchCloneId(node.id),
          params,
          inputs: inputDefinitions,
          outputs: outputDefinitions,
          subpatch: clonePatch(subpatch),
        },
      },
    };
  });

  const edges = dedupeEdges(frame.parentEdges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    if (!link) return [];
    if (linkedGroupIds.has(link.to.node) && !inputNames.has(link.to.port)) return [];
    if (linkedGroupIds.has(link.from.node) && !outputNames.has(link.from.port)) return [];
    return [{ ...edge, selected: false }];
  }));

  return { nodes, edges };
}

function emptySubpatchForGroup(groupNode: PatchNode, position: { x: number; y: number }): ReturnType<typeof patchFromFlow> {
  return {
    nodes: [
      {
        id: 'ins_1',
        type: 'Ins',
        params: Object.fromEntries((groupNode.inputs ?? []).map((port) => [
          port.name,
          groupNode.params[port.name] ?? port.defaultValue ?? 0,
        ])),
        outputs: groupNode.inputs?.map((port) => ({
          ...port,
          defaultValue: groupNode.params[port.name] ?? port.defaultValue ?? 0,
        })) ?? [],
        position: { x: position.x - 220, y: position.y },
      },
      {
        id: 'outs_1',
        type: 'Outs',
        params: {},
        inputs: groupNode.outputs?.map((port) => ({ ...port, defaultValue: undefined })) ?? [],
        position: { x: position.x + 220, y: position.y },
      },
    ],
    links: [],
  };
}

function boundaryPortDefinitions(
  patch: ReturnType<typeof patchFromFlow>,
  boundaryType: 'Ins' | 'Outs',
  side: 'inputs' | 'outputs',
): PortDefinition[] {
  const usedNames = new Set<string>();
  const definitions: PortDefinition[] = [];

  for (const node of patch.nodes) {
    if (node.type !== boundaryType) continue;

    for (const port of node[side] ?? []) {
      if (usedNames.has(port.name)) continue;
      usedNames.add(port.name);
      definitions.push({
        ...port,
        ...(boundaryType === 'Ins' && side === 'outputs'
          ? { defaultValue: node.params[port.name] ?? port.defaultValue ?? 0 }
          : {}),
      });
    }
  }

  return definitions;
}

function nextGroupInputParam(
  previousParams: Record<string, number>,
  previousInput: PortDefinition | undefined,
  nextInput: PortDefinition,
): number {
  const nextDefault = nextInput.defaultValue ?? 0;
  const previousValue = previousParams[nextInput.name];
  if (previousValue === undefined) return nextDefault;
  if (previousValue === (previousInput?.defaultValue ?? 0)) return nextDefault;
  return previousValue;
}

function groupSelectedGraph(
  nodes: ShaderFlowNode[],
  edges: ShaderFlowEdge[],
  onWeightChange: (edgeId: string, weight: number) => void,
  onModeChange: (edgeId: string, mode: LinkMode) => void,
  onInsertNode: (edgeId: string) => void,
): { nodes: ShaderFlowNode[]; edges: ShaderFlowEdge[] } | null {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (selectedNodes.length === 0 || selectedNodes.some((node) => node.data.patchNode.type === null)) {
    return null;
  }

  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const existingIds = new Set(nodes.map((node) => node.id));
  const groupId = makeNodeId('Group', existingIds);
  const bounds = nodeBounds(selectedNodes);
  const groupPosition = { x: bounds.x, y: bounds.y };
  const linkedEdges = edges
    .map((edge, index) => ({ edge, link: linkFromEdge(edge), index }))
    .filter((entry): entry is { edge: ShaderFlowEdge; link: PatchLink; index: number } => entry.link !== null);
  const incomingBoundary = linkedEdges.filter(({ link }) => !selectedNodeIds.has(link.from.node) && selectedNodeIds.has(link.to.node));
  const outgoingBoundary = linkedEdges.filter(({ link }) => selectedNodeIds.has(link.from.node) && !selectedNodeIds.has(link.to.node));
  const internalEdges = linkedEdges.filter(({ link }) => selectedNodeIds.has(link.from.node) && selectedNodeIds.has(link.to.node));
  const inputPorts = boundaryPorts(incomingBoundary, (link) => link.to, (endpoint) => endpoint.port);
  const outputPorts = boundaryPorts(outgoingBoundary, (link) => link.from, (endpoint) => endpoint.port);
  const inputDefinitions = inputPorts.map(({ name }): PortDefinition => ({ name, defaultValue: 0 }));
  const outputDefinitions = outputPorts.map(({ name }): PortDefinition => ({ name }));
  const inputNameByEndpoint = new Map(inputPorts.map((port) => [endpointKey(port.endpoint), port.name]));
  const outputNameByEndpoint = new Map(outputPorts.map((port) => [endpointKey(port.endpoint), port.name]));
  const subpatchNodeIds = new Set(selectedNodeIds);
  const insNodeId = makeNodeId('Ins', subpatchNodeIds);
  subpatchNodeIds.add(insNodeId);
  const outsNodeId = makeNodeId('Outs', subpatchNodeIds);
  const subpatch = {
    nodes: [
      {
        id: insNodeId,
        type: 'Ins' as const,
        params: Object.fromEntries(inputDefinitions.map((port) => [port.name, port.defaultValue ?? 0])),
        outputs: inputDefinitions,
        position: { x: bounds.x - 220, y: bounds.y },
      },
      ...selectedNodes.map((node) => patchNodeFromFlowNode(node)),
      {
        id: outsNodeId,
        type: 'Outs' as const,
        params: {},
        inputs: outputDefinitions,
        position: { x: bounds.x + bounds.width + 220, y: bounds.y },
      },
    ],
    links: dedupePatchLinks([
      ...internalEdges.map(({ link }) => link),
      ...incomingBoundary.flatMap(({ link }) => {
        const port = inputNameByEndpoint.get(endpointKey(link.to));
        return port ? [{ from: { node: insNodeId, port }, to: link.to, weight: link.weight, mode: link.mode, enabled: link.enabled }] : [];
      }),
      ...outgoingBoundary.flatMap(({ link }) => {
        const port = outputNameByEndpoint.get(endpointKey(link.from));
        return port ? [{ from: link.from, to: { node: outsNodeId, port }, weight: link.weight, mode: link.mode, enabled: link.enabled }] : [];
      }),
    ]),
  };
  const groupNode: ShaderFlowNode = {
    id: groupId,
    type: 'shaderNode',
    position: groupPosition,
    selected: true,
    data: {
      patchNode: {
        id: groupId,
        type: 'Group',
        subpatchName: groupId,
        subpatchCloneId: makeSubpatchCloneId(groupId),
        params: Object.fromEntries(inputDefinitions.map((port) => [port.name, 0])),
        position: groupPosition,
        inputs: inputDefinitions,
        outputs: outputDefinitions,
        subpatch,
      },
      ...nodeCallbacksPlaceholder(),
      isTypePickerOpen: false,
    },
  };
  const rewiredEdges = linkedEdges.flatMap(({ edge, link }) => {
    const sourceSelected = selectedNodeIds.has(link.from.node);
    const targetSelected = selectedNodeIds.has(link.to.node);
    if (sourceSelected && targetSelected) return [];

    if (!sourceSelected && targetSelected) {
      const port = inputNameByEndpoint.get(endpointKey(link.to));
      return port ? [edgeFromLink({ from: link.from, to: { node: groupId, port }, weight: link.weight, mode: link.mode, enabled: link.enabled }, onWeightChange, onModeChange, onInsertNode)] : [];
    }

    if (sourceSelected && !targetSelected) {
      const port = outputNameByEndpoint.get(endpointKey(link.from));
      return port ? [edgeFromLink({ from: { node: groupId, port }, to: link.to, weight: link.weight, mode: link.mode, enabled: link.enabled }, onWeightChange, onModeChange, onInsertNode)] : [];
    }

    return [edge];
  });

  return {
    nodes: [
      ...nodes.filter((node) => !selectedNodeIds.has(node.id)).map((node) => ({ ...node, selected: false })),
      groupNode,
    ],
    edges: dedupeEdges(rewiredEdges.map((edge) => ({ ...edge, selected: false }))),
  };
}

function patchNodeFromFlowNode(node: ShaderFlowNode): PatchNode {
  const patchNode = node.data.patchNode;
  if (patchNode.type === null) {
    throw new Error(`Cannot group draft node "${node.id}".`);
  }

  return {
    id: patchNode.id,
    type: patchNode.type,
    ...(patchNode.customLabel ? { customLabel: patchNode.customLabel } : {}),
    ...(patchNode.subpatchName ? { subpatchName: patchNode.subpatchName } : {}),
    ...(patchNode.subpatchCloneId ? { subpatchCloneId: patchNode.subpatchCloneId } : {}),
    ...(patchNode.expression !== undefined ? { expression: patchNode.expression } : {}),
    ...(patchNode.sample ? { sample: { ...patchNode.sample } } : {}),
    ...(patchNode.image ? { image: { ...patchNode.image } } : {}),
    ...(patchNode.customWave ? { customWave: normalizeCustomWave(patchNode.customWave, patchNode.params) } : {}),
    params: { ...patchNode.params },
    position: { ...node.position },
    ...(patchNode.scale !== undefined ? { scale: patchNode.scale } : {}),
    ...(patchNode.scopeSize ? { scopeSize: { ...patchNode.scopeSize } } : {}),
    ...(patchNode.inputs ? { inputs: patchNode.inputs.map((port) => ({ ...port })) } : {}),
    ...(patchNode.outputs ? { outputs: patchNode.outputs.map((port) => ({ ...port })) } : {}),
    ...(patchNode.subpatch ? { subpatch: clonePatch(patchNode.subpatch) } : {}),
    ...(patchNode.compactPorts !== undefined ? { compactPorts: patchNode.compactPorts } : {}),
  };
}

function clonePatch(patch: ReturnType<typeof patchFromFlow>): ReturnType<typeof patchFromFlow> {
  return {
    nodes: patch.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ...(node.customLabel ? { customLabel: node.customLabel } : {}),
      ...(node.subpatchName ? { subpatchName: node.subpatchName } : {}),
      ...(node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {}),
      ...(node.expression !== undefined ? { expression: node.expression } : {}),
      ...(node.sample ? { sample: { ...node.sample } } : {}),
      ...(node.image ? { image: { ...node.image } } : {}),
      ...(node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {}),
      params: { ...node.params },
      ...(node.position ? { position: { ...node.position } } : {}),
      ...(node.scale !== undefined ? { scale: node.scale } : {}),
      ...(node.scopeSize ? { scopeSize: { ...node.scopeSize } } : {}),
      ...(node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {}),
      ...(node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {}),
      ...(node.subpatch ? { subpatch: clonePatch(node.subpatch) } : {}),
      ...(node.compactPorts !== undefined ? { compactPorts: node.compactPorts } : {}),
    })),
    links: patch.links.map((link) => ({
      from: { ...link.from },
      to: { ...link.to },
      weight: link.weight,
      mode: link.mode,
      enabled: link.enabled,
    })),
  };
}

function boundaryPorts(
  entries: Array<{ link: PatchLink; index: number }>,
  endpointForLink: (link: PatchLink) => PatchLink['from'],
  baseNameForEndpoint: (endpoint: PatchLink['from']) => string,
): Array<{ endpoint: PatchLink['from']; name: string }> {
  const ports: Array<{ endpoint: PatchLink['from']; name: string; index: number }> = [];
  const usedNames = new Set<string>();
  const endpointNames = new Map<string, string>();

  for (const entry of entries) {
    const endpoint = endpointForLink(entry.link);
    const key = endpointKey(endpoint);
    const existingName = endpointNames.get(key);
    if (existingName) continue;

    const preferredName = normalizePortName(baseNameForEndpoint(endpoint)) || 'value';
    const fallbackName = normalizePortName(`${endpoint.node}_${endpoint.port}`) || preferredName;
    const name = uniquePortName(usedNames.has(preferredName) ? fallbackName : preferredName, usedNames);
    usedNames.add(name);
    endpointNames.set(key, name);
    ports.push({ endpoint, name, index: entry.index });
  }

  return ports.sort((a, b) => a.index - b.index).map(({ endpoint, name }) => ({ endpoint, name }));
}

function translateExtentForVisibleContent(
  nodes: ShaderFlowNode[],
  viewport: Viewport,
  editorSize: { width: number; height: number },
): CoordinateExtent {
  if (editorSize.width <= 0 || editorSize.height <= 0) {
    return FLOW_INFINITE_EXTENT;
  }

  const bounds = viewportContentBounds(nodes);
  const zoom = normalizedViewportZoom(viewport.zoom);
  const emptyWidth = (editorSize.width / zoom) * MAX_EMPTY_SCREEN_RATIO;
  const emptyHeight = (editorSize.height / zoom) * MAX_EMPTY_SCREEN_RATIO;

  return [
    [bounds.x - emptyWidth, bounds.y - emptyHeight],
    [bounds.x + bounds.width + emptyWidth, bounds.y + bounds.height + emptyHeight],
  ];
}

function clampViewportToTranslateExtent(
  viewport: Viewport,
  translateExtent: CoordinateExtent,
  editorSize: { width: number; height: number },
): Viewport {
  if (editorSize.width <= 0 || editorSize.height <= 0) return viewport;

  const zoom = normalizedViewportZoom(viewport.zoom);
  const visibleWidth = editorSize.width / zoom;
  const visibleHeight = editorSize.height / zoom;
  const left = -viewport.x / zoom;
  const top = -viewport.y / zoom;
  const minLeft = translateExtent[0][0];
  const minTop = translateExtent[0][1];
  const maxLeft = translateExtent[1][0] - visibleWidth;
  const maxTop = translateExtent[1][1] - visibleHeight;
  const clampedLeft = clampNumber(left, Math.min(minLeft, maxLeft), Math.max(minLeft, maxLeft));
  const clampedTop = clampNumber(top, Math.min(minTop, maxTop), Math.max(minTop, maxTop));

  return {
    x: -clampedLeft * zoom,
    y: -clampedTop * zoom,
    zoom,
  };
}

function viewportContentBounds(nodes: ShaderFlowNode[]): { x: number; y: number; width: number; height: number } {
  const visibleNodes = nodes.filter((node) => node.hidden !== true);
  if (visibleNodes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of visibleNodes) {
    const size = viewportNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function viewportNodeSize(node: ShaderFlowNode): { width: number; height: number } {
  const measuredWidth = finitePositiveNumber(node.measured?.width ?? node.width ?? node.initialWidth);
  const measuredHeight = finitePositiveNumber(node.measured?.height ?? node.height ?? node.initialHeight);
  if (measuredWidth !== null && measuredHeight !== null) {
    return { width: measuredWidth, height: measuredHeight };
  }

  const patchNode = node.data.patchNode;
  if (patchNode.type === 'Slider' || patchNode.type === 'Button') {
    const size = clampControlNodeSize(patchNode.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'Spread') {
    const size = patchNode.scopeSize ?? DEFAULT_SPREAD_SIZE;
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'Scope' || patchNode.type === 'Meter' || patchNode.type === 'FFT') {
    const size = clampScopeNodeSize(
      patchNode.scopeSize ?? (patchNode.type === 'FFT' ? DEFAULT_FFT_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE),
    );
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'Image') {
    const size = clampImageNodeSize(patchNode.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE, (patchNode.scopeSize?.width ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.width) / Math.max(1, patchNode.scopeSize?.height ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.height));
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'CustomWave' || patchNode.type === 'SamplePlayer') {
    const size = clampCustomWaveNodeSize(patchNode.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'Sequencer') {
    const shape = sequencerShape(patchNode.params);
    const size = clampSequencerNodeSize(
      patchNode.scopeSize ?? DEFAULT_SEQUENCER_NODE_SIZE,
      shape.steps,
      shape.rows,
    );
    return {
      width: size.width,
      height: NODE_HEADER_HEIGHT + size.height + 92,
    };
  }

  if (patchNode.type === 'Expression') {
    return { width: 240, height: DEFAULT_NODE_BOUNDS_SIZE.height };
  }

  if (patchNode.type === null) {
    return { width: DRAFT_NODE_WIDTH, height: DEFAULT_NODE_BOUNDS_SIZE.height };
  }

  return DEFAULT_NODE_BOUNDS_SIZE;
}

function lockedAreaNodeBounds(
  area: EditorArea,
  nodes: ShaderFlowNode[],
): { x: number; y: number; width: number; height: number } | null {
  const containedNodeIds = new Set(area.nodeIds ?? []);
  const containedNodes = nodes.filter((node) => (
    node.id !== area.spreadNodeId
    && containedNodeIds.has(node.id)
  ));
  if (containedNodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of containedNodes) {
    const size = viewportNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function flowNodeIsInsideSpread(spread: ShaderFlowNode, node: ShaderFlowNode): boolean {
  if (spread.data.patchNode.type !== 'Spread' || node.id === spread.id) return false;
  if (spread.data.patchNode.spreadNodeIds) {
    return spread.data.patchNode.spreadNodeIds.includes(node.id);
  }
  const size = spread.data.patchNode.scopeSize ?? DEFAULT_SPREAD_SIZE;
  return (
    node.position.x >= spread.position.x
    && node.position.x < spread.position.x + size.width
    && node.position.y >= spread.position.y + NODE_HEADER_HEIGHT + SPREAD_PORTS_HEIGHT
    && node.position.y < spread.position.y + NODE_HEADER_HEIGHT + size.height
  );
}

function normalizedViewportZoom(zoom: number): number {
  return finitePositiveNumber(zoom) ?? USER_ZOOM_BASELINE;
}

function shouldSettleZoomToBaseline(zoom: number): boolean {
  const normalizedZoom = normalizedViewportZoom(zoom);
  const distance = Math.abs(normalizedZoom - ZOOM_RESET_TARGET);
  return distance > ZOOM_CHANGE_EPSILON && distance <= ZOOM_SETTLE_THRESHOLD;
}

function formatZoomPercentage(zoom: number): string {
  return `${Math.round((zoom / USER_ZOOM_BASELINE) * 100)}%`;
}

function finitePositiveNumber(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function isFiniteCoordinateExtent(extent: CoordinateExtent): boolean {
  return extent.every((point) => point.every(Number.isFinite));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeBounds(nodes: ShaderFlowNode[]): { x: number; y: number; width: number; height: number } {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function connectedAreaIds(areas: EditorArea[], rootId: string): Set<string> {
  const root = areas.find((area) => area.id === rootId);
  if (!root) return new Set();

  const connected = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of areas) {
      if (connected.has(candidate.id)) continue;
      if (!areas.some((area) => connected.has(area.id) && areaContainsPoint(area, candidate.position))) continue;
      connected.add(candidate.id);
      changed = true;
    }
  }
  return connected;
}

function nodeIdsContainedByAreaHierarchy(
  areas: EditorArea[],
  nodes: ShaderFlowNode[],
  rootId: string,
): Set<string> {
  const containedAreaIds = connectedAreaIds(areas, rootId);
  const containedAreas = areas.filter((area) => containedAreaIds.has(area.id));
  return new Set(nodes.flatMap((node) => (
    containedAreas.some((area) => (
      areaContainsNode(area, node) || area.spreadNodeId === node.id
    ))
      ? [node.id]
      : []
  )));
}

function promoteNodeIdsInStackOrder(
  stackOrder: string[],
  activeNodeIds: string[],
  promotedNodeIds: Set<string>,
): string[] {
  const activeNodeIdSet = new Set(activeNodeIds);
  const orderedActiveIds = stackOrder.filter((nodeId) => activeNodeIdSet.has(nodeId));
  const orderedActiveIdSet = new Set(orderedActiveIds);
  const completeOrder = [
    ...orderedActiveIds,
    ...activeNodeIds.filter((nodeId) => !orderedActiveIdSet.has(nodeId)),
  ];
  const nextOrder = [
    ...completeOrder.filter((nodeId) => !promotedNodeIds.has(nodeId)),
    ...completeOrder.filter((nodeId) => promotedNodeIds.has(nodeId)),
  ];

  return nextOrder.length === stackOrder.length
    && nextOrder.every((nodeId, index) => nodeId === stackOrder[index])
    ? stackOrder
    : nextOrder;
}

function spreadAreaForNode(node: ShaderFlowNode): EditorArea {
  const size = node.data.patchNode.scopeSize ?? DEFAULT_SPREAD_SIZE;
  return {
    id: `spread-area:${node.id}`,
    kind: 'spread',
    spreadNodeId: node.id,
    title: 'Spread',
    position: { ...node.position },
    size: {
      width: Math.max(240, size.width),
      height: Math.max(NODE_HEADER_HEIGHT + SPREAD_PORTS_HEIGHT + 48, NODE_HEADER_HEIGHT + size.height),
    },
    uiHeight: SPREAD_PORTS_HEIGHT,
    ...(node.data.patchNode.spreadNodeIds ? {
      locked: true,
      nodeIds: [...node.data.patchNode.spreadNodeIds],
    } : {}),
  };
}

function reconcileSpreadAreas(areas: EditorArea[], nodes: ShaderFlowNode[]): EditorArea[] {
  const spreadNodes = nodes.filter((node) => node.data.patchNode.type === 'Spread');
  const spreadNodeIds = new Set(spreadNodes.map((node) => node.id));
  const retained = areas.filter((area) => (
    area.kind !== 'spread'
    || (area.spreadNodeId !== undefined && spreadNodeIds.has(area.spreadNodeId))
  ));
  const existingSpreadNodeIds = new Set(retained.flatMap((area) => (
    area.kind === 'spread' && area.spreadNodeId ? [area.spreadNodeId] : []
  )));
  const added = spreadNodes
    .filter((node) => !existingSpreadNodeIds.has(node.id))
    .map(spreadAreaForNode);
  return retained.length === areas.length && added.length === 0 ? areas : [...retained, ...added];
}

function optionalStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areaContainsPoint(area: EditorArea, point: { x: number; y: number }): boolean {
  return point.x >= area.position.x
    && point.x < area.position.x + area.size.width
    && point.y >= area.position.y
    && point.y < area.position.y + area.size.height;
}

function collapsedAreaContainingNode(areas: EditorArea[], node: ShaderFlowNode): EditorArea | undefined {
  return areas
    // UI controls are intentionally position-owned: older saved areas can have a
    // stale locked-node snapshot, but a control in their UI section must still
    // receive the collapsed presentation.
    .filter((area) => areaContainsNode(area, node) || nodeIsInAreaUiSection(area, node))
    .sort((left, right) => (left.size.width * left.size.height) - (right.size.width * right.size.height))[0];
}

function areaContainsNode(area: EditorArea, node: ShaderFlowNode): boolean {
  return area.locked
    ? area.nodeIds?.includes(node.id) === true
    : areaContainsPoint(area, node.position);
}

function nodeIsInAreaUiSection(area: EditorArea, node: ShaderFlowNode): boolean {
  return area.uiHeight !== undefined
    && node.position.x >= area.position.x
    && node.position.x < area.position.x + area.size.width
    && node.position.y >= area.position.y + NODE_HEADER_HEIGHT
    && node.position.y < area.position.y + NODE_HEADER_HEIGHT + area.uiHeight;
}

function collapsedAreaInputPin(area: EditorArea): { x: number; y: number } {
  return { x: area.position.x, y: area.position.y + NODE_HEADER_HEIGHT / 2 };
}

function collapsedAreaOutputPin(area: EditorArea): { x: number; y: number } {
  return { x: area.position.x + area.size.width, y: area.position.y + NODE_HEADER_HEIGHT / 2 };
}

function endpointKey(endpoint: PatchLink['from']): string {
  return `${endpoint.node}.${endpoint.port}`;
}

function canRenameBoundaryPort(node: PatchNode, side: 'input' | 'output'): boolean {
  return (node.type === 'Ins' && side === 'output') || (node.type === 'Outs' && side === 'input');
}

function renamePortDefinitions(
  ports: PortDefinition[] | undefined,
  previousPort: string,
  nextPort: string,
): PortDefinition[] | undefined {
  return ports?.map((port) => port.name === previousPort ? { ...port, name: nextPort } : port);
}

function setPortDefaultValue(
  ports: PortDefinition[] | undefined,
  portName: string,
  value: number,
): PortDefinition[] | undefined {
  return ports?.map((port) => port.name === portName ? { ...port, defaultValue: value } : port);
}

function movePortDefinitions(
  ports: PortDefinition[] | undefined,
  portName: string,
  direction: -1 | 1,
): PortDefinition[] | undefined {
  if (!ports) return ports;

  const fromIndex = ports.findIndex((port) => port.name === portName);
  const toIndex = fromIndex + direction;
  if (fromIndex < 0 || toIndex < 0 || toIndex >= ports.length) return ports;

  const nextPorts = ports.map((port) => ({ ...port }));
  [nextPorts[fromIndex], nextPorts[toIndex]] = [nextPorts[toIndex], nextPorts[fromIndex]];
  return nextPorts;
}

function renameParamKey(params: Record<string, number>, previousKey: string, nextKey: string): Record<string, number> {
  if (previousKey === nextKey || params[previousKey] === undefined) return params;

  const nextParams = { ...params, [nextKey]: params[previousKey] };
  delete nextParams[previousKey];
  return nextParams;
}

function removeParamKey(params: Record<string, number>, key: string): Record<string, number> {
  if (params[key] === undefined) return params;

  const nextParams = { ...params };
  delete nextParams[key];
  return nextParams;
}

function boundaryPortHasDefaultValue(node: PatchNode, side: 'input' | 'output'): boolean {
  return node.type === 'Ins' && side === 'output';
}

function nextBoundaryPortParams(
  node: PatchNode,
  side: 'input' | 'output',
  previousPort: string,
  nextPort: string,
): Record<string, number> {
  if (boundaryPortHasDefaultValue(node, side)) {
    return renameParamKey(node.params, previousPort, nextPort);
  }

  if (node.type === 'Outs' && side === 'input') {
    return removeParamKey(node.params, previousPort);
  }

  return node.params;
}

function renameEdgePort(
  edge: ShaderFlowEdge,
  nodeId: string,
  side: 'input' | 'output',
  previousPort: string,
  nextPort: string,
): ShaderFlowEdge {
  const link = linkFromEdge(edge);
  if (!link) return edge;

  if (side === 'input' && link.to.node === nodeId && link.to.port === previousPort) {
    return {
      ...edgeFromLink({ from: link.from, to: { node: nodeId, port: nextPort }, weight: link.weight, mode: link.mode, enabled: link.enabled }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected,
    };
  }

  if (side === 'output' && link.from.node === nodeId && link.from.port === previousPort) {
    return {
      ...edgeFromLink({ from: { node: nodeId, port: nextPort }, to: link.to, weight: link.weight, mode: link.mode, enabled: link.enabled }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected,
    };
  }

  return edge;
}

function normalizePortName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function uniqueBoundaryPortName(requestedPort: string, currentPort: string, ports: string[]): string | null {
  const normalized = normalizePortName(requestedPort);
  if (!normalized) return null;
  if (normalized === currentPort) return currentPort;

  const usedNames = new Set(ports);
  usedNames.delete(currentPort);
  return uniquePortName(normalized, usedNames);
}

function uniquePortName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) return baseName;

  let index = 2;
  let candidate = `${baseName}_${index}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${baseName}_${index}`;
  }
  return candidate;
}

function isSelectorValuePortName(name: string): boolean {
  return /^[1-9][0-9]*$/.test(name);
}

function selectorValueInputs(inputs: PortDefinition[]): PortDefinition[] {
  return inputs.filter((input) => isSelectorValuePortName(input.name));
}

function selectorPortMapAfterRemoval(orderedPorts: string[], removedIndex: number): Map<string, string> {
  const portMap = new Map<string, string>();
  orderedPorts
    .filter((port) => Number(port) !== removedIndex)
    .forEach((port, nextIndex) => {
      portMap.set(port, String(nextIndex + 1));
    });
  return portMap;
}

function remapSelectorParamsAfterRemoval(
  params: Record<string, number>,
  valuePorts: string[],
  portMap: Map<string, string>,
  removedIndex: number,
): Record<string, number> {
  const nextParams = { ...params };
  for (const port of valuePorts) {
    delete nextParams[port];
  }
  for (const [previousPort, nextPort] of portMap.entries()) {
    nextParams[nextPort] = params[previousPort] ?? 0;
  }

  const nextInputCount = portMap.size;
  const rawSelect = Number(params.select ?? 0);
  const currentSelect = Number.isFinite(rawSelect) ? rawSelect : 0;
  const shiftedSelect = currentSelect > removedIndex ? currentSelect - 1 : currentSelect;
  nextParams.select = Math.min(Math.max(shiftedSelect, 0), nextInputCount);
  return nextParams;
}

function remapSelectorEdgeAfterRemoval(
  edge: ShaderFlowEdge,
  nodeId: string,
  portMap: Map<string, string>,
  removedIndex: number,
): ShaderFlowEdge[] {
  const link = linkFromEdge(edge);
  if (!link || link.to.node !== nodeId || !isSelectorValuePortName(link.to.port)) return [edge];
  if (Number(link.to.port) === removedIndex) return [];

  const nextPort = portMap.get(link.to.port);
  if (nextPort === undefined || nextPort === link.to.port) return [edge];

  return [{
    ...edgeFromLink(
      { from: link.from, to: { node: nodeId, port: nextPort }, weight: link.weight, mode: link.mode, enabled: link.enabled },
      updateEdgeWeightPlaceholder,
      updateEdgeModePlaceholder,
      insertNodeOnEdgePlaceholder,
    ),
    selected: edge.selected,
  }];
}

function selectorIndexFromKeyboardEvent(event: KeyboardEvent): number | null {
  if (!/^[1-9]$/.test(event.key)) return null;
  return Number(event.key);
}

function normalizeSubpatchName(requestedName: string, fallback: string): string {
  const trimmed = requestedName.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function makeSubpatchCloneId(seed: string): string {
  subpatchCloneSequence += 1;
  const normalizedSeed = seed.replace(/[^A-Za-z0-9_-]/g, '_') || 'group';
  return `subpatch_clone_${normalizedSeed}_${subpatchCloneSequence}`;
}

function dedupePatchLinks(links: PatchLink[]): PatchLink[] {
  const seen = new Set<string>();
  const deduped: PatchLink[] = [];
  for (const link of links) {
    const key = `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }
  return deduped;
}

function cloneFlowNodeSnapshot(node: ShaderFlowNode): ShaderFlowNode {
  const position = { ...node.position };

  return {
    ...node,
    position,
    data: {
      ...node.data,
      patchNode: {
        ...node.data.patchNode,
        params: { ...node.data.patchNode.params },
        position,
        ...(node.data.patchNode.inputs ? { inputs: node.data.patchNode.inputs.map((port) => ({ ...port })) } : {}),
        ...(node.data.patchNode.outputs ? { outputs: node.data.patchNode.outputs.map((port) => ({ ...port })) } : {}),
        ...(node.data.patchNode.subpatch ? { subpatch: clonePatch(node.data.patchNode.subpatch) } : {}),
      },
    },
  };
}

function cloneFlowEdgeSnapshot(edge: ShaderFlowEdge): ShaderFlowEdge {
  return {
    ...edge,
    data: {
      ...edge.data,
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? 'set',
      enabled: edge.data?.enabled !== false,
      onWeightChange: updateEdgeWeightPlaceholder,
      onModeChange: updateEdgeModePlaceholder,
      onInsertNode: insertNodeOnEdgePlaceholder,
    },
  };
}

function reconnectPreviewEdgeFromEdge(edge: ShaderFlowEdge): ShaderFlowEdge {
  const snapshot = cloneFlowEdgeSnapshot(edge);
  return {
    ...snapshot,
    id: `reconnect-preview:${snapshot.id}`,
    selected: false,
    selectable: false,
    deletable: false,
    reconnectable: false,
    zIndex: SELECTED_EDGE_Z_INDEX - 1,
    data: {
      ...snapshot.data,
      weight: snapshot.data?.weight ?? 1,
      mode: snapshot.data?.mode ?? 'set',
      enabled: snapshot.data?.enabled !== false,
      onWeightChange: snapshot.data?.onWeightChange ?? updateEdgeWeightPlaceholder,
      onModeChange: snapshot.data?.onModeChange ?? updateEdgeModePlaceholder,
      onInsertNode: snapshot.data?.onInsertNode ?? insertNodeOnEdgePlaceholder,
      showLinkControls: false,
    },
  };
}

function syncDuplicateDragPositions(
  state: DuplicateDragState | null,
  dragNodes: ShaderFlowNode[],
): DuplicateDragState | null {
  if (!state || dragNodes.length === 0) return state;

  const sourceIds = state.nodeIds;
  let changed = false;
  const currentPositions = { ...state.currentPositions };

  for (const node of dragNodes) {
    if (!sourceIds.has(node.id)) continue;
    const previous = currentPositions[node.id];
    if (previous && previous.x === node.position.x && previous.y === node.position.y) continue;

    currentPositions[node.id] = { ...node.position };
    changed = true;
  }

  return changed ? { ...state, currentPositions } : state;
}

function syncDuplicateDragPositionsFromChanges(
  state: DuplicateDragState,
  changes: NodeChange<ShaderFlowNode>[],
): DuplicateDragState {
  let changed = false;
  const currentPositions = { ...state.currentPositions };

  for (const change of changes) {
    if (change.type !== 'position' || !change.position || !state.nodeIds.has(change.id)) continue;

    const previous = currentPositions[change.id];
    if (previous && previous.x === change.position.x && previous.y === change.position.y) continue;

    currentPositions[change.id] = { ...change.position };
    changed = true;
  }

  return changed ? { ...state, currentPositions } : state;
}

function anchorDuplicatedNodePositionChanges(
  changes: NodeChange<ShaderFlowNode>[],
  originalPositions: Record<string, { x: number; y: number }>,
): NodeChange<ShaderFlowNode>[] {
  return changes.map((change) => {
    if (change.type !== 'position') return change;
    const position = originalPositions[change.id];
    if (!position) return change;

    return {
      ...change,
      position: { ...position },
      positionAbsolute: { ...position },
    };
  });
}

function restoreGraphNodePositions(
  nodes: ShaderFlowNode[],
  positions: Record<string, { x: number; y: number }>,
): ShaderFlowNode[] {
  return applyGraphNodePositions(nodes, positions);
}

function applyGraphNodePositions(
  nodes: ShaderFlowNode[],
  positions: Record<string, { x: number; y: number }>,
): ShaderFlowNode[] {
  return nodes.map((node) => {
    const position = positions[node.id];
    if (!position) return node;

    return {
      ...node,
      position: { ...position },
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          position: { ...position },
        },
      },
    };
  });
}

function duplicatePreviewNodeId(nodeId: string): string {
  return `${DUPLICATE_NODE_PREVIEW_PREFIX}${nodeId}`;
}

function draftNodePosition(
  connection: DraftNodeConnection,
  reactFlow: ReactFlowInstance<ShaderFlowNode, ShaderFlowEdge>,
): { x: number; y: number } {
  const pointer = reactFlow.screenToFlowPosition(connection.pointer);
  const x = connection.originHandleType === 'source'
    ? pointer.x + DRAFT_NODE_HANDLE_X_OFFSET
    : pointer.x - DRAFT_NODE_WIDTH - DRAFT_NODE_HANDLE_X_OFFSET;

  return {
    x,
    y: pointer.y - DRAFT_NODE_FIRST_PORT_Y,
  };
}

function duplicateDraggedGraph(
  nodes: ShaderFlowNode[],
  edges: ShaderFlowEdge[],
  dragState: DuplicateDragState,
  draggedPositions: Record<string, { x: number; y: number }>,
  onWeightChange: (edgeId: string, weight: number) => void,
  onModeChange: (edgeId: string, mode: LinkMode) => void,
  onInsertNode: (edgeId: string) => void,
): { nodes: ShaderFlowNode[]; edges: ShaderFlowEdge[] } {
  const existingIds = new Set(nodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  const selectedNodes = nodes.filter((node) => dragState.nodeIds.has(node.id));

  const duplicatedNodes = selectedNodes.map((node) => {
    const nextId = makeNodeId(node.data.patchNode.type ?? 'node', existingIds);
    existingIds.add(nextId);
    idMap.set(node.id, nextId);
    const position = draggedPositions[node.id] ?? node.position;

    return {
      ...node,
      id: nextId,
      selected: true,
      position,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          id: nextId,
          params: { ...node.data.patchNode.params },
          position,
        },
        isTypePickerOpen: false,
      },
    };
  });

  const duplicatedEdges = edges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    if (!link) return [];

    const fromSelected = dragState.nodeIds.has(link.from.node);
    const toSelected = dragState.nodeIds.has(link.to.node);
    if (!fromSelected && !toSelected) return [];
    if (fromSelected !== toSelected && !dragState.linkExternal) return [];

    const nextFromNode = idMap.get(link.from.node) ?? link.from.node;
    const nextToNode = idMap.get(link.to.node) ?? link.to.node;
    if (nextFromNode === link.from.node && nextToNode === link.to.node) return [];

    return [{
      ...edgeFromLink({
        from: { ...link.from, node: nextFromNode },
        to: { ...link.to, node: nextToNode },
        weight: link.weight,
        mode: link.mode,
        enabled: link.enabled,
      }, onWeightChange, onModeChange, onInsertNode),
      selected: false,
    }];
  });

  return {
    nodes: duplicatedNodes,
    edges: duplicatedEdges,
  };
}

function buildBridgeEdges(
  nodes: ShaderFlowNode[],
  edges: ShaderFlowEdge[],
  selectedNodeIds: Set<string>,
  onWeightChange: (edgeId: string, weight: number) => void,
  onModeChange: (edgeId: string, mode: LinkMode) => void,
  onInsertNode: (edgeId: string) => void,
): ShaderFlowEdge[] {
  return nodes.flatMap((node) => {
    if (!selectedNodeIds.has(node.id)) return [];

    const incoming = edges
      .map(linkFromEdge)
      .filter((link): link is PatchLink => {
        if (!link) return false;
        return link.to.node === node.id && !selectedNodeIds.has(link.from.node);
      });
    const outgoing = edges
      .map(linkFromEdge)
      .filter((link): link is PatchLink => {
        if (!link) return false;
        return link.from.node === node.id && !selectedNodeIds.has(link.to.node);
      });

    return incoming.flatMap((input) => outgoing.map((output) => edgeFromLink({
      from: input.from,
      to: output.to,
      weight: output.weight,
      mode: output.mode,
      enabled: input.enabled !== false && output.enabled !== false,
    }, onWeightChange, onModeChange, onInsertNode)));
  });
}

function selectedGraphFromNodes(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[]): CopiedGraph | null {
  const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  if (selectedNodeIds.size === 0) return null;

  return {
    nodes: nodes.filter((node) => selectedNodeIds.has(node.id)).map(cloneFlowNodeForClipboard),
    edges: edges.filter((edge) => {
      const link = linkFromEdge(edge);
      return Boolean(link && selectedNodeIds.has(link.from.node) && selectedNodeIds.has(link.to.node));
    }).map(cloneFlowEdgeForClipboard),
  };
}

function duplicateCopiedGraph(
  graph: CopiedGraph,
  existingNodes: ShaderFlowNode[],
  offset: { x: number; y: number },
  onWeightChange: (edgeId: string, weight: number) => void,
  onModeChange: (edgeId: string, mode: LinkMode) => void,
  onInsertNode: (edgeId: string) => void,
): CopiedGraph {
  const existingIds = new Set(existingNodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  const nodes = graph.nodes.map((node) => {
    const nextId = makeNodeId(node.data.patchNode.type ?? 'node', existingIds);
    existingIds.add(nextId);
    idMap.set(node.id, nextId);
    const position = {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    };

    return {
      ...node,
      id: nextId,
      position,
      selected: true,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          id: nextId,
          params: { ...node.data.patchNode.params },
          position,
        },
        isTypePickerOpen: false,
      },
    };
  });

  const edges = graph.edges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    if (!link) return [];
    const fromNode = idMap.get(link.from.node);
    const toNode = idMap.get(link.to.node);
    if (!fromNode || !toNode) return [];

    return [edgeFromLink({
      from: { ...link.from, node: fromNode },
      to: { ...link.to, node: toNode },
      weight: link.weight,
      mode: link.mode,
      enabled: link.enabled,
    }, onWeightChange, onModeChange, onInsertNode)];
  });

  return { nodes, edges };
}

function cloneFlowNodeForClipboard(node: ShaderFlowNode): ShaderFlowNode {
  return {
    ...node,
    selected: false,
    data: {
      ...node.data,
      patchNode: {
        ...node.data.patchNode,
        params: { ...node.data.patchNode.params },
        position: { ...node.position },
      },
      isTypePickerOpen: false,
    },
  };
}

function cloneFlowEdgeForClipboard(edge: ShaderFlowEdge): ShaderFlowEdge {
  return {
    ...edge,
    selected: false,
    data: {
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? 'set',
      enabled: edge.data?.enabled !== false,
      onWeightChange: updateEdgeWeightPlaceholder,
      onModeChange: updateEdgeModePlaceholder,
      onInsertNode: insertNodeOnEdgePlaceholder,
    },
  };
}

async function writeCopiedGraphToClipboard(graph: CopiedGraph): Promise<void> {
  const payload = JSON.stringify({
    app: 'visual-fm-2',
    kind: 'copied-graph',
    version: 1,
    graph: flowToEditorState(graph.nodes, graph.edges),
  });
  try {
    await navigator.clipboard?.writeText(payload);
  } catch {
    // Browser clipboard permissions are best-effort; the in-memory copy still works.
  }
}

async function readCopiedGraphFromClipboard(): Promise<CopiedGraph | null> {
  try {
    const raw = await navigator.clipboard?.readText();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      app?: string;
      kind?: string;
      version?: number;
      graph?: PersistedEditorState;
    };
    if (parsed.app !== 'visual-fm-2' || parsed.kind !== 'copied-graph' || parsed.version !== 1 || !parsed.graph) {
      return null;
    }
    const callbacks = nodeCallbacksPlaceholder();
    return {
      nodes: editorStateToFlowNodes(parsed.graph, callbacks, null),
      edges: editorStateToFlowEdges(parsed.graph, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
    };
  } catch {
    return null;
  }
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isPlaybackShortcutControlEventTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return target.type === 'range';
  }
  return target instanceof HTMLSelectElement;
}

function selectionById<T extends { id: string; selected?: boolean }>(items: T[]): Record<string, boolean> {
  return Object.fromEntries(items.map((item) => [item.id, item.selected === true]));
}

function selectedNodeIdsInScreenRect(
  editorShell: HTMLElement,
  start: ScreenPoint,
  end: ScreenPoint,
  nodeIds: Set<string>,
): Set<string> {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const selectedNodeIds = new Set<string>();

  for (const element of editorShell.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')) {
    const nodeId = element.dataset.id;
    if (!nodeId || !nodeIds.has(nodeId)) continue;

    const bounds = element.getBoundingClientRect();
    const overlapsSelection = bounds.left < right
      && bounds.right > left
      && bounds.top < bottom
      && bounds.bottom > top;
    if (overlapsSelection) selectedNodeIds.add(nodeId);
  }

  return selectedNodeIds;
}

function updateSelection<T extends { id: string; selected?: boolean }>(items: T[], selectedIds: Set<string>): T[] {
  let changed = false;
  const nextItems = items.map((item) => {
    const selected = selectedIds.has(item.id);
    if (item.selected === selected) return item;

    changed = true;
    return { ...item, selected };
  });

  return changed ? nextItems : items;
}

function nodeZIndex(
  selected: boolean,
  compactPorts: boolean,
  stackRank = 0,
  nodeCount = 1,
): number {
  const classificationZIndex = selected
    ? SELECTED_NODE_Z_INDEX
    : compactPorts
      ? COMPACT_NODE_Z_INDEX
      : EXPANDED_NODE_Z_INDEX;
  // Reserve one integer slot per node so recency can never cross a classification boundary.
  const classificationSize = Math.max(1, nodeCount);
  return classificationZIndex * classificationSize + Math.max(0, stackRank);
}

function restoreNodeSelectionAfterDeselectedDrag(
  nodes: ShaderFlowNode[],
  snapshot: NodeDragSelectionSnapshot | null,
): ShaderFlowNode[] {
  return restoreSelectionAfterDeselectedDrag(nodes, snapshot, snapshot?.nodeSelection);
}

function restoreEdgeSelectionAfterDeselectedDrag(
  edges: ShaderFlowEdge[],
  snapshot: NodeDragSelectionSnapshot | null,
): ShaderFlowEdge[] {
  return restoreSelectionAfterDeselectedDrag(edges, snapshot, snapshot?.edgeSelection);
}

function restoreSelectionAfterDeselectedDrag<T extends { id: string; selected?: boolean }>(
  items: T[],
  snapshot: NodeDragSelectionSnapshot | null,
  selectedById: Record<string, boolean> | undefined,
): T[] {
  if (!snapshot?.preserveSelection || !selectedById) return items;

  let changed = false;
  const restoredItems = items.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(selectedById, item.id)) return item;
    const selected = selectedById[item.id] === true;
    if ((item.selected === true) === selected) return item;

    changed = true;
    return { ...item, selected };
  });

  return changed ? restoredItems : items;
}

function dedupeEdges(edges: ShaderFlowEdge[]): ShaderFlowEdge[] {
  const deduped: ShaderFlowEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const link = linkFromEdge(edge);
    const key = link ? edgeId(link) : edge.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...edge, id: key });
  }
  return deduped;
}

function samplePlayerVisualizationParams(
  nodeId: string,
  linkMeters: Record<string, LinkMeterReading>,
): Partial<Record<'start' | 'end' | 'attack' | 'release', number>> | undefined {
  const params: Partial<Record<'start' | 'end' | 'attack' | 'release', number>> = {};
  for (const port of ['start', 'end', 'attack', 'release'] as const) {
    const reading = linkMeters[`${nodeId}:sample-${port}`];
    if (reading) params[port] = reading.input;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function renameEdgeNode(edge: ShaderFlowEdge, fromNodeId: string, toNodeId: string): ShaderFlowEdge {
  const link = linkFromEdge(edge);
  if (!link) return edge;
  const renamedLink: PatchLink = {
    from: { ...link.from, node: link.from.node === fromNodeId ? toNodeId : link.from.node },
    to: { ...link.to, node: link.to.node === fromNodeId ? toNodeId : link.to.node },
    weight: link.weight,
    mode: link.mode,
    enabled: link.enabled,
  };
  return edgeFromLink(renamedLink, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
}

function remapEdgeForNodeType(
  edge: ShaderFlowEdge,
  nodeId: string,
  previousDefinition: ReturnType<typeof getDefinition> | null,
  nextDefinition: ReturnType<typeof getDefinition>,
): ShaderFlowEdge | null {
  const link = linkFromEdge(edge);
  if (!link) return null;

  if (link.from.node === nodeId) {
    const previousIndex = previousDefinition?.outputs.findIndex((port) => port.name === link.from.port) ?? 0;
    const nextPort = nextDefinition.outputs[Math.max(0, previousIndex)]?.name;
    if (!nextPort) return null;
    return edgeFromLink({ ...link, from: { node: nodeId, port: nextPort } }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  }

  if (link.to.node === nodeId) {
    const previousIndex = previousDefinition?.inputs.findIndex((port) => port.name === link.to.port) ?? 0;
    const nextPort = nextDefinition.inputs[Math.max(0, previousIndex)]?.name;
    if (!nextPort) return null;
    return edgeFromLink({ ...link, to: { node: nodeId, port: nextPort } }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  }

  return edge;
}

function uniqueNodeId(requestedId: string, currentId: string, nodes: ShaderFlowNode[]): string {
  const sanitized = requestedId.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const fallback = currentId || 'node';
  const base = sanitized || fallback;
  const existingIds = new Set(nodes.map((node) => node.id).filter((id) => id !== currentId));
  if (!existingIds.has(base)) return base;

  let index = 2;
  let candidate = `${base}_${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

function shouldAutoRenameForTypeChange(nodeId: string, previousType: NodeType | null): boolean {
  return previousType === null || /^node_\d+$/.test(nodeId);
}

function nextTypeNodeId(nodeId: string, type: NodeType, nodes: ShaderFlowNode[]): string {
  return uniqueNodeId(makeNodeId(type, new Set(nodes.map((node) => node.id))), nodeId, nodes);
}

function midpointPosition(
  source?: { x: number; y: number },
  target?: { x: number; y: number },
): { x: number; y: number } {
  if (source && target) {
    return {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
    };
  }
  return { x: 0, y: 0 };
}

function nodeCallbacksPlaceholder() {
  return {
    onParamChange: updateParamPlaceholder,
    onParamsChange: updateParamsPlaceholder,
    onTypeChange: updateTypePlaceholder,
    onConvertToArea: updateConvertToAreaPlaceholder,
    onTypeEditStart: updateTypeEditStartPlaceholder,
    onTypeEditEnd: updateTypeEditEndPlaceholder,
    onTypeEditCancel: updateTypeEditCancelPlaceholder,
    onIdChange: updateIdPlaceholder,
    onPortDoubleClick: noopPortDoubleClick,
    onPortNameChange: noopPortNameChange,
    onPortMove: noopPortMove,
    onCompactToggle: noopCompactToggle,
    onScopeResize: noopScopeResize,
  };
}

function updateParamPlaceholder() {}
function updateParamsPlaceholder() {}
function updateTypePlaceholder() {}
function updateConvertToAreaPlaceholder() {}
function updateTypeEditStartPlaceholder() {}
function updateTypeEditEndPlaceholder() {}
function updateTypeEditCancelPlaceholder() {}
function updateIdPlaceholder() {}
function updateEdgeWeightPlaceholder() {}
function updateEdgeModePlaceholder() {}
function insertNodeOnEdgePlaceholder() {}
function noopPortDoubleClick() {}
function noopPortNameChange() {}
function noopPortMove() {}
function noopCompactToggle() {}
function noopScopeResize() {}
