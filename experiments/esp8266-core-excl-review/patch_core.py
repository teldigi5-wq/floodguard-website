#!/usr/bin/env python3
"""Experimental ESP8266 Arduino 3.1.2 single-owner LittleFS API overlay.

ONLY patch a disposable CI-installed core after validating all 5 exact Git
blob IDs from upstream tag 3.1.2. Do not install on an operational device.
The compiled API is not invoked by the FloodGuard diagnostic. This is NOT
hardware/power-cut/flash-durability validation.
"""
from __future__ import annotations
import argparse
import pathlib
import subprocess

SOURCES = {
    "cores/esp8266/FS.h": "55305e9688c8e95f8898c9a26273223c2c110162",
    "cores/esp8266/FSImpl.h": "22a058f7b3a73d0bdd4575b5ff3c45e7dcd4a68d",
    "cores/esp8266/FS.cpp": "edfc1f8b496c1d7d7660458c1fb3fd5d0e455e85",
    "libraries/LittleFS/src/LittleFS.h": "a3afbfe77f00d8fa56776b8c72f60fabdeb0cbbb",
    "libraries/LittleFS/src/LittleFS.cpp": "16f4df55e9addcfa7eed9ff6bcf0431a0de34c19",
}

# The extension is deliberately size-bounded and has no path creation or
# directory walk. No precheck/exists()+truncate path and no second fs mount.
IMPLEMENTATION = r"""
ExclusiveLocalResult LittleFSImpl::createExclusiveLocal(
        const char* path, const uint8_t* bytes, size_t length) {
    // Valid only on the already-mounted SINGLE owner of this LittleFS volume.
    // Calls to this experimental API must be separately approved and can
    // never be made from the review-only FloodGuard diagnostic.
    if (!_mounted) return ExclusiveLocalResult::Unsupported;
    if (_fgExclusiveQuarantined) return ExclusiveLocalResult::CommitUncertain;
    // This detects same-instance recursion only; it is NOT a cross-task lock.
    // All callers must still be serialized by a separately reviewed owner.
    if (_fgExclusiveBusy) {
        _fgExclusiveQuarantined = true;
        return ExclusiveLocalResult::CommitUncertain;
    }
    if (!path || !bytes || length == 0 || length > 1038 ||
        path[0] != '/' || path[1] == 0 || strchr(path + 1, '/') ||
        !pathValid(path)) {
        return ExclusiveLocalResult::InvalidInput;
    }

    // Permit ONLY the eight fixed journal paths. Even an accidentally
    // exposed generic core API cannot create arbitrary root-level files.
    static const char *const slots[8] = {
        "/fgq2_0.bin", "/fgq2_1.bin", "/fgq2_2.bin", "/fgq2_3.bin",
        "/fgq2_4.bin", "/fgq2_5.bin", "/fgq2_6.bin", "/fgq2_7.bin"
    };
    bool slotAllowed = false;
    for (const char *allowed : slots) {
        if (strcmp(path, allowed) == 0) {
            slotAllowed = true;
            break;
        }
    }
    if (!slotAllowed) return ExclusiveLocalResult::InvalidInput;

    _fgExclusiveBusy = true;
    struct BusyRelease {
        bool &flag;
        ~BusyRelease() { flag = false; }
    } busyRelease = {_fgExclusiveBusy};

    lfs_file_t file = {};
    const int opened = lfs_file_open(
        &_lfs, &file, path, LFS_O_WRONLY | LFS_O_CREAT | LFS_O_EXCL);
    if (opened == LFS_ERR_EXIST) return ExclusiveLocalResult::AlreadyExists;
    // Any other lower-level open failure may have changed metadata.
    if (opened != 0) {
        _fgExclusiveQuarantined = true;
        return ExclusiveLocalResult::CommitUncertain;
    }

    const lfs_ssize_t written = lfs_file_write(&_lfs, &file, bytes, length);
    // Never skip close: it may also flush and return an independent error.
    const int synced = (written == static_cast<lfs_ssize_t>(length) &&
                        !_fgExclusiveQuarantined)
        ? lfs_file_sync(&_lfs, &file) : LFS_ERR_IO;
    const int closed = lfs_file_close(&_lfs, &file);
    if (written != static_cast<lfs_ssize_t>(length) ||
        synced != 0 || closed != 0 || _fgExclusiveQuarantined) {
        _fgExclusiveQuarantined = true;
        return ExclusiveLocalResult::CommitUncertain;
    }

    // A local readback check is NOT physical power-loss durability, remote
    // receipt or safe-to-delete proof. Read in small bounded chunks.
    lfs_file_t check = {};
    if (lfs_file_open(&_lfs, &check, path, LFS_O_RDONLY) != 0) {
        _fgExclusiveQuarantined = true;
        return ExclusiveLocalResult::CommitUncertain;
    }
    bool same = lfs_file_size(&_lfs, &check) ==
                static_cast<lfs_soff_t>(length);
    uint8_t scratch[64] = {};
    for (size_t offset = 0; same && offset < length; ) {
        const size_t n = (length - offset > sizeof(scratch))
            ? sizeof(scratch) : length - offset;
        const lfs_ssize_t received =
            lfs_file_read(&_lfs, &check, scratch, n);
        if (received != static_cast<lfs_ssize_t>(n) ||
            memcmp(scratch, bytes + offset, n) != 0) {
            same = false;
            break;
        }
        offset += n;
    }
    if (lfs_file_close(&_lfs, &check) != 0) same = false;
    if (!same) _fgExclusiveQuarantined = true;
    return (same && !_fgExclusiveQuarantined)
        ? ExclusiveLocalResult::LocalBytesMatched
        : ExclusiveLocalResult::CommitUncertain;
}

"""


PROBE_IMPLEMENTATION = r"""
JournalSlotObservation LittleFSImpl::probeJournalSlot(const char* path) {
    // This is a READ-ONLY observation, never proof that an empty slot can be
    // created. A negative stat can be ambiguous after metadata I/O faults.
    if (!_mounted) return JournalSlotObservation::Unsupported;
    if (_fgExclusiveQuarantined) return JournalSlotObservation::StorageUncertain;
    if (_fgExclusiveBusy) {
        _fgExclusiveQuarantined = true;
        return JournalSlotObservation::StorageUncertain;
    }
    static const char *const slots[8] = {
        "/fgq2_0.bin", "/fgq2_1.bin", "/fgq2_2.bin", "/fgq2_3.bin",
        "/fgq2_4.bin", "/fgq2_5.bin", "/fgq2_6.bin", "/fgq2_7.bin"
    };
    bool allowed = false;
    if (path) {
        for (const char *candidate : slots) {
            if (strcmp(path, candidate) == 0) {
                allowed = true;
                break;
            }
        }
    }
    if (!allowed) return JournalSlotObservation::InvalidInput;
    _fgExclusiveBusy = true;
    struct BusyRelease {
        bool &flag;
        ~BusyRelease() { flag = false; }
    } busyRelease = {_fgExclusiveBusy};
    struct lfs_info info = {};
    const int status = lfs_stat(&_lfs, path, &info);
    if (status == LFS_ERR_NOENT) {
        // The same mount can report NOENT after a transient read fault.
        // No automatic retry or create is allowed after apparent absence.
        _fgExclusiveQuarantined = true;
        return JournalSlotObservation::AbsenceUnverified;
    }
    if (status != 0 || info.type != LFS_TYPE_REG) {
        _fgExclusiveQuarantined = true;
        return JournalSlotObservation::StorageUncertain;
    }
    // Only a metadata observation: no CRC, signature, trusted receipt, or
    // power-loss survival has been proven.
    return _fgExclusiveQuarantined
        ? JournalSlotObservation::StorageUncertain
        : JournalSlotObservation::PresentUnverified;
}

"""
def replace_once(value: str, anchor: str, replacement: str, path: str) -> str:
    if value.count(anchor) != 1:
        raise RuntimeError(f"{path}: expected one exact anchor, got {value.count(anchor)}")
    return value.replace(anchor, replacement, 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("core", help="disposable CI ESP8266 Arduino 3.1.2 core root")
    args = parser.parse_args()
    root = pathlib.Path(args.core).resolve(strict=True)

    # Verify EVERY source before ANY modifications. Fail-closed if a vendor
    # package differs from upstream Git or if a previous patch is present.
    raw = {}
    for rel, expected in SOURCES.items():
        filename = root / rel
        content = filename.read_bytes()
        actual = subprocess.check_output(
            ["git", "hash-object", "--stdin"], input=content, text=False
        ).decode().strip()
        if actual != expected:
            raise RuntimeError(f"refuse nonmatching/unpinned SDK source: {rel} SHA {actual}")
        raw[rel] = content.decode("utf-8")

    fs = "cores/esp8266/FS.h"
    raw[fs] = replace_once(raw[fs], "class FS;\n", """class FS;

// FloodGuard R2 experimental core overlay; host/compile-only.
// Not a cloud receipt, an ACK, or a power-loss guarantee.
enum class ExclusiveLocalResult : uint8_t {
    Unsupported, InvalidInput, AlreadyExists,
    CommitUncertain, LocalBytesMatched
};
// A metadata probe NEVER authorizes a new write, cleanup, or cloud ACK.
enum class JournalSlotObservation : uint8_t {
    Unsupported, InvalidInput, PresentUnverified,
    AbsenceUnverified, StorageUncertain
};
""", fs)
    raw[fs] = replace_once(raw[fs],
        "    File open(const String& path, const char* mode);\n",
        "    File open(const String& path, const char* mode);\n"
        "    ExclusiveLocalResult createExclusiveLocal(\n"
        "        const char* path, const uint8_t* bytes, size_t length);\n"
        "    JournalSlotObservation probeJournalSlot(const char* path);\n", fs)

    impl = "cores/esp8266/FSImpl.h"
    anchor = "    virtual FileImplPtr open(const char* path, OpenMode openMode, AccessMode accessMode) = 0;\n"
    raw[impl] = replace_once(raw[impl], anchor, anchor+"""    // Default DENY on SPIFFS, SDFS and any other FS backend.
    virtual ExclusiveLocalResult createExclusiveLocal(
            const char*, const uint8_t*, size_t) {
        return ExclusiveLocalResult::Unsupported;
    }
    virtual JournalSlotObservation probeJournalSlot(const char*) {
        return JournalSlotObservation::Unsupported;
    }
""", impl)

    fscpp = "cores/esp8266/FS.cpp"
    raw[fscpp] = replace_once(raw[fscpp],
        "bool FS::exists(const char* path) {",
        """ExclusiveLocalResult FS::createExclusiveLocal(
        const char* path, const uint8_t* bytes, size_t length) {
    if (!_impl) return ExclusiveLocalResult::Unsupported;
    return _impl->createExclusiveLocal(path, bytes, length);
}

JournalSlotObservation FS::probeJournalSlot(const char* path) {
    if (!_impl) return JournalSlotObservation::Unsupported;
    return _impl->probeJournalSlot(path);
}

bool FS::exists(const char* path) {""", fscpp)

    littleh = "libraries/LittleFS/src/LittleFS.h"
    anchor = "    FileImplPtr open(const char* path, OpenMode openMode, AccessMode accessMode) override;\n"
    raw[littleh] = replace_once(raw[littleh], anchor,
        anchor+"""    ExclusiveLocalResult createExclusiveLocal(
        const char* path, const uint8_t* bytes, size_t length) override;
    JournalSlotObservation probeJournalSlot(const char* path) override;
""", littleh)
    raw[littleh] = replace_once(raw[littleh],
        "    bool     _mounted;\n};",
        "    bool     _mounted;\n"
        "    // This experimental gate is volatile, per filesystem instance.\n"
        "    bool     _fgExclusiveQuarantined = false;\n"
        "    // Reentrant-call sentinel, not a thread-safe mutex.\n"
        "    bool     _fgExclusiveBusy = false;\n};", littleh)

    littlecpp = "libraries/LittleFS/src/LittleFS.cpp"
    raw[littlecpp] = replace_once(raw[littlecpp],
        "DirImplPtr LittleFSImpl::openDir(const char *path) {",
        IMPLEMENTATION + PROBE_IMPLEMENTATION + "DirImplPtr LittleFSImpl::openDir(const char *path) {",
        littlecpp)

    # Exact byte lengths and anchors must be verified before starting writes.
    for rel, text in raw.items():
        if not text or "\0" in text:
            raise RuntimeError(f"refuse malformed patch output for {rel}")
    for rel, text in raw.items():
        (root / rel).write_text(text, encoding="utf-8", newline="")
    print("PASS pinned ESP8266 Arduino 3.1.2 core overlay staged IN ISOLATED CI")
    print("NO device flashing; NO production firmware patched; API is not invoked")


if __name__ == "__main__":
    main()
