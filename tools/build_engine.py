#!/usr/bin/env python3
"""Build code-only ARM64 engine in a fresh isolated directory; never install it."""
import argparse,hashlib,json,os,shutil,subprocess
from pathlib import Path
from prepare import ROOT, PIN, validate_loader, prepare_loader_sources
BUILD_PIN=json.loads((ROOT/'tools/engine_build_pin.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def prepare(loader,stdlib,out):
    loader,stdlib,out=map(lambda p:p.resolve(),(loader,stdlib,out))
    if out.exists() or out==ROOT or ROOT in out.parents:raise ValueError('Output must be fresh and outside the repository')
    validate_loader(loader)
    for f in ('libc.a','libc++.a','libclang_rt.builtins-aarch64.a'):
        if not (stdlib/f).is_file():raise ValueError('Missing stdlib '+f)
    tree=hashlib.sha256()
    for f in sorted(stdlib.rglob('*')):
        if f.is_file():tree.update(str(f.relative_to(stdlib)).encode()+b'\0'+hashlib.sha256(f.read_bytes()).digest())
    if tree.hexdigest()!=BUILD_PIN['stdlib_tree_sha256']:raise ValueError('Unpinned stdlib content')
    out.mkdir(parents=True)
    for name in ('src','config','syms'):shutil.copytree(ROOT/'engine'/name,out/name)
    shutil.copy2(ROOT/'engine/CMakeLists.txt',out/'CMakeLists.txt')
    shutil.copytree(loader/'sys',out/'sys',ignore=shutil.ignore_patterns('.git','__pycache__','build'))
    shutil.copytree(loader/'lib/nnsdk',out/'lib/nnsdk',ignore=shutil.ignore_patterns('.git'))
    shutil.copytree(stdlib,out/'lib/std')
    # Reuse the already reviewed loader source retention/inventory fixes.
    prepare_loader_sources(out/'sys')
    (out/'build-manifest.json').write_text(json.dumps({
      'kind':'groove-engine-code-only-build-v1','version':'0.5.1','loader_commit':PIN['commit'],
      'submodules':PIN['submodules'],'build_pin':BUILD_PIN,
      'sources':{str(p.relative_to(ROOT)):digest(p) for p in sorted((ROOT/'engine').rglob('*')) if p.is_file()},
      'installable':False,'hardware_validated':False,'proprietary_inputs':False},indent=2)+'\n')
    return out

def build(out):
    compiler=subprocess.check_output(['clang','--version'],text=True).splitlines()[0]
    if BUILD_PIN['clang_version'] not in compiler:raise ValueError('Expected Clang '+BUILD_PIN['clang_version'])
    cmake_version=subprocess.check_output(['cmake','--version'],text=True).splitlines()[0].split()[-1]
    ninja_version=subprocess.check_output(['ninja','--version'],text=True).strip()
    if cmake_version!=BUILD_PIN['cmake_version'] or ninja_version!=BUILD_PIN['ninja_version']:raise ValueError('Unpinned CMake/Ninja version')
    env=dict(os.environ,SOURCE_DATE_EPOCH='1700000000',PYTHONHASHSEED='0')
    # Fixed path remapping covers __FILE__ in both our sources and the loader.
    flags=f'-ffile-prefix-map={out}=/build/groove-engine -fdebug-prefix-map={out}=/build/groove-engine'
    subprocess.run(['cmake','-S',str(out),'-B',str(out/'build'),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',f'-DCMAKE_C_FLAGS={flags}',f'-DCMAKE_CXX_FLAGS={flags}'],env=env,check=True)
    subprocess.run(['cmake','--build',str(out/'build'),'--parallel','2'],env=env,check=True)
    manifest=json.loads((out/'build-manifest.json').read_text())
    files=[p for p in (out/'build').iterdir() if p.suffix in ('.nss','.nso')]
    if not files:raise ValueError('No final ELF/NSO produced')
    import struct
    for p in files:
        b=p.read_bytes()
        if p.suffix=='.nss' and not (b[:4]==b'\x7fELF' and b[4]==2 and struct.unpack_from('<H',b,18)[0]==183):raise ValueError('Wrong ELF ABI')
        if p.suffix=='.nso' and b[:4]!=b'NSO0':raise ValueError('Not NSO0')
    manifest['artifacts']={p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in files}
    manifest['compiler']=compiler
    (out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser();p.add_argument('--loader',type=Path,required=True);p.add_argument('--std',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--build',action='store_true');a=p.parse_args()
    out=prepare(a.loader,a.std,a.out)
    if a.build:build(out)
    print(out/'build-manifest.json')
if __name__=='__main__':main()
