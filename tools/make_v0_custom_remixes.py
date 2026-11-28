#!/usr/bin/env python3
"""Own synthetic validation kit, not a Switch installer; never creates engine.json."""
from pathlib import Path
import argparse,json,hashlib,zipfile
IDS=('org.groovebuilder.v0.a.4c38ff8c-158a-48e3-bc61-d1a17efac6c8','org.groovebuilder.v0.b.3a503e65-932b-4716-aadc-774575d26ca2')
TIMELINES=('first RING\nstart 0\nresults exit\nRING.hoop\nrest 2\nRING.hoop 2 0\nend 4\nfinish 6\n',
'first KAERU\nstart 0\nresults exit\nKAERU.frog3\nrest 1\nKAERU.frog3\nend 4\nfinish 6\n')
def generate(destination):
 destination=Path(destination)
 if destination.exists():raise ValueError('Output must be a new directory; no overwrite')
 destination.mkdir(parents=True)
 slots={'format':'groove-slots/1','capacity':2,'generation':0,'slots':[]}
 for i,(pid,text) in enumerate(zip(IDS,TIMELINES)):
  m={'format':'groove-package/1','profile':'runtime','id':pid,'version':'1.0.0','title':'Custom Remix '+chr(65+i)+' (synthetic)','engine_min':'0.6.0','engine_contract':1,'adapter':'multi','timeline':{'format':'gtf','path':'timeline.gtf'},'required_capabilities':['timeline.gtf'],'results':'custom'}
  raw={'manifest.json':(json.dumps(m,sort_keys=True,separators=(',',':'))+'\n').encode(),'timeline.gtf':text.encode()}
  level=destination/'loader-fixture'/'levels'/pid;level.mkdir(parents=True)
  with zipfile.ZipFile(destination/('Custom-Remix-'+chr(65+i)+'.groove'),'w') as z:
   for name,data in sorted(raw.items()):
    (level/name).write_bytes(data);info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.extract_version=20;z.writestr(info,data)
  slots['slots'].append({'index':i,'coord':[0,9,i],'id':pid})
 (destination/'loader-fixture'/'slots.json').write_text(json.dumps(slots,indent=2)+'\n')
 (destination/'README_ES.txt').write_text('Custom Remixes A/B: recursos y cues originales referenciados, sin archivos del juego.\nKit SOLO de validacion: no copiar loader-fixture sobre una SD instalada.\nValidar .groove con Groove Installer; no forzar plan/install ni fabricar engine.json.\nNo contiene modulo, IPS ni candidato ejecutable Switch.\nEl runtime ignora .installer.mutex permanente; bloquea con .installer/lock o journal.json.\n')
 sums=[]
 for p in sorted(destination.rglob('*')):
  if p.is_file():sums.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(destination).as_posix())
 (destination/'SHA256SUMS').write_text('\n'.join(sums)+'\n')
 return destination
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('output',type=Path);print(generate(p.parse_args().output))
