#!/usr/bin/env python3
"""Compile code-only ARM64 diagnostic objects and retain compiler stack estimates.

LTO is removed only for these diagnostic objects. They are never linked or installed.
The result is NOT a bound for the linked module or its native callees.
"""
import argparse,hashlib,json,shlex,subprocess
from pathlib import Path

def parse_usage(text):
    rows=[]
    for line in text.splitlines():
        fields=line.rsplit('\t',2)
        if len(fields)!=3: raise ValueError('Malformed compiler stack record')
        location,size,kind=fields
        if not size.isdecimal() or kind not in ('static','dynamic','dynamic,bounded'):raise ValueError('Unknown stack estimate')
        # Strip workspace path but preserve function/line provenance.
        location=location.split('/src/')[-1]
        rows.append({'function':location,'bytes':int(size),'kind':kind})
    return rows

def audit(root,out):
    if out.exists():raise ValueError('Output must be fresh')
    manifest=json.loads((root/'build-manifest.json').read_text())
    if manifest.get('kind')!='groove-engine-code-only-build-v1':raise ValueError('Expected our isolated code-only build')
    repo=Path(__file__).resolve().parents[1]
    for name,digest in manifest['sources'].items():
        if name.startswith('engine/src/') and hashlib.sha256((repo/name).read_bytes()).hexdigest()!=digest:
            raise ValueError('Build sources differ from current checkout: '+name)
    commands=subprocess.check_output(['ninja','-C',str(root/'build'),'-t','commands'],text=True).splitlines()
    selected=[]
    for line in commands:
        args=shlex.split(line)
        if '-c' in args and any(str(root/'src')+'/' in s and s.endswith('.cpp') for s in args): selected.append(args)
    if len(selected)!=4:raise ValueError('Expected the four engine translation units')
    out.mkdir(parents=True)
    rows=[]
    for args in selected:
        source=next(s for s in args if s.endswith('.cpp'))
        target=out/(Path(source).stem+'.o')
        result=[];i=0
        while i<len(args):
            if args[i] in ('-o','-MF','-MT'):i+=2;continue
            if args[i] in ('-MD','-MMD') or args[i].startswith('-flto'):i+=1;continue
            result.append(args[i]);i+=1
        result+=['-fstack-usage','-o',str(target)]
        subprocess.run(result,cwd=root/'build',check=True)
        usage=target.with_suffix('.su')
        if not usage.is_file():raise ValueError('Compiler emitted no stack evidence')
        rows+=parse_usage(usage.read_text())
    report={'kind':'groove-arm64-stack-diagnostic-v1','diagnostic_only':True,'lto_removed':True,
        'native_callees_available':False,'linked_module_bound_verified':False,'installable':False,
        'functions':sorted(rows,key=lambda r:r['bytes'],reverse=True),
        'blockers':['Native Runner cancellation/join/destruction bodies unavailable',
        'Native allocator, FS, coroutine and cue callees/indirect callbacks unbounded',
        'Actual per-thread stack capacity and peak use not established']}
    (out/'stack-report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);a=p.parse_args()
    report=audit(a.root.resolve(),a.out.resolve());print(json.dumps({k:v for k,v in report.items() if k!='functions'},indent=2))
