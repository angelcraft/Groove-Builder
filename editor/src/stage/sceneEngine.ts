import { findCueDef, GAME_META, type GameId, GAMES, TPB } from '../engine/cues.ts';
import { type CustomSpriteConfig } from '../engine/groovePackage.ts';
import { type Timeline, type TimelineEvent } from '../engine/gtfEngine.ts';
import {
  type GameAssetBinding,
  type LocalAssetRecord,
  resolveActiveAnimationFrame,
} from '../engine/localAssetVault.ts';
import { type PlayalongHitResult } from '../engine/patternStore.ts';
import { renderRingScene, type RingSceneState } from './scenes/ringScene.ts';
import { renderBflytLayoutWithBflan, renderBfresModel } from './switchCompositor.ts';

export interface SceneVisualProfile {
  game: GameId;
  skyTop: string;
  skyBottom: string;
  floorTop: string;
  floorBottom: string;
  horizonRatio: number;
  cameraBouncePx: number;
  cameraZoomPulse: number;
  lookaheadBeats: number;
  hasDedicatedScene: boolean;
}

export const SCENE_PROFILES: Record<GameId, SceneVisualProfile> = {
  PUMPUP: {
    game: 'PUMPUP',
    skyTop: '#2B171D',
    skyBottom: '#160D12',
    floorTop: '#3C232A',
    floorBottom: '#1A0F14',
    horizonRatio: 0.72,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.025,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  FLYDISC: {
    game: 'FLYDISC',
    skyTop: '#163D5C',
    skyBottom: '#65B5E0',
    floorTop: '#2D6E3E',
    floorBottom: '#174023',
    horizonRatio: 0.68,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.02,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  ROLLING: {
    game: 'ROLLING',
    skyTop: '#113A32',
    skyBottom: '#266C5A',
    floorTop: '#1B4B3F',
    floorBottom: '#0B241E',
    horizonRatio: 0.72,
    cameraBouncePx: 7,
    cameraZoomPulse: 0.03,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  HUNGRY: {
    game: 'HUNGRY',
    skyTop: '#3B1033',
    skyBottom: '#6E1E5B',
    floorTop: '#2A0C24',
    floorBottom: '#170614',
    horizonRatio: 0.74,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.028,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  CARS: {
    game: 'CARS',
    skyTop: '#102542',
    skyBottom: '#264F82',
    floorTop: '#28303E',
    floorBottom: '#141922',
    horizonRatio: 0.66,
    cameraBouncePx: 4,
    cameraZoomPulse: 0.02,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  KAERU: {
    game: 'KAERU',
    skyTop: '#0E3A2F',
    skyBottom: '#196953',
    floorTop: '#104A3B',
    floorBottom: '#07241C',
    horizonRatio: 0.70,
    cameraBouncePx: 7,
    cameraZoomPulse: 0.03,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  CRAB: {
    game: 'CRAB',
    skyTop: '#1A3E59',
    skyBottom: '#3D8BB5',
    floorTop: '#C9A26B',
    floorBottom: '#8C6839',
    horizonRatio: 0.68,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.022,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  INSECT: {
    game: 'INSECT',
    skyTop: '#233A19',
    skyBottom: '#4E7D34',
    floorTop: '#2F4D20',
    floorBottom: '#16270F',
    horizonRatio: 0.72,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.024,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  SOFTCATCH: {
    game: 'SOFTCATCH',
    skyTop: '#2F2513',
    skyBottom: '#5A4620',
    floorTop: '#3E2F16',
    floorBottom: '#1E160A',
    horizonRatio: 0.72,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.026,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  RING: {
    game: 'RING',
    skyTop: '#093463',
    skyBottom: '#7CD6F7',
    floorTop: '#1C85CA',
    floorBottom: '#09315C',
    horizonRatio: 0.36,
    cameraBouncePx: 4,
    cameraZoomPulse: 0.04,
    lookaheadBeats: 4.5,
    hasDedicatedScene: true,
  },
  THUNDER: {
    game: 'THUNDER',
    skyTop: '#1A1C2E',
    skyBottom: '#333857',
    floorTop: '#24273C',
    floorBottom: '#121320',
    horizonRatio: 0.70,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.03,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  HAMMER: {
    game: 'HAMMER',
    skyTop: '#2B1618',
    skyBottom: '#5A282D',
    floorTop: '#361B1E',
    floorBottom: '#180B0D',
    horizonRatio: 0.72,
    cameraBouncePx: 8,
    cameraZoomPulse: 0.035,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  MOON: {
    game: 'MOON',
    skyTop: '#121536',
    skyBottom: '#282E6B',
    floorTop: '#1E2352',
    floorBottom: '#0B0D24',
    horizonRatio: 0.72,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.025,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  THE_A: {
    game: 'THE_A',
    skyTop: '#26143D',
    skyBottom: '#4E267A',
    floorTop: '#31194F',
    floorBottom: '#160B26',
    horizonRatio: 0.72,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.028,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  PUTILABO: {
    game: 'PUTILABO',
    skyTop: '#0F2E35',
    skyBottom: '#1E5B69',
    floorTop: '#15404A',
    floorBottom: '#0A1E24',
    horizonRatio: 0.72,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.024,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  WIPER: {
    game: 'WIPER',
    skyTop: '#102542',
    skyBottom: '#2B4B75',
    floorTop: '#1B2433',
    floorBottom: '#0E131B',
    horizonRatio: 0.74,
    cameraBouncePx: 4,
    cameraZoomPulse: 0.018,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  SOCCER: {
    game: 'SOCCER',
    skyTop: '#12244A',
    skyBottom: '#274E8E',
    floorTop: '#1C5E36',
    floorBottom: '#0E331D',
    horizonRatio: 0.68,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.028,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  HURDLE: {
    game: 'HURDLE',
    skyTop: '#222F4A',
    skyBottom: '#4A6391',
    floorTop: '#7D3535',
    floorBottom: '#471C1C',
    horizonRatio: 0.68,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.025,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  TALK: {
    game: 'TALK',
    skyTop: '#161B42',
    skyBottom: '#2D3A78',
    floorTop: '#202652',
    floorBottom: '#0F122B',
    horizonRatio: 0.74,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.022,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  COOKING: {
    game: 'COOKING',
    skyTop: '#3A1922',
    skyBottom: '#6B2F3D',
    floorTop: '#452028',
    floorBottom: '#210E12',
    horizonRatio: 0.72,
    cameraBouncePx: 6,
    cameraZoomPulse: 0.026,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  PARASOL: {
    game: 'PARASOL',
    skyTop: '#36133B',
    skyBottom: '#6E2675',
    floorTop: '#451A4A',
    floorBottom: '#1F0B24',
    horizonRatio: 0.72,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.024,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  DANCER: {
    game: 'DANCER',
    skyTop: '#2F1038',
    skyBottom: '#631D70',
    floorTop: '#3D1547',
    floorBottom: '#18081C',
    horizonRatio: 0.70,
    cameraBouncePx: 7,
    cameraZoomPulse: 0.032,
    lookaheadBeats: 4,
    hasDedicatedScene: false,
  },
  SAMURAI: {
    game: 'SAMURAI',
    skyTop: '#2B1618',
    skyBottom: '#4D2227',
    floorTop: '#241416',
    floorBottom: '#11090A',
    horizonRatio: 0.72,
    cameraBouncePx: 7,
    cameraZoomPulse: 0.036,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
  BRUSH: {
    game: 'BRUSH',
    skyTop: '#14294A',
    skyBottom: '#2A5691',
    floorTop: '#1E3C66',
    floorBottom: '#0D1C33',
    horizonRatio: 0.72,
    cameraBouncePx: 5,
    cameraZoomPulse: 0.022,
    lookaheadBeats: 3,
    hasDedicatedScene: false,
  },
};

export interface SceneCameraTransform {
  zoom: number;
  panX: number;
  panY: number;
  beatBounce: number;
}

export function getWindowCuesForGame(
  events: ReadonlyArray<TimelineEvent>,
  game: GameId,
  currentTick: number,
  lookbehindBeats = 4,
  lookaheadBeats = 4
): TimelineEvent[] {
  const minTick = currentTick - Math.round(lookbehindBeats * TPB);
  const maxTick = currentTick + Math.round(lookaheadBeats * TPB);
  const out: TimelineEvent[] = [];
  for (const ev of events) {
    if (ev.op === 'call' && ev.game === game && ev.tick >= minTick && ev.tick <= maxTick) {
      out.push(ev);
    }
  }
  return out;
}

export function computeSceneCamera(
  game: GameId,
  currentTick: number,
  cueAgeBeats: number,
  bounceScale = 1
): SceneCameraTransform {
  const profile = SCENE_PROFILES[game] ?? SCENE_PROFILES.KAERU;
  const beat = Math.max(0, currentTick / TPB);
  const beatBounce = Math.exp(-(beat % 1) * 4.5) * bounceScale;
  const cuePop = cueAgeBeats < 1.2 ? Math.sin(Math.min(1, cueAgeBeats * 2.5) * Math.PI) : 0;
  return {
    zoom: 1 + beatBounce * profile.cameraZoomPulse * 0.55 + cuePop * profile.cameraZoomPulse,
    panX: 0,
    panY: beatBounce * profile.cameraBouncePx * 0.45,
    beatBounce,
  };
}

export interface MinigameSceneRenderContext {
  timeline: Timeline;
  game: GameId;
  currentTick: number;
  bpm: number;
  activeCue: TimelineEvent | null;
  cueAgeBeats: number;
  activeAnim: TimelineEvent | null;
  customSprite?: CustomSpriteConfig;
  spriteImg?: HTMLImageElement;
  vaultBinding?: GameAssetBinding;
  vaultAssetsById?: Map<string, LocalAssetRecord>;
  vaultImageCache?: Map<string, HTMLImageElement>;
  lastPlayalongHit?: PlayalongHitResult | null;
  playalongMode?: boolean;
  drawLegacyActor: (
    ctx: CanvasRenderingContext2D,
    game: GameId,
    beat: number,
    cueAgeBeats: number,
    activeCue: TimelineEvent | null,
    accent: string
  ) => void;
}

export interface MinigameSceneRenderResult {
  game: GameId;
  usedDedicatedScene: boolean;
  usedNativeLayout: boolean;
  usedNativeModel: boolean;
  ringState?: RingSceneState;
}

export function renderMinigameScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: MinigameSceneRenderContext
): MinigameSceneRenderResult {
  const {
    timeline,
    game,
    currentTick,
    bpm,
    activeCue,
    cueAgeBeats,
    activeAnim,
    customSprite,
    spriteImg,
    vaultBinding,
    vaultAssetsById,
    vaultImageCache,
    lastPlayalongHit,
    playalongMode,
    drawLegacyActor,
  } = params;

  // Dedicated high-fidelity scene for Hoop Trundling (RING)
  if (game === 'RING') {
    const ringState = renderRingScene(ctx, w, h, {
      timeline,
      currentTick,
      bpm,
      activeCue,
      cueAgeBeats,
      activeAnim,
      customSprite,
      spriteImg,
      vaultBinding,
      vaultAssetsById,
      vaultImageCache,
      lastPlayalongHit,
      playalongMode,
    });
    return {
      game,
      usedDedicatedScene: true,
      usedNativeLayout: Boolean(
        vaultBinding?.layoutAssetId && vaultAssetsById?.get(vaultBinding.layoutAssetId)?.bflytData
      ),
      usedNativeModel: Boolean(
        vaultBinding?.modelAssetId && vaultAssetsById?.get(vaultBinding.modelAssetId)?.bfresData
      ),
      ringState,
    };
  }

  // Reusable 24-minigame scene compositor for the remaining 23 games
  const profile = SCENE_PROFILES[game] ?? SCENE_PROFILES.KAERU;
  const meta = GAME_META[game];
  const beat = currentTick / TPB;
  const cam = computeSceneCamera(game, currentTick, cueAgeBeats, customSprite?.bounceAmount ?? 1);
  const cuePop = cueAgeBeats < 1.2 ? Math.sin(Math.min(1, cueAgeBeats * 2.5) * Math.PI) : 0;

  let usedNativeLayout = false;
  let usedNativeModel = false;

  ctx.save();
  ctx.translate(w / 2 + cam.panX, h / 2 + cam.panY);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-w / 2, -h / 2);

  // 1) Backdrop: User-extracted backdrop image -> Scene profile horizon & beat stage
  const backdropImg =
    vaultBinding?.backdropAssetId && vaultImageCache
      ? vaultImageCache.get(vaultBinding.backdropAssetId)
      : undefined;

  if (backdropImg && backdropImg.complete && backdropImg.naturalWidth > 0) {
    const bgScale = 1.03 + cam.beatBounce * 0.015;
    const drawW = w * bgScale;
    const drawH = h * bgScale;
    ctx.drawImage(backdropImg, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
  } else {
    const hy = h * profile.horizonRatio;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, hy);
    skyGrad.addColorStop(0, profile.skyTop);
    skyGrad.addColorStop(1, profile.skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-20, -20, w + 40, hy + 22);

    const floorGrad = ctx.createLinearGradient(0, hy, 0, h);
    floorGrad.addColorStop(0, profile.floorTop);
    floorGrad.addColorStop(1, profile.floorBottom);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(-20, hy, w + 40, h - hy + 22);

    ctx.strokeStyle = `${meta.accent}66`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-20, hy);
    ctx.lineTo(w + 20, hy);
    ctx.stroke();

    // Ambient beat pulse halo
    ctx.fillStyle = `${meta.accent}${Math.round((0.08 + cam.beatBounce * 0.14) * 255)
      .toString(16)
      .padStart(2, '0')}`;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.45, 76 + cam.beatBounce * 18 + cuePop * 24, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2) Optional Switch Native BFLYT layout + BFLAN animation curves
  const boundLayout = vaultBinding?.layoutAssetId
    ? vaultAssetsById?.get(vaultBinding.layoutAssetId)?.bflytData
    : undefined;
  if (boundLayout) {
    const comp = renderBflytLayoutWithBflan(ctx, w, h, {
      layout: boundLayout,
      binding: vaultBinding,
      vaultAssetsById,
      vaultImageCache,
      activeAnim,
      currentTick,
      bpm,
    });
    usedNativeLayout = comp.panesRendered > 0;
  }

  const cx = w / 2;
  const cy = h * 0.54 - cam.beatBounce * 9 - cuePop * 16;

  // 3) Actor Priority: Custom Project Sprite -> Local Vault Frame/BNTX/Sprite -> Native BFRES 3D Model -> Built-in Vector Actor
  const vaultFrame =
    !spriteImg && vaultBinding && vaultAssetsById
      ? resolveActiveAnimationFrame({
          game,
          binding: vaultBinding,
          assetsById: vaultAssetsById,
          currentTick,
          bpm,
          activeCue,
          cueAgeBeats,
          activeAnim,
        })
      : null;
  const vaultActorImg =
    vaultFrame && vaultImageCache ? vaultImageCache.get(vaultFrame.assetId) : undefined;
  const boundModel = vaultBinding?.modelAssetId
    ? vaultAssetsById?.get(vaultBinding.modelAssetId)?.bfresData
    : undefined;

  if (spriteImg && customSprite) {
    ctx.save();
    const scale = customSprite.scale || 1;
    const drawW = 140 * scale;
    const drawH = (spriteImg.height / Math.max(1, spriteImg.width)) * drawW;
    const px = cx + (customSprite.offsetX || 0) - drawW / 2;
    const py = cy + (customSprite.offsetY || 0) - drawH / 2;
    ctx.drawImage(spriteImg, px, py, drawW, drawH);
    if (customSprite.tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `${customSprite.tint}44`;
      ctx.fillRect(px, py, drawW, drawH);
    }
    ctx.restore();
  } else if (vaultFrame && vaultActorImg && vaultActorImg.complete && vaultActorImg.naturalWidth > 0) {
    ctx.save();
    const drawW = 156 * (vaultFrame.scale || 1);
    const aspect = vaultFrame.sh / Math.max(1, vaultFrame.sw);
    const drawH = drawW * aspect;
    const px = cx + (vaultFrame.offsetX || 0) - drawW / 2;
    const py = cy + (vaultFrame.offsetY || 0) - drawH / 2;
    ctx.drawImage(
      vaultActorImg,
      vaultFrame.sx,
      vaultFrame.sy,
      vaultFrame.sw,
      vaultFrame.sh,
      px,
      py,
      drawW,
      drawH
    );
    ctx.restore();
  } else if (boundModel && boundModel.models.some((m) => m.meshes.some((s) => s.indices.length >= 3))) {
    const mdlRes = renderBfresModel(ctx, w, h, {
      model: boundModel,
      yawRad: beat * 0.65 + cuePop * 0.4,
      pitchRad: 0.25,
      scale: 1.0 + cam.beatBounce * 0.08,
      offsetY: -cuePop * 14,
      accentColor: meta.accent,
      vaultAssetsById,
      vaultImageCache,
    });
    usedNativeModel = mdlRes.trianglesRendered > 0;
  } else if (!usedNativeLayout) {
    ctx.save();
    ctx.translate(cx, cy);
    drawLegacyActor(ctx, game, beat, cueAgeBeats, activeCue, meta.accent);
    ctx.restore();
  }

  ctx.restore();

  // 4) Optional Foreground layer
  const fgImg =
    vaultBinding?.foregroundAssetId && vaultImageCache
      ? vaultImageCache.get(vaultBinding.foregroundAssetId)
      : undefined;
  if (fgImg && fgImg.complete && fgImg.naturalWidth > 0) {
    ctx.save();
    ctx.drawImage(fgImg, 0, cam.beatBounce * -3, w, h);
    ctx.restore();
  }

  // 5) Cue callout banner
  if (activeCue && cueAgeBeats < 2.2) {
    const def = findCueDef(game, activeCue.fn ?? 0, activeCue.args ?? [0, 0, 0, 0], activeCue.word ?? null);
    const label = activeCue.word ?? def?.name ?? `0x${(activeCue.fn ?? 0).toString(16).toUpperCase()}`;
    const alpha = Math.max(0, 1 - cueAgeBeats / 2.2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 17px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label.toUpperCase(), w / 2, h * 0.2 - cueAgeBeats * 7);
    ctx.restore();
  }

  return {
    game,
    usedDedicatedScene: false,
    usedNativeLayout,
    usedNativeModel,
  };
}

export function getRegisteredSceneCount(): number {
  return GAMES.filter((g) => Boolean(SCENE_PROFILES[g])).length;
}
