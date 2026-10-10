import { useEffect, useMemo, useRef, useState } from 'react';
import type { Patch } from '../graph/types';
import { analyzeFm1Patch, fm1Limits, fm1MaximumBytes } from '../audio/fm1Package';
import { checkFm1Connection, fm1BrowserError, uploadFm1Patch } from '../audio/fm1Upload';
import { fm1SupportFirmware, getFm1SupportWarnings } from '../audio/fm1Support';

export function Fm1UploadDialog({ patch, onClose }: { patch: Patch; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const presetInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const analysis = useMemo(() => analyzeFm1Patch(patch), [patch]);
  const warnings = useMemo(() => getFm1SupportWarnings(patch), [patch]);
  const [preset, setPreset] = useState('1');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const browserError = fm1BrowserError();
  const number = Number(preset);
  const validPreset = preset.trim() !== '' && Number.isInteger(number) && number >= 1 && number <= 2;
  useEffect(() => {
    dialog.current?.showModal();
    presetInput.current?.focus();
    return () => { controller.current?.abort(); };
  }, []);
  const rows = [
    ['Compiled operations', analysis.usage?.operations, fm1Limits.operations],
    ['Registers', analysis.usage?.registers, fm1Limits.registers],
    ['Parameter / constant values', analysis.usage?.values, fm1Limits.values],
    ['DSP state entries', analysis.usage?.states, fm1Limits.states],
    ['Package size (bytes)', analysis.usage?.bytes, fm1MaximumBytes],
  ] as const;
  const upload = async (checkOnly = false) => {
    if (controller.current || (!checkOnly && (!analysis.compiled || !validPreset))) return;
    const active = new AbortController(); controller.current = active;
    setChecking(checkOnly); setBusy(true); setError(''); setMessage(''); setProgress(0);
    try {
      const report = (percent: number, status: string) => {
        if (!active.signal.aborted) { setProgress(percent); setMessage(status); }
      };
      if (checkOnly) await checkFm1Connection(report, active.signal);
      else await uploadFm1Patch(analysis.compiled!.bytes, number, report, active.signal);
    } catch (failure) {
      if (!active.signal.aborted) { setError(failure instanceof Error ? failure.message : String(failure)); setMessage(''); }
    } finally {
      controller.current = null;
      if (!active.signal.aborted) setBusy(false);
    }
  };
  return (
    <dialog ref={dialog} className="import-modal fm1-modal" aria-labelledby="fm1-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => { if (!busy && event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      } }}>
      <header className="import-modal-header">
        <div><h2 id="fm1-title">Upload to FM-1</h2><p>{patch.name || 'untitled'}</p></div>
        <button type="button" className="import-modal-close" onClick={onClose} disabled={busy} aria-label="Close FM-1 upload">X</button>
      </header>
      <div className="fm1-modal-body">
        {warnings.length > 0 && <section className="fm1-warnings" aria-labelledby="fm1-warnings-title">
          <h3 id="fm1-warnings-title">FM-1 compatibility warnings</h3>
          <p className="fm1-note">Based on {fm1SupportFirmware} support. All enabled nodes are checked, including unused nodes and group contents. Unsupported or unreviewed nodes block upload; partial support is checked against the available operations and ports. Disable or remove unavailable nodes to continue.</p>
          <ul>{warnings.map(warning => <li key={warning.feature}>
            <strong>{warning.feature} — {warning.status === 'unsupported' ? 'Not supported yet' : warning.status === 'partial' ? 'Partial support' : 'Support not verified'}</strong>
            <p>{warning.notes}</p>
            <p className="fm1-note">Nodes: {warning.nodes.join('; ')}</p>
          </li>)}</ul>
        </section>}
        <dl className="fm1-usage" aria-label="FM-1 patch limits">
          {rows.map(([label, used, maximum]) => (
            <div key={label} className={used !== undefined && used > maximum ? 'fm1-over-limit' : ''}>
              <dt>{label}</dt><dd>{used ?? '—'} / {maximum}</dd>
              <progress max={maximum} value={used ?? 0} aria-label={label} />
            </div>
          ))}
        </dl>
        <p className="fm1-note">These are memory limits. Check render time and late buffers on the device for audio performance.</p>
        {analysis.errors.length > 0 && <div className="fm1-errors" role="alert"><strong>Patch cannot be uploaded</strong><ul>{analysis.errors.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
        {browserError && <p className="fm1-errors" role="alert">{browserError}</p>}
        <label className="fm1-preset" htmlFor="fm1-preset">Preset number
          <input ref={presetInput} id="fm1-preset" type="number" min="1" max="2" step="1" value={preset} disabled={busy}
            aria-invalid={!validPreset} aria-describedby="fm1-preset-help" onChange={event => { setPreset(event.target.value); setError(''); setMessage(''); }} />
        </label>
        <p id="fm1-preset-help" className="fm1-note">Choose 1 or 2. Upload replaces that preset and selects it. Patches are cleared when the FM-1 powers off.</p>
        {!validPreset && <p className="fm1-errors">Enter preset 1 or 2.</p>}
        <p className="fm1-note">Connect the Teia FM-1 by USB. The support rules target {fm1SupportFirmware}. Older builds may lack required operations even when their package format is compatible. Allow MIDI SysEx access when prompted.</p>
        {busy && <progress className="fm1-transfer-progress" value={progress} max={100} aria-label="Patch upload progress" />}
        <div aria-live="polite" aria-atomic="true">{message && <p>{message}</p>}</div>
        {error && <p className="fm1-errors" role="alert">{error}</p>}
      </div>
      <footer className="import-modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" onClick={() => void upload(true)} disabled={busy || Boolean(browserError)}>{busy && checking ? 'Checking…' : 'Check connection'}</button>
        <button type="button" onClick={() => void upload()} disabled={busy || !analysis.compiled || !validPreset || Boolean(browserError)}>{busy && !checking ? `Uploading ${progress}%` : 'Upload'}</button>
      </footer>
    </dialog>
  );
}
