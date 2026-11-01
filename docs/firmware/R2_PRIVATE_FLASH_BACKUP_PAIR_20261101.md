# FloodGuard R2 — offline integrity review of two PRIVATE flash-image copies

**2026-11-01 · stacked review successor to PR #70 at `9d8f1342dd3a524c94d08bcc34bcfaea830c5753`. DRAFT / UNMERGED / PRODUCTION NO-GO.**

## The actual blocker

PRs #69 and #70 verified source-pinned ESP8266 Arduino core 3.1.2 NodeMCU filesystem menu definitions and the four **resolved CI build configurations**, respectively. **No one has measured the installed FloodGuard SPI flash device, obtained its existing firmware, inspected its actual partition boundaries, or acquired a real flash backup.** A source-compatible firmware build is not evidence that a historical deployed board has the same flash/OTA/LittleFS layout.

This stage prepares **only an offline post-acquisition check** for two previously captured local backup files. It neither approves acquisition nor contacts any physical device. Do not reset, connect to, interrupt, flash, or read the operational sensor/controller. A live flood-warning system must remain available. Actual acquisition requires separate approval, a redundant isolated bench unit, disabled actuators, an owner-approved rollback plan, and qualified operator supervision.

## New tool

`experiments/esp8266-core-excl-review/r2_private_backup_pair.py` reads the following **local only**: (1) exact Git-blob-pinned installed core 3.1.2 `boards.txt`; (2) a previously reviewed private sanitized JSON based on `board_evidence_template.json`; (3) two **already existing**, distinct local flash-image files. It validates menu/size/partition/backup metadata using the PR #69 parser and performs a bounded, byte-for-byte comparison of the two files. SHA-256 of each file must match the two private manifest digests. No hash, filename, file contents, credentials, board serial, or manifest value is printed.

Controls: Linux/WSL `O_NOFOLLOW` file opening, regular-file-only restrictions, rejection of two paths to the same underlying inode, exact expected size, bounded memory chunks, byte-level mismatch rejection, and metadata consistency checks before and after the read to detect ordinary concurrent modifications. These are pragmatic safeguards, **not a guarantee against malicious filesystem/OS tampering or physical backup provenance fabrication**. Linux/WSL is the supported host; Windows reparse-point handling is deliberately unsupported.

The program outputs only `evidence_status`, allowed finding codes, and **false** for physical independence, flash provenance, mount, write, flash, publish, ACK, gate actuation and production GO. Even byte-identical copies return `LOCAL_COPIES_IDENTICAL_NOT_PHYSICAL_PROOF`. Both files may have been duplicated from the same initial capture, be corrupt in the same way, or originate from an incorrect board. Their matching bytes do **not** establish independence, power-loss recovery, confidentiality, or a safe operational release.

## Future private bench-only usage (NOT yet authorized)

After a separately approved, isolated bench acquisition and local independent validation of its source, keep both complete flash images and the filled-in manifest **outside GitHub, CI, ChatGPT and public cloud storage**. Flash contents may include credentials. Never publish their hashes or individual chip identifiers in a public log. For an approved Linux/WSL **offline** workstation, the comparison command would be:

```bash
python3 experiments/esp8266-core-excl-review/r2_private_backup_pair.py \
  --boards "/local/verified/esp8266-3.1.2/boards.txt" \
  --manifest "/private/board_evidence.json" \
  --first "/private/capture-A.bin" \
  --second "/private/capture-B.bin"
```

The comparison tool never writes to those files, generates firmware, calls `esptool`, or connects to a serial device. Run it **only after** an independent human process has checked isolated-bench approval and backup provenance. A successful local result is a review artifact, not authorization to mount any filesystem or change an operational controller.

## CI verification scope

The new `tests/firmware_private_backup_pair_test.py` creates **synthetic 4 MB byte patterns** in temporary local test files and tests exact match, differing bytes/size, hardlinks, symlinks, directories, invalid manifest, wrong hash, unavailable private storage, altered source, and CLI output privacy. CI exercises this unit suite and a static safety gate while preserving prior NodeMCU positive/negative compilation, pinned LittleFS, ingress, website and firmware policies. CI is **not** provided with real user flash images, actual board IDs, credentials, or a private complete manifest.

**No firmware flashing, Firebase rules/data modification, sensor interruption, cloud receipt, live alerts, or UNO gate/alarm action is performed here. The operational `EightSlotLittleFsAdapter::writeNew()` still returns false. PRODUCTION NO-GO.**
