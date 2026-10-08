# Engine optimisation tasks

Implementation briefs for separate Codex threads. Written 8 October 2026; these are proposed changes, not completed optimisations or measured speedups. Reinspect the current source before starting each task.

## Using this document

Start a thread with: **“Implement task N from optimisations.md. Follow its shared requirements and acceptance criteria.”** Task 5 is deliberately staged: request 5A first, then 5B, then 5C. Task 6 covers the additional editor rendering advice.

Recommended order: 1, 3, 2, 4, then 5. Task 3 establishes useful compiler analysis for tasks 2 and 5. Task 6 can be tackled independently. Tasks share files: integrate one change before starting another that modifies the same compiler/kernel structures. Record completed scope and remaining stages here at handoff.

## Shared requirements for every thread

- Read `AGENTS.md` and preserve existing unrelated changes. This document does not authorize launching the app, browser automation, Docker service rebuilds/restarts, or functional tests. Runtime benchmarks and audio comparisons also require explicit user authorization in that conversation. Prepare validation cases and report them as unrun when authorization is absent.
- Preserve sound, smoothing trajectories, sample ordering, event timing, state migration, reset behavior, and external parameter bindings. Keep the existing scalar renderer as a reference/fallback where relevant. Do not silently change sample rate, precision, smoothing duration, or use approximate maths.
- Cover the editor and the npm runtime. The ZIP remains patch-only: editable patch, compiled program, manifest, and assets; never embed the runtime. Preserve old program compatibility or explicitly version incompatible formats and reject unsupported versions clearly.
- Keep allocations, growing collections, logging, and plan construction out of the per-sample hot path. Preallocate bounded working storage at program setup where feasible. Audit serial and parallel execution, Spread item state, and Spawn instance state before sharing caches or changing scheduling.
- Use source inspection and non-running checks. Relevant checks are `npm run typecheck`, `npm run build:player-runtime`, and `git diff --check`. Select checks appropriate to the changed files; documentation-only tasks need no engine build. After any Rust/WASM change, **always run `npm run build:wasm`**, then rebuild the runtime so it contains the updated kernel. Check the build script's treatment of both kernel variants when modifying parallel-sensitive code.
- Do not run an unconfigured editor production build. Follow `AGENTS.md` to inspect and preserve the active Docker theme and set `VITE_VISUAL_VISUAL_PATCH_STORAGE=local`; if the theme is unknown, use typechecking instead.
- If delivering changes to the sibling `../visual-fm-player`, inspect its instructions, repack the npm runtime, update its vendored dependency/version and lockfile integrity, and verify it contains the intended artifacts. Building this repository alone does not update a previously installed player package. Do not recreate the running container yourself without authorization.
- Review README impact. Document architectural changes, compatibility, and any new controls. At handoff state which checks passed, which comparisons remain unrun, and how the user sees the result: hot reload, ordinary refresh, or rebuild/restart with exact applicable commands. Do not claim CPU improvements without measurements.

### Source map

- `rust/visual-fm-kernel/src/lib.rs`: value smoothing, node DSP, operation interpreter, render loop, state/resource lifecycle.
- `rust/visual-fm-kernel/src/parallel.rs`: parallel execution and instance ownership; inspect alongside any scheduling/cache change.
- `web/src/audio/dspProgram.ts`: graph expansion, bindings, feedback lowering, operation emission.
- `web/public/audio/audio-worklet-wasm.js`: program upload, audio callback, messages, editor/player build guards.
- `web/src/audio/useAudioEngine.ts`: editor audio integration and live data delivery.
- `web/src/editor/NodeEditor.tsx`, `web/src/editor/ShaderNode.tsx`: editor rendering and subscriptions.
- `player-runtime/src/index.ts`, `scripts/build-player-runtime.mjs`: public runtime and package artifact build.
- `web/src/audio/patchPackage.ts`: exported program/manifest compatibility.

### Measurement plan (execute only when authorized)

Compare the same patch, sample rate, render mode, active instance count, assets, and build configuration after warmup. Measure median and tail callback time/deadline misses as well as total CPU; the editor CPU bar measures callback elapsed time and excludes UI rendering, while Chrome reports a broader process cost. Instrumentation should be opt-in and disabled in normal playback.

Use ringing-drone plus small cases isolating the changed feature. Include stable parameters, active smoothing, audio-rate modulation, feedback, and Spread/Spawn where applicable. Compare audio and relevant state/events with the reference renderer. Require exact equivalence for changes preserving arithmetic order; explicitly justify a numerical tolerance for any deliberate rounding difference. Long feedback renders can amplify tiny differences, so short output comparisons alone are insufficient. Report memory and startup/compile cost when introducing caches or buffers.

## 1. Process only parameters that are smoothing

**Status (8 October 2026):** Implemented in the Rust kernel with a bounded dense list and constant-time membership/removal. The single and parallel WASM variants and npm runtime artifacts have been rebuilt. Offline single-kernel benchmarks, exact-output transition checks, and serial/parallel saved-patch comparisons passed; in-app AudioWorklet timing remains for user testing. Tasks 4–6 remain separate work, alongside the remaining task 3 stages below.

**Objective:** remove the per-sample scan of settled parameters without changing their values or timing.

**Original entry points:** `advance_dsp_values`, `setDspValue`, `setDspValueImmediate`, `DSP_VALUE_ACTIVE_COUNT`, and all value reset/program-upload paths in `lib.rs`. Before this change, the active count was a high-water mark rather than a list of moving values.

### Implementation

1. Find every write to current values, targets, initialization flags, and active count, including internal FFT/control outputs. Establish which thread owns each write.
2. Add a preallocated dense list of smoothing value indices plus membership/position metadata, bounded by `MAX_DSP_VALUES`. Make insertion duplicate-free and removal constant time.
3. In the ordinary setter, preserve first-assignment behavior: an uninitialized value starts directly at its target. Add an initialized value only when its current value differs from the target. Retargeting must use the current smoothed value and must not restart from an earlier value.
4. Make immediate assignment remove any pending smoothing entry. Setting the target equal to the current value must also leave no unnecessary work.
5. Iterate only the moving entries in `advance_dsp_values`. Preserve the existing alpha, update formula, epsilon, and exact target snap. On removal, process the swapped-in entry correctly in that same sample. Return immediately for an empty list.
6. Clear/reconstruct membership at every relevant lifecycle boundary. Never carry stale indices across a program replacement or let one repeated instance mutate another's state.

**Acceptance:** settled values cause no scan proportional to all allocated value slots; first assignment, repeated target writes, mid-ramp retargeting, immediate assignment, settling, reset, and program replacement preserve behavior. Prepare equivalence cases for these transitions and serial/parallel modes. No per-sample allocation.

**Dependency:** none. Expose an internal change indicator only if useful for task 2; do not redesign the public parameter API for this task.

## 2. Cache stable control calculations

**Status (8 October 2026):** Implemented for expensive pure control operations in the ordinary scalar path. Upload-time provenance follows DSP values and pure arithmetic, and runtime input comparisons reuse stable results. Spread/Spawn templates and per-voice rendering retain their original execution path. Single and parallel WASM variants and the npm runtime artifact were rebuilt. Offline A/B slider and saved-patch benchmarks plus exact-output transition and audio-rate checks passed; an in-app AudioWorklet timing comparison remains for user testing.

**Objective:** stop recomputing pure control expressions whose inputs have not changed, while retaining sample-accurate smoothing and modulation.

**Entry points:** compiler value bindings and `applySliderCurve` in `dspProgram.ts`; operation execution and value updates in `lib.rs`. Slider mapping can emit clamp, exponent, and power calculations even when its controls are stable.

### Implementation

1. Define internal dependency metadata distinguishing immutable literals, mutable external/control values, and sample-varying or stateful sources. A slider or Params output is mutable even when it has no input cable. MIDI, FFT outputs, time, random sources, and resource reads need explicit treatment.
2. Start with pure slider mapping/curve and arithmetic chains. Build their dependency/invalidation plan once at compile/upload time. Do not infer immutability from the current numeric value or a screenshot.
3. Recompute a cached result whenever an upstream value actually changes. During smoothing this can mean every sample; once all dependencies settle, reuse it. An unchanged target does not imply an unchanged current value.
4. Propagate invalidation through derived values without repeatedly scanning the whole graph. Prefer small bounded metadata and measure whether checking it costs less than the calculation it replaces.
5. Keep stateful nodes advancing even with constant inputs. Do not move a varying expression to once-per-block evaluation unless that is already its defined behavior. Preserve current event and FFT update boundaries.
6. Account for program replacement and instance-local dependencies. Conservatively use the current path for unsupported repeated/stateful cases.

**Acceptance:** stable control chains skip expensive maths; changing any dependency resumes correct updates immediately. Include slider curve/range changes, MIDI/external Params, mid-ramp changes, audio-rate connected controls, reset, and repeated instances. Biquad coefficients already have caching: inspect `cached_biquad_coefficients` before duplicating work. Its parallel repeat bypass is a separate ownership issue, not permission to introduce a shared mutable cache.

**Dependency:** coordinate with task 1's value lifecycle and task 3's register/dependency analysis. Runtime caching and compile-time constant folding must agree on what is mutable.

## 3. Simplify the compiled DSP operations

**Status (8 October 2026):** Implemented immutable load deduplication, conservative constant folding for add/multiply/subtract/divide, and dead pure-operation elimination outside repeat templates. The compiler emits per-pass operation/register/value/state reports and removal reasons; passes can be disabled individually. Five saved-patch offline A/B benchmarks and exact-output comparisons passed. General register compaction, more complete pure-function folding, repeat-template elimination, and in-app AudioWorklet timing remain future stages.

**Objective:** reduce interpreter dispatch and redundant loads/arithmetic without changing DSP semantics.

**Entry points:** `DspProgram`, operation emission and bindings in `dspProgram.ts`; validation and `render_dsp_op`/`render_dsp_ops` in `lib.rs`.

### Implementation

1. Add a compile-time report of operation counts by opcode, registers, values, and state, with before/after counts for each pass. Keep diagnostics out of normal render callbacks.
2. Establish def/use information and operation traits: pure, stateful, event-producing, resource-reading/writing, or ordering barrier. Registers in repeat templates and feedback histories cannot automatically be treated as ordinary single-assignment values.
3. Deduplicate repeated loads only within regions where the loaded value cannot change. Fold genuinely immutable pure expressions using the kernel's actual semantics, including sanitization and sign-preserving power; JavaScript `Math.pow` is not automatically an equivalent evaluator.
4. Eliminate unused pure operations while preserving observable roots: audio outputs, external bindings, MIDI/event outputs, resource writes, and editor monitoring when requested. A Scope display can be omitted in the player; FFT values used by DSP cannot.
5. Remap all affected registers/bindings, feedback reads/writes, repeat metadata, and monitor references. Preserve state identity and migration across structural edits.
6. Consider limited operation fusion only after the simpler passes. Avoid reassociation, fused multiply-add, or algebraic shortcuts that change rounding, clipping/sanitization, signed zero, or edge-case behavior without an explicit design decision. If adding opcodes, update validators, kernel variants, package versions, and compatibility handling together.

**Acceptance:** compiler diagnostics show which operations were removed and why. Mutable parameters remain mutable without recompiling. Preserve feedback, events, stateful effects, and export/load compatibility. Prepare comparison cases for pure expressions, numeric edge cases, monitored outputs, shared subexpressions, and repeat templates. Keep passes independently understandable and disableable for diagnosis.

## 4. Cache Kink oscillator shape calculations

**Objective:** avoid repeating parameter-dependent maths while preserving the current waveform.

**Entry points:** `dsp_kink_oscillator`, `render_dsp_phase_oscillator_output`, oscillator state/resource allocation and migration in `lib.rs`.

### Implementation

1. Separate shape preparation from phase-dependent evaluation. Cache clamped squareness, magnitude, shape breakpoint, exponent, and branch conditions when their source parameters are unchanged.
2. Keep phase evaluation and its power operation at sample rate. Caching the exponent does not remove `powf` for a changing base.
3. Store the cache per oscillator instance, including Spread/Spawn and parallel ownership. Invalidate on relevant parameter changes, program/state replacement, and reset as appropriate. Avoid a global cache keyed only by an index reused across instances.
4. Preserve special cases at shape endpoints and squareness magnitude one. During audio-rate modulation or smoothing, recompute exactly as necessary. Compare cache-check overhead with savings for both static and rapidly modulated inputs.
5. Keep approximate power, lookup tables, lower precision, and altered waveform formulae out of this task. Replacing division with multiplication by a cached reciprocal can also change rounding; treat that separately rather than calling it exact caching.

**Acceptance:** the unchanged arithmetic path produces the same waveform and phase progression, including endpoint cases, phase resets, changing shape/squareness, and independent instances. State and memory overhead are documented. Any future approximation requires a separate quality proposal, error/aliasing measurements, and user agreement.

**Dependency:** independent of task 2, but share its invalidation conventions where practical. Do not assume this is the largest hotspot without profiling.

## 5. Render eligible graph regions in blocks

**Objective:** dispatch each eligible operation once per block, preserving sample ordering inside feedback regions and stateful node kernels. Block rendering and SIMD are separate steps; block rendering does not automatically make a recursive filter SIMD-friendly.

### 5A. Dependency analysis and scheduling plan

1. Build an execution dependency graph after graph expansion. Include implicit Send/Receive dependencies, feedback history edges, resource aliases, events, and repeat boundaries. The visible cable graph alone is insufficient.
2. Find strongly connected components (SCCs), including self-loops, and topologically order the component graph. Audit existing feedback lowering: `feedbackRegisterForOutput` and feedback writes introduce temporal behavior that must survive scheduling even if the lowered instruction list looks acyclic.
3. Classify acyclic supported regions as block candidates; keep cyclic regions sample-by-sample. A filter/delay's private internal history does not itself disqualify its block kernel, but cross-node or shared-resource dependencies can.
4. Treat unsupported operations and ordering-sensitive side effects conservatively. Record an explicit fallback reason. A whole-program scalar fallback is acceptable for the first implementation.
5. Emit inspectable diagnostics listing regions, dependencies, feedback boundaries, and eligibility reasons. Do not change rendering in stage 5A.

**Acceptance:** analysis accounts for all operations and their observable ordering. Prepare cases for a chain, branching/fan-in, disconnected observable outputs, self-feedback, multiple cycles, Send/Receive, shared Buffer access, and repeated templates. Mark this stage complete only as analysis, not as a CPU optimisation.

### 5B. Block kernels for supported acyclic programs

1. Introduce a conservative internal execution plan with scalar fallback. Start with pure arithmetic and supported oscillator/filter/output kernels; expand only as their semantics are audited.
2. Preallocate intermediate buffers and reuse storage using output lifetimes. Support the actual frame count and partial blocks; do not spread a hard-coded 128-frame assumption through the kernels. Document memory limits and fallback behavior.
3. Produce sample-varying parameter/control streams once for each block and share them with consumers. Advance each smoother and event timeline exactly once per sample, not once per node. Do not mutate the single shared parameter state to the end of the block before earlier samples have consumed it.
4. Allow audio-rate modulation through input buffers. Stateful nodes maintain their own histories in internal sample loops. Preserve channel mixing, graph transitions, metering/FFT needs, input handling, and events at their existing sample offsets.
5. Keep unsupported feedback/resource/repeat programs on the scalar path initially. Prefer a runtime-derived plan when possible so existing exported programs remain loadable; explicitly version any required program-format change.

**Acceptance:** supported acyclic programs match scalar outputs/state/events, while unsupported programs retain the existing path. Measure dispatch savings against intermediate buffer traffic, memory footprint, and worst-case callback time when authorized. Keep the fallback if short graphs or highly modulated cases regress.

### 5C. Mixed feedback regions and selective SIMD

1. Execute the SCC condensation graph in order. Each cyclic component processes its samples in the established internal order, consumes upstream buffers, and produces buffers for downstream components. Preserve feedback read/write timing exactly; do not introduce one-block latency.
2. Extend support for repeats, dynamic instances, and shared resources only with explicit ownership/order analysis. Existing multi-worker scheduling is a separate system and must not be assumed compatible automatically.
3. Add SIMD only to suitable kernels, such as independent arithmetic samples or independent voices with proven state separation. Preserve scalar tails and non-SIMD fallback, and assess WASM feature compatibility and package builds.
4. Do not treat a nonzero user delay as permission to break a feedback cycle. Any scheduling based on delay length requires a proven minimum delay over the processed chunk, including modulation and zero-delay behavior.

**Acceptance:** mixed cyclic/acyclic graphs retain feedback timing and event/resource ordering. Document numerical differences if any, measured performance, memory overhead, and remaining fallback classes. No blanket claim that all eligible graphs get faster.

**Dependencies:** tasks 2 and 3 affect the plan's value and register semantics. Complete 5A before 5B and 5B before 5C. This is a larger architecture change; deliver each stage separately.

## 6. Isolate editor live visual updates

**Objective:** prevent meter/playhead/value updates from rerendering the entire editor tree.

**Entry points:** `useAudioEngine.ts`, `NodeEditor.tsx`, `ShaderNode.tsx`, worklet visualization messages, and Scope/FFT subscriptions.

### Implementation

1. Trace each live message into React state and identify which components actually depend on it. Separate editable patch state from transient meters, playheads, and sampled values.
2. Introduce narrow subscriptions or another measured local-update mechanism so only affected visual components update. Preserve immutable patch edits, undo/redo, persistence, and normal parameter controls.
3. Subscribe to display data only when a relevant display needs it, with explicit visibility/collapse behavior. Throttle/coalesce visual messages and skip unchanged payloads where useful. Never gate audio computation, FFT-derived DSP outputs, or required state persistence on UI visibility.
4. Keep the npm player free of editor subscriptions. Inspect existing `PLAYER_RUNTIME_BUILD` guards and current 15/30 Hz visualization policy before adding overlapping machinery.

**Acceptance:** live updates no longer require unrelated nodes or the whole editor to render. Prepare functional checks for scopes, meters, playheads, collapsing/hiding nodes, parameter edits, undo/redo, and saved Buffer contents. Profile main-thread rendering separately from audio only when authorized; report existing trace observations separately from new measurements.

**Dependency:** independent of engine tasks. No engine/package changes are needed unless the message/subscription protocol changes.
