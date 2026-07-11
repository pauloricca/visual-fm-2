import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  CUSTOM_WAVE_MODES,
  customWaveUsesSustainEnd,
  customWaveUsesSustainStart,
  normalizeCustomWave,
} from '../graph/customWave';
import {
  getNodeDefinition,
  getNodeTypeLabel,
  NODE_TYPE_LIST,
  sequencerCellParamName,
  sequencerOutputName,
  sequencerShape,
} from '../graph/nodeTypes';
import type { CustomWaveMode, CustomWavePoint, CustomWaveSettings, NodeDefinition, NodeType, PatchNode } from '../graph/types';
import {
  clampControlNodeSize,
  clampCustomWaveNodeSize,
  clampScopeNodeSize,
  DEFAULT_CUSTOM_WAVE_NODE_SIZE,
  DEFAULT_SCOPE_NODE_SIZE,
  type ScopeNodeSize,
  type ShaderFlowEdge,
  type ShaderFlowNode,
  type ShaderNodeData,
} from './flowPatch';

export function ShaderNode({ data, selected, dragging }: NodeProps<ShaderFlowNode>) {
  const node = data.patchNode;
  const reactFlow = useReactFlow<ShaderFlowNode, ShaderFlowEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const draggedPortRef = useRef<{ side: 'input' | 'output'; port: string; pointerId: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const scopeResizeRef = useRef<{
    pointerId: number;
    corner: 'bottom-left' | 'bottom-right';
    startPointer: { x: number; y: number };
    startSize: ScopeNodeSize;
  } | null>(null);
  const customWaveEditorRef = useRef<SVGSVGElement | null>(null);
  const customWaveDragRef = useRef<{ pointerId: number; index: number } | null>(null);
  const customWaveClickRef = useRef<{ index: number | null; time: number }>({ index: null, time: 0 });
  const inputPortRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const outputPortRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const expressionInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextExpressionBlurRef = useRef(false);
  const [dragSource, setDragSource] = useState<{ side: 'input' | 'output'; port: string } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ side: 'input' | 'output'; port: string } | null>(null);
  const [scopeResizeCorner, setScopeResizeCorner] = useState<'bottom-left' | 'bottom-right' | null>(null);
  const [expressionDraft, setExpressionDraft] = useState(node.expression ?? '');
  const [pointerOver, setPointerOver] = useState(false);
  const definition = node.type ? getNodeDefinition(node as PatchNode) : null;
  const isExpression = node.type === 'Expression';
  const isGroup = node.type === 'Group';
  const isSelector = node.type === 'Selector';
  const canRenameInputs = node.type === 'Outs';
  const canRenameOutputs = node.type === 'Ins';
  const outputCount = definition?.outputs.length ?? 0;
  const previewInputPort = data.previewPort?.side === 'input' ? data.previewPort.name : null;
  const previewOutputPort = data.previewPort?.side === 'output' ? data.previewPort.name : null;
  const showMeterDisplay = node.type === 'Meter';
  const showScopeDisplay = node.type === 'Scope';
  const showSliderDisplay = node.type === 'Slider';
  const showButtonDisplay = node.type === 'Button';
  const showSequencerDisplay = node.type === 'Sequencer';
  const showTempoDisplay = node.type === 'Tempo';
  const showAudioOutputDisplay = node.type === 'AudioOut';
  const showAudioInputDisplay = node.type === 'AudioInput';
  const showMidiNoteDisplay = node.type === 'MidiNote';
  const showCustomWaveEditor = node.type === 'CustomWave';
  const showResizableDisplay = showScopeDisplay || showSliderDisplay || showButtonDisplay || showCustomWaveEditor;
  const showSampleUpload = node.type === 'SamplePlayer';
  const customWave = showCustomWaveEditor ? normalizeCustomWave(node.customWave, node.params) : null;
  const sequencer = showSequencerDisplay ? sequencerShape(node.params) : null;
  const amplitudeRange = displayAmplitudeRange(node.params.range);
  const amplitudeRangeLabel = formatAmplitude(amplitudeRange);
  const rawMeterLevel = data.audioMeter?.output ?? 0;
  const meterLevel = Math.max(0, Math.min(1, rawMeterLevel / amplitudeRange));
  const meterPeak = useRecentMaxLevel(meterLevel, showMeterDisplay);
  const outputMeterLeft = Math.max(0, Math.min(1, data.audioOutputMeter?.left ?? 0));
  const outputMeterRight = Math.max(0, Math.min(1, data.audioOutputMeter?.right ?? 0));
  const scopePath = showScopeDisplay ? samplesToScopePath(data.audioScope?.samples ?? [], amplitudeRange) : '';
  const scopeSize = showSliderDisplay || showButtonDisplay
    ? clampControlNodeSize(node.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE)
    : showScopeDisplay
      ? clampScopeNodeSize(node.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE)
    : DEFAULT_SCOPE_NODE_SIZE;
  const customWaveSize = showCustomWaveEditor
    ? clampCustomWaveNodeSize(node.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE)
    : DEFAULT_CUSTOM_WAVE_NODE_SIZE;
  const displaySize = showCustomWaveEditor ? customWaveSize : scopeSize;
  const nodeSizeStyle = showResizableDisplay
    ? ({
        '--node-display-width': `${displaySize.width}px`,
        '--node-display-height': `${displaySize.height}px`,
      } as CSSProperties)
    : undefined;
  const dspErrors = data.dspErrors ?? [];
  const hasDspErrors = dspErrors.length > 0;
  const previewAddsOutput = Boolean(
    previewOutputPort
    && definition
    && !definition.outputs.some((output) => output.name === previewOutputPort),
  );
  const connectedInputPorts = useMemo(() => new Set(data.connectedPorts?.inputs ?? []), [data.connectedPorts?.inputs]);
  const connectedOutputPorts = useMemo(() => new Set(data.connectedPorts?.outputs ?? []), [data.connectedPorts?.outputs]);
  const forceCompactPorts = definition ? shouldForceCompactPorts(definition) : false;
  const compactPorts = forceCompactPorts || node.compactPorts === true;
  const revealCompactPorts = data.isOnlySelected === true || (data.isConnecting === true && pointerOver);
  const showAllPorts = !compactPorts || revealCompactPorts;
  const showHeaderInput = Boolean(
    definition?.inputs.some((input) => input.name === 'signal')
    && previewInputPort !== 'signal',
  );
  const headerInputPort = showHeaderInput ? 'signal' : null;
  const showHeaderOutput = node.type !== 'Ins' && outputCount === 1 && !previewAddsOutput;
  const headerOutputPort = showHeaderOutput && definition ? definition.outputs[0]?.name ?? null : null;
  const showHeaderInputPort = Boolean(headerInputPort);
  const showHeaderOutputPort = Boolean(headerOutputPort);
  const selectedLinkInputs = data.selectedLinkPorts?.inputs ?? [];
  const selectedLinkOutputs = data.selectedLinkPorts?.outputs ?? [];
  const inputLabelWidth = definition
    ? `${Math.max(0, ...definition.inputs.filter((input) => input.name !== headerInputPort).map((input) => displayPortName(input.name).length))}ch`
    : '0ch';
  const outputLabelWidth = definition
    ? `${Math.max(0, ...definition.outputs.map((output) => output.name.length))}ch`
    : '0ch';
  const inputStyle = { '--input-label-width': inputLabelWidth } as CSSProperties;
  const nodeStyle = {
    ...(nodeSizeStyle ?? {}),
    '--input-label-width': inputLabelWidth,
  } as CSSProperties;
  const className = [
    'shader-node',
    showMeterDisplay ? 'shader-node-meter' : '',
    showScopeDisplay ? 'shader-node-scope' : '',
    showSliderDisplay ? 'shader-node-slider' : '',
    showButtonDisplay ? 'shader-node-button' : '',
    showSequencerDisplay ? 'shader-node-sequencer' : '',
    showAudioOutputDisplay ? 'shader-node-audio-out' : '',
    showSampleUpload ? 'shader-node-sampleplayer' : '',
    showAudioInputDisplay ? 'shader-node-audio-input' : '',
    showMidiNoteDisplay ? 'shader-node-midi-note' : '',
    showCustomWaveEditor ? 'shader-node-custom-wave' : '',
    isExpression ? 'shader-node-expression' : '',
    isGroup ? 'shader-node-group' : '',
    hasDspErrors ? 'shader-node-dsp-error' : '',
    selected ? 'shader-node-selected' : '',
    dragging ? 'shader-node-dragging' : '',
    compactPorts ? 'shader-node-compact' : '',
  ].filter(Boolean).join(' ');

  useLayoutEffect(() => {
    const animationFrame = requestAnimationFrame(() => updateNodeInternals(node.id));
    return () => cancelAnimationFrame(animationFrame);
  }, [
    compactPorts,
    connectedInputPorts,
    connectedOutputPorts,
    headerInputPort,
    inputLabelWidth,
    node.id,
    outputCount,
    outputLabelWidth,
    previewAddsOutput,
    showHeaderInputPort,
    showHeaderOutputPort,
    showAllPorts,
    displaySize.height,
    displaySize.width,
    customWave?.mode,
    customWave?.points,
    customWave?.sustainEnd,
    customWave?.sustainStart,
    sequencer?.rows,
    sequencer?.steps,
    updateNodeInternals,
  ]);

  useEffect(() => {
    if (document.activeElement === expressionInputRef.current) return;
    setExpressionDraft(node.expression ?? '');
  }, [node.expression]);

  function commitExpressionDraft() {
    if (!isExpression) return;
    data.onExpressionCommit?.(node.id, expressionDraft);
  }

  function moveDraggedPortToTarget(side: 'input' | 'output', draggedPort: string, targetPort: string, portOrder: string[]) {
    if (draggedPort === targetPort) return;

    const fromIndex = portOrder.indexOf(draggedPort);
    const toIndex = portOrder.indexOf(targetPort);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const direction: -1 | 1 = fromIndex < toIndex ? 1 : -1;
    const steps = Math.abs(toIndex - fromIndex);
    for (let step = 0; step < steps; step += 1) {
      data.onPortMove(node.id, side, draggedPort, direction);
    }
  }

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const draggedPort = draggedPortRef.current;
      if (!draggedPort || draggedPort.pointerId !== event.pointerId || !definition) return;

      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 3;
      if (!moved) return;

      event.preventDefault();
      const side = draggedPort.side;
      const portOrder = side === 'input'
        ? definition.inputs.map((port) => port.name)
        : definition.outputs.map((port) => port.name);
      const rows = side === 'input' ? inputPortRowsRef.current : outputPortRowsRef.current;

      const targets = portOrder.flatMap((port) => {
        const row = rows[port];
        if (!row) return [];
        const rect = row.getBoundingClientRect();
        return [{
          port,
          centerY: rect.top + rect.height / 2,
        }];
      });

      if (targets.length === 0) return;

      const targetPort = targets.reduce((best, current) => {
        const bestDistance = Math.abs(event.clientY - best.centerY);
        const currentDistance = Math.abs(event.clientY - current.centerY);
        return currentDistance < bestDistance ? current : best;
      }).port;

      setDragSource((current) => current ?? { side, port: draggedPort.port });
      setDragTarget({ side, port: targetPort });
      moveDraggedPortToTarget(side, draggedPort.port, targetPort, portOrder);
    }

    function stopDragging(pointerId: number) {
      if (!draggedPortRef.current || draggedPortRef.current.pointerId !== pointerId) return;

      draggedPortRef.current = null;
      dragStartRef.current = null;
      setDragSource(null);
      setDragTarget(null);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      stopDragging(event.pointerId);
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      stopDragging(event.pointerId);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [definition, node.id]);

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const resize = scopeResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;

      event.preventDefault();
      const zoom = reactFlow.getZoom() || 1;
      const deltaX = (event.clientX - resize.startPointer.x) / zoom;
      const deltaY = (event.clientY - resize.startPointer.y) / zoom;
      const rawNextSize = {
        width: resize.corner === 'bottom-left'
          ? resize.startSize.width - deltaX
          : resize.startSize.width + deltaX,
        height: resize.startSize.height + deltaY,
      };
      const nextSize = showCustomWaveEditor
        ? clampCustomWaveNodeSize(rawNextSize)
        : showSliderDisplay || showButtonDisplay
          ? clampControlNodeSize(rawNextSize)
          : clampScopeNodeSize(rawNextSize);
      data.onScopeResize(node.id, nextSize, resize.corner === 'bottom-left' ? 'left' : 'right');
    }

    function stopResizing(pointerId: number) {
      if (!scopeResizeRef.current || scopeResizeRef.current.pointerId !== pointerId) return;

      scopeResizeRef.current = null;
      setScopeResizeCorner(null);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      stopResizing(event.pointerId);
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      stopResizing(event.pointerId);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [data, node.id, reactFlow, showCustomWaveEditor]);

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const drag = customWaveDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !customWave) return;

      event.preventDefault();
      const point = customWavePointFromPointer(event);
      if (!point) return;
      const lastIndex = customWave.points.length - 1;
      const previous = customWave.points[drag.index - 1]?.x ?? 0;
      const next = customWave.points[drag.index + 1]?.x ?? 1;
      const x = drag.index === 0
        ? 0
        : drag.index === lastIndex
          ? 1
          : clamp(point.x, previous + 0.001, next - 0.001);
      const nextPoints = customWave.points.map((entry, index) => (
        index === drag.index ? { x, y: point.y } : entry
      ));
      commitCustomWave({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    }

    function stopDragging(pointerId: number) {
      if (!customWaveDragRef.current || customWaveDragRef.current.pointerId !== pointerId) return;

      customWaveDragRef.current = null;
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      stopDragging(event.pointerId);
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      stopDragging(event.pointerId);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [customWave, node.id]);

  function handlePortPointerDown(
    event: PointerEvent<HTMLSpanElement>,
    side: 'input' | 'output',
    port: string,
  ) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    data.onPortSelect?.(node.id, side, port);
    draggedPortRef.current = { side, port, pointerId: event.pointerId };
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragSource(null);
    setDragTarget(null);
  }

  function handleScopeResizePointerDown(
    event: PointerEvent<HTMLSpanElement>,
    corner: 'bottom-left' | 'bottom-right',
  ) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scopeResizeRef.current = {
      pointerId: event.pointerId,
      corner,
      startPointer: { x: event.clientX, y: event.clientY },
      startSize: displaySize,
    };
    setScopeResizeCorner(corner);
  }

  function handleScopeResizeClick(event: MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSampleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!showSampleUpload || !hasDraggedFiles(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleSampleDrop(event: DragEvent<HTMLDivElement>) {
    if (!showSampleUpload || event.dataTransfer.files.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    data.onSampleDrop?.(node.id, event.dataTransfer.files);
  }

  function commitCustomWave(nextCustomWave: CustomWaveSettings, historyKey?: string) {
    data.onCustomWaveChange?.(node.id, normalizeCustomWave(nextCustomWave), historyKey);
  }

  function customWavePointFromPointer(event: Pick<globalThis.PointerEvent, 'clientX' | 'clientY'>): CustomWavePoint | null {
    const editor = customWaveEditorRef.current;
    if (!editor) return null;

    const rect = editor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const padding = 18;
    const width = 300;
    const height = 128;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const screenX = clamp(((event.clientX - rect.left) / rect.width) * width, padding, width - padding);
    const screenY = clamp(((event.clientY - rect.top) / rect.height) * height, padding, height - padding);

    return {
      x: clamp((screenX - padding) / innerWidth, 0, 1),
      y: clamp((1 - ((screenY - padding) / innerHeight)) * 2 - 1, -1, 1),
    };
  }

  function removeCustomWavePoint(index: number): boolean {
    if (!customWave || index <= 0 || index >= customWave.points.length - 1) return false;

    const nextPoints = customWave.points.filter((_, pointIndex) => pointIndex !== index);
    customWaveDragRef.current = null;
    commitCustomWave({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    return true;
  }

  function handleCustomWavePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!customWave || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof Element
      ? event.target.closest<SVGElement>('.custom-wave-hit-target, .custom-wave-handle')
      : null;
    const targetIndex = target?.dataset.index ? Number(target.dataset.index) : null;
    const lastIndex = customWave.points.length - 1;

    if (target && Number.isInteger(targetIndex)) {
      const now = performance.now();
      if (
        targetIndex !== null &&
        targetIndex > 0 &&
        targetIndex < lastIndex &&
        customWaveClickRef.current.index === targetIndex &&
        now - customWaveClickRef.current.time < 360
      ) {
        customWaveClickRef.current = { index: null, time: 0 };
        removeCustomWavePoint(targetIndex);
        return;
      }

      customWaveClickRef.current = { index: targetIndex, time: now };
      if (targetIndex === null || targetIndex <= 0 || targetIndex >= lastIndex) return;
      customWaveDragRef.current = { pointerId: event.pointerId, index: targetIndex };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const point = customWavePointFromPointer(event);
    if (!point) return;

    customWaveClickRef.current = { index: null, time: 0 };
    const nextPoints = [...customWave.points, point].sort((a, b) => a.x - b.x);
    const nextIndex = nextPoints.reduce((bestIndex, item, index) => {
      const best = nextPoints[bestIndex];
      const distance = Math.abs(item.x - point.x) + Math.abs(item.y - point.y);
      const bestDistance = Math.abs(best.x - point.x) + Math.abs(best.y - point.y);
      return distance < bestDistance ? index : bestIndex;
    }, 0);
    commitCustomWave({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    customWaveDragRef.current = { pointerId: event.pointerId, index: nextIndex };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCustomWaveDoubleClick(event: MouseEvent<SVGSVGElement>) {
    if (!customWave) return;

    const target = event.target instanceof Element
      ? event.target.closest<SVGElement>('.custom-wave-hit-target, .custom-wave-handle')
      : null;
    if (!target?.dataset.index) return;

    event.preventDefault();
    event.stopPropagation();
    removeCustomWavePoint(Number(target.dataset.index));
  }

  return (
    <div
      className={className}
      style={nodeStyle}
      onPointerEnter={() => setPointerOver(true)}
      onPointerLeave={() => setPointerOver(false)}
      onDragOver={handleSampleDragOver}
      onDrop={handleSampleDrop}
    >
      <div className="shader-node-title">
        {showHeaderInputPort && headerInputPort ? (
          <Handle
            id={`in:${headerInputPort}`}
            type="target"
            position={Position.Left}
            className={[
              'shader-handle shader-handle-input shader-handle-input-title',
              selectedLinkInputs.includes(headerInputPort) ? 'shader-handle-selected-link' : '',
            ].filter(Boolean).join(' ')}
            onDoubleClick={(event) => {
              event.stopPropagation();
              data.onPortDoubleClick(node.id, 'input', headerInputPort);
            }}
          />
        ) : null}
        <NodeTypePicker
          nodeType={node.type}
          displayLabel={isGroup ? node.subpatchName ?? node.id : undefined}
          isEditingSubpatch={data.isEditingSubpatch === true}
          open={data.isTypePickerOpen}
          onOpen={() => data.onTypeEditStart(node.id)}
          onClose={data.onTypeEditEnd}
          onChange={(type) => data.onTypeChange(node.id, type)}
          onCustomLabelCommit={isGroup ? (label) => data.onSubpatchNameChange?.(node.id, label) : undefined}
        />
        {!forceCompactPorts ? (
          <button
            className="node-compact-toggle nodrag nopan"
            type="button"
            aria-label={compactPorts ? 'Expand ports' : 'Compact ports'}
            title={compactPorts ? 'Expand ports' : 'Compact ports'}
            aria-pressed={compactPorts}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data.onCompactToggle(node.id, !compactPorts);
            }}
          >
            <span
              className={[
                'node-compact-icon',
                compactPorts ? 'node-compact-icon-compact' : 'node-compact-icon-expanded',
              ].join(' ')}
              aria-hidden="true"
            />
          </button>
        ) : null}
        {hasDspErrors ? (
          <span
            className="node-dsp-error-marker"
            title={dspErrors.join('\n')}
            aria-label={`${dspErrors.length} DSP error${dspErrors.length === 1 ? '' : 's'}`}
          >
            !
          </span>
        ) : null}
        {showHeaderOutputPort && headerOutputPort ? (
          <Handle
            id={`out:${headerOutputPort}`}
            type="source"
            position={Position.Right}
            className={[
              'shader-handle shader-handle-output shader-handle-output-title',
              selectedLinkOutputs.includes(headerOutputPort) ? 'shader-handle-selected-link' : '',
            ].filter(Boolean).join(' ')}
            onDoubleClick={(event) => {
              event.stopPropagation();
              data.onPortDoubleClick(node.id, 'output', headerOutputPort);
            }}
          />
        ) : null}
      </div>
      {definition ? (
        (() => {
          const inputPorts = [
            ...definition.inputs
              .filter((input) => input.name !== headerInputPort)
              .map((input) => ({ ...input, preview: false })),
            ...(previewInputPort && !definition.inputs.some((input) => input.name === previewInputPort)
              ? [{ name: previewInputPort, preview: true }]
              : []),
          ];
          const outputPorts = [
            ...definition.outputs.map((output) => ({ ...output, preview: false })),
            ...(previewOutputPort && !definition.outputs.some((output) => output.name === previewOutputPort)
              ? [{ name: previewOutputPort, preview: true }]
              : []),
          ];
          const visibleInputPorts = inputPorts.filter((input) => (
            showAllPorts || connectedInputPorts.has(input.name)
          ));
          const visibleOutputPorts = outputPorts.filter((output) => (
            showAllPorts || connectedOutputPorts.has(output.name)
          ));
          const showBody = !compactPorts
            || isExpression
            || showSampleUpload
            || showAudioInputDisplay
            || showMidiNoteDisplay
            || showTempoDisplay
            || showSequencerDisplay
            || showCustomWaveEditor
            || showSliderDisplay
            || showButtonDisplay
            || showAudioOutputDisplay
            || visibleInputPorts.length > 0
            || (visibleOutputPorts.length > 0 && !showHeaderOutputPort)
            || showMeterDisplay
            || showScopeDisplay;

          if (!showBody) return null;

          return (
        <div className={[
          'shader-node-body',
          isExpression ? 'shader-node-body-expression' : '',
          showMeterDisplay ? 'shader-node-body-meter' : '',
          showScopeDisplay ? 'shader-node-body-scope' : '',
          showSliderDisplay ? 'shader-node-body-slider' : '',
          showButtonDisplay ? 'shader-node-body-button' : '',
          showSequencerDisplay ? 'shader-node-body-sequencer' : '',
          showAudioOutputDisplay ? 'shader-node-body-audio-out' : '',
          showAudioInputDisplay ? 'shader-node-body-audio-input' : '',
          showMidiNoteDisplay ? 'shader-node-body-midi-note' : '',
          showCustomWaveEditor ? 'shader-node-body-custom-wave' : '',
          !showSequencerDisplay && (visibleOutputPorts.length === 0 || showHeaderOutputPort) ? 'shader-node-body-no-outputs' : '',
        ].filter(Boolean).join(' ')}>
          {isExpression ? (
            <input
              ref={expressionInputRef}
              aria-label="GLSL expression"
              className="expression-editor nodrag nopan nowheel"
              spellCheck={false}
              type="text"
              value={expressionDraft}
              onChange={(event) => setExpressionDraft(event.currentTarget.value)}
              onBlur={() => {
                if (skipNextExpressionBlurRef.current) {
                  skipNextExpressionBlurRef.current = false;
                  return;
                }
                commitExpressionDraft();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitExpressionDraft();
                  skipNextExpressionBlurRef.current = true;
                  event.currentTarget.blur();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : null}
          {showSampleUpload ? (
            <div className="sample-upload-row">
              <button
                className="sample-upload-button nodrag nopan"
                type="button"
                title={node.sample?.name ?? 'Select sample'}
                onClick={() => data.onSampleSelect?.(node.id)}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {node.sample?.name ?? 'Select sample'}
              </button>
            </div>
          ) : null}
          {showAudioInputDisplay ? (
            <AudioInputDisplay
              state={data.audioInput}
              muted={Math.round(node.params.muted ?? 0) === 1}
              onMutedChange={(muted) => data.onParamChange(node.id, 'muted', muted ? 1 : 0)}
              onDeviceChange={(deviceId) => data.onAudioInputDeviceChange?.(deviceId)}
              onRefresh={() => data.onAudioInputRefresh?.()}
            />
          ) : null}
          {showCustomWaveEditor && customWave ? (
            <CustomWaveEditor
              customWave={customWave}
              compact={!showAllPorts}
              displaySize={displaySize}
              editorRef={customWaveEditorRef}
              onPointerDown={handleCustomWavePointerDown}
              onDoubleClick={handleCustomWaveDoubleClick}
              onModeChange={(mode) => commitCustomWave({ ...customWave, mode }, `custom-wave-mode:${node.id}`)}
              onSustainStartChange={(sustainStart) => {
                commitCustomWave({
                  ...customWave,
                  sustainStart: clamp(sustainStart, 0, customWave.sustainEnd - 0.001),
                }, `custom-wave-sustain:${node.id}`);
              }}
              onSustainEndChange={(sustainEnd) => {
                commitCustomWave({
                  ...customWave,
                  sustainEnd: clamp(sustainEnd, customWave.sustainStart + 0.001, 1),
                }, `custom-wave-sustain:${node.id}`);
              }}
            />
          ) : null}
          {showSliderDisplay ? (
            <SliderDisplay
              value={node.params.value ?? 0.5}
              displayValue={data.midiSliderValue ?? data.audioSliderValue}
              direction={Math.round(node.params.direction ?? 0) === 1 ? 'vertical' : 'horizontal'}
              onChange={(value) => data.onParamChange(node.id, 'value', value)}
            />
          ) : null}
          {showButtonDisplay ? (
            <ButtonDisplay
              mode={buttonModeFromValue(node.params.mode ?? 0)}
              pressed={data.midiButtonPressed ?? node.params.pressed ?? 0}
              onPressedChange={(value) => data.onParamChange(node.id, 'pressed', value)}
              onClickPulse={() => data.onParamChange(node.id, 'clicks', (node.params.clicks ?? 0) + 1)}
            />
          ) : null}
          {showSequencerDisplay && sequencer ? (
            <SequencerGrid
              params={node.params}
              rows={sequencer.rows}
              steps={sequencer.steps}
              currentStep={data.audioSequencerStep}
              selectedLinkOutputs={selectedLinkOutputs}
              setOutputRowRef={(port, element) => {
                outputPortRowsRef.current[port] = element;
              }}
              onCellToggle={(rowIndex, stepIndex) => {
                const port = sequencerCellParamName(rowIndex, stepIndex);
                const nextValue = (node.params[port] ?? 0) >= 0.5 ? 0 : 1;
                data.onParamChange(node.id, port, nextValue);
              }}
            />
          ) : null}
          {showAudioOutputDisplay ? (
            <div className="audio-out-node-meter" aria-label="Audio output level">
              <AudioOutputMeterRow label="L" level={outputMeterLeft} />
              <AudioOutputMeterRow label="R" level={outputMeterRight} />
            </div>
          ) : null}
          <div className="shader-ports shader-inputs" style={inputStyle}>
            {visibleInputPorts.map((input) => (
            <div
              className={[
                'shader-port shader-port-input',
                input.preview ? 'shader-port-preview' : '',
              ].filter(Boolean).join(' ')}
              key={`${input.preview ? 'preview' : 'port'}:${input.name}`}
              ref={(element) => {
                inputPortRowsRef.current[input.name] = element;
              }}
              onDoubleClick={(event) => {
                if (input.preview) return;
                if (input.connectable === false) return;
                event.stopPropagation();
                data.onPortDoubleClick(node.id, 'input', input.name);
              }}
            >
              {input.connectable !== false ? (
                <Handle
                  id={`in:${input.name}`}
                  type="target"
                  position={Position.Left}
                  className={[
                    'shader-handle shader-handle-input',
                    selectedLinkInputs.includes(input.name) ? 'shader-handle-selected-link' : '',
                  ].filter(Boolean).join(' ')}
                  onDoubleClick={(event) => {
                    if (input.preview) return;
                    event.stopPropagation();
                    data.onPortDoubleClick(node.id, 'input', input.name);
                  }}
                />
              ) : null}
              {isSelector && isSelectorValuePort(input.name) && !input.preview ? (
                <button
                  className={[
                    'selector-index-button nodrag nopan',
                    Math.floor(node.params.select ?? 0) === Number(input.name) ? 'selector-index-button-active' : '',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  title={`Select input ${input.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    data.onParamChange(node.id, 'select', Number(input.name));
                  }}
                >
                  {input.name}
                </button>
              ) : showSliderDisplay && input.name === 'direction' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="slider-direction-select nodrag nopan"
                    value={String(Math.round(node.params.direction ?? input.defaultValue ?? 0))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">horizontal</option>
                    <option value="1">vertical</option>
                  </select>
                </>
              ) : showSampleUpload && input.name === 'mode' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="sample-mode-select nodrag nopan"
                    value={String(Math.round(node.params.mode ?? input.defaultValue ?? 0))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">one-shot</option>
                    <option value="1">loop</option>
                    <option value="2">ping-pong</option>
                  </select>
                </>
              ) : showTempoDisplay && input.name === 'source' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="tempo-source-select nodrag nopan"
                    aria-label="Tempo source"
                    value={String(clamp(Math.round(node.params.source ?? input.defaultValue ?? 0), 0, 1))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">internal</option>
                    <option value="1">midi</option>
                  </select>
                </>
              ) : showTempoDisplay && input.name === 'midiSource' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="tempo-source-select nodrag nopan"
                    aria-label="MIDI clock source"
                    value={String(clamp(Math.round(node.params.midiSource ?? input.defaultValue ?? 0), 0, Math.max(0, data.midiInput?.devices.length ?? 0)))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">any midi</option>
                    {(data.midiInput?.devices ?? []).map((device, index) => (
                      <option key={device.id || `${device.label}-${index}`} value={index + 1}>
                        {device.label || `MIDI ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </>
              ) : showMidiNoteDisplay && input.name === 'voices' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="midi-voices-select nodrag nopan"
                    aria-label="MIDI polyphony voices"
                    value={String(clamp(Math.round(node.params.voices ?? input.defaultValue ?? 8), 1, 16))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {Array.from({ length: 16 }, (_, index) => index + 1).map((voiceCount) => (
                      <option key={voiceCount} value={voiceCount}>{voiceCount}</option>
                    ))}
                  </select>
                </>
              ) : showButtonDisplay && input.name === 'mode' && !input.preview ? (
                <>
                  <PortNameLabel
                    name={input.name}
                    editable={false}
                    draggable={false}
                    preview={false}
                    selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                    activeDragTarget={false}
                    activeDragSource={false}
                    onChange={() => undefined}
                  />
                  <select
                    className="button-mode-select nodrag nopan"
                    value={String(Math.round(node.params.mode ?? input.defaultValue ?? 0))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">toggle</option>
                    <option value="1">click</option>
                    <option value="2">temporary</option>
                  </select>
                </>
              ) : (
                <PortNameLabel
                  name={input.name}
                  editable={canRenameInputs && !input.preview}
                  draggable={canRenameInputs && !input.preview}
                  preview={input.preview}
                  selected={data.selectedPort?.side === 'input' && data.selectedPort.name === input.name}
                  activeDragTarget={dragTarget?.side === 'input' && dragTarget.port === input.name}
                  activeDragSource={dragSource?.side === 'input' && dragSource.port === input.name}
                  onPointerDown={(event) => {
                    if (input.preview) return;
                    if (!canRenameInputs) return;
                    handlePortPointerDown(event, 'input', input.name);
                  }}
                  onChange={(nextName) => data.onPortNameChange(node.id, 'input', input.name, nextName)}
                />
              )}
              {!input.preview && node.type !== 'Outs' && input.valueEditor !== false && input.defaultValue !== undefined && !(showSliderDisplay && input.name === 'direction') && !(showButtonDisplay && input.name === 'mode') && !(showSampleUpload && input.name === 'mode') && !(showMidiNoteDisplay && input.name === 'voices') && !(showTempoDisplay && (input.name === 'source' || input.name === 'midiSource')) ? (
                <NumericScrubber
                  value={node.params[input.name] ?? input.defaultValue ?? 0}
                  min={input.min}
                  max={input.max}
                  integer={input.integer}
                  onChange={(value) => data.onParamChange(node.id, input.name, value)}
                  midiLearnEvent={canLearnMidiCc(node.type, input.name) ? data.midiInput?.lastControlChange : undefined}
                  onEditStart={canLearnMidiCc(node.type, input.name) ? () => {
                    void data.onMidiInputRefresh?.();
                  } : undefined}
                  onMidiLearn={canLearnMidiCc(node.type, input.name) ? (event) => {
                    data.onParamChange(node.id, input.name, event.cc);
                    if (node.type === 'Slider' || node.type === 'Button') {
                      data.onParamChange(node.id, 'midiChannel', event.channel);
                    } else if (node.type === 'MidiCc') {
                      data.onParamChange(node.id, 'channel', event.channel);
                    }
                  } : undefined}
                />
              ) : null}
            </div>
            ))}
            {isSelector && showAllPorts ? (
              <button
                className="selector-add-input-button nodrag nopan"
                type="button"
                aria-label="Add selector input"
                title="Add selector input"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onSelectorInputAdd?.(node.id);
                }}
              >
                +
              </button>
            ) : null}
          </div>
          {visibleOutputPorts.length > 0 && !showHeaderOutputPort && !showSequencerDisplay ? (
            <div className="shader-ports shader-outputs">
              {visibleOutputPorts.map((output) => (
              <div
                className={[
                  'shader-port shader-port-output',
                  output.preview ? 'shader-port-preview' : '',
                ].filter(Boolean).join(' ')}
                key={`${output.preview ? 'preview' : 'port'}:${output.name}`}
                ref={(element) => {
                  outputPortRowsRef.current[output.name] = element;
                }}
                onDoubleClick={(event) => {
                  if (output.preview) return;
                  event.stopPropagation();
                  data.onPortDoubleClick(node.id, 'output', output.name);
                }}
              >
                <PortNameLabel
                name={output.name}
                editable={canRenameOutputs && !output.preview}
                draggable={canRenameOutputs && !output.preview}
                  preview={output.preview}
                  selected={data.selectedPort?.side === 'output' && data.selectedPort.name === output.name}
                  activeDragTarget={dragTarget?.side === 'output' && dragTarget.port === output.name}
                  activeDragSource={dragSource?.side === 'output' && dragSource.port === output.name}
                  onPointerDown={(event) => {
                    if (output.preview) return;
                    if (!canRenameOutputs) return;
                    handlePortPointerDown(event, 'output', output.name);
                  }}
                  onChange={(nextName) => data.onPortNameChange(node.id, 'output', output.name, nextName)}
                />
                {!output.preview && node.type === 'Ins' && output.valueEditor !== false ? (
                  <NumericScrubber
                    value={node.params[output.name] ?? output.defaultValue ?? 0}
                    min={output.min}
                    max={output.max}
                    integer={output.integer}
                    onChange={(value) => data.onParamChange(node.id, output.name, value)}
                  />
                ) : null}
                <Handle
                  id={`out:${output.name}`}
                  type="source"
                  position={Position.Right}
                  className={[
                    'shader-handle shader-handle-output',
                    selectedLinkOutputs.includes(output.name) ? 'shader-handle-selected-link' : '',
                  ].filter(Boolean).join(' ')}
                  onDoubleClick={(event) => {
                    if (output.preview) return;
                    event.stopPropagation();
                    data.onPortDoubleClick(node.id, 'output', output.name);
                  }}
                />
              </div>
              ))}
            </div>
          ) : null}
          {showMeterDisplay ? (
            <div className="audio-node-meter-display" aria-hidden="true">
              <span className="audio-node-meter-fill" style={{ width: `${meterLevel * 100}%` }} />
              <span className="audio-node-meter-peak" style={{ left: `${meterPeak * 100}%` }} />
              <span className="audio-node-meter-scale audio-node-meter-scale-min">0</span>
              <span className="audio-node-meter-scale audio-node-meter-scale-max">{amplitudeRangeLabel}</span>
            </div>
          ) : null}
          {showScopeDisplay ? (
            <div className="audio-node-scope-display" aria-hidden="true">
              <span className="audio-node-scope-scale audio-node-scope-scale-top">+{amplitudeRangeLabel}</span>
              <span className="audio-node-scope-scale audio-node-scope-scale-mid">0</span>
              <span className="audio-node-scope-scale audio-node-scope-scale-bottom">-{amplitudeRangeLabel}</span>
              <svg viewBox="0 0 160 48" preserveAspectRatio="none">
                <path d={scopePath} />
              </svg>
            </div>
          ) : null}
          {showResizableDisplay ? (
            <>
              <span
                className={[
                  'audio-node-scope-resize-handle audio-node-scope-resize-handle-left nodrag nopan',
                  scopeResizeCorner === 'bottom-left' ? 'audio-node-scope-resize-handle-active' : '',
                ].filter(Boolean).join(' ')}
                title={showCustomWaveEditor ? 'Resize custom wave' : showSliderDisplay ? 'Resize slider' : showButtonDisplay ? 'Resize button' : 'Resize scope'}
                onPointerDown={(event) => handleScopeResizePointerDown(event, 'bottom-left')}
                onClick={handleScopeResizeClick}
                onDoubleClick={(event) => event.stopPropagation()}
              />
              <span
                className={[
                  'audio-node-scope-resize-handle audio-node-scope-resize-handle-right nodrag nopan',
                  scopeResizeCorner === 'bottom-right' ? 'audio-node-scope-resize-handle-active' : '',
                ].filter(Boolean).join(' ')}
                title={showCustomWaveEditor ? 'Resize custom wave' : showSliderDisplay ? 'Resize slider' : showButtonDisplay ? 'Resize button' : 'Resize scope'}
                onPointerDown={(event) => handleScopeResizePointerDown(event, 'bottom-right')}
                onClick={handleScopeResizeClick}
                onDoubleClick={(event) => event.stopPropagation()}
              />
            </>
          ) : null}
        </div>
          );
        })()
      ) : (
        <div className="shader-node-body shader-node-body-draft">
          <div className="shader-ports shader-inputs">
            <div className="shader-port shader-port-input">
              <Handle
                id="in:value"
                type="target"
                position={Position.Left}
                className="shader-handle shader-handle-input"
              />
              <span>in</span>
            </div>
          </div>
          <div className="shader-ports shader-outputs">
            <div className="shader-port shader-port-output">
              <span>out</span>
              <Handle
                id="out:value"
                type="source"
                position={Position.Right}
                className="shader-handle shader-handle-output"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomWaveEditorProps {
  customWave: CustomWaveSettings;
  compact: boolean;
  displaySize: ScopeNodeSize;
  editorRef: RefObject<SVGSVGElement | null>;
  onPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  onDoubleClick: (event: MouseEvent<SVGSVGElement>) => void;
  onModeChange: (mode: CustomWaveMode) => void;
  onSustainStartChange: (value: number) => void;
  onSustainEndChange: (value: number) => void;
}

interface AudioInputDisplayProps {
  state: ShaderNodeData['audioInput'];
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onDeviceChange: (deviceId: string) => void;
  onRefresh: () => void;
}

const METER_RECENT_MAX_HOLD_MS = 800;

function useRecentMaxLevel(level: number, enabled: boolean): number {
  const latestLevelRef = useRef(level);
  const timeoutRef = useRef<number | null>(null);
  const [recentMaxLevel, setRecentMaxLevel] = useState(level);

  useEffect(() => {
    latestLevelRef.current = level;
  }, [level]);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecentMaxLevel(level);
      return;
    }

    setRecentMaxLevel((currentMax) => {
      if (level >= currentMax) {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return level;
      }

      if (timeoutRef.current === null) {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          setRecentMaxLevel(latestLevelRef.current);
        }, METER_RECENT_MAX_HOLD_MS);
      }

      return currentMax;
    });
  }, [enabled, level]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  return recentMaxLevel;
}

function AudioOutputMeterRow({ label, level }: { label: string; level: number }) {
  const normalized = Math.max(0, Math.min(1, level));

  return (
    <div className="audio-out-node-meter-row" aria-hidden="true">
      <span className="audio-out-node-meter-label">{label}</span>
      <span className="audio-out-node-meter-track">
        <span className="audio-out-node-meter-fill" style={{ width: `${normalized * 100}%` }} />
      </span>
    </div>
  );
}

function AudioInputDisplay({ state, muted, onMutedChange, onDeviceChange, onRefresh }: AudioInputDisplayProps) {
  const status = state?.status ?? 'inactive';
  const message = state?.message ?? 'Start audio to request microphone access.';
  const devices = state?.devices ?? [];
  const selectedDeviceId = state?.selectedDeviceId ?? '';
  const canSelectDevice = state?.canSelectDevice ?? false;
  const unavailable = status === 'unsupported' || status === 'denied' || status === 'error';

  return (
    <div className="audio-input-node-panel nodrag nopan">
      <div className="audio-input-node-status-row">
        <span
          className={[
            'audio-input-node-status-dot',
            `audio-input-node-status-dot-${status}`,
          ].join(' ')}
          aria-hidden="true"
        />
        <span className="audio-input-node-status-text" title={message}>
          {audioInputStatusLabel(status)}
        </span>
        <button
          className={[
            'audio-input-node-mute-button',
            muted ? 'audio-input-node-mute-button-active' : '',
          ].filter(Boolean).join(' ')}
          type="button"
          aria-label={muted ? 'Unmute audio input' : 'Mute audio input'}
          aria-pressed={muted}
          title={muted ? 'Unmute input' : 'Mute input'}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMutedChange(!muted);
          }}
        >
          {muted ? 'muted' : 'live'}
        </button>
      </div>
      <div className={[
        'audio-input-node-message',
        unavailable ? 'audio-input-node-message-warning' : '',
      ].filter(Boolean).join(' ')}>
        {message}
      </div>
      {canSelectDevice ? (
        <div className="audio-input-node-device-row">
          <select
            className="audio-input-node-device-select"
            aria-label="Audio input device"
            value={selectedDeviceId}
            disabled={devices.length === 0}
            onChange={(event) => {
              onDeviceChange(event.currentTarget.value);
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <option value="">Default input</option>
            {devices.map((device) => (
              <option key={device.deviceId || device.label} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <button
            className="audio-input-node-refresh-button"
            type="button"
            aria-label="Refresh audio input devices"
            title="Refresh devices"
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRefresh();
            }}
          >
            refresh
          </button>
        </div>
      ) : null}
    </div>
  );
}

function audioInputStatusLabel(status: NonNullable<ShaderNodeData['audioInput']>['status']): string {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'requesting':
      return 'requesting';
    case 'needs-permission':
      return 'permission';
    case 'denied':
      return 'denied';
    case 'unsupported':
      return 'unavailable';
    case 'error':
      return 'check input';
    case 'inactive':
    default:
      return 'idle';
  }
}

interface SliderDisplayProps {
  value: number;
  displayValue?: number;
  direction: 'horizontal' | 'vertical';
  onChange: (value: number) => void;
}

function SliderDisplay({ value, displayValue, direction, onChange }: SliderDisplayProps) {
  const normalized = clamp(displayValue ?? value, 0, 1);
  const fillStyle = direction === 'vertical'
    ? { height: `${normalized * 100}%` }
    : { width: `${normalized * 100}%` };

  return (
    <div className={[
      'audio-node-slider-display nodrag nopan',
      direction === 'vertical' ? 'audio-node-slider-display-vertical' : 'audio-node-slider-display-horizontal',
    ].join(' ')}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="audio-node-slider-fill" style={fillStyle} aria-hidden="true" />
      <input
        aria-label="Slider value"
        type="range"
        tabIndex={-1}
        min={0}
        max={1}
        step={0.001}
        value={normalized}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
          event.currentTarget.blur();
        }}
        onFocus={(event) => event.currentTarget.blur()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

type ButtonMode = 'toggle' | 'click' | 'temporary';
const BUTTON_CLICK_FLASH_MS = 120;

interface ButtonDisplayProps {
  mode: ButtonMode;
  pressed: number;
  onPressedChange: (value: number) => void;
  onClickPulse: () => void;
}

function ButtonDisplay({ mode, pressed, onPressedChange, onClickPulse }: ButtonDisplayProps) {
  const [pointerActive, setPointerActive] = useState(false);
  const [clickFlashActive, setClickFlashActive] = useState(false);
  const clickFlashTimeoutRef = useRef<number | null>(null);
  const previousPressedRef = useRef(false);
  const isPressed = pressed >= 0.5;
  const isLit = mode === 'click'
    ? clickFlashActive
    : mode === 'temporary'
      ? pointerActive || isPressed
      : isPressed;

  function flashClick() {
    if (clickFlashTimeoutRef.current !== null) {
      window.clearTimeout(clickFlashTimeoutRef.current);
    }
    setClickFlashActive(true);
    clickFlashTimeoutRef.current = window.setTimeout(() => {
      clickFlashTimeoutRef.current = null;
      setClickFlashActive(false);
    }, BUTTON_CLICK_FLASH_MS);
  }

  useEffect(() => {
    if (mode === 'click' && isPressed && !previousPressedRef.current) {
      flashClick();
    }
    previousPressedRef.current = isPressed;
  }, [isPressed, mode]);

  useEffect(() => () => {
    if (clickFlashTimeoutRef.current !== null) {
      window.clearTimeout(clickFlashTimeoutRef.current);
    }
  }, []);

  function releaseTemporary() {
    setPointerActive(false);
    if (mode === 'temporary') {
      onPressedChange(0);
    }
  }

  return (
    <button
      className={[
        'audio-node-button-display nodrag nopan',
        isLit ? 'audio-node-button-display-active' : '',
      ].filter(Boolean).join(' ')}
      type="button"
      aria-label="Button value"
      aria-pressed={isLit}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (mode === 'temporary') {
          setPointerActive(true);
          onPressedChange(1);
        } else if (mode === 'click') {
          flashClick();
          onClickPulse();
        }
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        releaseTemporary();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        releaseTemporary();
      }}
      onLostPointerCapture={releaseTemporary}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'toggle') {
          onPressedChange(isPressed ? 0 : 1);
        }
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

interface SequencerGridProps {
  params: Record<string, number>;
  rows: number;
  steps: number;
  currentStep?: number;
  selectedLinkOutputs: string[];
  setOutputRowRef: (port: string, element: HTMLDivElement | null) => void;
  onCellToggle: (rowIndex: number, stepIndex: number) => void;
}

function SequencerGrid({
  params,
  rows,
  steps,
  currentStep,
  selectedLinkOutputs,
  setOutputRowRef,
  onCellToggle,
}: SequencerGridProps) {
  const activeStep = Number.isFinite(currentStep) ? Math.round(currentStep ?? -1) : -1;
  return (
    <div
      className="sequencer-node-panel nodrag nopan"
      style={{ '--sequencer-steps': steps } as CSSProperties}
      aria-label="Sequencer pattern"
    >
      {Array.from({ length: rows }, (_, rowIndex) => {
        const outputName = sequencerOutputName(rowIndex);
        return (
          <div
            className="sequencer-row"
            key={outputName}
            ref={(element) => setOutputRowRef(outputName, element)}
          >
            <div className="sequencer-cells" role="row">
              {Array.from({ length: steps }, (_, stepIndex) => {
                const active = (params[sequencerCellParamName(rowIndex, stepIndex)] ?? 0) >= 0.5;
                return (
                  <button
                    className={[
                      'sequencer-cell',
                      activeStep === stepIndex ? 'sequencer-cell-current' : '',
                      active ? 'sequencer-cell-active' : '',
                    ].filter(Boolean).join(' ')}
                    key={stepIndex}
                    type="button"
                    role="gridcell"
                    aria-label={`Row ${rowIndex + 1}, step ${stepIndex + 1}`}
                    aria-pressed={active}
                    title={`Row ${rowIndex + 1}, step ${stepIndex + 1}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCellToggle(rowIndex, stepIndex);
                    }}
                  />
                );
              })}
            </div>
            <div className="sequencer-output-port">
              <Handle
                id={`out:${outputName}`}
                type="source"
                position={Position.Right}
                className={[
                  'shader-handle shader-handle-output shader-handle-output-sequencer',
                  selectedLinkOutputs.includes(outputName) ? 'shader-handle-selected-link' : '',
                ].filter(Boolean).join(' ')}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CustomWaveEditor({
  customWave,
  compact,
  displaySize,
  editorRef,
  onPointerDown,
  onDoubleClick,
  onModeChange,
  onSustainStartChange,
  onSustainEndChange,
}: CustomWaveEditorProps) {
  const width = 300;
  const height = 128;
  const padding = 18;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const points = customWave.points;
  const path = customWavePath(points, width, height, padding);
  const sustainStartX = padding + customWave.sustainStart * innerWidth;
  const sustainEndX = padding + customWave.sustainEnd * innerWidth;
  const showSustainStart = customWaveUsesSustainStart(customWave.mode);
  const showSustainEnd = customWaveUsesSustainEnd(customWave.mode);
  const hitRadius = screenCircleRadius(15, width, height, displaySize);
  const endpointRadius = screenCircleRadius(5, width, height, displaySize);
  const handleRadius = screenCircleRadius(6, width, height, displaySize);

  return (
    <div className="custom-wave-node-editor nodrag nopan">
      <svg
        ref={editorRef}
        className="custom-wave-node-canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label="Custom wave editor"
        role="img"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <g className="custom-wave-chart-chrome">
          <line className="custom-wave-grid-line" x1={padding} y1={padding} x2={width - padding} y2={padding} />
          <line className="custom-wave-grid-line custom-wave-zero" x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} />
          <line className="custom-wave-grid-line" x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
          {showSustainStart ? (
            <line className="custom-wave-sustain-line" x1={sustainStartX} y1={padding} x2={sustainStartX} y2={height - padding} />
          ) : null}
          {showSustainEnd ? (
            <line className="custom-wave-sustain-line is-end" x1={sustainEndX} y1={padding} x2={sustainEndX} y2={height - padding} />
          ) : null}
          <path className="custom-wave-path" d={path} />
        </g>
        {points.map((point, index) => {
          const screen = customWavePointToScreen(point, width, height, padding);
          const locked = index === 0 || index === points.length - 1;
          return (
            <g key={`${point.x}:${point.y}:${index}`}>
              <ellipse
                className={[
                  'custom-wave-hit-target',
                  locked ? 'is-locked' : '',
                ].filter(Boolean).join(' ')}
                data-index={index}
                cx={screen.x}
                cy={screen.y}
                rx={hitRadius.rx}
                ry={hitRadius.ry}
              />
              <ellipse
                className={[
                  'custom-wave-handle',
                  locked ? 'custom-wave-endpoint is-locked' : '',
                ].filter(Boolean).join(' ')}
                data-index={index}
                cx={screen.x}
                cy={screen.y}
                rx={locked ? endpointRadius.rx : handleRadius.rx}
                ry={locked ? endpointRadius.ry : handleRadius.ry}
              />
            </g>
          );
        })}
      </svg>
      {!compact ? (
      <div className="custom-wave-node-controls">
        <label className="custom-wave-node-field">
          <span>mode</span>
          <select
            className="custom-wave-mode-select"
            value={customWave.mode}
            onChange={(event) => {
              onModeChange(event.currentTarget.value as CustomWaveMode);
              event.currentTarget.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {CUSTOM_WAVE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
        {showSustainStart ? (
          <CustomWaveRange
            label="start"
            value={customWave.sustainStart}
            min={0}
            max={Math.max(0, customWave.sustainEnd - 0.001)}
            onChange={onSustainStartChange}
          />
        ) : null}
        {showSustainEnd ? (
          <CustomWaveRange
            label="end"
            value={customWave.sustainEnd}
            min={Math.min(1, customWave.sustainStart + 0.001)}
            max={1}
            onChange={onSustainEndChange}
          />
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

interface CustomWaveRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function CustomWaveRange({ label, value, min, max, onChange }: CustomWaveRangeProps) {
  return (
    <label className="custom-wave-node-field custom-wave-node-range">
      <span>{label}</span>
      <input
        type="range"
        tabIndex={-1}
        min={min}
        max={max}
        step={0.001}
        value={value}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
          event.currentTarget.blur();
        }}
        onFocus={(event) => event.currentTarget.blur()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={0.001}
        value={formatUnitValue(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    </label>
  );
}

function customWavePath(points: CustomWavePoint[], width: number, height: number, padding: number): string {
  return points.map((point, index) => {
    const screen = customWavePointToScreen(point, width, height, padding);
    return `${index === 0 ? 'M' : 'L'}${roundPathNumber(screen.x)} ${roundPathNumber(screen.y)}`;
  }).join(' ');
}

function customWavePointToScreen(point: CustomWavePoint, width: number, height: number, padding: number): CustomWavePoint {
  return {
    x: padding + point.x * (width - padding * 2),
    y: padding + (1 - ((point.y + 1) / 2)) * (height - padding * 2),
  };
}

function screenCircleRadius(
  radiusPx: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
  displaySize: ScopeNodeSize,
): { rx: number; ry: number } {
  const scaleX = displaySize.width / viewBoxWidth;
  const scaleY = displaySize.height / viewBoxHeight;
  return {
    rx: radiusPx / Math.max(0.001, scaleX),
    ry: radiusPx / Math.max(0.001, scaleY),
  };
}

function displayAmplitudeRange(value: number | undefined): number {
  const range = Math.abs(Number(value ?? 1));
  return Number.isFinite(range) && range > 0 ? range : 1;
}

function shouldForceCompactPorts(definition: NodeDefinition): boolean {
  return definition.inputs.length === 1
    && definition.inputs[0]?.name === 'signal'
    && definition.outputs.length <= 1;
}

function isSelectorValuePort(name: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(name);
}

function samplesToScopePath(samples: number[], range: number): string {
  if (samples.length < 2) return 'M0 24 L160 24';

  return samples.map((sample, index) => {
    const x = (index / (samples.length - 1)) * 160;
    const y = 24 - Math.max(-1, Math.min(1, sample / range)) * 22;
    return `${index === 0 ? 'M' : 'L'}${roundPathNumber(x)} ${roundPathNumber(y)}`;
  }).join(' ');
}

function roundPathNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatAmplitude(value: number): string {
  if (!Number.isFinite(value)) return '1';
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return trimTrailingZeros(value.toFixed(1));
  if (value >= 1) return trimTrailingZeros(value.toFixed(2));
  return trimTrailingZeros(value.toFixed(3));
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, '');
}

function formatUnitValue(value: number): string {
  return trimTrailingZeros(clamp(value, 0, 1).toFixed(3));
}

function buttonModeFromValue(value: number): ButtonMode {
  const mode = Math.round(value);
  if (mode === 1) return 'click';
  if (mode === 2) return 'temporary';
  return 'toggle';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface NodeTypePickerProps {
  nodeType: NodeType | null;
  displayLabel?: string;
  isEditingSubpatch: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (type: NodeType) => void;
  onCustomLabelCommit?: (label: string) => void;
}

interface PortNameLabelProps {
  name: string;
  editable: boolean;
  draggable?: boolean;
  selected?: boolean;
  preview?: boolean;
  activeDragTarget?: boolean;
  activeDragSource?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLSpanElement>) => void;
  onChange: (nextName: string) => void;
}

function PortNameLabel({
  name,
  editable,
  draggable = false,
  selected = false,
  preview = false,
  activeDragTarget = false,
  activeDragSource = false,
  onPointerDown,
  onChange,
}: PortNameLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(name);
    }
  }, [editing, name]);

  useEffect(() => {
    if (!editing) return;

    const animationFrame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editing]);

  function commitDraft() {
    onChange(draft);
    setEditing(false);
  }

  function cancelDraft() {
    setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="port-name-editor nodrag nopan"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            commitDraft();
          }
          if (event.key === 'Escape') {
            cancelDraft();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        spellCheck={false}
      />
    );
  }

  return (
    <span
      className={[
        'port-name-label',
        editable ? 'port-name-label-editable' : '',
        draggable ? 'port-name-label-draggable nodrag nopan' : '',
          selected ? 'port-name-label-selected' : '',
          preview ? 'port-name-label-preview' : '',
        activeDragTarget ? 'port-name-label-drag-target' : '',
        activeDragSource ? 'port-name-label-drag-source' : '',
      ].filter(Boolean).join(' ')}
      draggable={draggable}
        title={preview
          ? 'Drop a connection here to create this port'
          : editable
            ? 'Drag to reorder. Double-click to rename'
            : undefined}
        onPointerDown={(event) => {
          onPointerDown?.(event);
        }}
      onDoubleClick={(event) => {
        if (!editable) return;
        event.preventDefault();
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {displayPortName(name)}
    </span>
  );
}

function displayPortName(name: string): string {
  if (name === 'originalFrequency') return 'original frequency';
  if (name === 'midiChannel') return 'midi channel';
  if (name === 'midiCc') return 'midi cc';
  return name;
}

function canLearnMidiCc(nodeType: NodeType | null, inputName: string): boolean {
  return (
    (nodeType === 'MidiCc' && inputName === 'cc') ||
    ((nodeType === 'Slider' || nodeType === 'Button') && inputName === 'midiCc')
  );
}

function NodeTypePicker({
  nodeType,
  displayLabel,
  isEditingSubpatch,
  open,
  onOpen,
  onClose,
  onChange,
  onCustomLabelCommit,
}: NodeTypePickerProps) {
  const nodeTypeLabel = nodeType ? getNodeTypeLabel(nodeType) : 'type';
  const pickerLabel = displayLabel ?? nodeTypeLabel;
  const [query, setQuery] = useState<string>(nodeType ? pickerLabel : '');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dragIntent, setDragIntent] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const searchQuery = displayLabel && query.trim() === pickerLabel
    ? nodeTypeLabel
    : query;
  const options = useMemo(() => NODE_TYPE_LIST.filter((type) => {
    if (!isEditingSubpatch && (type === 'Ins' || type === 'Outs')) return false;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return (
      type.toLowerCase().includes(normalizedQuery) ||
      getNodeTypeLabel(type).toLowerCase().includes(normalizedQuery)
    );
  }), [isEditingSubpatch, searchQuery]);
  useEffect(() => {
    if (!open) {
      setQuery(nodeType ? pickerLabel : '');
      setHighlightedIndex(0);
    }
  }, [nodeType, open, pickerLabel]);

  useEffect(() => {
    if (open) {
      setQuery(nodeType ? pickerLabel : '');
      setHighlightedIndex(0);
      const focusAndSelect = () => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      };
      const animationFrame = requestAnimationFrame(focusAndSelect);
      const firstTimeout = window.setTimeout(focusAndSelect, 0);
      const secondTimeout = window.setTimeout(focusAndSelect, 50);

      return () => {
        cancelAnimationFrame(animationFrame);
        window.clearTimeout(firstTimeout);
        window.clearTimeout(secondTimeout);
      };
    }
  }, [nodeType, open, pickerLabel]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

  function choose(type: NodeType) {
    onChange(type);
    onClose();
  }

  function commitCustomLabel(): boolean {
    const label = query.trim();
    if (!onCustomLabelCommit || label.length === 0) return false;

    onCustomLabelCommit(label);
    onClose();
    return true;
  }

  function closeOrCommitCustomLabel() {
    if (options.length === 0 && commitCustomLabel()) return;
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selectedType = options[highlightedIndex] ?? options[0];
      if (selectedType) {
        choose(selectedType);
      } else {
        commitCustomLabel();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  if (!open) {
    return (
      <button
        className={dragIntent ? 'node-type-picker-button node-type-picker-button-drag-intent' : 'node-type-picker-button'}
        type="button"
        onPointerDown={(event) => {
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
          setDragIntent(false);
        }}
        onPointerMove={(event) => {
          const pointerStart = pointerStartRef.current;
          if (!pointerStart) return;

          const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4;
          if (!moved) return;

          setDragIntent(true);
          event.currentTarget.blur();
        }}
        onPointerUp={() => {
          window.setTimeout(() => setDragIntent(false), 0);
        }}
        onPointerCancel={() => {
          pointerStartRef.current = null;
          setDragIntent(false);
        }}
        onClick={(event) => {
          const pointerStart = pointerStartRef.current;
          pointerStartRef.current = null;
          const moved = pointerStart
            ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4
            : false;
          if (moved) {
            event.currentTarget.blur();
            return;
          }

          event.stopPropagation();
          onOpen();
        }}
      >
        {pickerLabel}
      </button>
    );
  }

  return (
    <span className="node-type-picker-open-shell">
      <span className="node-type-picker-placeholder" aria-hidden="true">{pickerLabel}</span>
      <div className="node-type-picker nodrag nopan nowheel" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="node-type-picker-input"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
            if (menuRef.current) {
              menuRef.current.scrollTop = 0;
            }
          }}
          onBlur={closeOrCommitCustomLabel}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          spellCheck={false}
        />
        <div
          ref={menuRef}
          className="node-type-picker-menu nowheel"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onWheel={(event) => event.stopPropagation()}
        >
          {options.map((type, index) => (
            <button
              className={index === highlightedIndex ? 'active' : ''}
              key={type}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                choose(type);
              }}
            >
              {getNodeTypeLabel(type)}
            </button>
          ))}
          {options.length === 0 ? <div className="node-type-picker-empty">no match</div> : null}
        </div>
      </div>
    </span>
  );
}

type MidiCcLearnEvent = NonNullable<NonNullable<ShaderNodeData['midiInput']>['lastControlChange']>;

interface NumericScrubberProps {
  value: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onChange: (value: number) => void;
  midiLearnEvent?: MidiCcLearnEvent;
  onEditStart?: () => void;
  onMidiLearn?: (event: MidiCcLearnEvent) => void;
}

function NumericScrubber({
  value,
  min,
  max,
  integer = false,
  onChange,
  midiLearnEvent,
  onEditStart,
  onMidiLearn,
}: NumericScrubberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatDisplayValue(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastMidiLearnIdRef = useRef<number | null>(null);
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
      setDraft(formatDisplayValue(value));
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      setDraft(formatDisplayValue(value));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing || !midiLearnEvent || !onMidiLearn) return;
    if (lastMidiLearnIdRef.current === midiLearnEvent.id) return;

    lastMidiLearnIdRef.current = midiLearnEvent.id;
    const nextValue = constrainValue(midiLearnEvent.cc, min, max, integer);
    setDraft(formatDisplayValue(nextValue));
    onMidiLearn(midiLearnEvent);
  }, [editing, integer, max, midiLearnEvent, min, onMidiLearn]);

  function beginEditing() {
    lastMidiLearnIdRef.current = midiLearnEvent?.id ?? null;
    onEditStart?.();
    setEditing(true);
  }

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

    const nextValue = constrainValue(
      roundValue(drag.anchorValue + (drag.anchorY - event.clientY) * drag.step),
      min,
      max,
      integer,
    );
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
      beginEditing();
    }
  }

  function commitDraft() {
    const nextValue = Number(draft.trim());
    if (Number.isFinite(nextValue)) {
      onChange(constrainValue(nextValue, min, max, integer));
    } else {
      setDraft(formatDisplayValue(value));
    }
    setEditing(false);
  }

  function cancelDraft() {
    setDraft(formatDisplayValue(value));
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
        className="numeric-scrubber numeric-scrubber-editing nodrag nopan"
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
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
      className="numeric-scrubber nodrag nopan"
      role="spinbutton"
      tabIndex={-1}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={startDrag}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          beginEditing();
        }
      }}
    >
      {formatDisplayValue(value)}
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

function constrainValue(value: number, min?: number, max?: number, integer = false): number {
  const rounded = integer ? Math.round(value) : value;
  return Math.min(Math.max(rounded, min ?? -Infinity), max ?? Infinity);
}

function formatDisplayValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = roundValue(value);
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function makeNodeId(type: PatchNode['type'] | 'node', existingIds: Set<string>): string {
  const base = type.toLowerCase();
  let index = 1;
  let id = `${base}_${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${base}_${index}`;
  }
  return id;
}
