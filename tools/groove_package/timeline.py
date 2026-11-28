"""Timeline validation using the GE-151 hardened parser (vendored, pinned).

Adds the Draft 0.2 runtime rules on top of the native-equivalent grammar:
explicit single start and 'results exit' (Draft 0.3), no explicit match, no native results, GTLM 1 only
for .gtl (GTL1/Hoop is legacy), exact size/line/token limits.
"""
from . import limits
from .errors import PackageError
from .vendor import gtf


def _directives_gtf(text):
    out = []
    for no, raw in enumerate(text.split("\n"), 1):
        body = gtf.strip_comment(raw).strip()
        if body:
            toks = gtf.tokenize(body)
            if toks:
                out.append((no, toks[0].lower(), toks))
    return out


def _directives_gtl(text):
    out = []
    for no, raw in enumerate(text.split("\n"), 1):
        parts = raw.split("#", 1)[0].split()
        if parts:
            out.append((no, parts[0].lower(), parts))
    return out


def validate_timeline(raw: bytes, fmt: str, path: str):
    """Return (gtf.Timeline, info dict). Raises PackageError."""
    if not (limits.MIN_TIMELINE_BYTES <= len(raw) <= limits.MAX_TIMELINE_BYTES):
        raise PackageError("TIMELINE_SIZE", f"{len(raw)} bytes (allowed 1-{limits.MAX_TIMELINE_BYTES})", path)
    if raw.startswith(b"\xef\xbb\xbf"):
        raise PackageError("TIMELINE_UTF8", "UTF-8 BOM not allowed", path)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise PackageError("TIMELINE_UTF8", "timeline is not valid UTF-8", path) from None
    try:
        if fmt == "gtf":
            tl = gtf.compile_gtf(text, path)
            dirs = _directives_gtf(text)
        else:
            first = next((ln.split("#", 1)[0].split() for ln in text.split("\n")
                          if ln.split("#", 1)[0].strip()), [])
            if first[:1] == ["GTL1"]:
                raise PackageError("UNSUPPORTED_TIMELINE", "GTL1 (Hoop) is legacy and not allowed in runtime packages", path)
            tl = gtf.parse_gtl(text, path)
            dirs = _directives_gtl(text)
    except PackageError:
        raise
    except gtf.GtfError as e:
        raise PackageError("TIMELINE_INVALID", e.message + (f" (line {e.line})" if e.line else ""), path) from None
    except (ValueError, RecursionError) as e:
        raise PackageError("TIMELINE_INVALID", str(e), path) from None
    seen = {}
    for no, k, toks in dirs:
        seen.setdefault(k, []).append((no, toks))
        if k in ("force", "disable"):
            raise PackageError("TIMELINE_FORBIDDEN", f"{toks[0]} is not allowed (line {no})", path)
    if "match" in seen:
        raise PackageError("TIMELINE_MATCH", f"explicit match directive (line {seen['match'][0][0]}); "
                                             "the registry assigns the slot", path)
    for k in ("start", "results"):
        if len(seen.get(k, [])) > 1:
            raise PackageError("TIMELINE_DUPLICATE_DIRECTIVE",
                               f"{k} appears {len(seen[k])} times (lines {[n for n, _ in seen[k]]})", path)
    if "start" not in seen:
        raise PackageError("TIMELINE_NO_START", "explicit start required (GTF default 0 vs GTLM default 2880)", path)
    if "results" not in seen:
        raise PackageError("TIMELINE_NO_RESULTS", "explicit 'results exit' required", path)
    rtoks = seen["results"][0][1]
    if len(rtoks) >= 2 and rtoks[1].lower() == "native" or tl.results == 1:
        raise PackageError("NATIVE_RESULTS", "results native is not allowed in runtime packages", path)
    if len(rtoks) != 2 or rtoks[1] != "exit":
        raise PackageError("TIMELINE_RESULTS_NOT_EXIT", f"results must be exactly 'results exit' (got {' '.join(rtoks)})", path)
    info = {"title": tl.title, "start": tl.start, "end": tl.end, "finish": tl.finish,
            "games": tl.games_used(), "events": len(tl.events)}
    return tl, info
