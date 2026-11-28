import hashlib,importlib.util,io,json,subprocess,tarfile,tempfile,unittest,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('v0_fixtures',ROOT/'tools/make_v0_custom_remixes.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SyntheticRemixes(unittest.TestCase):
 def test_deterministic_and_installer_compatible(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);a=module.generate(root/'a');b=module.generate(root/'b')
   for name in ('Custom-Remix-A.groove','Custom-Remix-B.groove'):self.assertEqual((a/name).read_bytes(),(b/name).read_bytes())
   self.assertFalse(list(a.rglob('engine.json')))
   with self.assertRaises(ValueError):module.generate(a)
   # Exact GE-155 implementation with mutex/sentinel, not an independently drifted validator.
   pin='4ef974635a691d95ba59c90853c4bcc17fdfcfaf';raw=subprocess.check_output(['git','archive',pin,'tools/groove_package'],cwd=ROOT)
   with tarfile.open(fileobj=io.BytesIO(raw)) as tf:tf.extractall(root/'reference',filter='data')
   for name in ('Custom-Remix-A.groove','Custom-Remix-B.groove'):
    script='from tools.groove_package.validator import validate_package;from pathlib import Path;import sys;print(validate_package(Path(sys.argv[1]).read_bytes()).summary())'
    subprocess.run([sys.executable,'-c',script,str(a/name)],cwd=root/'reference',check=True,stdout=subprocess.PIPE)
