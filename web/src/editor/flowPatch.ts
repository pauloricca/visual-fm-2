import type { Edge, Node } from '@xyflow/react';
import type { AudioInputState, MidiInputState } from '../audio/useAudioEngine';
import { normalizeCustomWave } from '../graph/customWave';
import { migratePatchForCompatibility } from '../graph/migrations';
import type { LinkMode, NodeType, Patch, PatchLink, PatchNode, PortDefinition } from '../graph/types';

export interface ScopeNodeSize {
  width: number;
  height: number;
}

export const DEFAULT_SCOPE_NODE_SIZE: ScopeNodeSize = { width: 224, height: 48 };
export const MIN_SCOPE_NODE_SIZE: ScopeNodeSize = { width: 160, height: 48 };
export const MAX_SCOPE_NODE_SIZE: ScopeNodeSize = { width: 720, height: 360 };
export const MIN_CONTROL_NODE_SIZE: ScopeNodeSize = { width: 72, height: 24 };
export const DEFAULT_CUSTOM_WAVE_NODE_SIZE: ScopeNodeSize = { width: 372, height: 128 };
export const MIN_CUSTOM_WAVE_NODE_SIZE: ScopeNodeSize = { width: 220, height: 96 };
export const MAX_CUSTOM_WAVE_NODE_SIZE: ScopeNodeSize = { width: 720, height: 360 };

export type EditorPatchNode = Omit<PatchNode, 'type'> & {
  type: NodeType | null;
  expression?: string;
  compactPorts?: boolean;
  scopeSize?: ScopeNodeSize;
};

export interface ShaderNodeData extends Record<string, unknown> {
  patchNode: EditorPatchNode;
  audioMeter?: {
    input: number;
    output: number;
    envelope: number;
  };
  audioScope?: {
    samples: number[];
  };
  audioInput?: AudioInputState;
  midiInput?: MidiInputState;
  dspErrors?: string[];
  onParamChange: (nodeId: string, port: string, value: number) => void;
  onAudioInputDeviceChange?: (deviceId: string) => void;
  onAudioInputRefresh?: () => void;
  onMidiInputRefresh?: () => void;
  onCustomWaveChange?: (nodeId: string, customWave: NonNullable<PatchNode['customWave']>, historyKey?: string) => void;
  onExpressionChange?: (nodeId: string, expression: string) => void;
  onExpressionCommit?: (nodeId: string, expression: string) => void;
  onTypeChange: (nodeId: string, type: NodeType) => void;
  onSubpatchNameChange?: (nodeId: string, nextName: string) => void;
  onSampleSelect?: (nodeId: string) => void;
  onSampleDrop?: (nodeId: string, files: FileList) => void;
  onTypeEditStart: (nodeId: string) => void;
  onTypeEditEnd: () => void;
  onIdChange: (nodeId: string, nextId: string) => void;
  onPortDoubleClick: (nodeId: string, side: 'input' | 'output', port: string) => void;
  onPortNameChange: (nodeId: string, side: 'input' | 'output', port: string, nextPort: string) => void;
  onPortMove: (nodeId: string, side: 'input' | 'output', port: string, direction: -1 | 1) => void;
  onCompactToggle: (nodeId: string, compact: boolean) => void;
  onScopeResize: (nodeId: string, size: ScopeNodeSize, anchor: 'left' | 'right') => void;
  onSelectorInputAdd?: (nodeId: string) => void;
  onPortSelect?: (nodeId: string, side: 'input' | 'output', port: string) => void;
  selectedPort?: { side: 'input' | 'output'; name: string } | null;
  selectedLinkPorts?: { inputs: string[]; outputs: string[] };
  connectedPorts?: { inputs: string[]; outputs: string[] };
  previewPort?: { side: 'input' | 'output'; name: string } | null;
  isOnlySelected?: boolean;
  isConnecting?: boolean;
  isTypePickerOpen: boolean;
  isEditingSubpatch?: boolean;
}

export type ShaderFlowNode = Node<ShaderNodeData, 'shaderNode'>;

export interface ShaderEdgeData extends Record<string, unknown> {
  weight: number;
  mode: LinkMode;
  onWeightChange: (edgeId: string, weight: number) => void;
  onModeChange: (edgeId: string, mode: LinkMode) => void;
  onInsertNode: (edgeId: string) => void;
  showLinkControls?: boolean;
  isFeedback?: boolean;
  isControl?: boolean;
  dspErrors?: string[];
}

export type ShaderFlowEdge = Edge<ShaderEdgeData, 'shaderEdge'>;

export interface PersistedEditorState {
  version: 1;
  ui?: {
    patchName?: string;
    viewport?: {
      x: number;
      y: number;
      zoom: number;
    };
  };
  nodes: Array<{
    id: string;
    type: NodeType | null;
    subpatchName?: string;
    subpatchCloneId?: string;
    expression?: string;
    sample?: PatchNode['sample'];
    customWave?: PatchNode['customWave'];
    params: Record<string, number>;
    position: { x: number; y: number };
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
    subpatch?: Patch;
    compactPorts?: boolean;
    scopeSize?: ScopeNodeSize;
  }>;
  edges: Array<{
    id: string;
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
    weight?: number;
    mode?: LinkMode;
  }>;
}

type NodeCallbacks = Pick<
  ShaderNodeData,
  | 'onParamChange'
  | 'onCustomWaveChange'
  | 'onTypeChange'
  | 'onTypeEditStart'
  | 'onTypeEditEnd'
  | 'onIdChange'
  | 'onPortDoubleClick'
  | 'onPortNameChange'
  | 'onPortMove'
  | 'onCompactToggle'
  | 'onScopeResize'
  | 'onSelectorInputAdd'
>;

export function toFlowNodes(
  patch: Patch,
  callbacks: NodeCallbacks,
  editingTypeNodeId: string | null,
): ShaderFlowNode[] {
  return patch.nodes.map((patchNode) => ({
    id: patchNode.id,
    type: 'shaderNode',
    position: patchNode.position ?? { x: 0, y: 0 },
    data: {
      patchNode,
      ...callbacks,
      isTypePickerOpen: editingTypeNodeId === patchNode.id,
    },
  }));
}

export function toFlowEdges(
  patch: Patch,
  onWeightChange: ShaderEdgeData['onWeightChange'],
  onModeChange: ShaderEdgeData['onModeChange'],
  onInsertNode: ShaderEdgeData['onInsertNode'],
): ShaderFlowEdge[] {
  return patch.links.map((link) => edgeFromLink(link, onWeightChange, onModeChange, onInsertNode));
}

export function editorStateToFlowNodes(
  state: PersistedEditorState,
  callbacks: NodeCallbacks,
  editingTypeNodeId: string | null,
): ShaderFlowNode[] {
  const normalizedState = normalizePersistedState(state);
  return normalizedState.nodes.map((node) => ({
    id: node.id,
    type: 'shaderNode',
    position: node.position,
    data: {
      patchNode: {
        id: node.id,
        type: node.type,
        subpatchName: node.subpatchName,
        subpatchCloneId: node.subpatchCloneId,
        expression: node.expression,
        sample: node.sample,
        customWave: node.customWave ? normalizeCustomWave(node.customWave, node.params) : undefined,
        params: node.params,
        position: node.position,
        inputs: node.inputs,
        outputs: node.outputs,
        subpatch: node.subpatch,
        compactPorts: node.compactPorts,
        scopeSize: node.scopeSize,
      },
      ...callbacks,
      isTypePickerOpen: editingTypeNodeId === node.id,
    },
  }));
}

export function editorStateToFlowEdges(
  state: PersistedEditorState,
  onWeightChange: ShaderEdgeData['onWeightChange'],
  onModeChange: ShaderEdgeData['onModeChange'],
  onInsertNode: ShaderEdgeData['onInsertNode'],
): ShaderFlowEdge[] {
  const normalizedState = normalizePersistedState(state);
  return normalizedState.edges.map((edge) => ({
    ...edge,
    type: 'shaderEdge',
    data: {
      weight: edge.weight ?? 1,
      mode: edge.mode ?? 'set',
      onWeightChange,
      onModeChange,
      onInsertNode,
      isFeedback: edge.source === edge.target,
    },
    className: 'shader-edge',
  }));
}

export function flowToEditorState(
  nodes: ShaderFlowNode[],
  edges: ShaderFlowEdge[],
  ui?: PersistedEditorState['ui'],
): PersistedEditorState {
  return {
    version: 1,
    ...(ui ? { ui } : {}),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.patchNode.type,
      subpatchName: node.data.patchNode.subpatchName,
      subpatchCloneId: node.data.patchNode.subpatchCloneId,
      expression: node.data.patchNode.expression,
      sample: node.data.patchNode.sample,
      customWave: node.data.patchNode.customWave
        ? normalizeCustomWave(node.data.patchNode.customWave, node.data.patchNode.params)
        : undefined,
      params: node.data.patchNode.params,
      position: node.position,
      inputs: node.data.patchNode.inputs,
      outputs: node.data.patchNode.outputs,
      subpatch: node.data.patchNode.subpatch,
      compactPorts: node.data.patchNode.compactPorts,
      scopeSize: node.data.patchNode.scopeSize,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? 'set',
    })),
  };
}

export function clampScopeNodeSize(size: ScopeNodeSize): ScopeNodeSize {
  return {
    width: clampNumber(size.width, MIN_SCOPE_NODE_SIZE.width, MAX_SCOPE_NODE_SIZE.width),
    height: clampNumber(size.height, MIN_SCOPE_NODE_SIZE.height, MAX_SCOPE_NODE_SIZE.height),
  };
}

export function clampControlNodeSize(size: ScopeNodeSize): ScopeNodeSize {
  return {
    width: clampNumber(size.width, MIN_CONTROL_NODE_SIZE.width, MAX_SCOPE_NODE_SIZE.width),
    height: clampNumber(size.height, MIN_CONTROL_NODE_SIZE.height, MAX_SCOPE_NODE_SIZE.height),
  };
}

export function clampCustomWaveNodeSize(size: ScopeNodeSize): ScopeNodeSize {
  return {
    width: clampNumber(size.width, MIN_CUSTOM_WAVE_NODE_SIZE.width, MAX_CUSTOM_WAVE_NODE_SIZE.width),
    height: clampNumber(size.height, MIN_CUSTOM_WAVE_NODE_SIZE.height, MAX_CUSTOM_WAVE_NODE_SIZE.height),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function patchFromFlow(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[]): Patch {
  const typedNodeIds = new Set<string>();
  const passthroughNodeIds = new Set<string>();
  const patchNodes: PatchNode[] = [];

  for (const node of nodes) {
    const patchNode = node.data.patchNode;
    if (patchNode.type === null) {
      passthroughNodeIds.add(patchNode.id);
      continue;
    }

    typedNodeIds.add(patchNode.id);
    patchNodes.push({
      id: patchNode.id,
      type: patchNode.type,
      ...(patchNode.subpatchName ? { subpatchName: patchNode.subpatchName } : {}),
      ...(patchNode.subpatchCloneId ? { subpatchCloneId: patchNode.subpatchCloneId } : {}),
      ...(patchNode.expression !== undefined ? { expression: patchNode.expression } : {}),
      ...(patchNode.sample ? { sample: patchNode.sample } : {}),
      ...(patchNode.customWave ? { customWave: normalizeCustomWave(patchNode.customWave, patchNode.params) } : {}),
      params: patchNode.params,
      position: node.position,
      ...(patchNode.inputs ? { inputs: patchNode.inputs } : {}),
      ...(patchNode.outputs ? { outputs: patchNode.outputs } : {}),
      ...(patchNode.subpatch ? { subpatch: patchNode.subpatch } : {}),
    });
  }

  const links = edges
    .map(linkFromEdge)
    .filter((link): link is PatchLink => link !== null);

  return {
    nodes: patchNodes,
    links: materializeTypedLinks(links, typedNodeIds, passthroughNodeIds),
  };
}

export function edgeFromLink(
  link: PatchLink,
  onWeightChange: ShaderEdgeData['onWeightChange'],
  onModeChange: ShaderEdgeData['onModeChange'],
  onInsertNode: ShaderEdgeData['onInsertNode'],
): ShaderFlowEdge {
  return {
    id: edgeId(link),
    type: 'shaderEdge',
    source: link.from.node,
    sourceHandle: `out:${link.from.port}`,
    target: link.to.node,
    targetHandle: `in:${link.to.port}`,
    data: {
      weight: link.weight ?? 1,
      mode: link.mode ?? 'set',
      onWeightChange,
      onModeChange,
      onInsertNode,
      isFeedback: link.from.node === link.to.node,
    },
    className: 'shader-edge',
  };
}

export function linkFromEdge(edge: Edge): PatchLink | null {
  const sourcePort = parseHandle(edge.sourceHandle);
  const targetPort = parseHandle(edge.targetHandle);
  if (!sourcePort || !targetPort) return null;

  if (sourcePort.kind === 'out' && targetPort.kind === 'in') {
    return {
      from: { node: edge.source, port: sourcePort.port },
      to: { node: edge.target, port: targetPort.port },
      weight: edge.data?.weight as number | undefined,
      mode: edge.data?.mode as LinkMode | undefined,
    };
  }

  if (sourcePort.kind === 'in' && targetPort.kind === 'out') {
    return {
      from: { node: edge.target, port: targetPort.port },
      to: { node: edge.source, port: sourcePort.port },
      weight: edge.data?.weight as number | undefined,
      mode: edge.data?.mode as LinkMode | undefined,
    };
  }

  return null;
}

export function edgeId(link: PatchLink): string {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}

function materializeTypedLinks(
  links: PatchLink[],
  typedNodeIds: Set<string>,
  passthroughNodeIds: Set<string>,
): PatchLink[] {
  const outgoing = new Map<string, PatchLink[]>();
  for (const link of links) {
    outgoing.set(link.from.node, [...(outgoing.get(link.from.node) ?? []), link]);
  }

  const materialized: PatchLink[] = [];
  for (const link of links) {
    if (!typedNodeIds.has(link.from.node)) continue;

    if (typedNodeIds.has(link.to.node)) {
      materialized.push(link);
      continue;
    }

    if (!passthroughNodeIds.has(link.to.node)) continue;

    for (const downstream of resolvePassthroughLinks(link.to.node, outgoing, typedNodeIds, passthroughNodeIds, new Set())) {
      if (link.from.node === downstream.to.node) continue;
      materialized.push({
        from: link.from,
        to: downstream.to,
        weight: downstream.weight,
        mode: downstream.mode,
      });
    }
  }

  return dedupePatchLinks(materialized);
}

function resolvePassthroughLinks(
  nodeId: string,
  outgoing: Map<string, PatchLink[]>,
  typedNodeIds: Set<string>,
  passthroughNodeIds: Set<string>,
  visited: Set<string>,
): PatchLink[] {
  if (visited.has(nodeId)) return [];

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);
  const resolved: PatchLink[] = [];

  for (const link of outgoing.get(nodeId) ?? []) {
    if (typedNodeIds.has(link.to.node)) {
      resolved.push(link);
      continue;
    }

    if (passthroughNodeIds.has(link.to.node)) {
      resolved.push(...resolvePassthroughLinks(link.to.node, outgoing, typedNodeIds, passthroughNodeIds, nextVisited));
    }
  }

  return resolved;
}

function dedupePatchLinks(links: PatchLink[]): PatchLink[] {
  const deduped: PatchLink[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const key = edgeId(link);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function parseHandle(handle: string | null | undefined): { kind: 'in' | 'out'; port: string } | null {
  if (!handle) return null;
  const [kind, port] = handle.split(':');
  if ((kind !== 'in' && kind !== 'out') || !port) return null;
  return { kind, port };
}

function normalizePersistedState(state: PersistedEditorState): PersistedEditorState {
  const originalNodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const passthroughNodes = state.nodes.filter((node) => node.type === null);
  const typedPatch: Patch = {
    nodes: state.nodes
      .filter((node): node is PersistedEditorState['nodes'][number] & { type: NodeType } => node.type !== null)
      .map((node) => ({
        id: node.id,
        type: node.type,
        ...(node.subpatchName ? { subpatchName: node.subpatchName } : {}),
        ...(node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {}),
        ...(node.expression !== undefined ? { expression: node.expression } : {}),
        ...(node.sample ? { sample: node.sample } : {}),
        ...(node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {}),
        params: node.params,
        position: node.position,
        ...(node.inputs ? { inputs: node.inputs } : {}),
        ...(node.outputs ? { outputs: node.outputs } : {}),
        ...(node.subpatch ? { subpatch: node.subpatch } : {}),
      })),
    links: state.edges
      .map(patchLinkFromPersistedEdge)
      .filter((link): link is PatchLink => link !== null),
  };
  const migratedPatch = migratePatchForCompatibility(typedPatch);

  return {
    ...state,
    nodes: [
      ...migratedPatch.nodes.map((node) => persistedNodeFromPatchNode(node, originalNodesById.get(node.id))),
      ...passthroughNodes,
    ],
    edges: migratedPatch.links.map(persistedEdgeFromPatchLink),
  };
}

function patchLinkFromPersistedEdge(edge: PersistedEditorState['edges'][number]): PatchLink | null {
  const sourcePort = parseHandle(edge.sourceHandle);
  const targetPort = parseHandle(edge.targetHandle);
  if (!sourcePort || !targetPort || sourcePort.kind !== 'out' || targetPort.kind !== 'in') return null;
  return {
    from: { node: edge.source, port: sourcePort.port },
    to: { node: edge.target, port: targetPort.port },
    ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
    ...(edge.mode !== undefined ? { mode: edge.mode } : {}),
  };
}

function persistedNodeFromPatchNode(
  node: PatchNode,
  original?: PersistedEditorState['nodes'][number],
): PersistedEditorState['nodes'][number] {
  return {
    id: node.id,
    type: node.type,
    subpatchName: node.subpatchName,
    subpatchCloneId: node.subpatchCloneId,
    expression: node.expression,
    sample: node.sample,
    customWave: node.customWave,
    params: node.params,
    position: node.position ?? original?.position ?? { x: 0, y: 0 },
    inputs: node.inputs,
    outputs: node.outputs,
    subpatch: node.subpatch,
    compactPorts: original?.compactPorts,
    scopeSize: original?.scopeSize,
  };
}

function persistedEdgeFromPatchLink(link: PatchLink): PersistedEditorState['edges'][number] {
  return {
    id: edgeId(link),
    source: link.from.node,
    sourceHandle: `out:${link.from.port}`,
    target: link.to.node,
    targetHandle: `in:${link.to.port}`,
    weight: link.weight ?? 1,
    mode: link.mode ?? 'set',
  };
}
