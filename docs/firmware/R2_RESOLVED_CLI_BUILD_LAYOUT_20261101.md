# FloodGuard R2 — resolved Arduino CLI build-layout evidence

**1 November 2026 · review-only stage stacked on PR #69 at `6f3e11f0d4ce1066e0edd4758efa87aabb5d50df` · OPEN DRAFT, PRODUCTION NO-GO.**

## Gap closed

PR #69 verified that pinned ESP8266 Arduino core 3.1.2 declares four different `nodemcuv2` menus, but did **not** verify that Arduino CLI actually resolves those menus to the expected linker and filesystem properties. An accidental default or another board option could change storage geometry silently while still compiling.

This stage introduces `experiments/esp8266-core-excl-review/r2_resolved_build_layout.py` and synthetic negative tests. The script checks the SHA-pinned, **actual installed** `boards.txt` against **ephemeral resolved build properties** reported by Arduino CLI **1.5.1** for four explicit FQBN selections:

| Explicit FQBN suffix | Expected linker | SDK-declared FS start | SDK-declared FS end |
| --- | --- | --- | --- |
| `:eesz=4M1M` | `eagle.flash.4m1m.ld` | `0x300000` | `0x3FA000` |
| `:eesz=4M2M` | `eagle.flash.4m2m.ld` | `0x200000` | `0x3FA000` |
| `:eesz=4M3M` | `eagle.flash.4m3m.ld` | `0x100000` | `0x3FA000` |
| `:eesz=4M` | `eagle.flash.4m.ld` | **none** | **none** |

**These are only build configuration assertions**. They do not establish which menu the existing deployed FloodGuard firmware used, the actual flash chip capacity, the real filesystem or OTA boundaries, persisted flash contents or electrical power-loss safety. A resolved CLI build menu must not be misrepresented as a physical board measurement or an existing-firmware provenance certificate.

## What CI runs (no hardware access)

The existing pinned ESP8266 compiler job first validates the SHA of its installed `boards.txt`. Then for every explicit menu, GitHub Actions runs this offline command, writes properties to a temporary file, validates only allowlisted flash keys, and removes the file:

```bash
arduino-cli compile --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" \
  --show-properties=expanded firmware/esp8266_review_diagnostic \
  > "/tmp/private-resolved-properties"
python3 experiments/esp8266-core-excl-review/r2_resolved_build_layout.py \
  --boards "/path/to/esp8266/3.1.2/boards.txt" \
  --properties "/tmp/private-resolved-properties" \
  --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --menu 4M1M
```

The real workflow loops over all four profiles. Arduino CLI's `--show-properties` inspects build settings rather than uploading a sketch. No serial port, board, USB hardware, firmware flash dump, credentials or production cloud is accessed. **Never publish the complete properties output**: arbitrary build-property overrides might contain sensitive values. The verifier prints a fixed success message only, or fails closed on conflicting inputs.

The negative tests cover implicit/default FQBNs, menu switch, wrong linker, flash size, FS bounds, no-FS geometry pollution, duplicated/missing values, oversized input and non-disclosure of unrelated keys. The static firmware policy asserts the real adapter's `writeNew()` remains `false`, the diagnostic does not invoke a filesystem mount and no app/UNO/cloud path is activated. Pinned core cross-compilation and all previous native/POSIX/ingress/website tests remain mandatory.

## Remaining physical acceptance barrier

Do not flash diagnostic firmware onto the operational system. Before any physical bench access, obtain explicit approval for a separate isolated unit, confirm its exact ESP8266 module and SPI flash part, independently identify its **deployed** image and linker/OTA/FS geometry, and take protected local backups with recovery procedures. Bootloader reading itself may reset the board and interrupt warnings; a live flood-warning controller is not an acceptable test unit. Do not upload full flash images or unique device identifiers to public GitHub, CI or ChatGPT.

A candidate single-owner scheduler, CRC checks, RAM-based exclusive-create tests, or correct CLI configuration does not prove durable retained telemetry, authenticated cloud receipts, safe UNKNOWN/STALE reporting, or supervised Arduino UNO alarm/gate control. Those remain blocked. **No merge, production Firebase change, firmware upload, alert, physical actuation or release approval. PRODUCTION NO-GO.**
