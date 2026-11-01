#!/usr/bin/env python3
"""FloodGuard R2: compare two PRIVATE pre-existing offline flash-image copies.

NO board/serial/USB access, no esptool, no firmware upload, no network,
no output of paths, hashes, binary contents or identifying metadata.
File inputs are READ ONLY. This does NOT prove independent physical reads,
power-cut durability, deployed firmware identity, or safe activation.
Linux/WSL only: requires O_NOFOLLOW and regular, distinct inode-backed files.
"""
from __future__ import annotations
import argparse
from contextlib import ExitStack
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("fg_layout_evidence", HERE / "r2_board_layout_evidence.py")
board = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(board)
CHUNK = 64 * 1024
MAX_BYTES = 16 * 1024 * 1024


class EvidenceError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _fingerprint(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def _open_private_regular(path: str, stack: ExitStack):
    if not os.path.isabs(path) or not hasattr(os, "O_NOFOLLOW"):
        raise EvidenceError("UNSUPPORTED_OR_NONABSOLUTE_INPUT")
    try:
        flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0)
        fd = os.open(path, flags)
        stack.callback(os.close, fd)
        s = os.fstat(fd)
    except OSError:
        raise EvidenceError("LOCAL_COPY_CANNOT_BE_OPENED") from None
    if not stat.S_ISREG(s.st_mode):
        raise EvidenceError("NOT_A_REGULAR_BACKUP_COPY")
    return fd, s


def compare_copies(first: str, second: str, expected_bytes: int) -> str:
    """Return only in-memory SHA256; never print or write evidence or images."""
    if type(expected_bytes) is not int or not (0 < expected_bytes <= MAX_BYTES):
        raise EvidenceError("BACKUP_SIZE_OUT_OF_SCOPE")
    with ExitStack() as stack:
        a, sa = _open_private_regular(first, stack)
        b, sb = _open_private_regular(second, stack)
        if (sa.st_dev, sa.st_ino) == (sb.st_dev, sb.st_ino):
            raise EvidenceError("COPIES_SHARE_SAME_FILE")
        if sa.st_size != expected_bytes or sb.st_size != expected_bytes:
            raise EvidenceError("BACKUP_SIZE_CONFLICT")
        ha, hb = hashlib.sha256(), hashlib.sha256()
        remaining = expected_bytes
        try:
            while remaining:
                amount = min(remaining, CHUNK)
                x, y = os.read(a, amount), os.read(b, amount)
                if not x or len(x) != len(y):
                    raise EvidenceError("LOCAL_BACKUP_BYTES_MISMATCH")
                if x != y:
                    raise EvidenceError("LOCAL_BACKUP_BYTES_MISMATCH")
                ha.update(x)
                hb.update(y)
                remaining -= len(x)
            if os.read(a, 1) or os.read(b, 1):
                raise EvidenceError("BACKUP_SIZE_CONFLICT")
            # Detect modifications while reading via the open descriptor,
            # plus path replacement since open. This is not hostile-OS proof.
            if _fingerprint(os.fstat(a)) != _fingerprint(sa) or _fingerprint(os.fstat(b)) != _fingerprint(sb):
                raise EvidenceError("BACKUP_MODIFIED_DURING_READ")
            for file_path, initial in ((first, sa), (second, sb)):
                current = os.stat(file_path, follow_symlinks=False)
                if not stat.S_ISREG(current.st_mode) or _fingerprint(current) != _fingerprint(initial):
                    raise EvidenceError("BACKUP_PATH_CHANGED_DURING_READ")
        except EvidenceError:
            raise
        except OSError:
            raise EvidenceError("BACKUP_READ_OR_STAT_ERROR") from None
        if not hmac.compare_digest(ha.digest(), hb.digest()):
            raise EvidenceError("LOCAL_BACKUP_HASH_MISMATCH")
        return ha.hexdigest()


def examine(boards_text: bytes, manifest_bytes: bytes, first: str, second: str) -> dict:
    """Never grant release permission, even if two copies are identical."""
    try:
        profiles = board.get_profiles(boards_text, verify_pin=True)
        manifest = board.read_json_no_duplicate_keys(manifest_bytes)
        base = board.review(profiles, manifest)
    except (ValueError, UnicodeError, json.JSONDecodeError, TypeError):
        raise EvidenceError("SOURCE_OR_MANIFEST_INVALID") from None
    if base["finding_codes"]:
        raise EvidenceError("SOURCE_MANIFEST_NOT_REVIEW_READY")
    if manifest["selected_flash_menu"] == "4M":
        raise EvidenceError("NO_FILESYSTEM_SELECTED")
    expected = manifest["real_flash_bytes"]
    if type(expected) is not int or expected != 4 * 1024 * 1024:
        raise EvidenceError("BACKUP_SIZE_OUT_OF_SCOPE")
    digest = compare_copies(first, second, expected)
    known = manifest["backup"]
    if not (hmac.compare_digest(digest, known["sha256"]) and
            hmac.compare_digest(digest, known["second_read_sha256"])):
        raise EvidenceError("MANIFEST_BACKUP_HASH_MISMATCH")
    return verdict("LOCAL_COPIES_IDENTICAL_NOT_PHYSICAL_PROOF", [])


def verdict(status: str, findings: list[str]) -> dict:
    return {
        "evidence_status": status,
        "finding_codes": findings,
        "independent_hardware_reads_proven": False,
        "deployed_flash_layout_proven": False,
        "may_mount": False,
        "may_write": False,
        "may_flash": False,
        "may_publish": False,
        "may_ack": False,
        "may_operate_gate": False,
        "production_go": False,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--boards", required=True, help="local installed pinned ESP8266 3.1.2 boards.txt")
    p.add_argument("--manifest", required=True, help="PRIVATE pre-approved sanitized local JSON")
    p.add_argument("--first", required=True, help="PRIVATE pre-existing first flash image")
    p.add_argument("--second", required=True, help="PRIVATE pre-existing second flash image")
    args = p.parse_args()
    try:
        report = examine(
            Path(args.boards).read_bytes(),
            Path(args.manifest).read_bytes(),
            args.first,
            args.second,
        )
        code = 0
    except EvidenceError as e:
        report = verdict("INCOMPLETE_OR_CONFLICTING", [e.code])
        code = 2
    except (OSError, ValueError, TypeError, UnicodeError):
        # Do not let exception text print a private file path or its contents.
        report = verdict("INCOMPLETE_OR_CONFLICTING", ["PRIVATE_INPUT_UNAVAILABLE"])
        code = 2
    print(json.dumps(report, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
