import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  ConnectionMode,
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
  Viewport,
  type CoordinateExtent,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { compilePatchToDspProgram } from '../audio/dspProgram';
import { useAudioEngine, type MidiControlChange, type MidiInputState } from '../audio/useAudioEngine';
import { normalizeCustomWave } from '../graph/customWave';
import { demoPatch } from '../graph/demoPatch';
import { extractExpressionInputs } from '../graph/expression';
import { defaultParamsFor, getDefinition, getNodeDefinition, sequencerShape } from '../graph/nodeTypes';
import { normalizePatchCompatibility } from '../graph/patchCompatibility';
import { patchToJson } from '../graph/serialize';
import type { CustomWaveSettings, LinkMode, NodeType, Patch, PatchLink, PatchNode, PortDefinition, SampleAsset } from '../graph/types';
import { EdgeOverlayProvider } from './EdgeOverlayContext';
import {
  edgeFromLink,
  edgeId,
  clampControlNodeSize,
  clampCustomWaveNodeSize,
  clampScopeNodeSize,
  DEFAULT_CUSTOM_WAVE_NODE_SIZE,
  DEFAULT_SCOPE_NODE_SIZE,
  editorStateToFlowEdges,
  editorStateToFlowNodes,
  flowToEditorState,
  linkFromEdge,
  patchFromFlow,
  type PersistedEditorState,
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
const TRANSPARENT_CONNECTION_LINE_STYLE = { stroke: 'transparent' };
const DELETE_KEY_CODES = ['Backspace', 'Delete'];
const MULTI_SELECTION_KEY_CODES = ['Meta', 'Shift'];
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };

let subpatchCloneSequence = 0;

type GraphSnapshot = Pick<PersistedEditorState, 'nodes' | 'edges'>;
type HistoryState = { past: GraphSnapshot[]; future: GraphSnapshot[] };

interface DraftNodeConnection {
  originNodeId: string;
  originHandleId: string;
  originHandleType: HandleType;
  pointer: { x: number; y: number };
  modifierActive: boolean;
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
  const [viewport, setViewport] = useState<Viewport>(initialState?.ui?.viewport ?? { x: 0, y: 0, zoom: 1 });
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
  const [edges, setEdges] = useState<ShaderFlowEdge[]>(() => {
    return initialState
      ? editorStateToFlowEdges(initialState, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder)
      : toFlowEdges(demoPatch, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  });
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const editorShellRef = useRef<HTMLElement | null>(null);
  const historyGroupRef = useRef<{ key: string; time: number } | null>(null);
  const draftNodeConnectionRef = useRef<DraftNodeConnection | null>(null);
  const duplicateDragRef = useRef<DuplicateDragState | null>(null);
  const pendingNodeDragSelectionRef = useRef<NodeDragSelectionSnapshot | null>(null);
  const activeNodeDragSelectionRef = useRef<NodeDragSelectionSnapshot | null>(null);
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
  const [subpatchImportModal, setSubpatchImportModal] = useState<SubpatchImportModalState | null>(null);
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
  const pendingSampleUploadNodeIdRef = useRef<string | null>(null);
  const saveFeedbackTimeoutRef = useRef<number | null>(null);
  const selectedLocalPatchOptionRef = useRef<HTMLButtonElement | null>(null);
  const reconnectingEdgeRef = useRef(false);
  const reconnectDuplicateRef = useRef(false);
  const reconnectingEdgeSnapshotRef = useRef<ShaderFlowEdge | null>(null);
  const audio = useAudioEngine({ selectedMidiInputDeviceIds });
  const selectedMidiInputDeviceKey = useMemo(() => selectedMidiInputDeviceIds.join('\n'), [selectedMidiInputDeviceIds]);
  const audioPlaybackActive = audio.status === 'running' || audio.status === 'starting';
  const audioRecordingActive = audio.recording.status === 'waiting' || audio.recording.status === 'recording';
  const recordingButtonLabel = audioRecordingActive
    ? formatRecordingTimestamp(audio.recording.elapsedSeconds)
    : 'RC';
  const localPatchStorageEnabled = useMemo(() => canUseLocalPatchStorage(), []);
  const [reconnectPreviewEdge, setReconnectPreviewEdge] = useState<ShaderFlowEdge | null>(null);

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

    const snapshot = graphSnapshot(nodesRef.current, edgesRef.current);
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

  const openSampleLibrary = useCallback(async (nodeId: string) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== 'SamplePlayer') return;

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
  }, []);

  const closeSampleLibrary = useCallback(() => {
    setSampleLibrary(null);
  }, []);

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
    if (!file || !nodeId) return;

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: false, error: message } : current);
      setImportError(message);
    }
  }, [updateNodeSample]);

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

  const updateEdgeWeight = useCallback((edgeIdToUpdate: string, weight: number) => {
    commitHistory(`weight:${edgeIdToUpdate}`);
    setEdges((current) => current.map((edge) => edge.id === edgeIdToUpdate
      ? {
          ...edge,
          data: {
            ...edge.data,
            weight,
            mode: edge.data?.mode ?? 'set',
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
            onWeightChange: updateEdgeWeightPlaceholder,
            onModeChange: updateEdgeModePlaceholder,
            onInsertNode: insertNodeOnEdgePlaceholder,
          },
        }
      : edge,
    ));
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
    setEditingTypeNodeId((current) => current === nodeId ? nextId : current);
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
        relatedNode.data.patchNode.type !== 'CustomWave' &&
        relatedNode.data.patchNode.type !== 'Slider' &&
        relatedNode.data.patchNode.type !== 'Button'
      )
    ) {
      return;
    }

    const nextSize = relatedNode.data.patchNode.type === 'CustomWave'
      ? clampCustomWaveNodeSize(size)
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
        node.data.patchNode.type === 'CustomWave'
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
    const nextIndex = valueInputs.length;
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

  const addDraftNode = useCallback((position: { x: number; y: number }) => {
    const id = makeNodeId('node', new Set(nodesRef.current.map((node) => node.id)));
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
        }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder),
        edgeFromLink({
          from: { node: id, port: 'value' },
          to: link.to,
          weight: link.weight,
          mode: link.mode,
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
    const previousParentSnapshot = graphSnapshot(frame.parentNodes, frame.parentEdges);

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

  const nodesWithCallbacks = useMemo(() => nodes.map((node) => {
    const compactPorts = node.data.patchNode.compactPorts === true;

    return {
      ...node,
      zIndex: nodeZIndex(node.selected === true, compactPorts),
      data: {
        ...node.data,
        onParamChange: updateNodeParam,
        onCustomWaveChange: updateNodeCustomWave,
        onAudioInputDeviceChange: audio.setAudioInputDeviceId,
        onAudioInputRefresh: audio.refreshAudioInputDevices,
        onMidiInputRefresh: audio.refreshMidiInputDevices,
        onTypeChange: updateNodeType,
        onExpressionCommit: updateExpression,
        onTypeEditStart: setEditingTypeNodeId,
        onTypeEditEnd: () => setEditingTypeNodeId(null),
        onIdChange: updateNodeId,
        onSubpatchNameChange: updateGroupSubpatchName,
        onSampleSelect: openSampleLibrary,
        onSampleDrop: uploadDroppedSampleFiles,
        onPortDoubleClick: insertNodeOnPort,
        onPortSelect: (nodeId: string, side: 'input' | 'output', port: string) => {
          setSelectedBoundaryPort({ nodeId, side, port });
        },
        onPortNameChange: updateBoundaryPortName,
        onPortMove: updateBoundaryPortOrder,
        onCompactToggle: updateNodeCompactPorts,
        onScopeResize: updateNodeScopeSize,
        onSelectorInputAdd: addSelectorInput,
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
    selectedBoundaryPort,
    selectedLinkPortsByNode,
    updateBoundaryPortName,
    updateBoundaryPortOrder,
    updateExpression,
    updateGroupSubpatchName,
    addSelectorInput,
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
        onWeightChange: updateEdgeWeight,
        onModeChange: updateEdgeMode,
        onInsertNode: insertNodeOnEdge,
        showLinkControls: edge.selected === true && selectedEdgeCount === 1,
      },
    }));
  }, [edges, insertNodeOnEdge, updateEdgeMode, updateEdgeWeight]);

  const materializedGraph = useMemo(
    () => materializeRootGraph(nodesWithCallbacks, edgesWithCallbacks, editingStack, patchName),
    [edgesWithCallbacks, editingStack, nodesWithCallbacks, patchName],
  );
  const rootPatchName = editingStack[0]?.parentPatchName ?? patchName;
  const isEditingSubpatch = editingStack.length > 0;
  const canGroupSelection = useMemo(() => (
    nodes.some((node) => node.selected) &&
    nodes.filter((node) => node.selected).every((node) => node.data.patchNode.type !== null)
  ), [nodes]);
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
  const selectedSubpatchCandidate = subpatchImportModal?.candidates.find((candidate) => candidate.key === subpatchImportModal.selectedKey) ?? null;
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

  const renderedNodes = useMemo(() => nodesWithCallbacks.map((node) => {
    const monitorLinkId = monitorLinkIdByNode.get(node.id);
    const audioOutputLeft = audio.linkMeters[`${node.id}:left`]?.output ?? 0;
    const audioOutputRight = audio.linkMeters[`${node.id}:right`]?.output ?? 0;
    const dspErrors = dspDiagnostics.nodeErrors.get(node.id) ?? [];
    const hasAudioMonitor = Boolean(monitorLinkId);
    const hasAudioOutputMeter = node.data.patchNode.type === 'AudioOut';
    const midiControlVisual = midiControlVisuals[node.id];
    if (!hasAudioMonitor && !hasAudioOutputMeter && !midiControlVisual && dspErrors.length === 0) return node;

    return {
      ...node,
      data: {
        ...node.data,
        ...(dspErrors.length > 0 ? { dspErrors } : {}),
        ...(hasAudioOutputMeter ? { audioOutputMeter: { left: audioOutputLeft, right: audioOutputRight } } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Meter' ? { audioMeter: audio.linkMeters[monitorLinkId] } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Scope' ? { audioScope: audio.linkScopes[monitorLinkId] } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Slider' ? { audioSliderValue: audio.linkMeters[monitorLinkId]?.output } : {}),
        ...(monitorLinkId && node.data.patchNode.type === 'Sequencer' ? { audioSequencerStep: audio.linkMeters[monitorLinkId]?.output } : {}),
        ...(midiControlVisual?.sliderValue !== undefined ? { midiSliderValue: midiControlVisual.sliderValue } : {}),
        ...(midiControlVisual?.buttonPressed !== undefined ? { midiButtonPressed: midiControlVisual.buttonPressed } : {}),
      },
    };
  }), [audio.linkMeters, audio.linkScopes, dspDiagnostics, midiControlVisuals, monitorLinkIdByNode, nodesWithCallbacks]);

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
    ...renderedNodes,
    ...(duplicateDragPreview?.nodes ?? []),
    ...(draftNodePreview ? [draftNodePreview.node] : []),
  ], [draftNodePreview, duplicateDragPreview, renderedNodes]);

  const displayEdges = useMemo(() => [
    ...renderedEdges,
    ...(duplicateDragPreview?.edges ?? []),
    ...(reconnectPreviewEdge ? [reconnectPreviewEdge] : []),
    ...(draftNodePreview ? [draftNodePreview.edge] : []),
  ], [draftNodePreview, duplicateDragPreview, reconnectPreviewEdge, renderedEdges]);

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
    const scopeLinkIds = nodesWithCallbacks.flatMap((node) => {
      if (node.data.patchNode.type !== 'Scope') return [];
      const linkId = monitorLinkIdByNode.get(node.id);
      return linkId ? [linkId] : [];
    });
    audio.setLinkScopes(scopeLinkIds);
  }, [audio.setLinkScopes, monitorLinkIdByNode, nodesWithCallbacks]);

  useEffect(() => {
    const state = flowToEditorState(materializedGraph.nodes, materializedGraph.edges, {
      patchName: rootPatchName,
      viewport,
      ...(selectedMidiInputDeviceIds.length > 0
        ? { midiInput: { selectedDeviceIds: selectedMidiInputDeviceIds } }
        : {}),
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [materializedGraph, rootPatchName, selectedMidiInputDeviceIds, viewport]);

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

    const link = linkFromConnection(connection);
    if (!link) {
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
    const nextEdge = {
      ...edgeFromLink({ from: link.from, to: link.to, weight, mode }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge),
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
    setImportError(null);
  }, [commitHistory, reactFlow]);

  const requestSubpatchImport = useCallback(async () => {
    if (!localPatchStorageEnabled) {
      importFileInputRef.current?.click();
      return;
    }

    setSubpatchImportModal({
      fileName: 'patches/',
      candidates: [],
      selectedKey: null,
      error: null,
    });
    try {
      const patches = await fetchLocalPatchLibrary();
      const candidates = await buildLocalSubpatchImportCandidates(patches);
      setSubpatchImportModal({
        fileName: 'patches/',
        candidates,
        selectedKey: candidates[0]?.key ?? null,
        error: candidates.length === 0 ? 'No saved subpatches found in patches/.' : null,
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubpatchImportModal({
        fileName: 'patches/',
        candidates: [],
        selectedKey: null,
        error: message,
      });
      setImportError(message);
    }
  }, [localPatchStorageEnabled]);

  const loadSubpatchImportFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    try {
      const importedPatch = parsePatchJson(await file.text());
      const candidates = collectSubpatchImportCandidates(importedPatch);
      setSubpatchImportModal({
        fileName: file.name,
        candidates,
        selectedKey: candidates[0]?.key ?? null,
        error: candidates.length === 0 ? 'No subpatches found in this patch.' : null,
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      const now = graphSnapshot(nodesRef.current, edgesRef.current);
      restoreGraphSnapshot(previous, setNodes, setEdges);
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
      const now = graphSnapshot(nodesRef.current, edgesRef.current);
      restoreGraphSnapshot(next, setNodes, setEdges);
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

  const handleEditorPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      pendingNodeDragSelectionRef.current = null;
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const nodeElement = target?.closest<HTMLElement>('.react-flow__node[data-id]');
    const nodeId = nodeElement?.dataset.id;
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
  }, []);

  const clearPendingNodeDragSelection = useCallback(() => {
    if (!activeNodeDragSelectionRef.current) {
      pendingNodeDragSelectionRef.current = null;
    }
  }, []);

  const handleMoveEnd = useCallback((_event: globalThis.MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    setViewport(nextViewport);
  }, []);

  return (
    <div className="app-shell app-shell-panel-closed">
      <EdgeOverlayProvider target={edgeOverlayElement}>
        <main
          ref={editorShellRef}
          className="editor-shell"
          onPointerDownCapture={handleEditorPointerDownCapture}
          onPointerUpCapture={clearPendingNodeDragSelection}
          onPointerCancelCapture={clearPendingNodeDragSelection}
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
            connectionLineStyle={draftNodePreview ? TRANSPARENT_CONNECTION_LINE_STYLE : undefined}
            onEdgeDoubleClick={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              insertNodeOnEdge(edge.id);
            }}
            onMoveEnd={handleMoveEnd}
            connectionMode={ConnectionMode.Loose}
            panOnScroll
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            selectionKeyCode={null}
            panActivationKeyCode={null}
            defaultViewport={initialState?.ui?.viewport}
            fitView={!initialState?.ui?.viewport}
            fitViewOptions={FIT_VIEW_OPTIONS}
            translateExtent={panTranslateExtent}
            nodeExtent={FLOW_INFINITE_EXTENT}
            deleteKeyCode={DELETE_KEY_CODES}
            multiSelectionKeyCode={MULTI_SELECTION_KEY_CODES}
            snapToGrid={false}
            proOptions={REACT_FLOW_PRO_OPTIONS}
          >
            <Background color="rgba(255,255,255,0.08)" gap={28} size={1} />
            <Controls showInteractive={false} />
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
            <button className="viewport-button" type="button" onClick={() => void requestSubpatchImport()} aria-label="Import subpatch" title="Import subpatch">IM</button>
            <button className="viewport-button" type="button" onClick={newPatch}>NW</button>
          </div>
          <input ref={fileInputRef} className="file-input" type="file" accept="application/json,.json" onChange={loadPatchFile} />
          <input ref={importFileInputRef} className="file-input" type="file" accept="application/json,.json" onChange={loadSubpatchImportFile} />
          <input ref={sampleFileInputRef} className="file-input" type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.flac,.ogg,.m4a" onChange={uploadSampleFile} />
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
                  <button type="button" onClick={requestSampleUploadFromLibrary}>Upload new</button>
                  <button type="button" onClick={() => selectedSample && selectSampleFromLibrary(selectedSample)} disabled={!selectedSample}>Select</button>
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
    };
  }).env;
  const storageMode = viteEnv?.VITE_VISUAL_FM_PATCH_STORAGE;
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
    ...(node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {}),
    params: { ...node.params },
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
  if (value.subpatchCloneId !== undefined && typeof value.subpatchCloneId !== 'string') {
    throw new Error(`Node "${value.id}" subpatchCloneId must be a string.`);
  }
  if (value.sample !== undefined && !isSampleAsset(value.sample)) {
    throw new Error(`Node "${value.id}" sample must include a string name and url.`);
  }
  if (value.compactPorts !== undefined && typeof value.compactPorts !== 'boolean') {
    throw new Error(`Node "${value.id}" compactPorts must be a boolean.`);
  }

  const position = value.position === undefined ? undefined : parsePosition(value.position, value.id);
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
    ...(value.subpatchName ? { subpatchName: value.subpatchName } : {}),
    ...(value.subpatchCloneId ? { subpatchCloneId: value.subpatchCloneId } : {}),
    ...(expression !== undefined ? { expression } : {}),
    ...(isSampleAsset(value.sample) ? { sample: value.sample } : {}),
    ...(customWave ? { customWave } : {}),
    params,
    ...(position ? { position } : {}),
    ...(inputs ? { inputs } : {}),
    ...(outputs ? { outputs } : {}),
    ...(subpatch ? { subpatch } : {}),
    ...(typeof value.compactPorts === 'boolean' ? { compactPorts: value.compactPorts } : {}),
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

function parsePosition(value: unknown, nodeId: string): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw new Error(`Node "${nodeId}" position must have numeric x and y.`);
  }
  return { x: value.x, y: value.y };
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

async function buildLocalSubpatchImportCandidates(patches: LocalPatchEntry[]): Promise<ImportedSubpatchCandidate[]> {
  const candidates: ImportedSubpatchCandidate[] = [];
  const versionTasks = patches.flatMap((patchEntry) => patchEntry.versions.map(async (version) => {
    const patch = parsePatchJson(await fetchLocalPatchVersion(patchEntry.name, version.id));
    collectSubpatchImportCandidates(patch).forEach((candidate) => {
      candidates.push({
        ...candidate,
        key: `${patchEntry.name}/${version.id}/${candidate.key}`,
        path: `${patchEntry.name} / ${formatSavedPatchTimestamp(version.savedAt)} / ${candidate.path}`,
      });
    });
  }));
  await Promise.all(versionTasks);
  return candidates.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
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

function graphSnapshot(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[]): GraphSnapshot {
  const state = flowToEditorState(nodes, edges);
  return {
    nodes: state.nodes,
    edges: state.edges,
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
): void {
  const state: PersistedEditorState = { version: 1, nodes: snapshot.nodes, edges: snapshot.edges };
  const callbacks = nodeCallbacksPlaceholder();
  setNodes(editorStateToFlowNodes(state, callbacks, null));
  setEdges(editorStateToFlowEdges(state, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder));
}

function linkFromConnection(connection: Connection): PatchLink | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return null;
  const edge = {
    id: '',
    source: connection.source,
    sourceHandle: connection.sourceHandle,
    target: connection.target,
    targetHandle: connection.targetHandle,
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
      mode: 'set',
    };
  }

  return {
    from: { node: nodeId, port: 'value' },
    to: { node: connection.originNodeId, port: originPort.port },
    weight: 1,
    mode: 'set',
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
  const subpatch = {
    nodes: [
      {
        id: 'ins_1',
        type: 'Ins' as const,
        params: Object.fromEntries(inputDefinitions.map((port) => [port.name, port.defaultValue ?? 0])),
        outputs: inputDefinitions,
        position: { x: bounds.x - 220, y: bounds.y },
      },
      ...selectedNodes.map((node) => patchNodeFromFlowNode(node)),
      {
        id: 'outs_1',
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
        return port ? [{ from: { node: 'ins_1', port }, to: link.to, weight: link.weight, mode: link.mode }] : [];
      }),
      ...outgoingBoundary.flatMap(({ link }) => {
        const port = outputNameByEndpoint.get(endpointKey(link.from));
        return port ? [{ from: link.from, to: { node: 'outs_1', port }, weight: link.weight, mode: link.mode }] : [];
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
      return port ? [edgeFromLink({ from: link.from, to: { node: groupId, port }, weight: link.weight, mode: link.mode }, onWeightChange, onModeChange, onInsertNode)] : [];
    }

    if (sourceSelected && !targetSelected) {
      const port = outputNameByEndpoint.get(endpointKey(link.from));
      return port ? [edgeFromLink({ from: { node: groupId, port }, to: link.to, weight: link.weight, mode: link.mode }, onWeightChange, onModeChange, onInsertNode)] : [];
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
    ...(patchNode.subpatchName ? { subpatchName: patchNode.subpatchName } : {}),
    ...(patchNode.subpatchCloneId ? { subpatchCloneId: patchNode.subpatchCloneId } : {}),
    ...(patchNode.expression !== undefined ? { expression: patchNode.expression } : {}),
    ...(patchNode.sample ? { sample: { ...patchNode.sample } } : {}),
    ...(patchNode.customWave ? { customWave: normalizeCustomWave(patchNode.customWave, patchNode.params) } : {}),
    params: { ...patchNode.params },
    position: { ...node.position },
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
      ...(node.subpatchName ? { subpatchName: node.subpatchName } : {}),
      ...(node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {}),
      ...(node.expression !== undefined ? { expression: node.expression } : {}),
      ...(node.sample ? { sample: { ...node.sample } } : {}),
      ...(node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {}),
      params: { ...node.params },
      ...(node.position ? { position: { ...node.position } } : {}),
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

  if (patchNode.type === 'Scope' || patchNode.type === 'Meter') {
    const size = clampScopeNodeSize(patchNode.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'CustomWave') {
    const size = clampCustomWaveNodeSize(patchNode.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }

  if (patchNode.type === 'Sequencer') {
    const shape = sequencerShape(patchNode.params);
    return {
      width: Math.max(168, shape.steps * 26 + 18),
      height: NODE_HEADER_HEIGHT + shape.rows * 26 + 92,
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

function normalizedViewportZoom(zoom: number): number {
  return finitePositiveNumber(zoom) ?? 1;
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
      ...edgeFromLink({ from: link.from, to: { node: nodeId, port: nextPort }, weight: link.weight, mode: link.mode }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected,
    };
  }

  if (side === 'output' && link.from.node === nodeId && link.from.port === previousPort) {
    return {
      ...edgeFromLink({ from: { node: nodeId, port: nextPort }, to: link.to, weight: link.weight, mode: link.mode }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
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

function selectorValueInputs(inputs: PortDefinition[]): PortDefinition[] {
  return inputs.filter((input) => /^(0|[1-9][0-9]*)$/.test(input.name));
}

function selectorIndexFromKeyboardEvent(event: KeyboardEvent): number | null {
  if (!/^[0-9]$/.test(event.key)) return null;
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

function nodeZIndex(selected: boolean, compactPorts: boolean): number {
  if (selected) return SELECTED_NODE_Z_INDEX;
  return compactPorts ? COMPACT_NODE_Z_INDEX : EXPANDED_NODE_Z_INDEX;
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

function renameEdgeNode(edge: ShaderFlowEdge, fromNodeId: string, toNodeId: string): ShaderFlowEdge {
  const link = linkFromEdge(edge);
  if (!link) return edge;
  const renamedLink: PatchLink = {
    from: { ...link.from, node: link.from.node === fromNodeId ? toNodeId : link.from.node },
    to: { ...link.to, node: link.to.node === fromNodeId ? toNodeId : link.to.node },
    weight: link.weight,
    mode: link.mode,
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
    onTypeChange: updateTypePlaceholder,
    onTypeEditStart: updateTypeEditStartPlaceholder,
    onTypeEditEnd: updateTypeEditEndPlaceholder,
    onIdChange: updateIdPlaceholder,
    onPortDoubleClick: noopPortDoubleClick,
    onPortNameChange: noopPortNameChange,
    onPortMove: noopPortMove,
    onCompactToggle: noopCompactToggle,
    onScopeResize: noopScopeResize,
  };
}

function updateParamPlaceholder() {}
function updateTypePlaceholder() {}
function updateTypeEditStartPlaceholder() {}
function updateTypeEditEndPlaceholder() {}
function updateIdPlaceholder() {}
function updateEdgeWeightPlaceholder() {}
function updateEdgeModePlaceholder() {}
function insertNodeOnEdgePlaceholder() {}
function noopPortDoubleClick() {}
function noopPortNameChange() {}
function noopPortMove() {}
function noopCompactToggle() {}
function noopScopeResize() {}
