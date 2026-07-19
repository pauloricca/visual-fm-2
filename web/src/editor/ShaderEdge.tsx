import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LinkMode } from '../graph/types';
import { useEdgeOverlayTarget } from './EdgeOverlayContext';
import type { ShaderFlowEdge } from './flowPatch';
import { formatNumericValue } from './numericDisplay';

const LINK_CONTROLS_SHOW_DELAY_MS = 260;
const FEEDBACK_CURVE_OFFSET = 142;
const SAME_NODE_FEEDBACK_CURVE_OFFSET = 220;
const SHORT_LINK_CONTROLS_DISTANCE = 144;
const SHORT_LINK_CONTROLS_OFFSET = 52;

export function ShaderEdge(props: EdgeProps<ShaderFlowEdge>) {
  const [linkControlsVisible, setLinkControlsVisible] = useState(false);
  const isSameNodeFeedback = props.source === props.target;
  const isFeedback = props.data?.isFeedback === true || isSameNodeFeedback;
  const isControl = props.data?.isControl === true;
  const [defaultEdgePath, defaultLabelX, defaultLabelY] = getBezierPath(props);
  const [edgePath, labelX, labelY] = isFeedback
    ? getFeedbackPath(props, isSameNodeFeedback ? SAME_NODE_FEEDBACK_CURVE_OFFSET : FEEDBACK_CURVE_OFFSET)
    : [defaultEdgePath, defaultLabelX, defaultLabelY];
  const overlayTarget = useEdgeOverlayTarget();
  const reactFlow = useReactFlow();
  const viewport = useViewport();
  const screenPosition = reactFlow.flowToScreenPosition({ x: labelX, y: labelY });
  const weight = props.data?.weight ?? 1;
  const mode = props.data?.mode ?? 'set';
  const enabled = props.data?.enabled !== false;
  const dspErrors = props.data?.dspErrors ?? [];
  const hasDspErrors = dspErrors.length > 0;
  const selected = props.selected ?? false;
  const showLinkControls = selected && props.data?.showLinkControls === true;
  const controlsLabelY = shouldRaiseLinkControls(props, isFeedback)
    ? labelY - SHORT_LINK_CONTROLS_OFFSET
    : labelY;
  const underlayClassName = [
    'shader-edge-path',
    'shader-edge-path-underlay',
    `shader-edge-path-mode-${mode}`,
    isFeedback ? 'shader-edge-path-feedback' : '',
    isControl ? 'shader-edge-path-control' : '',
    enabled ? '' : 'shader-edge-path-disabled',
    hasDspErrors ? 'shader-edge-path-dsp-error' : '',
  ].join(' ');
  const edgeClassName = [
    'shader-edge-path',
    'shader-edge-path-foreground',
    `shader-edge-path-mode-${mode}`,
    isFeedback ? 'shader-edge-path-feedback' : '',
    isControl ? 'shader-edge-path-control' : '',
    enabled ? '' : 'shader-edge-path-disabled',
    hasDspErrors ? 'shader-edge-path-dsp-error' : '',
    selected ? 'shader-edge-path-selected' : '',
  ].filter(Boolean).join(' ');
  const selectedUnderlayStyle = selected
    ? { stroke: 'var(--color-edge-underlay)', strokeWidth: 8 }
    : undefined;
  const selectedForegroundStyle = selected
    ? { strokeWidth: 4 }
    : undefined;

  useEffect(() => {
    if (!showLinkControls) {
      setLinkControlsVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setLinkControlsVisible(true), LINK_CONTROLS_SHOW_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [showLinkControls]);

  return (
    <>
      <BaseEdge
        id={`${props.id}-underlay`}
        path={edgePath}
        className={underlayClassName}
        style={selectedUnderlayStyle}
        interactionWidth={0}
        aria-hidden="true"
      />
      <BaseEdge
        id={props.id}
        path={edgePath}
        className={edgeClassName}
        style={selectedForegroundStyle}
        interactionWidth={isSameNodeFeedback ? 44 : isFeedback ? 36 : 18}
      />
      {showLinkControls && linkControlsVisible && overlayTarget ? (
        createPortal(
          <div
            className="edge-weight-label nodrag nopan"
            style={{
              left: screenPosition.x,
              top: reactFlow.flowToScreenPosition({ x: labelX, y: controlsLabelY }).y,
              transform: `translate(-50%, -50%) scale(${viewport.zoom})`,
            }}
          >
            <EdgeLinkControls
              value={weight}
              mode={mode}
              enabled={enabled}
              onChange={(nextWeight) => props.data?.onWeightChange(props.id, nextWeight)}
              onModeChange={(nextMode) => props.data?.onModeChange(props.id, nextMode)}
              onEnabledChange={(nextEnabled) => props.data?.onEnabledChange?.(props.id, nextEnabled)}
            />
          </div>,
          overlayTarget,
        )
      ) : null}
      {hasDspErrors && overlayTarget ? (
        createPortal(
          <div
            className="edge-error-label"
            style={{
              left: screenPosition.x,
              top: screenPosition.y,
              transform: `translate(-50%, calc(-50% - 18px)) scale(${viewport.zoom})`,
            }}
            title={dspErrors.join('\n')}
            aria-label={`${dspErrors.length} DSP error${dspErrors.length === 1 ? '' : 's'}`}
          >
            !
          </div>,
          overlayTarget,
        )
      ) : null}
    </>
  );
}

function shouldRaiseLinkControls(props: EdgeProps<ShaderFlowEdge>, isFeedback: boolean): boolean {
  if (isFeedback) return false;

  return Math.hypot(props.targetX - props.sourceX, props.targetY - props.sourceY)
    < SHORT_LINK_CONTROLS_DISTANCE;
}

function getFeedbackPath(
  props: EdgeProps<ShaderFlowEdge>,
  minimumOffset: number,
): [string, number, number] {
  const sourceX = props.sourceX;
  const sourceY = props.sourceY;
  const targetX = props.targetX;
  const targetY = props.targetY;

  if (props.source === props.target) {
    return getSameNodeFeedbackPath(props, minimumOffset);
  }

  const horizontalDistance = Math.abs(sourceX - targetX);
  const verticalDistance = Math.abs(sourceY - targetY);
  const offset = Math.max(minimumOffset, horizontalDistance * 0.8 + verticalDistance * 0.2);
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${sourceY}`,
    `${targetX - offset},${targetY}`,
    `${targetX},${targetY}`,
  ].join(' ');

  return [
    path,
    (sourceX + targetX) / 2,
    (sourceY + targetY) / 2,
  ];
}

function getSameNodeFeedbackPath(
  props: EdgeProps<ShaderFlowEdge>,
  minimumOffset: number,
): [string, number, number] {
  const sourceX = props.sourceX;
  const sourceY = props.sourceY;
  const targetX = props.targetX;
  const targetY = props.targetY;
  const horizontalDistance = Math.abs(sourceX - targetX);
  const verticalDistance = Math.abs(sourceY - targetY);
  const offset = Math.max(minimumOffset * 0.36, horizontalDistance * 0.34 + verticalDistance * 0.12);
  const bow = Math.min(32, Math.max(16, verticalDistance * 0.2 + 16));
  const controlY = Math.min(sourceY, targetY) - bow;
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${controlY}`,
    `${targetX - offset},${controlY}`,
    `${targetX},${targetY}`,
  ].join(' ');

  return [
    path,
    (sourceX + targetX) / 2,
    (controlY + sourceY + targetY) / 3,
  ];
}

interface EdgeLinkControlsProps {
  value: number;
  mode: LinkMode;
  enabled: boolean;
  onChange: (value: number) => void;
  onModeChange: (mode: LinkMode) => void;
  onEnabledChange: (enabled: boolean) => void;
}

function EdgeLinkControls({ value, mode, enabled, onChange, onModeChange, onEnabledChange }: EdgeLinkControlsProps) {
  return (
    <>
      <div className="edge-link-value-row">
        <EdgeWeightScrubber value={value} onChange={onChange} />
        <button
          className={`edge-link-enabled-toggle nodrag nopan${enabled ? ' edge-link-enabled-toggle-active' : ''}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEnabledChange(!enabled);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={enabled ? 'Disable link' : 'Enable link'}
          aria-pressed={enabled}
          title={enabled ? 'Disable link' : 'Enable link'}
        />
      </div>
      <select
        className="edge-link-mode nodrag nopan"
        value={mode}
        onChange={(event) => {
          onModeChange(event.target.value as LinkMode);
          event.currentTarget.blur();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label="Link mode"
        title="Link mode"
      >
        <option value="set">set</option>
        <option value="add">add</option>
        <option value="multiply">multiply</option>
      </select>
    </>
  );
}

interface EdgeWeightScrubberProps {
  value: number;
  onChange: (value: number) => void;
}

export function EdgeWeightScrubber({ value, onChange }: EdgeWeightScrubberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatNumericValue(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    anchorY: number;
    anchorValue: number;
    currentValue: number;
    step: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(formatNumericValue(value));
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;

    setDraft(formatNumericValue(value));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editing, value]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      anchorY: event.clientY,
      anchorValue: value,
      currentValue: value,
      step: scrubberStep(event),
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = drag.anchorY - event.clientY;
    if (!drag.dragging && Math.abs(distance) < 3) return;

    drag.dragging = true;
    event.preventDefault();
    event.stopPropagation();

    const step = scrubberStep(event);
    if (step !== drag.step) {
      drag.anchorY = event.clientY;
      drag.anchorValue = drag.currentValue;
      drag.step = step;
    }

    const nextValue = roundValue(drag.anchorValue + (drag.anchorY - event.clientY) * drag.step);
    drag.currentValue = nextValue;
    onChange(nextValue);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (drag.dragging) {
      event.currentTarget.blur();
    } else {
      setEditing(true);
    }
  }

  function commitDraft() {
    const nextValue = Number(draft.trim());
    if (Number.isFinite(nextValue)) {
      onChange(nextValue);
    } else {
      setDraft(formatNumericValue(value));
    }
    setEditing(false);
  }

  function cancelDraft() {
    setDraft(formatNumericValue(value));
    setEditing(false);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      commitDraft();
    }
    if (event.key === 'Escape') {
      cancelDraft();
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="edge-weight-scrubber edge-weight-scrubber-editing nodrag nopan"
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={handleEditKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        spellCheck={false}
      />
    );
  }

  return (
    <div
      className="edge-weight-scrubber nodrag nopan"
      role="spinbutton"
      tabIndex={-1}
      aria-valuenow={value}
      onPointerDown={startDrag}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {formatNumericValue(value)}
    </div>
  );
}

function roundValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function scrubberStep(event: { metaKey: boolean; shiftKey: boolean }): number {
  if (event.metaKey && event.shiftKey) return 2;
  if (event.metaKey) return 0.2;
  if (event.shiftKey) return 0.001;
  return 0.01;
}
