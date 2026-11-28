import React from 'react';
import {
  Trash2,
  Copy,
  AlertTriangle,
  CheckCircle2,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
} from 'lucide-react';
import {
  findCueDef,
  GAME_META,
  type GameId,
  GAMES,
  JINGLE_PRESETS,
  PROLOGUE_TYPES,
  SCORE_TAGS,
  THE_A_WORDS,
  type TheAWord,
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
  type Timeline,
  type TimelineEvent,
  type ValidationReport,
} from '../engine/gtfEngine.ts';

interface InspectorPanelProps {
  timeline: Timeline;
  selectedEvents: TimelineEvent[];
  validation: ValidationReport;
  onUpdateTimeline: (patch: Partial<Timeline>) => void;
  onUpdateEvent: (id: string, patch: Partial<TimelineEvent>) => void;
  onBatchNudge: (ids: string[], deltaTicks: number) => void;
  onBatchTag: (ids: string[], tag: string | null) => void;
  onDeleteEvents: (ids: string[]) => void;
  onDuplicateEvents: (ids: string[]) => void;
  onSaveSelectionAsPattern: () => void;
  onInsertSwitchBeforeCue: (ev: TimelineEvent) => void;
  onSeekTick: (tick: number) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  timeline,
  selectedEvents,
  validation,
  onUpdateTimeline,
  onUpdateEvent,
  onBatchNudge,
  onBatchTag,
  onDeleteEvents,
  onDuplicateEvents,
  onSaveSelectionAsPattern,
  onInsertSwitchBeforeCue,
  onSeekTick,
}) => {
  const selectedEvent = selectedEvents.length === 1 ? selectedEvents[0] : null;
  const selectedIds = selectedEvents.map((e) => e.id);

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
      {/* Multi-Selection Batch Inspector (RHREfresh style) */}
      {selectedEvents.length >= 2 && (
        <div className="p-3.5 border-b border-white/10 space-y-3 bg-[#151A24]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-white">
                {selectedEvents.length} Events Selected
              </div>
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                {formatBeats(Math.min(...selectedEvents.map((e) => e.tick)))}b ..{' '}
                {formatBeats(Math.max(...selectedEvents.map((e) => e.tick)))}b
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDuplicateEvents(selectedIds)}
                className="p-2 rounded-lg border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white"
                title="Duplicate selected events"
                aria-label="Duplicate selected events"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteEvents(selectedIds)}
                className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                title="Delete selected events"
                aria-label="Delete selected events"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onSaveSelectionAsPattern}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-200"
          >
            <BookmarkPlus className="w-4 h-4" />
            Save Selection as Reusable Pattern
          </button>

          <div>
            <div className="text-[11px] text-slate-400 mb-1">Batch Nudge Timing</div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: '-1b', ticks: -TPB },
                { label: '-1/4', ticks: -TPB / 4 },
                { label: '+1/4', ticks: TPB / 4 },
                { label: '+1b', ticks: TPB },
              ].map((step) => (
                <button
                  key={step.label}
                  type="button"
                  onClick={() => onBatchNudge(selectedIds, step.ticks)}
                  className="h-8 rounded border border-white/10 bg-[#1B2230] hover:bg-[#252E40] font-mono text-[11px] text-slate-200"
                >
                  {step.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Batch Score Tag</label>
            <select
              defaultValue=""
              onChange={(e) => {
                onBatchTag(selectedIds, e.target.value || null);
              }}
              className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
            >
              <option value="">Clear tag (-)</option>
              {SCORE_TAGS.map((t) => (
                <option key={t} value={t}>
                  Set tag: {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Single Event Mechanics Inspector (Heaven Studio style) */}
      {selectedEvent && (
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
                onClick={() => onDuplicateEvents([selectedEvent.id])}
                className="p-2 rounded-lg border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white"
                title="Duplicate event"
                aria-label="Duplicate event"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteEvents([selectedEvent.id])}
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

          {selectedEvent.op === 'call' && selectedEvent.game && (
            <>
              {/* Heaven Studio-inspired Mechanic Readout */}
              <div className="rounded-lg border border-white/10 bg-[#0E1117] px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
                <div className="space-y-0.5">
                  <div className="text-slate-300 font-medium">
                    Lead-in: <span className="font-mono text-white">{cueDef?.leadInBeats ?? 0}b</span> · Hit @{' '}
                    <span className="font-mono text-sky-300">
                      {formatBeats(selectedEvent.tick + Math.round((cueDef?.leadInBeats ?? 0) * TPB))}b
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    fn 0x{(selectedEvent.fn ?? 0).toString(16).toUpperCase()} · {cueDef?.status ?? 'contract'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onInsertSwitchBeforeCue(selectedEvent)}
                  className="inline-flex items-center gap-1 px-2 h-7 rounded bg-[#1D2433] hover:bg-[#273044] text-[10px] font-medium text-sky-300 whitespace-nowrap shrink-0"
                  title="Insert switch to this game right before the cue"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                  Switch
                </button>
              </div>

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
                  <label className="block text-[11px] text-slate-400 mb-1">The-A Word Phrase</label>
                  <div className="grid grid-cols-4 gap-1">
                    {THE_A_WORDS.map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => onUpdateEvent(selectedEvent.id, { word: w as TheAWord })}
                        className={`h-8 rounded border font-mono text-[11px] font-semibold transition-colors ${
                          (selectedEvent.word ?? 'TEA') === w
                            ? 'border-[#FF5A36] bg-[#FF5A36]/25 text-white'
                            : 'border-white/10 bg-[#0E1117] text-slate-400 hover:text-white'
                        }`}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedEvent.game !== 'THE_A' && selectedEvent.fn !== undefined && (() => {
                const args = selectedEvent.args ?? [0, 0, 0, 0];
                const contractCheck = validateCueArgsContract(selectedEvent.game, selectedEvent.fn, args);
                if (isRingMaskCue(selectedEvent.game, selectedEvent.fn)) {
                  const rm = ENGINE_CONTRACT.ring_mask;
                  const mask = args[0];
                  return (
                    <div className="space-y-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-cyan-200">
                          Hoop Ring Bitmask (ring_mask)
                        </label>
                        <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                          mask={mask}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 1, 2, 3].map((bit) => {
                          const on = mask >= 0 && (mask & (1 << bit)) !== 0;
                          return (
                            <button
                              key={bit}
                              type="button"
                              onClick={() => {
                                const base = mask < 0 ? 0 : mask;
                                const nextMask = base ^ (1 << bit);
                                onUpdateEvent(selectedEvent.id, {
                                  args: [Math.max(rm.min, Math.min(rm.max, nextMask)), args[1] === 1 ? 1 : 0, 0, 0],
                                });
                              }}
                              className={`h-8 rounded border font-mono text-[11px] font-semibold transition-colors ${
                                on
                                  ? 'border-cyan-400 bg-cyan-500/30 text-white'
                                  : 'border-white/10 bg-[#0E1117] text-slate-400'
                              }`}
                            >
                              H{bit + 1}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateEvent(selectedEvent.id, {
                              args: [-1, args[1] === 1 ? 1 : 0, 0, 0],
                            })
                          }
                          className={`h-7 rounded border font-mono text-[10px] ${
                            mask === -1
                              ? 'border-cyan-400 bg-cyan-500/25 text-white'
                              : 'border-white/10 bg-[#0E1117] text-slate-400'
                          }`}
                        >
                          Clear (-1)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateEvent(selectedEvent.id, {
                              args: [15, args[1] === 1 ? 1 : 0, 0, 0],
                            })
                          }
                          className={`h-7 rounded border font-mono text-[10px] ${
                            mask === 15
                              ? 'border-cyan-400 bg-cyan-500/25 text-white'
                              : 'border-white/10 bg-[#0E1117] text-slate-400'
                          }`}
                        >
                          All 4 (15)
                        </button>
                        <select
                          value={args[1] === 1 ? 1 : 0}
                          onChange={(e) =>
                            onUpdateEvent(selectedEvent.id, {
                              args: [Math.max(rm.min, Math.min(rm.max, args[0])), Number(e.target.value), 0, 0],
                            })
                          }
                          className="h-7 px-1.5 rounded border border-white/10 bg-[#0E1117] font-mono text-[10px] text-white"
                          aria-label="Hoop Pass Mode"
                        >
                          <option value={0}>Std (b=0)</option>
                          <option value={1}>Pass (b=1)</option>
                        </select>
                      </div>
                    </div>
                  );
                }

                const profiles = getAllowedCueProfiles(selectedEvent.game, selectedEvent.fn);
                const currentKey = args.join(',');
                const inContract = contractCheck.ok;
                const currentIdx = profiles.findIndex((p) => p.join(',') === currentKey);
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-slate-400">
                        Verified Mechanic Args ({profiles.length})
                      </label>
                      {profiles.length > 1 && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const nextIdx = currentIdx <= 0 ? profiles.length - 1 : currentIdx - 1;
                              onUpdateEvent(selectedEvent.id, { args: [...profiles[nextIdx]] as [number, number, number, number] });
                            }}
                            className="p-1 rounded border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white"
                            title="Previous verified profile"
                            aria-label="Previous profile"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextIdx = currentIdx < 0 || currentIdx >= profiles.length - 1 ? 0 : currentIdx + 1;
                              onUpdateEvent(selectedEvent.id, { args: [...profiles[nextIdx]] as [number, number, number, number] });
                            }}
                            className="p-1 rounded border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white"
                            title="Next verified profile"
                            aria-label="Next profile"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
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
                    value={
                      selectedEvent.game && ENGINE_CONTRACT.layouts[selectedEvent.game] !== undefined
                        ? selectedEvent.game
                        : 'KAERU'
                    }
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
      )}

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
