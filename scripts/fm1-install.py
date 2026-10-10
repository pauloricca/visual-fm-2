#!/usr/bin/env python3
"""Build Teia firmware when its inputs change, then install it on the FM-1."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/fm1-spike'
BUILD = CACHE / 'naked/build'
PACKAGE = BUILD / 'teia-fm1-spike.fwsc'
STAMP = BUILD / 'install-build.json'
BUILD_PYTHON = CACHE / 'python/bin/python'
INSTALL_PYTHON = CACHE / 'install-env/bin/python'
INSTALLER = CACHE / 'Felucca/tools/fm1_install.py'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args, capture=False):
    result = subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True,
                            text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def require_file(path):
    if not path.is_file():
        raise RuntimeError(f'Missing {path}. Set up the pinned FM-1 environment described in docs/spikes/fm1-build.md and firmware/fm1/UPLOAD.md.')


def inputs():
    # Check pinned dependencies even when reusing a package. The builder makes
    # these same checks; cached firmware must not bypass them.
    spec = importlib.util.spec_from_file_location('fm1_pins', ROOT / 'scripts/fm1-build-spike.py')
    pin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pin)
    for repo, expected in ((pin.SOURCE, pin.COMMIT), (pin.SDK, pin.SDK_COMMIT)):
        if run('git', '-C', repo, 'rev-parse', 'HEAD', capture=True) != expected:
            raise RuntimeError(f'Unexpected pinned revision in {repo}')
        if run('git', '-C', repo, 'status', '--porcelain', '--untracked-files=no', capture=True):
            raise RuntimeError(f'Tracked changes in pinned dependency {repo}; restore it before building/installing.')
    compiler = pin.TOOLCHAIN / 'pi32v2/bin/clang'
    require_file(compiler)
    if digest(compiler) != pin.COMPILER_SHA:
        raise RuntimeError('Pinned compiler checksum does not match.')
    paths = set()
    # Include transitive graph/compiler sources and build/package configuration.
    # Deletions and additions affect the map as well as content changes.
    for directory in ('firmware/fm1', 'editor/src/audio', 'editor/src/graph'):
        paths.update(p for p in (ROOT / directory).rglob('*') if p.is_file())
    for pattern in ('scripts/fm1-*', '*lock*', 'package.json', 'editor/package.json',
                    'editor/tsconfig*.json'):
        paths.update(p for p in ROOT.glob(pattern) if p.is_file())
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted(paths)}


def reusable(source_hashes):
    try:
        saved = json.loads(STAMP.read_text())
        return (saved.get('inputs') == source_hashes
                and saved.get('package_sha256') == digest(PACKAGE))
    except (OSError, ValueError, AttributeError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force-build', action='store_true', help='rebuild even if the cached package matches')
    parser.add_argument('--build-only', action='store_true', help='prepare firmware without accessing a device')
    parser.add_argument('--port', metavar='NAME', help='MIDI port name or substring passed to the firmware installer')
    args = parser.parse_args()
    require_file(BUILD_PYTHON)
    if not args.build_only:
        require_file(INSTALL_PYTHON)
        require_file(INSTALLER)
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / 'install.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another FM-1 build/install script is running.') from None
        run('npm', 'run', 'fm1:support:check')
        before = inputs()
        if args.force_build or not reusable(before):
            # Invalidate first, so interruption cannot make a partial build reusable.
            STAMP.unlink(missing_ok=True)
            print('Building FM-1 firmware: inputs or package changed.', flush=True)
            run(BUILD_PYTHON, ROOT / 'scripts/fm1-runtime-spike.py')
            require_file(PACKAGE)
            if inputs() != before:
                raise RuntimeError('Sources changed during the build. Run again; nothing was uploaded.')
            stamp = {'inputs': before, 'package_sha256': digest(PACKAGE)}
            temporary = STAMP.with_suffix('.tmp')
            temporary.write_text(json.dumps(stamp, indent=2) + '\n')
            temporary.replace(STAMP)
        else:
            print('Firmware is current; reusing the checked package.', flush=True)
        if args.build_only:
            print(f'Firmware ready: {PACKAGE}')
            return
        if not reusable(inputs()):
            raise RuntimeError('Build inputs or firmware package changed before installation. Run again.')
        print('Installing firmware. Keep the FM-1 connected until verification completes. RAM patches will be cleared.', flush=True)
        command = [INSTALL_PYTHON, INSTALLER, PACKAGE, '--yes']
        if args.port:
            command.extend(['--port', args.port])
        # The pinned installer validates the package/model, writes, reboots and
        # checks the reported firmware identity. Preserve failures; never retry flash.
        run(*command)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f'FM-1 installation failed: {error}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Interrupted. If writing had started, check the device/update loader before retrying.', file=sys.stderr)
        sys.exit(130)
