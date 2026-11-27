import React, { useMemo, useRef, useState } from 'react';
import {
  CueDef,
  CUES,
  findCueDef,
  GAME_META,
  GameId,
  TPB,
} from '../engine/cues.ts';
import { formatBeats, Timeline, TimelineEvent } from '../engine/gtfEngine.ts';

interface TimelineEditorProps {
  timeline: Timeline;
  currentTick: number;
  bpm: number;
  musicOffsetSec: number;
  musicDurationSec: number;
  waveformPeaks: Float32Array;
  zoomPxPerBeat: number;
  snapDenominator: number;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onSeekTick: (tick: number) => void;
  onMoveEvent: (id: string, newTick: number) => void;
  onResizeEvent: (id: string, newParamTicks: number) => void;
  onDropNewCue: (cue: CueDef, tick: number) => void;
  draggedCue: CueDef | null;
}

const LANE_HEADER_W = 112;
const RULER_H = 38;
const SWITCH_ROW_H = 48;
const CUE_ROW_H = 56;
const NUM_CUE_LANES = 3;

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  timeline,
  currentTick,
  bpm,
  musicOffsetSec,
  musicDurationSec,
  waveformPeaks,
  zoomPxPerBeat,
  snapDenominator,
  selectedEventId,
  onSelectEvent,
  onSeekTick,
  onMoveEvent,
  onResizeEvent,
  onDropNewCue,
  draggedCue,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    mode: 'scrub' | 'move' | 'resize';
    eventId?: string;
    startX: number;
    origTick: number;
    origSpanTicks: number;
  } | null>(null);

  const maxEventTick = timeline.events.reduce((m, e) => Math.max(m, e.tick), 0);
  const totalBeats = Math.max(
    64,
    Math.ceil(Math.max(timeline.finish, timeline.end, maxEventTick, currentTick) / TPB) + 16
  );
  const canvasWidth = totalBeats * zoomPxPerBeat;
  const pxPerTick = zoomPxPerBeat / TPB;

  const snapTick = (rawTick: number): number => {
    const clamped = Math.max(0, rawTick);
    if (!snapDenominator || snapDenominator <= 0) return Math.round(clamped);
    const step = TPB / snapDenominator;
    return Math.round(clamped / step) * step;
  };

  // Partition events into switch/fx track and non-overlapping cue lanes
  const { fxEvents, cueWithLane } = useMemo(() => {
    const sorted = [...timeline.events].sort((a, b) => a.tick - b.tick);
    const fx: TimelineEvent[] = [];
    const calls: TimelineEvent[] = [];
    for (const ev of sorted) {
      if (ev.op === 'call') calls.push(ev);
      else fx.push(ev);
    }

    const laneEndTicks = new Array<number>(NUM_CUE_LANES).fill(-1);
    const assigned: Array<{ ev: TimelineEvent; lane: number; cueDef?: CueDef; spanTicks: number }> = [];
    for (const ev of calls) {
      const def = ev.game ? findCueDef(ev.game, ev.fn ?? 0, ev.args ?? [0, 0, 0, 0], ev.word ?? null) : undefined;
      let spanBeats = def?.durationBeats ?? 4;
      if (def?.stretchable === 'spacingTicks' && ev.args) {
        spanBeats = Math.max(1.5, (ev.args[0] > 50 ? ev.args[0] : ev.args[1]) * 4 / TPB);
      } else if (def?.stretchable === 'stopBeats' && ev.args) {
        spanBeats = Math.max(2, ev.args[0]);
      }
      const spanTicks = Math.max(TPB, Math.round(spanBeats * TPB));

      let chosenLane = 0;
      let placed = false;
      for (let l = 0; l < NUM_CUE_LANES; l++) {
        if (laneEndTicks[l] <= ev.tick) {
          chosenLane = l;
          placed = true;
          break;
        }
      }
      if (!placed) {
        // pick lane with smallest end
        chosenLane = laneEndTicks.indexOf(Math.min(...laneEndTicks));
      }
      laneEndTicks[chosenLane] = ev.tick + spanTicks;
      assigned.push({ ev, lane: chosenLane, cueDef: def, spanTicks });
    }
    return { fxEvents: fx, cueWithLane: assigned };
  }, [timeline.events]);

  // Build SVG waveform path aligned to beat grid
  const waveformBars = useMemo(() => {
    if (!waveformPeaks.length || musicDurationSec <= 0) return [];
    const beatsPerSec = Math.max(20, bpm) / 60;
    const totalBars = Math.min(800, waveformPeaks.length);
    const step = Math.max(1, Math.floor(waveformPeaks.length / totalBars));
    const bars: Array<{ x: number; h: number }> = [];
    for (let i = 0; i < waveformPeaks.length; i += step) {
      const songSec = (i / waveformPeaks.length) * musicDurationSec;
      const beat = (songSec - musicOffsetSec) * beatsPerSec;
      const x = beat * zoomPxPerBeat;
      if (x >= 0 && x <= canvasWidth) {
        bars.push({ x, h: Math.max(2, waveformPeaks[i] * 72) });
      }
    }
    return bars;
  }, [waveformPeaks, musicDurationSec, bpm, musicOffsetSec, zoomPxPerBeat, canvasWidth]);

  const xToTick = (clientX: number): number => {
    if (!scrollRef.current) return 0;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollRef.current.scrollLeft - LANE_HEADER_W;
    return Math.max(0, x / pxPerTick);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    if (dragState.mode === 'scrub') {
      const raw = xToTick(e.clientX);
      onSeekTick(snapTick(raw));
    } else if (dragState.mode === 'move' && dragState.eventId) {
      const dx = e.clientX - dragState.startX;
      const deltaTicks = dx / pxPerTick;
      onMoveEvent(dragState.eventId, snapTick(dragState.origTick + deltaTicks));
    } else if (dragState.mode === 'resize' && dragState.eventId) {
      const dx = e.clientX - dragState.startX;
      const deltaTicks = dx / pxPerTick;
      const newSpan = Math.max(120, snapTick(dragState.origSpanTicks + deltaTicks));
      onResizeEvent(dragState.eventId, newSpan);
    }
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  const handleDropOnTimeline = (e: React.DragEvent) => {
    e.preventDefault();
    const tick = snapTick(xToTick(e.clientX));
    const raw = e.dataTransfer.getData('application/groove-cue');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { game: GameId; name: string };
        const found = CUES.find((c) => c.game === parsed.game && c.name === parsed.name);
        if (found) {
          onDropNewCue(found, tick);
          return;
        }
      } catch {
        // fallback to draggedCue
      }
    }
    if (draggedCue) {
      onDropNewCue(draggedCue, tick);
    }
  };

  const beatMarks = useMemo(() => {
    const arr: number[] = [];
    for (let b = 0; b <= totalBeats; b++) arr.push(b);
    return arr;
  }, [totalBeats]);

  const totalTracksHeight = SWITCH_ROW_H + NUM_CUE_LANES * CUE_ROW_H;

  return (
    <div
      className="relative flex-1 flex flex-col bg-[#0E1117] overflow-hidden select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnTimeline}
      >
        <div
          className="relative"
          style={{ width: LANE_HEADER_W + canvasWidth, minHeight: RULER_H + totalTracksHeight }}
        >
          {/* Sticky Ruler Row */}
          <div className="sticky top-0 z-30 flex bg-[#141922] border-b border-white/10" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-40 flex items-center px-3 bg-[#141922] border-r border-white/10 text-[11px] font-semibold text-slate-400 shrink-0"
              style={{ width: LANE_HEADER_W }}
            >
              Beats (480t)
            </div>
            <div
              className="relative flex-1 cursor-pointer touch-none"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const tk = snapTick(xToTick(e.clientX));
                onSeekTick(tk);
                setDragState({ mode: 'scrub', startX: e.clientX, origTick: tk, origSpanTicks: 0 });
              }}
            >
              {beatMarks.map((b) => {
                const isBar = b % 4 === 0;
                return (
                  <div
                    key={b}
                    className={`absolute top-0 bottom-0 border-l ${
                      isBar ? 'border-white/20' : 'border-white/5'
                    }`}
                    style={{ left: b * zoomPxPerBeat }}
                  >
                    {(isBar || zoomPxPerBeat >= 44) && (
                      <span
                        className={`ml-1 text-[10px] font-mono tabular-nums ${
                          isBar ? 'text-slate-200 font-semibold' : 'text-slate-500'
                        }`}
                      >
                        {b}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Start / End / Finish Markers */}
              <div
                className="absolute top-0 bottom-0 border-l-2 border-emerald-400 pointer-events-none"
                style={{ left: timeline.start * pxPerTick }}
              >
                <span className="ml-1 px-1 py-0.5 rounded bg-emerald-500/20 text-[9px] font-mono font-bold text-emerald-300">
                  START
                </span>
              </div>
              <div
                className="absolute top-0 bottom-0 border-l-2 border-amber-400 pointer-events-none"
                style={{ left: timeline.end * pxPerTick }}
              >
                <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-[9px] font-mono font-bold text-amber-300">
                  END
                </span>
              </div>
              <div
                className="absolute top-0 bottom-0 border-l-2 border-rose-400 pointer-events-none"
                style={{ left: timeline.finish * pxPerTick }}
              >
                <span className="ml-1 px-1 py-0.5 rounded bg-rose-500/20 text-[9px] font-mono font-bold text-rose-300">
                  FINISH
                </span>
              </div>
            </div>
          </div>

          {/* Tracks Container */}
          <div className="relative flex" style={{ height: totalTracksHeight }}>
            {/* Sticky Left Lane Headers */}
            <div
              className="sticky left-0 z-20 flex flex-col bg-[#12161F] border-r border-white/10 shrink-0"
              style={{ width: LANE_HEADER_W }}
            >
              <div
                className="flex flex-col justify-center px-3 border-b border-white/10"
                style={{ height: SWITCH_ROW_H }}
              >
                <span className="text-[11px] font-semibold text-sky-300">Switch &amp; FX</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {timeline.first ?? 'CARS'}
                </span>
              </div>
              {Array.from({ length: NUM_CUE_LANES }, (_, idx) => (
                <div
                  key={idx}
                  className="flex items-center px-3 border-b border-white/5 text-[11px] font-medium text-slate-400"
                  style={{ height: CUE_ROW_H }}
                >
                  Cue Track {idx + 1}
                </div>
              ))}
            </div>

            {/* Grid, Waveform & Events Canvas Area */}
            <div
              className="relative flex-1"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  onSelectEvent(null);
                  onSeekTick(snapTick(xToTick(e.clientX)));
                }
              }}
            >
              {/* Beat Grid Vertical Lines */}
              {beatMarks.map((b) => (
                <div
                  key={b}
                  className={`absolute top-0 bottom-0 pointer-events-none border-l ${
                    b % 4 === 0 ? 'border-white/10' : 'border-white/[0.035]'
                  }`}
                  style={{ left: b * zoomPxPerBeat }}
                />
              ))}

              {/* Audio Waveform Overlay */}
              {waveformBars.length > 0 && (
                <div
                  className="absolute left-0 right-0 pointer-events-none opacity-25"
                  style={{ top: SWITCH_ROW_H, height: NUM_CUE_LANES * CUE_ROW_H }}
                >
                  <svg width={canvasWidth} height={NUM_CUE_LANES * CUE_ROW_H} className="block">
                    {waveformBars.map((bar, idx) => (
                      <rect
                        key={idx}
                        x={bar.x}
                        y={(NUM_CUE_LANES * CUE_ROW_H) / 2 - bar.h / 2}
                        width={2}
                        height={bar.h}
                        fill="#38BDF8"
                      />
                    ))}
                  </svg>
                </div>
              )}

              {/* Switch / Fade / Anim Row */}
              <div
                className="relative border-b border-white/10 bg-[#131823]/70"
                style={{ height: SWITCH_ROW_H }}
              >
                {fxEvents.map((ev) => {
                  const left = ev.tick * pxPerTick;
                  const isSelected = ev.id === selectedEventId;
                  if (ev.op === 'switch' && ev.game) {
                    const meta = GAME_META[ev.game];
                    const isCut = ev.style === -1;
                    const transW = isCut ? 48 : Math.max(64, timeline.translen * pxPerTick);
                    return (
                      <div
                        key={ev.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectEvent(ev.id);
                          setDragState({
                            mode: 'move',
                            eventId: ev.id,
                            startX: e.clientX,
                            origTick: ev.tick,
                            origSpanTicks: transW / pxPerTick,
                          });
                        }}
                        className={`absolute top-1.5 bottom-1.5 rounded-md border flex items-center px-2 gap-1.5 cursor-grab active:cursor-grabbing touch-none ${
                          isSelected
                            ? 'ring-2 ring-white border-white z-20'
                            : 'border-white/20 hover:border-white/40 z-10'
                        }`}
                        style={{
                          left,
                          width: transW,
                          backgroundColor: `${meta.accent}33`,
                        }}
                        title={`Switch -> ${meta.title} (${isCut ? 'CUT' : 'Smooth'}) @ ${formatBeats(ev.tick)}b`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: meta.accent }}
                        />
                        <span className="text-[11px] font-semibold text-white truncate">
                          {ev.game}
                        </span>
                        {isCut && (
                          <span className="ml-auto text-[9px] font-mono font-bold text-amber-300">
                            CUT
                          </span>
                        )}
                      </div>
                    );
                  }
                  if (ev.op === 'fade') {
                    const w = Math.max(44, (ev.fadeLen ?? 480) * pxPerTick);
                    return (
                      <div
                        key={ev.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectEvent(ev.id);
                          setDragState({
                            mode: 'move',
                            eventId: ev.id,
                            startX: e.clientX,
                            origTick: ev.tick,
                            origSpanTicks: ev.fadeLen ?? 480,
                          });
                        }}
                        className={`absolute top-2 bottom-2 rounded border bg-slate-700/70 flex items-center px-2 cursor-grab touch-none ${
                          isSelected ? 'ring-2 ring-white border-white z-20' : 'border-white/25 z-10'
                        }`}
                        style={{ left, width: w }}
                      >
                        <span className="text-[10px] font-mono text-slate-200 truncate">
                          fade α={ev.alpha}
                        </span>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectEvent(ev.id);
                            setDragState({
                              mode: 'resize',
                              eventId: ev.id,
                              startX: e.clientX,
                              origTick: ev.tick,
                              origSpanTicks: ev.fadeLen ?? 480,
                            });
                          }}
                        />
                      </div>
                    );
                  }
                  // anim
                  return (
                    <div
                      key={ev.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelectEvent(ev.id);
                        setDragState({
                          mode: 'move',
                          eventId: ev.id,
                          startX: e.clientX,
                          origTick: ev.tick,
                          origSpanTicks: 240,
                        });
                      }}
                      className={`absolute top-2 bottom-2 rounded border bg-amber-500/25 flex items-center px-2 cursor-grab touch-none ${
                        isSelected ? 'ring-2 ring-white border-white z-20' : 'border-amber-400/50 z-10'
                      }`}
                      style={{ left, minWidth: 72 }}
                    >
                      <span className="text-[10px] font-mono text-amber-200 truncate">
                        anim {ev.animName}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Cue Lanes */}
              {Array.from({ length: NUM_CUE_LANES }, (_, laneIdx) => (
                <div
                  key={laneIdx}
                  className="relative border-b border-white/5"
                  style={{ height: CUE_ROW_H }}
                >
                  {cueWithLane
                    .filter((item) => item.lane === laneIdx)
                    .map(({ ev, cueDef, spanTicks }) => {
                      const game = ev.game ?? 'CARS';
                      const meta = GAME_META[game];
                      const left = ev.tick * pxPerTick;
                      const width = Math.max(64, spanTicks * pxPerTick);
                      const isSelected = ev.id === selectedEventId;
                      const label = ev.word ?? cueDef?.name ?? `0x${(ev.fn ?? 0).toString(16).toUpperCase()}`;
                      const leadPx = Math.min(width - 12, (cueDef?.leadInBeats ?? 0) * zoomPxPerBeat);

                      return (
                        <div
                          key={ev.id}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectEvent(ev.id);
                            setDragState({
                              mode: 'move',
                              eventId: ev.id,
                              startX: e.clientX,
                              origTick: ev.tick,
                              origSpanTicks: spanTicks,
                            });
                          }}
                          className={`absolute top-1.5 bottom-1.5 rounded-lg border flex flex-col justify-center px-2.5 overflow-hidden cursor-grab active:cursor-grabbing touch-none ${
                            isSelected
                              ? 'ring-2 ring-white border-white z-20 shadow-lg'
                              : 'border-white/20 hover:border-white/40 z-10'
                          }`}
                          style={{
                            left,
                            width,
                            backgroundColor: `${meta.accent}2B`,
                          }}
                          title={`${meta.title} · ${label} @ ${formatBeats(ev.tick)}b (${ev.tick}t)`}
                        >
                          {/* Subtle lead-in zone marker */}
                          {leadPx > 14 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 border-r border-dashed border-white/25 bg-black/20 pointer-events-none"
                              style={{ width: leadPx }}
                            />
                          )}

                          <div className="relative flex items-center justify-between gap-1.5 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-sm shrink-0"
                                style={{ backgroundColor: meta.accent }}
                              />
                              <span className="text-xs font-semibold text-white truncate">
                                {label}
                              </span>
                            </div>
                            {ev.tag && (
                              <span className="text-[10px] font-mono text-slate-300 shrink-0">
                                {ev.tag}
                              </span>
                            )}
                          </div>
                          <div className="relative text-[10px] font-mono text-slate-300/80 truncate tabular-nums">
                            {game} · {formatBeats(ev.tick)}b
                          </div>

                          {/* Stretch resize handle for stretchable cues */}
                          {cueDef?.stretchable && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-white/30"
                              title="Drag edge to adjust spacing/length"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onSelectEvent(ev.id);
                                setDragState({
                                  mode: 'resize',
                                  eventId: ev.id,
                                  startX: e.clientX,
                                  origTick: ev.tick,
                                  origSpanTicks: spanTicks,
                                });
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              ))}

              {/* Playhead Line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#FF5A36] pointer-events-none z-30"
                style={{ left: currentTick * pxPerTick }}
              >
                <div className="w-3 h-3 -ml-[5px] -mt-1 rotate-45 bg-[#FF5A36]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
