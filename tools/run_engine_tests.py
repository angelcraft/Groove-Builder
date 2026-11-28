#!/usr/bin/env python3
"""Public host regression entrypoint; genuine parsers, no game/service stubs."""
from pathlib import Path
import os,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[1]
def run(*args):subprocess.run(args,cwd=ROOT,check=True)
def main():
    run(sys.executable,'tools/generate_engine_contract.py','--check')
    run(sys.executable,'-m','unittest','discover','-s','tools','-p','test_*.py','-v')
    run(sys.executable,'tools/gtf.py','test')
    with tempfile.TemporaryDirectory() as directory:
        output=Path(directory)
        flags=['g++','-std=c++17','-g','-O1','-fsanitize=address,undefined','-fno-sanitize-recover=all']
        run(*flags,'-pthread','-Iengine/src','tests/test_engine_safety.cpp','engine/src/gtf.cpp','engine/src/multi.cpp','engine/src/timeline.cpp','-o',str(output/'safety'))
        run(str(output/'safety'))
        run(*flags,'-Iengine/src','tests/test_v0_native.cpp','engine/src/v0_native.cpp','-o',str(output/'v0'));run(str(output/'v0'))
        for name,extra in [('test_hoop3_text_patch_plan',[]),('test_hoop3_title_dispatch',['source/hoop3_title_bridge.cpp'])]:
            run(*flags,'-Isource','tests/'+name+'.cpp',*extra,'-o',str(output/name));run(str(output/name))
if __name__=='__main__':main()
