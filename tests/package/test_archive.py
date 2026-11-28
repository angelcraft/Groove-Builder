"""Security: every malicious/malformed fixture is rejected with the expected code; fuzzing never crashes."""
import random
import unittest
import zipfile
import io

from _util import corpus, fixture, valid, A10, A11, B10
from groove_package.errors import PackageError
from groove_package.validator import validate_package
from groove_package.zipreader import read_members


class Corpus(unittest.TestCase):
    def test_valid_fixtures(self):
        for n in corpus()["valid"]:
            with self.subTest(n):
                p = validate_package(valid(n))
                self.assertEqual(p.warnings, [])

    def test_valid_fixtures_readable_by_stdlib_zipfile(self):
        for n in corpus()["valid"]:
            with zipfile.ZipFile(io.BytesIO(valid(n))) as z:
                self.assertIsNone(z.testzip())

    def test_invalid_fixtures(self):
        c = corpus()["invalid"]
        self.assertGreaterEqual(len(c), 100)
        for n, v in c.items():
            with self.subTest(n):
                with self.assertRaises(PackageError) as cm:
                    validate_package(fixture("invalid", n))
                self.assertEqual(cm.exception.code, v["expect"], str(cm.exception))

    def test_identities_independent(self):
        a, b = validate_package(valid(A10)), validate_package(valid(B10))
        self.assertNotEqual(a.id, b.id)
        self.assertNotEqual(a.timeline_name, b.timeline_name)  # one GTF, one GTLM
        self.assertEqual(validate_package(valid(A11)).id, a.id)


class Fuzz(unittest.TestCase):
    """Random corruption must yield PackageError (fail closed), never another exception or acceptance of changed bytes."""

    def _check(self, data, original_ok_bytes):
        try:
            p = validate_package(data)
        except PackageError:
            return "rejected"
        # Accepted: then the payload must be byte-identical to the original (mutation hit an ignored field such as a timestamp)
        self.assertEqual(p.files, original_ok_bytes)
        return "accepted-identical"

    def test_byte_flips(self):
        rng = random.Random(155)
        stats = {"rejected": 0, "accepted-identical": 0}
        for name in (A10, B10):
            base = valid(name)
            files = validate_package(base).files
            for _ in range(1500):
                b = bytearray(base)
                for _ in range(rng.randint(1, 4)):
                    b[rng.randrange(len(b))] = rng.randrange(256)
                stats[self._check(bytes(b), files)] += 1
        self.assertGreater(stats["rejected"], 2500)

    def test_every_truncation(self):
        for name in (A10, B10):
            base = valid(name)
            for n in range(len(base)):
                with self.assertRaises(PackageError):
                    validate_package(base[:n])

    def test_oversize_archive_rejected_before_parsing(self):
        with self.assertRaises(PackageError) as cm:
            read_members(b"\0" * (32 * 1024 * 1024 + 1))
        self.assertEqual(cm.exception.code, "ZIP_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
