import { findCueDef, GAME_META, type GameId, TPB } from '../engine/cues.ts';
import { type CustomSpriteConfig } from '../engine/groovePackage.ts';
import { activeGameAtTick, type Timeline, type TimelineEvent } from '../engine/gtfEngine.ts';
import {
  type GameAssetBinding,
  type LocalAssetRecord,
} from '../engine/localAssetVault.ts';
import { type PlayalongHitResult } from '../engine/patternStore.ts';
import { renderMinigameScene } from './sceneEngine.ts';

export interface StageRenderOptions {
  timeline: Timeline;
  currentTick: number;
  bpm?: number;
  previewPrologue: boolean;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  spriteImageCache: Map<string, HTMLImageElement>;
  prologueImage?: HTMLImageElement | null;
  lastPlayalongHit?: PlayalongHitResult | null;
  playalongMode?: boolean;
  vaultBindings?: Partial<Record<GameId, GameAssetBinding>>;
  vaultAssetsById?: Map<string, LocalAssetRecord>;
  vaultImageCache?: Map<string, HTMLImageElement>;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function getRecentCuePulse(events: TimelineEvent[], tick: number, game: GameId): { active: TimelineEvent | null; ageBeats: number } {
  let latest: TimelineEvent | null = null;
  for (const ev of events) {
    if (ev.op === 'call' && ev.game === game && ev.tick <= tick && tick - ev.tick <= 8 * TPB) {
      latest = ev;
    }
  }
  return {
    active: latest,
    ageBeats: latest ? (tick - latest.tick) / TPB : 99,
  };
}

function getRecentAnim(events: TimelineEvent[], tick: number, game: GameId): TimelineEvent | null {
  let latest: TimelineEvent | null = null;
  for (const ev of events) {
    if (ev.op === 'anim' && ev.game === game && ev.tick <= tick && tick - ev.tick <= 2 * TPB) {
      latest = ev;
    }
  }
  return latest;
}

function drawGameSceneLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeline: Timeline,
  game: GameId,
  currentTick: number,
  bpm: number,
  cueAgeBeats: number,
  activeCue: TimelineEvent | null,
  activeAnim: TimelineEvent | null,
  customSprite: CustomSpriteConfig | undefined,
  spriteImg: HTMLImageElement | undefined,
  vaultBinding: GameAssetBinding | undefined,
  vaultAssetsById: Map<string, LocalAssetRecord> | undefined,
  vaultImageCache: Map<string, HTMLImageElement> | undefined,
  lastPlayalongHit?: PlayalongHitResult | null,
  playalongMode?: boolean
) {
  renderMinigameScene(ctx, w, h, {
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
    drawLegacyActor: drawGameActorVector,
  });
}

function drawGameActorVector(
  ctx: CanvasRenderingContext2D,
  game: GameId,
  beat: number,
  cueAgeBeats: number,
  activeCue: TimelineEvent | null,
  accent: string
) {
  const hop = cueAgeBeats < 0.8 ? Math.sin((cueAgeBeats / 0.8) * Math.PI) * 32 : 0;

  switch (game) {
    case 'PUMPUP': {
      const isLemon = activeCue?.fn === 0x1551c0;
      const flex = cueAgeBeats < 0.9 ? Math.sin((cueAgeBeats / 0.9) * Math.PI) : 0;
      ctx.fillStyle = isLemon ? '#FACC15' : '#EF4444';
      ctx.beginPath();
      ctx.ellipse(0, 0 - hop * 0.4, 38 + flex * 8, 34 - flex * 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isLemon ? '#FEF08A' : '#FCA5A5';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(-44, -6 - flex * 12, 16, Math.PI * 0.4, Math.PI * 1.6);
      ctx.arc(44, -6 - flex * 12, 16, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#16A34A';
      ctx.fillRect(-3, -44 - hop * 0.4, 6, 12);
      break;
    }
    case 'FLYDISC': {
      const discX = cueAgeBeats < 1.5 ? -90 + cueAgeBeats * 120 : 0;
      const discY = -36 - Math.sin(Math.min(1, cueAgeBeats) * Math.PI) * 30;
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.ellipse(discX, discY, 34, 10, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.ellipse(discX, discY - 2, 18, 4, 0.12, 0, Math.PI * 2);
      ctx.fill();
      // Catching hound silhouette
      ctx.fillStyle = '#E2E8F0';
      drawRoundedRect(ctx, -26, 8 - hop * 0.8, 52, 32, 12);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(24, 2 - hop * 0.8, 16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ROLLING': {
      const spin = beat * Math.PI * 1.5;
      [-70, 0, 70].forEach((ox, idx) => {
        const y = 12 - (idx === 1 ? hop : Math.abs(Math.sin(beat * Math.PI)) * 8);
        ctx.save();
        ctx.translate(ox, y);
        ctx.rotate(spin);
        ctx.fillStyle = idx === 1 ? '#34D399' : '#10B981';
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#064E3B';
        ctx.fillRect(-4, -18, 8, 36);
        ctx.restore();
      });
      break;
    }
    case 'HUNGRY': {
      const isPurple = activeCue?.args?.[0] === 1;
      const mouthOpen = cueAgeBeats < 1.5 ? Math.abs(Math.sin(cueAgeBeats * Math.PI * 2)) * 0.55 : 0.15;
      ctx.fillStyle = isPurple ? '#A855F7' : '#EC4899';
      ctx.beginPath();
      ctx.arc(0, 0, 46, mouthOpen, Math.PI * 2 - mouthOpen);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(-10, -20, 7, 0, Math.PI * 2);
      ctx.fill();
      if (cueAgeBeats < 3) {
        ctx.fillStyle = isPurple ? '#C084FC' : '#FACC15';
        ctx.beginPath();
        ctx.arc(72 - cueAgeBeats * 22, 0, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'CARS': {
      const braking = activeCue?.fn === 0x1608f0 && cueAgeBeats < 1.5;
      const tilt = braking ? -0.09 : cueAgeBeats < 1.2 ? 0.07 : 0;
      ctx.rotate(tilt);
      ctx.fillStyle = '#3B82F6';
      drawRoundedRect(ctx, -68, -22, 136, 44, 12);
      ctx.fill();
      ctx.fillStyle = '#93C5FD';
      drawRoundedRect(ctx, -38, -42, 76, 26, 8);
      ctx.fill();
      ctx.fillStyle = braking ? '#EF4444' : '#FDE047';
      ctx.fillRect(58, -12, 10, 14);
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(-40, 24, 14, 0, Math.PI * 2);
      ctx.arc(40, 24, 14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'KAERU': {
      [-95, 0, 95].forEach((ox, idx) => {
        ctx.fillStyle = '#15803D';
        ctx.beginPath();
        ctx.ellipse(ox, 42, 34, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        const fHop = idx === 1 ? hop : Math.abs(Math.sin(beat * Math.PI)) * 6;
        ctx.fillStyle = idx === 1 ? '#4ADE80' : '#22C55E';
        ctx.beginPath();
        ctx.arc(ox, 18 - fHop, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(ox - 7, 6 - fHop, 5, 0, Math.PI * 2);
        ctx.arc(ox + 7, 6 - fHop, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(ox - 7, 6 - fHop, 2.2, 0, Math.PI * 2);
        ctx.arc(ox + 7, 6 - fHop, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'CRAB': {
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.ellipse(0, 12, 46, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-44, -22 - hop * 0.4, 16, 0.3, Math.PI * 1.7);
      ctx.arc(44, -22 - hop * 0.4, 16, Math.PI * 1.3, Math.PI * 0.7);
      ctx.fill();
      break;
    }
    case 'INSECT': {
      const flap = Math.sin(beat * Math.PI * 4) * 14;
      ctx.fillStyle = '#A3E635';
      ctx.beginPath();
      ctx.ellipse(-26, -8 - hop * 0.5 + flap * 0.3, 28, 16, -0.35, 0, Math.PI * 2);
      ctx.ellipse(26, -8 - hop * 0.5 + flap * 0.3, 28, 16, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#365314';
      drawRoundedRect(ctx, -7, -26 - hop * 0.5, 14, 52, 7);
      ctx.fill();
      break;
    }
    case 'SOFTCATCH': {
      const wobble = cueAgeBeats < 1.2 ? Math.sin(cueAgeBeats * 16) * 0.12 : 0;
      ctx.rotate(wobble);
      ctx.fillStyle = '#FDE047';
      ctx.beginPath();
      ctx.moveTo(-34, 24);
      ctx.lineTo(-24, -22);
      ctx.lineTo(24, -22);
      ctx.lineTo(34, 24);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#92400E';
      drawRoundedRect(ctx, -26, -32, 52, 14, 6);
      ctx.fill();
      break;
    }
    case 'RING': {
      const mask = activeCue?.args?.[0] ?? 15;
      const spin = beat * Math.PI * 2;
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(0, -hop * 0.6, 44 * Math.max(0.3, Math.abs(Math.cos(spin * 0.25))), 44, 0, 0, Math.PI * 2);
      ctx.stroke();
      // 4 hoop-bit indicator dots matching ring_mask
      for (let bit = 0; bit < 4; bit++) {
        const lit = mask >= 0 && (mask & (1 << bit)) !== 0;
        ctx.fillStyle = lit ? '#22D3EE' : 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(-30 + bit * 20, 56, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'THUNDER': {
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(-28, -12, 26, 0, Math.PI * 2);
      ctx.arc(0, -24, 34, 0, Math.PI * 2);
      ctx.arc(30, -10, 24, 0, Math.PI * 2);
      ctx.fill();
      if (cueAgeBeats < 1.0) {
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.moveTo(4, -2);
        ctx.lineTo(-14, 26);
        ctx.lineTo(2, 26);
        ctx.lineTo(-10, 54);
        ctx.lineTo(18, 18);
        ctx.lineTo(2, 18);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'HAMMER': {
      const swing = cueAgeBeats < 0.7 ? -Math.sin((cueAgeBeats / 0.7) * Math.PI) * 1.1 : -0.4;
      ctx.fillStyle = '#EF4444';
      drawRoundedRect(ctx, -20, 4, 40, 38, 6);
      ctx.fill();
      ctx.save();
      ctx.translate(46, 20);
      ctx.rotate(swing);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(-4, -56, 8, 56);
      ctx.fillStyle = '#F59E0B';
      drawRoundedRect(ctx, -24, -76, 48, 24, 6);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'MOON': {
      const puff = cueAgeBeats < 0.9 ? Math.sin((cueAgeBeats / 0.9) * Math.PI) * 10 : 0;
      ctx.fillStyle = '#E0E7FF';
      ctx.beginPath();
      ctx.arc(0, -hop * 0.3, 44 + puff, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6366F1';
      ctx.beginPath();
      ctx.arc(-14, -8 - hop * 0.3, 5, 0, Math.PI * 2);
      ctx.arc(14, -8 - hop * 0.3, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'THE_A': {
      const word = activeCue?.word ?? 'TEA';
      ctx.fillStyle = '#A855F7';
      drawRoundedRect(ctx, -78, -32 - hop * 0.4, 156, 64, 14);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 30px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, 0, -hop * 0.4);
      break;
    }
    case 'PUTILABO': {
      const grow = Math.min(1.6, 0.7 + (cueAgeBeats < 3 ? cueAgeBeats * 0.28 : 0));
      ctx.strokeStyle = '#2DD4BF';
      ctx.fillStyle = 'rgba(45, 212, 191, 0.25)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -10 - hop * 0.4, 34 * grow, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(-10 * grow, -22 * grow, 7 * grow, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'WIPER': {
      const sweep = Math.sin(beat * Math.PI) * 1.1;
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 38, 86, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.save();
      ctx.translate(0, 38);
      ctx.rotate(sweep);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -78);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'SOCCER': {
      ctx.save();
      ctx.translate(0, -hop * 0.9);
      ctx.rotate(beat * Math.PI * 2);
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'HURDLE': {
      ctx.strokeStyle = '#FB7185';
      ctx.lineWidth = 6;
      ctx.strokeRect(-42, 6, 84, 14);
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.arc(0, -24 - hop * 1.1, 18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'TALK': {
      const p1 = cueAgeBeats < 0.7 ? 1.12 : 1;
      ctx.fillStyle = '#38BDF8';
      drawRoundedRect(ctx, -84, -30, 74 * p1, 44 * p1, 12);
      ctx.fill();
      ctx.fillStyle = '#F472B6';
      drawRoundedRect(ctx, 10, -14 - hop * 0.4, 74, 44, 12);
      ctx.fill();
      break;
    }
    case 'COOKING': {
      ctx.fillStyle = '#475569';
      drawRoundedRect(ctx, -58, 12, 116, 18, 8);
      ctx.fill();
      ctx.fillRect(58, 16, 44, 8);
      ctx.fillStyle = '#FB923C';
      ctx.beginPath();
      ctx.arc(-18, -8 - hop * 1.1, 12, 0, Math.PI * 2);
      ctx.arc(16, -14 - hop * 0.9, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'PARASOL': {
      ctx.rotate(Math.sin(beat * Math.PI) * 0.18);
      ctx.fillStyle = '#F43F5E';
      ctx.beginPath();
      ctx.arc(0, -18 - hop, 52, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FDE047';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -18 - hop);
      ctx.lineTo(0, 38 - hop);
      ctx.arc(-8, 38 - hop, 8, 0, Math.PI);
      ctx.stroke();
      break;
    }
    case 'DANCER': {
      ctx.fillStyle = 'rgba(244, 114, 182, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, -110);
      ctx.lineTo(-76, 60);
      ctx.lineTo(76, 60);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F472B6';
      ctx.beginPath();
      ctx.arc(0, -24 - hop * 0.6, 18, 0, Math.PI * 2);
      ctx.fill();
      drawRoundedRect(ctx, -14, -4 - hop * 0.6, 28, 42, 10);
      ctx.fill();
      break;
    }
    case 'SAMURAI': {
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill();
      if (cueAgeBeats < 1.0) {
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(-75, 45);
        ctx.lineTo(75, -55);
        ctx.stroke();
      }
      break;
    }
    case 'BRUSH': {
      ctx.fillStyle = '#F8FAFC';
      drawRoundedRect(ctx, -28, -14, 56, 52, 16);
      ctx.fill();
      const scrub = Math.sin(beat * Math.PI * 4) * 22;
      ctx.fillStyle = '#38BDF8';
      drawRoundedRect(ctx, -40 + scrub, -28, 52, 14, 5);
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(10 + scrub, -24, 54, 6);
      break;
    }
    default: {
      ctx.fillStyle = accent;
      drawRoundedRect(ctx, -44, -44 - hop * 0.5, 88, 88, 22);
      ctx.fill();
      break;
    }
  }
}

export function renderStageFrame(ctx: CanvasRenderingContext2D, w: number, h: number, opts: StageRenderOptions) {
  const {
    timeline,
    currentTick,
    bpm = 120,
    previewPrologue,
    sprites,
    spriteImageCache,
    prologueImage,
    lastPlayalongHit,
    playalongMode,
    vaultBindings,
    vaultAssetsById,
    vaultImageCache,
  } = opts;
  ctx.clearRect(0, 0, w, h);

  const state = activeGameAtTick(timeline, currentTick);

  if (previewPrologue || currentTick < timeline.start) {
    const pGrad = ctx.createLinearGradient(0, 0, w, h);
    pGrad.addColorStop(0, '#1B1436');
    pGrad.addColorStop(0.5, '#2A1940');
    pGrad.addColorStop(1, '#111622');
    ctx.fillStyle = pGrad;
    ctx.fillRect(0, 0, w, h);

    const vaultPrologueId = state.game ? vaultBindings?.[state.game]?.prologueAssetId : undefined;
    const vaultPrologueImg =
      vaultPrologueId && vaultImageCache ? vaultImageCache.get(vaultPrologueId) : undefined;
    const effectivePrologue = prologueImage ?? vaultPrologueImg;

    if (effectivePrologue && effectivePrologue.complete && effectivePrologue.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(effectivePrologue, 0, 0, w, h);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(255,90,54,0.6)';
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, 20, 20, w - 40, h - 40, 14);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    const jHex = timeline.jingle >= 0 ? `0x${timeline.jingle.toString(16).toUpperCase()}` : 'native';
    ctx.fillText(
      `PROLOGUE ${timeline.prologue || 'type_19'}  ·  JINGLE ${jHex}  ·  BGM ${timeline.bgm}`,
      w / 2,
      h * 0.34
    );

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 34px "Outfit", sans-serif';
    ctx.fillText(timeline.title || 'Remix 21', w / 2, h * 0.53);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      `Match Slot: World ${timeline.match[0]} · Col ${timeline.match[1]} · Row ${timeline.match[2]}`,
      w / 2,
      h * 0.67
    );
    return;
  }

  const { active: activeCue, ageBeats } = getRecentCuePulse(timeline.events, currentTick, state.game);
  const animEv = getRecentAnim(timeline.events, currentTick, state.game);

  if (state.transitionProgress < 1 && state.transitionStyle !== -1) {
    const prevCue = getRecentCuePulse(timeline.events, currentTick, state.prevGame);
    const prevAnim = getRecentAnim(timeline.events, currentTick, state.prevGame);
    drawGameSceneLayer(
      ctx,
      w,
      h,
      timeline,
      state.prevGame,
      currentTick,
      bpm,
      prevCue.ageBeats,
      prevCue.active,
      prevAnim,
      sprites[state.prevGame],
      sprites[state.prevGame]?.imageDataUrl ? spriteImageCache.get(state.prevGame) : undefined,
      vaultBindings?.[state.prevGame],
      vaultAssetsById,
      vaultImageCache,
      lastPlayalongHit,
      playalongMode
    );

    ctx.save();
    const wipeX = w * state.transitionProgress;
    ctx.beginPath();
    ctx.rect(0, 0, wipeX, h);
    ctx.clip();
    drawGameSceneLayer(
      ctx,
      w,
      h,
      timeline,
      state.game,
      currentTick,
      bpm,
      ageBeats,
      activeCue,
      animEv,
      sprites[state.game],
      sprites[state.game]?.imageDataUrl ? spriteImageCache.get(state.game) : undefined,
      vaultBindings?.[state.game],
      vaultAssetsById,
      vaultImageCache,
      lastPlayalongHit,
      playalongMode
    );
    ctx.restore();

    ctx.fillStyle = '#FF5A36';
    ctx.fillRect(wipeX - 2, 0, 4, h);
  } else {
    drawGameSceneLayer(
      ctx,
      w,
      h,
      timeline,
      state.game,
      currentTick,
      bpm,
      ageBeats,
      activeCue,
      animEv,
      sprites[state.game],
      sprites[state.game]?.imageDataUrl ? spriteImageCache.get(state.game) : undefined,
      vaultBindings?.[state.game],
      vaultAssetsById,
      vaultImageCache,
      lastPlayalongHit,
      playalongMode
    );
  }

  if (animEv) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`anim ${animEv.animName}`, w - 16, 26);
  }

  if (state.fadeAlpha > 0.01) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, state.fadeAlpha)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Heaven Studio-style Beat & Hit-Target Telegraph Bar along bottom stage rim
  if (playalongMode) {
    const barY = h - 32;
    ctx.fillStyle = 'rgba(11, 15, 22, 0.82)';
    ctx.fillRect(0, barY, w, 32);
    const targetX = w * 0.24;
    ctx.strokeStyle = '#FF5A36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(targetX, barY + 4);
    ctx.lineTo(targetX, h - 4);
    ctx.stroke();

    for (const ev of timeline.events) {
      if (ev.op !== 'call' || !ev.game) continue;
      const def = findCueDef(ev.game, ev.fn ?? 0, ev.args ?? [0, 0, 0, 0], ev.word ?? null);
      const hitTick = ev.tick + Math.round((def?.leadInBeats ?? 0) * TPB);
      const beatsUntil = (hitTick - currentTick) / TPB;
      if (beatsUntil >= -0.6 && beatsUntil <= 4.5) {
        const px = targetX + beatsUntil * 95;
        ctx.fillStyle = GAME_META[ev.game].accent;
        ctx.beginPath();
        ctx.arc(px, barY + 16, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (lastPlayalongHit) {
      const color =
        lastPlayalongHit.judgement === 'ACE'
          ? '#34D399'
          : lastPlayalongHit.judgement === 'JUST'
          ? '#38BDF8'
          : lastPlayalongHit.judgement === 'MISS'
          ? '#F43F5E'
          : '#FBBF24';
      ctx.fillStyle = color;
      ctx.font = '800 14px "Outfit", sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${lastPlayalongHit.judgement} (${lastPlayalongHit.deltaMs > 0 ? '+' : ''}${lastPlayalongHit.deltaMs}ms)`,
        w - 14,
        barY + 16
      );
    }
  }

  // Top-left active game indicator
  ctx.fillStyle = 'rgba(14, 17, 23, 0.72)';
  drawRoundedRect(ctx, 12, 12, 184, 30, 6);
  ctx.fill();
  ctx.fillStyle = GAME_META[state.game].accent;
  ctx.fillRect(18, 19, 6, 16);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(GAME_META[state.game].title, 32, 27);
}
