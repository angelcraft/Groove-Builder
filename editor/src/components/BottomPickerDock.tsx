import React, { useMemo, useState } from 'react';
import {
  Search,
  Star,
  Plus,
  ArrowRightLeft,
  Volume2,
  Sparkles,
  BookmarkPlus,
  Trash2,
  Stamp,
  Clock,
  Layers,
} from 'lucide-react';
import {
  type CueDef,
  GAME_META,
  type GameId,
  GAMES,
  getCuesForGame,
  LAYOUT_OFF,
} from '../engine/cues.ts';
import { type StoredPattern } from '../engine/patternStore.ts';
import { TPB } from '../engine/cues.ts';

interface BottomPickerDockProps {
  selectedGame: GameId;
  onSelectGame: (g: GameId) => void;
  favoriteGames: GameId[];
  recentGames: GameId[];
  onToggleFavorite: (g: GameId) => void;
  storedPatterns: StoredPattern[];
  activePatternId: string | null;
  onSelectPattern: (id: string | null) => void;
  onSaveSelectionAsPattern: () => void;
  onDeletePattern: (id: string) => void;
  canSavePattern: boolean;
  onInsertCue: (cue: CueDef, withSwitch: boolean) => void;
  onStampPattern: (pattern: StoredPattern, withSwitch: boolean) => void;
  onAuditionCue: (cue: CueDef) => void;
  onAuditionPattern: (pattern: StoredPattern) => void;
  onInsertSwitch: (game: GameId, cut: boolean) => void;
  onInsertFade: () => void;
  onInsertAnim: (game: GameId) => void;
  onDragStartCue: (cue: CueDef) => void;
  onActivateStampTool: () => void;
  mobileFullHeight?: boolean;
}

type PickerTab =
  | 'ALL'
  | 'FAVORITES'
  | 'RECENTS'
  | 'PATTERNS'
  | 'Sports & Action'
  | 'Creatures & Food'
  | 'Music & Stage'
  | 'Sci-Fi & Quirky';

export const BottomPickerDock: React.FC<BottomPickerDockProps> = ({
  selectedGame,
  onSelectGame,
  favoriteGames,
  recentGames,
  onToggleFavorite,
  storedPatterns,
  activePatternId,
  onSelectPattern,
  onSaveSelectionAsPattern,
  onDeletePattern,
  canSavePattern,
  onInsertCue,
  onStampPattern,
  onAuditionCue,
  onAuditionPattern,
  onInsertSwitch,
  onInsertFade,
  onInsertAnim,
  onDragStartCue,
  onActivateStampTool,
  mobileFullHeight = false,
}) => {
  const [tab, setTab] = useState<PickerTab>('ALL');
  const [query, setQuery] = useState('');

  const favSet = useMemo(() => new Set(favoriteGames), [favoriteGames]);
  const q = query.trim().toLowerCase();

  const visibleGames = useMemo(() => {
    let base: GameId[] = [...GAMES];
    if (tab === 'FAVORITES') {
      base = GAMES.filter((g) => favSet.has(g));
    } else if (tab === 'RECENTS') {
      base = recentGames.length ? recentGames : GAMES.slice(0, 6);
    } else if (
      tab === 'Sports & Action' ||
      tab === 'Creatures & Food' ||
      tab === 'Music & Stage' ||
      tab === 'Sci-Fi & Quirky'
    ) {
      base = GAMES.filter((g) => GAME_META[g].category === tab);
    }
    if (!q) return base;
    return base.filter((g) => {
      const m = GAME_META[g];
      if (
        m.id.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.rhreName.toLowerCase().includes(q)
      ) {
        return true;
      }
      return getCuesForGame(g).some(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [tab, favSet, recentGames, q]);

  const gameCues = useMemo(() => {
    const all = getCuesForGame(selectedGame);
    if (!q) return all;
    const filtered = all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q))
    );
    return filtered.length ? filtered : all;
  }, [selectedGame, q]);

  const visiblePatterns = useMemo(() => {
    if (!q) return storedPatterns;
    return storedPatterns.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.primaryGame.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [storedPatterns, q]);

  const activeMeta = GAME_META[selectedGame];

  const filterButtons: Array<{ id: PickerTab; label: string }> = [
    { id: 'ALL', label: 'All 24' },
    { id: 'FAVORITES', label: 'Favorites' },
    { id: 'RECENTS', label: 'Recents' },
    { id: 'PATTERNS', label: `Patterns (${storedPatterns.length})` },
    { id: 'Sports & Action', label: 'Sports' },
    { id: 'Creatures & Food', label: 'Creatures' },
    { id: 'Music & Stage', label: 'Stage' },
    { id: 'Sci-Fi & Quirky', label: 'Sci-Fi' },
  ];

  return (
    <section
      className={`flex flex-col bg-[#12161F] border-t border-white/10 overflow-hidden ${
        mobileFullHeight ? 'h-full' : 'h-[248px] shrink-0'
      }`}
      aria-label="RHREfresh Cue and Pattern Picker"
    >
      {/* Top Bar of Picker: Search + Quick Track Events + Save Selection as Pattern */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-[#151A24] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative w-48 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter games, cues, patterns..."
              className="w-full h-7 pl-8 pr-2.5 rounded-md border border-white/10 bg-[#0E1117] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
            />
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-300">
            <span
              className="w-2.5 h-2.5 rounded-xs shrink-0"
              style={{ backgroundColor: activeMeta.accent }}
            />
            <span className="font-semibold text-white">{activeMeta.title}</span>
            <span className="font-mono text-[11px] text-slate-400">
              {activeMeta.id} · -{activeMeta.defaultLeadInBeats}b lead
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            disabled={!canSavePattern}
            onClick={onSaveSelectionAsPattern}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-35 text-[11px] font-semibold text-emerald-200 whitespace-nowrap shrink-0"
            title="Save selected timeline events as a reusable RHREfresh pattern"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            Save Pattern
          </button>
          <button
            type="button"
            onClick={() => onInsertSwitch(selectedGame, false)}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
          >
            <ArrowRightLeft className="w-3 h-3 text-sky-400" />
            Switch
          </button>
          <button
            type="button"
            onClick={() => onInsertSwitch(selectedGame, true)}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
          >
            Cut
          </button>
          {LAYOUT_OFF[selectedGame] !== undefined && (
            <button
              type="button"
              onClick={() => onInsertAnim(selectedGame)}
              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              Anim
            </button>
          )}
          <button
            type="button"
            onClick={onInsertFade}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
          >
            Fade
          </button>
        </div>
      </div>

      {/* RHREfresh 3-Tier Picker Columns */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Column 1: Filter Tabs */}
        <div className="flex lg:flex-col gap-1 p-2 border-b lg:border-b-0 lg:border-r border-white/10 bg-[#10141C] overflow-x-auto lg:overflow-y-auto lg:w-40 shrink-0">
          {filterButtons.map((fb) => {
            const active = tab === fb.id;
            return (
              <button
                key={fb.id}
                type="button"
                onClick={() => setTab(fb.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-left text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#FF5A36] text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {fb.id === 'FAVORITES' && <Star className="w-3 h-3 shrink-0" />}
                {fb.id === 'RECENTS' && <Clock className="w-3 h-3 shrink-0" />}
                {fb.id === 'PATTERNS' && <Layers className="w-3 h-3 shrink-0" />}
                <span className="truncate">{fb.label}</span>
              </button>
            );
          })}
        </div>

        {/* Column 2: 24-Game Selector Grid (hidden when viewing Patterns tab on mobile, always visible beside on desktop unless PATTERNS) */}
        {tab !== 'PATTERNS' && (
          <div className="lg:w-[44%] overflow-y-auto p-2 border-b lg:border-b-0 lg:border-r border-white/10">
            {visibleGames.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">No matching minigames.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                {visibleGames.map((g) => {
                  const m = GAME_META[g];
                  const active = g === selectedGame;
                  const isFav = favSet.has(g);
                  return (
                    <div
                      key={g}
                      onClick={() => {
                        onSelectGame(g);
                        onSelectPattern(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectGame(g);
                          onSelectPattern(null);
                        }
                      }}
                      className={`group relative flex items-center gap-2 p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                        active
                          ? 'border-[#FF5A36] bg-[#1E2534]'
                          : 'border-white/10 bg-[#161B25] hover:border-white/25'
                      }`}
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center font-display text-[10px] font-extrabold text-white shrink-0"
                        style={{ backgroundColor: m.accent }}
                      >
                        {m.id.slice(0, 3)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold text-white truncate">{m.title}</div>
                        <div className="text-[10px] font-mono text-slate-400 truncate">{m.id}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(g);
                        }}
                        className={`p-0.5 rounded ${
                          isFav ? 'text-amber-400' : 'text-slate-600 opacity-0 group-hover:opacity-100 hover:text-amber-300'
                        }`}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-label={`Favorite ${m.title}`}
                      >
                        <Star className="w-3 h-3" fill={isFav ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Column 3: Selected Game Cues OR Stored Patterns List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {tab === 'PATTERNS' ? (
            visiblePatterns.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">
                No stored patterns match your filter. Select events on the timeline and click Save Pattern.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {visiblePatterns.map((pat) => {
                  const meta = GAME_META[pat.primaryGame];
                  const selected = activePatternId === pat.id;
                  return (
                    <div
                      key={pat.id}
                      onClick={() => {
                        onSelectPattern(pat.id);
                        onActivateStampTool();
                      }}
                      className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                        selected
                          ? 'border-[#FF5A36] bg-[#1E2534]'
                          : 'border-white/10 bg-[#161C27] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-xs shrink-0"
                              style={{ backgroundColor: meta.accent }}
                            />
                            <span className="text-xs font-semibold text-white truncate">{pat.name}</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                            {pat.primaryGame} · {pat.events.length} ev · {(pat.durationTicks / TPB).toFixed(1)}b
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAuditionPattern(pat);
                            }}
                            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-white"
                            title="Preview Pattern Sound"
                            aria-label={`Audition ${pat.name}`}
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          {!pat.builtIn && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeletePattern(pat.id);
                              }}
                              className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                              title="Delete user pattern"
                              aria-label={`Delete ${pat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStampPattern(pat, false);
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded bg-[#222B3C] hover:bg-[#2C374D] text-[11px] font-medium text-slate-100"
                        >
                          <Stamp className="w-3 h-3" />
                          Stamp at Playhead
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStampPattern(pat, true);
                          }}
                          className="px-2.5 h-7 rounded bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 text-[11px] font-medium text-[#FF856B] whitespace-nowrap"
                        >
                          + Switch
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {gameCues.map((cue) => (
                <div
                  key={`${cue.game}-${cue.name}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/groove-cue',
                      JSON.stringify({ game: cue.game, name: cue.name })
                    );
                    onDragStartCue(cue);
                  }}
                  className="rounded-lg border border-white/10 bg-[#161C27] hover:border-white/25 p-2.5 transition-colors cursor-grab active:cursor-grabbing"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">{cue.name}</span>
                        {cue.word && (
                          <span className="font-mono text-[10px] text-purple-300">{cue.word}</span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                        0x{cue.fn.toString(16).toUpperCase()} · {cue.status} · -{cue.leadInBeats}b
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAuditionCue(cue)}
                      className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white shrink-0"
                      title="Audition cue sound"
                      aria-label={`Audition ${cue.name}`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      type="button"
                      onClick={() => onInsertCue(cue, false)}
                      className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded bg-[#222B3C] hover:bg-[#2C374D] text-[11px] font-medium text-slate-100"
                    >
                      <Plus className="w-3 h-3" />
                      Add Cue
                    </button>
                    <button
                      type="button"
                      onClick={() => onInsertCue(cue, true)}
                      className="px-2.5 h-7 rounded bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 text-[11px] font-medium text-[#FF856B] whitespace-nowrap"
                    >
                      + Switch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
