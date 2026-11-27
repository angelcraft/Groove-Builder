import { findCueDef, GAME_META, GameId, TPB } from '../engine/cues.ts';
import { CustomSpriteConfig } from '../engine/groovePackage.ts';
import { activeGameAtTick, Timeline, TimelineEvent } from '../engine/gtfEngine.ts';

export interface StageRenderOptions {
  timeline: Timeline;
  currentTick: number;
  previewPrologue: boolean;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  spriteImageCache: Map<string, HTMLImageElement>;
  prologueImage?: HTMLImageElement | null;
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

function drawGameBackdropAndActors(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  game: GameId,
  beat: number,
  cueAgeBeats: number,
  activeCue: TimelineEvent | null,
  customSprite: CustomSpriteConfig | undefined,
  spriteImg: HTMLImageElement | undefined
) {
  const meta = GAME_META[game];
  const beatPhase = beat % 1;
  const bounce = Math.exp(-beatPhase * 4.5) * (customSprite?.bounceAmount ?? 1);
  const cuePop = cueAgeBeats < 1.2 ? Math.sin(Math.min(1, cueAgeBeats * 2.5) * Math.PI) : 0;

  // Stage background gradient tailored to each of the 24 games
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  switch (game) {
    case 'KAERU':
      grad.addColorStop(0, '#0E3A2F');
      grad.addColorStop(1, '#07221B');
      break;
    case 'CARS':
      grad.addColorStop(0, '#102542');
      grad.addColorStop(1, '#1B1F2B');
      break;
    case 'PUTILABO':
      grad.addColorStop(0, '#0F2E35');
      grad.addColorStop(1, '#0A1920');
      break;
    case 'HUNGRY':
      grad.addColorStop(0, '#3B1033');
      grad.addColorStop(1, '#1E081B');
      break;
    case 'SAMURAI':
      grad.addColorStop(0, '#2B1618');
      grad.addColorStop(1, '#120B0D');
      break;
    case 'MOON':
    case 'TALK':
    case 'BRUSH':
      grad.addColorStop(0, '#121536');
      grad.addColorStop(1, '#090B1C');
      break;
    case 'DANCER':
    case 'PARASOL':
      grad.addColorStop(0, '#36133B');
      grad.addColorStop(1, '#170921');
      break;
    default:
      grad.addColorStop(0, '#172030');
      grad.addColorStop(1, '#0D121C');
      break;
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle stage floor & beat grid lines
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.strokeStyle = `${meta.accent}55`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.lineTo(w, h * 0.72);
  ctx.stroke();

  // Beat pulse circle in background
  ctx.fillStyle = `${meta.accent}${Math.round((0.08 + bounce * 0.14) * 255).toString(16).padStart(2, '0')}`;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.45, 76 + bounce * 18 + cuePop * 24, 0, Math.PI * 2);
  ctx.fill();

  const cx = w / 2;
  const cy = h * 0.56 - bounce * 10 - cuePop * 18;

  // Custom user sprite if uploaded
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
  } else {
    // Domain-authentic bespoke silhouettes for each of the 24 minigames
    ctx.save();
    ctx.translate(cx, cy);
    drawGameActorVector(ctx, game, beat, cueAgeBeats, activeCue, meta.accent);
    ctx.restore();
  }

  // Cue callout label when triggered
  if (activeCue && cueAgeBeats < 2.2) {
    const def = findCueDef(game, activeCue.fn ?? 0, activeCue.args ?? [0, 0, 0, 0], activeCue.word ?? null);
    const label = activeCue.word ?? def?.name ?? `0x${(activeCue.fn ?? 0).toString(16).toUpperCase()}`;
    const alpha = Math.max(0, 1 - cueAgeBeats / 2.2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 18px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label.toUpperCase(), w / 2, h * 0.22 - cueAgeBeats * 8);
    ctx.restore();
  }
}

function drawGameActorVector(
  ctx: CanvasRenderingContext2D,
  game: GameId,
  beat: number,
  cueAgeBeats: number,
  activeCue: TimelineEvent | null,
  accent: string
) {
  const hop = cueAgeBeats < 0.8 ? Math.sin((cueAgeBeats / 0.8) * Math.PI) * 34 : 0;

  switch (game) {
    case 'KAERU': {
      // Three frogs on lilypads
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
    case 'CARS': {
      const braking = activeCue?.fn === 0x1608F0 && cueAgeBeats < 1.5;
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
    case 'RING': {
      const spin = beat * Math.PI * 2;
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(0, -hop * 0.7, 46 * Math.max(0.25, Math.abs(Math.cos(spin * 0.25))), 46, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'HUNGRY': {
      const isPurple = activeCue?.args?.[0] === 1;
      const mouthOpen = cueAgeBeats < 1.5 ? Math.abs(Math.sin(cueAgeBeats * Math.PI * 2)) * 0.55 : 0.15;
      ctx.fillStyle = isPurple ? '#A855F7' : '#EC4899';
      ctx.beginPath();
      ctx.arc(0, 0, 48, mouthOpen, Math.PI * 2 - mouthOpen);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(-10, -20, 7, 0, Math.PI * 2);
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
    case 'THE_A': {
      const word = activeCue?.word ?? 'TEA';
      ctx.fillStyle = '#A855F7';
      drawRoundedRect(ctx, -78, -32 - hop * 0.4, 156, 64, 14);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 32px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word, 0, -hop * 0.4);
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
    default: {
      // Expressive geometric emblem + game title badge
      ctx.fillStyle = accent;
      drawRoundedRect(ctx, -44, -44 - hop * 0.5, 88, 88, 22);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 22px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(game.slice(0, 4), 0, -hop * 0.5);
      break;
    }
  }
}

export function renderStageFrame(ctx: CanvasRenderingContext2D, w: number, h: number, opts: StageRenderOptions) {
  const { timeline, currentTick, previewPrologue, sprites, spriteImageCache, prologueImage } = opts;
  ctx.clearRect(0, 0, w, h);

  // Prologue / Intro Preview mode
  if (previewPrologue || currentTick < timeline.start) {
    const pGrad = ctx.createLinearGradient(0, 0, w, h);
    pGrad.addColorStop(0, '#1B1436');
    pGrad.addColorStop(0.5, '#2A1940');
    pGrad.addColorStop(1, '#111622');
    ctx.fillStyle = pGrad;
    ctx.fillRect(0, 0, w, h);

    if (prologueImage) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(prologueImage, 0, 0, w, h);
      ctx.restore();
    }

    // Subtle geometric framing
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

  const state = activeGameAtTick(timeline, currentTick);
  const beat = currentTick / TPB;
  const { active: activeCue, ageBeats } = getRecentCuePulse(timeline.events, currentTick, state.game);

  // Render previous game if mid-transition
  if (state.transitionProgress < 1 && state.transitionStyle !== -1) {
    const prevCue = getRecentCuePulse(timeline.events, currentTick, state.prevGame);
    drawGameBackdropAndActors(
      ctx,
      w,
      h,
      state.prevGame,
      beat,
      prevCue.ageBeats,
      prevCue.active,
      sprites[state.prevGame],
      sprites[state.prevGame]?.imageDataUrl ? spriteImageCache.get(state.prevGame) : undefined
    );

    // Clip wipe for incoming game
    ctx.save();
    const wipeX = w * state.transitionProgress;
    ctx.beginPath();
    ctx.rect(0, 0, wipeX, h);
    ctx.clip();
    drawGameBackdropAndActors(
      ctx,
      w,
      h,
      state.game,
      beat,
      ageBeats,
      activeCue,
      sprites[state.game],
      sprites[state.game]?.imageDataUrl ? spriteImageCache.get(state.game) : undefined
    );
    ctx.restore();

    // Crisp transition seam line
    ctx.fillStyle = '#FF5A36';
    ctx.fillRect(wipeX - 2, 0, 4, h);
  } else {
    drawGameBackdropAndActors(
      ctx,
      w,
      h,
      state.game,
      beat,
      ageBeats,
      activeCue,
      sprites[state.game],
      sprites[state.game]?.imageDataUrl ? spriteImageCache.get(state.game) : undefined
    );
  }

  // Layout anim flash indicator
  const animEv = getRecentAnim(timeline.events, currentTick, state.game);
  if (animEv) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`anim ${animEv.animName}`, w - 16, 26);
  }

  // Fade overlay (F event)
  if (state.fadeAlpha > 0.01) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, state.fadeAlpha)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Top-left active game badge (clean crisp label)
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
