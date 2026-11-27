import unittest
from audit_engine_stack import parse_usage
class StackReportTests(unittest.TestCase):
    def test_preserves_dynamic_uncertainty(self):
        rows=parse_usage('/work/src/main.cpp:42:worker\t160\tstatic\n/work/src/gtf.cpp:1:emitRange\t512\tdynamic,bounded\n')
        self.assertEqual(rows[0],dict(function='main.cpp:42:worker',bytes=160,kind='static'))
        self.assertEqual(rows[1]['kind'],'dynamic,bounded')
    def test_rejects_unknown_records(self):
        for text in ['bad','f\t-1\tstatic','f\t16\tunknown']:
            with self.assertRaises(ValueError):parse_usage(text)
