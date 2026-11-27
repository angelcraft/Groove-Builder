import React, { useEffect, useRef, useState } from 'react';
import { Eye, Music2 } from 'lucide-react';
import { GAME_META, GameId, TPB } from '../engine/cues.ts';
import { CustomSpriteConfig } from '../engine/groovePackage.ts';
import { activeGameAtTick, Timeline } from '../engine/gtfEngine.ts';
import { renderStageFrame } from '../stage/stageRenderer.ts';

interface StagePreviewProps {
  timeline: Timeline;
  currentTick: number;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  prologueImageDataUrl?: string;
  onPlayJingle: (code: number) => void;
  compact?: boolean;
}

export const StagePreview: React.FC<StagePreviewProps> = ({
  timeline,
  currentTick,
  sprites,
  prologueImageDataUrl,
  onPlayJingle,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewPrologue, setPreviewPrologue] = useState(false);
  const spriteCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const prologueImgRef = useRef<HTMLImageElement | null>(null);

  // Sync custom sprite images into cache
  useEffect(() => {
    for (const [gameKey, cfg] of Object.entries(sprites) as Array<[GameId, CustomSpriteConfig]>) {
      if (cfg?.imageDataUrl) {
        const existing = spriteCacheRef.current.get(gameKey);
        if (!existing || existing.src !== cfg.imageDataUrl) {
          const img = new Image();
          img.src = cfg.imageDataUrl;
          spriteCacheRef.current.set(gameKey, img);
        }
      } else {
        spriteCacheRef.current.delete(gameKey);
      }
    }
  }, [sprites]);

  useEffect(() => {
    if (prologueImageDataUrl) {
      const img = new Image();
      img.src = prologueImageDataUrl;
      prologueImgRef.current = img;
    } else {
      prologueImgRef.current = null;
    }
  }, [prologueImageDataUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderStageFrame(ctx, canvas.width, canvas.height, {
      timeline,
      currentTick,
      previewPrologue,
      sprites,
      spriteImageCache: spriteCacheRef.current,
      prologueImage: prologueImgRef.current,
    });
  }, [timeline, currentTick, previewPrologue, sprites, prologueImageDataUrl]);

  const state = activeGameAtTick(timeline, currentTick);
  const activeMeta = GAME_META[state.game];

  return (
    <div className="flex flex-col bg-[#12161F] border-b border-white/10">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-xs text-slate-300 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: activeMeta.accent }}
          />
          <span className="font-semibold text-white truncate">{activeMeta.title}</span>
          <span className="text-slate-500 hidden sm:inline" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-slate-400 hidden sm:inline tabular-nums">
            {(currentTick / TPB).toFixed(2)} b
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setPreviewPrologue((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              previewPrologue
                ? 'bg-[#FF5A36] text-white'
                : 'bg-[#1D2433] text-slate-300 hover:bg-[#273044]'
            }`}
          >
            <Eye className="w-3 h-3" />
            Intro
          </button>
          {timeline.jingle >= 0x158 && (
            <button
              type="button"
              onClick={() => onPlayJingle(timeline.jingle)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1D2433] hover:bg-[#273044] text-[11px] font-medium text-slate-300 whitespace-nowrap"
              title="Preview Prologue Jingle"
            >
              <Music2 className="w-3 h-3 text-amber-400" />
              Jingle
            </button>
          )}
        </div>
      </div>

      <div className={`relative w-full bg-[#090C11] flex items-center justify-center ${compact ? 'aspect-video' : 'aspect-video max-h-[520px]'}`}>
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full h-full object-contain"
        />
        {state.transitionProgress < 1 && (
          <div className="absolute bottom-2 left-3 right-3 h-1 bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#FF5A36]"
              style={{ width: `${Math.round(state.transitionProgress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
