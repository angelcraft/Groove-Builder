import React, { useMemo, useState } from 'react';
import { Search, Plus, ArrowRightLeft, Sparkles, Volume2 } from 'lucide-react';
import {
  CueDef,
  GAME_META,
  GameId,
  GAMES,
  getCuesForGame,
  LAYOUT_OFF,
} from '../engine/cues.ts';

interface CueLibraryProps {
  selectedGame: GameId;
  onSelectGame: (g: GameId) => void;
  onInsertCue: (cue: CueDef, withSwitch: boolean) => void;
  onInsertSwitch: (game: GameId, cut: boolean) => void;
  onInsertFade: () => void;
  onInsertAnim: (game: GameId) => void;
  onAuditionCue: (cue: CueDef) => void;
  onDragStartCue: (cue: CueDef) => void;
}

type CatFilter = 'ALL' | 'Sports & Action' | 'Creatures & Food' | 'Music & Stage' | 'Sci-Fi & Quirky';

export const CueLibrary: React.FC<CueLibraryProps> = ({
  selectedGame,
  onSelectGame,
  onInsertCue,
  onInsertSwitch,
  onInsertFade,
  onInsertAnim,
  onAuditionCue,
  onDragStartCue,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatFilter>('ALL');

  const filteredGames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GAMES.filter((g) => {
      const m = GAME_META[g];
      if (category !== 'ALL' && m.category !== category) return false;
      if (!q) return true;
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
  }, [query, category]);

  const activeMeta = GAME_META[selectedGame];
  const gameCues = useMemo(() => getCuesForGame(selectedGame), [selectedGame]);

  const categories: Array<{ id: CatFilter; label: string }> = [
    { id: 'ALL', label: 'All 24' },
    { id: 'Sports & Action', label: 'Sports' },
    { id: 'Creatures & Food', label: 'Creatures' },
    { id: 'Music & Stage', label: 'Stage' },
    { id: 'Sci-Fi & Quirky', label: 'Sci-Fi' },
  ];

  return (
    <aside className="flex flex-col h-full bg-[#12161F] border-r border-white/10 overflow-hidden">
      {/* Search & Category Filter */}
      <div className="p-3 border-b border-white/10 space-y-2.5 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 24 games or cues..."
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                category === cat.id
                  ? 'bg-[#FF5A36] text-white'
                  : 'bg-[#1A202C] text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Minigame List (24 Games) */}
      <div className="h-[42%] overflow-y-auto border-b border-white/10 divide-y divide-white/5">
        {filteredGames.length === 0 ? (
          <div className="p-4 text-xs text-slate-500 text-center">No matching minigames found.</div>
        ) : (
          filteredGames.map((g) => {
            const m = GAME_META[g];
            const active = g === selectedGame;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onSelectGame(g)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors min-h-[42px] ${
                  active ? 'bg-[#1E2534]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: m.accent }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{m.title}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      {m.id} · {m.rhreName}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                  {getCuesForGame(g).length}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Selected Game Actions & Cue List */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-3 border-b border-white/10 bg-[#151A24] space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{activeMeta.title}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {activeMeta.id} · Lead-in {activeMeta.defaultLeadInBeats}b
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onInsertSwitch(selectedGame, false)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
              title="Insert smooth scene switch at playhead"
            >
              <ArrowRightLeft className="w-3 h-3 text-sky-400" />
              Switch
            </button>
            <button
              type="button"
              onClick={() => onInsertSwitch(selectedGame, true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
              title="Insert instant cut switch at playhead"
            >
              Cut
            </button>
            {LAYOUT_OFF[selectedGame] !== undefined && (
              <button
                type="button"
                onClick={() => onInsertAnim(selectedGame)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
                title="Insert layout anim event"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                Anim
              </button>
            )}
            <button
              type="button"
              onClick={onInsertFade}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0"
              title="Insert fade event at playhead"
            >
              Fade
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {gameCues.map((cue) => (
            <div
              key={`${cue.game}-${cue.name}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/groove-cue', JSON.stringify({ game: cue.game, name: cue.name }));
                onDragStartCue(cue);
              }}
              className="group rounded-lg border border-white/10 bg-[#161C27] hover:border-white/25 p-2.5 transition-colors cursor-grab active:cursor-grabbing"
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
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{cue.description}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={() => onInsertCue(cue, false)}
                  className="flex-1 inline-flex items-center justify-center gap-1 h-8 rounded bg-[#222B3C] hover:bg-[#2C374D] text-[11px] font-medium text-slate-100 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Cue
                </button>
                <button
                  type="button"
                  onClick={() => onInsertCue(cue, true)}
                  className="inline-flex items-center justify-center px-2.5 h-8 rounded bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 text-[11px] font-medium text-[#FF856B] transition-colors whitespace-nowrap"
                  title="Insert switch to this game + cue"
                >
                  + Switch
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
