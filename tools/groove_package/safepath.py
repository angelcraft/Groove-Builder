"""Archive member / identifier name rules shared by the ZIP reader and installer."""
import unicodedata

# Windows device names are reserved with or without an extension ("con.txt").
DOS_DEVICES = {"con", "prn", "aux", "nul", "conin$", "conout$", "clock$",
               *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10)),
               "com¹", "com²", "com³", "lpt¹", "lpt²", "lpt³"}
_BAD_CHARS = set('<>:"|?*\\')


def is_dos_device(component: str) -> bool:
    base = component.split(".", 1)[0].rstrip(" ").lower()
    return base in DOS_DEVICES


def member_name_problem(name: str):
    """Return a reason string if a ZIP member name is unsafe, else None."""
    if not name:
        return "empty name"
    if any(ord(c) < 32 or ord(c) == 127 or 0x80 <= ord(c) <= 0x9F for c in name):
        return "control character"
    if "\\" in name:
        return "backslash"
    if name.startswith("/") or (len(name) > 1 and name[1] == ":") or name.startswith("//"):
        return "absolute path"
    if name.endswith("/"):
        return "directory entry"
    parts = name.split("/")
    for p in parts:
        if p in ("", ".", ".."):
            return "traversal or empty component"
        if p[-1] in ". ":
            return "trailing dot or space"
        if any(c in _BAD_CHARS for c in p):
            return "reserved character"
        if is_dos_device(p):
            return "DOS device name"
    return None


def fold(name: str) -> str:
    """Collision key: NFC + casefold (FAT32/exFAT/NTFS and Android SAF are case-insensitive)."""
    return unicodedata.normalize("NFC", name).casefold()
