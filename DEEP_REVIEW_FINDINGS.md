# Deep Review Findings

Date: 2026-07-06

Scope: `visual-fm-2`, with comparison against sibling projects `../visual-fm` and `../visual-visual`.

This review treats the current repo as a mashup of two valid but different systems:

- `visual-visual`: a node-first graph where links are simple float carriers with `weight` and `mode`.
- `visual-fm`: an audio engine where links are rich DSP objects: modulation target, filter, distortion, envelope, delay, noise, follower, and link-to-link modulation.

The biggest finding is not that one file is bad. The app currently has two incompatible truths. The README says audio behavior lives in nodes and links are simple; the runtime still represents most processor-node behavior by mutating inherited `visual-fm` link fields. That lowering can work, but only if it is exact. Right now it is not exact in several important places, so patches feel inconsistent: link modes sometimes work, sometimes disappear, amplitudes change unexpectedly, parallel paths vanish, and node names promise behavior the compiled graph does not actually provide.

## Architectural Clarification

After discussion, the intended target is closer to `visual-visual` than this first review made explicit:

- There should not be a user-facing node engine with mutable node/link behavior. The patch should compile into a deterministic DSP program for the current graph shape.
- Numeric input values should be runtime values, like shader uniforms/control buffers in `visual-visual`. Editing a knob should update a value buffer, not require recompiling the generated DSP code.
- All ports should conceptually be floats. Audio-rate signals are floats over time, control values are floats over time or per block, and links should not be split into special "audio links" and "parameter links" in the patch model.
- The generated audio program can still be linear even when the graph is not. As in `visual-visual`, graph compilation should order the program, detect feedback, and replace true cycles with explicit previous-sample or previous-block state.
- Optimizations may introduce internal distinctions, such as per-sample, per-block, or constant evaluation, but those should be compiler/runtime implementation details. They should not leak into the user's patch semantics.

This reframes the root problem. The current system is not merely missing a few runtime cases; it is preserving too much of `visual-fm`'s link-centric runtime as the semantic model. The cleaner target is an audio code generator: compile graph topology to a DSP function/worklet/WASM module, pass current UI values separately, and maintain explicit state buffers for oscillators, delay lines, envelopes, samples, and feedback.

The existing Rust/WASM code can still be useful as a DSP library or backend, but the graph ABI probably wants to move away from "nodes plus rich links" toward "generated operations plus runtime value/state buffers."

## Verification Run

These checks pass:

- `npm run typecheck`
- `npm run build`
- `node scripts/render-worklet-startup.mjs 1`

So the project is syntactically healthy. The failures are semantic and architectural.

## Critical Findings

### 1. Link `mode` is ignored for signal routing

Evidence:

- Signal traversal applies only `weight` via `applyCable`; `mode` is not used for normal signal ports: `web/src/audio/compiler.ts:309`, `web/src/audio/compiler.ts:691`.
- Parameter links do pass `parameterMode` into WASM: `web/src/audio/compiler.ts:348`.

Impact:

The README says every link has `set`, `add`, or `multiply`, and that multiple links into one input resolve by averaged set, summed add, then multiplied multiply. That is only true for statically folded input parameters and dynamic parameter modulation. It is not true for audio/signal paths such as:

- multiple oscillators into `Gain.signal`
- multiple signals into `AudioOut.both`
- a signal into `Filter.signal`
- processor chains where users expect a signal input to obey link mode

In those cases, each source walks independently and eventually becomes separate WASM output or modulation links. The selected edge UI still exposes the mode selector, so the user can set modes that have no effect.

Likely fix:

Decide whether signal inputs are true audio mixers or the same scalar input model as `visual-visual`. If they are mixers, hide/disable mode on signal links and document/special-case them. If they should obey the model, the compiler needs an explicit per-input combine phase before walking downstream.

### 2. Parallel paths from the same source collapse into one WASM link

Evidence:

- Output link IDs are based on `originId` and the terminal patch link, not on the full processor path: `web/src/audio/compiler.ts:330`.
- The compiler dedupes WASM links by this id: `web/src/audio/compiler.ts:949`.

Impact:

If one oscillator reaches the same output through two different processor paths, only one path survives. Example:

```text
sine -> gain_a -> audio_out.both
sine -> filter_b -> audio_out.both
```

Both paths compile to an id shaped like:

```text
sine:signal->audio_out:both
```

`dedupeWasmLinks` drops the second one. This is a direct explanation for branches, parallel modulation routes, meters/scopes, or effect chains seeming unreliable.

Likely fix:

Compiled link IDs need to include the path identity, or the compiler should construct explicit intermediate virtual nodes/links instead of carrying anonymous state from an origin.

### 3. Static and dynamic `set/add/multiply` links do not combine correctly

Evidence:

- Static input aggregation skips dynamic sources entirely: `web/src/audio/compiler.ts:717`.
- `setLinkCount` includes dynamic set links even though their values are not in `setValues`: `web/src/audio/compiler.ts:734`.
- Dynamic frequency set forces base frequency to `0` only in the "dynamic set and no static set" case: `web/src/audio/compiler.ts:874`.
- Dynamic amplitude set falls back to a default value in the same kind of case: `web/src/audio/compiler.ts:884`.
- Rust does implement a generic `ParamAccumulator` for dynamic parameter modes: `rust/visual-fm-kernel/src/lib.rs:2474`.

Impact:

The same looking graph behaves differently depending on whether a source is static (`Constant` / static `Expression`) or dynamic (oscillator/audio-rate source). Broken cases include:

- dynamic `set` plus static `add`: the static add is dropped from the base.
- static `set` plus dynamic `set`: the static set is not averaged with the dynamic set at audio rate.
- static `multiply` plus dynamic `set`: the multiply can be dropped or applied to the wrong base.
- dynamic `set` to amplitude: local level/default handling is special-cased and does not follow the documented rule.

Likely fix:

The compiler needs one canonical input-combine model that can emit both static constants and dynamic modulation terms. Do not split the rule between TypeScript static folding and Rust dynamic accumulation unless the split preserves all three buckets exactly.

### 4. Processor-node parameters are inconsistently modulatable

Evidence:

The compiler emits dynamic input modulation for some processor parameters:

- `Gain.gain`: `web/src/audio/compiler.ts:383`
- `Multiply.factor`: `web/src/audio/compiler.ts:394`
- `Map.*`: `web/src/audio/compiler.ts:412`
- `Envelope.*`: `web/src/audio/compiler.ts:479`
- `Filter.*`: `web/src/audio/compiler.ts:532`
- `Distortion.drive`: `web/src/audio/compiler.ts:593`

But others are static-only or behave as plain gain:

- `Follower.attack/release`: no dynamic modulation emitted at `web/src/audio/compiler.ts:503`.
- `Fold.amount`: no dynamic modulation emitted at `web/src/audio/compiler.ts:514`.
- `RingMod.amount` and `Mix.amount`: only multiply `state.amount`, no dynamic modulation emitted: `web/src/audio/compiler.ts:525`.
- `Delay`, `Chorus`, and `Reverb` params are marked `connectable: false`, so dynamic modulation is intentionally blocked in UI: `web/src/graph/nodeTypes.ts`.

Impact:

Some knobs accept links and actually modulate. Some accept links but only static values are folded. Some processor names imply DSP behavior but compile as amplitude changes. This is the kind of inconsistency that makes modulation feel broadly "wrong" instead of locally buggy.

Likely fix:

Create a matrix of every node input and state whether it is static-only, control-rate, audio-rate, or non-connectable. Then make the UI and compiler enforce that matrix.

### 5. Delay, chorus, and reverb nodes are global master effects, not path-local nodes

Evidence:

- `Delay`, `Chorus`, and `Reverb` processor cases write `masterEffects` into carried state: `web/src/audio/compiler.ts:434`, `web/src/audio/compiler.ts:449`, `web/src/audio/compiler.ts:464`.
- `masterEffects` is merged into the global graph only when a path reaches audio output: `web/src/audio/compiler.ts:290`.

Impact:

A user sees a node in a chain and expects:

```text
osc -> delay -> audio out
```

to delay that signal path. Instead it toggles a global master effect. If another branch also reaches output, it is affected by the same master effect. If multiple paths set delay/reverb/chorus, the last merged settings win. This violates the node-first philosophy in the README.

Likely fix:

Either rename these nodes as master effect controls and move them out of the signal path, or implement/link-lower actual path-local effects.

## High Findings

### 6. Insert/delete/pass-through operations drop upstream weight and mode

Evidence:

- Inserting a draft node on an existing edge creates the upstream edge with `weight: 1`, `mode: 'set'`: `web/src/editor/NodeEditor.tsx:653`.
- Materializing typed links through passthrough draft nodes keeps only the downstream link's weight/mode: `web/src/editor/flowPatch.ts:334`.
- Deleting a selected node with bridge keeps only the outgoing link's weight/mode: `web/src/editor/NodeEditor.tsx:3306`.

Impact:

Editing the graph changes patch semantics. If the original edge was an `add` link with weight `0.2`, inserting a node on it resets the first half of the route to `set` and `1`. Deleting or materializing passthrough nodes also discards half of the route's scaling/mode information. This makes cable edits feel destructive.

Likely fix:

Define link composition rules. For weight, multiplication is usually expected through pass-through. For mode, either preserve the original link where possible or disallow mode-bearing pass-through until a clear rule exists.

### 7. Group expansion silently erases parallel links

Evidence:

- `expandGroups` dedupes links by endpoint only: `web/src/graph/subpatch.ts:184`.
- Editor-level edge dedupe also keys only by endpoint: `web/src/editor/NodeEditor.tsx:3456`.

Impact:

Parallel links with different weights or modes cannot coexist after group expansion or editor dedupe. Because `visual-visual` allows multiple links into one input as meaningful `set/add/multiply` contributors, endpoint-only dedupe destroys valid graph information.

Likely fix:

Either make parallel same-endpoint links impossible in the UI and compiler, or include a stable link id in the patch contract. Endpoint cannot be both identity and aggregation key if multiple contributors are allowed.

### 8. Group default inputs create links from a nonexistent output port

Evidence:

- Default group input nodes are `Constant` nodes: `web/src/graph/subpatch.ts:102`.
- The default boundary link uses `from: { port: 'value' }`: `web/src/graph/subpatch.ts:44`.
- `Constant` is defined with output `signal`, not `value`: `web/src/graph/nodeTypes.ts`.

Impact:

When a group input is unconnected, expansion creates a link from `Constant.value`, which is not a declared output. Static folding happens to tolerate both `signal` and `value` for constants in `staticOutputValue`, but signal walking only follows `from.port === 'signal'`. So the fallback can work for static parameter values but not as a normal signal source. That is brittle and inconsistent.

Likely fix:

Use `Constant.signal`, or add a real `value` output if constants are meant to be scalar sources with both names.

### 9. Node type changes remap ports by index, not semantics

Evidence:

- `remapEdgeForNodeType` maps old input/output index to new input/output index: `web/src/editor/NodeEditor.tsx:3481`.
- When updating node params after a type change, previous values are also copied by input index: `web/src/editor/NodeEditor.tsx:468`.

Impact:

Changing a node type can silently wire existing links to unrelated ports. Example: a link into `frequency` can become a link into `signal` or `gain` depending on input ordering. That is especially dangerous in an app where the first input may be a signal input and the next may be a control parameter.

Likely fix:

Map ports by name first. Only use index fallback for very narrow cases, and surface dropped links instead of silently rewiring them to unrelated semantics.

### 10. Local oscillator inputs advertise behavior that is not fully implemented

Evidence:

- Oscillator node definitions include `phase`, `phaseReset`, and `level`: `web/src/graph/nodeTypes.ts`.
- `compileSourceNode` uses `frequency`, ratio for some node types, speed/gain/sample/custom params, but does not pass static `phase` or static `phaseReset` into the WASM node: `web/src/audio/compiler.ts:199`.
- Dynamic links to `phase` and `phaseReset` can become parameter links: `web/src/audio/compiler.ts:929`.

Impact:

The UI lets users edit local `phase` and `phaseReset`, but those local values do not initialize or affect oscillator nodes. Only dynamic links to those ports matter. That makes local parameter editing misleading.

Likely fix:

Either implement static phase/phase reset in the engine boundary, or hide them as link-only ports.

### 11. `ratio` modulation is lowered as frequency modulation

Evidence:

- Static ratio for `CustomWave` and `SamplePlayer` multiplies frequency in `compileSourceNode`: `web/src/audio/compiler.ts:199`.
- Dynamic `ratio` targets are mapped to `frequency`: `web/src/audio/compiler.ts:928`.

Impact:

A static ratio of `2` means "twice the base frequency." A dynamic link to `ratio` does not modulate that ratio; it writes/modulates frequency directly. That breaks the mental model of the port.

Likely fix:

Add true ratio as a WASM modulation target or remove/hide dynamic connection for `ratio`.

## Medium Findings

### 12. Monitor-only meters/scopes inherit the same path-id collision risk

Evidence:

- Monitor link ids are based only on origin and monitor node: `web/src/audio/compiler.ts:368`.
- Scope/meter node ids are looked up by the first monitor link id: `web/src/editor/NodeEditor.tsx:1032`.

Impact:

If two paths from the same origin reach the same meter/scope through different processors, the monitor link id collides and only one path is displayed.

Likely fix:

Same as finding 2: compiled monitor links need path identity.

### 13. `RingMod` and `Mix` nodes are not real ring/mix processors

Evidence:

- `RingMod` and `Mix` both compile to `amount *= inputValue(node, 'amount')`: `web/src/audio/compiler.ts:525`.
- The Rust engine has true `TARGET_RING` and `TARGET_MIX` behavior for oscillator modulation links: `rust/visual-fm-kernel/src/lib.rs:2812`.

Impact:

The node names imply audio-rate ring modulation or cross-mixing. In this node-first app they currently act like gain scalers unless they are somehow represented as old-style modulation targets, which the node compiler does not do.

Likely fix:

Implement explicit two-input ring/mix nodes, or remove/rename them until their behavior matches the label.

### 14. `Fold` is implemented as link distortion, not a standalone processor

Evidence:

- `Fold.amount` becomes wavefold distortion gain in carried link state: `web/src/audio/compiler.ts:514`.

Impact:

This is a reasonable lowering trick, but it inherits all link-state path issues. It also means dynamic modulation of `Fold.amount` is not implemented.

Likely fix:

Treat it consistently with distortion nodes and add dynamic modulation support, or implement Fold as a true processor in the kernel graph model.

### 15. Static folding supports only a subset of processor behavior

Legacy note: this finding refers to the deprecated `WasmAudioGraph` compiler in `web/src/audio/compiler.ts`, not the active `DspProgram` compiler.

Evidence:

- Static output folding handles `Gain`, `Multiply`, `Abs`, and `Map`: `web/src/audio/compiler.ts:789`.
- Other processor nodes fall through as pass-through signal: `web/src/audio/compiler.ts:813`.

Impact:

Static constants through filter/distortion/fold/envelope/follower do not reflect those processors. Some of that may be acceptable for audio-only processors, but it affects parameter defaults and static modulation chains in surprising ways.

Likely fix:

Define which processors can have meaningful static output. For the rest, reject static folding explicitly rather than passing through.

### 16. There is no equivalent of `visual-visual` patch validation in this project

Legacy note: `compilePatchToWasmGraph` is no longer the active audio compiler. Current validation work should target the `DspProgram` path in `web/src/audio/dspProgram.ts`.

Evidence:

- `../visual-visual` has `web/src/graph/validate.ts`.
- `visual-fm-2` has no validation module and `patchFromFlow`/`compilePatchToWasmGraph` accept whatever links survive the editor conversion.

Impact:

Invalid ports, duplicate node ids after expansion, unconnectable input links, unsupported link modes on signal ports, missing audio out, and hidden group expansion errors are not reported as patch errors. They either compile to silence or half-work.

Likely fix:

Port/adapt `visual-visual` validation, then add audio-specific validation: exactly what can be audio-rate, static-only, signal-only, or output-only.

## Lower Findings And Cleanup Notes

### 17. The README describes the intended model more cleanly than the code implements

Evidence:

- README says "audio behavior lives in nodes" and "cables connect node ports."
- Compiler lowers many processor nodes into fields on a single carried WASM link state.

Impact:

The README is a useful north star, but right now it can mislead contributors because the implementation boundary is much more fragile than it sounds.

Likely fix:

After deciding the architecture, update the README to describe the actual invariants and unsupported cases.

### 18. The WASM API is still link-centric

Compatibility note: the active worklet path now syncs `DspProgram` payloads. The old graph sync remains in `Legacy*` worklet methods for compatibility with old `WasmAudioGraph` payloads and should not be treated as the current runtime boundary.

Evidence:

- Worklet `normalizeLink` accepts filter, distortion, envelope, follower, map, signal mode, and parameter mode: `web/public/audio/audio-worklet-wasm.js:398`.
- Legacy `syncLegacyRustGraph` sends these fields per link to Rust.

Impact:

The compiler has to pretend nodes are first-class while the engine only understands source nodes plus rich links. That is the root of many hard-to-fix bugs.

Likely fix:

Medium term, introduce explicit processor nodes into the engine graph ABI. Short term, create a stricter lowering layer with virtual links that preserve identity and aggregation.

### 19. Some node definitions expose internal or legacy concepts

Examples:

- `Filter` and `Distortion` legacy generic nodes are still in `NodeType`, normalized away in persisted state, and hidden from the node list.
- `LinkNoise` still exists as a type but is hidden and normalized to `Gain`.

Impact:

This is survivable migration debris, but it increases the chance of imported patches compiling differently than expected.

Likely fix:

Keep explicit migration tests, then remove old types from the public type union once no longer needed.

## Recommended Repair Order

1. Freeze the patch contract.

   The clarified target is: all ports are floats, all links follow the same `weight/mode` semantics, and any per-sample/per-block/static distinction is an optimization.

2. Prototype a generated DSP program path.

   Build one tiny compiler path for a subset such as `SineOsc`, `Constant`, `Gain`, `Add/Multiply`, `Filter`, and `AudioOut`. Generate a linear operation list or generated worklet function from graph topology, with numeric params passed in a mutable value array.

3. Add explicit feedback lowering.

   Detect cycles and insert previous-sample or previous-block state reads/writes, matching the `visual-visual` idea of fake feedback. This should be a graph compiler feature, not emergent behavior of recursive runtime traversal.

4. Add validation before audio compilation.

   Invalid patches should produce precise errors instead of silence. Start with port existence, connectability, duplicate expanded ids, unsupported dynamic modulation, and signal-link mode rules.

5. Fix compiled link identity.

   Include path identity or introduce virtual nodes/links so parallel paths cannot collapse.

6. Make input aggregation canonical.

   Implement one combine model for every input: averaged `set`, summed `add`, multiplied `multiply`. Then lower it to generated DSP code with runtime value reads where needed.

7. Audit every node input.

   Produce a table of every port and its rate behavior: constant, UI-control-rate, per-block, or per-sample. Keep the public type as float; use rate only for optimization and scheduling.

8. Reclassify master effects.

   Either make Delay/Chorus/Reverb true path-local nodes or move them to a master section.

9. Add behavioral tests.

   Suggested tests:

   - two static set links average correctly.
   - static add plus dynamic set survives.
   - two dynamic set links average in Rust.
   - signal link mode either rejected or honored.
   - parallel source paths both compile.
   - group default input uses a real output port.
   - inserting/deleting a node preserves expected link semantics.
   - each node input either modulates correctly or is rejected as non-connectable.

## Bottom Line

The project is not doomed. The UI shell is coherent and the WASM engine can render sound. The broken feeling comes from the adapter layer: `visual-fm-2` wants `visual-visual` graph semantics while still compiling through `visual-fm` link semantics. Until that boundary is made explicit and tested, small fixes will keep moving bugs around.
