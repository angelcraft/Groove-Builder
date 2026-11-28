#!/usr/bin/env python3
"""Run the GE-155 suite and print/write exact counts (tests, subtests, failures). Exit 1 on any failure."""
import json
import os
import platform
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class Result(unittest.TextTestResult):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.sub_ok = 0
        self.sub_fail = 0
        self.per_test = {}

    def addSubTest(self, test, sub, err):
        super().addSubTest(test, sub, err)
        key = test.id()
        self.per_test.setdefault(key, [0, 0])
        if err is None:
            self.sub_ok += 1
            self.per_test[key][0] += 1
        else:
            self.sub_fail += 1
            self.per_test[key][1] += 1


def main():
    suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py")
    with open(os.devnull, "w") as null:
        r = unittest.TextTestRunner(resultclass=Result, stream=null, verbosity=0).run(suite)
    out = {"python": platform.python_version(), "platform": platform.platform(),
           "tests_run": r.testsRun, "failures": len(r.failures), "errors": len(r.errors),
           "skipped": [f"{t.id()}: {why}" for t, why in r.skipped],
           "subtests_passed": r.sub_ok, "subtests_failed": r.sub_fail,
           "subtests_per_test": {k: {"passed": v[0], "failed": v[1]} for k, v in sorted(r.per_test.items())},
           "ok": r.wasSuccessful()}
    for t, tb in r.failures + r.errors:
        print("FAIL", t.id(), tb, file=sys.stderr)
    print(json.dumps(out, indent=2))
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w") as f:
            json.dump(out, f, indent=2)
            f.write("\n")
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
