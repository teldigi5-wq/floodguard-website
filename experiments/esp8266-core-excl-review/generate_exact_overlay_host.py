#!/usr/bin/env python3
"""Generate a RAM-only host witness from the EXACT core-overlay method string.

Do not rewrite, reimplement or duplicate the method under test. The same
patch_core.IMPLEMENTATION is injected both into the disposable Arduino core
and the disposable host compilation. Host failures are CI failures.
"""
from __future__ import annotations
import pathlib
import runpy
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TEMPLATE = ROOT / "tests/firmware_core_overlay_exact_host.template.cpp"
MARKER = "// EXACT_IMPL_FROM_PINNED_OVERLAY"
PROBE_MARKER = "// EXACT_PROBE_FROM_PINNED_OVERLAY"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_exact_overlay_host.py OUTPUT_CPP")
    overlay = runpy.run_path(str(HERE / "patch_core.py"))
    payload = overlay["IMPLEMENTATION"]
    probe = overlay["PROBE_IMPLEMENTATION"]
    if payload.count("LittleFSImpl::createExclusiveLocal(") != 1:
        raise SystemExit("refuse malformed source: exact method missing or repeated")
    original = TEMPLATE.read_text(encoding="utf-8")
    if probe.count("LittleFSImpl::probeJournalSlot(") != 1:
        raise SystemExit("refuse malformed read-only probe source")
    if original.count(PROBE_MARKER) != 1:
        raise SystemExit("refuse absent/duplicate probe template marker")
    if original.count(MARKER) != 1:
        raise SystemExit("refuse absent/duplicate host template marker")
    dest = pathlib.Path(sys.argv[1])
    dest.write_text(original.replace(MARKER, payload).replace(PROBE_MARKER, probe), encoding="utf-8")
    print("PASS same overlay WRITE AND PROBE METHOD BODIES used in RAM host and isolated core")


if __name__ == "__main__":
    main()
