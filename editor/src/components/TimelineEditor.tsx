import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CueDef,
  CUES,
  findCueDef,
  GAME_META,
  type GameId,
  TPB,
} from '../engine/cues.ts';
import { formatBeats, type Timeline, type TimelineEvent } from '../engine/gtfEngine.ts';
import {
  computeGameSections,
  type EditorTool,
  type StoredPattern,
} from '../engine/patternStore.ts';
import { TimelineMinimap } from './TimelineMinimap.tsx';

interface TimelineEditorProps {
  timeline: Timeline;
  currentTick: number;
  isPlaying: boolean;
  bpm: number;
  musicOffsetSec: number;
  musicDurationSec: number;
  waveformPeaks: Float32Array;
  zoomPxPerBeat: number;
  snapDenominator: number;
  activeTool: EditorTool;
  selectedGame: GameId;
  activeCue: CueDef | null;
  activePattern: StoredPattern | null;
  selectedEventIds: string[];
  onSelectEvents: (ids: string[]) => void;
  onSeekTick: (tick: number) => void;
  onMoveEvents: (moves: Array<{ id: string; tick: number }>) => void;
  onDuplicateMoveEvents: (moves: Array<{ id: string; tick: number }>) => void;
  onResizeEvent: (id: string, newParamTicks: number) => void;
  onDeleteEvent: (id: string) => void;
  onDropNewCue: (cue: CueDef, tick: number) => void;
  onInsertSwitchAtTick: (game: GameId, tick: number, cut: boolean) => void;
  onStampAtTick: (tick: number, withSwitch: boolean) => void;
  onUpdateMarker: (marker: 'start' | 'end' | 'finish', tick: number) => void;
  draggedCue: CueDef | null;
}

const LANE_HEADER_W = 112;
const RULER_H = 42;
const SWITCH_ROW_H = 44;
const CUE_ROW_H = 52;
const BOTTOM_TRACKER_H = 26;
const NUM_CUE_LANES = 4;

type DragState =
  | {
      mode: 'scrub';
      startX: number;
    }
  | {
      mode: 'move';
      startX: number;
      duplicate: boolean;
      origPositions: Array<{ id: string; origTick: number }>;
    }
  | {
      mode: 'resize';
      eventId: string;
      startX: number;
      origSpanTicks: number;
    }
  | {
      mode: 'marquee';
      startX: number;
      startY: number;
      curX: number;
      curY: number;
    }
  | {
      mode: 'ruler';
      startTick: number;
      endTick: number;
    }
  | {
      mode: 'marker';
      marker: 'start' | 'end' | 'finish';
    };

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  timeline,
  currentTick,
  isPlaying,
  bpm,
  musicOffsetSec,
  musicDurationSec,
  waveformPeaks,
  zoomPxPerBeat,
  snapDenominator,
  activeTool,
  selectedGame,
  activeCue,
  activePattern,
  selectedEventIds,
  onSelectEvents,
  onSeekTick,
  onMoveEvents,
  onDuplicateMoveEvents,
  onResizeEvent,
  onDeleteEvent,
  onDropNewCue,
  onInsertSwitchAtTick,
  onStampAtTick,
  onUpdateMarker,
  draggedCue,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const [viewportStartBeat, setViewportStartBeat] = useState(0);
  const [viewportSpanBeats, setViewportSpanBeats] = useState(16);

  const selectedSet = useMemo(() => new Set(selectedEventIds), [selectedEventIds]);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const syncView = () => {
      const usableW = Math.max(200, el.clientWidth - LANE_HEADER_W);
      setViewportStartBeat(el.scrollLeft / zoomPxPerBeat);
      setViewportSpanBeats(usableW / zoomPxPerBeat);
    };
    syncView();
    const ro = new ResizeObserver(syncView);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomPxPerBeat]);

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
        spanBeats = Math.max(1.5, ((ev.args[0] > 50 ? ev.args[0] : ev.args[1]) * 4) / TPB);
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
        chosenLane = laneEndTicks.indexOf(Math.min(...laneEndTicks));
      }
      laneEndTicks[chosenLane] = ev.tick + spanTicks;
      assigned.push({ ev, lane: chosenLane, cueDef: def, spanTicks });
    }
    return { fxEvents: fx, cueWithLane: assigned };
  }, [timeline.events]);

  const gameSections = useMemo(
    () => computeGameSections(timeline, totalBeats * TPB),
    [timeline, totalBeats]
  );

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
        bars.push({ x, h: Math.max(2, waveformPeaks[i] * 86) });
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

  const clientToCanvasXY = (clientX: number, clientY: number) => {
    const area = tracksAreaRef.current;
    if (!area) return { x: 0, y: 0 };
    const rect = area.getBoundingClientRect();
    return {
      x: Math.max(0, clientX - rect.left),
      y: Math.max(0, clientY - rect.top),
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const snapped = snapTick(xToTick(e.clientX));
    setHoverTick(snapped);

    if (!dragState) return;
    if (dragState.mode === 'scrub') {
      onSeekTick(snapped);
    } else if (dragState.mode === 'marker') {
      onUpdateMarker(dragState.marker, snapped);
    } else if (dragState.mode === 'move') {
      const dx = e.clientX - dragState.startX;
      const deltaTicks = dx / pxPerTick;
      const anchorOrig = dragState.origPositions[0]?.origTick ?? 0;
      const snappedAnchor = snapTick(anchorOrig + deltaTicks);
      const effectiveDelta = snappedAnchor - anchorOrig;
      const moves = dragState.origPositions.map((p) => ({
        id: p.id,
        tick: Math.max(0, p.origTick + effectiveDelta),
      }));
      if (!dragState.duplicate) {
        onMoveEvents(moves);
      }
    } else if (dragState.mode === 'resize') {
      const dx = e.clientX - dragState.startX;
      const deltaTicks = dx / pxPerTick;
      const newSpan = Math.max(120, snapTick(dragState.origSpanTicks + deltaTicks));
      onResizeEvent(dragState.eventId, newSpan);
    } else if (dragState.mode === 'marquee') {
      const pt = clientToCanvasXY(e.clientX, e.clientY);
      setDragState({ ...dragState, curX: pt.x, curY: pt.y });
    } else if (dragState.mode === 'ruler') {
      setDragState({ ...dragState, endTick: snapped });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState) return;
    if (dragState.mode === 'move' && dragState.duplicate) {
      const dx = e.clientX - dragState.startX;
      const deltaTicks = dx / pxPerTick;
      const anchorOrig = dragState.origPositions[0]?.origTick ?? 0;
      const snappedAnchor = snapTick(anchorOrig + deltaTicks);
      const effectiveDelta = snappedAnchor - anchorOrig;
      if (effectiveDelta !== 0) {
        onDuplicateMoveEvents(
          dragState.origPositions.map((p) => ({
            id: p.id,
            tick: Math.max(0, p.origTick + effectiveDelta),
          }))
        );
      }
    } else if (dragState.mode === 'marquee') {
      const minX = Math.min(dragState.startX, dragState.curX);
      const maxX = Math.max(dragState.startX, dragState.curX);
      const minY = Math.min(dragState.startY, dragState.curY);
      const maxY = Math.max(dragState.startY, dragState.curY);
      if (maxX - minX > 6 || maxY - minY > 6) {
        const hitIds: string[] = [];
        for (const ev of fxEvents) {
          const ex = ev.tick * pxPerTick;
          const ew = ev.op === 'fade' ? Math.max(44, (ev.fadeLen ?? 480) * pxPerTick) : 72;
          if (ex + ew >= minX && ex <= maxX && minY <= SWITCH_ROW_H && maxY >= 0) {
            hitIds.push(ev.id);
          }
        }
        for (const item of cueWithLane) {
          const ex = item.ev.tick * pxPerTick;
          const ew = Math.max(64, item.spanTicks * pxPerTick);
          const ey = SWITCH_ROW_H + item.lane * CUE_ROW_H;
          if (ex + ew >= minX && ex <= maxX && ey + CUE_ROW_H >= minY && ey <= maxY) {
            hitIds.push(item.ev.id);
          }
        }
        onSelectEvents(hitIds);
      }
    }
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
        // fallback
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

  const showSubbeatLines = snapDenominator >= 2 && (zoomPxPerBeat >= 40 || activeTool === 'ruler' || activeTool === 'switch');
  const totalTracksHeight = SWITCH_ROW_H + NUM_CUE_LANES * CUE_ROW_H + BOTTOM_TRACKER_H;

  // RHREfresh Play-Yan runner bounce height (|sin(pi * beatPhase)|)
  const beatPos = currentTick / TPB;
  const playYanJumpPx = isPlaying ? Math.abs(Math.sin(Math.PI * (beatPos % 1))) * 12 : 0;

  // Stamp preview width
  const stampSpanBeats = activePattern
    ? Math.max(1.5, activePattern.durationTicks / TPB)
    : activeCue?.durationBeats ?? 2;

  return (
    <div
      className="relative flex-1 flex flex-col bg-[#0E1117] overflow-hidden select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverTick(null)}
    >
      {/* RHREfresh Whole-Song Minimap Strip */}
      <TimelineMinimap
        timeline={timeline}
        totalBeats={totalBeats}
        currentTick={currentTick}
        viewportStartBeat={viewportStartBeat}
        viewportSpanBeats={viewportSpanBeats}
        onSeekTick={onSeekTick}
        onJumpToBeat={(b) => {
          if (scrollRef.current) {
            scrollRef.current.scrollLeft = Math.max(0, b * zoomPxPerBeat);
          }
        }}
      />

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onScroll={(e) => {
          const el = e.currentTarget;
          setViewportStartBeat(el.scrollLeft / zoomPxPerBeat);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnTimeline}
      >
        <div
          className="relative"
          style={{ width: LANE_HEADER_W + canvasWidth, minHeight: RULER_H + totalTracksHeight }}
        >
          {/* Sticky Ruler Row with Top Trackers + Play-Yan Beat Jumper */}
          <div className="sticky top-0 z-30 flex bg-[#141922] border-b border-white/10" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-40 flex items-center justify-between px-3 bg-[#141922] border-r border-white/10 text-[11px] font-semibold text-slate-400 shrink-0"
              style={{ width: LANE_HEADER_W }}
            >
              <span>Beats</span>
              <span className="font-mono text-[10px] text-slate-500">480t</span>
            </div>
            <div
              className="relative flex-1 cursor-pointer touch-none"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const tk = snapTick(xToTick(e.clientX));
                onSeekTick(tk);
                setDragState({ mode: 'scrub', startX: e.clientX });
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

              {/* RHREfresh-style Draggable Top Trackers (START / END / FINISH) */}
              {(
                [
                  { key: 'start', label: 'START', tick: timeline.start, border: 'border-emerald-400', bg: 'bg-emerald-500/25 text-emerald-200' },
                  { key: 'end', label: 'END', tick: timeline.end, border: 'border-amber-400', bg: 'bg-amber-500/25 text-amber-200' },
                  { key: 'finish', label: 'FINISH', tick: timeline.finish, border: 'border-rose-400', bg: 'bg-rose-500/25 text-rose-200' },
                ] as const
              ).map((m) => (
                <div
                  key={m.key}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDragState({ mode: 'marker', marker: m.key });
                  }}
                  className={`absolute top-0 bottom-0 border-l-2 ${m.border} cursor-ew-resize z-20`}
                  style={{ left: m.tick * pxPerTick }}
                  title={`Drag ${m.label} marker (${formatBeats(m.tick)}b)`}
                >
                  <span className={`ml-0.5 px-1 py-0.5 rounded-xs ${m.bg} text-[9px] font-mono font-bold whitespace-nowrap`}>
                    {m.label}
                  </span>
                </div>
              ))}

              {/* Geometric Beat Conductor Runner (Play-Yan inspired vector silhouette) */}
              <div
                className="absolute bottom-0.5 pointer-events-none z-30 -ml-2"
                style={{
                  left: currentTick * pxPerTick,
                  transform: `translateY(${-playYanJumpPx}px)`,
                }}
              >
                <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
                  <circle cx="8" cy="7" r="5.5" fill="#FF5A36" stroke="#FFFFFF" strokeWidth="1.5" />
                  <circle cx="9.8" cy="6.2" r="1.2" fill="#FFFFFF" />
                  <path d="M5 12 L4 17 M11 12 L12 17" stroke="#F8FAFC" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
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
                  Track {idx + 1}
                </div>
              ))}
              <div
                className="flex items-center px-3 bg-[#0D1119] border-t border-white/10 text-[10px] font-mono text-slate-500"
                style={{ height: BOTTOM_TRACKER_H }}
              >
                Game Sections
              </div>
            </div>

            {/* Grid, Game Boundaries, Waveform, Events & Tool Overlay */}
            <div
              ref={tracksAreaRef}
              className={`relative flex-1 ${
                activeTool === 'pickaxe'
                  ? 'cursor-crosshair'
                  : activeTool === 'switch' || activeTool === 'stamp'
                  ? 'cursor-copy'
                  : activeTool === 'ruler'
                  ? 'cursor-ew-resize'
                  : 'cursor-default'
              }`}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget && !((e.target as HTMLElement).dataset.bgCanvas === '1')) {
                  return;
                }
                const tick = snapTick(xToTick(e.clientX));
                if (activeTool === 'switch') {
                  onInsertSwitchAtTick(selectedGame, tick, e.altKey);
                  return;
                }
                if (activeTool === 'stamp') {
                  onStampAtTick(tick, e.shiftKey);
                  return;
                }
                if (activeTool === 'ruler') {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDragState({ mode: 'ruler', startTick: tick, endTick: tick });
                  return;
                }
                if (activeTool === 'select') {
                  const pt = clientToCanvasXY(e.clientX, e.clientY);
                  onSelectEvents([]);
                  onSeekTick(tick);
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDragState({
                    mode: 'marquee',
                    startX: pt.x,
                    startY: pt.y,
                    curX: pt.x,
                    curY: pt.y,
                  });
                }
              }}
            >
              {/* RHREfresh Game Boundary Backdrop Bands */}
              <div
                data-bg-canvas="1"
                className="absolute left-0 right-0 pointer-events-none"
                style={{ top: SWITCH_ROW_H, height: NUM_CUE_LANES * CUE_ROW_H }}
              >
                {gameSections.map((sec, idx) => {
                  const meta = GAME_META[sec.game];
                  const left = sec.startTick * pxPerTick;
                  const width = (sec.endTick - sec.startTick) * pxPerTick;
                  return (
                    <div
                      key={`${sec.game}_${idx}`}
                      className="absolute top-0 bottom-0 border-l border-white/10"
                      style={{
                        left,
                        width,
                        backgroundColor: `${meta.accent}0F`,
                      }}
                    >
                      <div
                        className="px-2 pt-1 text-[10px] font-display font-bold tracking-wide opacity-35 truncate"
                        style={{ color: meta.accent }}
                      >
                        {meta.title}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Beat & Sub-beat Vertical Grid Lines */}
              {beatMarks.map((b) => (
                <React.Fragment key={b}>
                  <div
                    className={`absolute top-0 bottom-0 pointer-events-none border-l ${
                      b % 4 === 0 ? 'border-white/12' : 'border-white/[0.045]'
                    }`}
                    style={{ left: b * zoomPxPerBeat }}
                  />
                  {showSubbeatLines &&
                    Array.from({ length: snapDenominator - 1 }, (_, s) => (
                      <div
                        key={s}
                        className="absolute top-0 bottom-0 pointer-events-none border-l border-white/[0.02]"
                        style={{ left: (b + (s + 1) / snapDenominator) * zoomPxPerBeat }}
                      />
                    ))}
                </React.Fragment>
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
                data-bg-canvas="1"
                className="relative border-b border-white/10 bg-[#131823]/65"
                style={{ height: SWITCH_ROW_H }}
              >
                {fxEvents.map((ev) => {
                  const left = ev.tick * pxPerTick;
                  const isSelected = selectedSet.has(ev.id);
                  const onBlockPointerDown = (e: React.PointerEvent, origSpan: number) => {
                    e.stopPropagation();
                    if (activeTool === 'pickaxe') {
                      onDeleteEvent(ev.id);
                      return;
                    }
                    if (activeTool === 'ruler') {
                      setDragState({ mode: 'ruler', startTick: ev.tick, endTick: ev.tick });
                      return;
                    }
                    let nextSelection = selectedEventIds;
                    if (e.shiftKey) {
                      nextSelection = isSelected
                        ? selectedEventIds.filter((id) => id !== ev.id)
                        : [...selectedEventIds, ev.id];
                      onSelectEvents(nextSelection);
                    } else if (!isSelected) {
                      nextSelection = [ev.id];
                      onSelectEvents(nextSelection);
                    }
                    const movingIds = nextSelection.includes(ev.id) ? nextSelection : [ev.id];
                    const origPositions = movingIds
                      .map((id) => {
                        const found = timeline.events.find((x) => x.id === id);
                        return found ? { id, origTick: found.tick } : null;
                      })
                      .filter((x): x is { id: string; origTick: number } => Boolean(x));
                    setDragState({
                      mode: 'move',
                      startX: e.clientX,
                      duplicate: e.altKey,
                      origPositions: origPositions.length ? origPositions : [{ id: ev.id, origTick: ev.tick }],
                    });
                    void origSpan;
                  };

                  if (ev.op === 'switch' && ev.game) {
                    const meta = GAME_META[ev.game];
                    const isCut = ev.style === -1;
                    const transW = isCut ? 52 : Math.max(66, timeline.translen * pxPerTick);
                    return (
                      <div
                        key={ev.id}
                        onPointerDown={(e) => onBlockPointerDown(e, transW / pxPerTick)}
                        className={`absolute top-1.5 bottom-1.5 rounded-md border flex items-center px-2 gap-1.5 cursor-grab active:cursor-grabbing touch-none ${
                          activeTool === 'pickaxe' ? 'hover:ring-2 hover:ring-rose-500' : ''
                        } ${
                          isSelected
                            ? 'ring-2 ring-white border-white z-20'
                            : 'border-white/20 hover:border-white/40 z-10'
                        }`}
                        style={{
                          left,
                          width: transW,
                          backgroundColor: `${meta.accent}38`,
                        }}
                        title={`Switch -> ${meta.title} (${isCut ? 'CUT' : 'Smooth'}) @ ${formatBeats(ev.tick)}b`}
                      >
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
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
                        onPointerDown={(e) => onBlockPointerDown(e, ev.fadeLen ?? 480)}
                        className={`absolute top-2 bottom-2 rounded border bg-slate-700/70 flex items-center px-2 cursor-grab touch-none ${
                          activeTool === 'pickaxe' ? 'hover:ring-2 hover:ring-rose-500' : ''
                        } ${isSelected ? 'ring-2 ring-white border-white z-20' : 'border-white/25 z-10'}`}
                        style={{ left, width: w }}
                      >
                        <span className="text-[10px] font-mono text-slate-200 truncate">
                          fade α={ev.alpha}
                        </span>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectEvents([ev.id]);
                            setDragState({
                              mode: 'resize',
                              eventId: ev.id,
                              startX: e.clientX,
                              origSpanTicks: ev.fadeLen ?? 480,
                            });
                          }}
                        />
                      </div>
                    );
                  }
                  return (
                    <div
                      key={ev.id}
                      onPointerDown={(e) => onBlockPointerDown(e, 240)}
                      className={`absolute top-2 bottom-2 rounded border bg-amber-500/25 flex items-center px-2 cursor-grab touch-none ${
                        activeTool === 'pickaxe' ? 'hover:ring-2 hover:ring-rose-500' : ''
                      } ${isSelected ? 'ring-2 ring-white border-white z-20' : 'border-amber-400/50 z-10'}`}
                      style={{ left, minWidth: 72 }}
                    >
                      <span className="text-[10px] font-mono text-amber-200 truncate">
                        anim {ev.animName}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 4 Polyphonic Cue Lanes */}
              {Array.from({ length: NUM_CUE_LANES }, (_, laneIdx) => (
                <div
                  key={laneIdx}
                  data-bg-canvas="1"
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
                      const isSelected = selectedSet.has(ev.id);
                      const label = ev.word ?? cueDef?.name ?? `0x${(ev.fn ?? 0).toString(16).toUpperCase()}`;
                      const leadPx = Math.min(width - 12, (cueDef?.leadInBeats ?? 0) * zoomPxPerBeat);

                      return (
                        <div
                          key={ev.id}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            if (activeTool === 'pickaxe') {
                              onDeleteEvent(ev.id);
                              return;
                            }
                            if (activeTool === 'ruler') {
                              setDragState({ mode: 'ruler', startTick: ev.tick, endTick: ev.tick + spanTicks });
                              return;
                            }
                            let nextSelection = selectedEventIds;
                            if (e.shiftKey) {
                              nextSelection = isSelected
                                ? selectedEventIds.filter((id) => id !== ev.id)
                                : [...selectedEventIds, ev.id];
                              onSelectEvents(nextSelection);
                            } else if (!isSelected) {
                              nextSelection = [ev.id];
                              onSelectEvents(nextSelection);
                            }
                            const movingIds = nextSelection.includes(ev.id) ? nextSelection : [ev.id];
                            const origPositions = movingIds
                              .map((id) => {
                                const found = timeline.events.find((x) => x.id === id);
                                return found ? { id, origTick: found.tick } : null;
                              })
                              .filter((x): x is { id: string; origTick: number } => Boolean(x));

                            setDragState({
                              mode: 'move',
                              startX: e.clientX,
                              duplicate: e.altKey,
                              origPositions: origPositions.length
                                ? origPositions
                                : [{ id: ev.id, origTick: ev.tick }],
                            });
                          }}
                          className={`absolute top-1.5 bottom-1.5 rounded-lg border flex flex-col justify-center px-2.5 overflow-hidden cursor-grab active:cursor-grabbing touch-none ${
                            activeTool === 'pickaxe' ? 'hover:ring-2 hover:ring-rose-500' : ''
                          } ${
                            isSelected
                              ? 'ring-2 ring-white border-white z-20 shadow-lg'
                              : 'border-white/20 hover:border-white/40 z-10'
                          }`}
                          style={{
                            left,
                            width,
                            backgroundColor: `${meta.accent}30`,
                          }}
                          title={`${meta.title} · ${label} @ ${formatBeats(ev.tick)}b (${ev.tick}t)`}
                        >
                          {leadPx > 14 && (
                            <div
                              className="absolute left-0 top-0 bottom-0 border-r border-dashed border-white/30 bg-black/25 pointer-events-none"
                              style={{ width: leadPx }}
                            />
                          )}

                          <div className="relative flex items-center justify-between gap-1.5 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-xs shrink-0"
                                style={{ backgroundColor: meta.accent }}
                              />
                              <span className="text-xs font-semibold text-white truncate">
                                {label}
                              </span>
                            </div>
                            {ev.tag && (
                              <span className="text-[10px] font-mono text-slate-200 shrink-0">
                                {ev.tag}
                              </span>
                            )}
                          </div>
                          <div className="relative text-[10px] font-mono text-slate-300/85 truncate tabular-nums">
                            {game} · {formatBeats(ev.tick)}b
                          </div>

                          {cueDef?.stretchable && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-white/30"
                              title="Drag edge to adjust spacing/length"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onSelectEvents([ev.id]);
                                setDragState({
                                  mode: 'resize',
                                  eventId: ev.id,
                                  startX: e.clientX,
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

              {/* RHREfresh Bottom Tracker Strip: Active Game Sections */}
              <div
                className="relative border-t border-white/10 bg-[#0D1119]"
                style={{ height: BOTTOM_TRACKER_H }}
              >
                {gameSections.map((sec, idx) => {
                  const meta = GAME_META[sec.game];
                  const left = sec.startTick * pxPerTick;
                  const width = Math.max(24, (sec.endTick - sec.startTick) * pxPerTick);
                  return (
                    <div
                      key={`bt_${sec.game}_${idx}`}
                      className="absolute top-0.5 bottom-0.5 border-l-2 px-1.5 flex items-center overflow-hidden"
                      style={{
                        left,
                        width,
                        borderColor: meta.accent,
                        backgroundColor: `${meta.accent}24`,
                      }}
                    >
                      <span className="text-[10px] font-mono text-slate-200 truncate">
                        {meta.id} ({formatBeats(sec.startTick)}b)
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Hover Ghost Preview for Switch / Stamp Tools */}
              {hoverTick !== null && !dragState && (activeTool === 'switch' || activeTool === 'stamp') && (
                <div
                  className="absolute pointer-events-none z-20 rounded-md border-2 border-dashed border-[#FF5A36] bg-[#FF5A36]/15 flex items-center px-2"
                  style={{
                    top: activeTool === 'switch' ? 4 : SWITCH_ROW_H + 4,
                    height: activeTool === 'switch' ? SWITCH_ROW_H - 8 : CUE_ROW_H - 8,
                    left: hoverTick * pxPerTick,
                    width:
                      activeTool === 'switch'
                        ? Math.max(64, timeline.translen * pxPerTick)
                        : Math.max(64, stampSpanBeats * zoomPxPerBeat),
                  }}
                >
                  <span className="text-[10px] font-mono font-bold text-white truncate">
                    {activeTool === 'switch'
                      ? `switch ${selectedGame}`
                      : activePattern
                      ? activePattern.name
                      : activeCue?.name ?? selectedGame}
                  </span>
                </div>
              )}

              {/* Box Marquee Selection Overlay */}
              {dragState?.mode === 'marquee' && (
                <div
                  className="absolute border border-sky-400 bg-sky-400/15 pointer-events-none z-40"
                  style={{
                    left: Math.min(dragState.startX, dragState.curX),
                    top: Math.min(dragState.startY, dragState.curY),
                    width: Math.abs(dragState.curX - dragState.startX),
                    height: Math.abs(dragState.curY - dragState.startY),
                  }}
                />
              )}

              {/* RHREfresh Ruler Measurement Overlay */}
              {dragState?.mode === 'ruler' && (() => {
                const a = Math.min(dragState.startTick, dragState.endTick);
                const b = Math.max(dragState.startTick, dragState.endTick);
                const deltaTicks = b - a;
                const deltaBeats = deltaTicks / TPB;
                const deltaSec = (deltaBeats * 60) / Math.max(20, bpm);
                return (
                  <div
                    className="absolute top-0 bottom-0 bg-amber-400/15 border-x-2 border-amber-400 pointer-events-none z-40 flex items-center justify-center"
                    style={{
                      left: a * pxPerTick,
                      width: Math.max(2, deltaTicks * pxPerTick),
                    }}
                  >
                    <div className="px-2.5 py-1 rounded bg-[#0E1117]/95 border border-amber-400/60 font-mono text-[11px] font-semibold text-amber-200 whitespace-nowrap shadow-lg tabular-nums">
                      Δ {deltaBeats.toFixed(2)} b · {deltaTicks}t · {(deltaSec * 1000).toFixed(0)} ms
                    </div>
                  </div>
                );
              })()}

              {/* Playhead Line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#FF5A36] pointer-events-none z-30"
                style={{ left: currentTick * pxPerTick }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
