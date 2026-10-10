#!/usr/bin/env python3
"""Static Felucca build/resource experiment. Never installs or runs firmware.

Dependencies live in .cache/fm1-spike; see docs/spikes/fm1-build.md.
Uses the pinned upstream build API so its compiler image can be pinned too.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache/fm1-spike"
SOURCE = CACHE / "Felucca"
SDK = CACHE / "sdk"
TOOLCHAIN = CACHE / "jieli/jieli-linux-toolchains-20260730.1"
COMMIT = "129a4cf4e98e6ef06a4a89e97b65092247d69412"
SDK_COMMIT = "d179b4484759423312073f5fbb232501aa491047"
ARCHIVE_SHA = "a1545cddbc451a06bac43eb5cd96d831470c42a97c5c0b1f98879a20fc7647bd"
COMPILER_SHA = "c45189ee624de0430deb0db02e6dce171fb5538e7fe323e3964dc8ac6236240f"
IMAGE = "debian@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587"
PROFILES = {
    "baseline": {},
    "reduced": {"FELUCCA_CDC": "0", "FELUCCA_UAC": "0", "FELUCCA_SLICE": "0", "FELUCCA_ICONS": "0"},
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def parse_symbols(symbols):
    sym, objects = {}, []
    for line in symbols.splitlines():
        fields = line.split()
        if len(fields) < 4 or not re.fullmatch(r"[0-9a-fA-F]+", fields[0]):
            continue
        sym[fields[-1]] = int(fields[0], 16)
        # JieLi objdump omits the usual GNU 'O' marker on data objects.
        if "F" not in fields and fields[-3] in (".text", ".data", ".bss", ".pool", ".noinit"):
            size = int(fields[-2], 16)
            if size:
                objects.append({"name": fields[-1], "section": fields[-3], "bytes": size})
    require(any(o["name"] == "dly_buf" for o in objects), "Incomplete ELF symbol inventory")
    return sym, objects


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES, default="baseline")
    parser.add_argument("--label", required=True, help="Unique result directory name")
    args = parser.parse_args()
    require(re.fullmatch(r"[a-z0-9-]+", args.label), "Use lowercase letters, digits and hyphens for label")
    result = CACHE / "results" / args.label
    require(not result.exists(), f"Result already exists: {result}")
    for repo, expected in ((SOURCE, COMMIT), (SDK, SDK_COMMIT)):
        require(run("git", "-C", str(repo), "rev-parse", "HEAD") == expected, f"Wrong revision: {repo}")
        require(not run("git", "-C", str(repo), "status", "--porcelain", "--untracked-files=no"), f"Modified source: {repo}")
    require(sha(CACHE / "toolchain.tar.xz") == ARCHIVE_SHA, "Toolchain archive checksum mismatch")
    require(sha(TOOLCHAIN / "pi32v2/bin/clang") == COMPILER_SHA, "Extracted compiler checksum mismatch")
    from PIL import features, __version__ as pillow_version
    import fontTools
    require(pillow_version == "12.2.0" and fontTools.__version__ == "4.60.2", "Use the pinned Python dependencies")
    require(features.check_feature("raqm"), "Pillow needs Raqm font shaping")
    require(platform.python_version() == "3.14.3", "Use Python 3.14.3 for this reproducibility experiment")
    # Ignore ambient upstream flags so the recorded profile fully describes the build.
    for key in list(os.environ):
        if key.startswith("FELUCCA_"):
            del os.environ[key]
    os.environ.update(PROFILES[args.profile])
    os.environ.update(JIELI_TOOLCHAIN=str(TOOLCHAIN), AC79_SDK=str(SDK), JIELI_DOCKER="1")
    sys.path.insert(0, str(SOURCE / "tools"))
    spec = importlib.util.spec_from_file_location("felucca_build", SOURCE / "tools/build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    build.DOCKER_IMAGE = IMAGE
    sdk_hashes = {rel: sha(SDK / "cpu/wl82/tools" / rel) for rel in build.SDK_SHA256}
    require(sdk_hashes == build.SDK_SHA256, "SDK packaging inputs differ from upstream reference")
    compiler_version = build.tc("cc", "--version")
    # This deletes only generated output in the isolated upstream checkout.
    shutil.rmtree(SOURCE / "build", ignore_errors=True)
    sys.argv = [str(SOURCE / "tools/build.py")]
    os.chdir(SOURCE)
    build.main()
    sections = build.tc("common/bin/objdump", "-h", SOURCE / "build/felucca.elf")
    symbols = build.tc("common/bin/objdump", "-t", SOURCE / "build/felucca.elf")
    sym, objects = parse_symbols(symbols)
    regions = build.ld_regions()
    used = {
        "RAM": sym["_bss_end"] - regions["RAM"][0],
        "POOL": sym["_pool_end"] - sym["_pool_start"],
        "RAMTEXT": sym["_rt_end"] - sym["_rt_start"],
        "XIP": (SOURCE / "build/felucca.bin").stat().st_size,
    }
    files = ["felucca.bin", "felucca.elf", "felucca.fwsc", "loader/ota.bin"]
    report = {
        "profile": args.profile, "flags": PROFILES[args.profile],
        "felucca_commit": COMMIT, "sdk_commit": SDK_COMMIT, "sdk_files_sha256": sdk_hashes,
        "compiler": compiler_version, "compiler_archive_sha256": ARCHIVE_SHA,
        "compilation_target": "pi32v2",
        "compiler_executable_sha256": sha(TOOLCHAIN / "pi32v2/bin/clang"),
        "docker_image": IMAGE, "python": platform.python_version(), "pillow": pillow_version,
        "fonttools": fontTools.__version__, "raqm": features.version_feature("raqm"),
        "regions": {name: {"used": n, "capacity": regions[name][1], "free": regions[name][1] - n} for name, n in used.items()},
        "artifacts": {name: {"bytes": (SOURCE / "build" / name).stat().st_size, "sha256": sha(SOURCE / "build" / name)} for name in files},
        "pool_objects": sorted((o for o in objects if o["section"] == ".pool"), key=lambda o: -o["bytes"]),
        "largest_static_objects": sorted(objects, key=lambda o: -o["bytes"])[:40],
    }
    result.mkdir(parents=True)
    for name in files:
        target = result / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE / "build" / name, target)
    (result / "sections.txt").write_text(sections)
    (result / "symbols.txt").write_text(symbols)
    (result / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["regions"], indent=2))
    print(f"Static build and resource report: {result}")


if __name__ == "__main__":
    main()
