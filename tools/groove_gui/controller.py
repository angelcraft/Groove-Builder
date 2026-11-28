"""GUI-neutral controller: turns core results/errors into readable Spanish text.

No tkinter here, so it is unit-tested without a display and could back another
front end (e.g. an Android UI through Chaquopy).
"""
import os

from groove_package import slots as slotreg
from groove_package.cli import read_package
from groove_package.errors import InstallError, PackageError
from groove_package.installer import SD
from groove_package.validator import validate_package

SLOT_NAMES = {0: "A", 1: "B"}

HINTS = {
    "ENGINE_UNKNOWN": "La SD no tiene sd:/groove/engine.json: todavía no hay un motor Groove Engine con cargador "
                      "de paquetes (la v0.5.x no lo tiene). No se puede instalar.",
    "ENGINE_NO_PACKAGE_LOADER": "El motor instalado no carga niveles de paquetes (necesita 0.6.0 o posterior).",
    "ENGINE_MISSING_CAPABILITY": "El motor instalado no anuncia lo que este nivel necesita.",
    "ENGINE_UNKNOWN_BUILD": "La versión del juego no es la compatible (build 03FF4A3B…).",
    "ENGINE_JSON_INVALID": "engine.json está dañado o no es válido.",
    "SLOTS_FULL": "Las dos casillas (A y B) están ocupadas. Quita un nivel de su casilla o instala sin casilla.",
    "SLOT_OCCUPIED": "Esa casilla ya tiene otro nivel.",
    "SLOT_ALREADY_ASSIGNED": "Ese nivel ya está en otra casilla. Quítalo primero.",
    "SLOT_NOT_ASSIGNABLE": "Solo las casillas A y B están disponibles por ahora.",
    "VERSION_CONFLICT": "Ya hay un nivel con el mismo id y versión pero distinto contenido. Hay que subir la versión.",
    "DOWNGRADE_REFUSED": "La versión instalada es más nueva. En V0 no se permite volver a una versión anterior.",
    "LOCKED": "Otro instalador o una recuperación está usando esta SD. Ciérralo y vuelve a intentarlo.",
    "RECOVERY_NEEDED": "Hay una operación interrumpida. Pulsa «Recuperar» antes de seguir.",
    "JOURNAL_TAMPERED": "El diario de recuperación no coincide con la SD. No se ha tocado nada; revisa groove/.installer.",
    "JOURNAL_CORRUPT": "El diario de recuperación está dañado. No se ha tocado nada; revisa groove/.installer.",
    "SYMLINK_REFUSED": "Hay un enlace simbólico o unión en la SD. Por seguridad no se toca nada.",
    "SLOTS_CORRUPT": "slots.json está dañado. Puedes reiniciarlo (se guarda una copia) desde la línea de comandos.",
    "SLOTS_LEGACY": "slots.json tiene el formato antiguo de pruebas. Reinícialo explícitamente (se guarda copia).",
    "SLOTS_GENERATION_OVERFLOW": "El contador de cambios de slots.json está al máximo.",
    "LEVEL_DIR_UNEXPECTED": "La carpeta del nivel tiene archivos ajenos; no se toca.",
    "NOT_INSTALLED": "Ese nivel no está instalado.",
    "SD_NOT_FOUND": "No existe esa carpeta de SD.",
    "INSTALLED_INVALID": "El nivel instalado en la SD ya no es válido o no es compatible con el motor; "
                         "no se asigna. Reinstala el paquete original.",
    "ENGINE_CONTRACT_UNSUPPORTED": "El contrato del motor instalado no es compatible con este instalador.",
    "ENGINE_CONTRACT_MISMATCH": "El nivel se hizo para otro contrato del motor.",
    "ENGINE_TOO_OLD": "El nivel necesita una versión más nueva del motor.",
    "ENGINE_ADAPTER_UNSUPPORTED": "El nivel usa un adaptador que el motor no admite.",
    "LOCK_IO_ERROR": "No se pudo preparar el bloqueo en la SD (¿protegida contra escritura o llena?). No se ha tocado nada.",
    "RECOVERY_ARCHIVE_EXISTS": "Ya hay una copia de recuperación con ese nombre en groove/backups; no se toca nada.",
    "NOT_RUNTIME_PROFILE": "Es un proyecto del editor, no un paquete instalable. Exporta el perfil «runtime».",
}


class Outcome:
    def __init__(self, ok, title, lines=(), code=None, data=None):
        self.ok, self.title, self.lines, self.code, self.data = ok, title, list(lines), code, data

    def text(self):
        return "\n".join([self.title] + [f"  {x}" for x in self.lines])


def _fail(e):
    hint = HINTS.get(getattr(e, "code", ""), "")
    where = f" ({e.member})" if getattr(e, "member", "") else ""
    lines = [hint] if hint else []
    lines.append(f"Detalle técnico: [{e.code}]{where} {e.message}")
    return Outcome(False, "Rechazado", lines, e.code)


def _guard(fn):
    def run(*a, **k):
        try:
            return fn(*a, **k)
        except (PackageError, InstallError) as e:
            return _fail(e)
        except OSError as e:
            return Outcome(False, "Error de lectura/escritura", [str(e)], "IO_ERROR")
    return run


def slot_label(i):
    return "—" if i is None else SLOT_NAMES.get(i, str(i))


@_guard
def validate(path):
    p = validate_package(read_package(path))
    lines = [f"Título: {p.title}", f"Id: {p.id}", f"Versión: {p.version}  ·  motor mínimo {p.manifest['engine_min']}",
             f"Timeline: {p.timeline_name}  ·  {p.timeline_info['events']} eventos  ·  juegos: "
             f"{', '.join(p.timeline_info['games'])}", f"SHA-256: {p.sha256}"]
    lines += [f"Aviso: {w}" for w in p.warnings]
    return Outcome(True, "Paquete válido", lines, data=p)


@_guard
def install(path, sd_root, slot="auto"):
    r = SD(sd_root).install(read_package(path), slot=slot)
    verb = {"install": "Instalado", "upgrade": "Actualizado", "unchanged": "Ya estaba instalado (sin cambios)"}
    lines = [f"{r['title']} {r['version']}", f"Casilla: {slot_label(r['slot'])}",
             "Los guardados de custom-saves/ no se han tocado."]
    if r.get("cleanup_pending"):
        lines.append("Queda limpieza pendiente: pulsa «Recuperar».")
    lines += [f"Aviso: {w}" for w in r["warnings"]]
    return Outcome(True, verb.get(r["action"], r["action"]), lines, data=r)


@_guard
def uninstall(sd_root, pid):
    r = SD(sd_root).uninstall(pid)
    return Outcome(True, "Desinstalado", [pid, "El guardado del nivel se conserva en custom-saves/."], data=r)


@_guard
def assign(sd_root, pid, slot):
    r = SD(sd_root).assign(pid, slot)
    return Outcome(True, "Sin cambios" if r["action"] == "unchanged" else f"Asignado a la casilla {slot_label(slot)}",
                   [pid], data=r)


@_guard
def unassign(sd_root, pid):
    r = SD(sd_root).unassign(pid)
    return Outcome(True, "Quitado de su casilla", [pid], data=r)


@_guard
def recover(sd_root):
    r = SD(sd_root).recover()
    text = {"clean": "No había nada que recuperar.", "rolled-back": "Se deshizo la operación interrumpida.",
            "rolled-forward": "Se completó la operación interrumpida."}
    return Outcome(True, "Recuperación", [text.get(r, r)], data=r)


@_guard
def status(sd_root):
    if not os.path.isdir(sd_root):
        return _fail(InstallError("SD_NOT_FOUND", sd_root))
    st = SD(sd_root).status()
    reg = st["slots"]
    rows = []
    for lv in st["levels"]:
        idx = slotreg.slot_of(reg, lv["id"]) if reg else None
        rows.append({"id": lv["id"], "title": lv["title"], "version": lv["version"], "slot": slot_label(idx),
                     "save": "sí" if lv["has_save"] else "no"})
    eng = st["engine"]
    lines = [f"Motor: {eng['version']} ({', '.join(eng['capabilities'])})" if eng else "Motor: desconocido"]
    if reg:
        for s in reg["slots"][:2]:
            lines.append(f"Casilla {slot_label(s['index'])}: {s['id'] or 'vacía'}")
    lines += [f"Problema: {p}" for p in st["problems"]]
    return Outcome(not st["problems"], "Estado de la SD", lines, data={"rows": rows, "raw": st})
