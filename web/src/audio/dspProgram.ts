import { expandGroups } from '../graph/subpatch';
import { getNodeDefinition } from '../graph/nodeTypes';
import type { LinkMode, NodeType, Patch, PatchLink, PatchNode } from '../graph/types';

export const DSP_OP = {
  Value: 0,
  Add: 1,
  Mul: 2,
  Osc: 3,
  Filter: 4,
  Output: 5,
  Abs: 6,
  Map: 7,
  FeedbackRead: 8,
  FeedbackWrite: 9,
  Select: 10,
  Input: 11,
  Delay: 12,
  Chorus: 13,
  Reverb: 14,
  Fold: 15,
  Sub: 16,
  Div: 17,
  Neg: 18,
  Envelope: 19,
  Follower: 20,
  HardClip: 21,
  SoftClip: 22,
} as const;

export interface DspProgram {
  version: 1;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  stateBindings: DspStateBinding[];
  registerCount: number;
  stateCount: number;
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  errors: string[];
}

export interface DspOp {
  opcode: number;
  out?: number;
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  state?: number;
  value?: number;
}

export interface DspValueBinding {
  id: string;
  valueIndex: number;
  kind: 'node-param' | 'link-weight' | 'constant';
  nodeId?: string;
  port?: string;
  linkId?: string;
}

export interface DspStateBinding {
  id: string;
  state: number;
  count: number;
  kind: 'oscillator' | 'filter' | 'feedback' | 'selector' | 'effect';
  nodeId: string;
}

interface FeedbackBinding {
  readRegister: number;
  state: number;
  writeEmitted: boolean;
}

interface CompileContext {
  patch: Patch;
  nodeById: Map<string, PatchNode>;
  incomingByInput: Map<string, PatchLink[]>;
  outputCache: Map<string, number>;
  visitingOutputs: Set<string>;
  feedbackByOutput: Map<string, FeedbackBinding>;
  ops: DspOp[];
  values: number[];
  valueBindings: DspValueBinding[];
  stateBindings: DspStateBinding[];
  constantValueIndexes: Map<number, number>;
  errors: string[];
  feedbackLinkIds: string[];
  monitorIds: Record<string, number>;
  registerCount: number;
  stateCount: number;
}

const OSC_WAVES: Partial<Record<NodeType, number>> = {
  SineOsc: 0,
  TriangleOsc: 1,
  SawOsc: 2,
  RampOsc: 3,
  SquareOsc: 4,
  SampleHoldOsc: 5,
};

const FILTER_TYPES: Partial<Record<NodeType, number>> = {
  LowpassFilter: 1,
  HighpassFilter: 2,
  BandpassFilter: 3,
};

export function compilePatchToDspProgram(patch: Patch): DspProgram {
  const expandedPatch = expandGroups(patch);
  const context = createContext(expandedPatch);
  const audioOutNodes = expandedPatch.nodes.filter((node) => node.type === 'AudioOut');

  if (audioOutNodes.length === 0) {
    context.errors.push('Patch needs an Audio Out node.');
  }

  for (const node of audioOutNodes) {
    compileAudioOut(node, context);
  }

  if (context.errors.length > 0) {
    return {
      version: 1,
      ops: [],
      values: context.values,
      valueBindings: context.valueBindings,
      stateBindings: context.stateBindings,
      registerCount: context.registerCount,
      stateCount: context.stateCount,
      feedbackLinkIds: context.feedbackLinkIds,
      monitorIds: context.monitorIds,
      errors: [...new Set(context.errors)],
    };
  }

  return {
    version: 1,
    ops: context.ops,
    values: context.values,
    valueBindings: context.valueBindings,
    stateBindings: context.stateBindings,
    registerCount: context.registerCount,
    stateCount: context.stateCount,
    feedbackLinkIds: context.feedbackLinkIds,
    monitorIds: context.monitorIds,
    errors: [],
  };
}

function createContext(patch: Patch): CompileContext {
  const incomingByInput = new Map<string, PatchLink[]>();
  for (const link of patch.links) {
    const key = inputKey(link.to.node, link.to.port);
    incomingByInput.set(key, [...(incomingByInput.get(key) ?? []), link]);
  }

  return {
    patch,
    nodeById: new Map(patch.nodes.map((node) => [node.id, node])),
    incomingByInput,
    outputCache: new Map(),
    visitingOutputs: new Set(),
    feedbackByOutput: new Map(),
    ops: [],
    values: [],
    valueBindings: [],
    stateBindings: [],
    constantValueIndexes: new Map(),
    errors: [],
    feedbackLinkIds: [],
    monitorIds: {},
    registerCount: 0,
    stateCount: 0,
  };
}

function compileAudioOut(node: PatchNode, context: CompileContext): void {
  const level = resolveInput(node, 'level', 0.75, context);

  for (const port of ['both', 'left', 'right'] as const) {
    const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
    if (links.length === 0) continue;

    const input = resolveInput(node, port, 0, context);
    const scaled = emitBinary(DSP_OP.Mul, input, level, context);
    if (port === 'both' || port === 'left') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 0 });
    }
    if (port === 'both' || port === 'right') {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 1 });
    }
  }
}

function resolveInput(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  if (links.length === 0) return valueRegisterForNodeParam(node, port, fallback, context);

  const setRegisters: number[] = [];
  const addRegisters: number[] = [];
  const multiplyRegisters: number[] = [];

  for (const link of links) {
    const register = resolveLinkValue(link, context);
    if (register === null) continue;

    switch (link.mode ?? 'set') {
      case 'add':
        addRegisters.push(register);
        break;
      case 'multiply':
        multiplyRegisters.push(register);
        break;
      case 'set':
        setRegisters.push(register);
        break;
    }
  }

  let result = setRegisters.length > 0
    ? averageRegisters(setRegisters, context)
    : valueRegisterForNodeParam(node, port, fallback, context);

  for (const register of addRegisters) {
    result = emitBinary(DSP_OP.Add, result, register, context);
  }

  for (const register of multiplyRegisters) {
    result = emitBinary(DSP_OP.Mul, result, register, context);
  }

  return result;
}

function resolveLinkValue(link: PatchLink, context: CompileContext): number | null {
  const source = context.nodeById.get(link.from.node);
  if (!source) {
    context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    return null;
  }

  const sourceRegister = resolveOutput(source, link.from.port, context);
  if (sourceRegister === null) return null;

  const weightRegister = valueRegisterForLinkWeight(link, context);
  return emitBinary(DSP_OP.Mul, sourceRegister, weightRegister, context);
}

function resolveOutput(node: PatchNode, port: string, context: CompileContext): number | null {
  if (port !== 'signal' && port !== 'value') {
    context.errors.push(`Node "${node.id}" does not have supported output "${port}".`);
    return null;
  }

  const key = inputKey(node.id, port);
  const cached = context.outputCache.get(key);
  if (cached !== undefined) return cached;

  if (context.visitingOutputs.has(key)) {
    return feedbackRegisterForOutput(node, port, context);
  }

  context.visitingOutputs.add(key);
  const register = compileNodeOutput(node, context);
  context.visitingOutputs.delete(key);

  if (register !== null) {
    context.outputCache.set(key, register);
    emitFeedbackWriteIfNeeded(key, register, context);
  }
  return register;
}

function feedbackRegisterForOutput(node: PatchNode, port: string, context: CompileContext): number {
  const key = inputKey(node.id, port);
  const existing = context.feedbackByOutput.get(key);
  if (existing) return existing.readRegister;

  const state = nextState(context, 1);
  const readRegister = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.FeedbackRead, out: readRegister, state });
  context.feedbackByOutput.set(key, { readRegister, state, writeEmitted: false });
  context.feedbackLinkIds.push(key);
  context.stateBindings.push({
    id: `${key}:feedback`,
    state,
    count: 1,
    kind: 'feedback',
    nodeId: node.id,
  });
  return readRegister;
}

function emitFeedbackWriteIfNeeded(key: string, register: number, context: CompileContext): void {
  const feedback = context.feedbackByOutput.get(key);
  if (!feedback || feedback.writeEmitted) return;
  context.ops.push({ opcode: DSP_OP.FeedbackWrite, a: register, state: feedback.state });
  feedback.writeEmitted = true;
}

function compileNodeOutput(node: PatchNode, context: CompileContext): number | null {
  if (node.type === 'Constant') {
    return resolveInput(node, 'value', 1, context);
  }

  if (node.type === 'Expression') {
    return compileExpression(node, context);
  }

  if (node.type === 'Noise') {
    const level = resolveInput(node, 'level', 0.4, context);
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: 6, b: constantRegister(0, context) });
    return emitBinary(DSP_OP.Mul, output, level, context);
  }

  const wave = OSC_WAVES[node.type];
  if (wave !== undefined) {
    const frequency = resolveInput(node, 'frequency', 220, context);
    const level = resolveInput(node, 'level', 0.7, context);
    const output = nextRegister(context);
    const stateCount = wave === 5 ? 2 : 1;
    const state = nextState(context, stateCount);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: stateCount,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: wave, b: frequency, state });
    return emitBinary(DSP_OP.Mul, output, level, context);
  }

  if (node.type === 'PerlinNoise') {
    const speed = resolveInput(node, 'speed', 8, context);
    const level = resolveInput(node, 'level', 0.7, context);
    const output = nextRegister(context);
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 3,
      kind: 'oscillator',
      nodeId: node.id,
    });
    context.ops.push({ opcode: DSP_OP.Osc, out: output, a: 7, b: speed, state });
    return emitBinary(DSP_OP.Mul, output, level, context);
  }

  if (node.type === 'AudioInput') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Input,
      out: output,
      a: resolveInput(node, 'gain', 1, context),
    });
    return emitBinary(DSP_OP.Mul, output, resolveInput(node, 'level', 0.7, context), context);
  }

  if (node.type === 'Gain') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'gain', 1, context),
      context,
    );
  }

  if (node.type === 'Multiply') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'factor', 1, context),
      context,
    );
  }

  if (node.type === 'RingMod' || node.type === 'Mix') {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, 'signal', 0, context),
      resolveInput(node, 'amount', node.type === 'Mix' ? 0.5 : 1, context),
      context,
    );
  }

  if (node.type === 'Fold') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Fold,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'amount', 1, context),
    });
    return output;
  }

  if (node.type === 'Envelope') {
    const envelope = nextRegister(context);
    const state = nextState(context, 5);
    context.stateBindings.push({
      id: `${node.id}:envelope`,
      state,
      count: 5,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Envelope,
      out: envelope,
      a: resolveInput(node, 'trigger', 0, context),
      b: resolveInput(node, 'delay', 0, context),
      c: resolveInput(node, 'attack', 0.01, context),
      d: resolveInput(node, 'decay', 0.16, context),
      e: resolveInput(node, 'sustain', 0.72, context),
      state,
      value: resolveInput(node, 'release', 0.24, context),
    });
    return emitBinary(DSP_OP.Mul, resolveInput(node, 'signal', 0, context), envelope, context);
  }

  if (node.type === 'Follower') {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:follower`,
      state,
      count: 1,
      kind: 'effect',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Follower,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'attack', 0.01, context),
      c: resolveInput(node, 'release', 0.12, context),
      state,
    });
    return output;
  }

  if (node.type === 'HardClipDistortion' || node.type === 'SoftClipDistortion') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: node.type === 'HardClipDistortion' ? DSP_OP.HardClip : DSP_OP.SoftClip,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'drive', 2.5, context),
    });
    return output;
  }

  if (node.type === 'Delay') {
    return compileEffect(node, DSP_OP.Delay, [
      ['time', 0.28],
      ['feedback', 0.35],
      ['mix', 0.25],
    ], context);
  }

  if (node.type === 'Chorus') {
    return compileEffect(node, DSP_OP.Chorus, [
      ['rate', 0.8],
      ['depth', 0.012],
      ['mix', 0.25],
    ], context);
  }

  if (node.type === 'Reverb') {
    return compileEffect(node, DSP_OP.Reverb, [
      ['size', 0.55],
      ['decay', 0.45],
      ['mix', 0.25],
    ], context);
  }

  if (node.type === 'Abs') {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Abs, out: output, a: resolveInput(node, 'signal', 0, context) });
    return output;
  }

  if (node.type === 'Map') {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Map,
      out: output,
      a: resolveInput(node, 'signal', 0, context),
      b: resolveInput(node, 'srcMin', 0, context),
      c: resolveInput(node, 'srcMax', 1, context),
      d: resolveInput(node, 'trgtMin', 0, context),
      e: resolveInput(node, 'trgtMax', 1, context),
    });
    return output;
  }

  if (node.type === 'Selector') {
    return compileSelector(node, context);
  }

  const filterType = FILTER_TYPES[node.type];
  if (filterType !== undefined) {
    const output = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:filter`,
      state,
      count: 4,
      kind: 'filter',
      nodeId: node.id,
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: filterType,
      b: resolveInput(node, 'signal', 0, context),
      c: resolveInput(node, 'cutoff', 1200, context),
      d: resolveInput(node, 'resonance', 0.7, context),
      state,
    });
    return output;
  }

  if (node.type === 'Meter' || node.type === 'Scope') {
    const signal = resolveInput(node, 'signal', 0, context);
    context.monitorIds[node.id] = signal;
    return signal;
  }

  context.errors.push(`Node type "${node.type}" is not supported by the first DSP program slice.`);
  return null;
}

function compileSelector(node: PatchNode, context: CompileContext): number {
  const definition = getNodeDefinition(node);
  const valueInputs = definition.inputs
    .filter((input) => /^[1-9][0-9]*$/.test(input.name))
    .sort((left, right) => Number(left.name) - Number(right.name));
  if (valueInputs.length === 0) return constantRegister(0, context);

  const select = resolveInput(node, 'select', 1, context);
  const slide = resolveInput(node, 'slide', 0, context);
  const output = nextRegister(context);
  const state = nextState(context, 4);
  const maxInputIndex = Math.max(...valueInputs.map((input) => Number(input.name)));
  context.stateBindings.push({
    id: `${node.id}:selector`,
    state,
    count: 4,
    kind: 'selector',
    nodeId: node.id,
  });

  valueInputs.forEach((input) => {
    context.ops.push({
      opcode: DSP_OP.Select,
      out: output,
      a: select,
      b: slide,
      c: resolveInput(node, input.name, input.defaultValue ?? 0, context),
      d: Number(input.name),
      e: maxInputIndex,
      state,
    });
  });
  return output;
}

function compileEffect(
  node: PatchNode,
  opcode: number,
  params: Array<[port: string, fallback: number]>,
  context: CompileContext,
): number {
  const output = nextRegister(context);
  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:effect`,
    state,
    count: 1,
    kind: 'effect',
    nodeId: node.id,
  });
  context.ops.push({
    opcode,
    out: output,
    a: resolveInput(node, 'signal', 0, context),
    b: resolveInput(node, params[0]?.[0] ?? 'unused', params[0]?.[1] ?? 0, context),
    c: resolveInput(node, params[1]?.[0] ?? 'unused', params[1]?.[1] ?? 0, context),
    d: resolveInput(node, params[2]?.[0] ?? 'unused', params[2]?.[1] ?? 0, context),
    state,
  });
  return output;
}

type ExpressionToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '(' | ')' };

function compileExpression(node: PatchNode, context: CompileContext): number {
  const source = typeof node.expression === 'string' && node.expression.trim()
    ? node.expression
    : '0';
  const parser = new ExpressionParser(tokenizeExpression(source), node, context);
  return parser.parse();
}

class ExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: ExpressionToken[],
    private readonly node: PatchNode,
    private readonly context: CompileContext,
  ) {}

  parse(): number {
    const register = this.parseAdditive();
    if (!this.isAtEnd()) {
      this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
      return constantRegister(0, this.context);
    }
    return register;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      left = emitBinary(operator === '+' ? DSP_OP.Add : DSP_OP.Sub, left, right, this.context);
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseUnary();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = emitBinary(operator === '*' ? DSP_OP.Mul : DSP_OP.Div, left, right, this.context);
    }
    return left;
  }

  private parseUnary(): number {
    if (this.matchOperator('-')) {
      const output = nextRegister(this.context);
      this.context.ops.push({ opcode: DSP_OP.Neg, out: output, a: this.parseUnary() });
      return output;
    }
    if (this.matchOperator('+')) {
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    if (this.match('number')) {
      const token = this.previous();
      return constantRegister(token.type === 'number' ? token.value : 0, this.context);
    }
    if (this.match('identifier')) {
      const token = this.previous();
      return resolveInput(this.node, token.type === 'identifier' ? token.value : '', 0, this.context);
    }
    if (this.matchOperator('(')) {
      const register = this.parseAdditive();
      if (!this.matchOperator(')')) {
        this.context.errors.push(`Expression node "${this.node.id}" is missing a closing parenthesis.`);
        return constantRegister(0, this.context);
      }
      return register;
    }

    this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
    this.advance();
    return constantRegister(0, this.context);
  }

  private match(type: ExpressionToken['type']): boolean {
    if (this.isAtEnd() || this.peek().type !== type) return false;
    this.advance();
    return true;
  }

  private matchOperator(value: Extract<ExpressionToken, { type: 'operator' }>['value']): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type !== 'operator' || token.value !== value) return false;
    this.advance();
    return true;
  }

  private advance(): ExpressionToken {
    if (!this.isAtEnd()) this.index += 1;
    return this.previous();
  }

  private previous(): ExpressionToken {
    return this.tokens[Math.max(0, this.index - 1)] ?? { type: 'number', value: 0 };
  }

  private peek(): ExpressionToken {
    return this.tokens[this.index] ?? { type: 'number', value: 0 };
  }

  private peekLabel(): string {
    const token = this.tokens[this.index];
    return token ? String(token.value) : 'end of expression';
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }
}

function tokenizeExpression(source: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[+\-*/()]/.test(char)) {
      tokens.push({ type: 'operator', value: char as Extract<ExpressionToken, { type: 'operator' }>['value'] });
      index += 1;
      continue;
    }

    const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (numberMatch) {
      tokens.push({ type: 'number', value: finiteNumber(Number(numberMatch[0]), 0) });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      tokens.push({ type: 'identifier', value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }

    tokens.push({ type: 'operator', value: '+' });
    index += 1;
  }

  return tokens;
}

function averageRegisters(registers: number[], context: CompileContext): number {
  if (registers.length === 1) return registers[0];
  let sum = registers[0];
  for (const register of registers.slice(1)) {
    sum = emitBinary(DSP_OP.Add, sum, register, context);
  }
  return emitBinary(DSP_OP.Mul, sum, constantRegister(1 / registers.length, context), context);
}

function emitBinary(opcode: number, a: number, b: number, context: CompileContext): number {
  const out = nextRegister(context);
  context.ops.push({ opcode, out, a, b });
  return out;
}

function valueRegisterForNodeParam(
  node: PatchNode,
  port: string,
  fallback: number,
  context: CompileContext,
): number {
  const definition = getNodeDefinition(node);
  const input = definition.inputs.find((candidate) => candidate.name === port);
  const value = finiteNumber(node.params[port], input?.defaultValue ?? fallback);
  return valueRegister(value, {
    id: `${node.id}.${port}`,
    kind: 'node-param',
    nodeId: node.id,
    port,
  }, context);
}

function valueRegisterForLinkWeight(link: PatchLink, context: CompileContext): number {
  const id = linkId(link);
  return valueRegister(finiteNumber(link.weight, 1), {
    id: `${id}.weight`,
    kind: 'link-weight',
    linkId: id,
  }, context);
}

function constantRegister(value: number, context: CompileContext): number {
  const normalized = finiteNumber(value, 0);
  const existingIndex = context.constantValueIndexes.get(normalized);
  if (existingIndex !== undefined) return emitValue(existingIndex, context);

  const valueIndex = context.values.length;
  context.constantValueIndexes.set(normalized, valueIndex);
  context.values.push(normalized);
  context.valueBindings.push({
    id: `constant.${normalized}`,
    valueIndex,
    kind: 'constant',
  });
  return emitValue(valueIndex, context);
}

function valueRegister(
  value: number,
  binding: Omit<DspValueBinding, 'valueIndex'>,
  context: CompileContext,
): number {
  const valueIndex = context.values.length;
  context.values.push(value);
  context.valueBindings.push({ ...binding, valueIndex });
  return emitValue(valueIndex, context);
}

function emitValue(valueIndex: number, context: CompileContext): number {
  const out = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.Value, out, a: valueIndex });
  return out;
}

function nextRegister(context: CompileContext): number {
  const register = context.registerCount;
  context.registerCount += 1;
  return register;
}

function nextState(context: CompileContext, count: number): number {
  const state = context.stateCount;
  context.stateCount += count;
  return state;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inputKey(nodeId: string, port: string): string {
  return `${nodeId}.${port}`;
}

function linkId(link: PatchLink): string {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}
