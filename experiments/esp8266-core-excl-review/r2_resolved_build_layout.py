#!/usr/bin/env python3
"""Verify actual Arduino CLI *resolved build properties* against pinned SDK.

Offline. Checks selected *build configuration* ONLY, never a connected board,
actual flash image, read-only backup, or a safe-to-flash/mount decision.
Inputs are ephemeral Arduino CLI --show-properties stdout and pinned boards.txt.
The complete property stream may contain sensitive custom settings: DO NOT
print/upload/store it in GitHub artifacts.
"""
from __future__ import annotations
import argparse
import importlib.util
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "floodguard_pinned_board_layout", HERE / "r2_board_layout_evidence.py")
board = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(board)

MAX_PROPERTY_BYTES = 1024 * 1024
MENU_CHOICES = board.PROFILE_IDS
TARGET = board.FQBN
REQUIRED_BASE = ("build.flash_ld", "build.flash_size")
REQUIRED_FS = ("build.spiffs_start", "build.spiffs_end")


def parse_properties(data: bytes) -> dict:
    if len(data) > MAX_PROPERTY_BYTES:
        raise ValueError("property stream oversized")
    lines = data.decode("utf-8").splitlines()
    selected = {}
    for line in lines:
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in (*REQUIRED_BASE, *REQUIRED_FS, "build.fqbn"):
            if key in selected:
                raise ValueError("duplicate resolved flash property")
            selected[key] = value.strip()
    if any(key not in selected or not selected[key] for key in REQUIRED_BASE):
        raise ValueError("resolved build properties incomplete")
    return selected


def audit(pinned_boards: bytes, resolved: bytes, fqbn: str, menu: str) -> dict:
    if menu not in MENU_CHOICES:
        raise ValueError("unsupported explicit flash-menu choice")
    if fqbn != f"{TARGET}:eesz={menu}":
        raise ValueError("FQBN does not explicitly select the requested FS menu")
    profiles = board.get_profiles(pinned_boards, verify_pin=True)
    props = parse_properties(resolved)
    expected = profiles[menu]

    if props["build.flash_ld"] != expected["ld"]:
        raise ValueError("resolved linker script conflicts with pinned menu")
    if props["build.flash_size"] != "4M":
        raise ValueError("resolved flash size conflicts with pinned menu")
    if "build.fqbn" in props:
        actual = props["build.fqbn"]
        # Arduino may expand implicit defaults, but the selected FS menu
        # must be present if the build system emits an FQBN.
        if not actual.startswith(TARGET + ":") or not re.search(
            r"(?:^|[:,])eesz=" + re.escape(menu) + r"(?:,|$)", actual):
            raise ValueError("resolved FQBN selects a different flash menu")

    if expected["fs"] is None:
        # Ignore empty / explicitly unset values; reject claimed FS on no-FS.
        for field in REQUIRED_FS:
            if props.get(field, ""):
                raise ValueError("resolved no-filesystem menu exposes a region")
    else:
        for field, expected_offset in zip(REQUIRED_FS, expected["fs"]):
            value = props.get(field)
            if value is None or re.fullmatch(r"0x[0-9a-fA-F]+", value) is None:
                raise ValueError("resolved filesystem offset absent or invalid")
            if int(value, 16) != expected_offset:
                raise ValueError("resolved filesystem offset mismatches pinned menu")

    # Output only an enum-style verification signal, never raw property
    # values, full CLI output, firmware bytes, tokens, device IDs or hashes.
    return {
        "build_configuration": "MATCHED_PINNED_SDK_MENU",
        "selected_menu": menu,
        "device_physically_identified": False,
        "filesystem_physically_verified": False,
        "may_mount": False,
        "may_write": False,
        "may_flash": False,
        "may_ack": False,
        "may_operate_gate": False,
        "production_go": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boards", required=True)
    parser.add_argument("--properties", required=True)
    parser.add_argument("--fqbn", required=True)
    parser.add_argument("--menu", required=True)
    args = parser.parse_args()
    result = audit(
        pathlib.Path(args.boards).read_bytes(),
        pathlib.Path(args.properties).read_bytes(),
        args.fqbn, args.menu)
    assert not result["production_go"]
    print("PASS R2 resolved Arduino CLI menu " + result["selected_menu"]
          + ": pinned SDK properties match; PHYSICAL BOARD UNKNOWN; NO-GO")


if __name__ == "__main__":
    main()
