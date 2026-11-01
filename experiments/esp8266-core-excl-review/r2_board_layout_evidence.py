#!/usr/bin/env python3
"""FloodGuard R2: OFFLINE, READ-ONLY evidence checker for SDK flash profiles.

NEVER talks to hardware, reads a flash dump, authenticates an operator, or
authorizes deploy/flash/mount/write/cloud ACK/actuation. Only public, sanitized
metadata may be placed in a review. Keep full flash backups PRIVATE.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import re

SDK_VERSION = "3.1.2"
PINNED_BOARDS_GIT_BLOB = "f648547ba71878242ae30e9c82b7fa6ba68ebe36"
BOARD = "nodemcuv2"
FQBN = "esp8266:esp8266:nodemcuv2"
SCHEMA = "floodguard-r2-board-evidence-v1"
PROFILE_IDS = ("4M1M", "4M2M", "4M3M", "4M")
REQUIRED = {
    "schema", "origin", "core_version", "fqbn", "selected_flash_menu",
    "selected_flash_ld", "real_flash_bytes", "configured_flash_bytes",
    "filesystem_start", "filesystem_end", "bench_isolated",
    "actuators_disconnected", "read_only_observation",
    "independent_partition_review", "backup"
}
BACKUP_KEYS = {"size_bytes", "sha256", "second_read_sha256", "stored_privately"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_INPUT_BYTES = 16384


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def get_profiles(data: bytes, *, verify_pin: bool = True) -> dict:
    if verify_pin and git_blob_sha(data) != PINNED_BOARDS_GIT_BLOB:
        raise ValueError("unverified ESP8266 Arduino 3.1.2 boards.txt source")
    config = {}
    for line in data.decode("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.startswith(BOARD + ".menu.eesz."):
            if key in config:
                raise ValueError("duplicate pinned board property")
            config[key] = value
    profiles = {}
    for profile in PROFILE_IDS:
        key = BOARD + ".menu.eesz." + profile
        linker = config.get(key + ".build.flash_ld")
        size = config.get(key + ".build.flash_size")
        if linker != "eagle.flash." + profile.lower() + ".ld" or size != "4M":
            raise ValueError("unexpected SDK flash linker for " + profile)
        start = config.get(key + ".build.spiffs_start")
        end = config.get(key + ".build.spiffs_end")
        if profile == "4M":
            if start is not None or end is not None:
                raise ValueError("FS:none board menu unexpectedly has filesystem")
            profiles[profile] = {"ld": linker, "flash_bytes": 4 * 1024 * 1024,
                                 "fs": None}
        else:
            if start is None or end is None:
                raise ValueError("missing SDK filesystem range for " + profile)
            region = (int(start, 16), int(end, 16))
            if not (0 < region[0] < region[1] < 4 * 1024 * 1024):
                raise ValueError("invalid SDK filesystem range")
            profiles[profile] = {"ld": linker, "flash_bytes": 4 * 1024 * 1024,
                                 "fs": region}
    # Distinct menu layouts matter: never infer the selected layout from FQBN.
    if len({profiles[k]["fs"] for k in PROFILE_IDS}) != len(PROFILE_IDS):
        raise ValueError("pinned board menu layouts are not distinct")
    return profiles


def read_json_no_duplicate_keys(raw: bytes) -> dict:
    def unique(items):
        result = {}
        for k, v in items:
            if k in result:
                raise ValueError("duplicate manifest property")
            result[k] = v
        return result
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("manifest too large")
    parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    if type(parsed) is not dict:
        raise ValueError("manifest root must be an object")
    return parsed


def _integer(value):
    return type(value) is int and value >= 0


def review(profiles: dict, manifest: dict) -> dict:
    """Returns only non-sensitive decisions. NEVER an operational permit."""
    findings = []
    def flag(code):
        if code not in findings:
            findings.append(code)
    if set(manifest) != REQUIRED:
        flag("INVALID_SCHEMA_FIELDS")
    if manifest.get("schema") != SCHEMA:
        flag("UNKNOWN_SCHEMA")
    if manifest.get("origin") != "operator-observed":
        flag("NO_ACTUAL_BOARD_OBSERVATION")
    if manifest.get("core_version") != SDK_VERSION or manifest.get("fqbn") != FQBN:
        flag("SDK_TARGET_UNVERIFIED")
    menu = manifest.get("selected_flash_menu")
    item = profiles.get(menu) if isinstance(menu, str) else None
    if item is None:
        flag("FLASH_MENU_UNKNOWN")
    elif item["fs"] is None:
        flag("SELECTED_MENU_HAS_NO_FILESYSTEM")
    if item and manifest.get("selected_flash_ld") != item["ld"]:
        flag("LINKER_PROFILE_MISMATCH")

    capacity = manifest.get("real_flash_bytes")
    configured = manifest.get("configured_flash_bytes")
    if not _integer(capacity) or not _integer(configured) or not capacity or not configured:
        flag("FLASH_CAPACITY_NOT_MEASURED")
    elif capacity != configured or (item and configured != item["flash_bytes"]):
        flag("FLASH_CAPACITY_CONFLICT")

    start, end = manifest.get("filesystem_start"), manifest.get("filesystem_end")
    if not _integer(start) or not _integer(end):
        flag("PARTITION_BOUNDS_UNVERIFIED")
    elif not (0 < start < end < (capacity if _integer(capacity) else 1)):
        flag("PARTITION_BOUNDS_INVALID")
    elif item and item["fs"] is not None and (start, end) != item["fs"]:
        flag("PARTITION_LINKER_MISMATCH")

    for key in ("bench_isolated", "actuators_disconnected",
                "read_only_observation", "independent_partition_review"):
        if manifest.get(key) is not True:
            flag("BENCH_OR_INDEPENDENT_REVIEW_MISSING")

    backup = manifest.get("backup")
    if type(backup) is not dict or set(backup) != BACKUP_KEYS:
        flag("PRIVATE_BACKUP_PROVENANCE_MISSING")
    else:
        hashes = (backup.get("sha256"), backup.get("second_read_sha256"))
        if any(type(h) is not str or SHA256.fullmatch(h) is None for h in hashes):
            flag("BACKUP_HASH_INVALID")
        elif hashes[0] != hashes[1]:
            flag("BACKUP_REPEATED_READ_MISMATCH")
        if not _integer(backup.get("size_bytes")) or backup.get("size_bytes") == 0:
            flag("BACKUP_SIZE_INVALID")
        elif _integer(capacity) and backup["size_bytes"] != capacity:
            flag("BACKUP_SIZE_CONFLICT")
        if backup.get("stored_privately") is not True:
            flag("BACKUP_STORAGE_NOT_PRIVATE")
    return {
        "evidence_status": "INCOMPLETE_OR_CONFLICTING" if findings
                           else "REQUIRES_INDEPENDENT_HARDWARE_REVIEW",
        "finding_codes": sorted(findings),
        "may_mount": False,
        "may_write": False,
        "may_flash": False,
        "may_publish": False,
        "may_ack": False,
        "may_operate_gate": False,
        "production_go": False
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--boards", required=True,
                   help="disposable/local, source-verified ESP8266 3.1.2 boards.txt")
    p.add_argument("--manifest", help="PRIVATE local sanitized evidence JSON")
    p.add_argument("--sdk-only", action="store_true",
                   help="verify pinned profile definitions; no device access")
    opts = p.parse_args()
    profiles = get_profiles(pathlib.Path(opts.boards).read_bytes())
    if opts.sdk_only:
        if opts.manifest:
            p.error("cannot combine --sdk-only with --manifest")
        print("PINNED_SDK_PROFILE_SOURCE_OK: 4 distinct NodeMCU menus; "
              "no board or physical layout measured; NO-GO")
        return
    if not opts.manifest:
        p.error("--manifest is required without --sdk-only")
    data = read_json_no_duplicate_keys(pathlib.Path(opts.manifest).read_bytes())
    print(json.dumps(review(profiles, data), sort_keys=True))


if __name__ == "__main__":
    main()
