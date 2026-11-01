# FloodGuard R2 — Source-pinned NodeMCU flash-layout evidence gate

**1 November 2026 · successor to verified draft PR #68 at `e366ea2f340eb9dc7c0b9f060799a03cf2df8f9f`. OPEN DRAFT, PRODUCTION NO-GO.**

## Source-grounded ambiguity

ESP8266 Arduino core **3.1.2**, `esp8266:esp8266:nodemcuv2`, has several mutually incompatible layouts under the **same board ID**. Its upstream `boards.txt` at Git blob SHA `f648547ba71878242ae30e9c82b7fa6ba68ebe36` defines:

| Flash menu | SDK linker | Declared filesystem region | Source claim |
| --- | --- | --- | --- |
| `4M1M` | `eagle.flash.4m1m.ld` | `0x300000`–`0x3FA000` | 4 MB build, 1 MB nominal FS |
| `4M2M` | `eagle.flash.4m2m.ld` | `0x200000`–`0x3FA000` | 4 MB build, 2 MB nominal FS |
| `4M3M` | `eagle.flash.4m3m.ld` | `0x100000`–`0x3FA000` | 4 MB build, 3 MB nominal FS |
| `4M` | `eagle.flash.4m.ld` | **No FS** | 4 MB build without filesystem |

These are pinned **SDK source definitions**, not independently verified physical board measurements or proof which menu was used to flash the FloodGuard ESP8266. The source ranges are not permission to access flash.

## Offline verifier and privacy boundary

`experiments/esp8266-core-excl-review/r2_board_layout_evidence.py` reads ONLY a local text `boards.txt` and an optional locally held sanitized JSON manifest. It verifies the exact upstream Git object hash, parses four distinct menu definitions, and rejects unsupported selection, wrong linker, mismatched physical/configured flash size, contradictory partition boundaries, missing isolated bench approval, or absent/contradictory **private** full-flash backup metadata. It never connects to hardware, uses `esptool`, mounts, formats, flashes, sends a cloud ACK, operates a gate or exposes raw evidence.

`board_evidence_template.json` is explicitly incomplete, containing **no observed hardware values, passwords, network identifiers, binary dumps or board serials**. Never commit the completed manifest, raw flash backup, tokens or device IDs to public GitHub or CI; full backups can contain sensitive data. The validator outputs finding codes rather than copying input details. Equal hashes for two local reads do not guarantee a safe or authentic backup.

The validator **always returns** `may_flash=false`, `may_mount=false`, `may_write=false`, `may_publish=false`, `may_ack=false`, `may_operate_gate=false` and `production_go=false`. Even a syntactically consistent future private manifest yields `REQUIRES_INDEPENDENT_HARDWARE_REVIEW`, not release approval. All test fixtures claiming `operator-observed` are **synthetic**.

## Exact-head CI

The pinned ESP8266 Arduino 3.1.2 CI installation is checked against SHA-pinned `boards.txt` by:

```bash
python3 experiments/esp8266-core-excl-review/r2_board_layout_evidence.py \
  --boards "$HOME/.arduino15/packages/esp8266/hardware/esp8266/3.1.2/boards.txt" \
  --sdk-only
```

The host test suite runs `firmware_board_layout_evidence_test.py` using synthetic metadata and negative cases. Existing NodeMCU, source-pinned LittleFS, ingress, website, compiler-negative and write-disabled firmware checks remain mandatory. Do not report verification until the **exact head** GitHub Actions jobs succeed.

## Physical investigation — not yet authorized

An independently approved, isolated **bench-only** unit would be needed to record the non-unique board/module marking, SPI flash manufacturer/part, real flash capacity, actual deployed firmware linker/menu selection, filesystem/OTA boundaries and private read-only backup integrity. Reading a flash chip through a bootloader may reset or interrupt the controller: **never attempt it on the operational flood-warning device**. Disconnect gate/servo/alarm actuation on an approved duplicate, retain a rollback image privately and protect credentials/IDs. No interactive hardware command or backup has been run here.

Only after such approval, an operator may copy the public template **outside the repository** and locally validate their sanitized metadata:

```bash
python3 experiments/esp8266-core-excl-review/r2_board_layout_evidence.py \
  --boards "/path/to/verified/esp8266/3.1.2/boards.txt" \
  --manifest "/private/offline/board_evidence.json"
```

This validates consistency, **not** provenance or device safety. A real deployment still requires correct owner/synchronization, signed sensor data, authenticated cloud receipt, conservative stale/unknown warnings, and supervised UNO actuator commissioning. Do not reopen unauthenticated Firebase writes.

**The operational `EightSlotLittleFsAdapter::writeNew()` remains false. No merge, hardware flash, production cloud changes, alert or gate action. PRODUCTION NO-GO.**
