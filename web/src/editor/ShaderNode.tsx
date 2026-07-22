import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  useEffect,
  useId,
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
  type SyntheticEvent,
} from 'react';
import {
  CUSTOM_WAVE_MODES,
  customWaveUsesSustainEnd,
  customWaveUsesSustainStart,
  customWaveWithRangeOrigin,
  normalizedCustomWaveValue,
  normalizeCustomWave,
} from '../graph/customWave';
import {
  getNodeDefinition,
  getNodeTypeLabel,
  NODE_TYPE_LIST,
  sequencerCellParamName,
  sequencerGateParamName,
  sequencerGatesForRow,
  sequencerTriggerPositionParamName,
  sequencerTriggersForRow,
  sequencerUsesGateMode,
  SEQUENCER_GATE_INITIALIZED_PARAM,
  SEQUENCER_GATE_MODE_PARAM,
  SEQUENCER_INDEX_OUTPUT,
  sequencerOutputName,
  sequencerShape,
} from '../graph/nodeTypes';
import type { CustomWaveMode, CustomWavePoint, CustomWaveSettings, NodeDefinition, NodeType, PatchNode } from '../graph/types';
import { formatNumericValue } from './numericDisplay';
import {
  clampControlNodeSize,
  clampCustomWaveNodeSize,
  clampImageNodeSize,
  clampKeysNodeSize,
  clampSequencerNodeSize,
  clampScopeNodeSize,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_CUSTOM_WAVE_NODE_SIZE,
  DEFAULT_KEYS_NODE_SIZE,
  DEFAULT_SCOPE_NODE_SIZE,
  type ScopeNodeSize,
  type ShaderFlowEdge,
  type ShaderFlowNode,
  type ShaderNodeData,
} from './flowPatch';
import { getSampleWaveform, type SampleWaveform, type SampleWaveformBin } from '../audio/sampleWaveformCache';
import { graphDetailScreenEmphasis, graphDetailZoomScale } from './canvasZoom';
import { ChartGrid, chartGridColumns, chartGridRows, chartScaleTicks } from './chartGrid';

const CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS = 50;

export function ShaderNode({ data, selected, dragging }: NodeProps<ShaderFlowNode>) {
  const node = data.patchNode;
  const scopeGradientId = `scope-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const reactFlow = useReactFlow<ShaderFlowNode, ShaderFlowEdge>();
  const graphZoomScale = graphDetailZoomScale(data.canvasZoom ?? Number.NaN);
  const graphScreenEmphasis = graphDetailScreenEmphasis(graphZoomScale);
  const updateNodeInternals = useUpdateNodeInternals();
  const draggedPortRef = useRef<{ side: 'input' | 'output'; port: string; pointerId: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const scopeResizeRef = useRef<{
    pointerId: number;
    corner: 'bottom-left' | 'bottom-right';
    startPointer: { x: number; y: number };
    startSize: ScopeNodeSize;
    minWidth?: number;
  } | null>(null);
  const customWaveEditorRef = useRef<SVGSVGElement | null>(null);
  const customWaveDragRef = useRef<{ pointerId: number; index: number } | null>(null);
  const customWaveClickRef = useRef<{ index: number | null; time: number }>({ index: null, time: 0 });
  const customWaveDragCommitRef = useRef<{
    lastCommitTime: number;
    pending: { customWave: CustomWaveSettings; historyKey: string } | null;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ lastCommitTime: Number.NEGATIVE_INFINITY, pending: null, timeout: null });
  const inputPortRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const outputPortRowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const expressionInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextExpressionBlurRef = useRef(false);
  const [dragSource, setDragSource] = useState<{ side: 'input' | 'output'; port: string } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ side: 'input' | 'output'; port: string } | null>(null);
  const [scopeResizeCorner, setScopeResizeCorner] = useState<'bottom-left' | 'bottom-right' | null>(null);
  const [expressionDraft, setExpressionDraft] = useState(node.expression ?? '');
  const [imageAspectRatio, setImageAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO);
  const [pointerOver, setPointerOver] = useState(false);
  const definition = node.type ? getNodeDefinition(node as PatchNode) : null;
  const isExpression = node.type === 'Expression';
  const isGroup = node.type === 'Group';
  const isAreaCollapsedPresentation = data.isAreaCollapsedPresentation === true;
  const isAreaUiCollapsedPresentation = data.isAreaUiCollapsedPresentation === true;
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
  const showKeysDisplay = node.type === 'Keys';
  const showAccumulatorDisplay = node.type === 'Accumulator';
  const showSequencerDisplay = node.type === 'Sequencer';
  const showTempoDisplay = node.type === 'Tempo';
  const showAudioOutputDisplay = node.type === 'AudioOut';
  const showAudioInputDisplay = node.type === 'AudioInput';
  const showMidiNoteDisplay = node.type === 'MidiNote';
  const showCustomWaveEditor = node.type === 'CustomWave';
  const showSampleUpload = node.type === 'SamplePlayer';
  const showImageDisplay = node.type === 'Image';
  const showTopGraphic = showMeterDisplay || showScopeDisplay || showSliderDisplay || showButtonDisplay || showKeysDisplay || showCustomWaveEditor || showSampleUpload || showImageDisplay;
  const imageX = centeredCoordinateToUnit(data.audioImagePosition?.x ?? node.params.x ?? 0);
  const imageY = centeredCoordinateToUnit(data.audioImagePosition?.y ?? node.params.y ?? 0);
  const showResizableDisplay = showMeterDisplay || showScopeDisplay || showSliderDisplay || showButtonDisplay || showKeysDisplay || showCustomWaveEditor || showSampleUpload || showImageDisplay || showSequencerDisplay;
  const customWave = showCustomWaveEditor ? normalizeCustomWave(node.customWave, node.params) : null;
  const customWavePlayhead = clamp(data.audioPlayheads?.[0] ?? normalizeUnitInterval(node.params.phase ?? 0), 0, 1);
  const sequencer = showSequencerDisplay ? sequencerShape(node.params) : null;
  const amplitudeRange = displayAmplitudeRange(node.params.range);
  const meterMode = monitorDisplayMode(node.params.mode, 'unipolar');
  const scopeMode = monitorDisplayMode(node.params.mode, 'bipolar');
  const signedMeterLevel = data.audioMeter?.input ?? 0;
  const unipolarMeterLevel = Math.max(0, Math.min(1, (data.audioMeter?.output ?? 0) / amplitudeRange));
  const bipolarMeterLevel = Math.max(-1, Math.min(1, signedMeterLevel / amplitudeRange));
  const meterPeak = useRecentMaxLevel(unipolarMeterLevel, showMeterDisplay && meterMode === 'unipolar');
  const bipolarMeterPeaks = useRecentBipolarLevels(bipolarMeterLevel, showMeterDisplay && meterMode === 'bipolar');
  const meterLevel = meterMode === 'bipolar' ? bipolarMeterLevel : unipolarMeterLevel;
  const outputMeterLeft = Math.max(0, Math.min(1, data.audioOutputMeter?.left ?? 0));
  const outputMeterRight = Math.max(0, Math.min(1, data.audioOutputMeter?.right ?? 0));
  const scopePath = showScopeDisplay ? samplesToScopePath(data.audioScope?.samples ?? [], amplitudeRange, scopeMode) : '';
  const scopeSize = showKeysDisplay
    ? clampKeysNodeSize(node.scopeSize ?? DEFAULT_KEYS_NODE_SIZE)
    : showSliderDisplay || showButtonDisplay
    ? clampControlNodeSize(node.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE)
    : showMeterDisplay || showScopeDisplay
      ? clampScopeNodeSize(node.scopeSize ?? DEFAULT_SCOPE_NODE_SIZE)
    : DEFAULT_SCOPE_NODE_SIZE;
  const waveformDisplaySize = showImageDisplay
    ? clampImageNodeSize(node.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE, imageAspectRatio)
    : showCustomWaveEditor || showSampleUpload
      ? clampCustomWaveNodeSize(node.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE)
      : DEFAULT_CUSTOM_WAVE_NODE_SIZE;
  const sequencerDisplaySize = sequencer
    ? clampSequencerNodeSize(
        node.scopeSize ?? { width: sequencer.steps * 26, height: sequencer.rows * 26 },
        sequencer.steps,
        sequencer.rows,
      )
    : DEFAULT_SCOPE_NODE_SIZE;
  const displaySize = showSequencerDisplay
    ? sequencerDisplaySize
    : showCustomWaveEditor || showSampleUpload || showImageDisplay ? waveformDisplaySize : scopeSize;
  const graphDetailSize = {
    width: displaySize.width * graphZoomScale,
    height: displaySize.height * graphZoomScale,
  };
  const meterScaleTicks = showMeterDisplay ? amplitudeScaleTicks(amplitudeRange, graphDetailSize.width, meterMode) : [];
  const meterGridTicks = showMeterDisplay ? chartGridColumns(graphDetailSize.width) : [];
  const meterGridRows = showMeterDisplay ? chartGridRows(graphDetailSize.height).map((tick) => tick.fraction) : [];
  const scopeScaleTicks = showScopeDisplay
    ? chartScaleTicks(amplitudeRange, scopeMode === 'bipolar' ? -amplitudeRange : 0, graphDetailSize.height, 'vertical')
    : [];
  const scopeGridTicks = showScopeDisplay ? chartGridColumns(graphDetailSize.width) : [];
  const nodeSizeStyle = showResizableDisplay
    ? ({
        '--node-display-width': `${displaySize.width}px`,
        '--node-display-height': `${displaySize.height}px`,
        ...(showImageDisplay ? { '--image-aspect-ratio': String(imageAspectRatio) } : {}),
        ...(sequencer ? { '--sequencer-steps': String(sequencer.steps), '--sequencer-rows': String(sequencer.rows) } : {}),
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
    node.type !== 'Outs'
    && definition?.inputs.some((input) => input.name === 'signal')
    && previewInputPort !== 'signal',
  );
  const headerInputPort = showHeaderInput ? 'signal' : null;
  const showHeaderOutput = node.type !== 'Ins' && node.type !== 'Sequencer' && outputCount === 1 && !previewAddsOutput;
  const headerOutputPort = showHeaderOutput && definition ? definition.outputs[0]?.name ?? null : null;
  const showHeaderInputPort = Boolean(headerInputPort);
  const showHeaderOutputPort = Boolean(headerOutputPort);
  const selectedLinkInputs = data.selectedLinkPorts?.inputs ?? [];
  const selectedLinkOutputs = data.selectedLinkPorts?.outputs ?? [];
  const selectorSelectedIndex = isSelector
    ? Math.floor(Number.isFinite(data.audioSelectorIndex) ? data.audioSelectorIndex ?? 0 : node.params.select ?? 0)
    : 0;
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
    '--node-scale': String(node.scale ?? 1),
    '--graph-screen-scale': String(graphScreenEmphasis / graphZoomScale),
  } as CSSProperties;
  const className = [
    'shader-node',
    showMeterDisplay ? 'shader-node-meter' : '',
    showScopeDisplay ? 'shader-node-scope' : '',
    showSliderDisplay ? 'shader-node-slider' : '',
    showButtonDisplay ? 'shader-node-button' : '',
    showKeysDisplay ? 'shader-node-keys' : '',
    showAccumulatorDisplay ? 'shader-node-accumulator' : '',
    showSequencerDisplay ? 'shader-node-sequencer' : '',
    showAudioOutputDisplay ? 'shader-node-audio-out' : '',
    showSampleUpload ? 'shader-node-sampleplayer' : '',
    showImageDisplay ? 'shader-node-image' : '',
    showAudioInputDisplay ? 'shader-node-audio-input' : '',
    showMidiNoteDisplay ? 'shader-node-midi-note' : '',
    showCustomWaveEditor ? 'shader-node-custom-wave' : '',
    isExpression ? 'shader-node-expression' : '',
    isGroup ? 'shader-node-group' : '',
    hasDspErrors ? 'shader-node-dsp-error' : '',
    selected ? 'shader-node-selected' : '',
    dragging ? 'shader-node-dragging' : '',
    compactPorts ? 'shader-node-compact' : '',
    isAreaCollapsedPresentation ? 'shader-node-area-hidden' : '',
    isAreaUiCollapsedPresentation ? 'shader-node-area-ui-collapsed' : '',
  ].filter(Boolean).join(' ');

  useLayoutEffect(() => {
    const animationFrame = requestAnimationFrame(() => updateNodeInternals(node.id));
    return () => cancelAnimationFrame(animationFrame);
  }, [
    compactPorts,
    isAreaCollapsedPresentation,
    isAreaUiCollapsedPresentation,
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
    node.scale,
    imageAspectRatio,
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
    return () => {
      const dragCommit = customWaveDragCommitRef.current;
      if (dragCommit.timeout !== null) clearTimeout(dragCommit.timeout);
      dragCommit.timeout = null;
      dragCommit.pending = null;
    };
  }, []);

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
      const rawWidth = resize.corner === 'bottom-left'
        ? resize.startSize.width - deltaX
        : resize.startSize.width + deltaX;
      const constrainedWidth = resize.minWidth === undefined ? rawWidth : Math.max(resize.minWidth, rawWidth);
      const rawNextSize = { width: constrainedWidth, height: resize.startSize.height + deltaY };
      const nextSize = showSequencerDisplay && sequencer
        ? clampSequencerNodeSize({ width: constrainedWidth, height: constrainedWidth * sequencer.rows / sequencer.steps }, sequencer.steps, sequencer.rows)
        : showImageDisplay
        ? clampImageNodeSize({ width: rawWidth, height: rawWidth / imageAspectRatio }, imageAspectRatio)
        : showCustomWaveEditor || showSampleUpload
        ? clampCustomWaveNodeSize(rawNextSize)
        : showKeysDisplay
          ? clampKeysNodeSize(rawNextSize)
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
  }, [data, imageAspectRatio, node.id, reactFlow, sequencer, showCustomWaveEditor, showSampleUpload, showImageDisplay, showSequencerDisplay, showSliderDisplay, showButtonDisplay, showKeysDisplay]);

  useEffect(() => {
    setImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
  }, [node.image?.url]);

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    setImageAspectRatio(aspect);
    const width = node.scopeSize?.width ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.width;
    data.onScopeResize(node.id, clampImageNodeSize({ width, height: width / aspect }, aspect), 'right');
  }

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
      scheduleCustomWaveDragCommit({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    }

    function stopDragging(pointerId: number) {
      if (!customWaveDragRef.current || customWaveDragRef.current.pointerId !== pointerId) return;

      flushCustomWaveDragCommit();
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
    if (isAreaUiCollapsedPresentation || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sequencerPanel = showSequencerDisplay
      ? event.currentTarget.closest('.shader-node-sequencer')?.querySelector<HTMLElement>('.sequencer-node-panel')
      : null;
    const sequencerBody = event.currentTarget.closest('.shader-node-sequencer')?.querySelector<HTMLElement>('.shader-node-body-sequencer');
    const sequencerInputs = sequencerBody?.querySelector<HTMLElement>('.shader-inputs');
    const sequencerOutputs = sequencerBody?.querySelector<HTMLElement>('.shader-outputs');
    const sequencerPanelRect = sequencerPanel?.getBoundingClientRect();
    const hasVisibleSequencerInputs = sequencerInputs?.querySelector('.shader-port') !== null;
    const hasVisibleSequencerOutputs = sequencerOutputs?.querySelector('.shader-port') !== null;
    const sequencerMinWidth = hasVisibleSequencerInputs && hasVisibleSequencerOutputs
      ? Math.ceil((sequencerInputs?.getBoundingClientRect().width ?? 0) + (sequencerOutputs?.getBoundingClientRect().width ?? 0) + 10)
      : undefined;
    scopeResizeRef.current = {
      pointerId: event.pointerId,
      corner,
      startPointer: { x: event.clientX, y: event.clientY },
      startSize: sequencerPanelRect
        ? { width: sequencerPanelRect.width, height: sequencerPanelRect.height }
        : displaySize,
      minWidth: sequencerMinWidth,
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

  function scheduleCustomWaveDragCommit(nextCustomWave: CustomWaveSettings, historyKey: string) {
    const dragCommit = customWaveDragCommitRef.current;
    const now = performance.now();
    dragCommit.pending = { customWave: nextCustomWave, historyKey };

    const elapsed = now - dragCommit.lastCommitTime;
    if (elapsed >= CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS) {
      flushCustomWaveDragCommit(now);
      return;
    }

    if (dragCommit.timeout !== null) return;
    dragCommit.timeout = setTimeout(() => {
      dragCommit.timeout = null;
      flushCustomWaveDragCommit();
    }, CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS - elapsed);
  }

  function flushCustomWaveDragCommit(commitTime = performance.now()) {
    const dragCommit = customWaveDragCommitRef.current;
    if (dragCommit.timeout !== null) clearTimeout(dragCommit.timeout);
    dragCommit.timeout = null;

    const pending = dragCommit.pending;
    if (!pending) return;
    dragCommit.pending = null;
    dragCommit.lastCommitTime = commitTime;
    commitCustomWave(pending.customWave, pending.historyKey);
  }

  function customWavePointFromPointer(event: Pick<globalThis.PointerEvent, 'clientX' | 'clientY'>): CustomWavePoint | null {
    const editor = customWaveEditorRef.current;
    if (!editor) return null;

    const rect = editor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const padding = 12;
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
        {compactPorts && !revealCompactPorts ? (
          <CollapsedNodeLabel
            nodeType={node.type}
            customLabel={node.customLabel}
            onChange={(label) => data.onCustomLabelChange?.(node.id, label)}
          />
        ) : (
          <NodeTypePicker
            nodeType={node.type}
            displayLabel={isGroup ? node.subpatchName ?? node.id : undefined}
            isEditingSubpatch={data.isEditingSubpatch === true}
            open={data.isTypePickerOpen}
            onOpen={() => data.onTypeEditStart(node.id)}
            onClose={data.onTypeEditEnd}
            onCancel={() => data.onTypeEditCancel(node.id)}
            onChange={(type) => data.onTypeChange(node.id, type)}
            onCustomLabelCommit={isGroup ? (label) => data.onSubpatchNameChange?.(node.id, label) : undefined}
          />
        )}
        {!forceCompactPorts && !isAreaUiCollapsedPresentation ? (
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
          const normalOutputPorts = showSequencerDisplay
            ? visibleOutputPorts.filter((output) => output.name === SEQUENCER_INDEX_OUTPUT)
            : visibleOutputPorts;
          const showBody = !compactPorts
            || isExpression
            || showSampleUpload
            || showImageDisplay
            || showAudioInputDisplay
            || showMidiNoteDisplay
            || showTempoDisplay
            || showSequencerDisplay
            || showCustomWaveEditor
            || showSliderDisplay
            || showButtonDisplay
            || showKeysDisplay
            || showAccumulatorDisplay
            || showAudioOutputDisplay
            || visibleInputPorts.length > 0
            || (normalOutputPorts.length > 0 && !showHeaderOutputPort)
            || showMeterDisplay
            || showScopeDisplay;

          if (!showBody) return null;

          return (
        <div className={[
          'shader-node-body',
          isExpression ? 'shader-node-body-expression' : '',
          showAccumulatorDisplay ? 'shader-node-body-accumulator' : '',
          showSequencerDisplay ? 'shader-node-body-sequencer' : '',
          showAudioOutputDisplay ? 'shader-node-body-audio-out' : '',
          showAudioInputDisplay ? 'shader-node-body-audio-input' : '',
          showMidiNoteDisplay ? 'shader-node-body-midi-note' : '',
          showTopGraphic ? 'shader-node-body-graphic' : '',
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
          <div className={showTopGraphic ? 'shader-node-content-graphic' : 'shader-node-content-graphic-empty'}>
          {showSampleUpload ? (
            <SampleWaveformDisplay
              sampleUrl={node.sample?.url}
              playheads={data.audioPlayheads}
              start={data.audioSampleParams?.start ?? node.params.start ?? 0}
              end={data.audioSampleParams?.end ?? node.params.end ?? 1}
              attack={data.audioSampleParams?.attack ?? node.params.attack ?? 0}
              release={data.audioSampleParams?.release ?? node.params.release ?? 0}
              detail={Math.max(120, Math.round(displaySize.width))}
              onStartChange={(value) => data.onParamChange(node.id, 'start', value)}
              onEndChange={(value) => data.onParamChange(node.id, 'end', value)}
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
          {showImageDisplay ? (
            <div className="shader-node-full-width-display image-node-display nodrag nopan" aria-label={node.image?.url ? 'Image coordinate preview' : 'Image preview'}>
              {node.image?.url ? <img src={node.image.url} alt={node.image.name} draggable={false} onLoad={handleImageLoad} /> : <span>Select an image</span>}
              {node.image?.url ? <>
                <i className="image-node-crosshair image-node-crosshair-vertical" style={{ left: `calc(${imageX} * (100% - 1px))` }} />
                <i className="image-node-crosshair image-node-crosshair-horizontal" style={{ top: `calc(${imageY} * (100% - 1px))` }} />
              </> : null}
            </div>
          ) : null}
          {showImageDisplay ? (
            <div className="sample-upload-row">
              <button className="sample-upload-button nodrag nopan" type="button" title={node.image?.name ?? 'Select image'} onClick={() => data.onImageSelect?.(node.id)} onPointerDown={(event) => event.stopPropagation()}>
                {node.image?.name ?? 'Select image'}
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
              rangeMin={node.params.rangeMin ?? -1}
              rangeMax={node.params.rangeMax ?? 1}
              playhead={customWavePlayhead}
              compact={!showAllPorts}
              displaySize={displaySize}
              graphZoomScale={graphZoomScale}
              graphScreenEmphasis={graphScreenEmphasis}
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
          {showKeysDisplay ? (
            <KeysDisplay
              size={node.params.size ?? 12}
              startNote={node.params.startNote ?? 60}
              onNoteChange={(note) => {
                data.onParamChange(node.id, 'note', note ?? 0);
                data.onParamChange(node.id, 'frequency', note === null ? 0 : midiNoteToFrequency(note));
              }}
            />
          ) : null}
          {showMeterDisplay ? (
            <div className="audio-node-meter-display" aria-hidden="true">
              <svg className="audio-node-meter-grid" viewBox="0 0 100 48" preserveAspectRatio="none" focusable="false">
                {meterGridRows.map((fraction) => (
                  <line key={`row-${fraction}`} className="audio-node-meter-grid-line" x1="0" y1={fraction * 48} x2="100" y2={fraction * 48} />
                ))}
                {meterGridTicks.map((tick) => (
                  <line key={tick.fraction} className={tick.major ? 'audio-node-meter-grid-line audio-node-meter-grid-line-major' : 'audio-node-meter-grid-line'} x1={tick.fraction * 100} y1="0" x2={tick.fraction * 100} y2="48" />
                ))}
              </svg>
              <span
                className="audio-node-meter-fill"
                style={meterMode === 'bipolar'
                  ? {
                      left: `${(0.5 + Math.min(0, meterLevel) * 0.5) * 100}%`,
                      width: `${Math.abs(meterLevel) * 50}%`,
                    }
                  : { width: `${meterLevel * 100}%` }}
              />
              {meterMode === 'bipolar' ? <>
                <span className="audio-node-meter-peak" style={{ left: `${(0.5 + bipolarMeterPeaks.positive * 0.5) * 100}%` }} />
                <span className="audio-node-meter-peak" style={{ left: `${(0.5 - bipolarMeterPeaks.negative * 0.5) * 100}%` }} />
              </> : (
                <span className="audio-node-meter-peak" style={{ left: `${meterPeak * 100}%` }} />
              )}
              <span className="audio-node-meter-scale">
                {meterScaleTicks.map((tick) => (
                  <span key={tick.fraction} className={[
                    'audio-node-meter-scale-label',
                    tick.fraction === 0 ? 'audio-node-meter-scale-label-min' : '',
                    tick.fraction === 1 ? 'audio-node-meter-scale-label-max' : '',
                  ].filter(Boolean).join(' ')} style={{ left: `${tick.fraction * 100}%` }}>
                    {tick.label}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          {showScopeDisplay ? (
            <div className="audio-node-scope-display" aria-hidden="true">
              <ChartGrid width={160} height={48} columns={scopeGridTicks} rows={scopeScaleTicks} showRowLabels />
              <svg className="audio-node-scope-waveform" viewBox="0 0 160 48" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={scopeGradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0">
                    <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.3" />
                    <stop offset="0.65" stopColor="var(--color-accent)" stopOpacity="0.72" />
                    <stop offset="1" stopColor="var(--color-accent)" stopOpacity="1" />
                  </linearGradient>
                </defs>
                <path d={scopePath} style={{ stroke: `url(#${scopeGradientId})` }} />
              </svg>
            </div>
          ) : null}
          </div>
          {showAccumulatorDisplay ? (
            <div className="accumulator-value-label" aria-label="Accumulator current value">
              {formatAccumulatorValue(data.audioAccumulatorValue ?? node.params.min ?? 0)}
            </div>
          ) : null}
          {showSequencerDisplay && sequencer ? (
            <SequencerGrid
              params={node.params}
              rows={sequencer.rows}
              steps={sequencer.steps}
              beatLength={sequencer.beatLength}
              currentStep={data.audioSequencerStep}
              selectedLinkOutputs={selectedLinkOutputs}
              setOutputRowRef={(port, element) => {
                outputPortRowsRef.current[port] = element;
              }}
              onParamsChange={(values) => data.onParamsChange(node.id, values)}
            />
          ) : null}
          {showAudioOutputDisplay ? (
            <div className="audio-out-node-meter" aria-label="Audio output level">
              <AudioOutputMeterRow label="L" level={outputMeterLeft} />
              <AudioOutputMeterRow label="R" level={outputMeterRight} />
            </div>
          ) : null}
          <div className={[
            showTopGraphic ? 'shader-node-content-ports' : 'shader-node-content-ports-empty',
            visibleOutputPorts.length === 0 || showHeaderOutputPort ? 'shader-node-content-ports-no-outputs' : '',
          ].filter(Boolean).join(' ')}>
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
                    selectorSelectedIndex === Number(input.name) ? 'selector-index-button-active' : '',
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
              ) : showSequencerDisplay && input.name === 'mode' && !input.preview ? (
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
                    className="sequencer-mode-select nodrag nopan"
                    aria-label="Sequencer mode"
                    value={sequencerUsesGateMode(node.params) ? '1' : '0'}
                    onChange={(event) => {
                      const gateMode = Number(event.currentTarget.value) >= 0.5;
                      const values: Record<string, number> = {
                        [SEQUENCER_GATE_MODE_PARAM]: gateMode ? 1 : 0,
                      };
                      if (gateMode) {
                        values[SEQUENCER_GATE_INITIALIZED_PARAM] = 1;
                        for (let rowIndex = 0; rowIndex < (sequencer?.rows ?? 0); rowIndex += 1) {
                          const triggers = sequencerTriggersForRow(node.params, rowIndex, sequencer?.steps ?? 0);
                          for (let stepIndex = 0; stepIndex < (sequencer?.steps ?? 0); stepIndex += 1) {
                            values[sequencerGateParamName(rowIndex, stepIndex, 'active')] = 0;
                          }
                          for (const [slot, trigger] of triggers.entries()) {
                            const start = Math.min(sequencer?.steps ?? 0, trigger.position);
                            values[sequencerGateParamName(rowIndex, slot, 'active')] = 1;
                            values[sequencerGateParamName(rowIndex, slot, 'start')] = start;
                            values[sequencerGateParamName(rowIndex, slot, 'end')] = Math.min(sequencer?.steps ?? 0, start + 1);
                          }
                        }
                      } else {
                        for (let rowIndex = 0; rowIndex < (sequencer?.rows ?? 0); rowIndex += 1) {
                          const gates = sequencerGatesForRow(node.params, rowIndex, sequencer?.steps ?? 0);
                          for (let stepIndex = 0; stepIndex < (sequencer?.steps ?? 0); stepIndex += 1) {
                            values[sequencerCellParamName(rowIndex, stepIndex)] = 0;
                            values[sequencerGateParamName(rowIndex, stepIndex, 'active')] = 0;
                          }
                          for (const [slot, gate] of gates.entries()) {
                            const position = Math.max(0, Math.min((sequencer?.steps ?? 1) - SEQUENCER_TRIGGER_GRAB_FRACTION, gate.start));
                            values[sequencerCellParamName(rowIndex, slot)] = 1;
                            values[sequencerTriggerPositionParamName(rowIndex, slot)] = position;
                          }
                        }
                      }
                      data.onParamsChange(node.id, values);
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">trigger</option>
                    <option value="1">gate</option>
                  </select>
                </>
              ) : (showMeterDisplay || showScopeDisplay) && input.name === 'mode' && !input.preview ? (
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
                    className="display-mode-select nodrag nopan"
                    aria-label={`${showMeterDisplay ? 'Meter' : 'Scope'} mode`}
                    value={String(Math.round(node.params.mode ?? input.defaultValue ?? 0))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">unipolar</option>
                    <option value="1">bipolar</option>
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
                    <option value="1">trigger</option>
                    <option value="2">temporary</option>
                  </select>
                </>
              ) : showAccumulatorDisplay && input.name === 'mode' && !input.preview ? (
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
                    className="accumulator-mode-select nodrag nopan"
                    aria-label="Accumulator mode"
                    value={String(Math.round(node.params.mode ?? input.defaultValue ?? 0))}
                    onChange={(event) => {
                      data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                      event.currentTarget.blur();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <option value="0">trigger</option>
                    <option value="1">continuous</option>
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
              {!input.preview && node.type !== 'Outs' && input.valueEditor !== false && input.defaultValue !== undefined && !(showSliderDisplay && input.name === 'direction') && !(showSequencerDisplay && input.name === 'mode') && !(showButtonDisplay && input.name === 'mode') && !(showAccumulatorDisplay && input.name === 'mode') && !(showSampleUpload && input.name === 'mode') && !(showMidiNoteDisplay && input.name === 'voices') && !(showTempoDisplay && (input.name === 'source' || input.name === 'midiSource')) ? (
                <NumericScrubber
                  value={node.params[input.name] ?? input.defaultValue ?? 0}
                  min={input.min}
                  max={input.max}
                  integer={input.integer}
                  step={input.step}
                  onChange={(value) => data.onParamChange(node.id, input.name, value)}
                  onClear={isSelector && isSelectorValuePort(input.name) ? () => data.onSelectorInputClear?.(node.id, input.name) : undefined}
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
          {normalOutputPorts.length > 0 && !showHeaderOutputPort ? (
            <div className="shader-ports shader-outputs">
              {normalOutputPorts.map((output) => (
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
          </div>
          {showResizableDisplay && !isAreaUiCollapsedPresentation ? (
            <>
              <span
                className={[
                  'audio-node-scope-resize-handle audio-node-scope-resize-handle-left nodrag nopan',
                  scopeResizeCorner === 'bottom-left' ? 'audio-node-scope-resize-handle-active' : '',
                ].filter(Boolean).join(' ')}
                title={showSequencerDisplay ? 'Resize sequencer' : showCustomWaveEditor ? 'Resize custom wave' : showSampleUpload ? 'Resize sample waveform' : showImageDisplay ? 'Resize image' : showKeysDisplay ? 'Resize keys' : showSliderDisplay ? 'Resize slider' : showButtonDisplay ? 'Resize button' : showMeterDisplay ? 'Resize meter' : 'Resize scope'}
                onPointerDown={(event) => handleScopeResizePointerDown(event, 'bottom-left')}
                onClick={handleScopeResizeClick}
                onDoubleClick={(event) => event.stopPropagation()}
              />
              <span
                className={[
                  'audio-node-scope-resize-handle audio-node-scope-resize-handle-right nodrag nopan',
                  scopeResizeCorner === 'bottom-right' ? 'audio-node-scope-resize-handle-active' : '',
                ].filter(Boolean).join(' ')}
                title={showSequencerDisplay ? 'Resize sequencer' : showCustomWaveEditor ? 'Resize custom wave' : showSampleUpload ? 'Resize sample waveform' : showImageDisplay ? 'Resize image' : showKeysDisplay ? 'Resize keys' : showSliderDisplay ? 'Resize slider' : showButtonDisplay ? 'Resize button' : showMeterDisplay ? 'Resize meter' : 'Resize scope'}
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

interface SampleWaveformDisplayProps {
  sampleUrl?: string;
  playheads?: number[];
  start: number;
  end: number;
  attack: number;
  release: number;
  detail: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
}

function SampleWaveformDisplay({
  sampleUrl,
  playheads,
  start,
  end,
  attack,
  release,
  detail,
  onStartChange,
  onEndChange,
}: SampleWaveformDisplayProps) {
  const [waveform, setWaveform] = useState<SampleWaveform | null>(null);
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ boundary: 'start' | 'end'; pointerId: number } | null>(null);
  const safeStart = clamp(start, 0, 1);
  const safeEnd = clamp(end, 0, 1);
  const width = 300;
  const height = 128;
  const horizontalPadding = 8;
  const verticalPadding = 0;
  const innerWidth = width - horizontalPadding * 2;
  const sampleDuration = Math.max(0.001, waveform?.duration ?? 1);
  const safeAttack = Math.max(0, attack);
  const safeRelease = Math.max(0, release);
  const playbackDirection = safeEnd >= safeStart ? 1 : -1;
  const startSeconds = safeStart * sampleDuration;
  const endSeconds = safeEnd * sampleDuration;
  const attackEndSeconds = startSeconds + playbackDirection * safeAttack;
  const releaseEndSeconds = endSeconds + playbackDirection * safeRelease;
  const timelineStart = Math.min(0, attackEndSeconds, releaseEndSeconds);
  const timelineEnd = Math.max(sampleDuration, attackEndSeconds, releaseEndSeconds);
  const timelineDuration = Math.max(0.001, timelineEnd - timelineStart);
  const timelineX = (seconds: number) => horizontalPadding + ((seconds - timelineStart) / timelineDuration) * innerWidth;
  const waveformPath = waveform
    ? sampleWaveformPath(
      waveformBinsForDetail(waveform.bins, detail),
      timelineX(0),
      timelineX(sampleDuration),
      height,
      verticalPadding,
    )
    : '';
  const activePlayheads = playheads?.length ? playheads : [safeStart];
  const startX = timelineX(startSeconds);
  const endX = timelineX(endSeconds);
  const attackEndX = timelineX(attackEndSeconds);
  const releaseEndX = timelineX(releaseEndSeconds);
  const rangeStartX = Math.min(startX, endX);
  const rangeEndX = Math.max(startX, endX);
  const attackPhaseX = Math.min(startX, attackEndX);
  const attackPhaseWidth = Math.abs(attackEndX - startX);
  const releasePhaseX = Math.min(endX, releaseEndX);
  const releasePhaseWidth = Math.abs(releaseEndX - endX);

  function updateBoundaryFromPointer(event: Pick<PointerEvent<SVGSVGElement>, 'clientX'>) {
    const drag = dragRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!drag || !bounds || bounds.width <= 0) return;
    // Pointer coordinates span the full SVG, while the editable timeline spans
    // the horizontally inset chart area. Convert through the SVG coordinate system first
    // so clicking a boundary leaves it at its current value.
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const value = clamp((timelineStart + ((svgX - horizontalPadding) / innerWidth) * timelineDuration) / sampleDuration, 0, 1);
    if (drag.boundary === 'start') onStartChange(value);
    else onEndChange(value);
  }

  function handleBoundaryPointerDown(event: PointerEvent<SVGRectElement>, boundary: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { boundary, pointerId: event.pointerId };
    canvasRef.current?.setPointerCapture(event.pointerId);
    updateBoundaryFromPointer(event);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateBoundaryFromPointer(event);
  }

  function finishBoundaryDrag(pointerId: number) {
    if (dragRef.current?.pointerId !== pointerId) return;
    dragRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    setWaveform(null);
    if (!sampleUrl) return () => {
      cancelled = true;
    };

    void getSampleWaveform(sampleUrl).then((nextWaveform) => {
      if (!cancelled) setWaveform(nextWaveform);
    });
    return () => {
      cancelled = true;
    };
  }, [sampleUrl]);

  return (
    <div className="sample-waveform-display nodrag nopan">
      <svg
        ref={canvasRef}
        className="sample-waveform-canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label={sampleUrl ? 'Sample waveform' : 'Sample waveform preview'}
        role="img"
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <g className="sample-waveform-chart-chrome">
          <line className="custom-wave-grid-line" x1={horizontalPadding} y1={verticalPadding} x2={width - horizontalPadding} y2={verticalPadding} />
          <line className="custom-wave-grid-line custom-wave-zero" x1={horizontalPadding} y1={height / 2} x2={width - horizontalPadding} y2={height / 2} />
          <line className="custom-wave-grid-line" x1={horizontalPadding} y1={height - verticalPadding} x2={width - horizontalPadding} y2={height - verticalPadding} />
          {waveformPath ? <path className="sample-waveform-path" d={waveformPath} /> : null}
          <rect className="sample-waveform-fade" x={horizontalPadding} y={verticalPadding} width={rangeStartX - horizontalPadding} height={height - verticalPadding * 2} />
          <rect className="sample-waveform-fade" x={rangeEndX} y={verticalPadding} width={width - horizontalPadding - rangeEndX} height={height - verticalPadding * 2} />
          {safeAttack > 0 ? <rect className="sample-waveform-phase is-attack" x={attackPhaseX} y={verticalPadding} width={attackPhaseWidth} height={height - verticalPadding * 2} /> : null}
          {safeRelease > 0 ? <rect className="sample-waveform-phase is-release" x={releasePhaseX} y={verticalPadding} width={releasePhaseWidth} height={height - verticalPadding * 2} /> : null}
          {activePlayheads.map((playhead, index) => {
            const playheadX = timelineX(clamp(playhead, 0, 1) * sampleDuration);
            return <line className="wave-playhead-line" key={`${index}:${playhead}`} x1={playheadX} y1={verticalPadding} x2={playheadX} y2={height - verticalPadding} />;
          })}
          <line className="sample-waveform-boundary-line is-start" x1={startX} y1={verticalPadding} x2={startX} y2={height - verticalPadding} />
          <line className="sample-waveform-boundary-line is-end" x1={endX} y1={verticalPadding} x2={endX} y2={height - verticalPadding} />
          {safeAttack > 0 ? <line className="sample-waveform-phase-line is-attack" x1={startX} y1={verticalPadding} x2={attackEndX} y2={height - verticalPadding}><title>Attack phase</title></line> : null}
          {safeRelease > 0 ? <line className="sample-waveform-phase-line is-release" x1={endX} y1={verticalPadding} x2={releaseEndX} y2={height - verticalPadding}><title>Release phase</title></line> : null}
        </g>
        <rect
          className="sample-waveform-boundary-hit-target is-start"
          x={startX - 8}
          y={verticalPadding}
          width={16}
          height={height - verticalPadding * 2}
          aria-label="Drag sample start"
          onPointerDown={(event) => handleBoundaryPointerDown(event, 'start')}
        />
        <rect
          className="sample-waveform-boundary-hit-target is-end"
          x={endX - 8}
          y={verticalPadding}
          width={16}
          height={height - verticalPadding * 2}
          aria-label="Drag sample end"
          onPointerDown={(event) => handleBoundaryPointerDown(event, 'end')}
        />
      </svg>
    </div>
  );
}

function sampleWaveformPath(
  bins: SampleWaveformBin[],
  startX: number,
  endX: number,
  height: number,
  verticalPadding: number,
): string {
  if (bins.length === 0) return '';
  const innerHeight = height - verticalPadding * 2;
  return bins.map((bin, index) => {
    const x = startX + (index / Math.max(1, bins.length - 1)) * (endX - startX);
    const top = verticalPadding + (1 - (clamp(bin.max, -1, 1) + 1) / 2) * innerHeight;
    const bottom = verticalPadding + (1 - (clamp(bin.min, -1, 1) + 1) / 2) * innerHeight;
    return `M${roundPathNumber(x)} ${roundPathNumber(top)} V${roundPathNumber(bottom)}`;
  }).join(' ');
}

function waveformBinsForDetail(bins: SampleWaveformBin[], detail: number): SampleWaveformBin[] {
  const count = Math.max(1, Math.min(bins.length, Math.round(detail)));
  if (count >= bins.length) return bins;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * bins.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * bins.length / count));
    let min = 0;
    let max = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      const source = bins[sourceIndex];
      min = Math.min(min, source.min);
      max = Math.max(max, source.max);
    }
    return { min, max };
  });
}

function normalizeUnitInterval(value: number): number {
  return ((value % 1) + 1) % 1;
}

function centeredCoordinateToUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return (Math.max(-1, Math.min(1, value)) + 1) * 0.5;
}

interface CustomWaveEditorProps {
  customWave: CustomWaveSettings;
  rangeMin: number;
  rangeMax: number;
  playhead: number;
  compact: boolean;
  displaySize: ScopeNodeSize;
  graphZoomScale: number;
  graphScreenEmphasis: number;
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

function useRecentBipolarLevels(level: number, enabled: boolean): { positive: number; negative: number } {
  const latestLevelRef = useRef(level);
  const timeoutRef = useRef<number | null>(null);
  const [recentLevels, setRecentLevels] = useState({ positive: 0, negative: 0 });

  useEffect(() => {
    latestLevelRef.current = level;
  }, [level]);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecentLevels({ positive: 0, negative: 0 });
      return;
    }

    setRecentLevels((current) => {
      const next = {
        positive: Math.max(current.positive, level, 0),
        negative: Math.max(current.negative, -level, 0),
      };
      if (next.positive !== current.positive || next.negative !== current.negative) {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return next;
      }

      if (timeoutRef.current === null) {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          const latest = latestLevelRef.current;
          setRecentLevels({ positive: Math.max(0, latest), negative: Math.max(0, -latest) });
        }, METER_RECENT_MAX_HOLD_MS);
      }
      return current;
    });
  }, [enabled, level]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  return recentLevels;
}

function AudioOutputMeterRow({ label, level }: { label: string; level: number }) {
  const normalized = Math.max(0, Math.min(1, level));
  const recentMax = useRecentMaxLevel(normalized, true);

  return (
    <div className="audio-out-node-meter-row" aria-hidden="true">
      <span className="audio-out-node-meter-label">{label}</span>
      <span className="audio-out-node-meter-track">
        <span className="audio-out-node-meter-fill" style={{ width: `${normalized * 100}%` }} />
        <span className="audio-out-node-meter-peak" style={{ left: `${recentMax * 100}%` }} />
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
  const dragPointerRef = useRef<number | null>(null);
  const normalized = clamp(displayValue ?? value, 0, 1);
  const fillStyle = direction === 'vertical'
    ? { height: `${normalized * 100}%` }
    : { width: `${normalized * 100}%` };

  function updateFromPointer(event: PointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextValue = direction === 'vertical'
      ? 1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height))
      : (event.clientX - bounds.left) / Math.max(1, bounds.width);
    onChange(clamp(nextValue, 0, 1));
  }

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
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!event.isPrimary || event.button !== 0) return;
          dragPointerRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragPointerRef.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          updateFromPointer(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (dragPointerRef.current === event.pointerId) {
            dragPointerRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }
          event.currentTarget.blur();
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          if (dragPointerRef.current === event.pointerId) dragPointerRef.current = null;
          event.currentTarget.blur();
        }}
        onLostPointerCapture={(event) => {
          if (dragPointerRef.current === event.pointerId) dragPointerRef.current = null;
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

type ButtonMode = 'toggle' | 'trigger' | 'temporary';
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
  const isLit = mode === 'trigger'
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
    if (mode === 'trigger' && isPressed && !previousPressedRef.current) {
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
        } else if (mode === 'trigger') {
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

interface KeysDisplayProps {
  size: number;
  startNote: number;
  onNoteChange: (note: number | null) => void;
}

function KeysDisplay({ size, startNote, onNoteChange }: KeysDisplayProps) {
  const dragRef = useRef<{ pointerId: number; note: number } | null>(null);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const firstNote = clamp(Math.round(startNote), 0, 127);
  const noteCount = clamp(Math.round(size), 1, 128 - firstNote);
  const notes = Array.from({ length: noteCount }, (_, index) => firstNote + index);
  const layouts = pianoKeyLayouts(notes);

  function press(event: PointerEvent<HTMLButtonElement>, note: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, note };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveNote(note);
    onNoteChange(note);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-midi-note]');
    const note = Number(target?.dataset.midiNote);
    if (!Number.isInteger(note) || note === drag.note) return;
    drag.note = note;
    setActiveNote(note);
    onNoteChange(note);
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setActiveNote(null);
    onNoteChange(null);
  }

  return (
    <div className="keys-node-keyboard nodrag nopan" aria-label={`Piano keys ${firstNote} to ${firstNote + noteCount - 1}`}>
      {layouts.map(({ note, black, left, width }) => (
        <button
          className={[
            'keys-node-key nodrag nopan',
            black ? 'keys-node-key-black' : 'keys-node-key-white',
            activeNote === note ? 'keys-node-key-active' : '',
          ].filter(Boolean).join(' ')}
          key={note}
          type="button"
          aria-label={`MIDI note ${note}`}
          aria-pressed={activeNote === note}
          data-midi-note={note}
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={(event) => press(event, note)}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = null;
              setActiveNote(null);
              onNoteChange(null);
            }
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      ))}
    </div>
  );
}

function pianoKeyLayouts(notes: number[]): Array<{ note: number; black: boolean; left: number; width: number }> {
  const raw = notes.map((note) => {
    const pitchClass = note % 12;
    const black = [1, 3, 6, 8, 10].includes(pitchClass);
    const octave = Math.floor(note / 12);
    const whiteInOctave = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pitchClass];
    const whitePosition = octave * 7 + whiteInOctave;
    return {
      note,
      black,
      left: black ? whitePosition + 0.68 : whitePosition,
      width: black ? 0.64 : 1,
    };
  });
  const min = Math.min(...raw.map((key) => key.left));
  const max = Math.max(...raw.map((key) => key.left + key.width));
  const span = Math.max(0.001, max - min);
  return raw.map((key) => ({
    ...key,
    left: ((key.left - min) / span) * 100,
    width: (key.width / span) * 100,
  }));
}

function midiNoteToFrequency(note: number): number {
  return 440 * (2 ** ((note - 69) / 12));
}

interface SequencerGridProps {
  params: Record<string, number>;
  rows: number;
  steps: number;
  beatLength: number;
  currentStep?: number;
  selectedLinkOutputs: string[];
  setOutputRowRef: (port: string, element: HTMLDivElement | null) => void;
  onParamsChange: (values: Record<string, number>) => void;
}

const SEQUENCER_TRIGGER_GRAB_FRACTION = 0.35;

function SequencerGrid({
  params,
  rows,
  steps,
  beatLength,
  currentStep,
  selectedLinkOutputs,
  setOutputRowRef,
  onParamsChange,
}: SequencerGridProps) {
  const gateMode = sequencerUsesGateMode(params);
  const activeStep = Number.isFinite(currentStep) ? Math.floor(currentStep ?? -1) : -1;
  const dragRef = useRef<{
    pointerId: number;
    rowIndex: number;
    slot?: number;
    action?: 'move' | 'resize-left' | 'resize-right';
    anchorX?: number;
    anchorStart?: number;
    anchorEnd?: number;
    moved?: boolean;
  } | null>(null);

  const triggerDragRef = useRef<{
    pointerId: number;
    rowIndex: number;
    slot: number;
    anchorX: number;
    anchorPosition: number;
    previewPosition: number;
    moved: boolean;
  } | null>(null);
  const [triggerPreview, setTriggerPreview] = useState<{
    rowIndex: number;
    slot: number;
    position: number;
  } | null>(null);

  useEffect(() => {
    if (!triggerPreview) return;
    const finish = (event: globalThis.PointerEvent) => finishTriggerDrag(event.pointerId);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [triggerPreview]);

  const triggerPaintRef = useRef<{
    pointerId: number;
    rowIndex: number;
    visited: Set<number>;
    lastStep: number;
  } | null>(null);
  const [triggerPaintPreview, setTriggerPaintPreview] = useState<{ rowIndex: number; positions: number[] } | null>(null);

  const gateCreateRef = useRef<{
    pointerId: number;
    rowIndex: number;
    anchorX: number;
    start: number;
    end: number;
    moved: boolean;
  } | null>(null);
  const [gateCreatePreview, setGateCreatePreview] = useState<{
    rowIndex: number;
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => {
    if (!triggerPaintPreview && !gateCreatePreview) return;
    const finish = (event: globalThis.PointerEvent) => {
      finishTriggerPaint(event.pointerId);
      finishGateCreate(event.pointerId);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [triggerPaintPreview, gateCreatePreview]);

  function beginTriggerPaint(event: PointerEvent<HTMLButtonElement>, rowIndex: number, stepIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    triggerPaintRef.current = {
      pointerId: event.pointerId,
      rowIndex,
      visited: new Set([stepIndex]),
      lastStep: stepIndex,
    };
    setTriggerPaintPreview({ rowIndex, positions: [stepIndex] });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTriggerPaint(event: PointerEvent<HTMLButtonElement>) {
    const paint = triggerPaintRef.current;
    if (!paint || paint.pointerId !== event.pointerId) return;
    const row = event.currentTarget.closest('.sequencer-cells')?.getBoundingClientRect();
    if (!row) return;
    const nextStep = Math.max(0, Math.min(steps - 1, Math.floor(((event.clientX - row.left) / Math.max(1, row.width)) * steps)));
    const direction = nextStep >= paint.lastStep ? 1 : -1;
    for (let stepIndex = paint.lastStep; stepIndex !== nextStep + direction; stepIndex += direction) {
      paint.visited.add(stepIndex);
    }
    paint.lastStep = nextStep;
    setTriggerPaintPreview({ rowIndex: paint.rowIndex, positions: [...paint.visited] });
  }

  function finishTriggerPaint(pointerId: number) {
    const paint = triggerPaintRef.current;
    if (!paint || paint.pointerId !== pointerId) return;
    const existing = sequencerTriggersForRow(params, paint.rowIndex, steps);
    const usedSlots = new Set(existing.map((trigger) => trigger.slot));
    const existingPositions = new Set(existing.map((trigger) => Math.round(trigger.position * 1000000)));
    const values: Record<string, number> = {};
    for (const position of paint.visited) {
      if (existingPositions.has(Math.round(position * 1000000))) continue;
      const slot = Array.from({ length: steps }, (_, index) => index).find((index) => !usedSlots.has(index));
      if (slot === undefined) break;
      usedSlots.add(slot);
      values[sequencerCellParamName(paint.rowIndex, slot)] = 1;
      values[sequencerTriggerPositionParamName(paint.rowIndex, slot)] = position;
    }
    onParamsChange(values);
    triggerPaintRef.current = null;
    setTriggerPaintPreview(null);
  }

  function positionInSequencerRow(event: PointerEvent<HTMLElement>): number {
    const row = event.currentTarget.closest('.sequencer-cells')?.getBoundingClientRect();
    if (!row) return 0;
    return Math.max(0, Math.min(steps, ((event.clientX - row.left) / Math.max(1, row.width)) * steps));
  }

  function beginGateCreate(event: PointerEvent<HTMLButtonElement>, rowIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = positionInSequencerRow(event);
    const end = Math.min(steps, start + 1);
    gateCreateRef.current = {
      pointerId: event.pointerId,
      rowIndex,
      anchorX: event.clientX,
      start,
      end,
      moved: false,
    };
    setGateCreatePreview({ rowIndex, start, end });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateGateCreate(event: PointerEvent<HTMLButtonElement>) {
    const create = gateCreateRef.current;
    if (!create || create.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - create.anchorX) >= 3) create.moved = true;
    if (!create.moved) return;
    create.end = Math.max(create.start + 0.05, positionInSequencerRow(event));
    create.end = Math.min(steps, create.end);
    setGateCreatePreview({ rowIndex: create.rowIndex, start: create.start, end: create.end });
  }

  function finishGateCreate(pointerId: number) {
    const create = gateCreateRef.current;
    if (!create || create.pointerId !== pointerId) return;
    const usedSlots = new Set(sequencerGatesForRow(params, create.rowIndex, steps).map((gate) => gate.slot));
    const slot = Array.from({ length: steps }, (_, index) => index).find((index) => !usedSlots.has(index));
    if (slot !== undefined) {
      onParamsChange({
        [SEQUENCER_GATE_INITIALIZED_PARAM]: 1,
        [sequencerGateParamName(create.rowIndex, slot, 'active')]: 1,
        [sequencerGateParamName(create.rowIndex, slot, 'start')]: create.start,
        [sequencerGateParamName(create.rowIndex, slot, 'end')]: create.end,
      });
    }
    gateCreateRef.current = null;
    setGateCreatePreview(null);
  }

  function beginTriggerDrag(event: PointerEvent<HTMLDivElement>, rowIndex: number, slot: number, position: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    triggerDragRef.current = {
      pointerId: event.pointerId,
      rowIndex,
      slot,
      anchorX: event.clientX,
      anchorPosition: position,
      previewPosition: position,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTriggerDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rowWidth = event.currentTarget.closest('.sequencer-cells')?.getBoundingClientRect().width ?? steps * 26;
    const delta = ((event.clientX - drag.anchorX) / Math.max(1, rowWidth)) * steps;
    if (Math.abs(event.clientX - drag.anchorX) >= 3) drag.moved = true;
    if (!drag.moved) return;
    const position = Math.max(0, Math.min(steps - SEQUENCER_TRIGGER_GRAB_FRACTION, drag.anchorPosition + delta));
    drag.previewPosition = position;
    setTriggerPreview({ rowIndex: drag.rowIndex, slot: drag.slot, position });
  }

  function finishTriggerDrag(pointerId: number) {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (!drag.moved) {
      onParamsChange({ [sequencerCellParamName(drag.rowIndex, drag.slot)]: 0 });
    } else {
      onParamsChange({
        [sequencerTriggerPositionParamName(drag.rowIndex, drag.slot)]: drag.previewPosition,
      });
    }
    triggerDragRef.current = null;
    setTriggerPreview(null);
  }

  function endTriggerDrag(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishTriggerDrag(event.pointerId);
  }

  function beginGateDrag(
    event: PointerEvent<HTMLElement>,
    rowIndex: number,
    slot: number,
    start: number,
    end: number,
    action: 'move' | 'resize-left' | 'resize-right',
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      rowIndex,
      slot,
      action,
      anchorX: event.clientX,
      anchorStart: start,
      anchorEnd: end,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateGateDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.slot === undefined || !drag.action) return;
    const rowWidth = event.currentTarget.closest('.sequencer-cells')?.getBoundingClientRect().width ?? steps * 26;
    const delta = ((event.clientX - (drag.anchorX ?? event.clientX)) / Math.max(1, rowWidth)) * steps;
    if (Math.abs(event.clientX - (drag.anchorX ?? event.clientX)) >= 3) drag.moved = true;
    if (!drag.moved) return;

    const minimumLength = 0.05;
    let start = drag.anchorStart ?? 0;
    let end = drag.anchorEnd ?? start + 1;
    if (drag.action === 'move') {
      const length = end - start;
      start = Math.max(0, Math.min(steps - length, start + delta));
      end = start + length;
    } else if (drag.action === 'resize-left') {
      start = Math.max(0, Math.min(end - minimumLength, start + delta));
    } else {
      end = Math.max(start + minimumLength, Math.min(steps, end + delta));
    }
    onParamsChange({
      [sequencerGateParamName(drag.rowIndex, drag.slot, 'start')]: start,
      [sequencerGateParamName(drag.rowIndex, drag.slot, 'end')]: end,
    });
  }

  function endGateDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.slot === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (!drag.moved) {
      onParamsChange({ [sequencerGateParamName(drag.rowIndex, drag.slot, 'active')]: 0 });
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  return (
    <div
      className="sequencer-node-panel nodrag nopan"
      style={{ '--sequencer-steps': steps } as CSSProperties}
      aria-label="Sequencer pattern"
    >
      {Array.from({ length: rows }, (_, rowIndex) => {
        const outputName = sequencerOutputName(rowIndex);
        const gates = gateMode ? sequencerGatesForRow(params, rowIndex, steps) : [];
        const triggers = gateMode ? [] : sequencerTriggersForRow(params, rowIndex, steps);
        return (
          <div
            className="sequencer-row"
            key={outputName}
            ref={(element) => setOutputRowRef(outputName, element)}
          >
            <div className="sequencer-cells" role="row">
              {Array.from({ length: steps }, (_, stepIndex) => {
                const highlightedBeat = Math.floor(stepIndex / beatLength) % 2 === 1;
                return (
                  <button
                    className={[
                      'sequencer-cell',
                      highlightedBeat ? 'sequencer-cell-beat-highlight' : '',
                      activeStep === stepIndex ? 'sequencer-cell-current' : '',
                    ].filter(Boolean).join(' ')}
                    key={stepIndex}
                    type="button"
                    role="gridcell"
                    data-sequencer-cell="true"
                    data-row-index={rowIndex}
                    data-step-index={stepIndex}
                    aria-label={`Row ${rowIndex + 1}, step ${stepIndex + 1}`}
                    aria-pressed={false}
                    title={`Row ${rowIndex + 1}, step ${stepIndex + 1}`}
                    onPointerDown={(event) => {
                      if (gateMode) beginGateCreate(event, rowIndex);
                      else beginTriggerPaint(event, rowIndex, stepIndex);
                    }}
                    onPointerMove={(event) => {
                      if (gateMode) updateGateCreate(event);
                      else updateTriggerPaint(event);
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      if (gateMode) finishGateCreate(event.pointerId);
                      else finishTriggerPaint(event.pointerId);
                    }}
                    onPointerCancel={(event) => {
                      if (gateMode) finishGateCreate(event.pointerId);
                      else finishTriggerPaint(event.pointerId);
                    }}
                    onLostPointerCapture={(event) => {
                      if (gateMode) finishGateCreate(event.pointerId);
                      else finishTriggerPaint(event.pointerId);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                );
              })}
              {!gateMode && triggerPaintPreview?.rowIndex === rowIndex
                ? triggerPaintPreview.positions.map((position) => (
                    <div
                      key={`paint-${position}`}
                      className="sequencer-trigger sequencer-step-create-preview"
                      style={{ left: `${(position / steps) * 100}%`, width: `${(1 / steps) * 100}%` }}
                    />
                  ))
                : null}
              {gateMode && gateCreatePreview?.rowIndex === rowIndex ? (
                <div
                  className="sequencer-gate sequencer-step-create-preview"
                  style={{
                    left: `${(gateCreatePreview.start / steps) * 100}%`,
                    width: `${((gateCreatePreview.end - gateCreatePreview.start) / steps) * 100}%`,
                  }}
                />
              ) : null}
              {triggers.map((trigger) => (
                <div
                  key={trigger.slot}
                  className="sequencer-trigger"
                  style={{
                    left: `${(((triggerPreview?.rowIndex === rowIndex && triggerPreview.slot === trigger.slot)
                      ? triggerPreview.position
                      : trigger.position) / steps) * 100}%`,
                    width: `${(1 / steps) * 100}%`,
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Row ${rowIndex + 1} trigger at ${trigger.position.toFixed(2)}`}
                  title="Drag to move; click to delete"
                  onPointerDown={(event) => beginTriggerDrag(event, rowIndex, trigger.slot, trigger.position)}
                  onPointerMove={updateTriggerDrag}
                  onPointerUp={endTriggerDrag}
                  onPointerCancel={endTriggerDrag}
                  onLostPointerCapture={(event) => finishTriggerDrag(event.pointerId)}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                />
              ))}
              {gates.map((gate) => (
                <div
                  key={gate.slot}
                  className="sequencer-gate"
                  style={{
                    left: `${(gate.start / steps) * 100}%`,
                    width: `${((gate.end - gate.start) / steps) * 100}%`,
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Row ${rowIndex + 1} gate from ${gate.start.toFixed(2)} to ${gate.end.toFixed(2)}`}
                  title="Drag to move; drag either edge to resize; click to delete"
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      beginGateDrag(event, rowIndex, gate.slot, gate.start, gate.end, 'move');
                    }
                  }}
                  onPointerMove={updateGateDrag}
                  onPointerUp={endGateDrag}
                  onPointerCancel={endGateDrag}
                  onLostPointerCapture={() => { dragRef.current = null; }}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                >
                  <span
                    className="sequencer-gate-handle sequencer-gate-handle-left"
                    onPointerDown={(event) => beginGateDrag(event, rowIndex, gate.slot, gate.start, gate.end, 'resize-left')}
                  />
                  <span
                    className="sequencer-gate-handle sequencer-gate-handle-right"
                    onPointerDown={(event) => beginGateDrag(event, rowIndex, gate.slot, gate.start, gate.end, 'resize-right')}
                  />
                </div>
              ))}
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
  rangeMin,
  rangeMax,
  playhead,
  compact,
  displaySize,
  graphZoomScale,
  graphScreenEmphasis,
  editorRef,
  onPointerDown,
  onDoubleClick,
  onModeChange,
  onSustainStartChange,
  onSustainEndChange,
}: CustomWaveEditorProps) {
  const width = 300;
  const height = 128;
  const padding = 12;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const points = customWaveWithRangeOrigin(customWave, rangeMin, rangeMax).points;
  const path = customWavePath(points, width, height, padding);
  const graphDetailSize = {
    width: displaySize.width * graphZoomScale,
    height: displaySize.height * graphZoomScale,
  };
  const gridColumns = chartGridColumns(graphDetailSize.width);
  const gridRows = customWaveGridRows(rangeMin, rangeMax, graphDetailSize.height);
  const sustainStartX = padding + customWave.sustainStart * innerWidth;
  const sustainEndX = padding + customWave.sustainEnd * innerWidth;
  const showSustainStart = customWaveUsesSustainStart(customWave.mode);
  const showSustainEnd = customWaveUsesSustainEnd(customWave.mode);
  const playheadX = padding + playhead * innerWidth;
  const hitRadius = screenCircleRadius(15 * graphScreenEmphasis, width, height, graphDetailSize);
  const endpointRadius = screenCircleRadius(5 * graphScreenEmphasis, width, height, graphDetailSize);
  const handleRadius = screenCircleRadius(6 * graphScreenEmphasis, width, height, graphDetailSize);

  return (
    <div className="custom-wave-node-editor nodrag nopan">
      <div className="custom-wave-node-chart">
        <ChartGrid
          width={innerWidth}
          height={innerHeight}
          columns={gridColumns}
          rows={gridRows}
          className="custom-wave-node-grid"
          showRowLabels
        />
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
          {showSustainStart ? (
            <line className="custom-wave-sustain-line" x1={sustainStartX} y1={padding} x2={sustainStartX} y2={height - padding} />
          ) : null}
          {showSustainEnd ? (
            <line className="custom-wave-sustain-line is-end" x1={sustainEndX} y1={padding} x2={sustainEndX} y2={height - padding} />
          ) : null}
          <path className="custom-wave-path" d={path} />
          <line className="wave-playhead-line" x1={playheadX} y1={padding} x2={playheadX} y2={height - padding} />
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
      </div>
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

function customWaveGridRows(rangeMin: number, rangeMax: number, height: number) {
  const min = Number.isFinite(rangeMin) ? rangeMin : -1;
  const max = Number.isFinite(rangeMax) ? rangeMax : 1;
  const ticks = chartScaleTicks(max, min, height, 'vertical');
  const zeroY = (1 - normalizedCustomWaveValue(0, min, max)) / 2;
  const containsZero = (min <= 0 && max >= 0) || (max <= 0 && min >= 0);
  const existingZero = ticks.find((tick) => Math.abs(tick.fraction - zeroY) < 0.0001);
  if (existingZero) {
    existingZero.origin = true;
    if (containsZero) existingZero.label = '0';
    return ticks;
  }
  return [...ticks, { fraction: zeroY, label: containsZero ? '0' : undefined, major: true, origin: true }]
    .sort((left, right) => left.fraction - right.fraction);
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

function monitorDisplayMode(value: number | undefined, fallback: 'unipolar' | 'bipolar'): 'unipolar' | 'bipolar' {
  if (value === undefined) return fallback;
  return Math.round(value) === 1 ? 'bipolar' : 'unipolar';
}

function amplitudeScaleTicks(
  range: number,
  size: number,
  mode: 'unipolar' | 'bipolar',
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): Array<{ fraction: number; label: string }> {
  const divisions = amplitudeLabelDivisions(size, orientation, mode);
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const fraction = index / divisions;
    const value = mode === 'bipolar'
      ? orientation === 'horizontal'
        ? -range + fraction * range * 2
        : range - fraction * range * 2
      : orientation === 'horizontal'
        ? range * fraction
        : range * (1 - fraction);
    return {
      fraction,
      label: formatAmplitude(value),
    };
  });
}

function amplitudeLabelDivisions(size: number, orientation: 'horizontal' | 'vertical', mode: 'unipolar' | 'bipolar'): number {
  const base = orientation === 'horizontal'
    ? size >= 1120 ? 16 : size >= 560 ? 8 : size >= 360 ? 4 : 2
    : size >= 352 ? 16 : size >= 176 ? 8 : size >= 104 ? 4 : 2;
  return mode === 'bipolar' ? Math.max(2, base) : base;
}

function shouldForceCompactPorts(definition: NodeDefinition): boolean {
  const onlySignalInput = definition.inputs.length === 0
    || (definition.inputs.length === 1 && definition.inputs[0]?.name === 'signal');

  return onlySignalInput
    && definition.outputs.length <= 1;
}

function isSelectorValuePort(name: string): boolean {
  return /^[1-9][0-9]*$/.test(name);
}

function samplesToScopePath(samples: number[], range: number, mode: 'unipolar' | 'bipolar'): string {
  const restingY = mode === 'bipolar' ? 24 : 46;
  if (samples.length < 2) return `M0 ${restingY} L160 ${restingY}`;

  return samples.map((sample, index) => {
    const x = (index / (samples.length - 1)) * 160;
    const normalized = Math.max(-1, Math.min(1, sample / range));
    const y = mode === 'bipolar'
      ? 24 - normalized * 22
      : 46 - Math.abs(normalized) * 44;
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

function formatAccumulatorValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return `${value}`;
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
  if (mode === 1) return 'trigger';
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
  onCancel: () => void;
  onChange: (type: NodeType) => void;
  onCustomLabelCommit?: (label: string) => void;
}

interface CollapsedNodeLabelProps {
  nodeType: NodeType | null;
  customLabel?: string;
  onChange: (label: string) => void;
}

function CollapsedNodeLabel({ nodeType, customLabel, onChange }: CollapsedNodeLabelProps) {
  const defaultLabel = nodeType ? getNodeTypeLabel(nodeType) : 'type';
  const displayLabel = customLabel || defaultLabel;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayLabel);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(displayLabel);
  }, [displayLabel, editing]);

  useEffect(() => {
    if (!editing) return;
    const animationFrame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editing]);

  function commit() {
    onChange(draft);
    setEditing(false);
  }

  function cancel() {
    setDraft(displayLabel);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="collapsed-node-label-editor nodrag nopan"
        size={Math.max(1, draft.length)}
        value={draft}
        aria-label="Collapsed node label"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') cancel();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        spellCheck={false}
      />
    );
  }

  return (
    <button
      className="collapsed-node-label nodrag nopan"
      type="button"
      title="Click to name this collapsed node"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {displayLabel}
    </button>
  );
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
  if (name === 'rangeMin') return 'range min';
  if (name === 'rangeMax') return 'range max';
  if (name === 'beatLength') return 'beat length';
  if (name === 'gateLength') return 'gate length';
  if (name === 'midiChannel') return 'midi channel';
  if (name === 'midiCc') return 'midi cc';
  if (name === 'startNote') return 'start note';
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
  onCancel,
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
  const options = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return NODE_TYPE_LIST
      .filter((type) => {
        if (!isEditingSubpatch && (type === 'Ins' || type === 'Outs')) return false;
        return (
          type.toLowerCase().includes(normalizedQuery) ||
          getNodeTypeLabel(type).toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((left, right) => {
        const leftStartsWithQuery = (
          left.toLowerCase().startsWith(normalizedQuery) ||
          getNodeTypeLabel(left).toLowerCase().startsWith(normalizedQuery)
        );
        const rightStartsWithQuery = (
          right.toLowerCase().startsWith(normalizedQuery) ||
          getNodeTypeLabel(right).toLowerCase().startsWith(normalizedQuery)
        );

        return Number(rightStartsWithQuery) - Number(leftStartsWithQuery);
      });
  }, [isEditingSubpatch, searchQuery]);
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
      onCancel();
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
  step?: number;
  integer?: boolean;
  onChange: (value: number) => void;
  onClear?: () => void;
  midiLearnEvent?: MidiCcLearnEvent;
  onEditStart?: () => void;
  onMidiLearn?: (event: MidiCcLearnEvent) => void;
}

function NumericScrubber({
  value,
  min,
  max,
  step: baseStep,
  integer = false,
  onChange,
  onClear,
  midiLearnEvent,
  onEditStart,
  onMidiLearn,
}: NumericScrubberProps) {
  const dragStep = integer ? (baseStep ?? 0.01) * 3 : baseStep;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatNumericValue(value));
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
      setDraft(formatNumericValue(value));
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      setDraft(formatNumericValue(value));
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
    setDraft(formatNumericValue(nextValue));
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
      step: scrubberStep(event, dragStep),
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

    const step = scrubberStep(event, dragStep);
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
    const trimmedDraft = draft.trim();
    if (trimmedDraft.length === 0 && onClear) {
      onClear();
      setEditing(false);
      return;
    }

    const nextValue = Number(trimmedDraft);
    if (Number.isFinite(nextValue)) {
      onChange(constrainValue(nextValue, min, max, integer));
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
        className="numeric-scrubber numeric-scrubber-editing nodrag nopan"
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={handleEditKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
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
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          beginEditing();
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

function scrubberStep(event: { metaKey: boolean; shiftKey: boolean }, baseStep = 0.01): number {
  if (event.metaKey && event.shiftKey) return baseStep * 200;
  if (event.metaKey) return baseStep * 20;
  if (event.shiftKey) return baseStep * 0.1;
  return baseStep;
}

function constrainValue(value: number, min?: number, max?: number, integer = false): number {
  const rounded = integer ? Math.round(value) : value;
  return Math.min(Math.max(rounded, min ?? -Infinity), max ?? Infinity);
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
