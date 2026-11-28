import React, { useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  Music,
  Volume2,
  VolumeX,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Bell,
  MousePointer,
  ArrowRightLeft,
  Hammer,
  Ruler,
  Stamp,
} from 'lucide-react';
import { TPB } from '../engine/cues.ts';
import { type EditorTool } from '../engine/patternStore.ts';

interface TransportBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onJumpStart: () => void;
  currentTick: number;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  snapDenominator: number;
  onSnapChange: (denom: number) => void;
  zoomPxPerBeat: number;
  onZoomChange: (px: number) => void;
  metronomeOn: boolean;
  onToggleMetronome: () => void;
  cueSfxOn: boolean;
  onToggleCueSfx: () => void;
  musicName: string | null;
  onUploadMusic: (file: File) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  hasActivePattern: boolean;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  isPlaying,
  onTogglePlay,
  onStop,
  onJumpStart,
  currentTick,
  bpm,
  onBpmChange,
  snapDenominator,
  onSnapChange,
  zoomPxPerBeat,
  onZoomChange,
  metronomeOn,
  onToggleMetronome,
  cueSfxOn,
  onToggleCueSfx,
  musicName,
  onUploadMusic,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  activeTool,
  onToolChange,
  hasActivePattern,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const tapTimesRef = useRef<number[]>([]);

  const handleTapTempo = () => {
    const now = performance.now();
    const arr = tapTimesRef.current.filter((t) => now - t < 2500);
    arr.push(now);
    tapTimesRef.current = arr;
    if (arr.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < arr.length; i++) diffs.push(arr[i] - arr[i - 1]);
      const avgMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const calcBpm = Math.round(Math.max(40, Math.min(260, 60000 / avgMs)));
      onBpmChange(calcBpm);
    }
  };

  const currentBeat = currentTick / TPB;
  const bar = Math.floor(currentBeat / 4) + 1;
  const beatInBar = (currentBeat % 4) + 1;
  const sec = (currentBeat * 60) / Math.max(20, bpm);
  const mins = Math.floor(sec / 60);
  const remSec = (sec % 60).toFixed(2).padStart(5, '0');

  const tools: Array<{ id: EditorTool; label: string; keyHint: string; icon: React.ReactNode }> = [
    { id: 'select', label: 'Select', keyHint: '1', icon: <MousePointer className="w-3.5 h-3.5" /> },
    { id: 'switch', label: 'Switch', keyHint: '2', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
    { id: 'pickaxe', label: 'Erase', keyHint: '3', icon: <Hammer className="w-3.5 h-3.5" /> },
    { id: 'ruler', label: 'Ruler', keyHint: '4', icon: <Ruler className="w-3.5 h-3.5" /> },
    { id: 'stamp', label: hasActivePattern ? 'Stamp' : 'Place', keyHint: '5', icon: <Stamp className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-[#141922] shrink-0">
      {/* Left: Transport & Timecode */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onJumpStart}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white hover:bg-[#242D3F] transition-colors"
          title="Jump to Beat 0"
          aria-label="Jump to start"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className={`inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-lg font-semibold text-xs transition-colors whitespace-nowrap shrink-0 ${
            isPlaying
              ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              : 'bg-[#FF5A36] text-white hover:bg-[#FF6E4E]'
          }`}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 bg-[#1B2230] text-slate-300 hover:text-white hover:bg-[#242D3F] transition-colors"
          title="Stop & Reset"
          aria-label="Stop"
        >
          <Square className="w-3.5 h-3.5" />
        </button>

        <div className="hidden xl:flex items-center gap-2 ml-1 px-2.5 h-9 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs tabular-nums">
          <span className="text-white font-semibold">{currentBeat.toFixed(2)} b</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-400">M{bar}:{beatInBar.toFixed(1)}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-sky-400">{mins}:{remSec}</span>
        </div>
      </div>

      {/* Center: RHREfresh Tool Strip */}
      <div
        className="flex items-center gap-0.5 p-1 rounded-lg border border-white/10 bg-[#0E1117]"
        role="toolbar"
        aria-label="Timeline Editing Tools"
      >
        {tools.map((t) => {
          const active = activeTool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToolChange(t.id)}
              title={`${t.label} (${t.keyHint})`}
              className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? t.id === 'pickaxe'
                    ? 'bg-rose-500 text-white'
                    : 'bg-[#FF5A36] text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              <span className="hidden md:inline font-mono text-[9px] opacity-65">{t.keyHint}</span>
            </button>
          );
        })}
      </div>

      {/* Right: BPM, Music, Audio, Snap, Zoom, Undo/Redo */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1 px-2 h-9 rounded-lg border border-white/10 bg-[#0E1117]">
          <label htmlFor="bpm-input" className="text-[11px] font-medium text-slate-400">
            BPM
          </label>
          <input
            id="bpm-input"
            type="number"
            min={40}
            max={260}
            step={0.5}
            value={bpm}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 30 && v <= 300) onBpmChange(v);
            }}
            className="w-14 bg-transparent font-mono text-xs font-semibold text-white text-right focus:outline-none tabular-nums"
          />
          <button
            type="button"
            onClick={handleTapTempo}
            className="px-1.5 py-0.5 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-slate-300 transition-colors whitespace-nowrap shrink-0"
            title="Tap to detect BPM"
          >
            Tap
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadMusic(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 max-w-[140px]"
          title={musicName ? `Loaded: ${musicName}` : 'Import Music Track'}
        >
          <Music className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="truncate">{musicName || 'Music'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMetronome}
          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border text-xs font-medium transition-colors shrink-0 ${
            metronomeOn
              ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
              : 'border-white/10 bg-[#1B2230] text-slate-400 hover:text-slate-200'
          }`}
          title="Toggle Metronome Click"
          aria-label="Toggle Metronome"
        >
          <Bell className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onToggleCueSfx}
          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border text-xs font-medium transition-colors shrink-0 ${
            cueSfxOn
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-white/10 bg-[#1B2230] text-slate-400 hover:text-slate-200'
          }`}
          title="Toggle Cue Audio Preview"
          aria-label="Toggle Cue SFX"
        >
          {cueSfxOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-1 px-2 h-9 rounded-lg border border-white/10 bg-[#0E1117]">
          <span className="text-[10px] text-slate-400">Snap</span>
          <select
            value={snapDenominator}
            onChange={(e) => onSnapChange(Number(e.target.value))}
            className="bg-transparent font-mono text-xs text-white focus:outline-none"
            aria-label="Grid Snap"
          >
            <option value={1} className="bg-[#161B24]">1b</option>
            <option value={2} className="bg-[#161B24]">1/2</option>
            <option value={3} className="bg-[#161B24]">1/3</option>
            <option value={4} className="bg-[#161B24]">1/4</option>
            <option value={6} className="bg-[#161B24]">1/6</option>
            <option value={8} className="bg-[#161B24]">1/8</option>
            <option value={0} className="bg-[#161B24]">Free</option>
          </select>
        </div>

        <div className="hidden sm:flex items-center rounded-lg border border-white/10 bg-[#1B2230] overflow-hidden h-9">
          <button
            type="button"
            onClick={() => onZoomChange(Math.max(24, zoomPxPerBeat - 12))}
            className="px-2 h-full text-slate-300 hover:bg-white/5"
            title="Zoom Out"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-1 font-mono text-[10px] text-slate-400 tabular-nums">
            {zoomPxPerBeat}px
          </span>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(140, zoomPxPerBeat + 12))}
            className="px-2 h-full text-slate-300 hover:bg-white/5"
            title="Zoom In"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center rounded-lg border border-white/10 bg-[#1B2230] overflow-hidden h-9">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            className="px-2 h-full text-slate-300 hover:bg-white/5 disabled:opacity-35"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            className="px-2 h-full text-slate-300 hover:bg-white/5 disabled:opacity-35"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
