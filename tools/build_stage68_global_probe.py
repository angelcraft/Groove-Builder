"""Build a *temporary* Stage68-wide IPS branch probe from a pinned original.

This is NOT a Hoop3-specific practice skip or an independent minigame. The
one-instruction probe can change original Hoop2 as well as the borrowed slot.
No patch is emitted without a long explicit opt-in. Never writes to the NSO.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

from audit_hoop3_practice_path import EXPECTED_MAIN_SHA, EvidenceMismatch, load_original
from audit_hoop3_stage68_route import audit_image, emulate_original_branch


BRANCH_SITE = 0x42C198
BRANCH_TARGET = 0x42C2AC
ORIGINAL_WORD = 0x540008A1  # B.NE normal route when local flag != 1.
BUILD_ID = "03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8"
PATCH_FOLDER = "GrooveStage68GlobalProbe"
OPT_IN = "--i-understand-original-hoop2-will-also-change"


def encode_unconditional_branch(source: int, target: int) -> int:
    delta = target - source
    if delta % 4 or not -(1 << 27) <= delta < (1 << 27):
        raise EvidenceMismatch("ARM64 branch target out of range/alignment")
    return 0x14000000 | ((delta // 4) & 0x03FFFFFF)


PROBE_WORD = encode_unconditional_branch(BRANCH_SITE, BRANCH_TARGET)


def create_ips(image: bytes | bytearray) -> bytes:
    if BRANCH_SITE + 4 > len(image):
        raise EvidenceMismatch("Original text mapping is truncated")
    if struct.unpack_from("<I", image, BRANCH_SITE)[0] != ORIGINAL_WORD:
        raise EvidenceMismatch("Stage68 branch no longer matches pinned original")
    if BRANCH_SITE > 0xFFFFFF:
        raise EvidenceMismatch("IPS offset would overflow 24 bits")
    return (b"PATCH" + BRANCH_SITE.to_bytes(3, "big") +
            (4).to_bytes(2, "big") + struct.pack("<I", PROBE_WORD) + b"EOF")


def emulate_probe(image: bytes | bytearray) -> dict[str, str]:
    """Run the patched original 3-instruction branch in Unicorn, if present."""
    from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
    from unicorn.arm64_const import UC_ARM64_REG_PC, UC_ARM64_REG_X20, UC_ARM64_REG_X21

    observed = {}
    for flag in (0, 1, 2):
        machine = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        code = bytearray(image[0x42C000:0x42D000])
        struct.pack_into("<I", code, BRANCH_SITE - 0x42C000, PROBE_WORD)
        machine.mem_map(0x42C000, 0x1000)
        machine.mem_write(0x42C000, bytes(code))
        machine.mem_map(0x70000000, 0x8000)
        machine.mem_write(0x70000000 + 0x2C94, bytes((flag,)))
        machine.reg_write(UC_ARM64_REG_X20, 0x70000000)
        machine.reg_write(UC_ARM64_REG_X21, 0x2C94)
        machine.emu_start(0x42C190, 0x42C300, count=3)
        actual = machine.reg_read(UC_ARM64_REG_PC)
        if actual != BRANCH_TARGET:
            raise EvidenceMismatch(f"Stage68 global candidate diverged for flag {flag}")
        observed[str(flag)] = hex(actual)
    return observed


def emit_kit(directory: Path, ips: bytes, report: dict) -> Path:
    if directory.exists():
        raise FileExistsError("Output directory already exists; refusing overwrite")
    directory.mkdir(parents=True)
    relative = f"atmosphere/exefs_patches/{PATCH_FOLDER}/{BUILD_ID}.ips"
    ips_path = directory / relative
    ips_path.parent.mkdir(parents=True)
    ips_path.write_bytes(ips)
    report.update({
        "probe_kind": "stage68_global_practice_branch_not_hoop3_specific",
        "expected_main_sha256": EXPECTED_MAIN_SHA,
        "expected_main_build_id": BUILD_ID,
        "ips_relative_path": relative,
        "ips_sha256": hashlib.sha256(ips).hexdigest(),
        "branch_offset": hex(BRANCH_SITE),
        "original_word": hex(ORIGINAL_WORD),
        "new_word": hex(PROBE_WORD),
        "changes_original_hoop2": True,
        "independent_hoop3_level": False,
        "independent_progress": False,
        "practice_skip_in_game_verified": False,
        "installs_resources": False,
        "switch_hardware_tested": False,
        "other_mod_compatibility_tested": False,
    })
    (directory / "manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (directory / "LEEME.txt").write_text(
        """ENSAYO TEMPORAL / ALTO RIESGO — NO es Hoop Trundling 3 independiente.

Un único IPS cambia la rama Stage68 (main+0x42c198): el flag local ya no
entra al camino preliminar. Este cambio es GLOBAL para Stage68. Afectará
también al Hoop Trundling 2 ORIGINAL, no solamente a nuestra nueva casilla.
Se ha ejecutado la rama ARM64 aislada en Unicorn; NO hay prueba de juego,
sonido, estabilidad, salvado ni compatibilidad de mods en hardware.

ANTES: guarda una copia de tu partida; conserva el IPS anterior de la columna
9, pero NO superpongas IPS que escriban main+0x42c198. Cierra el juego.
Comprueba que tu main original coincide con el SHA-256 del manifest.
Puedes mover únicamente la carpeta atmosphere/ de este kit a la raíz de SD.
No requiere APK ni RomFS, ni modifica subsdk existentes por sí mismo.

PRUEBA A/B: inicia una vez la casilla Hoop2 ORIGINAL y la casilla nueva
(mundo1/col9/fila0) con y sin el probe. Observa si cambia la práctica,
si empieza el juego y si hay fallos visuales/sonoros. Esta prueba NO añade
54 aros, título, intro ni records propios. SI FALLA, sal y retira el IPS.

RETIRADA: con el juego cerrado, mueve fuera de SD SOLO la carpeta
atmosphere/exefs_patches/GrooveStage68GlobalProbe; reinicia el juego.
No borres tu mod de columna9, Orochi, HoopDX ni otras carpetas.
Si jugar alteró la partida, restaura el backup que hiciste antes.

IMPORTANTE: si no aceptas afectar temporalmente al Hoop2 original,
NO INSTALES este kit; espera al hook específico por casilla.
""", encoding="utf-8"
    )
    archive = directory.with_suffix(".zip")
    if archive.exists():
        raise FileExistsError("Archive already exists; refusing overwrite")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(directory))
    return archive


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("main", type=Path, help="Original user-owned main NSO (read-only)")
    parser.add_argument("--emit-dir", type=Path, help="Output directory for optional A/B kit")
    parser.add_argument(OPT_IN, action="store_true",
                        help="Necessary to emit an IPS affecting original Hoop2")
    args = parser.parse_args()
    image = load_original(args.main)
    audit_image(image)
    ips = create_ips(image)
    result = {
        "original_branch_unicorn": emulate_original_branch(image),
        "candidate_branch_unicorn": emulate_probe(image),
        "ips_sha256": hashlib.sha256(ips).hexdigest(),
        "hoop3_specific": False,
    }
    if args.emit_dir:
        if not getattr(args, OPT_IN[2:].replace("-", "_")):
            parser.error(f"Emission requires {OPT_IN}: original Hoop2 is affected")
        result["archive"] = str(emit_kit(args.emit_dir, ips, result))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
