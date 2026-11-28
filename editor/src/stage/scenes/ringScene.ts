import { findCueDef, GAME_META, TPB } from '../../engine/cues.ts';
import { type CustomSpriteConfig } from '../../engine/groovePackage.ts';
import { type Timeline, type TimelineEvent } from '../../engine/gtfEngine.ts';
import {
  type ActiveSpriteFrameDraw,
  type GameAssetBinding,
  type LocalAssetRecord,
  resolveActiveAnimationFrame,
} from '../../engine/localAssetVault.ts';
import { type PlayalongHitResult } from '../../engine/patternStore.ts';
import { renderBflytLayoutWithBflan, renderBfresModel } from '../switchCompositor.ts';

export interface RingActorPose {
  id: 'pa' | 'pi' | 'pu' | 'pe' | 'po';
  index: number;
  isPlayer: boolean;
  xNorm: number;
  yNorm: number;
  depthScale: number;
  bubbled: boolean;
  jumpProgress: number; // 0 = grounded, >0..1 = in-air arc
  jumpHeightPx: number;
  squashX: number;
  squashY: number;
  color: string;
}

export interface RingHoopInstance {
  eventId: string;
  cueBeat: number;
  ageBeats: number;
  mask: number;
  variant: number;
  laneProgress: number; // 0 at spawn (-0.75b), ~1.0 at pa .. 3.0 at po
  xNorm: number;
  yNorm: number;
  scale: number;
  spinRad: number;
}

export interface RingSceneState {
  beat: number;
  ht3CrimsonTint: boolean;
  cameraZoom: number;
  cameraPanX: number;
  cameraPanY: number;
  hoops: RingHoopInstance[];
  actors: RingActorPose[];
  bubbledNpcCount: number;
  jumpingActorIds: Array<RingActorPose['id']>;
  activeAnimName: string | null;
}

const TRUNDLORB_DEFS: ReadonlyArray<{
  id: RingActorPose['id'];
  isPlayer: boolean;
  jumpBeatOffset: number;
  xNorm: number;
  yNorm: number;
  depthScale: number;
  color: string;
}> = [
  { id: 'pa', isPlayer: false, jumpBeatOffset: 1.0, xNorm: 0.34, yNorm: 0.49, depthScale: 0.50, color: '#FB7185' },
  { id: 'pi', isPlayer: false, jumpBeatOffset: 1.5, xNorm: 0.41, yNorm: 0.55, depthScale: 0.60, color: '#4ADE80' },
  { id: 'pu', isPlayer: false, jumpBeatOffset: 2.0, xNorm: 0.49, yNorm: 0.61, depthScale: 0.72, color: '#FACC15' },
  { id: 'pe', isPlayer: false, jumpBeatOffset: 2.5, xNorm: 0.57, yNorm: 0.68, depthScale: 0.85, color: '#A78BFA' },
  { id: 'po', isPlayer: true, jumpBeatOffset: 3.0, xNorm: 0.66, yNorm: 0.76, depthScale: 1.00, color: '#22D3EE' },
];

function lanePositionAtAge(ageBeats: number): { xNorm: number; yNorm: number; scale: number } {
  // Smooth track passing through pa(1.0), pi(1.5), pu(2.0), pe(2.5), po(3.0)
  // Parametric t where t=0 corresponds to pa (age=1.0), stepping +0.25 per actor up to po (t=1.0 at age=3.0)
  const t = (ageBeats - 1.0) / 2.0; // 0..1 across pa..po
  const xNorm = 0.34 + t * 0.32;
  const yNorm = 0.49 + Math.pow(Math.max(0, t + 0.5), 1.15) * 0.25 - 0.08;
  const scale = Math.max(0.24, Math.min(1.45, 0.5 + t * 0.5));
  return { xNorm, yNorm, scale };
}

export function computeRingSceneState(params: {
  timeline: Timeline;
  currentTick: number;
  activeAnim: TimelineEvent | null;
}): RingSceneState {
  const { timeline, currentTick, activeAnim } = params;
  const beat = currentTick / TPB;
  const ht3CrimsonTint =
    /(ht3|\b3\b|crimson|anillo\s*3)/i.test(timeline.title ?? '') ||
    /(ht3|crimson|red)/i.test(activeAnim?.animName ?? '');

  const hoops: RingHoopInstance[] = [];
  for (const ev of timeline.events) {
    if (ev.op !== 'call' || ev.game !== 'RING') continue;
    const cueBeat = ev.tick / TPB;
    const age = beat - cueBeat;
    if (age >= -0.75 && age <= 4.1) {
      const rawMask = ev.args?.[0] ?? -1;
      const effMask = rawMask < 0 ? 15 : rawMask & 0x0f;
      const variant = ev.args?.[1] ?? 0;
      const pos = lanePositionAtAge(age);
      hoops.push({
        eventId: ev.id,
        cueBeat,
        ageBeats: age,
        mask: effMask,
        variant,
        laneProgress: age,
        xNorm: pos.xNorm,
        yNorm: pos.yNorm,
        scale: pos.scale,
        spinRad: age * Math.PI * 2.5,
      });
    }
  }

  // Primary hoop driving camera tracking & mask overlay
  const leadHoop =
    hoops.find((h) => h.ageBeats >= 0 && h.ageBeats <= 3.6) ??
    hoops[hoops.length - 1] ??
    null;

  // Also preserve last hoop's mask briefly while waiting for next hoop, or default to all visible (15)
  let fallbackMask = 15;
  if (!leadHoop) {
    for (let i = timeline.events.length - 1; i >= 0; i--) {
      const ev = timeline.events[i];
      if (ev.op === 'call' && ev.game === 'RING' && ev.tick <= currentTick) {
        const m = ev.args?.[0] ?? -1;
        fallbackMask = m < 0 ? 15 : m & 0x0f;
        break;
      }
    }
  }

  const activeMask = leadHoop ? leadHoop.mask : fallbackMask;

  const beatBounce = Math.exp(-(Math.max(0, beat % 1)) * 4.5);
  let cameraZoom = 1 + beatBounce * 0.015;
  let cameraPanX = 0;
  let cameraPanY = beatBounce * 2.5;

  if (leadHoop) {
    const tNorm = Math.max(0, Math.min(1, (leadHoop.ageBeats - 0.5) / 2.75));
    cameraPanX = (tNorm - 0.4) * -18;
    // Focus zoom pulse around player 'po' leap at H + 3.0
    const poFocus = Math.max(0, 1 - Math.abs(leadHoop.ageBeats - 3.0) / 0.65);
    cameraZoom += poFocus * 0.075;
    cameraPanY -= poFocus * 6;
  }

  const jumpingActorIds: Array<RingActorPose['id']> = [];
  let bubbledNpcCount = 0;

  const actors: RingActorPose[] = TRUNDLORB_DEFS.map((def, idx) => {
    const isBubbled = !def.isPlayer && (activeMask & (1 << idx)) === 0;
    if (isBubbled) bubbledNpcCount++;

    let maxJump = 0;
    let landingSquash = 0;

    if (!isBubbled) {
      for (const h of hoops) {
        const dt = h.ageBeats - def.jumpBeatOffset;
        // Parabolic jump centered at def.jumpBeatOffset (+/- 0.28 beats)
        if (Math.abs(dt) <= 0.28) {
          const u = (dt + 0.28) / 0.56;
          maxJump = Math.max(maxJump, Math.sin(u * Math.PI));
        } else if (dt > 0.28 && dt <= 0.50) {
          const lu = (dt - 0.28) / 0.22;
          landingSquash = Math.max(landingSquash, Math.sin(lu * Math.PI) * 0.16);
        }
      }
    }

    if (maxJump > 0.08) jumpingActorIds.push(def.id);

    const jogBob = isBubbled
      ? Math.sin(beat * Math.PI * 1.5 + idx * 0.9) * 5
      : Math.abs(Math.sin((beat + idx * 0.12) * Math.PI)) * 6;

    const jumpHeightPx =
      maxJump * (def.isPlayer ? 54 : 42) * def.depthScale + jogBob;

    return {
      id: def.id,
      index: idx,
      isPlayer: def.isPlayer,
      xNorm: def.xNorm,
      yNorm: def.yNorm,
      depthScale: def.depthScale,
      bubbled: isBubbled,
      jumpProgress: maxJump,
      jumpHeightPx,
      squashX: 1 + landingSquash - maxJump * 0.12,
      squashY: 1 - landingSquash + maxJump * 0.16,
      color: def.color,
    };
  });

  return {
    beat,
    ht3CrimsonTint,
    cameraZoom,
    cameraPanX,
    cameraPanY,
    hoops,
    actors,
    bubbledNpcCount,
    jumpingActorIds,
    activeAnimName: activeAnim?.animName ?? null,
  };
}

function drawTrundlorbCharacter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  actor: RingActorPose,
  beat: number,
  spriteImg: HTMLImageElement | undefined,
  vaultFrame: ActiveSpriteFrameDraw | null,
  vaultActorImg: HTMLImageElement | undefined
) {
  const s = actor.depthScale;
  const groundY = y;
  const charY = groundY - actor.jumpHeightPx - (actor.bubbled ? 14 * s : 0);

  // Soft ground shadow (shrinks while high in air)
  ctx.save();
  ctx.fillStyle = 'rgba(5, 18, 36, 0.35)';
  const shadowScale = Math.max(0.45, 1 - actor.jumpProgress * 0.45);
  ctx.beginPath();
  ctx.ellipse(x, groundY + 14 * s, 21 * s * shadowScale, 6.5 * s * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, charY);
  ctx.scale(actor.squashX * s, actor.squashY * s);

  if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
    const dw = 54;
    const dh = (spriteImg.height / Math.max(1, spriteImg.width)) * dw;
    ctx.drawImage(spriteImg, -dw / 2, -dh / 2, dw, dh);
  } else if (vaultFrame && vaultActorImg && vaultActorImg.complete && vaultActorImg.naturalWidth > 0) {
    const dw = 56 * (vaultFrame.scale || 1);
    const dh = (vaultFrame.sh / Math.max(1, vaultFrame.sw)) * dw;
    ctx.drawImage(
      vaultActorImg,
      vaultFrame.sx,
      vaultFrame.sy,
      vaultFrame.sw,
      vaultFrame.sh,
      -dw / 2,
      -dh / 2,
      dw,
      dh
    );
  } else {
    // Stride legs (running animation synced to beat)
    const stride = actor.bubbled ? 0 : Math.sin(beat * Math.PI * 2 + actor.index) * 8;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, 12);
    ctx.lineTo(-9 + stride * 0.4, 24);
    ctx.moveTo(7, 12);
    ctx.lineTo(9 - stride * 0.4, 24);
    ctx.stroke();

    // Trundlorb rounded body with Rim Shading
    ctx.fillStyle = actor.color;
    ctx.beginPath();
    ctx.ellipse(0, -2, 20, 21, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner belly / highlight crescent
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(-4, -8, 11, 10, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Player 'po' distinctive headband/visor crest
    if (actor.isPlayer) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-17, -14, 34, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#FF5A36';
      ctx.beginPath();
      ctx.arc(0, -11, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Expressive eyes
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(-6, -3, 3.1, 0, Math.PI * 2);
    ctx.arc(6, -3, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-7, -4.1, 1.1, 0, Math.PI * 2);
    ctx.arc(5, -4.1, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Rim outline
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -2, 20, 21, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Iridescent Soap Bubble for silenced/masked NPCs (`mask & (1 << idx) === 0`)
  if (actor.bubbled) {
    const bubbleGrad = ctx.createRadialGradient(-9, -12, 4, 0, -2, 30);
    bubbleGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
    bubbleGrad.addColorStop(0.65, 'rgba(125,211,252,0.22)');
    bubbleGrad.addColorStop(1, 'rgba(244,114,182,0.42)');
    ctx.fillStyle = bubbleGrad;
    ctx.beginPath();
    ctx.arc(0, -2, 29, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(224,242,254,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -2, 29, 0, Math.PI * 2);
    ctx.stroke();

    // Gloss crescent
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, -2, 23, Math.PI * 1.1, Math.PI * 1.48);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRollingHoop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hoop: RingHoopInstance,
  ht3: boolean
) {
  const x = hoop.xNorm * w;
  const y = hoop.yNorm * h;
  const r = 42 * hoop.scale;
  const rx = r * 0.44;
  const primary = hoop.variant === 1 ? '#FB7185' : ht3 ? '#FDE047' : '#38BDF8';
  const secondary = '#F8FAFC';

  // Ground shadow
  ctx.save();
  ctx.fillStyle = 'rgba(5, 18, 36, 0.34)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.92, r * 0.58, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(x, y);
  ctx.rotate(-0.14);

  // Outer ring body
  ctx.strokeStyle = primary;
  ctx.lineWidth = Math.max(4, 10 * hoop.scale);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Animated stripe band rotating around hoop circumference
  ctx.strokeStyle = secondary;
  ctx.lineWidth = Math.max(3, 8 * hoop.scale);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, hoop.spinRad, hoop.spinRad + Math.PI * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, r, 0, hoop.spinRad + Math.PI, hoop.spinRad + Math.PI * 1.65);
  ctx.stroke();

  // Crisp inner highlight rim
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.88, r * 0.88, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

export function renderRingScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    timeline: Timeline;
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
  }
): RingSceneState {
  const {
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
  } = opts;

  const state = computeRingSceneState({ timeline, currentTick, activeAnim });
  const horizonY = h * 0.36;

  ctx.save();
  // Apply Ring dynamic camera around stage center
  ctx.translate(w / 2 + state.cameraPanX, h / 2 + state.cameraPanY);
  ctx.scale(state.cameraZoom, state.cameraZoom);
  ctx.translate(-w / 2, -h / 2);

  // 1) Backdrop priority: Vault BFLYT layout / custom Backdrop image -> Native Hoop Trundling Geometric Horizon
  const backdropImg =
    vaultBinding?.backdropAssetId && vaultImageCache
      ? vaultImageCache.get(vaultBinding.backdropAssetId)
      : undefined;

  if (backdropImg && backdropImg.complete && backdropImg.naturalWidth > 0) {
    ctx.drawImage(backdropImg, -12, -12, w + 24, h + 24);
  } else {
    // Sky dome gradient (Blue dimension grid by default; HT3 crimson tint (1.0, 0.16, 0.16) when HT3)
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    if (state.ht3CrimsonTint) {
      sky.addColorStop(0, '#44070D');
      sky.addColorStop(0.6, '#A31B24');
      sky.addColorStop(1, '#F25252');
    } else {
      sky.addColorStop(0, '#093463');
      sky.addColorStop(0.55, '#136BB0');
      sky.addColorStop(1, '#7CD6F7');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(-30, -30, w + 60, horizonY + 32);

    // Distant perspective ground plane + scrolling depth grid
    const ground = ctx.createLinearGradient(0, horizonY, 0, h);
    if (state.ht3CrimsonTint) {
      ground.addColorStop(0, '#C9323A');
      ground.addColorStop(1, '#3B0810');
    } else {
      ground.addColorStop(0, '#1C85CA');
      ground.addColorStop(1, '#09315C');
    }
    ctx.fillStyle = ground;
    ctx.fillRect(-30, horizonY, w + 60, h - horizonY + 30);

    // Horizon sun/dimension bloom
    const bloom = ctx.createRadialGradient(w * 0.36, horizonY, 6, w * 0.36, horizonY, w * 0.45);
    bloom.addColorStop(0, state.ht3CrimsonTint ? 'rgba(255,190,190,0.42)' : 'rgba(224,247,255,0.45)');
    bloom.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, w, h);

    // Receding perspective rays
    const vanishX = w * 0.31;
    ctx.strokeStyle = state.ht3CrimsonTint ? 'rgba(255,200,200,0.22)' : 'rgba(186,230,253,0.26)';
    ctx.lineWidth = 1.4;
    for (let i = -8; i <= 14; i++) {
      const bx = vanishX + i * 74;
      ctx.beginPath();
      ctx.moveTo(vanishX, horizonY);
      ctx.lineTo(bx, h + 20);
      ctx.stroke();
    }

    // Horizontal scrolling grid lines (beat-synced speed)
    const scrollPhase = (state.beat * 0.65) % 1;
    for (let row = 0; row < 9; row++) {
      const d = (row + scrollPhase) / 9;
      const gy = horizonY + Math.pow(d, 1.85) * (h - horizonY + 12);
      ctx.beginPath();
      ctx.moveTo(-20, gy);
      ctx.lineTo(w + 20, gy);
      ctx.stroke();
    }

    // Glowing track lane curve under the 5 Trundlorbs
    ctx.strokeStyle = state.ht3CrimsonTint ? 'rgba(254,226,226,0.34)' : 'rgba(224,242,254,0.4)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.28, horizonY + 18);
    ctx.lineTo(w * 0.78, h + 12);
    ctx.stroke();
  }

  // Optional native Switch BFLYT layout + BFLAN keyframe evaluation
  const boundLayout = vaultBinding?.layoutAssetId
    ? vaultAssetsById?.get(vaultBinding.layoutAssetId)?.bflytData
    : undefined;
  if (boundLayout) {
    renderBflytLayoutWithBflan(ctx, w, h, {
      layout: boundLayout,
      binding: vaultBinding,
      vaultAssetsById,
      vaultImageCache,
      activeAnim,
      currentTick,
      bpm,
    });
  }

  // Optional native 3D BFRES model preview projected onto stage track
  const boundModel = vaultBinding?.modelAssetId
    ? vaultAssetsById?.get(vaultBinding.modelAssetId)?.bfresData
    : undefined;
  if (boundModel) {
    renderBfresModel(ctx, w, h, {
      model: boundModel,
      yawRad: state.beat * 0.5,
      pitchRad: 0.22,
      scale: 0.9,
      offsetX: -w * 0.16,
      offsetY: -h * 0.04,
      accentColor: GAME_META.RING.accent,
      vaultAssetsById,
      vaultImageCache,
    });
  }

  // 2) Draw back-to-front depth-sorted Trundlorbs & Rolling Hoops
  const vaultFrame =
    !spriteImg && vaultBinding && vaultAssetsById
      ? resolveActiveAnimationFrame({
          game: 'RING',
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

  type DrawLayerItem = { depth: number; draw: () => void };
  const depthQueue: DrawLayerItem[] = [];

  for (const actor of state.actors) {
    depthQueue.push({
      depth: actor.yNorm,
      draw: () =>
        drawTrundlorbCharacter(
          ctx,
          actor.xNorm * w,
          actor.yNorm * h,
          actor,
          state.beat,
          customSprite ? spriteImg : undefined,
          vaultFrame,
          vaultActorImg
        ),
    });
  }

  for (const hoop of state.hoops) {
    depthQueue.push({
      depth: hoop.yNorm + 0.01,
      draw: () => drawRollingHoop(ctx, w, h, hoop, state.ht3CrimsonTint),
    });
  }

  depthQueue.sort((a, b) => a.depth - b.depth);
  for (const item of depthQueue) item.draw();

  // Playalong landing highlight burst around player 'po'
  if (playalongMode && lastPlayalongHit && lastPlayalongHit.game === 'RING') {
    const po = state.actors[4];
    const burstColor =
      lastPlayalongHit.judgement === 'ACE'
        ? '#34D399'
        : lastPlayalongHit.judgement === 'JUST'
        ? '#38BDF8'
        : '#F43F5E';
    ctx.strokeStyle = burstColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(po.xNorm * w, po.yNorm * h - po.jumpHeightPx, 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // Foreground overlay if user bound one
  const fgImg =
    vaultBinding?.foregroundAssetId && vaultImageCache
      ? vaultImageCache.get(vaultBinding.foregroundAssetId)
      : undefined;
  if (fgImg && fgImg.complete && fgImg.naturalWidth > 0) {
    ctx.drawImage(fgImg, 0, 0, w, h);
  }

  // Cue / pa-pi-pu-pe-po beat callout ribbon
  if (activeCue && cueAgeBeats < 3.6) {
    const def = findCueDef('RING', activeCue.fn ?? 0, activeCue.args ?? [-1, 0, 0, 0], null);
    const syllables = ['HOOP', 'pa!', 'pi!', 'pu!', 'pe!', 'PO!'];
    let stepIdx = 0;
    if (cueAgeBeats >= 2.8) stepIdx = 5;
    else if (cueAgeBeats >= 2.3) stepIdx = 4;
    else if (cueAgeBeats >= 1.8) stepIdx = 3;
    else if (cueAgeBeats >= 1.3) stepIdx = 2;
    else if (cueAgeBeats >= 0.8) stepIdx = 1;

    ctx.save();
    ctx.font = '800 18px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = stepIdx === 5 ? '#FDE047' : '#FFFFFF';
    ctx.fillText(
      stepIdx === 0 ? (def?.name ?? 'hoop').toUpperCase() : syllables[stepIdx],
      w * 0.5,
      h * 0.16
    );
    ctx.restore();
  }

  return state;
}
