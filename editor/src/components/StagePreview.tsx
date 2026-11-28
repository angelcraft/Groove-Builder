import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Gamepad2, Music2 } from 'lucide-react';
import { GAME_META, type GameId, TPB } from '../engine/cues.ts';
import { type CustomSpriteConfig } from '../engine/groovePackage.ts';
import { activeGameAtTick, type Timeline } from '../engine/gtfEngine.ts';
import {
  collectStageBoundImages,
  type GameAssetBinding,
  type LocalAssetRecord,
  MAX_CACHED_IMAGE_RGBA_BYTES,
  MAX_CACHED_IMAGES,
  StageImageCacheManager,
} from '../engine/localAssetVault.ts';
import { evaluatePlayalongHit, type PlayalongHitResult } from '../engine/patternStore.ts';
import { renderStageFrame } from '../stage/stageRenderer.ts';

interface StagePreviewProps {
  timeline: Timeline;
  currentTick: number;
  bpm: number;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  prologueImageDataUrl?: string;
  vaultBindings?: Partial<Record<GameId, GameAssetBinding>>;
  vaultAssets?: LocalAssetRecord[];
  onPlayJingle: (code: number) => void;
  onTriggerTapSound?: () => void;
  compact?: boolean;
}

function disposeDomImage(img: HTMLImageElement | null | undefined) {
  if (!img) return;
  img.onload = null;
  img.onerror = null;
  img.src = '';
}

export const StagePreview: React.FC<StagePreviewProps> = ({
  timeline,
  currentTick,
  bpm,
  sprites,
  prologueImageDataUrl,
  vaultBindings,
  vaultAssets = [],
  onPlayJingle,
  onTriggerTapSound,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewPrologue, setPreviewPrologue] = useState(false);
  const [playalongMode, setPlayalongMode] = useState(false);
  const [lastHit, setLastHit] = useState<PlayalongHitResult | null>(null);
  const [vaultImgVersion, setVaultImgVersion] = useState(0);
  const spriteCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const vaultImageManagerRef = useRef<StageImageCacheManager<HTMLImageElement> | null>(null);
  if (!vaultImageManagerRef.current) {
    vaultImageManagerRef.current = new StageImageCacheManager<HTMLImageElement>({
      maxImages: MAX_CACHED_IMAGES,
      maxRgbaBytes: MAX_CACHED_IMAGE_RGBA_BYTES,
      createImage: (src, handlers) => {
        const img = new Image();
        img.onload = handlers.onLoad;
        img.onerror = handlers.onError;
        img.src = src;
        return img;
      },
      disposeImage: disposeDomImage,
      onUpdate: () => setVaultImgVersion((v) => v + 1),
    });
  }
  const prologueImgRef = useRef<HTMLImageElement | null>(null);

  const vaultAssetsById = useMemo(() => {
    const map = new Map<string, LocalAssetRecord>();
    for (const a of vaultAssets) map.set(a.id, a);
    return map;
  }, [vaultAssets]);

  const stageState = activeGameAtTick(timeline, currentTick);

  useEffect(() => {
    const activeKeys = new Set<string>();
    for (const [gameKey, cfg] of Object.entries(sprites) as Array<[GameId, CustomSpriteConfig]>) {
      if (cfg?.imageDataUrl) {
        activeKeys.add(gameKey);
        const existing = spriteCacheRef.current.get(gameKey);
        if (!existing || existing.src !== cfg.imageDataUrl) {
          disposeDomImage(existing);
          const img = new Image();
          img.onload = () => setVaultImgVersion((v) => v + 1);
          img.src = cfg.imageDataUrl;
          spriteCacheRef.current.set(gameKey, img);
        }
      }
    }
    for (const [key, img] of [...spriteCacheRef.current.entries()]) {
      if (!activeKeys.has(key)) {
        disposeDomImage(img);
        spriteCacheRef.current.delete(key);
      }
    }
  }, [sprites]);

  // Scene-scoped image caching: loads ONLY assets bound to active/bound scenes (never unbound inventory)
  useEffect(() => {
    const wanted = collectStageBoundImages({
      currentGame: stageState.game,
      prevGame: stageState.prevGame,
      vaultBindings,
      vaultAssetsById,
    });
    vaultImageManagerRef.current?.syncActiveScenes(wanted);
  }, [stageState.game, stageState.prevGame, vaultBindings, vaultAssetsById]);

  useEffect(() => {
    if (prologueImageDataUrl) {
      if (prologueImgRef.current?.src !== prologueImageDataUrl) {
        disposeDomImage(prologueImgRef.current);
        const img = new Image();
        img.onload = () => setVaultImgVersion((v) => v + 1);
        img.src = prologueImageDataUrl;
        prologueImgRef.current = img;
      }
    } else {
      disposeDomImage(prologueImgRef.current);
      prologueImgRef.current = null;
    }
  }, [prologueImageDataUrl]);

  useEffect(() => {
    const spriteCache = spriteCacheRef.current;
    const vaultMgr = vaultImageManagerRef.current;
    return () => {
      vaultMgr?.disposeAll();
      for (const img of spriteCache.values()) {
        disposeDomImage(img);
      }
      spriteCache.clear();
      disposeDomImage(prologueImgRef.current);
      prologueImgRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderStageFrame(ctx, canvas.width, canvas.height, {
      timeline,
      currentTick,
      bpm,
      previewPrologue,
      sprites,
      spriteImageCache: spriteCacheRef.current,
      prologueImage: prologueImgRef.current,
      lastPlayalongHit: lastHit,
      playalongMode,
      vaultBindings,
      vaultAssetsById,
      vaultImageCache: vaultImageManagerRef.current?.getReadonlyImageMap(),
    });
  }, [
    timeline,
    currentTick,
    bpm,
    previewPrologue,
    sprites,
    prologueImageDataUrl,
    lastHit,
    playalongMode,
    vaultBindings,
    vaultAssetsById,
    vaultImgVersion,
  ]);

  const handlePlayalongInput = () => {
    onTriggerTapSound?.();
    const res = evaluatePlayalongHit(timeline, currentTick, bpm);
    setLastHit(
      res ?? {
        judgement: 'MISS',
        deltaMs: 0,
        targetTick: currentTick,
        game: activeGameAtTick(timeline, currentTick).game,
        cueName: 'No cue',
      }
    );
  };

  useEffect(() => {
    if (!playalongMode) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyJ' || e.code === 'KeyK') {
        e.preventDefault();
        handlePlayalongInput();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
            onClick={() => setPlayalongMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              playalongMode
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-[#1D2433] text-slate-300 hover:bg-[#273044]'
            }`}
            title="Heaven Studio-style Playalong timing tester (Press J/K or Tap Pad)"
          >
            <Gamepad2 className="w-3 h-3" />
            Playalong
          </button>
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

      <div className={`relative w-full bg-[#090C11] flex items-center justify-center ${compact ? 'aspect-video' : 'aspect-video max-h-[480px]'}`}>
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

      {playalongMode && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#0E131B] border-t border-white/10">
          <div className="text-[11px] text-slate-400 truncate">
            Test cue timing with <span className="font-mono text-slate-200">J</span> /{' '}
            <span className="font-mono text-slate-200">K</span> or tap pad
          </div>
          <button
            type="button"
            onPointerDown={handlePlayalongInput}
            className="px-4 min-h-[36px] rounded-lg bg-[#FF5A36] hover:bg-[#FF6E4E] active:scale-95 text-xs font-bold text-white transition-transform whitespace-nowrap shrink-0"
          >
            A / Tap Hit
          </button>
        </div>
      )}
    </div>
  );
};
