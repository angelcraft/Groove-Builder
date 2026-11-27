import React from 'react';
import { Trash2, Copy, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  findCueDef,
  GAME_META,
  GameId,
  GAMES,
  JINGLE_PRESETS,
  PROLOGUE_TYPES,
  SCORE_TAGS,
  THE_A_WORDS,
  TheAWord,
  TPB,
} from '../engine/cues.ts';
import {
  ENGINE_CONTRACT,
  getAllowedCueProfiles,
  isRingMaskCue,
  validateCueArgsContract,
} from '../engine/engineContract.ts';
import {
  formatBeats,
  Timeline,
  TimelineEvent,
  ValidationReport,
} from '../engine/gtfEngine.ts';

interface InspectorPanelProps {
  timeline: Timeline;
  selectedEvent: TimelineEvent | null;
  validation: ValidationReport;
  onUpdateTimeline: (patch: Partial<Timeline>) => void;
  onUpdateEvent: (id: string, patch: Partial<TimelineEvent>) => void;
  onDeleteEvent: (id: string) => void;
  onDuplicateEvent: (id: string) => void;
  onSeekTick: (tick: number) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  timeline,
  selectedEvent,
  validation,
  onUpdateTimeline,
  onUpdateEvent,
  onDeleteEvent,
  onDuplicateEvent,
  onSeekTick,
}) => {
  const cueDef =
    selectedEvent?.op === 'call' && selectedEvent.game
      ? findCueDef(
          selectedEvent.game,
          selectedEvent.fn ?? 0,
          selectedEvent.args ?? [0, 0, 0, 0],
          selectedEvent.word ?? null
        )
      : undefined;

  return (
    <aside className="flex flex-col h-full bg-[#12161F] overflow-y-auto">
      {selectedEvent ? (
        <div className="p-3.5 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-white">
                {selectedEvent.op === 'call'
                  ? `Cue · ${cueDef?.name ?? selectedEvent.game}`
                  : selectedEvent.op === 'switch'
                  ? `Scene Switch · ${selectedEvent.game}`
                  : selectedEvent.op === 'fade'
                  ? 'Screen Fade'
                  : `Layout Anim · ${selectedEvent.animName}`}
              </div>
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                {formatBeats(selectedEvent.tick)} beats · {selectedEvent.tick} ticks
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDuplicateEvent(selectedEvent.id)}
                className="p-2 rounded-lg border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white"
                title="Duplicate event"
                aria-label="Duplicate event"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteEvent(selectedEvent.id)}
                className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                title="Delete event"
                aria-label="Delete event"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Beat Position</label>
              <input
                type="number"
                step={0.25}
                min={0}
                value={Number((selectedEvent.tick / TPB).toFixed(4))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) {
                    onUpdateEvent(selectedEvent.id, { tick: Math.round(v * TPB) });
                  }
                }}
                className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Exact Ticks</label>
              <input
                type="number"
                step={60}
                min={0}
                value={selectedEvent.tick}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v >= 0) {
                    onUpdateEvent(selectedEvent.id, { tick: v });
                  }
                }}
                className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
              />
            </div>
          </div>

          {selectedEvent.op === 'call' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Score Tag</label>
                  <select
                    value={selectedEvent.tag ?? ''}
                    onChange={(e) =>
                      onUpdateEvent(selectedEvent.id, { tag: e.target.value || null })
                    }
                    className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                  >
                    <option value="">None (-)</option>
                    {SCORE_TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedEvent.game === 'THE_A' && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Word</label>
                    <select
                      value={selectedEvent.word ?? 'TEA'}
                      onChange={(e) =>
                        onUpdateEvent(selectedEvent.id, { word: e.target.value as TheAWord })
                      }
                      className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                    >
                      {THE_A_WORDS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {selectedEvent.game !== 'THE_A' && selectedEvent.game && selectedEvent.fn !== undefined && (() => {
                const args = selectedEvent.args ?? [0, 0, 0, 0];
                const contractCheck = validateCueArgsContract(selectedEvent.game, selectedEvent.fn, args);
                if (isRingMaskCue(selectedEvent.game, selectedEvent.fn)) {
                  const rm = ENGINE_CONTRACT.ring_mask;
                  return (
                    <div className="space-y-2">
                      <label className="block text-[11px] text-slate-400">
                        Hoop Mask Domain (ring_mask: a={rm.min}..{rm.max}, b=0|1)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="block text-[10px] text-slate-500 mb-0.5">Mask (a)</span>
                          <input
                            type="number"
                            min={rm.min}
                            max={rm.max}
                            step={1}
                            value={args[0]}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10);
                              if (!Number.isFinite(raw)) return;
                              const clamped = Math.max(rm.min, Math.min(rm.max, raw));
                              onUpdateEvent(selectedEvent.id, { args: [clamped, args[1] === 1 ? 1 : 0, 0, 0] });
                            }}
                            className="w-full h-8 px-2 rounded border border-white/10 bg-[#0E1117] font-mono text-xs text-white text-center tabular-nums"
                          />
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500 mb-0.5">Pass Mode (b)</span>
                          <select
                            value={args[1] === 1 ? 1 : 0}
                            onChange={(e) =>
                              onUpdateEvent(selectedEvent.id, {
                                args: [Math.max(rm.min, Math.min(rm.max, args[0])), Number(e.target.value), 0, 0],
                              })
                            }
                            className="w-full h-8 px-2 rounded border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                          >
                            <option value={0}>0 (Standard)</option>
                            <option value={1}>1 (Pass / Alt)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                }

                const profiles = getAllowedCueProfiles(selectedEvent.game, selectedEvent.fn);
                const currentKey = args.join(',');
                const inContract = contractCheck.ok;
                return (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-slate-400">
                      Verified Native Args [a, b, c, d]
                    </label>
                    <select
                      value={inContract ? currentKey : '__invalid__'}
                      onChange={(e) => {
                        if (e.target.value === '__invalid__') return;
                        const picked = e.target.value.split(',').map((n) => parseInt(n, 10)) as [
                          number,
                          number,
                          number,
                          number,
                        ];
                        onUpdateEvent(selectedEvent.id, { args: picked });
                      }}
                      className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                    >
                      {!inContract && (
                        <option value="__invalid__">Invalid [{currentKey}] — select verified</option>
                      )}
                      {profiles.map((p) => {
                        const pk = p.join(',');
                        return (
                          <option key={pk} value={pk}>
                            [{p.join(', ')}]
                          </option>
                        );
                      })}
                    </select>
                    {!inContract && contractCheck.reason && (
                      <div className="text-[11px] text-rose-300 leading-snug">{contractCheck.reason}</div>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {selectedEvent.op === 'switch' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Target Game</label>
                <select
                  value={selectedEvent.game}
                  onChange={(e) =>
                    onUpdateEvent(selectedEvent.id, { game: e.target.value as GameId })
                  }
                  className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                >
                  {GAMES.map((g) => (
                    <option key={g} value={g}>
                      {GAME_META[g].title} ({g})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Transition Style</label>
                <select
                  value={String(selectedEvent.style ?? 0)}
                  onChange={(e) =>
                    onUpdateEvent(selectedEvent.id, { style: Number(e.target.value) })
                  }
                  className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                >
                  <option value="0">Smooth (0)</option>
                  <option value="-1">Cut / Hard</option>
                  <option value="1">Style 1</option>
                  <option value="2">Style 2</option>
                </select>
              </div>
            </div>
          )}

          {selectedEvent.op === 'fade' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Duration (ticks)</label>
                <input
                  type="number"
                  step={60}
                  min={0}
                  value={selectedEvent.fadeLen ?? 480}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v >= 0) {
                      onUpdateEvent(selectedEvent.id, { fadeLen: v });
                    }
                  }}
                  className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Alpha (0..1)</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={1}
                  value={selectedEvent.alpha ?? 0.6}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 1) {
                      onUpdateEvent(selectedEvent.id, { alpha: v });
                    }
                  }}
                  className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                />
              </div>
            </div>
          )}

          {selectedEvent.op === 'anim' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Game (Verified Layout)</label>
                  <select
                    value={selectedEvent.game && ENGINE_CONTRACT.layouts[selectedEvent.game] !== undefined ? selectedEvent.game : 'KAERU'}
                    onChange={(e) => {
                      const g = e.target.value as GameId;
                      const verifiedLayout = ENGINE_CONTRACT.layouts[g];
                      if (verifiedLayout !== undefined) {
                        onUpdateEvent(selectedEvent.id, { game: g, layout: verifiedLayout });
                      }
                    }}
                    className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                  >
                    {GAMES.filter((g) => ENGINE_CONTRACT.layouts[g] !== undefined).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Verified Layout</label>
                  <div className="h-9 px-2.5 rounded-lg border border-white/10 bg-[#0B0E14] font-mono text-xs text-slate-300 flex items-center tabular-nums">
                    0x
                    {(
                      (selectedEvent.game && ENGINE_CONTRACT.layouts[selectedEvent.game]) ??
                      selectedEvent.layout ??
                      0x3b58
                    )
                      .toString(16)
                      .toUpperCase()}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Anim Name (1–47 chars)</label>
                <input
                  type="text"
                  maxLength={47}
                  value={selectedEvent.animName ?? 'Remix8'}
                  onChange={(e) =>
                    onUpdateEvent(selectedEvent.id, {
                      animName: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 47),
                    })
                  }
                  className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Remix Header Settings */}
      <div className="p-3.5 border-b border-white/10 space-y-2.5">
        <div className="text-xs font-bold text-white">Remix Header (GTF / GTL)</div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Title</label>
          <input
            type="text"
            maxLength={95}
            value={timeline.title}
            onChange={(e) => onUpdateTimeline({ title: e.target.value })}
            placeholder="Remix 21"
            className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">First Scene</label>
            <select
              value={timeline.first ?? 'CARS'}
              onChange={(e) => onUpdateTimeline({ first: e.target.value as GameId })}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
            >
              {GAMES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">BGM ID</label>
            <input
              type="number"
              min={0}
              max={65535}
              value={timeline.bgm}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v >= 0) onUpdateTimeline({ bgm: v });
              }}
              className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Start (b)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              value={Number((timeline.start / TPB).toFixed(2))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) onUpdateTimeline({ start: Math.round(v * TPB) });
              }}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">End (b)</label>
            <input
              type="number"
              step={1}
              min={1}
              value={Number((timeline.end / TPB).toFixed(2))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 1) onUpdateTimeline({ end: Math.round(v * TPB) });
              }}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Finish (b)</label>
            <input
              type="number"
              step={1}
              min={1}
              value={Number((timeline.finish / TPB).toFixed(2))}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 1) onUpdateTimeline({ finish: Math.round(v * TPB) });
              }}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Prologue Art</label>
            <select
              value={timeline.prologue || 'type_19'}
              onChange={(e) => onUpdateTimeline({ prologue: e.target.value })}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
            >
              {PROLOGUE_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Jingle</label>
            <select
              value={timeline.jingle}
              onChange={(e) => onUpdateTimeline({ jingle: Number(e.target.value) })}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
            >
              <option value={-1}>Native</option>
              {JINGLE_PRESETS.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.hex}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Engine Validation Summary */}
      <div className="p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-white">Engine Validation</span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {validation.gamesUsed.length}/24 games · {validation.callCount} cues
          </span>
        </div>

        {validation.issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Valid for Groove Engine + engine_contract.json v1</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {validation.issues.map((iss, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (iss.tick !== undefined) onSeekTick(iss.tick);
                }}
                className={`w-full flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors ${
                  iss.level === 'error'
                    ? 'border-rose-500/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{iss.message}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
