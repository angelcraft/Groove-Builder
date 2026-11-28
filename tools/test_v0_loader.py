"""Native C++ loader conformance against GE-155's pinned synthetic corpus.
No ZIP parser in the native loader: archive-only attacks belong to GE-155.
"""
import ctypes,json,os,subprocess,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PIN='d3c971f3862bb6c16cfccd4009bcfb25e37319b6'
class NativeLoader(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();cls.dir=Path(cls.temp.name)
  archive=subprocess.check_output(['git','archive',PIN,'tests/package/fixtures'],cwd=ROOT)
  import tarfile,io
  with tarfile.open(fileobj=io.BytesIO(archive)) as tf:tf.extractall(cls.dir,filter='data')
  cls.fixtures=cls.dir/'tests/package/fixtures'
  lib=cls.dir/'loader.so'
  subprocess.run(['g++','-std=c++17','-shared','-fPIC','-O1','-g','-fsanitize=undefined','-fno-sanitize-recover=all','-Iengine/src',
   'tests/v0_loader_bridge.cpp','engine/src/v0_loader.cpp','engine/src/gtf.cpp','engine/src/multi.cpp','engine/src/timeline.cpp','-o',str(lib)],cwd=ROOT,check=True)
  cls.lib=ctypes.CDLL(str(lib))
  for name in ('registry','manifest'):getattr(cls.lib,name).argtypes=[ctypes.c_char_p,ctypes.c_uint]
  cls.lib.timeline.argtypes=[ctypes.c_char_p,ctypes.c_uint,ctypes.c_int]
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def reg(self,obj):
  b=json.dumps(obj).encode();return self.lib.registry(b,len(b))
 def test_registry(self):
  r={'format':'groove-slots/1','capacity':2,'generation':0,'slots':[{'index':i,'coord':[0,9,i],'id':None}for i in range(2)]}
  self.assertEqual(self.reg(r),1)
  for bad in (True,2.0,-1,257):
   d=dict(r,capacity=bad);self.assertEqual(self.reg(d),0)
  for bad in ('con.demo','com0.demo','org..demo','org.demo\n'):
   r['slots'][0]['id']=bad;self.assertEqual(self.reg(r),0)
  r['slots'][0]['id']='org.demo.a';r['slots'][1]['id']='org.demo.a';self.assertEqual(self.reg(r),0)
  b=b'{"format":"groove-slots/1","format":"groove-slots/1"}'
  self.assertEqual(self.lib.registry(b,len(b)),0)
 def test_ge155_corpus(self):
  corpus=json.loads((self.fixtures/'corpus.json').read_text());checked=0
  for path in sorted((self.fixtures/'valid').glob('*.groove')):
   with zipfile.ZipFile(path)as z:
    raw=z.read('manifest.json');self.assertEqual(self.lib.manifest(raw,len(raw)),1,path.name)
    m=json.loads(raw);b=z.read(m['timeline']['path']);self.assertEqual(self.lib.timeline(b,len(b),m['timeline']['format']=='gtf'),1,path.name)
   checked+=1
  self.assertGreater(checked,0)
  for name,meta in corpus['invalid'].items():
   if meta['category'] not in ('manifest','timeline'):continue
   with zipfile.ZipFile(self.fixtures/'invalid'/name)as z:
    b=z.read('manifest.json')
    if meta['category']=='manifest':self.assertEqual(self.lib.manifest(b,len(b)),0,name)
    else:
     m=json.loads(b);raw=z.read(m['timeline']['path']);self.assertEqual(self.lib.timeline(raw,len(raw),m['timeline']['format']=='gtf'),0,name)
 def test_load_snapshots_and_gate(self):
  packs=sorted((self.fixtures/'valid').glob('*.groove'));selected=[]
  for p in packs:
   with zipfile.ZipFile(p)as z:
    m=json.loads(z.read('manifest.json'))
    if m['id']in [x[0]for x in selected]:continue
    selected.append((m['id'],p))
  self.assertGreaterEqual(len(selected),2)
  root=self.dir/'sd';root.mkdir(exist_ok=True)
  for sid,p in selected[:2]:
   target=root/'levels'/sid;target.mkdir(parents=True,exist_ok=True)
   with zipfile.ZipFile(p)as z:
    for n in z.namelist():(target/n).write_bytes(z.read(n))
  r={'format':'groove-slots/1','capacity':2,'generation':0,'slots':[{'index':i,'coord':[0,9,i],'id':sid}for i,(sid,p)in enumerate(selected[:2])]}
  (root/'slots.json').write_text(json.dumps(r));old=Path.cwd()
  try:
   os.chdir(root);self.assertEqual(self.lib.load(),1);self.assertEqual(self.lib.compile(0),1);self.assertEqual(self.lib.compile(1),1)
   (root/'.installer').mkdir(exist_ok=True);(root/'.installer/lock').write_text('x');self.assertEqual(self.lib.load(),0);self.assertEqual(self.lib.compile(0),0)
   (root/'.installer/lock').unlink();self.assertEqual(self.lib.load(),1)
   # Source changes after snapshot do not change compiled data until a reload.
   manifest=root/'levels'/selected[0][0]/'manifest.json';saved=manifest.read_bytes();manifest.write_text('{}');self.assertEqual(self.lib.compile(0),1);self.assertEqual(self.lib.load(),0)
   manifest.write_bytes(saved);r['generation']=1;(root/'slots.json').write_text(json.dumps(r));self.assertEqual(self.lib.load(),1)
   r['generation']=0;(root/'slots.json').write_text(json.dumps(r));self.assertEqual(self.lib.load(),0)
  finally:os.chdir(old)
if __name__=='__main__':unittest.main()
