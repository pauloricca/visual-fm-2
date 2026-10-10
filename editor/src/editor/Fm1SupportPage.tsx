import support from '../../../firmware/fm1/support.json';
import { getNodeTypeLabel } from '../graph/nodeTypes';

const descriptions = {
  supported: 'Supported',
  partial: 'Partial',
  unsupported: 'Not supported',
  unknown: 'Not reviewed',
} as const;

function featureName(feature: typeof support.features[number]) {
  return feature.category === 'node' ? getNodeTypeLabel(feature.id as Parameters<typeof getNodeTypeLabel>[0]) : feature.id;
}

export function Fm1SupportPage() {
  const statusOrder: Record<string, number> = { supported: 0, partial: 1, unknown: 2, unsupported: 3 };
  const features = [...support.features].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
    || a.category.localeCompare(b.category)
    || featureName(a).localeCompare(featureName(b)));
  const counts = Object.fromEntries(Object.keys(descriptions).map(status => [
    status, features.filter(feature => feature.status === status).length,
  ])) as Record<keyof typeof descriptions, number>;

  return (
    <main className="fm1-support-page">
      <header className="fm1-support-header">
        <a className="fm1-support-back" href="/">← Back to Teia</a>
        <p className="fm1-support-eyebrow">Teia firmware compatibility</p>
        <h1>FM-1 feature support</h1>
        <p>Support status for <strong>{support.firmware}</strong>. A green tick means the feature is implemented within the limits shown.</p>
        <div className="fm1-support-counts" aria-label="Feature totals">
          <span><b className="fm1-support-mark is-supported" aria-hidden="true">✓</b>{counts.supported} supported</span>
          <span><b className="fm1-support-mark is-partial" aria-hidden="true">◐</b>{counts.partial} partial</span>
          <span><b className="fm1-support-mark is-unsupported" aria-hidden="true">×</b>{counts.unsupported} not supported</span>
          <span><b className="fm1-support-mark is-unknown" aria-hidden="true">?</b>{counts.unknown} not reviewed</span>
        </div>
      </header>
      <div className="fm1-support-table-wrap">
        <table className="fm1-support-table">
          <thead><tr><th scope="col">Feature</th><th scope="col">Status</th><th scope="col">First firmware</th><th scope="col">Details and limitations</th></tr></thead>
          <tbody>{features.map(feature => (
            <tr key={`${feature.category}:${feature.id}`}>
              <th scope="row"><span className="fm1-support-category">{feature.category}</span>{featureName(feature)}</th>
              <td><span className={`fm1-support-status is-${feature.status}`} role="img" aria-label={descriptions[feature.status as keyof typeof descriptions]} title={descriptions[feature.status as keyof typeof descriptions]}>
                <span className={`fm1-support-mark is-${feature.status}`} aria-hidden="true">{feature.status === 'supported' ? '✓' : feature.status === 'partial' ? '◐' : feature.status === 'unsupported' ? '×' : '?'}</span>
              </span></td>
              <td>{feature.since ? `FM-1_${feature.since}` : 'Not established'}</td>
              <td>
                <span>{feature.notes}</span>
                {feature.category === 'node' && (feature.blockedInputs ?? []).length > 0 && <span className="fm1-support-restriction">Blocked inputs: {(feature.blockedInputs ?? []).join(', ')}.</span>}
                {feature.category === 'node' && (feature.blockedOutputs ?? []).length > 0 && <span className="fm1-support-restriction">Blocked outputs: {(feature.blockedOutputs ?? []).join(', ')}.</span>}
                {feature.drift && <span className="fm1-support-drift">Web: {feature.drift.webBehavior} Firmware: {feature.drift.firmwareBehavior} Work needed: {feature.drift.requiredWork}</span>}
                <span className="fm1-support-verification">Evidence: {feature.verification}</span>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <footer className="fm1-support-footer">
        The table is generated from the same capability registry used by FM-1 export and upload checks. Support describes implementation; evidence separately identifies whether it has been checked on a host or device. A device connection confirms package format, not support for every instruction.
      </footer>
    </main>
  );
}
