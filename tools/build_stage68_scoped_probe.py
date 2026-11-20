"""Experimental ARM64 Stage68 branch probe conditioned on native menu coords.

Two IPS records: replace one Stage68 branch with a B to a stub placed in the
padding at the end of the main .text page. The stub checks the game's own
saved world/column/row/index for Hoop3, otherwise reproduces the original
branch. NO assets are copied. It does not add an independent stage or 54 hoops.

Atmosphère's loader source zeroes this alignment padding, applies IPS after
decompression and grants execute permission to page-rounded .text. Actual
execution on the user's physical Switch and manager lifetime remain unverified.
This is a *risky, optional, reversible* hardware A/B.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

from audit_hoop3_practice_path import EXPECTED_MAIN_SHA, EvidenceMismatch, load_original
from audit_hoop3_native_selection_record import audit_image as audit_manager
from audit_hoop3_stage68_route import audit_image as audit_stage
from build_stage68_global_probe import BRANCH_SITE, BRANCH_TARGET, ORIGINAL_WORD, encode_unconditional_branch


TEXT_END = 0xA66BF0
RODATA_START = 0xA67000
STUB_START = TEXT_END
MANAGER_PTR = 0xD96058
FALLTHROUGH = 0x42C19C
BUILD_ID = "03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8"
PATCH_FOLDER = "GrooveStage68Hoop3ScopedProbe"
OPT_IN = "--accept-unverified-code-padding-risk"


def adrp(rd: int, pc: int, target: int) -> int:
    displacement = ((target & ~0xFFF) - (pc & ~0xFFF)) // 4096
    if not -(1 << 20) <= displacement < (1 << 20):
        raise EvidenceMismatch("ADRP page distance exceeds ARM64 range")
    return (0x90000000 | ((displacement & 3) << 29) |
            (((displacement >> 2) & 0x7FFFF) << 5) | rd)


def cmp_w_imm(reg: int, value: int) -> int:
    if not 0 <= value <= 4095:
        raise EvidenceMismatch("CMP immediate out of range")
    return 0x7100001F | (value << 10) | (reg << 5)


class Code:
    def __init__(self, start: int):
        self.start = start
        self.words: list[int] = []
        self.labels: dict[str, int] = {}
        self.fixups: list[tuple[int, str, str | int]] = []

    def pc(self) -> int:
        return self.start + len(self.words) * 4

    def label(self, name: str) -> None:
        if name in self.labels:
            raise EvidenceMismatch("Duplicate ARM64 label")
        self.labels[name] = self.pc()

    def emit(self, word: int) -> None:
        self.words.append(word)

    def branch(self, target: str | int, op: str = "b") -> None:
        self.fixups.append((len(self.words), op, target))
        self.words.append(0)

    def finish(self) -> bytes:
        for index, op, target in self.fixups:
            destination = self.labels[target] if isinstance(target, str) else target
            pc = self.start + index * 4
            distance = destination - pc
            if distance % 4:
                raise EvidenceMismatch("Unaligned ARM64 branch")
            if op == "b":
                word = encode_unconditional_branch(pc, destination)
            else:
                if not -(1 << 20) <= distance < (1 << 20):
                    raise EvidenceMismatch("Conditional ARM64 branch too far")
                imm = ((distance // 4) & 0x7FFFF) << 5
                if op == "ne":
                    word = 0x54000001 | imm
                elif op == "hi":
                    word = 0x54000008 | imm
                elif op == "cbz16":
                    word = 0xB4000010 | imm
                else:
                    raise EvidenceMismatch("Unknown ARM64 conditional branch")
            self.words[index] = word
        return b"".join(struct.pack("<I", word) for word in self.words)


def build_stub() -> bytes:
    code = Code(STUB_START)
    # Preserve all scratch GPRs; x8 still contains the original Stage68 flag.
    code.emit(0xD10083FF)  # sub sp,sp,#0x20
    code.emit(0xA90047F0)  # stp x16,x17,[sp]
    code.emit(0xF9000BE9)  # str x9,[sp,#0x10]
    code.emit(adrp(16, code.pc(), MANAGER_PTR))
    code.emit(0xF9402E10)  # ldr x16,[x16,#0x58] (manager singleton)
    code.branch("fallback", "cbz16")
    code.emit(0xB9690611)  # ldr w17,[x16,#0x2904] (native active mode)
    code.emit(cmp_w_imm(17, 1))
    code.branch("fallback", "hi")  # only modes 0 and 1
    code.emit(0x8B110210)  # add x16,x16,x17 (mode)
    code.emit(0x39EE6209)  # ldrsb w9,[x16,#0xb98] (world)
    code.emit(cmp_w_imm(9, 1))
    code.branch("fallback", "ne")
    code.emit(0x39EE6A09)  # ldrsb w9,[x16,#0xb9a] (column)
    code.emit(cmp_w_imm(9, 9))
    code.branch("fallback", "ne")
    code.emit(0x39EE7209)  # ldrsb w9,[x16,#0xb9c] (row)
    code.emit(cmp_w_imm(9, 0))
    code.branch("fallback", "ne")
    code.emit(0x8B110210)  # add x16,x16,x17 (now manager + 2*mode)
    code.emit(0x79D74209)  # ldrsh w9,[x16,#0xba0] (original native index)
    code.emit(cmp_w_imm(9, 41))
    code.branch("fallback", "ne")
    # Exact Hoop3 cell: restore GPRs, preserve original comparison flags,
    # skip ONLY the preliminary block; Stage68+0x2c94 remains untouched.
    code.label("match")
    code.emit(0xF9400BE9)  # ldr x9,[sp,#0x10]
    code.emit(0xA94047F0)  # ldp x16,x17,[sp]
    code.emit(0x910083FF)  # add sp,sp,#0x20
    code.emit(cmp_w_imm(8, 1))
    code.branch(BRANCH_TARGET)

    code.label("fallback")
    code.emit(0xF9400BE9)
    code.emit(0xA94047F0)
    code.emit(0x910083FF)
    code.emit(cmp_w_imm(8, 1))
    code.branch("original_taken", "ne")
    code.branch(FALLTHROUGH)
    code.label("original_taken")
    code.branch(BRANCH_TARGET)
    return code.finish()


def ips_record(offset: int, data: bytes) -> bytes:
    if not 0 <= offset <= 0xFFFFFF or not 0 < len(data) <= 0xFFFF:
        raise EvidenceMismatch("Invalid IPS record")
    return offset.to_bytes(3, "big") + len(data).to_bytes(2, "big") + data


def create_ips(image: bytes | bytearray) -> tuple[bytes, bytes]:
    audit_stage(image)
    audit_manager(image)
    if struct.unpack_from("<I", image, BRANCH_SITE)[0] != ORIGINAL_WORD:
        raise EvidenceMismatch("Stage68 branch was already modified")
    if image[TEXT_END:RODATA_START] != bytes(RODATA_START - TEXT_END):
        raise EvidenceMismatch("Text/rodata alignment gap not zero")
    stub = build_stub()
    if len(stub) > RODATA_START - STUB_START:
        raise EvidenceMismatch("Stub overflows original executable-page gap")
    site_word = encode_unconditional_branch(BRANCH_SITE, STUB_START)
    result = (b"PATCH" + ips_record(BRANCH_SITE, struct.pack("<I", site_word)) +
              ips_record(STUB_START, stub) + b"EOF")
    return result, stub


def emulate_scoped(image: bytes | bytearray, stub: bytes) -> dict:
    """Execute original Stage68 opcodes + candidate stub, without real Scene."""
    from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
    from unicorn.arm64_const import (
        UC_ARM64_REG_PC, UC_ARM64_REG_SP, UC_ARM64_REG_X8,
        UC_ARM64_REG_X9, UC_ARM64_REG_X16, UC_ARM64_REG_X17,
        UC_ARM64_REG_X20, UC_ARM64_REG_X21,
    )

    observations = {}
    cases = (
        ("hoop3/mode0", 0, 1, 9, 0, 41, True),
        ("hoop3/mode1", 1, 1, 9, 0, 41, True),
        ("hoop2/other_slot", 1, 1, 8, 0, 41, False),
        ("world0", 0, 0, 9, 0, 41, False),
        ("world2", 0, 2, 9, 0, 41, False),
        ("wrong_row", 1, 1, 9, 4, 41, False),
        ("wrong_index", 1, 1, 9, 0, 40, False),
        ("virtual_index_invalid", 1, 1, 9, 0, 80, False),
        ("bad_mode", 2, 1, 9, 0, 41, False),
        ("negative_mode", -1, 1, 9, 0, 41, False),
        ("no_manager", None, 1, 9, 0, 41, False),
    )
    for name, mode, world, column, row, index, is_hoop3 in cases:
        for flag in (0, 1, 2):
            machine = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
            code = bytearray(image[0x42C000:0x42D000])
            struct.pack_into("<I", code, BRANCH_SITE - 0x42C000,
                             encode_unconditional_branch(BRANCH_SITE, STUB_START))
            machine.mem_map(0x42C000, 0x1000)
            machine.mem_write(0x42C000, bytes(code))
            machine.mem_map(0xA66000, 0x1000)
            machine.mem_write(STUB_START, stub)
            machine.mem_map(0xD96000, 0x1000)
            machine.mem_map(0x70000000, 0x10000)  # game's manager
            machine.mem_map(0x71000000, 0x10000)  # Stage68 object
            machine.mem_map(0x72000000, 0x10000)  # stack
            machine.mem_write(0xD96058, struct.pack("<Q", 0 if mode is None else 0x70000000))
            if mode is not None:
                machine.mem_write(0x70000000 + 0x2904, struct.pack("<i", mode))
                if mode in (0, 1):
                    machine.mem_write(0x70000000 + 0xB98 + mode, bytes((world,)))
                    machine.mem_write(0x70000000 + 0xB9A + mode, bytes((column,)))
                    machine.mem_write(0x70000000 + 0xB9C + mode, bytes((row,)))
                    machine.mem_write(0x70000000 + 0xBA0 + 2 * mode, struct.pack("<h", index))
            machine.mem_write(0x71000000 + 0x2C94, bytes((flag,)))
            machine.reg_write(UC_ARM64_REG_SP, 0x72008000)
            for reg, value in ((UC_ARM64_REG_X9, 0x1122334455667788),
                               (UC_ARM64_REG_X16, 0x123456789),
                               (UC_ARM64_REG_X17, 0xFEDCBA987)):
                machine.reg_write(reg, value)
            machine.reg_write(UC_ARM64_REG_X20, 0x71000000)
            machine.reg_write(UC_ARM64_REG_X21, 0x2C94)
            destinations = []

            def stop_on_original_route(uc, address, size, _):
                if address in (BRANCH_TARGET, FALLTHROUGH):
                    destinations.append(address)
                    uc.emu_stop()

            machine.hook_add(UC_HOOK_CODE, stop_on_original_route)
            machine.emu_start(0x42C190, 0x42C300, count=100)
            expected = BRANCH_TARGET if is_hoop3 or flag != 1 else FALLTHROUGH
            if destinations != [expected]:
                raise EvidenceMismatch(f"Scoped ARM64 mismatch {name}, flag={flag}: {destinations}")
            if (machine.reg_read(UC_ARM64_REG_SP) != 0x72008000 or
                    machine.reg_read(UC_ARM64_REG_X9) != 0x1122334455667788 or
                    machine.reg_read(UC_ARM64_REG_X16) != 0x123456789 or
                    machine.reg_read(UC_ARM64_REG_X17) != 0xFEDCBA987):
                raise EvidenceMismatch(f"Scoped ARM64 clobbered saved GPR/SP for {name}")
            observations[f"{name}/flag{flag}"] = hex(destinations[0])
    return observations


def emit_kit(directory: Path, ips: bytes, report: dict) -> Path:
    archive = directory.with_suffix(".zip")
    if directory.exists() or archive.exists():
        raise FileExistsError("Output exists; refusing overwrite")
    relative = f"atmosphere/exefs_patches/{PATCH_FOLDER}/{BUILD_ID}.ips"
    directory.mkdir(parents=True)
    file = directory / relative
    file.parent.mkdir(parents=True)
    file.write_bytes(ips)
    report.update({
        "ips_sha256": hashlib.sha256(ips).hexdigest(),
        "original_main_sha256": EXPECTED_MAIN_SHA,
        "ips_relative_path": relative,
        "entry_branch": hex(BRANCH_SITE),
        "code_padding_start": hex(STUB_START),
        "scoped_arm64_emulation_passed": True,
        "physical_switch_verified": False,
        "atmosphere_loader_text_page_and_patch_order_audited": True,
        "text_page_padding_executable_on_users_switch_verified": False,
        "manager_stable_across_transition_verified": False,
        "independent_gameplay": False,
        "independent_progress": False,
        "practice_skip_in_hardware_verified": False,
    })
    (directory / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (directory / "LEEME.txt").write_text(
        """PRUEBA EXPERIMENTAL DE ALTO RIESGO — SOLO SWITCH / EMUMMC

Objetivo: saltar la ruta preliminar de Stage68 únicamente cuando el gestor
original conserve (mundo=1,columna=9,fila=0,índice=41). Mantiene la ruta
original en Hoop2 y otras coordenadas, según 33 casos ARM64 en Unicorn.

RIESGO: La fuente oficial de Atmosphère respalda el parcheo y ejecución en el
relleno de la página final de .text, pero NO se ha probado en tu Switch. Si
algún mod interfiere o el contexto cambia, EL JUEGO PUEDE FALLAR AL ENTRAR
A HOOP 2/3. La estabilidad del registro de selección durante la carga
tampoco está probada. No es un parche definitivo.

ANTES: respaldo de la partida y del directorio exefs_patches; cerrar juego.
RETIRA PRIMERO el ensayo global GrooveStage68GlobalProbe (conflicto al tocar
main+0x42c198). Conserva el mod de columna9 previamente funcional.
No mezcles otros IPS desconocidos en los mismos offsets.

Para prueba A/B opcional: fusiona atmosphere/ de este ZIP con tu microSD,
abre Hoop2 original y nuestra casilla nueva una vez cada una, y comprueba
práctica/inicio/salida. Si falla: cierra juego, mueve fuera de microSD solo
atmosphere/exefs_patches/GrooveStage68Hoop3ScopedProbe y reinicia.
NO borres el mod de columna 9 ni otros mods, y restaura la partida si cambió.

No cambia el número de aros, el nombre, música, intro ni progresos propios.
No requiere APK, RomFS, subsdk nuevos o datos propietarios en este ZIP.
""", encoding="utf-8"
    )
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for part in sorted(directory.rglob("*")):
            if part.is_file():
                bundle.write(part, part.relative_to(directory))
    return archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Exact user-owned original NSO")
    parser.add_argument("--emit-dir", type=Path, help="Optional experimental package directory")
    parser.add_argument(OPT_IN, action="store_true")
    args = parser.parse_args()
    image = load_original(args.main)
    ips, stub = create_ips(image)
    cases = emulate_scoped(image, stub)
    report = {
        "status": "offline_scoped_candidate_not_hardware_verified",
        "arm64_cases_passed": len(cases),
        "arm64_results": cases,
        "ips_sha256": hashlib.sha256(ips).hexdigest(),
        "stub_bytes": len(stub),
        "original_hoop2_behavior_preserved_in_unicorn": True,
    }
    if args.emit_dir:
        if not getattr(args, OPT_IN[2:].replace("-", "_")):
            parser.error(f"Emitting a risky IPS requires {OPT_IN}")
        report["archive"] = str(emit_kit(args.emit_dir, ips, report))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
