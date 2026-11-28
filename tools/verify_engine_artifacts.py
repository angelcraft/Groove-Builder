#!/usr/bin/env python3
"""Audit our final ARM64 ELF/NSO, without reading a game executable."""
import argparse,hashlib,json,struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
import lz4.block

def verify(root):
    elfpath=root/'build/GrooveHT3.nss';nsopath=root/'build/GrooveHT3.nso'
    nso=nsopath.read_bytes()
    if nso[:4]!=b'NSO0' or len(nso)<256:raise ValueError('Invalid NSO0')
    with elfpath.open('rb') as stream:
        elf=ELFFile(stream)
        if elf['e_machine']!='EM_AARCH64' or elf['e_type']!='ET_DYN' or elf.elfclass!=64 or not elf.little_endian:raise ValueError('Unexpected ELF ABI')
        segments=[s for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
        if len(segments)!=3 or [s['p_flags'] for s in segments]!=[5,4,6]:raise ValueError('Expected RX/RO/RW segments')
        imports=[];relocations=0
        for name in ('.dynsym','.symtab'):
            table=elf.get_section_by_name(name)
            if table:
                imports += [s.name for s in table.iter_symbols() if s.name and s['st_shndx']=='SHN_UNDEF']
        if imports:raise ValueError('Unexpected unresolved ELF imports: '+repr(imports))
        flags=struct.unpack_from('<I',nso,12)[0]
        for i,s in enumerate(segments):
            offset,address,size=struct.unpack_from('<III',nso,0x10+i*16)
            compressed=struct.unpack_from('<I',nso,0x60+i*4)[0]
            stored=compressed if flags&(1<<i) else size
            if offset<256 or offset+stored>len(nso) or size!=s['p_filesz'] or address!=s['p_vaddr']:raise ValueError('NSO segment bounds/layout mismatch')
            raw=nso[offset:offset+stored]
            if flags&(1<<i):raw=lz4.block.decompress(raw,uncompressed_size=size)
            if raw!=s.data():raise ValueError('ELF/NSO payload differs')
            if flags&(1<<(i+3)) and hashlib.sha256(raw).digest()!=nso[0xa0+i*32:0xc0+i*32]:raise ValueError('NSO segment SHA mismatch')
        for section in elf.iter_sections():
            if section['sh_type'] not in ('SHT_RELA','SHT_REL'):continue
            for r in section.iter_relocations():
                if r['r_info_type']!=1027:raise ValueError('Expected only AArch64 RELATIVE relocations')
                address=r['r_offset']
                if not any(s['p_vaddr']<=address and address+8<=s['p_vaddr']+s['p_memsz'] for s in segments if s['p_flags']&2):raise ValueError('Relocation destination outside writable storage')
                relocations+=1
    return {'abi':'AArch64 ELF64 LE ET_DYN','segments':['RX','RO','RW'],'elf_nso_payloads_identical':True,'nso_segment_hashes_checked':(flags&0x38)==0x38,'relative_relocations':relocations,'unresolved_imports':[], 'hardware_validated':False}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(verify(a.root),indent=2))
