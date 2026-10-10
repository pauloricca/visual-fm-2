# FM-1 spike 1: pinned build and resource inventory

This experiment builds Felucca firmware and inspects its ELF file. It does not
flash a device, run firmware, launch an emulator, or build/restart Teia. The
firmware is an upstream baseline, **not a Teia player**. Hardware compatibility,
audio correctness, CPU load, and stack high-water marks remain untested.

## Product boundary

The intended product is a **naked Teia runtime**, not Felucca with an additional
synthesis engine. It has no Felucca sounds, factory sample bank, sequencer,
arpeggiator, tracks, mixer, or always-present musical effects. With no patch
loaded, it is silent. Synthesis, sequencing and effects are determined by the
uploaded Teia graph, using DSP primitives implemented in the runtime.

Keep only device services: boot/recovery, watchdog, audio output and physical
master level, key/encoder scanning and calibration, MIDI event transport,
patch upload/validation/storage, and a small screen for patch selection and
parameter labels. The following upstream measurements establish a toolchain
and identify reusable hardware support; they do not make upstream's feature
set part of the product.

## Reproduction

The build runner is `scripts/fm1-build-spike.py`. All third-party source,
dependencies, logs and binaries stay in the ignored `.cache/fm1-spike/` directory.
The checked-in JSON reports preserve the measurements independently of that cache.

Pinned inputs:

| Input | Pin |
| --- | --- |
| [Felucca](https://github.com/hugelton/Felucca) | `129a4cf4e98e6ef06a4a89e97b65092247d69412` (1.5) |
| [JieLi SDK](https://gitee.com/Jieli-Tech/fw-AC79_AIoT_SDK) | `d179b4484759423312073f5fbb232501aa491047`, tag `AC79NN_SDK_V1.2.1_2023-12-13` |
| JieLi toolchain | `jieli-linux-toolchains-20260730.1`; archive SHA-256 `a1545cddbc451a06bac43eb5cd96d831470c42a97c5c0b1f98879a20fc7647bd` |
| Compiler container | `debian@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587`, Linux amd64 |
| Host Python | 3.14.3 |
| Python packages | Pillow 12.2.0, fonttools 4.60.2 |

On this Apple Silicon Mac, Docker runs only temporary compiler containers. It
does not use Compose, publish ports, mount Teia's application output, or change
existing containers. The runner calls upstream's build API with the pinned
container digest; upstream source remains unchanged.

Initial setup from the Teia repository root (downloads dependencies):

```sh
mkdir -p .cache/fm1-spike/jieli
git clone https://github.com/hugelton/Felucca.git .cache/fm1-spike/Felucca
git -C .cache/fm1-spike/Felucca checkout --detach 129a4cf4e98e6ef06a4a89e97b65092247d69412
git clone --depth 1 --branch AC79NN_SDK_V1.2.1_2023-12-13 https://gitee.com/Jieli-Tech/fw-AC79_AIoT_SDK.git .cache/fm1-spike/sdk
curl -fL https://pkgman.jieliapp.com/s/linux-toolchain -o .cache/fm1-spike/toolchain.tar.xz
printf '%s\n' 'a1545cddbc451a06bac43eb5cd96d831470c42a97c5c0b1f98879a20fc7647bd  .cache/fm1-spike/toolchain.tar.xz' | shasum -a 256 -c -
```

Stop if the checksum does not match: the download URL is mutable. Obtain the
pinned archive rather than silently changing the experiment. After verification:

```sh
tar -xJf .cache/fm1-spike/toolchain.tar.xz -C .cache/fm1-spike/jieli
python3.14 -m venv .cache/fm1-spike/python
.cache/fm1-spike/python/bin/pip install Pillow==12.2.0 fonttools==4.60.2
docker pull --platform linux/amd64 debian@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
```

Run builds **sequentially**, because they share upstream's generated build directory.
Use a new label for each run; existing results are never overwritten:

```sh
.cache/fm1-spike/python/bin/python scripts/fm1-build-spike.py --profile baseline --label baseline-1 > .cache/fm1-spike/baseline-1.log 2>&1
.cache/fm1-spike/python/bin/python scripts/fm1-build-spike.py --profile baseline --label baseline-2 > .cache/fm1-spike/baseline-2.log 2>&1
.cache/fm1-spike/python/bin/python scripts/fm1-build-spike.py --profile reduced --label reduced-1 > .cache/fm1-spike/reduced-1.log 2>&1
```

Each result directory contains the ELF, firmware binary/package, update loader,
section/symbol listings and a JSON report with hashes, build inputs, region
occupancy, and the largest static objects. These are local research artifacts;
redistribution requires the upstream license/source materials.

The initial system-Python 3.9/Pillow 11.3 attempt failed because its macOS wheel
lacked Raqm font shaping. The pinned Python environment above has Raqm; the
runner explicitly checks it. This is a real prerequisite beyond the upstream
instruction to install Pillow and fonttools.

## Profiles

- **baseline:** upstream defaults with bundled factory samples; no source changes.
- **reduced:** sets `FELUCCA_CDC=0`, `FELUCCA_UAC=0`, `FELUCCA_SLICE=0`,
  `FELUCCA_ICONS=0`. Keeps flash persistence, updater, USB MIDI, and TRS MIDI.
  This is a supported-flags comparison, not a minimal Teia firmware. Disabling
  the SLICE synthesis engine does not remove the separate SLICER effect.

## Interpretation limits

Region free space is linker headroom, not a measured runtime heap. RAM and POOL
are partitions of the same SRAM; moving their boundary needs a linker change.
Stack reservations, RAM-resident flash code, boot mailboxes and guard bands are
outside these two data regions. Upstream checks reserve at least 4 KiB RAM and
8 KiB POOL headroom, so not all reported free bytes should be assigned to Teia.

An unchanged-build hash match demonstrates repeatability in this pinned local
environment, not equivalence to the maintainer's release or reproducibility
across operating systems/font libraries. No performance claim follows from a
successful static build.

The first two reports record the compiler's default `--version` banner, which
says x86-64. Actual compilation passes `-target pi32v2`, and the resulting ELF
is `ELF32-pi32v2`; the reduced report and current runner query the banner with
that target explicitly. This does not affect the firmware hashes.

## Baseline findings

Two clean baseline builds produced identical SHA-256 hashes for all four
artifacts: the app, ELF, update loader and installable package. The app is
491,692 bytes; the package is 610,086 bytes (package size is not app-slot usage).
Upstream's static entry-point, flash-off code, ROM-reference, image-size,
headroom and HAL-boundary checks passed.

| Region | Used bytes | Capacity bytes | Free bytes |
| --- | ---: | ---: | ---: |
| App image / XIP slot | 491,692 | 581,564 | 89,872 |
| RAM data and BSS, including alignment | 54,916 | 73,728 | 18,812 |
| POOL buffers | 327,796 | 368,640 | 40,844 |
| RAM-resident code | 2,924 | 24,576 | 21,652 |

RAMTEXT spare space is not included in the proposed DSP budget: this region
supports flash-off code and has its own layout constraints. NOINIT is also not
ordinary free memory: its section occupies 15,564 bytes of 15,696 reserved bytes,
including the project-slot cache. Stack reservations are not measured usage.

Largest identified allocations from the linked ELF:

| Symbol | Bytes | Role / removal implications |
| --- | ---: | --- |
| `dly_buf` | 131,072 | Global delay; remove or shorten with corresponding DSP changes |
| `cv_px` | 59,520 | UI graph canvas; keep initially, or redesign drawing around smaller tiles |
| `eng_mem` | 51,552 | Four shared engine-state regions; replace when Teia owns synthesis |
| `sl_buf` | 32,768 | Four SLICER effect buffers; independent of the SLICE build flag |
| `rev_comb` | 9,874 | Reverb delay lines; shared by reverb modes, not one saving per mode |
| `cho_buf` | 4,096 | Chorus delay line |
| `SMP_DATA` (flash) | 126,244 | Bundled factory sample data; removable for synthesis-only firmware |

These are actual symbol sizes, **not measured savings from a stripped build**.
Removing an engine does not necessarily shrink `eng_mem`: all engines already
share it, and its capacity is determined by the largest remaining engine.

## Supported-flags comparison

The reduced profile also passed upstream's static build checks:

| Measurement | Baseline | Reduced | Saving |
| --- | ---: | ---: | ---: |
| App image bytes | 491,692 | 439,408 | 52,284 |
| RAM data/BSS bytes | 54,916 | 44,548 | 10,368 |
| POOL bytes | 327,796 | 327,796 | 0 |

This is useful negative evidence: turning off USB audio/serial, icons and the
SLICE engine does **not** release the large DSP buffers. A naked runtime needs
the explicit extraction described below, rather than accumulating feature flags.
The reduced profile is not proposed as the product base.

Evidence: [baseline run 1](fm1-results/baseline-1.json),
[baseline run 2](fm1-results/baseline-2.json), and
[reduced run](fm1-results/reduced-1.json). Full logs and ELF symbol/section
listings remain under `.cache/fm1-spike/`.

## Proposed budget for spike 2

The next build should extract a minimal device shell, then connect its audio
callback directly to a Teia renderer. Do not register Teia in Felucca's existing
engine/track system. Start the renderer with a **16 KiB arena**, one voice, and
an oscillator/envelope/gain patch. Measure the shell's own linked footprint
before setting final patch limits. These are engineering targets, not evidence
that the DSP meets its audio deadline.

For the later standalone Teia shell, removing the existing global delay, SLICER
buffers and old shared engine state would arithmetically increase baseline POOL
headroom from 40,844 to 256,236 bytes before replacement overhead. This supports
a **provisional 192 KiB DSP arena target**, leaving 59,628 bytes for other growth
and reserves. That target needs a real stripped build before it can be promised.
This conservative arithmetic even leaves the old UI canvas in place. A minimal
patch/parameter screen should eventually need much less, but its saving is not
measured here.

Storage is a separate budget. The existing user-sample area at
`0xA0000..0xDBFFF` is 245,760 bytes (240 KiB), already allocated to user samples.
A dedicated Teia firmware could explicitly repurpose it for program slots,
metadata, staging and optional assets. It is not unused space in Felucca, and
reusing it requires a format/migration decision. The current generic persistent
object payload is only 3,840 bytes; larger Teia programs need a multi-sector
object format rather than simply increasing a preset struct. Keep updater,
boot metadata and recovery regions intact.

The next meaningful experiment is the minimal native DSP renderer and numeric
cost comparison. This spike establishes a viable build path and an initial
memory envelope, not audio performance or an install-ready Teia firmware.

## Extraction boundary for the naked runtime

| Reuse or adapt | Replace / leave out |
| --- | --- |
| `firmware/hal/`, startup/vector assembly and linker reservations | `core.h` track/voice/song model |
| I2S/DMA bring-up and interrupt acknowledgement | `audio.c` render callback, tied to `mix_block`, metronome and voice shedding |
| Key/encoder scanning and physical panel mapping | Synth-oriented button pages, musical layers and graphics |
| USB MIDI framing, TRS receive, bounded event queues | Dispatch into Felucca's sequencer, arpeggiator and synth controls |
| Flash driver, A/B commit concept, update loader and recovery entry | Project, sample-bank and user-sound serializers; synth-specific editor commands |
| Master pot, watchdog, overload timing and mute-on-failure | Factory sounds/assets, stock engines, effect buses, recorder and song state |

This is an extraction/refactoring task, not a list of existing build flags.
Upstream builds one ordered C compilation unit; `main.c`, `audio.c`, UI and
storage code share application state. The hardware abstraction is comparatively
well separated, but the higher-level drivers/services need narrow Teia-facing
interfaces. Preserve the updater and recovery path while removing the musical
application above them. All derived firmware remains subject to upstream's
GPL-3.0-only licensing.

## Follow-up implementation

The [naked runtime spike](../../firmware/fm1/README.md) now implements this
extraction with one embedded Teia sine/envelope graph. The application image
is 24,852 bytes, with 12,000 bytes of `.data + .bss` and 19,072 bytes of pool
reservation (including a deliberately reserved 16 KiB runtime arena).
These figures exclude the separate RAM-text/noinit/stack/loader reservations;
they are not a total RAM figure. See the [build manifest](fm1-results/naked-runtime.json).
Target compilation and host renderer checks pass. Subsequent hardware results
are recorded in the runtime README: playback, knobs and MIDI were confirmed by
Paulo, and a same-image update through the running Teia firmware succeeded.
Precise timing and recovery remain unverified; dynamic patch loading remains
future work. The build manifest retains its original pre-hardware status.
