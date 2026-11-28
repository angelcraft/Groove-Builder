"""Differential Python/native tests; no private assets or Horizon emulation."""
import ctypes as C
import json
from pathlib import Path
import random
import subprocess
import tempfile
import unittest
import gtf
ROOT=Path(__file__).resolve().parents[1]
class View(C.Structure):
    _fields_=[(s,C.c_int) for s in ('valid start transLen end endFade finish results first matchW matchC matchR bgm jingle swing count calls switches fades anims gameCount').split()]+[
        ('title',C.c_char*96),('prologue',C.c_char*96),('games',C.c_uint8*24),
        ('evTick',C.c_int*64),('evOp',C.c_uint8*64),('evGame',C.c_uint8*64),('evStyle',C.c_int8*64),('evSub',C.c_int8*64),('evFn',C.c_int*64),('evA',(C.c_int*4)*64),('evTag',(C.c_char*48)*64),('evWord',(C.c_char*8)*64),('evLen',C.c_int*64),('evAlpha',C.c_float*64),('evAnim',(C.c_char*48)*64)]
class EngineParsers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        path=Path(cls.tmp.name)/'parsers.so'
        subprocess.run(['g++','-std=c++17','-g','-O1','-fsanitize=undefined','-fno-sanitize-recover=all','-shared','-fPIC','-Iengine/src','tests/native_parser_bridge.cpp','engine/src/gtf.cpp','engine/src/multi.cpp','engine/src/timeline.cpp','-o',str(path)],cwd=ROOT,check=True)
        cls.lib=C.CDLL(str(path));cls.lib.parse_view.argtypes=[C.c_char_p,C.c_long,C.POINTER(View)]
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def compare(self,text,valid=None,gtl=False):
        v=View();data=text.encode();native=bool(self.lib.parse_view(data,len(data),C.byref(v)))
        try:p=gtf.parse_gtl(text) if gtl else gtf.compile_gtf(text);python=True
        except gtf.GtfError:python=False;p=None
        self.assertEqual(native,python,text)
        if valid is not None:self.assertEqual(native,valid,text)
        if not native:return
        for k,val in [('start',p.start),('end',p.end),('finish',p.finish),('endFade',p.end_fade),('results',p.results),('jingle',p.jingle),('count',len(p.events)),('transLen',p.translen),('swing',p.swing),('bgm',p.bgm)]:self.assertEqual(getattr(v,k),val,(k,text))
        self.assertEqual((v.matchW,v.matchC,v.matchR),p.match)
        self.assertEqual(v.title.decode(),p.title)
        self.assertEqual(v.prologue.decode(),p.prologue)
        self.assertEqual(v.first,gtf.GAMES.index(p.first))
        for i,e in enumerate(p.events[:64]):
            self.assertEqual(v.evTick[i],e.tick)
            self.assertEqual(v.evOp[i],dict(call=1,switch=2,fade=3,anim=4)[e.op])
            if e.game:self.assertEqual(v.evGame[i],gtf.GAMES.index(e.game))
            if e.op=='call':
                self.assertEqual(tuple(v.evA[i]),tuple(e.args))
                self.assertEqual(bytes(v.evTag[i]).split(b'\0')[0].decode(),e.tag or '')
                self.assertEqual(bytes(v.evWord[i]).split(b'\0')[0].decode(),e.word or '')
            if e.op=='fade':self.assertAlmostEqual(v.evAlpha[i],e.alpha,places=6)
            if e.op=='anim':self.assertEqual(v.evLen[i],e.layout)
    def test_examples_and_roundtrips(self):
        for p in (ROOT/'examples/multi').glob('*.gtf'):
            text=p.read_text();self.compare(text,True)
            self.compare(gtf.emit_gtl(gtf.compile_gtf(text)),True,gtl=True)
    def test_catalog_every_cue(self):
        for cue in gtf.CUES:
            self.compare(f'{cue.game}.{cue.name}\n',True)
    def test_verified_native_argument_profiles(self):
        for key,variants in gtf.CONTRACT['cue_args'].items():
            game,fn=key.split(':')
            for a in variants:
                word=' TEA' if gtf.CUE_FNS[(game,int(fn,16))] else ''
                # THE_A has no integer arguments in the native ABI.
                tail='' if word else ' '+' '.join(map(str,a))
                self.compare(f'{game}.{fn}{word}{tail}\n',True)
    def test_bounds_and_malformed(self):
        cases=['rest -1t','rest 2147483648t','at 2147483647t\nRING.hoop','rest 2147483647t\nrest 1t\nRING.hoop','rest 4473924.9999999999999999\nRING.hoop','loop 2147483647\nend\nRING.hoop','loop 32768\nloop 32768\nend\nend\nRING.hoop', 'RING.hoop 16', 'RING.hoop -2', 'anim RING Remix8 0x100\nRING.hoop','fade 1 nan\nRING.hoop','fade 1 1e-2\nRING.hoop','rest 1 extra\nRING.hoop','RING.hoop 0 0 0 0 0','title "x"junk\nRING.hoop','prologue ../escape\nRING.hoop','match 3 9 4\nRING.hoop','match 1 12 4\nRING.hoop','RING.hoop\nend 0','RING.hoop\nend 4\nfinish 1', 'RING.hoop\n'+'#'*256, 'RING.hoop\n'+'\n'*4096, 'RING.hoop\x00\n','jingle 0x200\nRING.hoop','title '+('a '*13)+'\nRING.hoop','RING.hoop 0xFFFFFFFF','RING.hoop 2147483648']
        for text in cases:
            with self.subTest(text=text[:70]):self.compare(text,False)
    def test_aliases_unicode_and_pool_limit(self):
        for alias,game in gtf.GAME_ALIASES.items():
            cue=next(c for c in gtf.CUES if c.game==game)
            self.compare(f'{alias}.{cue.name}\n',True)
        self.compare('title "Prueba 日本語"\nRING.hoop\n',True)
        self.compare('title "'+('é'*48)+'"\nRING.hoop\n',False)
        rows=['GTLM 1','start 0','end 1920','finish 3840']+[f'X 0 RING 0x217960 -1 tag_{i:030d}' for i in range(400)]
        self.compare('\n'.join(rows)+'\n',False,gtl=True)
    def test_depth_and_case(self):
        self.compare('def Pattern\nRING.hoop\nend\ncall pattern\n',True)
        self.compare('THE_A.0x278FE0 tea\n',True)
        self.compare('title \"\" \"Test\"\nRING.hoop -\n',True)
        self.compare('THE_A.tea 0\n',False)
        self.compare('RING.hoop 0 -\n',True)
        self.compare('loop 2\n'*9+'RING.hoop\n'+'end\n'*9,False)
    def test_exact_duration_boundary(self):
        for value in ['0.00625','0.5','1/3','1.000000000000','+0.5','2147483647t','-0.5','0.00001','1e1','0x1','-1t','-0','1/0x2','0x1/2']:
            text=f'rest {value}\nRING.hoop\n'
            self.compare(text)
    def test_gtlm_errors_defaults(self):
        base='GTLM 1\nstart 0\nX 0 RING 0x217960 -1\nend 1920 960\nfinish 3840\n'
        self.compare(base,True,gtl=True)
        for extra in ['jingle 0x200','A 1 RING 0x100 Bad','F 1 1 nan','end 1920 -1','match 1 9 5','start 0 extra','X 1 RING 0x217960 16','X 1 RING 0x217960 2147483648','X 1 THE_A 0x278FE0 TEA 0']:
            self.compare(base+extra+'\n',False,gtl=True)
        default=base.replace('start 0\n','').replace('end 1920 960','end 4000 960').replace('finish 3840','finish 5000')
        self.compare(default,True,gtl=True)
    def test_randomized_regression(self):
        rng=random.Random(5041)
        for _ in range(100):
            rows=['first RING']
            for i in range(rng.randrange(1,12)):
                rows += [f'rest {rng.randrange(0,10)}',f'RING.hoop {rng.randrange(-1,16)}']
            self.compare('\n'.join(rows)+'\n',True)
if __name__=='__main__':unittest.main()
