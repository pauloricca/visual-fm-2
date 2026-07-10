import { getNodeDefinition } from './nodeTypes';
import type { NodeType, Patch, PatchLink, PatchNode, PortDefinition } from './types';

export function normalizePatchCompatibility(patch: Patch): Patch {
  const nodes = patch.nodes.map(normalizeCompatibleNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return {
    ...patch,
    nodes,
    links: patch.links
      .map((link) => normalizeCompatibleLink(link, nodeById))
      .filter((link): link is PatchLink => link !== null && linkPortsExist(link, nodeById)),
  };
}

function normalizeCompatibleNode(node: PatchNode): PatchNode {
  const params = normalizeLegacyNodeParams(node.type, node.params);
  const inputs = normalizeLegacyInputDefinitions(node.type, node.inputs);
  const outputs = normalizeLegacyOutputDefinitions(node.type, node.outputs);

  return {
    ...node,
    params,
    ...(inputs ? { inputs } : {}),
    ...(node.outputs ? { outputs } : {}),
    ...(node.subpatch ? { subpatch: normalizePatchCompatibility(node.subpatch) } : {}),
  };
}

function normalizeCompatibleLink(
  link: PatchLink,
  nodeById: Map<string, PatchNode>,
): PatchLink | null {
  const sourceNode = nodeById.get(link.from.node);
  if (sourceNode?.type === 'Reverb' && link.from.port === 'signal') {
    return {
      ...link,
      from: {
        ...link.from,
        port: 'left',
      },
    };
  }

  const targetNode = nodeById.get(link.to.node);
  if (targetNode?.type !== 'SamplePlayer' || link.to.port !== 'originalPitch') return link;
  return {
    ...link,
    to: {
      ...link.to,
      port: 'originalFrequency',
    },
  };
}

function linkPortsExist(link: PatchLink, nodeById: Map<string, PatchNode>): boolean {
  return (
    portExists(nodeById.get(link.from.node), 'outputs', link.from.port) &&
    portExists(nodeById.get(link.to.node), 'inputs', link.to.port)
  );
}

function portExists(
  node: PatchNode | undefined,
  side: 'inputs' | 'outputs',
  port: string,
): boolean {
  if (!node) return false;
  return getNodeDefinition(node)[side].some((entry) => entry.name === port);
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

function normalizeLegacyOutputDefinitions(type: NodeType, outputs: PortDefinition[] | undefined): PortDefinition[] | undefined {
  if (type !== 'Reverb') return outputs;
  const nextOutputs = outputs?.filter((output) => output.name !== 'signal');
  return nextOutputs && nextOutputs.length > 0 ? nextOutputs : undefined;
}

function midiNoteFrequency(note: number): number {
  return 440 * (2 ** ((note - 69) / 12));
}
