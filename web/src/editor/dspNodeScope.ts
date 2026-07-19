export function scopedDspNodeId(nodeId: string, groupIds: readonly string[]): string {
  return groupIds.length === 0 ? nodeId : `${groupIds.join('__')}__${nodeId}`;
}
