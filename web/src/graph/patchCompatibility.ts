import { getNodeDefinition } from './nodeTypes';
import type { NodeType, Patch, PatchLink, PatchNode, PortDefinition } from './types';

export function normalizePatchCompatibility(patch: Patch): Patch {
  const legacySelectorIds = new Set(
    patch.nodes
      .filter(isZeroBasedSelector)
      .map((node) => node.id),
  );
  const accumulatorIds = legacySelectorAccumulatorIds(patch, legacySelectorIds);
  const nodes = patch.nodes.map((node) => {
    const normalized = normalizeCompatibleNode(node, legacySelectorIds.has(node.id));
    return accumulatorIds.has(node.id) ? shiftAccumulatorSelectorRange(normalized) : normalized;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return {
    ...patch,
    nodes,
    links: patch.links
      .map((link) => normalizeCompatibleLink(link, nodeById, legacySelectorIds))
      .filter((link): link is PatchLink => link !== null && linkPortsExist(link, nodeById)),
  };
}

function normalizeCompatibleNode(node: PatchNode, isLegacySelector: boolean): PatchNode {
  const legacyParams = normalizeLegacyNodeParams(node.type, node.params);
  const legacyInputs = normalizeLegacyInputDefinitions(node.type, node.inputs);
  const { params, inputs } = isLegacySelector
    ? normalizeZeroBasedSelector(legacyParams, legacyInputs)
    : { params: legacyParams, inputs: legacyInputs };
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
  legacySelectorIds: Set<string>,
): PatchLink | null {
  let normalizedLink = link;
  if (legacySelectorIds.has(link.to.node) && isSelectorValuePort(link.to.port)) {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: String(Number(normalizedLink.to.port) + 1),
      },
    };
  }

  const sourceNode = nodeById.get(normalizedLink.from.node);
  if (sourceNode?.type === 'Reverb' && normalizedLink.from.port === 'signal') {
    normalizedLink = {
      ...normalizedLink,
      from: {
        ...normalizedLink.from,
        port: 'left',
      },
    };
  }

  const targetNode = nodeById.get(normalizedLink.to.node);
  if (targetNode?.type === 'Sequencer' && normalizedLink.to.port === 'tick') {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: 'signal',
      },
    };
  }

  if (targetNode?.type !== 'SamplePlayer' || normalizedLink.to.port !== 'originalPitch') return normalizedLink;
  return {
    ...normalizedLink,
    to: {
      ...normalizedLink.to,
      port: 'originalFrequency',
    },
  };
}

function isZeroBasedSelector(node: PatchNode): boolean {
  return node.type === 'Selector' && (
    node.inputs?.some((input) => input.name === '0') === true
    || Object.prototype.hasOwnProperty.call(node.params, '0')
  );
}

function normalizeZeroBasedSelector(
  params: Record<string, number>,
  inputs: PortDefinition[] | undefined,
): { params: Record<string, number>; inputs: PortDefinition[] | undefined } {
  const nextParams = Object.fromEntries(
    Object.entries(params).map(([name, value]) => (
      isSelectorValuePort(name) ? [String(Number(name) + 1), value] : [name, value]
    )),
  );
  if (Number.isFinite(nextParams.select)) nextParams.select += 1;

  return {
    params: nextParams,
    inputs: inputs?.map((input) => (
      isSelectorValuePort(input.name)
        ? { ...input, name: String(Number(input.name) + 1) }
        : input
    )),
  };
}

function legacySelectorAccumulatorIds(patch: Patch, legacySelectorIds: Set<string>): Set<string> {
  const nodesById = new Map(patch.nodes.map((node) => [node.id, node]));
  const ids = new Set<string>();

  for (const link of patch.links) {
    if (!legacySelectorIds.has(link.to.node) || link.to.port !== 'select' || link.from.port !== 'signal') continue;
    const source = nodesById.get(link.from.node);
    if (source?.type !== 'Accumulator') continue;

    const outgoing = patch.links.filter((candidate) => (
      candidate.from.node === source.id && candidate.from.port === 'signal'
    ));
    const onlySelectsLegacySelectors = outgoing.length > 0 && outgoing.every((candidate) => (
      legacySelectorIds.has(candidate.to.node) && candidate.to.port === 'select'
    ));
    const hasRangeInput = patch.links.some((candidate) => (
      candidate.to.node === source.id && (candidate.to.port === 'min' || candidate.to.port === 'max')
    ));
    if (onlySelectsLegacySelectors && !hasRangeInput) ids.add(source.id);
  }

  return ids;
}

function shiftAccumulatorSelectorRange(node: PatchNode): PatchNode {
  const shift = (value: number | undefined): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value + 1 : value
  );
  return {
    ...node,
    params: {
      ...node.params,
      ...(shift(node.params.min) !== undefined ? { min: shift(node.params.min) } : {}),
      ...(shift(node.params.max) !== undefined ? { max: shift(node.params.max) } : {}),
    },
    ...(node.inputs
      ? {
        inputs: node.inputs.map((input) => (
          input.name === 'min' || input.name === 'max'
            ? { ...input, ...(shift(input.defaultValue) !== undefined ? { defaultValue: shift(input.defaultValue) } : {}) }
            : input
        )),
      }
      : {}),
  };
}

function isSelectorValuePort(name: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(name);
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
