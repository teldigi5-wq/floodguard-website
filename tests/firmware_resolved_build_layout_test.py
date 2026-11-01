"""FloodGuard R2: synthetic CLI property tests, no board, no flash read."""
from pathlib import Path
import importlib.util
import json
import unittest

SOURCE = Path(__file__).resolve().parents[1] / (
    "experiments/esp8266-core-excl-review/r2_resolved_build_layout.py")
spec = importlib.util.spec_from_file_location("fg_resolved", SOURCE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def sdk_fixture():
    lines = ["nodemcuv2.name=NodeMCU 1.0 (ESP-12E Module)"]
    for choice, start in (("4M1M",0x300000), ("4M2M",0x200000),
                          ("4M3M",0x100000), ("4M",None)):
        prefix="nodemcuv2.menu.eesz."+choice+".build."
        lines.extend((prefix+"flash_size=4M",
                      prefix+"flash_ld=eagle.flash."+choice.lower()+".ld"))
        if start is not None:
            lines.extend((prefix+"spiffs_start="+hex(start),
                          prefix+"spiffs_end=0x3fa000"))
    return ("\n".join(lines)+"\n").encode()


def property_fixture(menu):
    d = {
        "build.flash_ld": "eagle.flash."+menu.lower()+".ld",
        "build.flash_size": "4M",
        "build.fqbn": "esp8266:esp8266:nodemcuv2:eesz="+menu
    }
    offsets = {"4M1M": 0x300000, "4M2M":0x200000, "4M3M":0x100000}
    if menu in offsets:
        d["build.spiffs_start"]=hex(offsets[menu])
        d["build.spiffs_end"]="0x3FA000"
    return d


def prop_bytes(d):
    return ("\n".join(k+"="+v for k,v in d.items())+"\n").encode()


class PinnedResolvedBuildTests(unittest.TestCase):
    def setUp(self):
        self.old_hash=gate.board.PINNED_BOARDS_GIT_BLOB
        gate.board.PINNED_BOARDS_GIT_BLOB=gate.board.git_blob_sha(sdk_fixture())

    def tearDown(self):
        gate.board.PINNED_BOARDS_GIT_BLOB=self.old_hash

    def verify(self, menu, props=None, boards=None, fqbn=None):
        return gate.audit(
            sdk_fixture() if boards is None else boards,
            prop_bytes(property_fixture(menu)) if props is None else props,
            gate.TARGET+":eesz="+menu if fqbn is None else fqbn,menu)

    def test_four_explicit_profiles_match_synthetic_cli(self):
        for menu in gate.MENU_CHOICES:
            with self.subTest(menu=menu):
                result=self.verify(menu)
                self.assertEqual(result["build_configuration"],
                                 "MATCHED_PINNED_SDK_MENU")
                self.assertEqual(result["selected_menu"],menu)
                for name in ("device_physically_identified",
                             "filesystem_physically_verified","may_mount",
                             "may_write","may_flash","may_ack",
                             "may_operate_gate","production_go"):
                    self.assertIs(result[name],False)

    def test_unpinned_source_rejected(self):
        with self.assertRaisesRegex(ValueError, "unverified"):
            self.verify("4M1M",boards=sdk_fixture()+b"#tamper\n")

    def test_implicit_default_fqbn_rejected(self):
        with self.assertRaisesRegex(ValueError,"explicitly"):
            self.verify("4M1M",fqbn=gate.TARGET)

    def test_wrong_menu_in_fqbn_rejected(self):
        with self.assertRaisesRegex(ValueError,"explicitly"):
            self.verify("4M1M",fqbn=gate.TARGET+":eesz=4M3M")

    def test_unknown_menu_rejected(self):
        with self.assertRaisesRegex(ValueError,"unsupported"):
            self.verify("9M9M")

    def test_linker_switch_is_detected(self):
        d=property_fixture("4M1M")
        d["build.flash_ld"]="eagle.flash.4m3m.ld"
        with self.assertRaisesRegex(ValueError,"linker"):
            self.verify("4M1M",props=prop_bytes(d))

    def test_filesystem_start_switch_is_detected(self):
        d=property_fixture("4M1M")
        d["build.spiffs_start"]="0x100000"
        with self.assertRaisesRegex(ValueError,"offset"):
            self.verify("4M1M",props=prop_bytes(d))

    def test_filesystem_end_switch_is_detected(self):
        d=property_fixture("4M1M")
        d["build.spiffs_end"]="0x3F9000"
        with self.assertRaisesRegex(ValueError,"offset"):
            self.verify("4M1M",props=prop_bytes(d))

    def test_missing_and_invalid_offsets_rejected(self):
        d=property_fixture("4M2M")
        del d["build.spiffs_end"]
        with self.assertRaisesRegex(ValueError,"offset"):
            self.verify("4M2M",props=prop_bytes(d))
        d["build.spiffs_end"]="0xG0000"
        with self.assertRaisesRegex(ValueError,"offset"):
            self.verify("4M2M",props=prop_bytes(d))

    def test_no_fs_cannot_claim_fs(self):
        d=property_fixture("4M")
        d["build.spiffs_start"]="0x100000"
        with self.assertRaisesRegex(ValueError,"no-filesystem"):
            self.verify("4M",props=prop_bytes(d))

    def test_flash_size_conflict(self):
        d=property_fixture("4M3M")
        d["build.flash_size"]="2M"
        with self.assertRaisesRegex(ValueError,"flash size"):
            self.verify("4M3M",props=prop_bytes(d))

    def test_fqbn_in_returned_cli_props_must_match(self):
        d=property_fixture("4M1M")
        d["build.fqbn"]=gate.TARGET+":eesz=4M2M"
        with self.assertRaisesRegex(ValueError,"different flash menu"):
            self.verify("4M1M",props=prop_bytes(d))

    def test_missing_cli_fqbn_does_not_remove_explicit_cli_argument_check(self):
        d=property_fixture("4M1M")
        del d["build.fqbn"]
        self.assertFalse(self.verify("4M1M",props=prop_bytes(d))["may_flash"])
        with self.assertRaisesRegex(ValueError,"explicitly"):
            self.verify("4M1M",props=prop_bytes(d),fqbn=gate.TARGET)

    def test_duplicate_important_property_rejected(self):
        raw=prop_bytes(property_fixture("4M1M"))
        with self.assertRaisesRegex(ValueError,"duplicate"):
            self.verify("4M1M",props=raw+b"build.flash_ld=eagle.flash.4m1m.ld\n")

    def test_missing_critical_property_rejected(self):
        d=property_fixture("4M2M")
        del d["build.flash_ld"]
        with self.assertRaisesRegex(ValueError,"incomplete"):
            self.verify("4M2M",props=prop_bytes(d))

    def test_properties_size_limit(self):
        with self.assertRaisesRegex(ValueError,"oversized"):
            self.verify("4M1M",props=b" "*(gate.MAX_PROPERTY_BYTES+1))

    def test_unrelated_property_not_echoed(self):
        d=property_fixture("4M1M")
        d["wifi.password"]="DO-NOT-PRINT"
        result=self.verify("4M1M",props=prop_bytes(d))
        self.assertNotIn("DO-NOT-PRINT",json.dumps(result))

    def test_empty_fs_properties_are_accepted_for_no_fs(self):
        d=property_fixture("4M")
        d["build.spiffs_start"]=""
        d["build.spiffs_end"]=""
        self.assertFalse(self.verify("4M",props=prop_bytes(d))["may_mount"])


if __name__=="__main__":
    unittest.main(verbosity=2)
