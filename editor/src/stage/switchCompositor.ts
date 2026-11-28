import { TPB } from '../engine/cues.ts';
import { type TimelineEvent } from '../engine/gtfEngine.ts';
import { type GameAssetBinding, type LocalAssetRecord } from '../engine/localAssetVault.ts';
import {
  type BflanAnimationData,
  type BflytLayoutData,
  type BflytPane,
  type BfresModelData,
  evaluateBflanAtFrame,
} from '../engine/switchFormats.ts';

export interface SwitchCompositorReport {
  panesRendered: number;
  texturesMatched: number;
  activeAnimName: string | null;
  trianglesRendered: number;
}

function stemLower(name: string): string {
  return name.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
}

export function resolveVaultImageForName(
  textureName: string,
  vaultAssetsById: Map<string, LocalAssetRecord> | undefined,
  vaultImageCache: Map<string, HTMLImageElement> | undefined
): HTMLImageElement | undefined {
  if (!vaultAssetsById || !vaultImageCache) return undefined;
  const targetStem = stemLower(textureName);
  const targetBase = textureName.split('/').pop()!.toLowerCase();

  for (const [id, rec] of vaultAssetsById) {
    if (!rec.imageDataUrl) continue;
    const recBase = rec.name.toLowerCase();
    const recStem = stemLower(rec.name);
    if (recBase === targetBase || recStem === targetStem) {
      const img = vaultImageCache.get(id);
      if (img && img.complete && img.naturalWidth > 0) return img;
    }
  }
  return undefined;
}

export function selectActiveBflan(params: {
  binding: GameAssetBinding | undefined;
  vaultAssetsById: Map<string, LocalAssetRecord> | undefined;
  activeAnim: TimelineEvent | null;
  currentTick: number;
  bpm: number;
}): { anim: BflanAnimationData; frame: number } | null {
  const { binding, vaultAssetsById, activeAnim, currentTick, bpm } = params;
  if (!binding?.bflanAssetIds?.length || !vaultAssetsById) return null;

  const candidates: BflanAnimationData[] = [];
  for (const id of binding.bflanAssetIds) {
    const rec = vaultAssetsById.get(id);
    if (rec?.bflanData) candidates.push(rec.bflanData);
  }
  if (candidates.length === 0) return null;

  let chosen: BflanAnimationData | undefined;
  let elapsedBeats = Math.max(0, currentTick / TPB);

  if (activeAnim?.animName) {
    const target = activeAnim.animName.toLowerCase();
    chosen = candidates.find(
      (a) =>
        a.name.toLowerCase() === target ||
        stemLower(a.filename) === target ||
        a.name.toLowerCase().includes(target)
    );
    if (chosen) {
      elapsedBeats = Math.max(0, (currentTick - activeAnim.tick) / TPB);
    }
  }
  if (!chosen) {
    chosen = candidates[0];
  }

  const secPerBeat = 60 / Math.max(20, bpm);
  const rawFrame = elapsedBeats * secPerBeat * 60;
  const frameSize = Math.max(1, chosen.frameSize || chosen.endFrame - chosen.startFrame || 60);
  const frame = chosen.loop
    ? chosen.startFrame + (rawFrame % frameSize)
    : Math.min(chosen.endFrame || frameSize, chosen.startFrame + rawFrame);

  return { anim: chosen, frame };
}

interface PaneWorldState {
  x: number;
  y: number;
  rz: number;
  sx: number;
  sy: number;
  alpha: number;
  visible: boolean;
}

function computePaneWorldStates(
  layout: BflytLayoutData,
  evaluatedAnim: ReturnType<typeof evaluateBflanAtFrame> | null
): Map<string, PaneWorldState> {
  const byName = new Map<string, BflytPane>();
  for (const p of layout.panes) byName.set(p.name, p);

  const worldMap = new Map<string, PaneWorldState>();
  const visiting = new Set<string>();

  const resolvePane = (name: string): PaneWorldState => {
    const cached = worldMap.get(name);
    if (cached) return cached;
    const p = byName.get(name);
    if (!p || visiting.has(name)) {
      return { x: 0, y: 0, rz: 0, sx: 1, sy: 1, alpha: 1, visible: true };
    }
    visiting.add(name);

    const parent = p.parentName
      ? resolvePane(p.parentName)
      : { x: 0, y: 0, rz: 0, sx: 1, sy: 1, alpha: 1, visible: true };

    const animPane = evaluatedAnim?.get(p.name);
    const localTx = p.tx + (animPane?.tx ?? 0);
    const localTy = p.ty + (animPane?.ty ?? 0);
    const localRz = p.rz + (animPane?.rz ?? 0);
    const localSx = p.sx * (animPane?.sx ?? 1);
    const localSy = p.sy * (animPane?.sy ?? 1);
    const localAlpha = (animPane?.alpha ?? p.alpha) / 255;
    const localVis = animPane?.visible !== undefined ? animPane.visible : p.visible;

    const rad = (parent.rz * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = localTx * parent.sx;
    const ry = localTy * parent.sy;

    const state: PaneWorldState = {
      x: parent.x + rx * cos - ry * sin,
      y: parent.y - (rx * sin + ry * cos),
      rz: parent.rz + localRz,
      sx: parent.sx * localSx,
      sy: parent.sy * localSy,
      alpha: p.influenceAlpha ? parent.alpha * localAlpha : localAlpha,
      visible: parent.visible && localVis,
    };
    visiting.delete(name);
    worldMap.set(name, state);
    return state;
  };

  for (const p of layout.panes) resolvePane(p.name);
  return worldMap;
}

export function renderBflytLayoutWithBflan(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    layout: BflytLayoutData;
    binding?: GameAssetBinding;
    vaultAssetsById?: Map<string, LocalAssetRecord>;
    vaultImageCache?: Map<string, HTMLImageElement>;
    activeAnim: TimelineEvent | null;
    currentTick: number;
    bpm: number;
  }
): { panesRendered: number; texturesMatched: number; activeAnimName: string | null } {
  const { layout, binding, vaultAssetsById, vaultImageCache, activeAnim, currentTick, bpm } = opts;
  const active = selectActiveBflan({
    binding,
    vaultAssetsById,
    activeAnim,
    currentTick,
    bpm,
  });
  const evalAnim = active ? evaluateBflanAtFrame(active.anim, active.frame) : null;
  const worldStates = computePaneWorldStates(layout, evalAnim);

  const scaleX = w / Math.max(1, layout.width);
  const scaleY = h / Math.max(1, layout.height);
  const scale = Math.min(scaleX, scaleY);

  let panesRendered = 0;
  let texturesMatched = 0;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);

  for (const pane of layout.panes) {
    const ws = worldStates.get(pane.name);
    if (!ws || !ws.visible || ws.alpha <= 0.01) continue;
    if (pane.kind === 'pan1' && pane.w <= 1 && pane.h <= 1) continue;

    ctx.save();
    ctx.translate(ws.x, ws.y);
    ctx.rotate((-ws.rz * Math.PI) / 180);
    ctx.scale(ws.sx, ws.sy);
    ctx.globalAlpha = Math.max(0, Math.min(1, ws.alpha));

    const anchorX = pane.originX === 0 ? 0 : pane.originX === 2 ? -pane.w : -pane.w / 2;
    const anchorY = pane.originY === 0 ? 0 : pane.originY === 2 ? -pane.h : -pane.h / 2;

    const mat =
      pane.materialIndex !== undefined ? layout.materials[pane.materialIndex] : undefined;
    const texName =
      mat && mat.textureIndex !== null ? layout.textures[mat.textureIndex] : undefined;
    const texImg = texName
      ? resolveVaultImageForName(texName, vaultAssetsById, vaultImageCache)
      : undefined;

    if (texImg) {
      texturesMatched++;
      let sx = 0;
      let sy = 0;
      let sw = texImg.naturalWidth;
      let sh = texImg.naturalHeight;
      if (pane.uvQuad && pane.uvQuad.length === 4) {
        const us = pane.uvQuad.map((q) => Math.max(0, Math.min(1, q[0])));
        const vs = pane.uvQuad.map((q) => Math.max(0, Math.min(1, q[1])));
        const minU = Math.min(...us);
        const maxU = Math.max(...us);
        const minV = Math.min(...vs);
        const maxV = Math.max(...vs);
        if (maxU > minU && maxV > minV) {
          sx = minU * texImg.naturalWidth;
          sy = minV * texImg.naturalHeight;
          sw = (maxU - minU) * texImg.naturalWidth;
          sh = (maxV - minV) * texImg.naturalHeight;
        }
      }
      ctx.drawImage(texImg, sx, sy, Math.max(1, sw), Math.max(1, sh), anchorX, anchorY, pane.w, pane.h);
      panesRendered++;
    } else if (pane.kind === 'pic1' || pane.kind === 'wnd1') {
      const c0 = pane.vertexColors?.[0] ?? mat?.whiteColor ?? [220, 235, 255, 220];
      const c2 = pane.vertexColors?.[2] ?? c0;
      const g = ctx.createLinearGradient(anchorX, anchorY, anchorX, anchorY + pane.h);
      g.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},${c0[3] / 255})`);
      g.addColorStop(1, `rgba(${c2[0]},${c2[1]},${c2[2]},${c2[3] / 255})`);
      ctx.fillStyle = g;
      ctx.fillRect(anchorX, anchorY, pane.w, pane.h);
      panesRendered++;
    }

    ctx.restore();
  }

  ctx.restore();
  return {
    panesRendered,
    texturesMatched,
    activeAnimName: active?.anim.name ?? null,
  };
}

export function renderBfresModel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    model: BfresModelData;
    yawRad: number;
    pitchRad: number;
    scale: number;
    offsetX?: number;
    offsetY?: number;
    accentColor: string;
    vaultAssetsById?: Map<string, LocalAssetRecord>;
    vaultImageCache?: Map<string, HTMLImageElement>;
  }
): { trianglesRendered: number } {
  const { model, yawRad, pitchRad, scale, offsetX = 0, offsetY = 0, accentColor } = opts;
  const cx = w / 2 + offsetX;
  const cy = h * 0.56 + offsetY;
  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const fov = 260;

  interface TriDraw {
    zAvg: number;
    pts: [[number, number], [number, number], [number, number]];
    shade: number;
    fill: string;
  }

  const tris: TriDraw[] = [];

  for (const mdl of model.models) {
    for (const mesh of mdl.meshes) {
      if (mesh.positions.length < 9 || mesh.indices.length < 3) continue;
      for (let i = 0; i + 2 < mesh.indices.length && tris.length < 4096; i += 3) {
        const i0 = mesh.indices[i] * 3;
        const i1 = mesh.indices[i + 1] * 3;
        const i2 = mesh.indices[i + 2] * 3;
        if (
          i0 + 2 >= mesh.positions.length ||
          i1 + 2 >= mesh.positions.length ||
          i2 + 2 >= mesh.positions.length
        ) {
          continue;
        }
        const xform = (idx: number) => {
          const px = mesh.positions[idx] * scale;
          const py = mesh.positions[idx + 1] * scale;
          const pz = mesh.positions[idx + 2] * scale;
          const x1 = px * cosY - pz * sinY;
          const z1 = px * sinY + pz * cosY;
          const y2 = py * cosP - z1 * sinP;
          const z2 = py * sinP + z1 * cosP + 4.2;
          const persp = fov / Math.max(0.6, z2);
          return {
            sx: cx + x1 * persp,
            sy: cy - y2 * persp,
            x: x1,
            y: y2,
            z: z2,
          };
        };
        const a = xform(i0);
        const b = xform(i1);
        const c = xform(i2);
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const uz = b.z - a.z;
        const vx = c.x - a.x;
        const vy = c.y - a.y;
        const vz = c.z - a.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        // Simple key light from upper-front-left
        const shade = Math.max(0.28, Math.min(1, (nx * -0.4 + ny * 0.7 + nz * -0.58) / len * 0.55 + 0.58));

        tris.push({
          zAvg: (a.z + b.z + c.z) / 3,
          pts: [
            [a.sx, a.sy],
            [b.sx, b.sy],
            [c.sx, c.sy],
          ],
          shade,
          fill: accentColor,
        });
      }
    }
  }

  tris.sort((p, q) => q.zAvg - p.zAvg);

  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    ctx.lineTo(t.pts[1][0], t.pts[1][1]);
    ctx.lineTo(t.pts[2][0], t.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = t.fill;
    ctx.globalAlpha = 0.25 + t.shade * 0.75;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return { trianglesRendered: tris.length };
}
