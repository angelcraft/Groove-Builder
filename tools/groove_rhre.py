#!/usr/bin/env python3
"""Groove Engine <-> RHREfresh / RHRE3 bridge v0.4.1.

  python groove_rhre.py rhre2gtlm MI_REMIX.rhref -o multi.gtl   (varios juegos, escenario REMIX_21)

  python groove_rhre.py rhre2gtl  MI_REMIX.rhref  -o salida.gtl  [--template ht3.gtl]
  python groove_rhre.py gtl2rhre  ht3.gtl  -o HT3_editable.rhref  [--bpm 120]
  python groove_rhre.py check     salida.gtl

Works on Windows/Mac/Linux with plain Python 3.8+ (stdlib only). Own code.
No game data inside: a remix only carries beat positions of cue *names*.

Supported game: Hoop Trundling (RHREfresh ids hoopTrundling / hoopTrundlingCast).
Mapping (reverse-engineered from SceneRing::hoop 0x217960 in the game):
  * one `hoop` cue at beat H  ->  one native hoop() call at tick (H-origin)*480
  * the game then runs the 4 CPU characters at H+1, H+1.5, H+2, H+2.5 and the
    player at H+3.  RHRE calls them pa, pi, pu, pe, po.
  * mask bit0..bit3 = pa, pi, pu, pe present.  po (the player) is always there.
  * all four present -> native value -1 (what the original HT2 uses; use
    --full-mask 15 to write 15 instead).
Extra timeline events can be put in the remix as RHRE subtitle entities whose
text starts with "gtl:", e.g. "gtl: C tech", "gtl: A BgStep", "gtl: S",
"gtl: end", "gtl: finish", "gtl: origin".  gtl2rhre writes them for you.
"""
import argparse, json, math, os, sys, zipfile, glob, re

TPB = 480
GAMES = ('hoopTrundling', 'hoopTrundlingCast')
SYL = ['pa', 'pi', 'pu', 'pe', 'po']
SYL_OFF = {'pa': 1.0, 'pi': 1.5, 'pu': 2.0, 'pe': 2.5, 'po': 3.0}  # beats after the hoop cue
# Built-in copy of the 8 RHREfresh Hoop Trundling patterns (cue beats relative to the entity beat).
BUILTIN_PATTERNS = {
    'paPiPuPePo': [('hoop', -1.0), ('pa', 0.0), ('pi', 0.5), ('pu', 1.0), ('pe', 1.5), ('po', 2.0)],
    'paPiXxXxPo': [('hoop', -1.0), ('pa', 0.0), ('pi', 0.5), ('po', 2.0)],
    'paXxPuXxPo': [('hoop', -1.0), ('pa', 0.0), ('pu', 1.0), ('po', 2.0)],
    'paXxXxPePo': [('hoop', -1.0), ('pa', 0.0), ('pe', 1.5), ('po', 2.0)],
    'paXxXxXxPo': [('hoop', -1.0), ('pa', 0.0), ('po', 2.0)],
    'xxPiPuPePo': [('hoop', -1.5), ('pi', 0.0), ('pu', 0.5), ('pe', 1.0), ('po', 1.5)],
    'xxXxPuPePo': [('hoop', -2.0), ('pu', 0.0), ('pe', 0.5), ('po', 1.0)],
    'xxXxXxXxPo': [('hoop', -3.0), ('po', 0.0)],
}
# Native HT2 defaults (Groove Engine ht3.gtl): tile column 9 row 0, HT2 song (bgm 64)
DEFAULT_HEADER = dict(bgm=64, results='native', match=(-1, 9, 0), end=(108480, 480), finish=109440)


def warn(msg):
    print('AVISO: ' + msg, file=sys.stderr)


# ------------------------------------------------------------------ SFX database
def default_sfxdb():
    cands = []
    if os.environ.get('APPDATA'):
        cands.append(os.path.join(os.environ['APPDATA'], 'RHREfresh', 'sfx', 'games'))
    home = os.path.expanduser('~')
    cands += [os.path.join(home, 'AppData', 'Roaming', 'RHREfresh', 'sfx', 'games'),
              os.path.join(home, '.config', 'RHREfresh', 'sfx', 'games'),
              os.path.join(home, 'Library', 'Application Support', 'RHREfresh', 'sfx', 'games'),
              os.path.join(home, '.rhrefresh', 'sfx', 'games')]
    for c in cands:
        if os.path.isdir(c):
            return c
    return None


def load_patterns(sfxdb):
    """returns {datamodel_id: [(cue_short_name, rel_beat), ...]} for the HT games"""
    pats = {}
    for g in GAMES:
        for k, v in BUILTIN_PATTERNS.items():
            pats['%s_%s' % (g, k)] = list(v)
    if sfxdb:
        for g in GAMES:
            f = os.path.join(sfxdb, g, 'data.json')
            if not os.path.isfile(f):
                continue
            d = json.load(open(f, encoding='utf-8'))
            for o in d.get('objects', []):
                if o.get('type') != 'pattern':
                    continue
                ids = [o['id']] + list(o.get('deprecatedIDs', []))
                cues = [(c['id'].split('/')[-1], float(c['beat'])) for c in o.get('cues', [])]
                for i in ids:
                    pats[i.replace('*', g)] = cues
    return pats


def cue_name(datamodel):
    """'hoopTrundling/pa' -> 'pa' (None if not an HT cue)."""
    for g in GAMES:
        if datamodel.startswith(g + '/'):
            n = datamodel.split('/', 1)[1]
            if n == 'hoopPass':
                n = 'hoop'
            return n
    return None


# ------------------------------------------------------------------ remix reading
def read_remix(path):
    if path.lower().endswith('.json'):
        return json.load(open(path, encoding='utf-8'))
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read('remix.json').decode('utf-8'))


def rhre2gtl(args):
    remix = read_remix(args.remix)
    sfxdb = args.sfxdb or default_sfxdb()
    pats = load_patterns(sfxdb)
    cues = []      # (beat, name)
    extra = []     # (beat, gtl text)
    origin = None
    mask15 = []    # beats of hoops that must stay 15 (not -1)
    ignored = {}
    end_beat = None
    for order, e in enumerate(remix.get('entities', [])):
        dm = e.get('datamodel', '')
        b = float(e.get('beat', 0.0))
        if dm in ('special_subtitleEntity', 'special_songTitleEntity', 'special_songArtistEntity'):
            t = (e.get('subtitle') or '').strip()
            if t.lower().startswith('gtl:'):
                t = t[4:].strip()
                if t == 'origin':
                    origin = b
                elif t == 'mask15':
                    mask15.append(b)
                else:
                    extra.append((b, t, order))
            continue
        if dm == 'special_endEntity':
            end_beat = b
            continue
        n = cue_name(dm)
        if n is not None:
            cues.append((b, n, order))
            continue
        if dm in pats:
            # Hoop Trundling patterns are not stretchable in the SFX DB: width is ignored (as RHREfresh does)
            for n2, rb in pats[dm]:
                cues.append((b + rb, n2, order))
            continue
        g = dm.split('/')[0].split('_')[0]
        ignored[g] = ignored.get(g, 0) + 1
    if ignored:
        warn('ignorados (juegos sin soporte en Groove Engine todavia): ' +
             ', '.join('%s x%d' % kv for kv in sorted(ignored.items())))
    if origin is None:
        origin = args.origin_beat
    tempos = remix.get('trackers', {}).get('tempos', {}).get('trackers', [])
    bpms = sorted(set(float(t.get('bpm', 0)) for t in tempos))
    if len(bpms) > 1:
        warn('el remix tiene cambios de tempo (%s BPM): el juego no los aplica; cuenta en pulsos y sigue el tempo de su propia cancion (bgm)' %
             ', '.join('%g' % x for x in bpms))
    if remix.get('musicData', {}).get('present'):
        warn('la musica del remix (%s) NO se lleva al juego: suena la cancion nativa del bgm elegido' % remix['musicData'].get('filename'))
    # ---- build hoops from cues
    hoops = sorted((b, o) for b, n, o in cues if n == 'hoop')
    syl = [(b, n) for b, n, o in cues if n in SYL_OFF]
    used = set()
    out_h = []
    for h, ho in hoops:
        mask = 0
        for i, s in enumerate(SYL):
            t = h + SYL_OFF[s]
            hit = [k for k, (b, n) in enumerate(syl) if n == s and abs(b - t) < 1e-3]
            if hit:
                used.update(hit)
                if s != 'po':
                    mask |= 1 << i
        out_h.append((h, mask, ho))
    lone = [syl[k] for k in range(len(syl)) if k not in used]
    if lone:
        warn('%d silabas sin aro (no estan a +1..+3 pulsos de un "hoop"): %s' %
             (len(lone), ', '.join('%s@%g' % (n, b) for b, n in lone[:10])))
    # orphan hoops-from-syllables: a pattern always has its hoop, single cues need one
    if not out_h:
        sys.exit('ERROR: el remix no tiene ningun aro de Hoop Trundling (cue "hoop" o patrones pa/pi/pu/pe/po)')
    # ---- header from template
    hdr = dict(DEFAULT_HEADER)
    tmpl_events = []
    if args.template:
        t = parse_gtl(open(args.template, encoding='utf-8').read())
        hdr.update(bgm=t['bgm'], results=t['results'], match=t['match'], end=t['end'], finish=t['finish'])
        if any(x[1].split()[0] in ('C', 'A', 'S') for x in extra):
            print('nota: el remix ya trae eventos "gtl: C/A/S"; no se copian los de la plantilla')
        elif not args.no_template_events:
            tmpl_events = [(tk, txt) for tk, txt, _ in t['events'] if txt[0] in 'CAS']  # placed before same-tick hoops
    if args.match:
        hdr['match'] = tuple(args.match)
    if args.bgm is not None:
        hdr['bgm'] = args.bgm
    lines_c, lines_bg = [], []

    def tick(b):
        v = (b - origin) * TPB
        r = int(round(v))
        if abs(v - r) > 0.01:
            warn('beat %g no cae en un tick entero; redondeado' % b)
        return r
    full = -1 if args.full_mask == -1 else 15
    for h, m, ho in out_h:
        tk = tick(h)
        if tk < 0:
            sys.exit('ERROR: aro en beat %g queda antes del origen (beat %g)' % (h, origin))
        if m == 15 and not any(abs(h - b) < 1e-3 for b in mask15):
            m = full
        lines_c.append((tk, ho, 'H %d %d' % (tk, m)))
    for tk, txt in tmpl_events:
        (lines_c if txt[0] == 'C' else lines_bg).append((tk, -1, txt))
    end_tick, fade = hdr['end']
    finish = hdr['finish']
    for b, txt, eo in extra:
        k = txt.split()
        if k[0] in ('C', 'A', 'S'):
            (lines_c if k[0] == 'C' else lines_bg).append((tick(b), eo, ' '.join([k[0], str(tick(b))] + k[1:])))
        elif k[0] == 'end':
            end_tick = tick(b); fade = int(k[1]) if len(k) > 1 else fade
        elif k[0] == 'finish':
            finish = tick(b)
        else:
            warn('subtitulo gtl desconocido: ' + txt)
    if end_beat is not None and not any(t.split()[0] == 'end' for _, t, _ in extra):
        end_tick = tick(end_beat)
        finish = end_tick + 960
    hticks = [t for t, _, x in lines_c if x.startswith('H ')]
    last = max(hticks)
    if last > end_tick:
        sys.exit('ERROR: hay aros despues del final (tick %d > end %d). Mueve el final o usa "gtl: end".' % (last, end_tick))
    if finish < end_tick:
        finish = end_tick + 960
    # fix line ticks (C/A/S lines from template keep their own tick text)
    def fix(t):
        tk, _, txt = t
        k = txt.split()
        if k[0] in ('C', 'A', 'S', 'H'):
            k[1] = str(tk)
        return ' '.join(k)
    out = ['GTL1',
           '# Generado por groove_rhre.py desde %s' % os.path.basename(args.remix),
           '# Solo datos de tiempo. 480 ticks por pulso; tick 0 = beat %g del remix.' % origin,
           'ticks_per_beat 480',
           'bgm %d' % hdr['bgm'],
           'results %s' % hdr['results'],
           'match %d %d %d' % tuple(hdr['match']),
           'end %d %d' % (end_tick, fade),
           'finish %d' % finish,
           '# --- cue track']
    out += [fix(x) for x in sorted(lines_c)]
    out += ['# --- bg track'] + [fix(x) for x in sorted(lines_bg)]
    text = '\n'.join(out) + '\n'
    open(args.output, 'w', encoding='utf-8', newline='\n').write(text)
    print('OK: %s  aros=%d  primer=%d ultimo=%d end=%d finish=%d' % (args.output, len(out_h), min(hticks), last, end_tick, finish))
    rep = check_text(text)
    print_report(rep)
    return 0 if rep['ok'] else 1


# ------------------------------------------------------------------ gtl parsing / checking (mirrors engine/src/timeline.cpp)
def parse_gtl(text):
    r = dict(bgm=64, results='exit', match=(-1, 9, 0), end=(-1, 480), finish=-1, events=[], parts=0, errors=[])
    header = False
    last_cue = last_bg = -1
    for n, raw in enumerate(text.split('\n'), 1):
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        k = line.split()[:4]
        if not header:
            if k[0] != 'GTL1':
                r['errors'].append('linea %d: falta la cabecera GTL1' % n); return r
            header = True; continue
        try:
            if k[0] == 'ticks_per_beat': pass
            elif k[0] == 'bgm': r['bgm'] = int(k[1], 0)
            elif k[0] == 'results': r['results'] = k[1]
            elif k[0] == 'match': r['match'] = (int(k[1]), int(k[2]), int(k[3]))
            elif k[0] == 'end': r['end'] = (int(k[1]), int(k[2]))
            elif k[0] == 'finish': r['finish'] = int(k[1])
            elif k[0] == 'part':
                r['parts'] += 1; last_cue = last_bg = -1
                if r['parts'] == 1: r['bgm'] = int(k[1], 0)
            elif k[0] in ('H', 'C'):
                t = int(k[1])
                if t < last_cue: r['errors'].append('linea %d: cue desordenado' % n)
                if k[0] == 'H':
                    m = int(k[2])
                    if m < -1 or m > 15: r['errors'].append('linea %d: mascara %d fuera de -1..15' % (n, m))
                last_cue = t
                r['events'].append((t, ' '.join(k), r['parts']))
            elif k[0] in ('A', 'S'):
                t = int(k[1])
                if t < last_bg: r['errors'].append('linea %d: evento de fondo desordenado' % n)
                last_bg = t
                r['events'].append((t, ' '.join(k), r['parts']))
            else:
                r['errors'].append('linea %d: clave desconocida %r' % (n, k[0]))
        except (IndexError, ValueError):
            r['errors'].append('linea %d: valor invalido' % n)
    if not header: r['errors'].append('archivo vacio')
    return r


def check_text(text):
    r = parse_gtl(text)
    hoops = [(t, int(s.split()[2]), p) for t, s, p in r['events'] if s[0] == 'H']
    end, finish = r['end'][0], r['finish']
    if end <= 0 or finish < end: r['errors'].append('end/finish ausentes o invalidos')
    if not hoops: r['errors'].append('sin aros')
    if hoops and max(t for t, _, p in hoops if p == hoops[-1][2]) > end: r['errors'].append('aro despues de end')
    warns = []
    gaps = [b[0] - a[0] for a, b in zip(hoops, hoops[1:]) if a[2] == b[2]]
    small = [g for g in gaps if g < 720]
    if small: warns.append('%d aros a menos de 1,5 pulsos del anterior (minimo probado en consola: 720 ticks)' % len(small))
    odd = [t for t, _, _ in hoops if t % 120]
    if odd: warns.append('%d aros fuera de la rejilla de semicorcheas' % len(odd))
    return dict(ok=not r['errors'], errors=r['errors'], warnings=warns, hoops=len(hoops),
                min_gap=min(gaps) if gaps else None, end=end, finish=finish, match=r['match'], bgm=r['bgm'])


def print_report(rep):
    print('check: %s | aros=%d hueco_min=%s end=%d finish=%d match=%s bgm=%d' %
          ('VALIDO' if rep['ok'] else 'INVALIDO', rep['hoops'], rep['min_gap'], rep['end'], rep['finish'], rep['match'], rep['bgm']))
    for e in rep['errors']: print('  ERROR: ' + e)
    for w in rep['warnings']: print('  aviso: ' + w)


# ------------------------------------------------------------------ gtl -> remix (to edit an existing chart in RHREfresh)
def gtl2rhre(args):
    t = parse_gtl(open(args.gtl, encoding='utf-8').read())
    if t['errors']:
        sys.exit('ERROR: ' + '; '.join(t['errors']))
    if t['parts']:
        sys.exit('ERROR: los .gtl de varias partes (Double Hell) aun no se exportan')
    game = args.game
    ents = []

    def ent(beat, dm, width=0.5, track=0, **kw):
        d = dict(type='model', beat=beat, track=track, width=width, height=1, datamodel=dm)
        d.update(kw); ents.append(d)
    ents.append(dict(type='model', beat=0.0, track=3, width=1.0, height=1, datamodel='special_subtitleEntity', subtitle='gtl: origin'))
    for tk, s, _ in t['events']:
        b = tk / TPB
        k = s.split()
        if k[0] == 'H':
            m = int(k[2])
            mm = 15 if m == -1 else m
            ent(b, game + '/hoop', 1.0, track=0)
            for i, syl in enumerate(SYL):
                if syl == 'po' or mm & (1 << i):
                    ent(b + SYL_OFF[syl], game + '/' + syl, 0.5, track=1)
            if m == 15:  # keep 15 distinct from -1 on the way back
                ent(b, 'special_subtitleEntity', 1.0, track=4, subtitle='gtl: mask15')
        else:
            ent(b, 'special_subtitleEntity', 1.0, track=2 if k[0] == 'C' else 4, subtitle='gtl: ' + ' '.join([k[0]] + k[2:]))
    ents.append(dict(type='model', beat=t['end'][0] / TPB, track=3, width=1.0, height=1, datamodel='special_subtitleEntity', subtitle='gtl: end %d' % t['end'][1]))
    ents.append(dict(type='model', beat=t['finish'] / TPB, track=3, width=1.0, height=1, datamodel='special_subtitleEntity', subtitle='gtl: finish'))
    remix = {'version': 'v4.0.0', 'databaseVersion': 154, 'playbackStart': 0.0, 'musicStartSec': 0.0,
             'defaultTempo': args.bpm, 'trackCount': 5, 'isAutosave': False, 'midiInstruments': 0,
             'musicData': {'present': False}, 'textures': None, 'entities': ents,
             'trackers': {'tempos': {'trackers': [{'beat': 0.0, 'seconds': 0.0, 'bpm': args.bpm, 'swingRatio': 50, 'swingDivision': 1.0}]},
                          'musicVolumes': {'trackers': [{'beat': 0.0, 'width': 0.0, 'volume': 100}]}},
             'timeSignatures': [{'beat': 0, 'divisions': 4, 'measure': 1, 'beatUnit': 4}]}
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('remix.json', json.dumps(remix, indent=1))
    print('OK: %s  aros=%d  (abrelo en RHREfresh; el tempo %g BPM solo sirve para escucharlo, el juego usa el de su cancion)' %
          (args.output, sum(1 for _, s, _ in t['events'] if s[0] == 'H'), args.bpm))
    return 0


# ================================================================== v0.2: multi-game (.gtl "GTLM 1", REMIX_21 host)
# Calibrated in emulation against the game's own cue functions (see LEEME):
#   RING   (hoopTrundling)   call 0x217960 at the "hoop" cue beat (= pa - 1), mask pa..pe
#   HUNGRY (feedingTheBeast) call 0x1AF800 8 beats before the shoot (color 0 yellow / 1 purple)
#   CRAB   (crabSnacks)      macaron 0x17BFC0 / fava bean 0x17D0D0, 2 beats before the first hit
MULTI_GAMES = ["PUMPUP", "FLYDISC", "ROLLING", "HUNGRY", "CARS", "KAERU", "CRAB", "INSECT", "SOFTCATCH", "RING",
               "THUNDER", "HAMMER", "MOON", "THE_A", "PUTILABO", "WIPER", "SOCCER", "HURDLE", "TALK", "COOKING",
               "PARASOL", "DANCER", "SAMURAI", "BRUSH"]
# (game, fn) the engine accepts (mirror of engine/src/cuefns.hpp)
MULTI_FNS = {
    'PUMPUP': (0x209B80, 0x20A170), 'ROLLING': (0x222FA0, 0x223350, 0x223800), 'HUNGRY': (0x1AF800,),
    'CARS': (0x1601D0, 0x1608F0), 'KAERU': (0x1B8DB0, 0x1B8F70), 'CRAB': (0x17BFC0, 0x17D0D0),
    'INSECT': (0x1B54C0, 0x1B5A60, 0x1B60F0), 'SOFTCATCH': (0x248B70,), 'RING': (0x217960,),
    'THUNDER': (0x27DBA0, 0x27E130, 0x27E6C0, 0x27EC00), 'HAMMER': (0x1AB410, 0x1ABCB0), 'MOON': (0x1DB630,),
    'PUTILABO': (0x20BF90, 0x20C190), 'WIPER': (0x2AA2F0, 0x2A9B00, 0x2AA6F0, 0x2AA4F0, 0x2A9900, 0x2A9700),
    'SOCCER': (0x246760, 0x246B80, 0x246FF0), 'HURDLE': (0x1B1FC0, 0x1B24D0), 'TALK': (0x255100,),
    'COOKING': (0x178880, 0x178DC0), 'PARASOL': (0x205030, 0x204970), 'DANCER': (0x181210, 0x182460, 0x181C70), 'SAMURAI': (0x22AD50, 0x22AFF0),
    'BRUSH': (0x15AF40, 0x15B2E0, 0x15AB00, 0x15A560), 'FLYDISC': (0x18D3F0,), 'THE_A': (0x278FE0,),
}
# cue functions whose first argument is a word (engine kind 1: fn(scene, th, word, 0, 0, 1.0f))
WORD_FNS = {('THE_A', 0x278FE0): ('TEA', 'SODA', 'COCOA', 'AAA')}
# v0.3: RHRE patterns of the category-B games, calibrated in emulation (player input tick of the native
# cue function vs. the player cue of the RHRE pattern). datamodel -> (GAME, fn, args, call offset from the
# pattern beat, end offset, note or None). "aprox" notes are printed as warnings.
PATTERN_RULES = {}
def _pr(game, names, g, fn, a, call, end, note=None):
    for n in names: PATTERN_RULES['%s_%s' % (game, n)] = (g, fn, a, call, end, note)
_pr('sneezyMoon', ('greenSneeze', 'greenSneezeFast', 'greenSneezePractice'), 'MOON', 0x1DB630, [1, 0, 0], -1.0, 3.5)
_pr('sneezyMoon', ('greenSneezeStandalone', 'greenSneezeFastStandalone', 'greenSneezeStandalonePractice'), 'MOON', 0x1DB630, [0, 0, 0], -3.0, 1.5)
_pr('ribbitRocket', ('frog3',), 'KAERU', 0x1B8DB0, [3, 0, 0], -3.0, 2.5)
_pr('ribbitRocket', ('frog4',), 'KAERU', 0x1B8DB0, [4, 0, 0], -2.0, 3.5)
_pr('ribbitRocket', ('frog5',), 'KAERU', 0x1B8DB0, [5, 0, 0], -1.0, 4.5)
_pr('hopStopNRoll', ('rolling', 'rollingHops'), 'ROLLING', 0x222FA0, [1, 0, 0], -2.0, 2.5)
_pr('hopStopNRoll', ('rollingWithPartyPopper', 'rollingHopsWithPartyPopper'), 'ROLLING', 0x222FA0, [1, 0, 0], -2.0, 3.5,
    'el confeti (partyPopper) no se reproduce, solo el roll')
_pr('hopStopNRoll', ('stopHopping',), 'ROLLING', 0x222FA0, [2, 0, 0], -1.0, 4.0)
_pr('hopStopNRoll', ('startHopping',), 'ROLLING', 0x223350, [0, 0, 0], -2.0, 2.5, 'aprox: startHopping sin verificar en consola')
_pr('fruitFlex', ('apple',), 'PUMPUP', 0x209B80, [1, 0, 0], -1.75, 2.75, 'aprox: manzana alineada al primer flex (+1.25)')
_pr('fruitFlex', ('lemon',), 'PUMPUP', 0x20A170, [0, 0, 0], -1.5, 2.75)
_pr('wiperBosses', ('pinkSlow',), 'WIPER', 0x2A9700, [0, 0, 0], -1.0, 6.5)
_pr('wiperBosses', ('blueSlow',), 'WIPER', 0x2A9900, [1, 0, 0], -1.0, 6.5)
_pr('wiperBosses', ('bothSlow',), 'WIPER', 0x2A9B00, [3, 0, 0], -1.0, 6.5)
_pr('wiperBosses', ('pinkFast',), 'WIPER', 0x2AA2F0, [3, 0, 0], -1.0, 3.5)
_pr('wiperBosses', ('blueFast',), 'WIPER', 0x2AA4F0, [3, 0, 0], -1.0, 3.5)
_pr('wiperBosses', ('bothFast',), 'WIPER', 0x2AA6F0, [3, 0, 0], -1.0, 3.5)
_pr('soccerDreams', ('white',), 'SOCCER', 0x246760, [0, 0, 0], -3.5, 2.0)
_pr('soccerDreams', ('pink',), 'SOCCER', 0x246B80, [0, 0, 0], -2.5, 4.0)
_pr('soccerDreams', ('yellow',), 'SOCCER', 0x246FF0, [0, 0, 0], -2.5, 5.0)
_pr('soccerDreams', ('yellowThunder',), 'SOCCER', 0x246FF0, [0, 1920, 0], -2.5, 5.0, 'aprox: trueno = argumento nativo 1920 (sin verificar)')
_pr('lightningBolting', ('cloudYellow', 'cloudYellowSwing'), 'THUNDER', 0x27DBA0, [1, 0, 0], -1.0, 3.0)
_pr('lightningBolting', ('cloudPink',), 'THUNDER', 0x27E6C0, [1, 0, 0], -1.5, 2.5)
_pr('lightningBolting', ('cloudPinkSwing',), 'THUNDER', 0x27E6C0, [1, 0, 0], -1.5, 2.5, 'aprox: el swing lo pone la cancion, no el patron')
_pr('discDog', ('throw', 'throwGrowl'), 'FLYDISC', 0x18D3F0, [0, 3360, -1, 0], -2.0, 10.5)
_pr('discDog', ('throwCounting', 'throwCountingGrowl', 'throwFade', 'throwFadeGrowl', 'throwCountingOffbeat',
                'throwCountingGrowlOffbeat', 'throwFadeOffbeat', 'throwFadeGrowlOffbeat'), 'FLYDISC', 0x18D3F0, [0, 3360, -1, 0], -2.0, 10.5,
    'la cuenta (countBeep) no se reproduce, solo el lanzamiento')
_pr('aForEffort', ('tea',), 'THE_A', 0x278FE0, ['TEA'], -4.0, 4.0)
_pr('aForEffort', ('soda',), 'THE_A', 0x278FE0, ['SODA'], -4.0, 3.5)
_pr('aForEffort', ('cocoa',), 'THE_A', 0x278FE0, ['COCOA'], -4.0, 4.0)
_pr('aForEffort', ('aaa',), 'THE_A', 0x278FE0, ['AAA'], -4.0, 4.0, 'aprox: AAA alineado como TEA')

# v0.4: remaining REMIX_21 games (emulated trace of the native cue function: player input beat vs. RHRE pattern)
_pr('brollyGoodShow', ('allez',), 'PARASOL', 0x205030, [1, 1, 0, 0], -1.0, 2.5)
_pr('brollyGoodShow', ('encore', 'encoreCheer'), 'PARASOL', 0x204970, [360, 0, 0, 0], -3.0, 2.75,
    'aprox: encore = cho x4 cada 0.75; el paTogether final y la voz "encore" no se reproducen')
for _n in (1, 2, 3, 4):
    _pr('sliceNDiceKitchen', ('tomato%d' % _n,), 'COOKING', 0x178880, [_n - 1, 1, 0, 0], -1.5, 2.0,
        'aprox: numero de tarareo (1-4) = argumento %d sin verificar' % (_n - 1))
    _pr('sliceNDiceKitchen', ('pepper%d' % _n,), 'COOKING', 0x178880, [_n - 1, 3, 0, 0], -1.5, 2.0,
        'aprox: numero de tarareo (1-4) = argumento %d sin verificar' % (_n - 1))
_pr('sliceNDiceKitchen', ('broccoli',), 'COOKING', 0x178DC0, [3, 2, -1, -1], -2.0, 2.5)
_pr('backupSpotlight', ('flashyLeft', 'flashyRight'), 'DANCER', 0x182460, [0, 1, 0, 0], -3.5, 3.0,
    'aprox: izquierda/derecha no se distinguen (mismo argumento nativo)')
_pr('sweeperStar', ('sweepThree',), 'BRUSH', 0x15AB00, [0, 0, 0, 0], -3.5, 4.0)
_pr('sweeperStar', ('spin',), 'BRUSH', 0x15AF40, [0, 0, 0, 0], -2.0, 2.5)
_pr('sweeperStar', ('spinTimestretched',), 'BRUSH', 0x15AF40, [0, 0, 0, 0], -2.0, 2.5, 'aprox: como spin normal')
_pr('spiritSlasher', ('singleSlash', 'singleStarter'), 'SAMURAI', 0x22AD50, [1, 1, 0, 0], -2.0, 3.5)
_pr('spiritSlasher', ('doubleSlash', 'doubleStarter'), 'SAMURAI', 0x22AFF0, [1, 1, 0, 0], -2.0, 4.0)
# Pop, Don't Drop = PUTILABO (lab with the heated bubbles): native bubble appears at call+5, player pops at call+8
_pr('popDontDrop', ('softGrow',), 'PUTILABO', 0x20BF90, [0, 0, 0, 0], -5.0, 3.5)
_pr('popDontDrop', ('hardGrow',), 'PUTILABO', 0x20C190, [480, 0, 0, 0], -5.0, 3.5, 'aprox: burbuja dura = argumento nativo 480 (240/960 dan el mismo golpe)')
# Yum-Bot Simulator = SOFTCATCH: fn(defective, spacing ticks): cues at call+2 + i*spacing, catch at call+2+3*spacing
_pr('yumBotSimulator', ('pudding', 'puddingPractice'), 'SOFTCATCH', 0x248B70, [0, 320, 0, 0], -2.0, 2.5)
_pr('yumBotSimulator', ('puddingLong', 'puddingLongPractice'), 'SOFTCATCH', 0x248B70, [0, 480, 0, 0], -2.0, 3.5)
_pr('yumBotSimulator', ('defectivePudding',), 'SOFTCATCH', 0x248B70, [1, 320, 0, 0], -1.0, 3.5)
_pr('yumBotSimulator', ('defectivePuddingLong',), 'SOFTCATCH', 0x248B70, [1, 480, 0, 0], -1.0, 4.5)
_pr('stopNGoNStop', ('accel',), 'CARS', 0x1601D0, [1, 0, 0, 0], -0.5, 4.0)
_pr('stopNGoNStop', ('accelRemix7',), 'CARS', 0x1601D0, [0, 0, 0, 0], -2.5, 2.0)
_pr('stopNGoNStop', ('brake',), 'CARS', 0x1608F0, [0, -1, 0, 0], -2.0, 2.5)
_pr('flutterSpeed', ('butterfly', 'butterflyNoVoice'), 'INSECT', 0x1B54C0, [360, 1920, 0, 0], -4.0, 2.0)
_pr('flutterSpeed', ('butterflyRemix5', 'butterflyRemix5Counting', 'butterflyRemix5NoVoice', 'butterflyRemix5CountingNoVoice'),
    'INSECT', 0x1B54C0, [720, 1920, 0, 0], -4.0, 3.5)
_pr('flutterSpeed', ('grasshopper', 'grasshopperNoVoice'), 'INSECT', 0x1B5A60, [240, 1920, 0, 0], -4.0, 2.0)
_pr('flutterSpeed', ('grasshopperRemix5', 'grasshopperRemix5NoVoice'), 'INSECT', 0x1B5A60, [480, 1920, 0, 0], -4.0, 3.5)
_pr('flutterSpeed', ('dragonfly', 'dragonflyNoVoice'), 'INSECT', 0x1B60F0, [480, 1920, 0, 0], -3.0, 4.5)
_pr('canDo', ('blue',), 'HAMMER', 0x1ABCB0, [0, 0, 7680, 0], -14.0, 3.5, 'la lata se lanza 14 pulsos antes del primer beep')
_pr('canDo', ('blueFrog',), 'HAMMER', 0x1ABCB0, [-1200, 1, 7680, 0], -14.0, 3.5, 'aprox: rana = argumentos nativos -1200/1')
_pr('canDo', ('red',), 'HAMMER', 0x1AB410, [0, 0, 7680, 0], -14.5, 3.0, 'aprox: rojo alineado por el "ayy" (+1.5)')
_pr('canDo', ('redFrog',), 'HAMMER', 0x1AB410, [-960, 1, 7680, 0], -14.5, 3.0, 'aprox: rana = argumentos nativos -960/1')
_pr('hopNSlide', ('hop',), 'HURDLE', 0x1B1FC0, [0, 0, 0, 0], -6.0, 2.5)
_pr('hopNSlide', ('slide',), 'HURDLE', 0x1B1FC0, [1, 0, 0, 0], -6.5, 2.0, 'aprox: slide alineado por sliding3 (+1.5)')
_pr('alienAlphabet', ('cha', 'chaGrown'), 'TALK', 0x255100, [1, 0, 0, 0], -0.5, 3.5, 'aprox: voces del alien no verificadas')
# equidistant (stretchable) entities: cue i at beat + i*width. -> (GAME, fn, b arg, n cues, call offset)
# args: 'W' = width in ticks
EQUI_RULES = {'brollyGoodShow_cho': ('PARASOL', 0x204970, ['W', 0, 0, 0], 4, -3.0),
              'brollyGoodShow_pa': ('PARASOL', 0x204970, ['W', 1, 0, 0], 4, -3.0),
              'yumBotSimulator_puddingCueStretchable': ('SOFTCATCH', 0x248B70, [0, 'W', 0, 0], 4, -2.0),
              'yumBotSimulator_defectivePuddingCueStretchable': ('SOFTCATCH', 0x248B70, [1, 'W', 0, 0], 4, -2.0)}
# entities that are the player's own part or decoration (the game plays them by itself)
SKIP_ENTITIES = {'popDontDrop_softPop', 'popDontDrop_hardPop', 'yumBotSimulator_puddingCatch', 'yumBotSimulator_defectivePuddingWarning',
                 'yumBotSimulator_defectivePuddingDestroy', 'backupSpotlight_countStop', 'sweeperStar_sweepingStop'}
# start pattern + following stop pattern -> one call. (GAME, fn, b, c, call offset, a = stop - start + k, stop id, a if no stop)
PAIR_RULES = {
    'backupSpotlight_countDanceL': ('DANCER', 0x181210, 3, 0, -3.0, 2.0, 'backupSpotlight_countStop', 4),
    'backupSpotlight_countDanceR': ('DANCER', 0x181210, 3, 0, -3.0, 2.0, 'backupSpotlight_countStop', 4),
    'backupSpotlight_countElbow': ('DANCER', 0x181C70, 3, 0, -3.5, 2.5, 'backupSpotlight_countStop', 4),
    'sweeperStar_sweepingStart': ('BRUSH', 0x15A560, 1, 1, -2.0, 0.0, 'sweeperStar_sweepingStop', 8),
}
UNSUPPORTED_PATTERNS = {
    'sneezyMoon': 'red*/Prepare sueltos: el color rojo no es un argumento de la funcion nativa',
    'ribbitRocket': 'tadpole*/fgFrog: la funcion nativa de renacuajo tiene otro espaciado',
    'wiperBosses': 'bothAlternate: sin funcion nativa',
    'aForEffort': 'aaaa/aaaaa: sin palabra nativa',
    'lightningBolting': 'chain*: keepTheBeat, no hace falta',
    'soccerDreams': 'birds/ambience: decorado',
    'brollyGoodShow': 'cheering: decorado',
    'sliceNDiceKitchen': 'chopping*: keepTheBeat, no hace falta',
    'backupSpotlight': 'dance*/danceVoice: keepTheBeat, lo hace countDance/countStop',
    'sweeperStar': 'sweepingConstant*: keepTheBeat, lo hace sweepingStart',
    'spiritSlasher': 'chain/finisher/voces: sin funcion nativa calibrada',
    'yumBotSimulator': 'cues sueltos: usa los patrones pudding*/defectivePudding*',
    'alienAlphabet': 'bom/bomCha: sin funcion nativa calibrada',
    'popDontDrop': 'researchers/burner: decorado',
}
RHRE_GAME = {'hoopTrundling': 'RING', 'hoopTrundlingCast': 'RING', 'feedingTheBeast': 'HUNGRY', 'crabSnacks': 'CRAB', 'sneezyMoon': 'MOON', 'ribbitRocket': 'KAERU',
             'hopStopNRoll': 'ROLLING', 'fruitFlex': 'PUMPUP', 'wiperBosses': 'WIPER', 'soccerDreams': 'SOCCER',
             'lightningBolting': 'THUNDER', 'discDog': 'FLYDISC', 'aForEffort': 'THE_A', 'brollyGoodShow': 'PARASOL',
             'sliceNDiceKitchen': 'COOKING', 'backupSpotlight': 'DANCER', 'sweeperStar': 'BRUSH', 'spiritSlasher': 'SAMURAI',
             'yumBotSimulator': 'SOFTCATCH', 'stopNGoNStop': 'CARS', 'flutterSpeed': 'INSECT', 'popDontDrop': 'PUTILABO',
             'canDo': 'HAMMER', 'hopNSlide': 'HURDLE', 'alienAlphabet': 'TALK'}
PATTERN_GAMES = ('sneezyMoon', 'ribbitRocket', 'hopStopNRoll', 'fruitFlex', 'wiperBosses', 'soccerDreams', 'lightningBolting',
                 'discDog', 'aForEffort', 'brollyGoodShow', 'sliceNDiceKitchen', 'backupSpotlight', 'sweeperStar',
                 'spiritSlasher', 'yumBotSimulator', 'stopNGoNStop', 'flutterSpeed', 'popDontDrop', 'canDo', 'hopNSlide',
                 'alienAlphabet')
FN_RING, FN_HUNGRY, FN_MACARON, FN_FAVA = 0x217960, 0x1AF800, 0x17BFC0, 0x17D0D0
# scene field holding the main layout, per game (from the native REMIX_21 director, which plays "Remix8" on it)
LAYOUT_OFF = {'FLYDISC': 0x40B8, 'ROLLING': 0x3E08, 'HUNGRY': 0x3CB0, 'CARS': 0x3CB0, 'KAERU': 0x4778, 'CRAB': 0x3B58,
              'INSECT': 0x3CA8, 'SOFTCATCH': 0x3CB0, 'RING': 0x3B58, 'THUNDER': 0x3B58, 'HAMMER': 0x3B58, 'MOON': 0x3E00,
              'THE_A': 0x4360, 'PUTILABO': 0x3E08, 'WIPER': 0x3F60, 'SOCCER': 0x3E00, 'HURDLE': 0x3CB0, 'TALK': 0x3CB0,
              'COOKING': 0x3CB0, 'PARASOL': 0x3CA8, 'DANCER': 0x3E08, 'SAMURAI': 0x3E08, 'BRUSH': 0x40B0}
MAX_GAMES = 24   # engine v0.3.2+ (v0.3.0/0.3.1: 8)
MULTI_DEFAULTS = dict(bgm=0x8B, results='native', match=(-1, 9, 4), start=0, translen=960)  # start 0 = pulso 0 de RHRE; el 2880 nativo (0x3C0+1 compás) retrasaba startGameplay 6 pulsos con la canción ya sonando


def load_patterns_multi(sfxdb):
    """{pattern datamodel: [(full cue id, rel beat)]} for every supported RHRE game (built-in DB copy + user's DB)."""
    pats = {}
    for g in ('hoopTrundling', 'hoopTrundlingCast'):
        for k, v in BUILTIN_PATTERNS.items():
            pats['%s_%s' % (g, k)] = [(g + '/' + n, b) for n, b in v]
    pats.update({
        'feedingTheBeast_yellow': [('feedingTheBeast/shootYellow', 0.0), ('feedingTheBeast/chompYellow', 2.0)],
        'feedingTheBeast_yellowFlower': [('feedingTheBeast/shootYellow', 0.0), ('feedingTheBeast/chompYellow', 2.0)],
        'feedingTheBeast_purple': [('feedingTheBeast/shootPurple', 0.0), ('feedingTheBeast/chompPurple', 4.0)],
        'feedingTheBeast_purpleFlower': [('feedingTheBeast/shootPurple', 0.0), ('feedingTheBeast/chompPurple', 4.0)],
        'crabSnacks_macaron': [('crabSnacks/macaronhit', 0.0), ('crabSnacks/macaronhit', 2.0), ('crabSnacks/macaronhitplayer', 4.0), ('crabSnacks/macaronhole', 6.0)],
        'crabSnacks_macaronNoHole': [('crabSnacks/macaronhit', 0.0), ('crabSnacks/macaronhit', 2.0), ('crabSnacks/macaronhitplayer', 4.0)],
        'crabSnacks_favabeans': [('crabSnacks/favabeanhit1', 0.0), ('crabSnacks/favabeanhit2', 1.0), ('crabSnacks/favabeanhit1', 2.5), ('crabSnacks/favabeanhit2', 3.5),
                                 ('crabSnacks/favabeanhit1player', 5.0), ('crabSnacks/favabeanhit2player', 6.0), ('crabSnacks/favabeanhole', 7.5)],
        'crabSnacks_favabeansNoHole': [('crabSnacks/favabeanhit1', 0.0), ('crabSnacks/favabeanhit2', 1.0), ('crabSnacks/favabeanhit1', 2.5), ('crabSnacks/favabeanhit2', 3.5),
                                       ('crabSnacks/favabeanhit1player', 5.0), ('crabSnacks/favabeanhit2player', 6.0)],
    })
    if sfxdb:
        for g in ('feedingTheBeast', 'crabSnacks', 'hoopTrundling', 'hoopTrundlingCast'):
            f = os.path.join(sfxdb, g, 'data.json')
            if not os.path.isfile(f):
                continue
            d = json.load(open(f, encoding='utf-8'))
            for o in d.get('objects', []):
                if o.get('type') != 'pattern':
                    continue
                cues = [(c['id'].replace('*', g), float(c['beat'])) for c in o.get('cues', [])]
                if any(c.split('/')[0] != g for c, _ in cues):
                    continue  # nested patterns: keep the built-in expansion
                for i in [o['id']] + list(o.get('deprecatedIDs', [])):
                    pats[i.replace('*', g)] = cues
    return pats


CUE_ALIAS = {'hoopPass': 'hoop', 'pinkHeartShoot': 'shootYellow', 'munch1': 'chompYellow', 'greenHeartShoot': 'shootPurple',
             'munch2': 'chompPurple', 'macaronvoice': 'macaronhitplayer', 'mangosteenvoice': 'mangosteenhitplayer',
             'favabeanhit': 'favabeanhit1', 'favabeanvoice1': 'favabeanhit1player', 'favabeanvoice2': 'favabeanhit2player'}


def split_cue(cid):
    g, _, n = cid.partition('/')
    if g == 'hoopTrundlingCastOfCharacters': g = 'hoopTrundlingCast'
    return g, CUE_ALIAS.get(n, n)


def rhre2gtlm(args):
    remix = read_remix(args.remix)
    pats = load_patterns_multi(args.sfxdb or default_sfxdb())
    cues = []       # (beat, rhre game, cue name)
    extra = []      # (beat, text)
    changes = []    # gameChange beats
    origin = None; end_beat = None; ignored = {}; unsupported = {}; notes = {}; loose = {}
    calls = []   # (call beat, visible beat, game, fn, args, label, end beat)
    pairs = []; stops = []
    for e in remix.get('entities', []):
        dm = e.get('datamodel', ''); b = float(e.get('beat', 0.0))
        if dm in ('special_subtitleEntity', 'special_songTitleEntity', 'special_songArtistEntity'):
            t = (e.get('subtitle') or '').strip()
            if t.lower().startswith('gtl:'):
                t = t[4:].strip()
                if t == 'origin': origin = b
                else: extra.append((b, t))
            continue
        if dm == 'special_endEntity': end_beat = b; continue
        if dm in ('special/gameChange', 'special_gameChange', 'gameChange'): changes.append(b); continue
        if dm in EQUI_RULES:
            eg, ef, ea, en, ec = EQUI_RULES[dm]
            w = float(e.get('width', 1.0))
            calls.append((b + ec, b, eg, ef, [int(round(w * TPB)) if x == 'W' else x for x in ea], 'equi', b + (en - 1) * w + 0.5))
            continue
        if dm in PAIR_RULES:
            pairs.append((b, dm)); continue
        if dm in [r[6] for r in PAIR_RULES.values()]:
            stops.append((b, dm)); continue
        if dm in SKIP_ENTITIES or dm.startswith('popDontDrop/'): continue
        if dm in PATTERN_RULES:
            pg, pf, pa, pc, pe, note = PATTERN_RULES[dm]
            calls.append((b + pc, b, pg, pf, list(pa), 'basic', b + pe))
            if note: notes[dm + ': ' + note] = notes.get(dm + ': ' + note, 0) + 1
            continue
        if dm in pats:
            for cid, rb in pats[dm]:
                g, n = split_cue(cid); cues.append((b + rb, g, n))
            continue
        g, n = split_cue(dm)
        if '/' in dm and g in RHRE_GAME:
            cues.append((b, g, n)); continue
        root = re.split(r'[/_]', dm)[0]
        if root in PATTERN_GAMES:
            if '/' in dm: loose[root] = loose.get(root, 0) + 1
            else: unsupported[dm] = unsupported.get(dm, 0) + 1
            continue
        if root in RHRE_GAME:
            unsupported[dm] = unsupported.get(dm, 0) + 1
        else:
            ignored[root] = ignored.get(root, 0) + 1
    for b, dm in sorted(pairs):
        pg, pf, pb, pc, po, pk, sid, adef = PAIR_RULES[dm]
        nxt = [s for s, sd in stops if sd == sid and s > b]
        later = [b2 for b2, d2 in pairs if PAIR_RULES[d2][6] == sid and b2 > b]
        if nxt and (not later or nxt[0] < min(later) + 1e-3):
            a = nxt[0] - b + pk; end = nxt[0] + 3.5
        else:
            a = adef; end = b - po + 1 + adef; warn('%s en beat %g sin %s despues: duracion %d pulsos' % (dm, b, sid, adef))
        if abs(a - round(a)) > 1e-3:
            warn('%s en beat %g: el stop no cae en el pulso nativo; redondeado' % (dm, b))
        calls.append((b + po, b, pg, pf, [int(round(a)), pb, pc, 0], 'par', end))
    if ignored:
        warn('ignorados (juegos sin mapeo RHRE todavia; puedes usar subtitulos "gtl: X ..."): ' + ', '.join('%s x%d' % kv for kv in sorted(ignored.items())))
    for k, v in sorted(unsupported.items()):
        r = UNSUPPORTED_PATTERNS.get(re.split(r'[/_]', k)[0])
        warn('patron no soportado por el juego: %s x%d (ver LEEME)%s' % (k, v, (' [' + r + ']') if r else ''))
    for k, v in sorted(loose.items()):
        warn('%s: %d cues sueltos ignorados; para este juego usa los patrones de RHRE (no los cues sueltos)' % (k, v))
    for k, v in sorted(notes.items()):
        warn('%s (x%d)' % (k, v))
    if origin is None: origin = args.origin_beat
    tempos = remix.get('trackers', {}).get('tempos', {}).get('trackers', [])
    if len(set(float(t.get('bpm', 0)) for t in tempos)) > 1:
        warn('el remix tiene cambios de tempo: el juego cuenta en pulsos y sigue el tempo de su propia cancion (bgm)')
    if remix.get('musicData', {}).get('present'):
        warn('la musica del remix NO se lleva al juego: suena la cancion nativa del bgm elegido')

    def tick(b):
        v = (b - origin) * TPB; r = int(round(v))
        if abs(v - r) > 0.01: warn('beat %g no cae en un tick entero; redondeado' % b)
        return r
    eps = 1e-3
    # ---- RING: one call per hoop cue (v0.1 logic)
    for gname in ('hoopTrundling', 'hoopTrundlingCast'):
        syl = [(b, n) for b, g, n in cues if g == gname and n in SYL_OFF]
        used = set()
        for h in sorted(b for b, g, n in cues if g == gname and n == 'hoop'):
            mask = 0
            for i, s in enumerate(SYL):
                hit = [k for k, (b, n) in enumerate(syl) if n == s and abs(b - (h + SYL_OFF[s])) < eps]
                if hit:
                    used.update(hit)
                    if s != 'po': mask |= 1 << i
            calls.append((h, h + 1, 'RING', FN_RING, [-1 if mask == 15 else mask], 'aro', h + 3.5))
        lone = [syl[k] for k in range(len(syl)) if k not in used]
        if lone: warn('%d silabas de Hoop Trundling sin "hoop" (+1..+3 pulsos antes)' % len(lone))
    # ---- HUNGRY: one call per shoot (or per lone chomp)
    for color, (sh, ch, d) in enumerate((('shootYellow', 'chompYellow', 2.0), ('shootPurple', 'chompPurple', 4.0))):
        shots = sorted(b for b, g, n in cues if g == 'feedingTheBeast' and n == sh)
        chomps = sorted(b for b, g, n in cues if g == 'feedingTheBeast' and n == ch)
        for s in shots:
            calls.append((s - 8.0, s, 'HUNGRY', FN_HUNGRY, [color], 'flor', s + d + 0.5))
        for c in chomps:
            if not any(abs(c - d - s) < eps for s in shots):
                warn('mordisco %s en beat %g sin disparo: se crea el disparo a -%g' % (ch, c, d))
                calls.append((c - d - 8.0, c - d, 'HUNGRY', FN_HUNGRY, [color], 'flor', c + 0.5))
    # ---- CRAB: one call per player hit
    crab = [(b, n) for b, g, n in cues if g == 'crabSnacks']
    for b, n in crab:
        if n == 'macaronhitplayer':
            if not any(abs(b2 - (b + 2)) < eps and n2 == 'macaronhole' for b2, n2 in crab):
                warn('macaron en beat %g sin "hole": en el juego el macaron siempre se lanza al agujero' % (b - 4))
            calls.append((b - 6.0, b - 4.0, 'CRAB', FN_MACARON, [-1, -1, -1], 'macaron', b + 2.5))
        elif n == 'favabeanhit1player':
            nxt = [b2 - b for b2, n2 in crab if n2 == 'favabeanhit2player' and 0 < b2 - b < 1.5]
            if nxt and abs(nxt[0] - 0.5) < eps:
                warn('habas "Remix16" (mitad de espacio) en beat %g: el juego no tiene esa version; omitido' % (b - 2.5)); continue
            calls.append((b - 7.0, b - 5.0, 'CRAB', FN_FAVA, [-1, -1, -1], 'habas', b + 3.0))
        elif n == 'mangosteenhitplayer':
            warn('mangostan en beat %g: sin funcion nativa en los remixes; omitido' % (b - 3))
    # ---- raw calls from subtitles: "gtl: X GAME 0xFN a b c d [tag]"
    hdr = dict(MULTI_DEFAULTS)
    if args.match: hdr['match'] = tuple(args.match)
    if args.bgm is not None: hdr['bgm'] = args.bgm
    lines = []   # (tick, order, text)
    end_tick = fade = finish = None
    switches_explicit = []
    for b, t in extra:
        k = t.split()
        if not k: continue
        op = k[0].lower()
        if op == 'x' and len(k) >= 4 and (k[1].upper(), int(k[2], 0)) in WORD_FNS:
            calls.append((b, b, k[1].upper(), int(k[2], 0), [k[3].upper()], k[4] if len(k) > 4 else None, b + 4.0))
        elif op == 'x' and len(k) >= 3:
            calls.append((b, b, k[1].upper(), int(k[2], 0), [int(x, 0) for x in k[3:7] if re.match(r'^-?(0x)?[0-9a-fA-F]+$', x)],
                          k[-1] if not re.match(r'^-?(0x)?[0-9a-fA-F]+$', k[-1]) and len(k) > 3 else None, b + 4.0))
        elif op == 'anim' and len(k) >= 3:
            g = k[1].upper()
            if len(k) >= 4 and re.match(r'^(0x)?[0-9a-fA-F]+$', k[2]):
                off, nm = k[2], k[3]
            elif g in LAYOUT_OFF:
                off, nm = '0x%X' % LAYOUT_OFF[g], k[2]
            else:
                warn('anim: no conozco el layout de %s; usa "gtl: anim %s 0xOFFSET Nombre"' % (g, g)); continue
            lines.append((tick(b), 2, 'A %d %s %s %s' % (tick(b), g, off, nm)))
        elif op == 'fade' and len(k) >= 3:
            lines.append((tick(b), 2, 'F %d %d %s' % (tick(b), int(k[1]), k[2])))
        elif op == 'switch' and len(k) >= 2:
            switches_explicit.append((b, k[1].upper(), ' '.join(k[2:])))
        elif op == 'end':
            end_tick = tick(b); fade = int(k[1]) if len(k) > 1 else None
        elif op == 'finish': finish = tick(b)
        elif op == 'start': hdr['start'] = tick(b)
        elif op == 'translen' and len(k) > 1: hdr['translen'] = int(k[1])
        elif op == 'title' and len(k) > 1: hdr['title'] = ' '.join(t.split()[1:])
        else: warn('subtitulo gtl desconocido: ' + t)
    if not calls:
        sys.exit('ERROR: el remix no tiene cues de juegos soportados (ver tabla del LEEME) ni "gtl: X"; '
                 'el motor necesita al menos una llamada aunque haya "gtl: switch"')
    for c in calls:
        if c[2] not in MULTI_FNS or c[3] not in MULTI_FNS[c[2]]:
            sys.exit('ERROR: llamada no permitida %s 0x%X (ver tabla en LEEME)' % (c[2], c[3]))
        if (c[2], c[3]) in WORD_FNS and (len(c[4]) != 1 or c[4][0] not in WORD_FNS[(c[2], c[3])]):
            sys.exit('ERROR: %s 0x%X necesita una palabra: %s' % (c[2], c[3], '|'.join(WORD_FNS[(c[2], c[3])])))
    calls.sort(key=lambda c: (c[1], c[0]))
    # ---- scene switches. Segments = runs of calls of the same game (by visible beat).
    # The new scene must be on screen before its first call (the cue function
    # starts the animation right away; Feeding the Beast needs 8 beats of lead)
    # and the old one must stay until its last player hit has passed.
    # v0.4.1: every "gtl: switch GAME [hard|cut|0|1|2]" is emitted at its exact beat, even with no cues
    # around it (visual-only switches, e.g. an intro that flashes through several games).
    # Segment boundaries without an explicit switch still get an automatic one.
    def norm_style(st, b):
        st = st.strip().lower()
        if st in ('', 'soft', 'fade', 'normal'): return ''
        if st in ('hard', 'cut', 'corte'): return 'cut'
        if st in ('0', '1', '2'): return st
        warn('switch en beat %g: estilo "%s" desconocido (usa hard o nada); se usa el normal' % (b, st)); return ''
    exp = []
    for b, g, st in sorted(switches_explicit, key=lambda x: x[0]):
        if g not in MULTI_GAMES:
            warn('switch en beat %g: juego %s desconocido (juegos: %s); omitido' % (b, g, ' '.join(MULTI_GAMES))); continue
        exp.append((b, g, norm_style(st, b)))
    first_call_beat = min(c[0] for c in calls)
    first = calls[0][2]
    if exp and exp[0][0] <= first_call_beat + eps:
        first = exp[0][1]
        if exp[0][0] <= origin + hdr['start'] / float(TPB) + eps:
            exp = exp[1:]   # the stage opens on this game anyway (header "first")
    segs = []
    for c in calls:
        if not segs or segs[-1]['g'] != c[2]:
            segs.append(dict(g=c[2], first_call=c[0], first_vis=c[1], end=c[6]))
        else:
            segs[-1]['first_call'] = min(segs[-1]['first_call'], c[0]); segs[-1]['end'] = max(segs[-1]['end'], c[6])
    def visible_at(t, extra_sw):
        v = first
        for b, g, _ in sorted(exp + extra_sw, key=lambda x: x[0]):
            if b <= t + eps: v = g
        return v
    sw = []
    for i in range(len(segs)):
        cur = segs[i]
        if visible_at(cur['first_call'], sw) == cur['g']: continue
        prev = segs[i - 1] if i else None
        lo = prev['end'] if prev else -1e9
        hi = cur['first_call']
        lo = max([lo] + [b for b, _, _ in exp if b <= hi + eps])
        pv = prev['first_vis'] if prev else -1e9
        marks = [b for b in changes if pv < b <= cur['first_vis'] + eps]
        at = marks[0] if marks else hi
        if hi < lo - eps:
            warn('%s -> %s: no cabe el cambio de escena (el ultimo golpe de %s es en el beat %g y %s necesita estar en pantalla desde el beat %g). '
                 'Separa mas los juegos; se cambia en el beat %g' % (prev['g'] if prev else '-', cur['g'], prev['g'] if prev else '-', lo, cur['g'], hi, hi))
            at = hi
        elif at > hi + eps:
            warn('gameChange en beat %g llega tarde para %s (su primera llamada es en el beat %g): se adelanta' % (at, cur['g'], hi)); at = hi
        elif at < lo - eps:
            warn('gameChange en beat %g corta a %s (ultimo golpe en %g): se retrasa' % (at, prev['g'] if prev else '-', lo)); at = lo
        if exp:
            warn('%s en beat %g: no hay "gtl: switch %s" antes de su primer cue; se anade un cambio automatico en el beat %g' % (cur['g'], cur['first_vis'], cur['g'], at))
        sw.append((at, cur['g'], ''))
    if len(segs) > 1 and not changes and not exp:
        warn('sin "gameChange": cambios de escena automaticos justo antes de la primera llamada de cada juego')
    # explicit switch that cuts away from a game whose pattern is still running
    for b, g, _ in exp:
        for c in calls:
            if c[2] != g and c[0] < b - eps < c[6] - 0.5 and visible_at(b - 2 * eps, sw) == c[2]:
                warn('switch a %s en beat %g corta un patron de %s que sigue hasta el beat %g' % (g, b, c[2], c[6] - 0.5)); break
    # drop switches to the game already on screen
    allsw = []; vis = first
    for b, g, st in sorted(exp + sw, key=lambda x: x[0]):
        if g == vis: warn('switch a %s en beat %g: ya esta en pantalla; omitido' % (g, b)); continue
        allsw.append((b, g, st)); vis = g
    trans = hdr['translen'] / float(TPB)
    for (b1, _, s1), (b2, g2, _) in zip(allsw, allsw[1:]):
        if s1 != 'cut' and b2 - b1 < trans - eps:
            warn('switch a %s en beat %g: el cambio anterior (beat %g) es suave y dura %g pulsos; el juego lo retrasa. Usa "hard" para cambios rapidos' % (g2, b2, b1, trans))
    sw = allsw
    for b, g, style in sw:
        if tick(b) < 0:
            warn('switch a %s en beat %g esta antes del tick 0 (gtl: origin); omitido' % (g, b)); continue
        lines.append((tick(b), 1, ('W %d %s %s' % (tick(b), g, style)).strip()))
    for cb, vb, g, f, a, lab, _e in calls:
        tk = tick(cb)
        if tk < 0:
            warn('%s en beat %g necesita llamarse %g pulsos antes (tick %d < 0): omitido; deja mas intro' % (g, vb, vb - cb, tk)); continue
        tag = {'aro': 'basic', 'flor': 'basic', 'macaron': 'basic', 'habas': 'basic'}.get(lab, lab) or '-'
        lines.append((tk, 3, ('X %d %s 0x%X %s %s' % (tk, g, f, ' '.join(str(x) for x in a), tag)).replace('  ', ' ')))
    last_vis = max(tick(c[1]) for c in calls)
    if end_tick is None:
        end_tick = tick(end_beat) if end_beat is not None else last_vis + 4 * TPB
    if fade is None: fade = 960
    if finish is None or finish < end_tick: finish = end_tick + 1920
    lines.sort(key=lambda x: (x[0], x[1]))
    if lines and lines[-1][0] > end_tick:
        sys.exit('ERROR: hay eventos despues del final (tick %d > end %d)' % (lines[-1][0], end_tick))
    games = [first]
    for _, _, t in lines:
        k = t.split()
        if k[0] in 'XWA' and k[2] not in games: games.append(k[2])
    out = ['GTLM 1', '# Generado por groove_rhre.py v0.4.1 desde %s' % os.path.basename(args.remix),
           '# Solo datos de tiempo. 480 ticks por pulso; tick 0 = beat %g del remix (= justo tras arrancar la cancion).' % origin,
           '# Juegos: %s' % ' '.join(games),
           'ticks_per_beat 480', 'bgm %d' % hdr['bgm'], 'results %s' % hdr['results'], 'match %d %d %d' % tuple(hdr['match']),
           'start %d' % hdr['start'], 'translen %d' % hdr['translen'], 'first %s' % first,
           'end %d %d' % (end_tick, fade), 'finish %d' % finish]
    if hdr.get('title'): out.append('title %s' % hdr['title'].replace('#', ''))
    out.append('# --- eventos')
    out += [t for _, _, t in lines]
    text = '\n'.join(out) + '\n'
    open(args.output, 'w', encoding='utf-8', newline='\n').write(text)
    rep = check_multi(text)
    print('OK: %s  juegos=%s llamadas=%d cambios=%d end=%d finish=%d' % (args.output, ','.join(games), rep['calls'], rep['switches'], end_tick, finish))
    print_multi(rep)
    return 0 if rep['ok'] else 1


# ---- The same validated GTLM parser as the GTF compiler (no token truncation).
def check_multi(text):
    try:
        from . import gtf
    except ImportError:
        import gtf
    r = dict(ok=False, errors=[], warnings=[], calls=0, switches=0, fades=0, anims=0,
             games=[], first=None, end=-1, finish=-1, start=2880, match=(-1,9,4), bgm=0x8B)
    try:
        timeline=gtf.parse_gtl(text)
    except gtf.GtfError as e:
        r['errors'].append(str(e)); return r
    for key in ('start','end','finish','first','match','bgm'): r[key]=getattr(timeline,key)
    r['games']=timeline.games_used()
    for op,key in [('call','calls'),('switch','switches'),('fade','fades'),('anim','anims')]:
        r[key]=sum(e.op==op for e in timeline.events)
    for game in r['games']:
        times=[e.tick for e in timeline.events if e.op=='call' and e.game==game]
        gaps=[b-a for a,b in zip(times,times[1:])]
        if gaps and min(gaps)<240:r['warnings'].append('%s: llamadas a menos de medio pulso (%d ticks)'%(game,min(gaps)))
    r['ok']=True
    return r


def print_multi(rep):
    print('check: %s | juegos=%s primero=%s llamadas=%d cambios=%d fundidos=%d anims=%d start=%d end=%d finish=%d match=%s bgm=%d' %
          ('VALIDO' if rep['ok'] else 'INVALIDO', ','.join(rep['games']), rep['first'], rep['calls'], rep['switches'], rep['fades'],
           rep['anims'], rep['start'], rep['end'], rep['finish'], rep['match'], rep['bgm']))
    for e in rep['errors']: print('  ERROR: ' + e)
    for w in rep['warnings']: print('  aviso: ' + w)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('rhre2gtl', help='remix (.rhref/.rhre3/remix.json) -> .gtl')
    a.add_argument('remix'); a.add_argument('-o', '--output', required=True)
    a.add_argument('--template', help='.gtl del que copiar cabecera, comentarios y fondo (p.ej. ht3.gtl)')
    a.add_argument('--no-template-events', action='store_true', help='no copiar C/A/S de la plantilla')
    a.add_argument('--origin-beat', type=float, default=0.0, help='beat del remix que es el tick 0 del juego (o subtitulo "gtl: origin")')
    a.add_argument('--match', type=int, nargs=3, metavar=('MUNDO', 'COL', 'FILA'))
    a.add_argument('--bgm', type=int)
    a.add_argument('--full-mask', type=int, choices=(-1, 15), default=-1)
    a.add_argument('--sfxdb', help='carpeta sfx/games de RHREfresh (por defecto se busca sola)')
    b = sp.add_parser('gtl2rhre', help='.gtl -> .rhref para editarlo en RHREfresh')
    b.add_argument('gtl'); b.add_argument('-o', '--output', required=True)
    b.add_argument('--bpm', type=float, default=120.0)
    b.add_argument('--game', default='hoopTrundling', choices=GAMES)
    m = sp.add_parser('rhre2gtlm', help='remix con varios juegos -> .gtl multi (GTLM, escenario REMIX_21)')
    m.add_argument('remix'); m.add_argument('-o', '--output', required=True)
    m.add_argument('--origin-beat', type=float, default=0.0)
    m.add_argument('--match', type=int, nargs=3, metavar=('MUNDO', 'COL', 'FILA'))
    m.add_argument('--bgm', type=int)
    m.add_argument('--sfxdb')
    c = sp.add_parser('check', help='valida un .gtl con las mismas reglas que el motor')
    c.add_argument('gtl')
    args = ap.parse_args()
    if args.cmd == 'rhre2gtl': return rhre2gtl(args)
    if args.cmd == 'gtl2rhre': return gtl2rhre(args)
    if args.cmd == 'rhre2gtlm': return rhre2gtlm(args)
    txt = open(args.gtl, encoding='utf-8').read()
    if txt.lstrip().startswith('GTLM'):
        rep = check_multi(txt); print_multi(rep); return 0 if rep['ok'] else 1
    rep = check_text(open(args.gtl, encoding='utf-8').read()); print_report(rep); return 0 if rep['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
