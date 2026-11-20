"""Public synthetic tests for the 54-ring generator; no game binary used."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "build_hoop3_from_private_main",
    Path(__file__).with_name("build_hoop3_from_private_main.py"))
import sys
sys.path.insert(0, str(Path(__file__).parent))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class Hoop3GeneratorTests(unittest.TestCase):
    def test_native_tick_coordinates_need_exact_decimal_beats(self):
        self.assertEqual(build.tick_to_beat(8640), "18")
        self.assertEqual(build.tick_to_beat(44400), "92.5")
        with self.assertRaises(build.GrooveFormatError):
            build.tick_to_beat(1)

    def test_54_rings_and_stage68_conditional_mask(self):
        # Artificial schedule; don't include the game's extracted 34 beats.
        original = [beat for beat in range(7, 260, 7)
                    if beat not in build.EXTRA_RING_BEATS][:34]
        report = {"original_ring_ticks": [int(beat * 480) for beat in original],
                  "conditional_mask_ring": {"one_based_ring_number": 33}}
        calls = []
        for index in range(11):
            action = "basic" if index in (0, 10) else "hide" if index == 9 else "change"
            calls.append({"tick": index * 12 * 480, "original_argument": action})
        timeline = build.timeline_from_original(report, calls)
        events = timeline["events"]
        self.assertEqual(len(events), 68)
        self.assertEqual(sum(e["command"] == "hoop.ring_spawn" for e in events), 54)
        self.assertEqual(sum(e["command"] == "hoop.scene_action" for e in events), 11)
        index = next(i for i, e in enumerate(events)
                     if e["id"] == "ring_original_33")
        self.assertEqual(events[index - 1]["command"], "hoop.stage68_mask")
        self.assertEqual(events[index]["beat"], str(original[32]))
        self.assertEqual(events[index + 1]["command"], "hoop.bubble_state")
        self.assertEqual(events[index + 1]["args"]["mask"], -1)


if __name__ == "__main__":
    unittest.main()
