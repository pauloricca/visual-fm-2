import { normalizeCustomWave } from './customWave';
import type { NodeType, Patch, PatchLink, PatchNode } from './types';

const OSCILLATOR_NODE_TYPES = new Set<NodeType>([
  'SineOsc',
  'TriangleOsc',
  'SawOsc',
  'RampOsc',
  'SquareOsc',
  'SampleHoldOsc',
]);

const LEGACY_RATIO_NODE_TYPES = new Set<NodeType>([
  'SineOsc',
  'TriangleOsc',
  'SawOsc',
  'RampOsc',
  'SquareOsc',
  'CustomWave',
  'SamplePlayer',
]);

const LEGACY_SOURCE_LEVEL_NODE_TYPES = new Set<NodeType>([
  ...OSCILLATOR_NODE_TYPES,
  'CustomWave',
  'PerlinNoise',
  'Noise',
]);

const LEGACY_CUSTOM_WAVE_PARAM_NAMES = new Set(['mode', 'sustainStart', 'sustainEnd']);

const FILTER_TYPES: NodeType[] = ['LowpassFilter', 'HighpassFilter', 'BandpassFilter'];

const DISTORTION_TYPES: NodeType[] = [
  'HardClipDistortion',
  'SoftClipDistortion',
  'FuzzDistortion',
  'SaturateDistortion',
  'WavefoldDistortion',
];

export function migratePatchForCompatibility(patch: Patch): Patch {
  const migratedNodes = patch.nodes.map(migratePatchNodeShallow);
  const normalizedTypeById = new Map(migratedNodes.map((node) => [node.id, node.type]));
  const hasLegacyLevelInput = new Set(
    migratedNodes
      .filter((node) => LEGACY_SOURCE_LEVEL_NODE_TYPES.has(node.type))
      .map((node) => node.id),
  );
  const links = patch.links.map((link) => migratePatchLink(link, normalizedTypeById));
  const patchWithSampleHoldSources = applyLegacySampleHoldSources({
    ...(patch.name ? { name: patch.name } : {}),
    nodes: migratedNodes,
    links,
  });
  return applyLegacySourceLevelGains(patchWithSampleHoldSources, hasLegacyLevelInput);
}

function migratePatchNodeShallow(node: PatchNode): PatchNode {
  const type = migrateNodeType(node);
  const params = migrateNodeParams(node, type);
  const subpatch = node.subpatch ? migratePatchForCompatibility(node.subpatch) : undefined;
  const customWave = type === 'CustomWave'
    ? normalizeCustomWave(node.customWave, node.params)
    : node.customWave;

  return {
    ...node,
    type,
    params,
    ...(customWave ? { customWave } : {}),
    ...(subpatch ? { subpatch } : {}),
  };
}

function migrateNodeType(node: PatchNode): NodeType {
  if (node.type === 'LinkNoise') return 'Gain';
  if (node.type === 'Filter') {
    return FILTER_TYPES[clampIndex(Math.round(node.params.type ?? 1) - 1, FILTER_TYPES.length)] ?? 'LowpassFilter';
  }
  if (node.type === 'Distortion') {
    return DISTORTION_TYPES[clampIndex(Math.round(node.params.type ?? 2) - 1, DISTORTION_TYPES.length)] ?? 'SoftClipDistortion';
  }
  return node.type;
}

function migrateNodeParams(node: PatchNode, type: NodeType): Record<string, number> {
  const params = node.params;
  if (node.type === 'LinkNoise') {
    return { gain: 1 };
  }

  const migrated = { ...params };
  delete migrated.type;

  if (LEGACY_RATIO_NODE_TYPES.has(type)) {
    const ratio = finiteNumber(migrated.ratio, 1);
    if (ratio !== 1 && Number.isFinite(migrated.frequency)) {
      migrated.frequency *= ratio;
    }
    delete migrated.ratio;
  }

  if (type === 'CustomWave') {
    for (const name of LEGACY_CUSTOM_WAVE_PARAM_NAMES) {
      delete migrated[name];
    }
  }

  return migrated;
}

function migratePatchLink(link: PatchLink, typeById: Map<string, NodeType>): PatchLink {
  const targetType = typeById.get(link.to.node);
  const targetPort = link.to.port === 'signal' && targetType === 'AudioOut'
    ? 'both'
    : (link.to.port === 'frequency' || link.to.port === 'ratio') && targetType === 'SampleHoldOsc'
      ? 'trigger'
    : link.to.port === 'ratio' && targetType && LEGACY_RATIO_NODE_TYPES.has(targetType)
      ? 'frequency'
      : link.to.port;

  return {
    ...link,
    from: { ...link.from },
    to: { ...link.to, port: targetPort },
  };
}

function applyLegacySampleHoldSources(patch: Patch): Patch {
  const sampleHoldNodes = patch.nodes.filter((node) => (
    node.type === 'SampleHoldOsc' &&
    (node.params.frequency !== undefined || node.params.ratio !== undefined)
  ));
  if (sampleHoldNodes.length === 0) return patch;

  const existingIds = new Set(patch.nodes.map((node) => node.id));
  const legacySampleHoldIds = new Set(sampleHoldNodes.map((node) => node.id));
  const nodes: PatchNode[] = patch.nodes.map((node) => {
    if (!legacySampleHoldIds.has(node.id)) return node;
    const { frequency: _frequency, ratio: _ratio, phase: _phase, phaseReset: _phaseReset, ...params } = node.params;
    return { ...node, params };
  });
  const links: PatchLink[] = [...patch.links];

  for (const node of sampleHoldNodes) {
    const hasSignalInput = links.some((link) => link.to.node === node.id && link.to.port === 'signal');
    const hasTriggerInput = links.some((link) => (
      link.to.node === node.id &&
      (link.to.port === 'trigger' || link.to.port === 'frequency' || link.to.port === 'ratio')
    ));

    if (!hasSignalInput) {
      const noiseId = uniqueNodeId(`${node.id}_noise`, existingIds);
      existingIds.add(noiseId);
      nodes.push({
        id: noiseId,
        type: 'Noise',
        params: {},
        position: node.position ? { x: node.position.x - 220, y: node.position.y - 60 } : undefined,
      });
      links.push({
        from: { node: noiseId, port: 'signal' },
        to: { node: node.id, port: 'signal' },
        weight: 1,
        mode: 'set',
      });
    }

    if (!hasTriggerInput) {
      const triggerId = uniqueNodeId(`${node.id}_trigger`, existingIds);
      existingIds.add(triggerId);
      nodes.push({
        id: triggerId,
        type: 'SquareOsc',
        params: {
          frequency: finiteNumber(node.params.frequency, 10) * finiteNumber(node.params.ratio, 1),
          phase: finiteNumber(node.params.phase, 0),
          phaseReset: finiteNumber(node.params.phaseReset, 0),
        },
        position: node.position ? { x: node.position.x - 220, y: node.position.y + 60 } : undefined,
      });
      links.push({
        from: { node: triggerId, port: 'signal' },
        to: { node: node.id, port: 'trigger' },
        weight: 1,
        mode: 'set',
      });
    }
  }

  return {
    ...patch,
    nodes,
    links: dedupePatchLinks(links),
  };
}

function applyLegacySourceLevelGains(patch: Patch, nodesWithLegacyLevelInput: Set<string>): Patch {
  const gainNodes: PatchNode[] = [];
  const levelGainByNodeId = new Map<string, string>();
  const existingIds = new Set(patch.nodes.map((node) => node.id));
  const hasIncomingLevel = new Set(
    patch.links
      .filter((link) => link.to.port === 'level' && nodesWithLegacyLevelInput.has(link.to.node))
      .map((link) => link.to.node),
  );

  const nodes = patch.nodes.map((node) => {
    if (!nodesWithLegacyLevelInput.has(node.id)) return node;

    const level = finiteNumber(node.params.level, 1);
    const needsGain = level !== 1 || hasIncomingLevel.has(node.id);
    const { level: _legacyLevel, ...params } = node.params;
    const nextNode = { ...node, params };
    if (!needsGain) return nextNode;

    const gainId = uniqueNodeId(`${node.id}_level`, existingIds);
    existingIds.add(gainId);
    levelGainByNodeId.set(node.id, gainId);
    gainNodes.push({
      id: gainId,
      type: 'Gain',
      params: { gain: level },
      position: node.position ? { x: node.position.x + 180, y: node.position.y } : undefined,
    });
    return nextNode;
  });

  if (gainNodes.length === 0) {
    return { ...patch, nodes };
  }

  const links: PatchLink[] = [];
  for (const link of patch.links) {
    const levelGainId = levelGainByNodeId.get(link.to.node);
    if (levelGainId && link.to.port === 'level') {
      links.push({
        ...link,
        to: { node: levelGainId, port: 'gain' },
      });
      continue;
    }

    const sourceGainId = levelGainByNodeId.get(link.from.node);
    if (sourceGainId && link.from.port === 'signal') {
      links.push({
        ...link,
        from: { node: sourceGainId, port: 'signal' },
      });
      continue;
    }

    links.push(link);
  }

  for (const [sourceId, gainId] of levelGainByNodeId) {
    links.push({
      from: { node: sourceId, port: 'signal' },
      to: { node: gainId, port: 'signal' },
      weight: 1,
      mode: 'set',
    });
  }

  return {
    ...patch,
    nodes: [...nodes, ...gainNodes],
    links: dedupePatchLinks(links),
  };
}

function uniqueNodeId(baseId: string, existingIds: Set<string>): string {
  let nextId = baseId;
  let suffix = 1;
  while (existingIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}_${suffix}`;
  }
  return nextId;
}

function dedupePatchLinks(links: PatchLink[]): PatchLink[] {
  const deduped: PatchLink[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const key = `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clampIndex(value: number, length: number): number {
  return Math.min(length - 1, Math.max(0, value));
}
