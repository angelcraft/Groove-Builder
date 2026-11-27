import React, { useRef, useState } from 'react';
import { Upload, Trash2, Package, Music, Image as ImageIcon, Play, Sparkles } from 'lucide-react';
import {
  GAME_META,
  GameId,
  GAMES,
  JINGLE_PRESETS,
  LAYOUT_OFF,
  PROLOGUE_TYPES,
  TPB,
} from '../engine/cues.ts';
import {
  CustomSpriteConfig,
  isValidSemver,
  RuntimeTimelineFormat,
} from '../engine/groovePackage.ts';
import { Timeline } from '../engine/gtfEngine.ts';
import { StagePreview } from './StagePreview.tsx';

interface CustomizationStudioProps {
  packageId: string;
  packageVersion: string;
  runtimeFormat: RuntimeTimelineFormat;
  lastExportSha256: string | null;
  timeline: Timeline;
  currentTick: number;
  bpm: number;
  musicOffsetSec: number;
  musicName: string | null;
  musicVolume: number;
  sfxVolume: number;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  prologueImage?: { name: string; dataUrl: string } | null;
  onForkProjectId: () => void;
  onUpdatePackageVersion: (version: string) => void;
  onUpdateRuntimeFormat: (fmt: RuntimeTimelineFormat) => void;
  onUpdateTimeline: (patch: Partial<Timeline>) => void;
  onUpdateBpm: (bpm: number) => void;
  onUpdateMusicOffset: (sec: number) => void;
  onUpdateMusicVolume: (vol: number) => void;
  onUpdateSfxVolume: (vol: number) => void;
  onUploadMusic: (file: File) => void;
  onClearMusic: () => void;
  onUpdateSprite: (game: GameId, cfg: CustomSpriteConfig | null) => void;
  onSetPrologueImage: (img: { name: string; dataUrl: string } | null) => void;
  onPlayJingle: (code: number) => void;
  onExportGrooveEditor: () => void;
  onExportGrooveRuntime: () => void;
  onImportGrooveClick: () => void;
  onInsertAnimAtPlayhead: (game: GameId, animName: string) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const CustomizationStudio: React.FC<CustomizationStudioProps> = ({
  packageId,
  packageVersion,
  runtimeFormat,
  lastExportSha256,
  timeline,
  currentTick,
  bpm,
  musicOffsetSec,
  musicName,
  musicVolume,
  sfxVolume,
  sprites,
  prologueImage,
  onForkProjectId,
  onUpdatePackageVersion,
  onUpdateRuntimeFormat,
  onUpdateTimeline,
  onUpdateBpm,
  onUpdateMusicOffset,
  onUpdateMusicVolume,
  onUpdateSfxVolume,
  onUploadMusic,
  onClearMusic,
  onUpdateSprite,
  onSetPrologueImage,
  onPlayJingle,
  onExportGrooveEditor,
  onExportGrooveRuntime,
  onImportGrooveClick,
  onInsertAnimAtPlayhead,
}) => {
  const [selectedGame, setSelectedGame] = useState<GameId>(timeline.first ?? 'KAERU');
  const spriteFileRef = useRef<HTMLInputElement>(null);
  const prologueFileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);

  const spriteCfg: CustomSpriteConfig = sprites[selectedGame] ?? {
    game: selectedGame,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    tint: '',
    bounceAmount: 1,
    defaultAnim: 'Remix8',
  };

  const handleSpriteUpload = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    onUpdateSprite(selectedGame, {
      ...spriteCfg,
      imageDataUrl: dataUrl,
      imageName: file.name,
    });
  };

  const handlePrologueUpload = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    onSetPrologueImage({ name: file.name, dataUrl });
  };

  const customizedCount = Object.values(sprites).filter((s) => s?.imageDataUrl || s?.tint).length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0E1117] p-4 md:p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Intro/Prologue + Music + Package */}
        <div className="lg:col-span-7 space-y-6">
          {/* Intro & Prologue Customization */}
          <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Prologue, Intro &amp; Map Identity
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configures Multi slot title, prologue screen, and Switch jingle (0x158–0x16C).
                </p>
              </div>
              {timeline.jingle >= 0x158 && (
                <button
                  type="button"
                  onClick={() => onPlayJingle(timeline.jingle)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-white shrink-0"
                >
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                  Test Jingle
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Stage Title</label>
                <input
                  type="text"
                  maxLength={95}
                  value={timeline.title}
                  onChange={(e) => onUpdateTimeline({ title: e.target.value })}
                  placeholder="Remix 21"
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Prologue Art ID</label>
                <select
                  value={timeline.prologue || 'type_19'}
                  onChange={(e) => onUpdateTimeline({ prologue: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                >
                  {PROLOGUE_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Intro Jingle</label>
                <select
                  value={timeline.jingle}
                  onChange={(e) => onUpdateTimeline({ jingle: Number(e.target.value) })}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                >
                  <option value={-1}>Native Remix 21</option>
                  {JINGLE_PRESETS.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Results Mode</label>
                <select
                  value={timeline.results}
                  onChange={(e) =>
                    onUpdateTimeline({ results: Number(e.target.value) as 0 | 1 })
                  }
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                >
                  <option value={1}>native (saves Remix 21 record)</option>
                  <option value={0}>exit / custom (return to map)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Transition Length (beats)</label>
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  max={16}
                  value={Number((timeline.translen / TPB).toFixed(2))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 16) {
                      onUpdateTimeline({ translen: Math.round(v * TPB) });
                    }
                  }}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Map Match (World / Col / Row)</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((idx) => {
                    const min = idx === 0 ? -1 : 0;
                    const max = idx === 0 ? 2 : idx === 1 ? 11 : 4;
                    return (
                      <input
                        key={idx}
                        type="number"
                        min={min}
                        max={max}
                        value={timeline.match[idx]}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isFinite(v)) return;
                          const next = [...timeline.match] as [number, number, number];
                          next[idx] = Math.max(min, Math.min(max, v));
                          onUpdateTimeline({ match: next });
                        }}
                        className="h-10 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white text-center tabular-nums"
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-300">
                Custom Prologue Artwork:{' '}
                <span className="font-mono text-slate-400">
                  {prologueImage ? prologueImage.name : 'Using built-in prologue style'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={prologueFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handlePrologueUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => prologueFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-white"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                  Upload Intro Art
                </button>
                {prologueImage && (
                  <button
                    type="button"
                    onClick={() => onSetPrologueImage(null)}
                    className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300"
                    title="Remove custom intro art"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Music & Audio Sync */}
          <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Music Track &amp; BPM Calibration
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sync preview audio in browser; bundled automatically into .groove packages.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={musicFileRef}
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
                  onClick={() => musicFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1B2230] hover:bg-[#252E40] border border-white/10 text-xs font-medium text-white"
                >
                  <Music className="w-3.5 h-3.5 text-sky-400" />
                  {musicName ? 'Replace Audio' : 'Import Audio'}
                </button>
                {musicName && (
                  <button
                    type="button"
                    onClick={onClearMusic}
                    className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300"
                    title="Remove audio track"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Preview BPM</label>
                <input
                  type="number"
                  step={0.5}
                  min={40}
                  max={260}
                  value={bpm}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v >= 30) onUpdateBpm(v);
                  }}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Audio Offset (seconds)</label>
                <input
                  type="number"
                  step={0.01}
                  value={musicOffsetSec}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) onUpdateMusicOffset(v);
                  }}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Music Volume ({Math.round(musicVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={musicVolume}
                  onChange={(e) => onUpdateMusicVolume(parseFloat(e.target.value))}
                  className="w-full accent-[#FF5A36]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Cue SFX Volume ({Math.round(sfxVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sfxVolume}
                  onChange={(e) => onUpdateSfxVolume(parseFloat(e.target.value))}
                  className="w-full accent-[#FF5A36]"
                />
              </div>
            </div>
          </section>

          {/* Sprites & Animations Customizer */}
          <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Sprites &amp; Layout Animations
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Override stage sprites, bounce curve, and trigger native layout anims per game.
                </p>
              </div>
              <select
                value={selectedGame}
                onChange={(e) => setSelectedGame(e.target.value as GameId)}
                className="h-10 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs font-medium text-white"
              >
                {GAMES.map((g) => (
                  <option key={g} value={g}>
                    {GAME_META[g].title} ({g})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-white/10 bg-[#0E1117]">
              <input
                ref={spriteFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleSpriteUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => spriteFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-white"
              >
                <Upload className="w-3.5 h-3.5 text-[#FF5A36]" />
                {spriteCfg.imageDataUrl ? 'Replace Sprite PNG/SVG' : 'Upload Custom Sprite'}
              </button>
              <span className="text-xs font-mono text-slate-400 truncate flex-1">
                {spriteCfg.imageName ?? 'Using built-in stage vector actor'}
              </span>
              {spriteCfg.imageDataUrl && (
                <button
                  type="button"
                  onClick={() => onUpdateSprite(selectedGame, null)}
                  className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300"
                  title="Reset custom sprite"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Scale ({spriteCfg.scale.toFixed(2)}x)</label>
                <input
                  type="range"
                  min={0.4}
                  max={2}
                  step={0.05}
                  value={spriteCfg.scale}
                  onChange={(e) =>
                    onUpdateSprite(selectedGame, { ...spriteCfg, scale: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#FF5A36]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Bounce ({spriteCfg.bounceAmount.toFixed(1)}x)</label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={spriteCfg.bounceAmount}
                  onChange={(e) =>
                    onUpdateSprite(selectedGame, { ...spriteCfg, bounceAmount: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[#FF5A36]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Offset X / Y</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    value={spriteCfg.offsetX}
                    onChange={(e) =>
                      onUpdateSprite(selectedGame, { ...spriteCfg, offsetX: Number(e.target.value) || 0 })
                    }
                    className="h-9 px-2 rounded border border-white/10 bg-[#0E1117] font-mono text-xs text-white text-center"
                  />
                  <input
                    type="number"
                    value={spriteCfg.offsetY}
                    onChange={(e) =>
                      onUpdateSprite(selectedGame, { ...spriteCfg, offsetY: Number(e.target.value) || 0 })
                    }
                    className="h-9 px-2 rounded border border-white/10 bg-[#0E1117] font-mono text-xs text-white text-center"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Tint</label>
                <input
                  type="color"
                  value={spriteCfg.tint || GAME_META[selectedGame].accent}
                  onChange={(e) =>
                    onUpdateSprite(selectedGame, { ...spriteCfg, tint: e.target.value })
                  }
                  className="w-full h-9 rounded border border-white/10 bg-[#0E1117] cursor-pointer"
                />
              </div>
            </div>

            {LAYOUT_OFF[selectedGame] !== undefined && (
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-400 font-mono">
                  Layout 0x{LAYOUT_OFF[selectedGame]!.toString(16).toUpperCase()}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={47}
                    value={spriteCfg.defaultAnim}
                    onChange={(e) =>
                      onUpdateSprite(selectedGame, {
                        ...spriteCfg,
                        defaultAnim: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 47),
                      })
                    }
                    className="h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white w-32"
                    placeholder="Remix8"
                  />
                  <button
                    type="button"
                    onClick={() => onInsertAnimAtPlayhead(selectedGame, spriteCfg.defaultAnim || 'Remix8')}
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#1B2230] hover:bg-[#252E40] border border-white/10 text-xs font-medium text-amber-300"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Insert Anim @ {(currentTick / TPB).toFixed(1)}b
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Live Stage + .groove Package Bundle */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <StagePreview
              timeline={timeline}
              currentTick={currentTick}
              sprites={sprites}
              prologueImageDataUrl={prologueImage?.dataUrl}
              onPlayJingle={onPlayJingle}
            />
          </div>

          <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Package className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  .groove Package Profiles (Draft 0.2 — Preview Only)
                </h2>
                <p className="text-xs text-slate-400">
                  Draft format pending GE-154/GE-155 freeze; packages are NOT installable on Switch yet.
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs text-slate-400">Persistent Project ID (UUID)</label>
                  <button
                    type="button"
                    onClick={onForkProjectId}
                    className="text-[11px] font-medium text-sky-400 hover:text-sky-300"
                  >
                    Fork / New ID
                  </button>
                </div>
                <div className="h-9 px-2.5 rounded-lg border border-white/10 bg-[#0B0E14] font-mono text-[11px] text-slate-300 flex items-center truncate">
                  {packageId}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Semver Version</label>
                  <input
                    type="text"
                    value={packageVersion}
                    onChange={(e) => onUpdatePackageVersion(e.target.value)}
                    placeholder="1.0.0"
                    className={`w-full h-9 px-2.5 rounded-lg border bg-[#0E1117] font-mono text-xs text-white ${
                      isValidSemver(packageVersion) ? 'border-white/10' : 'border-rose-500/50'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Runtime Primary Format</label>
                  <select
                    value={runtimeFormat}
                    onChange={(e) => onUpdateRuntimeFormat(e.target.value as RuntimeTimelineFormat)}
                    className="w-full h-9 px-2 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
                  >
                    <option value="gtf">timeline.gtf</option>
                    <option value="gtl">timeline.gtl (GTLM 1)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0E1117] p-3 font-mono text-[11px] text-slate-300 space-y-1">
              <div>format: groove-package/1 · adapter: multi · engine_min: 0.6.0</div>
              <div>authoring (editor): timeline + audio ({musicName ?? 'none'}) + {customizedCount} sprites + intro</div>
              <div>runtime (draft 0.2): exact 2 files (manifest.json + timeline.{runtimeFormat}), results: custom</div>
              {lastExportSha256 && (
                <div className="text-emerald-300 break-all pt-1 border-t border-white/10">
                  sha256: {lastExportSha256} (integrity check only, not author auth)
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onExportGrooveEditor}
                className="inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg bg-[#FF5A36] hover:bg-[#FF6E4E] text-xs font-semibold text-white transition-colors"
              >
                Export Authoring .groove
              </button>
              <button
                type="button"
                onClick={onExportGrooveRuntime}
                className="inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
              >
                Export Runtime .groove
              </button>
            </div>
            <button
              type="button"
              onClick={onImportGrooveClick}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-slate-200 transition-colors"
            >
              Import .groove (Strict Draft 0.2 Validation)
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
