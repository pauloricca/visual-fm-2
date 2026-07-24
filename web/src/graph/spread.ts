import type { Patch, PatchLink, PatchNode } from './types';

export const DEFAULT_SPREAD_SIZE = { width: 320, height: 220 } as const;
export const SPREAD_HEADER_HEIGHT = 32;
export const SPREAD_PORTS_HEIGHT = 44;

export interface SpreadExpansion {
  patch: Patch;
  errors: string[];
}

export function expandSpreads(patch: Patch): SpreadExpansion {
  let expanded = patch;
  const errors: string[] = [];
  const spreads = patch.nodes.filter(isRuntimeContainer);
  const memberships = new Map<string, string[]>();

  for (const spread of spreads) {
    for (const node of patch.nodes) {
      if (!nodeIsInsideSpread(spread, node)) continue;
      memberships.set(node.id, [...(memberships.get(node.id) ?? []), spread.id]);
    }
  }
  for (const [nodeId, spreadIds] of memberships) {
    if (spreadIds.length > 1) {
      errors.push(`Node "${nodeId}" is inside multiple Spread/Spawn containers (${spreadIds.join(', ')}). Move it into exactly one container.`);
    }
  }
  if (errors.length > 0) return { patch, errors };

  for (const spread of spreads) {
    const result = expandOneSpread(expanded, spread.id);
    expanded = result.patch;
    errors.push(...result.errors);
  }

  return { patch: expanded, errors };
}

export function nodeIsInsideSpread(spread: PatchNode, node: PatchNode): boolean {
  if (!isRuntimeContainer(spread) || node.id === spread.id) return false;
  if (spread.spreadNodeIds) return spread.spreadNodeIds.includes(node.id);
  if (!spread.position || !node.position) return false;
  const size = spread.scopeSize ?? DEFAULT_SPREAD_SIZE;
  return (
    node.position.x >= spread.position.x
    && node.position.x < spread.position.x + size.width
    && node.position.y >= spread.position.y + SPREAD_HEADER_HEIGHT + SPREAD_PORTS_HEIGHT
    && node.position.y < spread.position.y + SPREAD_HEADER_HEIGHT + size.height
  );
}

function expandOneSpread(patch: Patch, spreadId: string): SpreadExpansion {
  const spread = patch.nodes.find((node) => node.id === spreadId && isRuntimeContainer(node));
  if (!spread) return { patch, errors: [] };

  const internalNodes = patch.nodes.filter((node) => nodeIsInsideSpread(spread, node));
  const internalIds = new Set(internalNodes.map((node) => node.id));
  const errors: string[] = [];

  for (const node of internalNodes) {
    if (isRuntimeContainer(node)) {
      errors.push(`${spread.type} "${spread.id}" cannot contain ${node.type} "${node.id}".`);
    } else if (node.type === 'Group') {
      errors.push(`${spread.type} "${spread.id}" cannot contain Group node "${node.id}" yet; place the Group's nodes directly in the ${spread.type}.`);
    }
  }

  const clonedNodes: PatchNode[] = [];
  for (const node of internalNodes) {
    if (isRuntimeContainer(node) || node.type === 'Group') continue;
    clonedNodes.push(cloneSpreadNode(node, spread.id, 0));
  }
  if (spread.type === 'Spread') {
    clonedNodes.push({
      id: spreadIndexNodeId(spread.id, 0),
      type: 'Constant',
      params: { value: 1 },
      runtimeSpread: { spreadId: spread.id, itemIndex: 0, originalNodeId: '__item_index__' },
    });
  }

  const links: PatchLink[] = [];
  for (const link of patch.links) {
    const sourceInternal = internalIds.has(link.from.node);
    const targetInternal = internalIds.has(link.to.node);
    const isIndexLink = spread.type === 'Spread' && link.from.node === spread.id && link.from.port === 'item index';
    const isInternalControlLink = sourceInternal
      && link.to.node === spread.id
      && link.to.port === (spread.type === 'Spread' ? 'count' : 'trigger');
    const isKillLink = spread.type === 'Spawn' && link.to.node === spread.id && link.to.port === 'kill trigger';

    if (isIndexLink && !targetInternal) {
      errors.push(`Spread "${spread.id}" item index can only link to nodes inside that Spread.`);
      continue;
    }
    if (isInternalControlLink) {
      errors.push(`${spread.type} "${spread.id}" ${spread.type === 'Spread' ? 'count' : 'trigger'} cannot be driven by a node inside the same ${spread.type}.`);
      continue;
    }
    if (isKillLink && !sourceInternal) {
      errors.push(`Spawn "${spread.id}" kill trigger can only be driven by a node inside that Spawn.`);
      continue;
    }

    if (isIndexLink) {
      links.push({
        ...cloneLink(link),
        from: { node: spreadIndexNodeId(spread.id, 0), port: 'signal' },
        to: { ...link.to, node: spreadCloneNodeId(spread.id, 0, link.to.node) },
      });
      continue;
    }

    if (!sourceInternal && !targetInternal) {
      links.push(cloneLink(link));
      continue;
    }

    links.push({
      ...cloneLink(link),
      from: sourceInternal
        ? { ...link.from, node: spreadCloneNodeId(spread.id, 0, link.from.node) }
        : { ...link.from },
      to: targetInternal
        ? { ...link.to, node: spreadCloneNodeId(spread.id, 0, link.to.node) }
        : { ...link.to },
    });
  }

  return {
    patch: {
      ...patch,
      nodes: [
        ...patch.nodes.filter((node) => !internalIds.has(node.id)),
        ...clonedNodes,
      ],
      links,
    },
    errors,
  };
}

function isRuntimeContainer(node: PatchNode): boolean {
  return node.type === 'Spread' || node.type === 'Spawn';
}

function cloneSpreadNode(node: PatchNode, spreadId: string, itemIndex: number): PatchNode {
  return {
    ...node,
    id: spreadCloneNodeId(spreadId, itemIndex, node.id),
    params: { ...node.params },
    ...(node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {}),
    ...(node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {}),
    ...(node.subpatch ? { subpatch: structuredClone(node.subpatch) } : {}),
    runtimeSpread: { spreadId, itemIndex, originalNodeId: node.id },
  };
}

function cloneLink(link: PatchLink): PatchLink {
  return {
    from: { ...link.from },
    to: { ...link.to },
    ...(link.weight !== undefined ? { weight: link.weight } : {}),
    ...(link.mode !== undefined ? { mode: link.mode } : {}),
    ...(link.enabled === false ? { enabled: false } : {}),
  };
}

function spreadCloneNodeId(spreadId: string, itemIndex: number, nodeId: string): string {
  return `${spreadId}__item_${itemIndex}__${nodeId}`;
}

function spreadIndexNodeId(spreadId: string, itemIndex: number): string {
  return `${spreadId}__item_${itemIndex}__index`;
}
