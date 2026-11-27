#!/usr/bin/env python3
# Groove Tickflow (.gtf) — compilador y descompilador a .gtl (GTLM 1) de Groove Engine.
# Python 3 de la biblioteca estándar, sin dependencias externas.
# Solo datos de tiempo y nombres de cue: no incluye datos del juego.
"""Groove Tickflow (.gtf) compiler / decompiler for Groove Engine .gtl timelines."""

from __future__ import annotations

import argparse
import sys
import traceback
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Iterable, Optional

VERSION = "0.1"
TPB = 480
MAX_EVENTS = 2048
MAX_GAMES = 24
TITLE_MAX = 95
PROLOGUE_MAX = 95
JINGLE_MIN, JINGLE_MAX = 0x158, 0x16C

GAMES = [
    "PUMPUP", "FLYDISC", "ROLLING", "HUNGRY", "CARS", "KAERU", "CRAB",
    "INSECT", "SOFTCATCH", "RING", "THUNDER", "HAMMER", "MOON", "THE_A",
    "PUTILABO", "WIPER", "SOCCER", "HURDLE", "TALK", "COOKING", "PARASOL",
    "DANCER", "SAMURAI", "BRUSH",
]

GAME_TITLE = {
    "PUMPUP": "Fruit Flex", "FLYDISC": "Disc Dog", "ROLLING": "Hop, Stop & Roll",
    "HUNGRY": "Feeding the Beast", "CARS": "Stop, Go, Stop", "KAERU": "Ribbit Rocket",
    "CRAB": "Crab Snacks", "INSECT": "Flutter Speed", "SOFTCATCH": "Yum-Bot Simulator",
    "RING": "Hoop Trundling", "THUNDER": "Lightning Bolting", "HAMMER": "Can-Do",
    "MOON": "Sneezy Moon", "THE_A": "A for Effort", "PUTILABO": "Pop, Don't Drop",
    "WIPER": "Wiper Bosses", "SOCCER": "Soccer Dreams", "HURDLE": "Hop & Slide",
    "TALK": "Alien Alphabet", "COOKING": "Slice & Dice Kitchen",
    "PARASOL": "Brolly Good Show", "DANCER": "Backup Spotlight",
    "SAMURAI": "Spirit Slasher", "BRUSH": "Sweeper Star",
}

GAME_ALIASES = {
    "hooptrundling": "RING", "hooptrundlingcast": "RING",
    "hooptrundlingcastofcharacters": "RING",
    "feedingthebeast": "HUNGRY", "crabsnacks": "CRAB", "sneezymoon": "MOON",
    "ribbitrocket": "KAERU", "hopstopnroll": "ROLLING", "fruitflex": "PUMPUP",
    "wiperbosses": "WIPER", "soccercdreams": "SOCCER", "soccerdreams": "SOCCER",
    "lightningbolting": "THUNDER", "discdog": "FLYDISC", "aforeffort": "THE_A",
    "brollygoodshow": "PARASOL", "slicendicekitchen": "COOKING",
    "backupspotlight": "DANCER", "sweeperstar": "BRUSH",
    "spiritslasher": "SAMURAI", "yumbotsimulator": "SOFTCATCH",
    "stopngonstop": "CARS", "flutterspeed": "INSECT", "popdontdrop": "PUTILABO",
    "cando": "HAMMER", "hopnslide": "HURDLE", "alienalphabet": "TALK",
}

LAYOUT_OFF = {
    "FLYDISC": 0x40B8, "ROLLING": 0x3E08, "HUNGRY": 0x3CB0, "CARS": 0x3CB0,
    "KAERU": 0x4778, "CRAB": 0x3B58, "INSECT": 0x3CA8, "SOFTCATCH": 0x3CB0,
    "RING": 0x3B58, "THUNDER": 0x3B58, "HAMMER": 0x3B58, "MOON": 0x3E00,
    "THE_A": 0x4360, "PUTILABO": 0x3E08, "WIPER": 0x3F60, "SOCCER": 0x3E00,
    "HURDLE": 0x3CB0, "TALK": 0x3CB0, "COOKING": 0x3CB0, "PARASOL": 0x3CA8,
    "DANCER": 0x3E08, "SAMURAI": 0x3E08, "BRUSH": 0x40B0,
}

# (game, fn) -> kind (0 = int args, 1 = word)
CUE_FNS = {
    ("PUMPUP", 0x209B80): 0, ("PUMPUP", 0x20A170): 0,
    ("FLYDISC", 0x18D3F0): 0,
    ("ROLLING", 0x222FA0): 0, ("ROLLING", 0x223350): 0, ("ROLLING", 0x223800): 0,
    ("HUNGRY", 0x1AF800): 0,
    ("CARS", 0x1601D0): 0, ("CARS", 0x1608F0): 0,
    ("KAERU", 0x1B8DB0): 0, ("KAERU", 0x1B8F70): 0,
    ("CRAB", 0x17BFC0): 0, ("CRAB", 0x17D0D0): 0,
    ("INSECT", 0x1B54C0): 0, ("INSECT", 0x1B5A60): 0, ("INSECT", 0x1B60F0): 0,
    ("SOFTCATCH", 0x248B70): 0,
    ("RING", 0x217960): 0,
    ("THUNDER", 0x27DBA0): 0, ("THUNDER", 0x27E130): 0,
    ("THUNDER", 0x27E6C0): 0, ("THUNDER", 0x27EC00): 0,
    ("HAMMER", 0x1AB410): 0, ("HAMMER", 0x1ABCB0): 0,
    ("MOON", 0x1DB630): 0,
    ("THE_A", 0x278FE0): 1,
    ("PUTILABO", 0x20BF90): 0, ("PUTILABO", 0x20C190): 0,
    ("WIPER", 0x2AA2F0): 0, ("WIPER", 0x2A9B00): 0, ("WIPER", 0x2AA6F0): 0,
    ("WIPER", 0x2AA4F0): 0, ("WIPER", 0x2A9900): 0, ("WIPER", 0x2A9700): 0,
    ("SOCCER", 0x246760): 0, ("SOCCER", 0x246B80): 0, ("SOCCER", 0x246FF0): 0,
    ("HURDLE", 0x1B1FC0): 0, ("HURDLE", 0x1B24D0): 0,
    ("TALK", 0x255100): 0,
    ("COOKING", 0x178880): 0, ("COOKING", 0x178DC0): 0,
    ("PARASOL", 0x204970): 0, ("PARASOL", 0x205030): 0,
    ("DANCER", 0x181210): 0, ("DANCER", 0x181C70): 0, ("DANCER", 0x182460): 0,
    ("SAMURAI", 0x22AD50): 0, ("SAMURAI", 0x22AFF0): 0,
    ("BRUSH", 0x15AF40): 0, ("BRUSH", 0x15B2E0): 0, ("BRUSH", 0x15AB00): 0,
    ("BRUSH", 0x15A560): 0,
}
THE_A_WORDS = ("TEA", "SODA", "COCOA", "AAA")

# (name, game, fn, args, aliases[, word])
_CUE_ROWS = [
    ("apple", "PUMPUP", 0x209B80, [1, 0, 0], ("fruitFlexApple",)),
    ("lemon", "PUMPUP", 0x20A170, [0, 0, 0], ("fruitFlexLemon",)),
    ("throw", "FLYDISC", 0x18D3F0, [0, 3360, -1, 0],
     ("throwGrowl", "throwCounting", "throwCountingGrowl", "throwFade",
      "throwFadeGrowl", "throwCountingOffbeat", "throwCountingGrowlOffbeat",
      "throwFadeOffbeat", "throwFadeGrowlOffbeat")),
    ("rolling", "ROLLING", 0x222FA0, [1, 0, 0],
     ("rollingHops", "rollingWithPartyPopper", "rollingHopsWithPartyPopper")),
    ("stopHopping", "ROLLING", 0x222FA0, [2, 0, 0], ()),
    ("startHopping", "ROLLING", 0x223350, [0, 0, 0], ()),
    ("rollExtra", "ROLLING", 0x223800, [0, 0, 0], ()),
    ("yellow", "HUNGRY", 0x1AF800, [0], ("shootYellow", "chompYellow", "pinkHeartShoot", "munch1")),
    ("purple", "HUNGRY", 0x1AF800, [1], ("shootPurple", "chompPurple", "greenHeartShoot", "munch2")),
    ("accel", "CARS", 0x1601D0, [1, 0, 0, 0], ()),
    ("accelRemix7", "CARS", 0x1601D0, [0, 0, 0, 0], ()),
    ("brake", "CARS", 0x1608F0, [0, -1, 0, 0], ()),
    ("frog3", "KAERU", 0x1B8DB0, [3, 0, 0], ()),
    ("frog4", "KAERU", 0x1B8DB0, [4, 0, 0], ()),
    ("frog5", "KAERU", 0x1B8DB0, [5, 0, 0], ()),
    ("frog2", "KAERU", 0x1B8DB0, [2, 0, 0], ()),
    ("tadpole", "KAERU", 0x1B8F70, [3, 0, 0], ()),
    ("macaron", "CRAB", 0x17BFC0, [-1, -1, -1], ("macaronhitplayer", "macaronvoice")),
    ("favabeans", "CRAB", 0x17D0D0, [-1, -1, -1], ("favabean", "favabeanhit1")),
    ("butterfly", "INSECT", 0x1B54C0, [360, 1920, 0, 0], ("butterflyNoVoice",)),
    ("butterflyRemix5", "INSECT", 0x1B54C0, [720, 1920, 0, 0],
     ("butterflyRemix5Counting", "butterflyRemix5NoVoice", "butterflyRemix5CountingNoVoice")),
    ("grasshopper", "INSECT", 0x1B5A60, [240, 1920, 0, 0], ("grasshopperNoVoice",)),
    ("grasshopperRemix5", "INSECT", 0x1B5A60, [480, 1920, 0, 0], ("grasshopperRemix5NoVoice",)),
    ("dragonfly", "INSECT", 0x1B60F0, [480, 1920, 0, 0], ("dragonflyNoVoice",)),
    ("pudding", "SOFTCATCH", 0x248B70, [0, 320, 0, 0], ("puddingPractice",)),
    ("puddingLong", "SOFTCATCH", 0x248B70, [0, 480, 0, 0], ("puddingLongPractice",)),
    ("defectivePudding", "SOFTCATCH", 0x248B70, [1, 320, 0, 0], ()),
    ("defectivePuddingLong", "SOFTCATCH", 0x248B70, [1, 480, 0, 0], ()),
    ("hoop", "RING", 0x217960, [-1], ("hoopPass",)),
    ("cloudYellow", "THUNDER", 0x27DBA0, [1, 0, 0], ("cloudYellowSwing",)),
    ("cloudYellowAlt", "THUNDER", 0x27E130, [0, 0, 0], ()),
    ("cloudPink", "THUNDER", 0x27E6C0, [1, 0, 0], ("cloudPinkSwing",)),
    ("cloudPinkAlt", "THUNDER", 0x27EC00, [0, 0, 0], ()),
    ("red", "HAMMER", 0x1AB410, [0, 0, 7680, 0], ()),
    ("redFrog", "HAMMER", 0x1AB410, [-960, 1, 7680, 0], ()),
    ("blue", "HAMMER", 0x1ABCB0, [0, 0, 7680, 0], ()),
    ("blueFrog", "HAMMER", 0x1ABCB0, [-1200, 1, 7680, 0], ()),
    ("greenSneeze", "MOON", 0x1DB630, [1, 0, 0], ("greenSneezeFast", "greenSneezePractice")),
    ("greenSneezeStandalone", "MOON", 0x1DB630, [0, 0, 0],
     ("greenSneezeFastStandalone", "greenSneezeStandalonePractice")),
    ("tea", "THE_A", 0x278FE0, [], ("aForEffortTea",), "TEA"),
    ("soda", "THE_A", 0x278FE0, [], ("aForEffortSoda",), "SODA"),
    ("cocoa", "THE_A", 0x278FE0, [], ("aForEffortCocoa",), "COCOA"),
    ("aaa", "THE_A", 0x278FE0, [], ("aForEffortAaa",), "AAA"),
    ("softGrow", "PUTILABO", 0x20BF90, [0, 0, 0, 0], ("soft",)),
    ("hardGrow", "PUTILABO", 0x20C190, [480, 0, 0, 0], ("hard",)),
    ("pinkFast", "WIPER", 0x2AA2F0, [3, 0, 0], ()),
    ("bothSlow", "WIPER", 0x2A9B00, [3, 0, 0], ()),
    ("bothFast", "WIPER", 0x2AA6F0, [3, 0, 0], ()),
    ("blueFast", "WIPER", 0x2AA4F0, [3, 0, 0], ()),
    ("blueSlow", "WIPER", 0x2A9900, [1, 0, 0], ()),
    ("pinkSlow", "WIPER", 0x2A9700, [0, 0, 0], ()),
    ("white", "SOCCER", 0x246760, [0, 0, 0], ()),
    ("pink", "SOCCER", 0x246B80, [0, 0, 0], ()),
    ("yellow", "SOCCER", 0x246FF0, [0, 0, 0], ("soccerYellow",)),
    ("yellowThunder", "SOCCER", 0x246FF0, [0, 1920, 0], ()),
    ("hop", "HURDLE", 0x1B1FC0, [0, 0, 0, 0], ()),
    ("slide", "HURDLE", 0x1B1FC0, [1, 0, 0, 0], ()),
    ("hurdleAlt", "HURDLE", 0x1B24D0, [2, 2, 0], ()),
    ("cha", "TALK", 0x255100, [1, 0, 0, 0], ("chaGrown",)),
    ("tomato1", "COOKING", 0x178880, [0, 1, 0, 0], ()),
    ("tomato2", "COOKING", 0x178880, [1, 1, 0, 0], ()),
    ("tomato3", "COOKING", 0x178880, [2, 1, 0, 0], ()),
    ("tomato4", "COOKING", 0x178880, [3, 1, 0, 0], ()),
    ("pepper1", "COOKING", 0x178880, [0, 3, 0, 0], ()),
    ("pepper2", "COOKING", 0x178880, [1, 3, 0, 0], ()),
    ("pepper3", "COOKING", 0x178880, [2, 3, 0, 0], ()),
    ("pepper4", "COOKING", 0x178880, [3, 3, 0, 0], ()),
    ("broccoli", "COOKING", 0x178DC0, [3, 2, -1, -1], ()),
    ("cho", "PARASOL", 0x204970, [480, 0, 0, 0], ("encore",)),
    ("pa", "PARASOL", 0x204970, [480, 1, 0, 0], ()),
    ("allez", "PARASOL", 0x205030, [1, 1, 0, 0], ()),
    ("countDance", "DANCER", 0x181210, [12, 3, 0, 0], ("countDanceL", "countDanceR")),
    ("countElbow", "DANCER", 0x181C70, [12, 3, 0, 0], ()),
    ("flashy", "DANCER", 0x182460, [0, 1, 0, 0], ("flashyLeft", "flashyRight")),
    ("singleSlash", "SAMURAI", 0x22AD50, [1, 1, 0, 0], ("singleStarter",)),
    ("doubleSlash", "SAMURAI", 0x22AFF0, [1, 1, 0, 0], ("doubleStarter",)),
    ("spin", "BRUSH", 0x15AF40, [0, 0, 0, 0], ("spinTimestretched",)),
    ("spinAlt", "BRUSH", 0x15B2E0, [0, 0, 0, 0], ()),
    ("sweepThree", "BRUSH", 0x15AB00, [0, 0, 0, 0], ()),
    ("sweeping", "BRUSH", 0x15A560, [12, 1, 1], ("sweepingStart",)),
]


@dataclass(frozen=True)
class CueDef:
    name: str
    game: str
    fn: int
    args: tuple
    aliases: tuple
    word: Optional[str] = None
    kind: int = 0


def _pad4(args: Iterable[int]) -> tuple:
    a = list(args)
    while len(a) < 4:
        a.append(0)
    return tuple(a[:4])


CUES: list[CueDef] = []
CUE_BY_NAME: dict[tuple[str, str], CueDef] = {}
CUE_SHORT: dict[str, list[CueDef]] = {}
CUE_BY_SIG: dict[tuple, CueDef] = {}
CUE_BY_FN: dict[tuple[str, int], CueDef] = {}


def _register_cues() -> None:
    for row in _CUE_ROWS:
        name, game, fn, args, aliases = row[0], row[1], row[2], row[3], row[4]
        word = row[5] if len(row) > 5 else None
        cue = CueDef(name, game, fn, tuple(args), tuple(aliases), word, CUE_FNS[(game, fn)])
        CUES.append(cue)
        for n in (name,) + tuple(aliases):
            key = (game, n.lower())
            if key not in CUE_BY_NAME:
                CUE_BY_NAME[key] = cue
            CUE_SHORT.setdefault(n.lower(), [])
            if cue not in CUE_SHORT[n.lower()]:
                CUE_SHORT[n.lower()].append(cue)
        sig = (game, fn, _pad4(args), word)
        if sig not in CUE_BY_SIG:
            CUE_BY_SIG[sig] = cue
        if (game, fn) not in CUE_BY_FN:
            CUE_BY_FN[(game, fn)] = cue


_register_cues()

RESERVED = {
    "title", "prologue", "jingle", "start", "match", "end", "finish", "results",
    "rest", "at", "switch", "loop", "def", "call", "fade", "anim", "first",
    "bgm", "translen", "swing", "ticks_per_beat", "cue", "hard", "cut",
    "tempo", "gtlm",
}


class GtfError(Exception):
    def __init__(self, message: str, line: Optional[int] = None, path: Optional[str] = None):
        self.message = message
        self.line = line
        self.path = path
        loc = ""
        if path and line:
            loc = f"{path}:{line}: "
        elif line:
            loc = f"linea {line}: "
        elif path:
            loc = f"{path}: "
        super().__init__(loc + message)


def parse_int(s: str) -> int:
    t = s.strip()
    if not t:
        raise ValueError("numero vacio")
    neg = False
    if t[0] in "+-":
        neg = t[0] == "-"
        t = t[1:]
        if not t:
            raise ValueError(s)
    if t.lower().startswith("0x"):
        if len(t) == 2:
            raise ValueError(s)
        v = int(t, 16)
    else:
        if not t.isdigit():
            raise ValueError(s)
        v = int(t, 10)
    if neg:
        v = -v
    if v < -0x80000000 or v > 0x7FFFFFFF:
        raise ValueError("fuera de rango")
    return v


def is_int_token(s: str) -> bool:
    try:
        parse_int(s)
        return True
    except ValueError:
        return False


def parse_duration(s: str, what: str = "duracion") -> int:
    """Parse a beat duration (or Nt ticks) into ticks. Supports 1, 0.5, 1.5, 1/3, 240t."""
    t = s.strip()
    if not t:
        raise ValueError(f"{what} vacia")
    if t[-1] in "tT" and t.lower() != "t":
        try:
            return parse_int(t[:-1])
        except ValueError as e:
            raise ValueError(f"{what} en ticks invalida: {s}") from e
    try:
        if "/" in t:
            n, d = t.split("/", 1)
            frac = Fraction(n.strip()) / Fraction(d.strip())
        else:
            frac = Fraction(t)
    except (ValueError, ZeroDivisionError) as e:
        raise ValueError(f"{what} invalida: {s}") from e
    ticks = frac * TPB
    if ticks.denominator != 1:
        nearest = round(float(ticks))
        if abs(ticks - nearest) < Fraction(1, 10000):
            return int(nearest)
        raise ValueError(
            f"{what} {s} no cae en un tick entero ({float(ticks):.4f} ticks; 1 pulso = 480)"
        )
    v = int(ticks)
    if v < 0:
        raise ValueError(f"{what} no puede ser negativa: {s}")
    return v


def format_beats(ticks: int) -> str:
    if ticks == 0:
        return "0"
    sign = "-" if ticks < 0 else ""
    ticks = abs(ticks)
    if ticks % TPB == 0:
        return sign + str(ticks // TPB)
    fr = Fraction(ticks, TPB)
    if fr.denominator == 2:
        return sign + f"{fr.numerator / 2:.1f}"
    if fr.denominator == 4:
        return sign + f"{float(fr):.2f}"
    if fr.denominator in (3, 6, 8, 12, 16):
        return sign + f"{fr.numerator}/{fr.denominator}"
    return sign + f"{ticks}t"


def valid_name(s: str, max_len: int = 47) -> bool:
    if not s or len(s) > max_len:
        return False
    return all(c.isalnum() or c == "_" for c in s)


def canonical_game(name: str) -> Optional[str]:
    if not name:
        return None
    up = name.upper()
    if up in GAMES:
        return up
    key = name.lower().replace(" ", "").replace(",", "").replace("'", "").replace("-", "")
    return GAME_ALIASES.get(key)


@dataclass
class Event:
    tick: int
    op: str  # call, switch, fade, anim
    game: Optional[str] = None
    style: int = 0
    sub: int = 2
    fn: Optional[int] = None
    args: tuple = (0, 0, 0, 0)
    word: Optional[str] = None
    tag: Optional[str] = None
    fade_len: int = 0
    alpha: float = 0.0
    layout: int = 0
    anim_name: Optional[str] = None


@dataclass
class Timeline:
    ticks_per_beat: int = TPB
    bgm: int = 0x8B
    start: int = 0
    translen: int = 960
    swing: int = 120
    end: int = -1
    end_fade: int = 960
    finish: int = -1
    results: int = 1
    match: tuple = (-1, 9, 4)
    first: Optional[str] = None
    title: str = ""
    prologue: str = ""
    jingle: int = -1
    events: list = field(default_factory=list)
    source: str = ""

    def games_used(self) -> list:
        order: list[str] = []
        if self.first:
            order.append(self.first)
        for e in self.events:
            if e.game and e.game not in order:
                order.append(e.game)
        return order


def strip_comment(line: str) -> str:
    """Remove # or // comments, respecting double-quoted strings."""
    out = []
    i = 0
    in_str = False
    while i < len(line):
        c = line[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < len(line):
                out.append(line[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "#" or (c == "/" and i + 1 < len(line) and line[i + 1] == "/"):
            break
        out.append(c)
        i += 1
    return "".join(out).rstrip()


def tokenize(line: str) -> list[str]:
    toks: list[str] = []
    i, n = 0, len(line)
    while i < n:
        while i < n and line[i] in " \t\r":
            i += 1
        if i >= n:
            break
        if line[i] == '"':
            j = i + 1
            buf = ['"']
            while j < n:
                if line[j] == "\\" and j + 1 < n:
                    buf.append(line[j:j + 2])
                    j += 2
                    continue
                buf.append(line[j])
                if line[j] == '"':
                    j += 1
                    break
                j += 1
            else:
                raise ValueError("comillas sin cerrar")
            toks.append("".join(buf))
            i = j
        else:
            j = i
            while j < n and line[j] not in " \t\r":
                j += 1
            toks.append(line[i:j])
            i = j
    return toks


def unquote(tok: str) -> str:
    if len(tok) >= 2 and tok[0] == '"' and tok[-1] == '"':
        return tok[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return tok


def parse_gtl(text: str, path: str = "") -> Timeline:
    tl = Timeline(start=2880, source=path)
    lines = text.splitlines()
    header = False
    last = 0
    for line_no, raw in enumerate(lines, 1):
        cut = raw.split("#", 1)[0]
        if header and cut.lstrip().lower().startswith("title") and (
            len(cut.lstrip()) == 5 or cut.lstrip()[5] in " \t"
        ):
            tl.title = cut.lstrip()[5:].strip()[:TITLE_MAX]
            continue
        parts = cut.split()
        if not parts:
            continue
        if not header:
            if parts[0] != "GTLM" or len(parts) < 2 or parts[1] != "1":
                raise GtfError("falta la cabecera 'GTLM 1'", line_no, path)
            header = True
            continue
        k = parts[0]
        try:
            if k == "ticks_per_beat":
                v = parse_int(parts[1]) if len(parts) > 1 else -1
                if v != TPB:
                    raise GtfError("ticks_per_beat debe ser 480", line_no, path)
            elif k == "bgm":
                tl.bgm = parse_int(parts[1])
                if tl.bgm < 0 or tl.bgm > 0xFFFF:
                    raise GtfError("bgm invalido", line_no, path)
            elif k == "start":
                tl.start = parse_int(parts[1])
                if tl.start < 0:
                    raise GtfError("start invalido", line_no, path)
            elif k == "translen":
                tl.translen = parse_int(parts[1])
                if tl.translen < 0 or tl.translen > 7680:
                    raise GtfError("translen invalido", line_no, path)
            elif k == "swing":
                tl.swing = parse_int(parts[1])
            elif k == "results":
                if len(parts) < 2:
                    raise GtfError("results native|exit", line_no, path)
                if parts[1] == "native":
                    tl.results = 1
                elif parts[1] in ("exit", "custom"):
                    tl.results = 0
                else:
                    raise GtfError("results native|exit", line_no, path)
            elif k == "prologue":
                if len(parts) < 2 or len(parts[1]) > PROLOGUE_MAX:
                    raise GtfError("prologue type_XX|ruta", line_no, path)
                tl.prologue = parts[1]
            elif k == "jingle":
                try:
                    j = parse_int(parts[1]) if len(parts) > 1 else -1
                except ValueError:
                    j = -1
                tl.jingle = j if JINGLE_MIN <= j <= JINGLE_MAX else -1
            elif k == "match":
                if len(parts) < 4:
                    raise GtfError("match WORLD COL ROW", line_no, path)
                tl.match = (parse_int(parts[1]), parse_int(parts[2]), parse_int(parts[3]))
            elif k == "end":
                tl.end = parse_int(parts[1])
                if len(parts) > 2:
                    tl.end_fade = parse_int(parts[2])
            elif k == "finish":
                tl.finish = parse_int(parts[1])
            elif k == "first":
                g = canonical_game(parts[1]) if len(parts) > 1 else None
                if not g:
                    raise GtfError("juego desconocido", line_no, path)
                tl.first = g
            elif k in ("X", "W", "F", "A"):
                if len(tl.events) >= MAX_EVENTS:
                    raise GtfError("demasiados eventos", line_no, path)
                if len(parts) < 2:
                    raise GtfError("falta el tick", line_no, path)
                tick = parse_int(parts[1])
                if tick < 0:
                    raise GtfError("tick invalido", line_no, path)
                if tick < last:
                    raise GtfError("los eventos deben ir ordenados por tick", line_no, path)
                ev = Event(tick=tick, op="")
                if k == "F":
                    if len(parts) < 4:
                        raise GtfError("F TICK TICKS ALPHA(0..1)", line_no, path)
                    ev.op = "fade"
                    ev.fade_len = parse_int(parts[2])
                    ev.alpha = float(parts[3])
                    if ev.fade_len < 0 or not (0.0 <= ev.alpha <= 1.0):
                        raise GtfError("F TICK TICKS ALPHA(0..1)", line_no, path)
                else:
                    g = canonical_game(parts[2]) if len(parts) > 2 else None
                    if not g:
                        raise GtfError(
                            f"juego desconocido {parts[2] if len(parts) > 2 else '?'}",
                            line_no, path,
                        )
                    ev.game = g
                    if k == "X":
                        if len(parts) < 4:
                            raise GtfError("X TICK JUEGO FN [a b c d] [etiqueta]", line_no, path)
                        off = parse_int(parts[3])
                        if (g, off) not in CUE_FNS:
                            raise GtfError(
                                f"la funcion 0x{off:X} no es un cue permitido de {g}",
                                line_no, path,
                            )
                        ev.op = "call"
                        ev.fn = off
                        ti = 4
                        word = None
                        if CUE_FNS[(g, off)] == 1:
                            if len(parts) < 5:
                                raise GtfError(f"{g} necesita una palabra (TEA|SODA|COCOA|AAA)", line_no, path)
                            w = parts[4]
                            if w not in THE_A_WORDS:
                                raise GtfError("la palabra debe ser TEA|SODA|COCOA|AAA", line_no, path)
                            word = w
                            ti = 5
                        ev.word = word
                        args: list[int] = []
                        while ti < len(parts) and len(args) < 4:
                            try:
                                args.append(parse_int(parts[ti]))
                                ti += 1
                            except ValueError:
                                break
                        ev.args = _pad4(args)
                        if ti < len(parts):
                            if ti != len(parts) - 1 or not valid_name(parts[ti]):
                                raise GtfError("argumento/etiqueta invalido", line_no, path)
                            if parts[ti] != "-":
                                ev.tag = parts[ti]
                    elif k == "W":
                        ev.op = "switch"
                        ev.sub = 2
                        if len(parts) > 3:
                            if parts[3] in ("cut", "hard"):
                                ev.style = -1
                            else:
                                st = parse_int(parts[3])
                                if st < 0 or st > 2:
                                    raise GtfError("estilo cut|0|1|2", line_no, path)
                                ev.style = st
                        else:
                            ev.style = 0
                        if len(parts) > 4:
                            sb = parse_int(parts[4])
                            if sb < 1 or sb > 2:
                                raise GtfError("sub 1|2", line_no, path)
                            ev.sub = sb
                    else:
                        if len(parts) < 5:
                            raise GtfError("A TICK JUEGO LAYOUT NOMBRE", line_no, path)
                        ev.op = "anim"
                        ev.layout = parse_int(parts[3])
                        if ev.layout < 0x100 or ev.layout > 0x10000 or (ev.layout & 7) or not valid_name(parts[4]):
                            raise GtfError("A TICK JUEGO LAYOUT NOMBRE", line_no, path)
                        ev.anim_name = parts[4]
                tl.events.append(ev)
                last = ev.tick
            else:
                raise GtfError(f"clave desconocida '{k}'", line_no, path)
        except GtfError:
            raise
        except (ValueError, IndexError) as e:
            raise GtfError(f"no se pudo leer la linea ({e})", line_no, path) from e
    if not header:
        raise GtfError("archivo vacio (falta GTLM 1)", path=path)
    _finalize_timeline(tl, path, auto_end=False)
    return tl


def _finalize_timeline(tl: Timeline, path: str, auto_end: bool) -> None:
    if not tl.events:
        raise GtfError("no hay eventos (hace falta al menos un cue)", path=path)
    if sum(1 for e in tl.events if e.op == "call") == 0:
        raise GtfError("no hay llamadas de cue", path=path)
    games = tl.games_used()
    if not games:
        raise GtfError("no se usa ningun juego", path=path)
    if len(games) > MAX_GAMES:
        raise GtfError(f"mas de {MAX_GAMES} juegos", path=path)
    if tl.first is None:
        tl.first = games[0]
    last = tl.events[-1].tick
    if auto_end:
        if tl.end <= 0:
            tl.end = last + 4 * TPB
        if tl.finish < tl.end:
            tl.finish = tl.end + 4 * TPB
    if tl.end <= 0:
        raise GtfError("falta end", path=path)
    if tl.finish < tl.end:
        raise GtfError("falta finish o es anterior a end", path=path)
    if tl.start > tl.end:
        raise GtfError("start es posterior a end", path=path)
    if last > tl.end:
        raise GtfError(f"hay eventos despues de end ({last} > {tl.end})", path=path)


@dataclass
class SrcLine:
    no: int
    raw: str
    toks: list[str]


def _read_gtf_lines(text: str, path: str) -> list[SrcLine]:
    out: list[SrcLine] = []
    for no, raw in enumerate(text.splitlines(), 1):
        try:
            body = strip_comment(raw)
        except ValueError as e:
            raise GtfError(str(e), no, path) from e
        if not body.strip():
            continue
        try:
            toks = tokenize(body.strip())
        except ValueError as e:
            raise GtfError(str(e), no, path) from e
        if toks:
            out.append(SrcLine(no, raw, toks))
    return out


def compile_gtf(text: str, path: str = "") -> Timeline:
    lines = _read_gtf_lines(text, path)
    defs, body = _extract_defs(lines, path)
    tl = Timeline(start=0, source=path)
    clock = 0
    game: Optional[str] = None
    end_set = False
    finish_set = False
    call_stack: list[str] = []

    def apply_header(toks: list[str], no: int) -> bool:
        nonlocal end_set, finish_set
        k = toks[0].lower()
        if k == "title":
            tl.title = " ".join(unquote(t) for t in toks[1:])[:TITLE_MAX]
            return True
        if k == "prologue":
            if len(toks) < 2:
                raise GtfError("prologue type_XX|ruta", no, path)
            val = unquote(toks[1])
            if len(val) > PROLOGUE_MAX:
                raise GtfError("prologue demasiado largo", no, path)
            tl.prologue = val
            return True
        if k == "jingle":
            if len(toks) < 2:
                raise GtfError("jingle 0x158..0x16C", no, path)
            try:
                j = parse_int(toks[1])
            except ValueError as e:
                raise GtfError(f"jingle invalido: {toks[1]}", no, path) from e
            if j < JINGLE_MIN or j > JINGLE_MAX:
                raise GtfError(
                    f"jingle {toks[1]} fuera de rango (0x{JINGLE_MIN:X}..0x{JINGLE_MAX:X})",
                    no, path,
                )
            tl.jingle = j
            return True
        if k == "start":
            if len(toks) < 2:
                raise GtfError("falta el valor de start", no, path)
            try:
                tl.start = parse_duration(toks[1], "start")
            except ValueError as e:
                raise GtfError(str(e), no, path) from e
            if tl.start < 0:
                raise GtfError("start no puede ser negativo", no, path)
            return True
        if k == "translen":
            if len(toks) < 2:
                raise GtfError("falta el valor de translen", no, path)
            try:
                tl.translen = parse_duration(toks[1], "translen")
            except ValueError as e:
                raise GtfError(str(e), no, path) from e
            if tl.translen < 0 or tl.translen > 7680:
                raise GtfError("translen debe estar entre 0 y 16 pulsos (7680 ticks)", no, path)
            return True
        if k == "swing":
            if len(toks) < 2:
                raise GtfError("falta el valor de swing", no, path)
            try:
                tl.swing = parse_int(toks[1])
            except ValueError as e:
                raise GtfError(f"swing invalido: {toks[1]}", no, path) from e
            return True
        if k == "ticks_per_beat":
            if len(toks) < 2 or not is_int_token(toks[1]) or parse_int(toks[1]) != TPB:
                raise GtfError("ticks_per_beat debe ser 480", no, path)
            return True
        if k == "bgm":
            if len(toks) < 2:
                raise GtfError("falta el valor de bgm", no, path)
            try:
                tl.bgm = parse_int(toks[1])
            except ValueError as e:
                raise GtfError(f"bgm invalido: {toks[1]}", no, path) from e
            if tl.bgm < 0 or tl.bgm > 0xFFFF:
                raise GtfError("bgm fuera de rango", no, path)
            return True
        if k == "results":
            if len(toks) < 2:
                raise GtfError("results native|exit|custom", no, path)
            v = toks[1].lower()
            if v == "native":
                tl.results = 1
            elif v in ("exit", "custom"):
                tl.results = 0
            else:
                raise GtfError("results native|exit|custom", no, path)
            return True
        if k == "match":
            if len(toks) < 4:
                raise GtfError("match WORLD COL ROW", no, path)
            try:
                tl.match = (parse_int(toks[1]), parse_int(toks[2]), parse_int(toks[3]))
            except ValueError as e:
                raise GtfError("match WORLD COL ROW (enteros)", no, path) from e
            return True
        if k == "first":
            if len(toks) < 2:
                raise GtfError("first JUEGO", no, path)
            g = canonical_game(toks[1])
            if not g:
                raise GtfError(f"juego desconocido '{toks[1]}'", no, path)
            tl.first = g
            nonlocal game
            if game is None:
                game = g
            return True
        if k == "end" and len(toks) >= 2:
            try:
                tl.end = parse_duration(toks[1], "end")
                if len(toks) > 2:
                    tl.end_fade = parse_duration(toks[2], "fade de end")
            except ValueError as e:
                raise GtfError(str(e), no, path) from e
            end_set = True
            return True
        if k == "finish" and len(toks) >= 2:
            try:
                tl.finish = parse_duration(toks[1], "finish")
            except ValueError as e:
                raise GtfError(str(e), no, path) from e
            finish_set = True
            return True
        if k == "tempo":
            raise GtfError(
                "tempo no se aplica: el juego sigue el tempo de su propia cancion (bgm)",
                no, path,
            )
        return False

    def add_event(ev: Event, no: int) -> None:
        if ev.tick < 0:
            raise GtfError("tick negativo", no, path)
        if tl.events and ev.tick < tl.events[-1].tick:
            raise GtfError(
                f"el evento queda en el tick {ev.tick}, anterior al ultimo ({tl.events[-1].tick})",
                no, path,
            )
        if len(tl.events) >= MAX_EVENTS:
            raise GtfError(f"demasiados eventos (maximo {MAX_EVENTS})", no, path)
        tl.events.append(ev)

    def emit_block(block: list[SrcLine], local_game: Optional[str]) -> Optional[str]:
        nonlocal clock, game
        game = local_game
        i = 0
        while i < len(block):
            sl = block[i]
            toks = sl.toks
            k = toks[0].lower()
            if apply_header(toks, sl.no):
                i += 1
                continue
            if k == "rest":
                if len(toks) < 2:
                    raise GtfError("rest <pulsos>  (ej. rest 1, rest 0.5, rest 1/3, rest 240t)", sl.no, path)
                try:
                    dt = parse_duration(toks[1], "rest")
                except ValueError as e:
                    raise GtfError(str(e), sl.no, path) from e
                clock += dt
                i += 1
                continue
            if k == "at":
                if len(toks) < 2:
                    raise GtfError("at <pulso absoluto>", sl.no, path)
                try:
                    target = parse_duration(toks[1], "at")
                except ValueError as e:
                    raise GtfError(str(e), sl.no, path) from e
                if target < clock:
                    raise GtfError(
                        f"at {toks[1]} (tick {target}) va hacia atras; "
                        f"el reloj esta en {format_beats(clock)} (tick {clock})",
                        sl.no, path,
                    )
                clock = target
                i += 1
                continue
            if k == "switch":
                if len(toks) < 2:
                    raise GtfError("switch JUEGO [cut|hard|0|1|2] [1|2]", sl.no, path)
                g = canonical_game(toks[1])
                if not g:
                    raise GtfError(f"juego desconocido '{toks[1]}'", sl.no, path)
                style, sub = 0, 2
                if len(toks) > 2:
                    if toks[2].lower() in ("cut", "hard"):
                        style = -1
                    else:
                        try:
                            style = parse_int(toks[2])
                        except ValueError as e:
                            raise GtfError("estilo cut|hard|0|1|2", sl.no, path) from e
                        if style < 0 or style > 2:
                            raise GtfError("estilo cut|hard|0|1|2", sl.no, path)
                if len(toks) > 3:
                    try:
                        sub = parse_int(toks[3])
                    except ValueError as e:
                        raise GtfError("sub 1|2", sl.no, path) from e
                    if sub < 1 or sub > 2:
                        raise GtfError("sub 1|2", sl.no, path)
                add_event(Event(tick=clock, op="switch", game=g, style=style, sub=sub), sl.no)
                game = g
                i += 1
                continue
            if k == "loop":
                if len(toks) < 2:
                    raise GtfError("loop <veces>", sl.no, path)
                try:
                    count = parse_int(toks[1])
                except ValueError as e:
                    raise GtfError("loop necesita un entero (ej. loop 3)", sl.no, path) from e
                if count < 1:
                    raise GtfError("loop necesita un entero >= 1", sl.no, path)
                inner, end_i = _collect_block(block, i + 1, sl.no, path, "loop")
                for _ in range(count):
                    game = emit_block(inner, game)
                i = end_i + 1
                continue
            if k == "call":
                if len(toks) < 2:
                    raise GtfError("call <nombre>", sl.no, path)
                name = toks[1]
                if name not in defs:
                    raise GtfError(f"no hay un def '{name}'", sl.no, path)
                if name in call_stack:
                    raise GtfError(
                        f"llamada recursiva a '{name}' ({' -> '.join(call_stack + [name])})",
                        sl.no, path,
                    )
                call_stack.append(name)
                game = emit_block(defs[name], game)
                call_stack.pop()
                i += 1
                continue
            if k == "def":
                raise GtfError("un def no puede ir anidado (ni dentro de un loop)", sl.no, path)
            if k == "end" and len(toks) == 1:
                tl.end = clock
                end_set = True
                i += 1
                continue
            if k == "finish" and len(toks) == 1:
                tl.finish = clock
                finish_set = True
                i += 1
                continue
            if k == "fade":
                if len(toks) < 3:
                    raise GtfError("fade <duracion> <alpha 0..1>", sl.no, path)
                try:
                    dur = parse_duration(toks[1], "fade")
                except ValueError as e:
                    raise GtfError(str(e), sl.no, path) from e
                try:
                    alpha = float(Fraction(toks[2])) if "/" in toks[2] else float(toks[2])
                except ValueError as e:
                    raise GtfError(f"alpha invalida: {toks[2]}", sl.no, path) from e
                if alpha < 0.0 or alpha > 1.0:
                    raise GtfError("alpha debe estar entre 0 y 1", sl.no, path)
                add_event(Event(tick=clock, op="fade", fade_len=dur, alpha=alpha), sl.no)
                i += 1
                continue
            if k == "anim":
                rest = toks[1:]
                if not rest:
                    raise GtfError("anim [JUEGO] NOMBRE [layout]", sl.no, path)
                ag = None
                if canonical_game(rest[0]):
                    ag = canonical_game(rest[0])
                    rest = rest[1:]
                if not rest:
                    raise GtfError("anim [JUEGO] NOMBRE [layout]", sl.no, path)
                aname = rest[0]
                if not valid_name(aname):
                    raise GtfError(f"nombre de animacion invalido: {aname}", sl.no, path)
                layout = None
                if len(rest) > 1:
                    try:
                        layout = parse_int(rest[1])
                    except ValueError as e:
                        raise GtfError(f"layout invalido: {rest[1]}", sl.no, path) from e
                g = ag or game
                if not g:
                    raise GtfError("anim necesita un juego (pon switch JUEGO o anim JUEGO NOMBRE)", sl.no, path)
                if layout is None:
                    if g not in LAYOUT_OFF:
                        raise GtfError(
                            f"no hay layout por defecto para {g}; indica el offset "
                            f"(ej. anim {g} {aname} 0x3E08)",
                            sl.no, path,
                        )
                    layout = LAYOUT_OFF[g]
                if layout < 0x100 or layout > 0x10000 or (layout & 7):
                    raise GtfError("layout fuera de rango o no alineado a 8", sl.no, path)
                add_event(Event(tick=clock, op="anim", game=g, layout=layout, anim_name=aname), sl.no)
                i += 1
                continue
            cue_toks = toks
            if k == "cue":
                if len(toks) < 2:
                    raise GtfError("cue <nombre> [args] [etiqueta]", sl.no, path)
                cue_toks = toks[1:]
            ev = parse_cue_line(cue_toks, game, sl.no, path)
            ev.tick = clock
            add_event(ev, sl.no)
            i += 1
        return game

    emit_block(body, None)
    if tl.first is None:
        for e in tl.events:
            if e.op in ("switch", "call", "anim") and e.game:
                tl.first = e.game
                break
    _finalize_timeline(tl, path, auto_end=True)
    return tl


def _extract_defs(lines: list[SrcLine], path: str) -> tuple[dict[str, list[SrcLine]], list[SrcLine]]:
    defs: dict[str, list[SrcLine]] = {}
    body: list[SrcLine] = []
    i = 0
    while i < len(lines):
        sl = lines[i]
        if sl.toks[0].lower() == "def":
            if len(sl.toks) < 2 or not valid_name(sl.toks[1]):
                raise GtfError("def necesita un nombre (letras, numeros o _)", sl.no, path)
            name = sl.toks[1]
            if name.lower() in RESERVED or canonical_game(name):
                raise GtfError(f"'{name}' es una palabra reservada; elige otro nombre de def", sl.no, path)
            if name in defs:
                raise GtfError(f"def '{name}' ya esta definido", sl.no, path)
            inner, end_i = _collect_block(lines, i + 1, sl.no, path, "def")
            for inner_sl in inner:
                if inner_sl.toks[0].lower() == "def":
                    raise GtfError("un def no puede ir anidado", inner_sl.no, path)
            defs[name] = inner
            i = end_i + 1
            continue
        body.append(sl)
        i += 1
    return defs, body


def _collect_block(lines: list[SrcLine], start: int, open_no: int, path: str, kind: str) -> tuple[list[SrcLine], int]:
    inner: list[SrcLine] = []
    depth = 1
    i = start
    while i < len(lines):
        k = lines[i].toks[0].lower()
        if k in ("loop", "def"):
            depth += 1
            inner.append(lines[i])
        elif k == "end" and len(lines[i].toks) == 1:
            depth -= 1
            if depth == 0:
                return inner, i
            inner.append(lines[i])
        else:
            inner.append(lines[i])
        i += 1
    raise GtfError(f"falta 'end' para el {kind} de la linea {open_no}", open_no, path)


def parse_cue_line(toks: list[str], current_game: Optional[str], no: int, path: str) -> Event:
    if not toks:
        raise GtfError("falta el nombre del cue", no, path)
    raw = toks[0]
    game = None
    name = raw
    if "." in raw:
        left, right = raw.split(".", 1)
        g = canonical_game(left)
        if not g:
            raise GtfError(f"juego desconocido '{left}' en '{raw}'", no, path)
        game = g
        name = right
    fn_direct = None
    if name.lower().startswith("0x") and is_int_token(name):
        fn_direct = parse_int(name)

    rest = toks[1:]
    tag = None
    if rest and not is_int_token(rest[-1]) and valid_name(rest[-1]):
        tag = rest[-1]
        rest = rest[:-1]
    int_args: list[int] = []
    word_tok = None
    for t in rest:
        if t.upper() in THE_A_WORDS and word_tok is None and not is_int_token(t):
            word_tok = t.upper()
            continue
        if is_int_token(t):
            int_args.append(parse_int(t))
        else:
            raise GtfError(f"argumento invalido: {t}", no, path)

    if fn_direct is not None:
        g = game or current_game
        if not g:
            raise GtfError(
                f"indica el juego de 0x{fn_direct:X} "
                f"(ej. {current_game or 'KAERU'}.0x{fn_direct:X} o un switch antes)",
                no, path,
            )
        if (g, fn_direct) not in CUE_FNS:
            raise GtfError(f"la funcion 0x{fn_direct:X} no es un cue permitido de {g}", no, path)
        ev = Event(tick=0, op="call", game=g, fn=fn_direct, args=_pad4(int_args), tag=tag)
        if CUE_FNS[(g, fn_direct)] == 1:
            w = word_tok
            if w is None and ev.tag and ev.tag.upper() in THE_A_WORDS:
                w = ev.tag.upper()
                ev.tag = None
            if w is None:
                raise GtfError(f"{g} necesita una palabra (TEA|SODA|COCOA|AAA, o tea/soda/cocoa/aaa)", no, path)
            ev.word = w
        elif word_tok:
            raise GtfError(f"este cue no admite la palabra {word_tok}", no, path)
        return ev

    cue = resolve_cue(name, game or current_game, no, path)
    ev = Event(tick=0, op="call", game=cue.game, fn=cue.fn, tag=tag, word=cue.word)
    if cue.kind == 1:
        if word_tok:
            ev.word = word_tok
        ev.args = _pad4(int_args) if int_args else (0, 0, 0, 0)
    else:
        if word_tok:
            raise GtfError(f"este cue no admite la palabra {word_tok}", no, path)
        ev.args = _pad4(int_args) if int_args else _pad4(cue.args)
    return ev


def resolve_cue(name: str, current_game: Optional[str], no: int, path: str) -> CueDef:
    key_name = name.lower()
    if current_game:
        hit = CUE_BY_NAME.get((current_game, key_name))
        if hit:
            return hit
    cands = CUE_SHORT.get(key_name, [])
    if current_game:
        scoped = [c for c in cands if c.game == current_game]
        if scoped:
            return scoped[0]
        if cands:
            opts = " / ".join(sorted({c.game + "." + c.name for c in cands}))
            raise GtfError(
                f"'{name}' no es un cue de {current_game}. Prueba {opts}",
                no, path,
            )
        raise GtfError(
            f"cue desconocido '{name}' en {current_game}. "
            f"Usa 'python3 gtf.py cues' para ver los nombres, o {current_game}.0x....",
            no, path,
        )
    games = sorted({c.game for c in cands})
    if len(games) == 1:
        exact = [c for c in cands if c.name.lower() == key_name or key_name in {a.lower() for a in c.aliases}]
        return exact[0] if exact else cands[0]
    if len(games) > 1:
        opts = ", ".join(f"{c.game}.{c.name}" for c in cands)
        raise GtfError(
            f"'{name}' es ambiguo ({', '.join(games)}). Escribe {opts}, o pon un switch antes",
            no, path,
        )
    raise GtfError(
        f"cue desconocido '{name}'. Usa 'python3 gtf.py cues' para ver los nombres, "
        f"o JUEGO.0x.... / un switch antes",
        no, path,
    )


def emit_gtl(tl: Timeline, origin: str = "") -> str:
    lines = ["GTLM 1"]
    src = origin or tl.source or "Groove Tickflow"
    lines.append(f"# Generado por gtf.py v{VERSION} (Groove Tickflow) desde {Path(src).name or src}.")
    lines.append("# Solo datos de tiempo. 480 ticks por pulso; tick 0 = pulso 0 del remix.")
    games = tl.games_used()
    lines.append("# Juegos: " + " ".join(games))
    lines.append(f"ticks_per_beat {TPB}")
    lines.append(f"bgm {tl.bgm}")
    lines.append("results " + ("native" if tl.results == 1 else "exit"))
    lines.append(f"match {tl.match[0]} {tl.match[1]} {tl.match[2]}")
    if tl.title:
        lines.append(f"title {tl.title}")
    if tl.prologue:
        lines.append(f"prologue {tl.prologue}")
    if tl.jingle >= 0:
        lines.append(f"jingle 0x{tl.jingle:X}")
    lines.append(f"start {tl.start}")
    lines.append(f"translen {tl.translen}")
    if tl.swing != 120:
        lines.append(f"swing {tl.swing}")
    lines.append(f"first {tl.first}")
    lines.append(f"end {tl.end} {tl.end_fade}")
    lines.append(f"finish {tl.finish}")
    lines.append("# --- eventos")
    for e in tl.events:
        if e.op == "call":
            bits = [f"X {e.tick} {e.game} 0x{e.fn:X}"]
            if e.word:
                bits.append(e.word)
                args = list(e.args)
                while args and args[-1] == 0:
                    args.pop()
                bits.extend(str(a) for a in args)
            else:
                bits.extend(_emit_args(e.game, e.fn, e.args))
            if e.tag:
                bits.append(e.tag)
            lines.append(" ".join(bits))
        elif e.op == "switch":
            bits = [f"W {e.tick} {e.game}"]
            if e.style == -1:
                bits.append("cut")
            elif e.style != 0:
                bits.append(str(e.style))
            if e.sub != 2:
                if e.style == 0:
                    bits.append("0")
                bits.append(str(e.sub))
            lines.append(" ".join(bits))
        elif e.op == "fade":
            alpha = e.alpha
            if abs(alpha - round(alpha, 1)) < 1e-6:
                a = f"{alpha:.1f}"
            elif abs(alpha - round(alpha, 2)) < 1e-6:
                a = f"{alpha:.2f}"
            else:
                a = repr(alpha)
            lines.append(f"F {e.tick} {e.fade_len} {a}")
        elif e.op == "anim":
            lines.append(f"A {e.tick} {e.game} 0x{e.layout:X} {e.anim_name}")
        else:
            raise GtfError(f"operacion interna desconocida: {e.op}")
    lines.append("")
    return "\n".join(lines)


def _emit_args(game: str, fn: int, args: tuple) -> list[str]:
    padded = list(_pad4(args))
    default_len = 0
    base = CUE_BY_FN.get((game, fn))
    for cue in CUES:
        if cue.game == game and cue.fn == fn and _pad4(cue.args) == tuple(padded) and cue.word is None:
            default_len = len(cue.args)
            break
    if default_len == 0 and base is not None:
        default_len = len(base.args)
    last = 0
    for i, v in enumerate(padded):
        if v != 0:
            last = i + 1
    n = max(default_len, last)
    return [str(padded[i]) for i in range(n)]


def lookup_cue(game: str, fn: int, args: tuple, word: Optional[str]) -> tuple:
    sig = (game, fn, _pad4(args), word)
    if sig in CUE_BY_SIG:
        return CUE_BY_SIG[sig], True
    if word:
        for c in CUES:
            if c.game == game and c.fn == fn and c.word == word:
                return c, _pad4(c.args) == _pad4(args)
    if (game, fn) in CUE_BY_FN:
        return CUE_BY_FN[(game, fn)], False
    raise GtfError(f"no hay nombre de cue para {game} 0x{fn:X}")


def needed_args(cue: CueDef, args: tuple, exact: bool) -> list[int]:
    if exact:
        return []
    padded = list(_pad4(args))
    if padded == list(_pad4(cue.args)):
        return []
    last = 0
    for i, v in enumerate(padded):
        if v != 0:
            last = i + 1
    n = max(last, len(cue.args))
    return padded[:n]


def decompile_to_gtf(tl: Timeline, origin: str = "") -> str:
    src = origin or tl.source or "timeline.gtl"
    out: list[str] = []
    out.append(f"# Descompilado por gtf.py v{VERSION} (Groove Tickflow) desde {Path(src).name}.")
    out.append("# 1 pulso = 480 ticks. rest avanza el reloj; switch y cues ocurren en el pulso actual.")
    out.append("")
    if tl.title:
        q = tl.title.replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'title "{q}"')
    if tl.prologue:
        out.append(f"prologue {tl.prologue}")
    if tl.jingle >= 0:
        out.append(f"jingle 0x{tl.jingle:X}")
    out.append(f"bgm {tl.bgm}")
    out.append("results " + ("native" if tl.results == 1 else "exit"))
    out.append(f"match {tl.match[0]} {tl.match[1]} {tl.match[2]}")
    out.append(f"start {format_beats(tl.start)}")
    out.append(f"translen {format_beats(tl.translen)}")
    if tl.swing != 120:
        out.append(f"swing {tl.swing}")
    if tl.first:
        out.append(f"first {tl.first}")
    end_line = f"end {format_beats(tl.end)}"
    if tl.end_fade != 960:
        end_line += f" {format_beats(tl.end_fade)}"
    out.append(end_line)
    out.append(f"finish {format_beats(tl.finish)}")
    out.append("")

    clock = 0
    game = tl.first
    for e in tl.events:
        if e.tick > clock:
            out.append(f"rest {format_beats(e.tick - clock)}")
            clock = e.tick
        if e.op == "switch":
            bits = [f"switch {e.game}"]
            if e.style == -1:
                bits.append("cut")
            elif e.style != 0:
                bits.append(str(e.style))
            if e.sub != 2:
                if e.style == 0:
                    bits.append("0")
                bits.append(str(e.sub))
            out.append(" ".join(bits))
            game = e.game
        elif e.op == "call":
            cue, exact = lookup_cue(e.game, e.fn, e.args, e.word)
            qualify = e.game != game
            short = cue.name
            prefix = f"{e.game}." if qualify else ""
            bits = [f"{prefix}{short}"]
            bits.extend(str(a) for a in needed_args(cue, e.args, exact))
            if e.tag:
                bits.append(e.tag)
            out.append(" ".join(bits))
        elif e.op == "fade":
            a = f"{e.alpha:g}"
            out.append(f"fade {format_beats(e.fade_len)} {a}")
        elif e.op == "anim":
            bits = ["anim"]
            if e.game != game:
                bits.append(e.game)
            bits.append(e.anim_name or "anim")
            default = LAYOUT_OFF.get(e.game)
            if default is None or e.layout != default:
                bits.append(f"0x{e.layout:X}")
            out.append(" ".join(bits))
    out.append("")
    return "\n".join(out)


def timelines_equal(a: Timeline, b: Timeline) -> list[str]:
    diffs: list[str] = []

    def chk(name, x, y):
        if x != y:
            diffs.append(f"{name}: {x!r} != {y!r}")

    chk("ticks_per_beat", a.ticks_per_beat, b.ticks_per_beat)
    chk("bgm", a.bgm, b.bgm)
    chk("start", a.start, b.start)
    chk("translen", a.translen, b.translen)
    chk("end", a.end, b.end)
    chk("end_fade", a.end_fade, b.end_fade)
    chk("finish", a.finish, b.finish)
    chk("results", a.results, b.results)
    chk("match", a.match, b.match)
    chk("first", a.first, b.first)
    chk("title", a.title, b.title)
    chk("prologue", a.prologue, b.prologue)
    chk("jingle", a.jingle, b.jingle)
    if len(a.events) != len(b.events):
        diffs.append(f"eventos: {len(a.events)} != {len(b.events)}")
    n = min(len(a.events), len(b.events))
    for i in range(n):
        ea, eb = a.events[i], b.events[i]
        prefix = f"evento {i} (tick {ea.tick}/{eb.tick})"
        if ea.tick != eb.tick:
            diffs.append(f"{prefix}: tick {ea.tick} != {eb.tick}")
        if ea.op != eb.op:
            diffs.append(f"{prefix}: op {ea.op} != {eb.op}")
            continue
        if ea.op == "call":
            if ea.game != eb.game:
                diffs.append(f"{prefix}: juego {ea.game} != {eb.game}")
            if ea.fn != eb.fn:
                diffs.append(f"{prefix}: fn 0x{ea.fn:X} != 0x{eb.fn:X}")
            if _pad4(ea.args) != _pad4(eb.args):
                diffs.append(f"{prefix}: args {ea.args} != {eb.args}")
            if ea.word != eb.word:
                diffs.append(f"{prefix}: word {ea.word} != {eb.word}")
            if (ea.tag or None) != (eb.tag or None):
                diffs.append(f"{prefix}: etiqueta {ea.tag} != {eb.tag}")
        elif ea.op == "switch":
            if ea.game != eb.game or ea.style != eb.style or ea.sub != eb.sub:
                diffs.append(
                    f"{prefix}: switch {ea.game} style={ea.style} sub={ea.sub} "
                    f"!= {eb.game} style={eb.style} sub={eb.sub}"
                )
        elif ea.op == "fade":
            if ea.fade_len != eb.fade_len or abs(ea.alpha - eb.alpha) > 1e-6:
                diffs.append(f"{prefix}: fade {ea.fade_len}/{ea.alpha} != {eb.fade_len}/{eb.alpha}")
        elif ea.op == "anim":
            if ea.game != eb.game or ea.layout != eb.layout or ea.anim_name != eb.anim_name:
                diffs.append(
                    f"{prefix}: anim {ea.game} 0x{ea.layout:X} {ea.anim_name} "
                    f"!= {eb.game} 0x{eb.layout:X} {eb.anim_name}"
                )
    if len(a.events) > n:
        diffs.append(f"sobran {len(a.events) - n} eventos a la izquierda")
    if len(b.events) > n:
        diffs.append(f"sobran {len(b.events) - n} eventos a la derecha")
    return diffs


def list_cues(file=None) -> None:
    f = file or sys.stdout
    f.write(f"Groove Tickflow v{VERSION} — juegos y cues (Groove Engine GTLM 1)\n")
    f.write("Escribe GAME.cue  o, despues de  switch GAME,  solo  cue.\n")
    f.write("Tambien se acepta GAME.0x....... con los argumentos en crudo.\n\n")
    shown_fn: set[tuple] = set()
    for g in GAMES:
        cues = [c for c in CUES if c.game == g]
        f.write(f"{g}  —  {GAME_TITLE[g]}\n")
        for c in cues:
            if c.word:
                args = c.word
            elif c.args:
                args = " ".join(str(a) for a in c.args)
            else:
                args = "—"
            alias = ""
            if c.aliases:
                alias = "  alias: " + ", ".join(c.aliases[:4])
                if len(c.aliases) > 4:
                    alias += ", …"
            f.write(f"  {c.name:<22}  0x{c.fn:X}  [{args}]{alias}\n")
            shown_fn.add((g, c.fn))
        missing = [fn for (gg, fn) in CUE_FNS if gg == g and (g, fn) not in shown_fn]
        for fn in missing:
            f.write(f"  0x{fn:X}\n")
        f.write("\n")
    f.write("Eventos extra:\n")
    f.write("  switch JUEGO [cut|hard|0|1|2] [1|2]\n")
    f.write("  fade <pulsos> <alpha>          (ej. fade 0.5 0.6)\n")
    f.write("  anim [JUEGO] NOMBRE [layout]   (layout por defecto segun el juego)\n")
    f.write("  rest <pulsos>   at <pulso>     (1, 0.5, 1.5, 1/3, 240t)\n")
    f.write("  loop N ... end    def NOMBRE ... end    call NOMBRE\n")


def _read_text(path: str) -> str:
    p = Path(path)
    if not p.is_file():
        raise GtfError(f"no existe el archivo {path}", path=path)
    return p.read_text(encoding="utf-8")


def _write_text(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8", newline="\n")


def cmd_compile(inp: str, out: Optional[str]) -> int:
    src = _read_text(inp)
    tl = compile_gtf(src, inp)
    text = emit_gtl(tl, inp)
    if out:
        _write_text(out, text)
        calls = sum(1 for e in tl.events if e.op == "call")
        sw = sum(1 for e in tl.events if e.op == "switch")
        print(
            f"OK: {out}  juegos={','.join(tl.games_used())}  "
            f"cues={calls} cambios={sw} start={tl.start} end={tl.end} finish={tl.finish}"
        )
    else:
        sys.stdout.write(text)
    return 0


def cmd_decompile(inp: str, out: Optional[str]) -> int:
    src = _read_text(inp)
    tl = parse_gtl(src, inp)
    text = decompile_to_gtf(tl, inp)
    if out:
        _write_text(out, text)
        print(f"OK: {out}  ({len(tl.events)} eventos, first={tl.first}, end={format_beats(tl.end)})")
    else:
        sys.stdout.write(text)
    return 0


HELP = """Groove Tickflow v%s — lenguaje tipo Tickflow que compila a .gtl

uso:
  python3 gtf.py compile    entrada.gtf  -o salida.gtl
  python3 gtf.py decompile  entrada.gtl  -o salida.gtf
  python3 gtf.py cues                 lista juegos y nombres de cue
  python3 gtf.py test                 pruebas internas

1 pulso = 480 ticks. rest avanza el reloj; switch y los cues se disparan
en el pulso actual. Ejemplo:

  title "Remix 21"
  start 0
  first CARS
  end 32
  finish 36

  rest 8
  switch KAERU
  frog5 basic
  rest 4
  frog3 basic
""" % VERSION


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="gtf.py",
        description="Groove Tickflow: compilador y descompilador .gtf ↔ .gtl",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Sin -o, el resultado se escribe en stdout.",
    )
    sub = p.add_subparsers(dest="cmd")
    c = sub.add_parser("compile", help="compilar .gtf a .gtl")
    c.add_argument("input")
    c.add_argument("-o", "--output", default=None)
    d = sub.add_parser("decompile", help="descompilar .gtl a .gtf")
    d.add_argument("input")
    d.add_argument("-o", "--output", default=None)
    sub.add_parser("cues", help="listar juegos y cues")
    sub.add_parser("test", help="ejecutar las pruebas internas")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        sys.stdout.write(HELP)
        return 0
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "compile":
            return cmd_compile(args.input, args.output)
        if args.cmd == "decompile":
            return cmd_decompile(args.input, args.output)
        if args.cmd == "cues":
            list_cues()
            return 0
        if args.cmd == "test":
            return run_tests()
        sys.stdout.write(HELP)
        return 2
    except GtfError as e:
        sys.stderr.write(f"ERROR: {e}\n")
        return 1

def run_tests() -> int:
    failed = 0
    passed = 0

    def ok(name: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  OK  {name}")

    def fail(name: str, msg: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FALLO  {name}: {msg}")

    def expect_error(src: str, substr: str, name: str) -> None:
        try:
            compile_gtf(src, name)
            fail(name, "deberia haber fallado")
        except GtfError as e:
            if substr.lower() in str(e).lower():
                ok(name)
            else:
                fail(name, f"error inesperado: {e} (se esperaba que mencionara {substr!r})")

    print("Groove Tickflow — pruebas")

    try:
        assert parse_duration("1") == 480
        assert parse_duration("0") == 0
        assert parse_duration("0.5") == 240
        assert parse_duration("1.5") == 720
        assert parse_duration("1/3") == 160
        assert parse_duration("2/3") == 320
        assert parse_duration("240t") == 240
        assert format_beats(480) == "1"
        assert format_beats(240) == "0.5"
        assert format_beats(720) == "1.5"
        assert format_beats(160) == "1/3"
        assert format_beats(320) == "2/3"
        assert format_beats(120) == "0.25"
        ok("duraciones (1, 0.5, 1/3, 240t)")
    except Exception as e:
        fail("duraciones", f"{e}")

    try:
        parse_duration("0x1E0")
        fail("hex sin t en duracion", "deberia fallar o exigirse 0x1E0t")
    except ValueError:
        ok("hex sin sufijo t no es una duracion en pulsos")
    except Exception as e:
        fail("hex sin sufijo t en duracion", str(e))

    root = Path(__file__).resolve().parent.parent
    src_gtl = root / "multi_prueba.gtl"
    if src_gtl.is_file():
        try:
            original = parse_gtl(_read_text(str(src_gtl)), str(src_gtl))
            gtf = decompile_to_gtf(original, str(src_gtl))
            rebuilt_tl = compile_gtf(gtf, "multi_prueba.gtf")
            diffs = timelines_equal(original, rebuilt_tl)
            if diffs:
                fail("multi_prueba ida y vuelta (memoria)", "; ".join(diffs[:8]))
            else:
                ok("multi_prueba ida y vuelta (misma semantica, 17 cues / 4 switches)")
            assert sum(1 for e in original.events if e.op == "call") == 17
            assert sum(1 for e in original.events if e.op == "switch") == 4
            assert original.start == 0
            assert original.end == 38400 and original.finish == 40320
            assert original.first == "CARS"
            ok("multi_prueba cabecera y recuento")
        except Exception as e:
            fail("multi_prueba ida y vuelta", f"{e}\n{traceback.format_exc()}")
    else:
        print(f"  —   multi_prueba.gtl no esta junto al repo (se omite la ida y vuelta)")

    src = "\n".join([
        'title "Remix 21"',
        "prologue type_19",
        "jingle 0x163",
        "bgm 139",
        "start 0",
        "match -1 9 4",
        "results native",
        "first CARS",
        "end 24",
        "finish 28",
        "",
        "def trio",
        "  loop 3",
        "    softGrow basic",
        "    rest 1",
        "  end",
        "end",
        "",
        "rest 1/3",
        "switch KAERU",
        "frog5 basic",
        "rest 2/3",
        "KAERU.frog3 basic",
        "rest 1.5",
        "switch PUTILABO cut",
        "call trio",
        "rest 0.5",
        "fade 0.5 0.6",
        "anim Remix8",
    ])
    try:
        tl = compile_gtf(src, "unit.gtf")
        assert tl.title == "Remix 21"
        assert tl.prologue == "type_19"
        assert tl.jingle == 0x163
        assert tl.start == 0
        assert tl.end == 24 * 480
        assert tl.finish == 28 * 480
        calls = [e for e in tl.events if e.op == "call"]
        switches = [e for e in tl.events if e.op == "switch"]
        assert len(calls) == 5
        assert switches[0].game == "KAERU" and switches[0].style == 0
        assert switches[1].game == "PUTILABO" and switches[1].style == -1
        assert calls[0].tick == 160
        assert calls[0].fn == 0x1B8DB0 and calls[0].args[0] == 5
        assert calls[1].tick == 160 + 320
        assert calls[1].args[0] == 3
        t0 = calls[1].tick + 720
        assert switches[1].tick == t0
        assert [c.tick for c in calls[2:]] == [t0, t0 + 480, t0 + 960]
        assert all(c.fn == 0x20BF90 for c in calls[2:])
        fades = [e for e in tl.events if e.op == "fade"]
        anims = [e for e in tl.events if e.op == "anim"]
        assert len(fades) == 1 and fades[0].fade_len == 240 and abs(fades[0].alpha - 0.6) < 1e-6
        assert len(anims) == 1 and anims[0].anim_name == "Remix8" and anims[0].game == "PUTILABO"
        assert fades[0].tick == t0 + 1440 + 240
        text = emit_gtl(tl, "unit.gtf")
        assert "title Remix 21" in text
        assert "prologue type_19" in text
        assert "jingle 0x163" in text
        assert " cut" in text
        back = parse_gtl(text, "unit.gtl")
        diffs = timelines_equal(tl, back)
        if diffs:
            fail("loop/def/fracciones/prologue", "; ".join(diffs[:8]))
        else:
            ok("loop, def/call, rest 1/3, prologue/jingle/title, switch cut")
        gtf2 = decompile_to_gtf(tl, "unit.gtl")
        tl2 = compile_gtf(gtf2, "unit2.gtf")
        diffs = timelines_equal(tl, tl2)
        if diffs:
            fail("ida y vuelta unitaria", "; ".join(diffs[:8]))
        else:
            ok("ida y vuelta del caso unitario (incluye fade/anim/cut)")
    except Exception as e:
        fail("loop/def/fracciones/prologue", f"{e}\n{traceback.format_exc()}")

    src = "\n".join([
        "results custom",
        "first KAERU",
        "end 16",
        "finish 20",
        "at 2",
        "switch CARS hard",
        "brake basic",
        "rest 1",
        "CARS.accel tech",
    ])
    try:
        tl = compile_gtf(src, "alias.gtf")
        assert tl.results == 0
        sw = [e for e in tl.events if e.op == "switch"][0]
        assert sw.style == -1 and sw.tick == 960
        calls = [e for e in tl.events if e.op == "call"]
        assert calls[0].fn == 0x1608F0 and calls[0].tag == "basic"
        assert calls[1].fn == 0x1601D0 and calls[1].args[0] == 1 and calls[1].tag == "tech"
        ok("switch hard, at, GAME.cue, results custom")
    except Exception as e:
        fail("switch hard / at / custom", f"{e}")

    src = "\n".join(["first RING", "switch RING", "hoop basic"])
    try:
        tl = compile_gtf(src, "autoend.gtf")
        assert tl.end == 4 * TPB
        assert tl.finish == tl.end + 4 * TPB
        assert tl.start == 0
        ok("end/finish automaticos si se omiten")
    except Exception as e:
        fail("end/finish automaticos", f"{e}")

    expect_error("rest 1\nend 8\nfinish 12\n", "no hay", "error: sin cues")
    expect_error("first CARS\nend 8\nfinish 12\nrest 1\nfrog5 basic\n", "cue", "error: cue corto sin contexto")
    expect_error("first CARS\nend 8\nfinish 12\nyellow basic\n", "ambiguo", "error: yellow ambiguo")
    expect_error("first KAERU\nend 8\nfinish 12\nfrog9 basic\n", "desconocido", "error: cue inexistente")
    expect_error("first CARS\nend 8\nfinish 12\nswitch NOEXISTE\n", "juego desconocido", "error: juego desconocido")
    expect_error("first CARS\nend 8\nfinish 12\nrest -1\nbrake basic\n", "negativ", "error: rest negativo")
    expect_error("first CARS\nend 8\nfinish 12\nrest 2\nat 1\nbrake basic\n", "atras", "error: at hacia atras")
    expect_error("first CARS\nend 8\nfinish 12\nloop 3\nbrake basic\n", "falta 'end'", "error: loop sin end")
    expect_error("first CARS\nend 8\nfinish 12\ncall fantasma\nbrake basic\n", "def", "error: call sin def")
    expect_error("first CARS\nend 8\nfinish 12\njingle 0x1\nbrake basic\n", "jingle", "error: jingle fuera de rango")
    expect_error("def foo\n  def bar\n  end\nend\nfirst CARS\nend 8\nfinish 12\nbrake basic\n", "anidado", "error: def anidado")
    expect_error(
        "def foo\n  call foo\nend\nfirst CARS\nend 8\nfinish 12\ncall foo\nbrake basic\n",
        "recursiv",
        "error: def recursivo",
    )
    expect_error("first CARS\nend 8\nfinish 12\nfoo bar\nbrake basic\n", "desconocido", "error: cue/palabra desconocida")

    samples = [
        root / "pkg_rhre_v041/GrooveRHRE-v0.4.1/test/multi.gtl",
        root / "pkg_rhre_v041/GrooveRHRE-v0.4.1/test/intro_switch.gtl",
        root / "release_v0.4.0/groove/stages/multi/multi.gtl",
        root / "release_v0.4.0/groove/stages/multi/ejemplo_A.gtl",
        root / "release_v0.4.0/groove/stages/multi/ejemplo_B.gtl",
    ]
    for p in samples:
        if not p.is_file():
            continue
        try:
            original = parse_gtl(_read_text(str(p)), str(p))
            gtf = decompile_to_gtf(original, str(p))
            rebuilt = compile_gtf(gtf, p.name + ".gtf")
            diffs = timelines_equal(original, rebuilt)
            if diffs:
                fail(f"ida y vuelta {p.name}", "; ".join(diffs[:6]))
            else:
                ok(f"ida y vuelta {p.name}")
        except Exception as e:
            fail(f"ida y vuelta {p.name}", f"{e}")

    print(f"\n{passed} ok, {failed} fallos")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
