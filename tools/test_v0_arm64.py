#!/usr/bin/env python3
"""Execute V0 entries from the FINAL own-code ELF. Synthetic memory/originals.
No game image, SDK, Horizon service or scheduler emulation is claimed.
"""
import argparse,json,struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM64,UC_MODE_ARM,UC_HOOK_CODE
from unicorn.arm64_const import *
BASE=0x80000000; GAME=0x20000000; MGR=GAME+0x10A75F0
HEAP=0x40000000; STACK=0x50000000; CALLS=0x60000000; RET=0x6000F000
N=19
class Module:
    def __init__(self,p):
        self.u=Uc(UC_ARCH_ARM64,UC_MODE_ARM);self.u.reg_write(UC_ARM64_REG_CPACR_EL1,0x300000)
        with p.open('rb') as f:
            e=ELFFile(f);self.symbols={s.name:s['st_value']+BASE for s in e.get_section_by_name('.symtab').iter_symbols() if s.name}
            loads=[s for s in e.iter_segments() if s['p_type']=='PT_LOAD']
            end=max(s['p_vaddr']+s['p_memsz'] for s in loads)
            self.u.mem_map(BASE,(end+4095)&~4095)
            for s in loads:self.u.mem_write(BASE+s['p_vaddr'],s.data())
            for sec in e.iter_sections():
                if sec['sh_type']=='SHT_RELA':
                    for r in sec.iter_relocations():
                        assert r['r_info_type']==1027
                        self.u.mem_write(BASE+r['r_offset'],struct.pack('<Q',BASE+r['r_addend']))
        for a,n in [(GAME,0x2000000),(HEAP,0x200000),(STACK,0x100000),(CALLS,0x10000)]:self.u.mem_map(a,n)
        self.u.mem_write(CALLS,b'\xc0\x03\x5f\xd6'*(0x10000//4))
        self.calls=[0]*N;self.last=None;self.svc=0;self.lowsp=STACK+0xF0000;self.allowed=[(GAME,0x2000000),(HEAP,0x200000)]
        self.u.hook_add(UC_HOOK_CODE,self.trap,begin=CALLS,end=CALLS+0xFFFF)
        self.u.hook_add(UC_HOOK_CODE,self.trace,begin=BASE,end=BASE+end)
    def read(self,a,n):return bytes(self.u.mem_read(a,n))
    def put(self,a,b):self.u.mem_write(a,b)
    def q(self,a):return struct.unpack('<Q',self.read(a,8))[0]
    def i(self,a,v):self.put(a,struct.pack('<i',v))
    def safe(self,a,n):return any(a>=p and a-p<=k and n<=k-(a-p) for p,k in self.allowed)
    def trace(self,u,pc,size,_):
        self.lowsp=min(self.lowsp,u.reg_read(UC_ARM64_REG_SP))
        ins=struct.unpack('<I',self.read(pc,4))[0]
        if ins&0xFFE0001F==0xD4000001:raise AssertionError('unexpected SVC')
    def trap(self,u,pc,size,_):
        if pc==RET:u.emu_stop();return
        x=[u.reg_read(UC_ARM64_REG_X0+i) for i in range(8)]
        if pc==CALLS:
            ok=self.safe(x[0],x[2])
            if ok:self.put(x[1],self.read(x[0],x[2]))
            v=int(ok)
        elif pc==CALLS+4:
            ok=self.safe(x[0],x[2])
            if ok:self.put(x[0],self.read(x[1],x[2]))
            v=int(ok)
        else:
            k=(pc-CALLS-0x100)//4;assert 0<=k<N
            self.calls[k]+=1;self.last=x
            if k==7:self.i(HEAP+0x20000,0x20)
            v=0x87654321
        u.reg_write(UC_ARM64_REG_X0,v);u.reg_write(UC_ARM64_REG_PC,u.reg_read(UC_ARM64_REG_LR))
    def call(self,s,*args,lr=RET):
        u=self.u;sp=STACK+0xF0000
        for i in range(8):u.reg_write(UC_ARM64_REG_X0+i,args[i] if i<len(args) else 0)
        for i in range(19,30):u.reg_write((UC_ARM64_REG_X29 if i==29 else UC_ARM64_REG_X19+(i-19)),0xA0000000+i)
        u.reg_write(UC_ARM64_REG_SP,sp);u.reg_write(UC_ARM64_REG_LR,lr)
        # Return-address sentinels also act as LR-sensitive native call sites.
        if lr!=RET:
            page=lr&~4095
            # GAME is already mapped; stop without executing its zeroed memory.
            hook=u.hook_add(UC_HOOK_CODE,lambda uc,pc,sz,d:uc.emu_stop(),begin=lr,end=lr)
        u.emu_start(self.symbols[s],lr+4,count=2000000)
        if lr!=RET:u.hook_del(hook)
        assert u.reg_read(UC_ARM64_REG_PC)==lr,(s,hex(u.reg_read(UC_ARM64_REG_PC)))
        assert u.reg_read(UC_ARM64_REG_SP)==sp
        for i in range(19,30):assert u.reg_read((UC_ARM64_REG_X29 if i==29 else UC_ARM64_REG_X19+(i-19)))==0xA0000000+i,(s,i)
        return u.reg_read(UC_ARM64_REG_X0)
def verify(root):
    m=Module(root/'build/GrooveHT3.nss');backend=HEAP;slots=HEAP+0x1000;mp=HEAP+0x4000;c=HEAP+0x18000;intent=HEAP+0x19000
    ptrs=[CALLS+0x100+4*i for i in range(N)]
    m.put(backend,struct.pack('<'+'Q'*(3+N),GAME,CALLS,CALLS+4,*ptrs));assert m.call('groove_v0_bind',backend)==1
    b=bytearray(208)
    for i,sid in enumerate((b'org.example.alpha',b'org.example.beta')):
        b[i*104:i*104+len(sid)]=sid;b[i*104+97:i*104+99]=b'\1\1';struct.pack_into('<I',b,i*104+100,9)
    m.put(slots,bytes(b));assert m.call('groove_v0_configure',slots)==1
    m.i(mp+0x5274,0);m.i(mp+0x5298,9);m.i(mp+0x529C,0);m.i(mp+0x2A38,0)
    m.put(MGR+0xBA0,b'\xff'*4);m.i(MGR+0x2904,-1);m.put(MGR+0x3AA0,struct.pack('<Q',HEAP+0x20000));m.i(HEAP+0x20000,0x4A)
    assert m.call('groove_v0_map_init_entry',mp,4,5)==0x87654321
    assert m.calls[0]==1 and m.last[:3]==[mp,4,5]
    tested=0
    for w in range(3):
        for col in range(12):
            for row in range(5):
                m.put(c,struct.pack('<5i',0,0,w,col,row));before=m.calls[3]
                result=m.call('groove_v0_map_cell_entry',c)
                if w==0 and col==9 and row<2:assert m.read(result,8)==struct.pack('<ii',1,67) and m.calls[3]==before
                else:assert result==0x87654321 and m.calls[3]==before+1
                tested+=1
    m.put(c,struct.pack('<5i',0,0,0,9,0));assert m.call('groove_v0_cell_state_entry',c)==6
    before=m.read(MGR+0x548,0x1188)
    assert m.call('groove_v0_launch_entry',mp,55,2,3)==0x87654321
    assert m.calls[7]==1 and m.last[:4]==[mp,55,0,0]
    assert m.read(MGR+0x548,0x1188)==before
    assert struct.unpack('<I',m.read(HEAP+0x20000,4))[0]==0x2A
    assert m.call('groove_v0_begin_play_entry',MGR,1,67)==0 and m.calls[8]==0
    assert m.call('groove_v0_commit_entry',mp)==0 and m.calls[14]==0
    assert m.call('groove_v0_prepare_save',intent)==1 # waiting, no result/stage/quiescence
    # Incoming LR must reach the dispatch frame unchanged; unrelated site passes through.
    assert m.call('groove_v0_save_state_entry',MGR,1,67,lr=GAME+0x1000)==0x87654321
    assert m.call('groove_v0_write_save_entry',MGR,0)==0x87654321 and m.calls[16]==1
    assert m.call('groove_v0_fault')==0
    return {'kind':'ge151-v0-final-elf-synthetic-execution','grid_cells':tested,'native_delegations':m.calls[3],
      'original_once':True,'lr_sp_callee_saved_preserved':True,'launch_bits_restored':True,
      'observed_callback_stack_bytes':STACK+0xF0000-m.lowsp,'transitive_native_stack_bound':False,
      'originals':'synthetic callbacks, not original game functions','horizon_services_executed':False,
      'switch_tested':False,'installable':False}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('build',type=Path);p.add_argument('--output',type=Path);a=p.parse_args()
    result=verify(a.build);text=json.dumps(result,indent=2)+'\n'
    if a.output:a.output.write_text(text)
    print(text,end='')
