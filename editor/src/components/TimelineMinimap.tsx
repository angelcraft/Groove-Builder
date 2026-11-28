import React, { useMemo, useRef } from 'react';
import { GAME_META, TPB } from '../engine/cues.ts';
import { type Timeline } from '../engine/gtfEngine.ts';
import { computeGameSections } from '../engine/patternStore.ts';

interface TimelineMinimapProps {
  timeline: Timeline;
  totalBeats: number;
  currentTick: number;
  viewportStartBeat: number;
  viewportSpanBeats: number;
  onSeekTick: (tick: number) => void;
  onJumpToBeat: (beat: number) => void;
}

export const TimelineMinimap: React.FC<TimelineMinimapProps> = ({
  timeline,
  totalBeats,
  currentTick,
  viewportStartBeat,
  viewportSpanBeats,
  onSeekTick,
  onJumpToBeat,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const totalTicks = Math.max(1, totalBeats * TPB);

  const sections = useMemo(
    () => computeGameSections(timeline, totalTicks),
    [timeline, totalTicks]
  );

  const handlePointer = (clientX: number, movePlayhead: boolean) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const beat = ratio * totalBeats;
    onJumpToBeat(Math.max(0, beat - viewportSpanBeats * 0.35));
    if (movePlayhead) {
      onSeekTick(Math.round(beat * TPB));
    }
  };

  const viewLeftPct = Math.max(0, Math.min(100, (viewportStartBeat / totalBeats) * 100));
  const viewWidthPct = Math.max(4, Math.min(100 - viewLeftPct, (viewportSpanBeats / totalBeats) * 100));

  return (
    <div
      ref={barRef}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        handlePointer(e.clientX, e.shiftKey);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handlePointer(e.clientX, e.shiftKey);
      }}
      className="relative h-7 bg-[#0A0D13] border-b border-white/10 cursor-pointer select-none overflow-hidden shrink-0"
      title="Song Minimap: drag to pan timeline, Shift+Click to seek playhead"
    >
      {/* RHREfresh Game Section Color Bands */}
      {sections.map((sec, idx) => {
        const left = (sec.startTick / totalTicks) * 100;
        const width = Math.max(0.4, ((sec.endTick - sec.startTick) / totalTicks) * 100);
        const meta = GAME_META[sec.game];
        return (
          <div
            key={`${sec.game}_${idx}`}
            className="absolute top-0 bottom-0 border-r border-black/30"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: `${meta.accent}35`,
            }}
          >
            {width > 4 && (
              <span className="px-1 text-[9px] font-mono text-white/75 truncate block leading-3 pt-0.5">
                {sec.game}
              </span>
            )}
          </div>
        );
      })}

      {/* Cue density ticks */}
      {timeline.events.map((ev) => {
        if (ev.op !== 'call' || !ev.game) return null;
        const left = Math.min(99.6, (ev.tick / totalTicks) * 100);
        return (
          <div
            key={ev.id}
            className="absolute bottom-1 h-2 w-[2px] rounded-xs pointer-events-none"
            style={{
              left: `${left}%`,
              backgroundColor: GAME_META[ev.game].accent,
            }}
          />
        );
      })}

      {/* Start / End / Finish ticks */}
      <div
        className="absolute top-0 bottom-0 w-px bg-emerald-400/80 pointer-events-none"
        style={{ left: `${(timeline.start / totalTicks) * 100}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-amber-400/80 pointer-events-none"
        style={{ left: `${(timeline.end / totalTicks) * 100}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-rose-400/80 pointer-events-none"
        style={{ left: `${(timeline.finish / totalTicks) * 100}%` }}
      />

      {/* Current Viewport Box */}
      <div
        className="absolute top-0.5 bottom-0.5 border border-white/60 bg-white/10 rounded-xs pointer-events-none"
        style={{
          left: `${viewLeftPct}%`,
          width: `${viewWidthPct}%`,
        }}
      />

      {/* Playhead Line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-[#FF5A36] pointer-events-none"
        style={{ left: `${Math.min(100, (currentTick / totalTicks) * 100)}%` }}
      />
    </div>
  );
};
