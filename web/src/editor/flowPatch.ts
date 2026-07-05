import type { Edge, Node } from '@xyflow/react';
import type { LinkMode, NodeType, Patch, PatchLink, PatchNode, PortDefinition } from '../graph/types';

export type EditorPatchNode = Omit<PatchNode, 'type'> & {
  type: NodeType | null;
  expression?: string;
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
  onParamChange: (nodeId: string, port: string, value: number) => void;
  onExpressionChange?: (nodeId: string, expression: string) => void;
  onExpressionCommit?: (nodeId: string, expression: string) => void;
  onTypeChange: (nodeId: string, type: NodeType) => void;
  onSubpatchNameChange?: (nodeId: string, nextName: string) => void;
  onTypeEditStart: (nodeId: string) => void;
  onTypeEditEnd: () => void;
  onIdChange: (nodeId: string, nextId: string) => void;
  onPortDoubleClick: (nodeId: string, side: 'input' | 'output', port: string) => void;
  onPortNameChange: (nodeId: string, side: 'input' | 'output', port: string, nextPort: string) => void;
  onPortMove: (nodeId: string, side: 'input' | 'output', port: string, direction: -1 | 1) => void;
  onPortSelect?: (nodeId: string, side: 'input' | 'output', port: string) => void;
  selectedPort?: { side: 'input' | 'output'; name: string } | null;
  selectedLinkPorts?: { inputs: string[]; outputs: string[] };
  previewPort?: { side: 'input' | 'output'; name: string } | null;
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
    params: Record<string, number>;
    position: { x: number; y: number };
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
    subpatch?: Patch;
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
  | 'onTypeChange'
  | 'onTypeEditStart'
  | 'onTypeEditEnd'
  | 'onIdChange'
  | 'onPortDoubleClick'
  | 'onPortNameChange'
  | 'onPortMove'
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
        params: node.params,
        position: node.position,
        inputs: node.inputs,
        outputs: node.outputs,
        subpatch: node.subpatch,
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
      params: node.data.patchNode.params,
      position: node.position,
      inputs: node.data.patchNode.inputs,
      outputs: node.data.patchNode.outputs,
      subpatch: node.data.patchNode.subpatch,
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
  const audioOutIds = new Set(
    state.nodes
      .filter((node) => node.type === 'AudioOut')
      .map((node) => node.id),
  );

  return {
    ...state,
    nodes: state.nodes.map(normalizePersistedNode),
    edges: state.edges.map((edge) => {
      if (!audioOutIds.has(edge.target) || edge.targetHandle !== 'in:signal') {
        return edge;
      }

      return {
        ...edge,
        targetHandle: 'in:both',
        id: edge.id.replace(/->([^:]+):signal$/, '->$1:both'),
      };
    }),
  };
}

function normalizePersistedNode(node: PersistedEditorState['nodes'][number]): PersistedEditorState['nodes'][number] {
  if (node.type === 'LinkNoise') {
    return {
      ...node,
      type: 'Gain',
      params: { gain: 1 },
    };
  }

  if (node.type === 'Filter') {
    const filterType = Math.round(node.params.type ?? 1);
    const { type: _oldType, ...params } = node.params;
    return {
      ...node,
      type: filterType === 2
        ? 'HighpassFilter'
        : filterType === 3
          ? 'BandpassFilter'
          : 'LowpassFilter',
      params,
    };
  }

  if (node.type === 'Distortion') {
    const distortionType = Math.round(node.params.type ?? 2);
    const { type: _oldType, ...params } = node.params;
    return {
      ...node,
      type: distortionType === 1
        ? 'HardClipDistortion'
        : distortionType === 3
          ? 'FuzzDistortion'
          : distortionType === 4
            ? 'SaturateDistortion'
            : distortionType === 5
              ? 'WavefoldDistortion'
              : 'SoftClipDistortion',
      params,
    };
  }

  return node;
}
