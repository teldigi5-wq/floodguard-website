"""FloodGuard R2: synthetic metadata only; no real board or backup bytes."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "experiments/esp8266-core-excl-review/r2_board_layout_evidence.py"
spec = importlib.util.spec_from_file_location("r2_layout", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def boards_fixture():
    details = {
        "4M1M": ("eagle.flash.4m1m.ld", 0x300000, 0x3FA000),
        "4M2M": ("eagle.flash.4m2m.ld", 0x200000, 0x3FA000),
        "4M3M": ("eagle.flash.4m3m.ld", 0x100000, 0x3FA000),
        "4M": ("eagle.flash.4m.ld", None, None),
    }
    lines = ["nodemcuv2.name=NodeMCU 1.0 (ESP-12E Module)"]
    for key, (linker, begin, end) in details.items():
        prefix = "nodemcuv2.menu.eesz." + key + ".build."
        lines += [prefix + "flash_ld=" + linker, prefix + "flash_size=4M"]
        if begin is not None:
            lines += [prefix + "spiffs_start=" + hex(begin),
                      prefix + "spiffs_end=" + hex(end)]
    return ("\n".join(lines) + "\n").encode()


def sample_manifest():
    # All values are SYNTHETIC. They are not device measurements and must
    # never be interpreted as approval of the user's actual FloodGuard board.
    fake_hash = "a" * 64
    return {
        "schema": mod.SCHEMA,
        "origin": "operator-observed",
        "core_version": mod.SDK_VERSION,
        "fqbn": mod.FQBN,
        "selected_flash_menu": "4M1M",
        "selected_flash_ld": "eagle.flash.4m1m.ld",
        "real_flash_bytes": 4194304,
        "configured_flash_bytes": 4194304,
        "filesystem_start": 0x300000,
        "filesystem_end": 0x3FA000,
        "bench_isolated": True,
        "actuators_disconnected": True,
        "read_only_observation": True,
        "independent_partition_review": True,
        "backup": {
            "size_bytes": 4194304,
            "sha256": fake_hash,
            "second_read_sha256": fake_hash,
            "stored_privately": True
        }
    }


class BoardEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profiles = mod.get_profiles(boards_fixture(), verify_pin=False)

    def assess(self, patch=None):
        data = sample_manifest()
        if patch:
            patch(data)
        report = mod.review(self.profiles, data)
        for k in ("may_mount", "may_write", "may_flash", "may_publish",
                  "may_ack", "may_operate_gate", "production_go"):
            self.assertIs(report[k], False)
        self.assertFalse("sha256" in json.dumps(report))
        return report

    def test_source_has_distinct_profile_layouts(self):
        self.assertEqual(len(self.profiles), 4)
        self.assertNotEqual(self.profiles["4M1M"]["fs"],
                            self.profiles["4M3M"]["fs"])
        self.assertIsNone(self.profiles["4M"]["fs"])

    def test_mutated_sdk_source_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "unverified"):
            mod.get_profiles(boards_fixture(), verify_pin=True)

    def test_sdk_source_duplicate_profile_keys_fail(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            mod.get_profiles(boards_fixture() + b"nodemcuv2.menu.eesz.4M1M.build.flash_size=4M\n",
                             verify_pin=False)

    def test_synthetic_all_fields_still_not_permission(self):
        report = self.assess()
        self.assertEqual(report["evidence_status"],
                         "REQUIRES_INDEPENDENT_HARDWARE_REVIEW")
        self.assertEqual(report["finding_codes"], [])

    def test_unknown_or_sensitive_fields_forbidden(self):
        report = self.assess(lambda m: m.update({"wifi_password": "do-not-copy"}))
        self.assertIn("INVALID_SCHEMA_FIELDS", report["finding_codes"])
        self.assertNotIn("do-not-copy", json.dumps(report))

    def test_no_observation(self):
        report = self.assess(lambda m: m.update({"origin": "synthetic"}))
        self.assertIn("NO_ACTUAL_BOARD_OBSERVATION", report["finding_codes"])

    def test_missing_partition_bounds(self):
        report = self.assess(lambda m: m.update({"filesystem_start": None}))
        self.assertIn("PARTITION_BOUNDS_UNVERIFIED", report["finding_codes"])

    def test_wrong_partition_fails(self):
        report = self.assess(lambda m: m.update({"filesystem_start": 0x200000}))
        self.assertIn("PARTITION_LINKER_MISMATCH", report["finding_codes"])

    def test_no_fs_profile_rejected(self):
        def no_fs(m):
            m["selected_flash_menu"] = "4M"
            m["selected_flash_ld"] = "eagle.flash.4m.ld"
        report = self.assess(no_fs)
        self.assertIn("SELECTED_MENU_HAS_NO_FILESYSTEM", report["finding_codes"])

    def test_linker_menu_mismatch(self):
        report = self.assess(lambda m: m.update({"selected_flash_ld": "eagle.flash.4m3m.ld"}))
        self.assertIn("LINKER_PROFILE_MISMATCH", report["finding_codes"])

    def test_flash_capacity_mismatch(self):
        report = self.assess(lambda m: m.update({"real_flash_bytes": 2097152}))
        self.assertIn("FLASH_CAPACITY_CONFLICT", report["finding_codes"])

    def test_empty_or_boolean_flash_measurements_rejected(self):
        report = self.assess(lambda m: m.update({"real_flash_bytes": True}))
        self.assertIn("FLASH_CAPACITY_NOT_MEASURED", report["finding_codes"])

    def test_unsafe_bench_no_approval(self):
        report = self.assess(lambda m: m.update({"actuators_disconnected": False}))
        self.assertIn("BENCH_OR_INDEPENDENT_REVIEW_MISSING", report["finding_codes"])

    def test_failed_second_backup_hash(self):
        report = self.assess(lambda m: m["backup"].update({"second_read_sha256": "b" * 64}))
        self.assertIn("BACKUP_REPEATED_READ_MISMATCH", report["finding_codes"])

    def test_backup_size_mismatch(self):
        report = self.assess(lambda m: m["backup"].update({"size_bytes": 1}))
        self.assertIn("BACKUP_SIZE_CONFLICT", report["finding_codes"])

    def test_private_backup_requirement(self):
        report = self.assess(lambda m: m["backup"].update({"stored_privately": False}))
        self.assertIn("BACKUP_STORAGE_NOT_PRIVATE", report["finding_codes"])

    def test_duplicate_json_properties_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            mod.read_json_no_duplicate_keys(b'{"schema":"one","schema":"two"}')

    def test_manifest_size_limit(self):
        with self.assertRaisesRegex(ValueError, "too large"):
            mod.read_json_no_duplicate_keys(b" " * (mod.MAX_INPUT_BYTES + 1))

    def test_malformed_backup_does_not_crash(self):
        report = self.assess(lambda m: m.update({"backup": "not-a-backup"}))
        self.assertIn("PRIVATE_BACKUP_PROVENANCE_MISSING", report["finding_codes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
