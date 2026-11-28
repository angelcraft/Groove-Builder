import React, { useMemo, useRef, useState } from 'react';
import {
  FolderInput,
  Upload,
  Trash2,
  Play,
  Sparkles,
  Download,
  HardDrive,
  Plus,
  Music,
  Volume2,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { GAME_META, type GameId, GAMES, JINGLE_PRESETS, LAYOUT_OFF } from '../engine/cues.ts';
import {
  assertImageDimensionBounds,
  buildLocalAssetCueList,
  createDefaultGameBinding,
  estimateStoredRecordBytes,
  exportVaultBindingsManifestOnly,
  FORMAT_RESEARCH_CATALOG,
  type GameAssetBinding,
  type GlobalAudioBindings,
  importSwitchContainerAsset,
  inspectAssetFileHeader,
  type LocalAnimationClipConfig,
  type LocalAssetKind,
  type LocalAssetRecord,
  LocalVaultStorageError,
  MAX_LOCAL_ASSET_BYTES,
  MAX_VAULT_TOTAL_ASSETS,
  MAX_VAULT_TOTAL_BYTES,
  parseAtlasJson,
  resolveAtlasTargetAsset,
  suggestAssetAssociation,
  upsertAssetsById,
  validateVaultImportBudget,
  verifyVaultImageHeader,
} from '../engine/localAssetVault.ts';
import { type Timeline } from '../engine/gtfEngine.ts';
import { type CustomSpriteConfig } from '../engine/groovePackage.ts';
import { DriveAssetBrowser } from './DriveAssetBrowser.tsx';
import { StagePreview } from './StagePreview.tsx';
import { decodeUtf8Strict } from '../engine/zipSecurity.ts';

interface LocalAssetVaultProps {
  timeline: Timeline;
  currentTick: number;
  bpm: number;
  sprites: Partial<Record<GameId, CustomSpriteConfig>>;
  prologueImageDataUrl?: string;
  assets: LocalAssetRecord[];
  bindings: Partial<Record<GameId, GameAssetBinding>>;
  globalAudio: GlobalAudioBindings;
  onAddAssets: (newAssets: LocalAssetRecord[]) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onPurgeVault: () => Promise<void>;
  onUpdateGameBinding: (game: GameId, binding: GameAssetBinding) => void;
  onUpdateGlobalAudio: (next: GlobalAudioBindings) => void;
  onAuditionAudioAsset: (asset: LocalAssetRecord) => void;
  onApplyMusicAssetToProject: (asset: LocalAssetRecord) => Promise<void>;
  onPlayJingle: (code: number) => void;
  onNotify: (msg: string, kind?: 'info' | 'error') => void;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function measureImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };
    img.onload = () => {
      const width = img.naturalWidth || 128;
      const height = img.naturalHeight || 128;
      cleanup();
      resolve({ width, height });
    };
    img.onerror = () => {
      cleanup();
      resolve({ width: 128, height: 128 });
    };
    img.src = dataUrl;
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export const LocalAssetVault: React.FC<LocalAssetVaultProps> = ({
  timeline,
  currentTick,
  bpm,
  sprites,
  prologueImageDataUrl,
  assets,
  bindings,
  globalAudio,
  onAddAssets,
  onDeleteAsset,
  onPurgeVault,
  onUpdateGameBinding,
  onUpdateGlobalAudio,
  onAuditionAudioAsset,
  onApplyMusicAssetToProject,
  onPlayJingle,
  onNotify,
}) => {
  const [selectedGame, setSelectedGame] = useState<GameId>(timeline.first ?? 'KAERU');
  const [kindFilter, setKindFilter] = useState<'all' | LocalAssetKind>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const activeBinding: GameAssetBinding = useMemo(
    () => bindings[selectedGame] ?? createDefaultGameBinding(selectedGame),
    [bindings, selectedGame]
  );

  const imageAssets = useMemo(
    () => assets.filter((a) => (a.kind === 'sprite' || a.kind === 'texture_atlas') && Boolean(a.imageDataUrl)),
    [assets]
  );

  const layoutAssets = useMemo(
    () => assets.filter((a) => a.kind === 'native_layout' && Boolean(a.bflytData)),
    [assets]
  );

  const modelAssets = useMemo(
    () => assets.filter((a) => a.kind === 'native_model' && Boolean(a.bfresData)),
    [assets]
  );

  const bflanAssets = useMemo(
    () => assets.filter((a) => a.kind === 'animation_clip' && Boolean(a.bflanData)),
    [assets]
  );

  const audioAssets = useMemo(
    () => assets.filter((a) => (a.kind === 'music' || a.kind === 'sfx') && Boolean(a.audioBufferData)),
    [assets]
  );

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.relativePath.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [assets, kindFilter, searchQuery]);

  const cueSlots = useMemo(() => buildLocalAssetCueList(selectedGame), [selectedGame]);

  const totalVaultBytes = useMemo(
    () => assets.reduce((sum, a) => sum + estimateStoredRecordBytes(a), 0),
    [assets]
  );

  const handleImportFileList = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setIsImporting(true);
    try {
      const validSizedFiles: File[] = [];
      let skipped = 0;
      for (const file of list) {
        if (file.size === 0 || file.size > MAX_LOCAL_ASSET_BYTES) {
          skipped++;
        } else {
          validSizedFiles.push(file);
        }
      }

      if (validSizedFiles.length === 0) {
        onNotify(`${skipped} file(s) skipped (empty or >48 MiB limit).`, 'error');
        return;
      }

      try {
        // Count ALL incoming files (including JSON atlases) in batch limits;
        // final authoritative total DB budget is enforced atomically inside saveVaultAssetsBatch.
        validateVaultImportBudget({
          existingAssets: assets.map((a) => ({ id: a.id, sizeBytes: estimateStoredRecordBytes(a) })),
          incoming: validSizedFiles.map((f) => ({ name: f.name, sizeBytes: f.size })),
        });
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Vault import budget exceeded.', 'error');
        return;
      }

      const pendingAtlasJsons: Array<{
        name: string;
        relativePath: string;
        frames: ReturnType<typeof parseAtlasJson>['frames'];
        metaImage?: string;
        sizeBytes: number;
      }> = [];
      const created: LocalAssetRecord[] = [];
      let dimensionSkipped = 0;

      for (const file of validSizedFiles) {
        const relPath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const inspected = inspectAssetFileHeader(file.name, bytes, file.type);

        if (
          !inspected.needsConversion &&
          (inspected.nativeContainerFormat === 'BNTX' ||
            inspected.nativeContainerFormat === 'BFLYT' ||
            inspected.nativeContainerFormat === 'BFLAN' ||
            inspected.nativeContainerFormat === 'BFRES')
        ) {
          try {
            const parsedRecords = importSwitchContainerAsset(file.name, relPath, bytes, file.type);
            created.push(...parsedRecords);
          } catch (e) {
            if (e instanceof LocalVaultStorageError) {
              dimensionSkipped++;
              onNotify(e.message, 'error');
            } else {
              const suggestion = suggestAssetAssociation(file.name, relPath, 'native_unparsed');
              created.push({
                id: `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                name: file.name,
                relativePath: relPath,
                kind: 'native_unparsed',
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: file.size,
                addedAtIso: new Date().toISOString(),
                nativeContainerFormat: inspected.nativeContainerFormat,
                needsConversion: true,
                conversionHint: e instanceof Error ? e.message : 'Could not parse Nintendo Switch binary container.',
                suggestedGame: suggestion.game,
                suggestedSlot: suggestion.slot,
                suggestedCueKey: suggestion.cueKey,
              });
            }
          }
          continue;
        }

        if (inspected.kind === 'animation_clip' && file.name.toLowerCase().endsWith('.json')) {
          try {
            const text = decodeUtf8Strict(bytes, file.name);
            const parsed = parseAtlasJson(text);
            pendingAtlasJsons.push({
              name: file.name,
              relativePath: relPath,
              sizeBytes: file.size,
              ...parsed,
            });
          } catch (e) {
            onNotify(
              `${file.name}: ${e instanceof Error ? e.message : 'invalid atlas JSON'}`,
              'error'
            );
          }
          continue;
        }

        let headerDims: { width: number; height: number } | undefined;
        if (inspected.kind === 'sprite' || inspected.kind === 'texture_atlas') {
          try {
            // Must verify raster pixel dimensions strictly from header BEFORE DataURL conversion or DOM decode
            headerDims = verifyVaultImageHeader(bytes, file.name);
          } catch (e) {
            dimensionSkipped++;
            onNotify(
              e instanceof Error
                ? e.message
                : `${file.name}: missing or oversized raster header dimensions.`,
              'error'
            );
            continue;
          }
        }

        const suggestion = suggestAssetAssociation(file.name, relPath, inspected.kind);
        const rec: LocalAssetRecord = {
          id: `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          relativePath: relPath,
          kind: inspected.kind,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          addedAtIso: new Date().toISOString(),
          nativeContainerFormat: inspected.nativeContainerFormat,
          needsConversion: inspected.needsConversion,
          conversionHint: inspected.conversionHint,
          cols: suggestion.cols,
          rows: suggestion.rows,
          suggestedGame: suggestion.game,
          suggestedSlot: suggestion.slot,
          suggestedCueKey: suggestion.cueKey,
          associationAmbiguous: suggestion.ambiguous,
          matchedGames: suggestion.matchedGames,
          ambiguityReason: suggestion.ambiguityReason,
        };

        if (inspected.kind === 'sprite' || inspected.kind === 'texture_atlas') {
          const dataUrl = await readAsDataUrl(file);
          const dims = await measureImageDimensions(dataUrl);
          try {
            assertImageDimensionBounds(dims.width, dims.height, file.name);
          } catch (e) {
            dimensionSkipped++;
            onNotify(e instanceof Error ? e.message : `${file.name} exceeds pixel limits.`, 'error');
            continue;
          }
          rec.imageDataUrl = dataUrl;
          rec.width = dims.width || headerDims?.width;
          rec.height = dims.height || headerDims?.height;
        } else if (inspected.kind === 'music' || inspected.kind === 'sfx') {
          rec.audioBufferData = buf;
        }

        created.push(rec);
      }

      // Attach any imported JSON TexturePacker/Aseprite atlases cleanly without duplicating IDs
      const updatesById = new Map<string, LocalAssetRecord>();
      for (const c of created) updatesById.set(c.id, c);

      let unmatchedAtlasCount = 0;
      for (const atlas of pendingAtlasJsons) {
        const candidatePool = upsertAssetsById(assets, [...updatesById.values()]);
        const resolution = resolveAtlasTargetAsset(
          atlas.relativePath,
          atlas.metaImage,
          candidatePool
        );
        if (resolution.ambiguous) {
          unmatchedAtlasCount++;
          onNotify(
            `${atlas.name}: ambiguous sprite target (${resolution.matches.map((m) => m.relativePath).join(', ')}). Pair sheets in distinct subfolders.`,
            'error'
          );
          continue;
        }
        if (resolution.target) {
          const updated: LocalAssetRecord = {
            ...resolution.target,
            kind: 'texture_atlas',
            atlasFrames: atlas.frames,
          };
          updatesById.set(updated.id, updated);
        } else {
          unmatchedAtlasCount++;
        }
      }

      const finalBatch = [...updatesById.values()];
      if (finalBatch.length > 0) {
        await onAddAssets(finalBatch);
        const unparsedCount = finalBatch.filter((c) => c.needsConversion).length;
        const ambiguousCount = finalBatch.filter((c) => c.associationAmbiguous).length;
        onNotify(
          `Imported/updated ${finalBatch.length} local asset(s) in browser IndexedDB` +
            (unparsedCount > 0 ? ` (${unparsedCount} Switch binary file(s) need local extraction)` : '') +
            (ambiguousCount > 0 ? ` · ${ambiguousCount} need manual game selection` : '') +
            (skipped + dimensionSkipped > 0 ? ` · ${skipped + dimensionSkipped} skipped` : '')
        );
      } else if (pendingAtlasJsons.length > 0 && unmatchedAtlasCount > 0) {
        onNotify('Atlas JSON parsed, but no unique matching image sheet was resolved.', 'error');
      } else if (skipped + dimensionSkipped > 0) {
        onNotify(`${skipped + dimensionSkipped} file(s) skipped (size/dimension limits).`, 'error');
      }
    } catch (err) {
      if (err instanceof LocalVaultStorageError) {
        onNotify(err.message, 'error');
      } else {
        onNotify(err instanceof Error ? err.message : 'Failed importing local assets.', 'error');
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleAutoBindSuggested = () => {
    const nextBindings: Partial<Record<GameId, GameAssetBinding>> = { ...bindings };
    let count = 0;

    for (const asset of assets) {
      if (asset.needsConversion) continue;
      const g = asset.suggestedGame ?? suggestAssetAssociation(asset.name, asset.relativePath, asset.kind).game;
      if (!g) continue;
      const cur = nextBindings[g] ? { ...nextBindings[g]! } : createDefaultGameBinding(g);
      cur.cueSfxMap = { ...cur.cueSfxMap };
      cur.animations = [...cur.animations];
      cur.bflanAssetIds = [...(cur.bflanAssetIds ?? [])];

      if (asset.kind === 'native_layout' && asset.bflytData) {
        if (!cur.layoutAssetId) {
          cur.layoutAssetId = asset.id;
          count++;
        }
      } else if (asset.kind === 'native_model' && asset.bfresData) {
        if (!cur.modelAssetId) {
          cur.modelAssetId = asset.id;
          count++;
        }
      } else if (asset.kind === 'animation_clip' && asset.bflanData) {
        if (!cur.bflanAssetIds.includes(asset.id)) {
          cur.bflanAssetIds.push(asset.id);
          count++;
        }
      } else {
        const slot = asset.suggestedSlot ?? 'actor';
        if (slot === 'backdrop' && !cur.backdropAssetId) {
          cur.backdropAssetId = asset.id;
          count++;
        } else if (slot === 'foreground' && !cur.foregroundAssetId) {
          cur.foregroundAssetId = asset.id;
          count++;
        } else if (slot === 'prologue' && !cur.prologueAssetId) {
          cur.prologueAssetId = asset.id;
          count++;
        } else if (slot === 'music' && !cur.bgmAssetId) {
          cur.bgmAssetId = asset.id;
          count++;
        } else if (slot === 'sfx') {
          const key = asset.suggestedCueKey ?? `${g}:default`;
          if (!cur.cueSfxMap[key]) {
            cur.cueSfxMap[key] = asset.id;
            count++;
          }
        } else if (slot === 'actor' && !cur.actorAssetId) {
          cur.actorAssetId = asset.id;
          count++;
        }
      }
      nextBindings[g] = cur;
    }

    for (const [gKey, b] of Object.entries(nextBindings) as Array<[GameId, GameAssetBinding]>) {
      onUpdateGameBinding(gKey, b);
    }
    onNotify(
      count > 0
        ? `Auto-associated ${count} local asset(s) to matching minigame slots.`
        : 'No unmatched suggestions available; assign manually below.'
    );
  };

  const handleAddAnimationClip = () => {
    const defaultSprite = activeBinding.actorAssetId ?? imageAssets[0]?.id;
    if (!defaultSprite) {
      onNotify('Import or bind at least one sprite / texture sheet first.', 'error');
      return;
    }
    const asset = assets.find((a) => a.id === defaultSprite);
    const cols = asset?.cols ?? 4;
    const rows = asset?.rows ?? 1;
    const frameCount = asset?.atlasFrames?.length ?? cols * rows;
    const clip: LocalAnimationClipConfig = {
      id: `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      label: `${GAME_META[selectedGame].title} Clip`,
      triggerType: 'beat',
      triggerKey: 'beat',
      assetId: defaultSprite,
      cols,
      rows,
      startFrame: 0,
      endFrame: Math.max(0, frameCount - 1),
      fps: 12,
      beatSync: true,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };
    onUpdateGameBinding(selectedGame, {
      ...activeBinding,
      animations: [...activeBinding.animations, clip],
    });
  };

  const handleExportMetadataJson = () => {
    const json = exportVaultBindingsManifestOnly({ assets, bindings, globalAudio });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'groove-builder-local-bindings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify('Exported metadata-only scene/cue association map (no binary assets).');
  };

  const handleQuickAssignAsset = (
    asset: LocalAssetRecord,
    target: 'actor' | 'backdrop' | 'foreground' | 'prologue' | 'layout' | 'model' | 'bflan' | 'sfx_default' | 'bgm'
  ) => {
    const cur = {
      ...activeBinding,
      cueSfxMap: { ...activeBinding.cueSfxMap },
      animations: [...activeBinding.animations],
      bflanAssetIds: [...(activeBinding.bflanAssetIds ?? [])],
    };
    if (target === 'actor') cur.actorAssetId = asset.id;
    else if (target === 'backdrop') cur.backdropAssetId = asset.id;
    else if (target === 'foreground') cur.foregroundAssetId = asset.id;
    else if (target === 'prologue') cur.prologueAssetId = asset.id;
    else if (target === 'layout') cur.layoutAssetId = asset.id;
    else if (target === 'model') cur.modelAssetId = asset.id;
    else if (target === 'bflan') {
      if (!cur.bflanAssetIds.includes(asset.id)) cur.bflanAssetIds.push(asset.id);
    }
    else if (target === 'bgm') cur.bgmAssetId = asset.id;
    else if (target === 'sfx_default') cur.cueSfxMap[`${selectedGame}:default`] = asset.id;
    onUpdateGameBinding(selectedGame, cur);
    onNotify(`Bound "${asset.name}" to ${GAME_META[selectedGame].title} (${target}).`);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0E1117] p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Local-Only Privacy & Import Header */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              void handleImportFileList(e.dataTransfer.files);
            }
          }}
          className={`rounded-xl border p-5 transition-colors ${
            isDragging
              ? 'border-[#FF5A36] bg-[#FF5A36]/10'
              : 'border-white/10 bg-[#141922]'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
                <h1 className="font-display text-base font-bold text-white">
                  Local Resource Vault &amp; 24-Game Scene Associator
                </h1>
              </div>
              <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                Import sprites, texture sheets, JSON atlases, music, and SFX extracted legitimately from
                your own copy of the game. Everything stays strictly inside browser{' '}
                <code className="font-mono text-slate-200">IndexedDB</code> on your device—never pushed to
                GitHub, never bundled in builds, and omitted from runtime{' '}
                <code className="font-mono text-slate-200">.groove</code> packages.
              </p>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums pt-0.5">
                {assets.length}/{MAX_VAULT_TOTAL_ASSETS} local items · {formatBytes(totalVaultBytes)}/{formatBytes(MAX_VAULT_TOTAL_BYTES)} stored locally · 24 Groove Engine scenes ready
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handleImportFileList(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handleImportFileList(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#FF5A36] hover:bg-[#FF6E4E] text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                {isImporting ? 'Importing...' : 'Import Files'}
              </button>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1B2230] hover:bg-[#252E40] border border-white/10 text-xs font-medium text-white whitespace-nowrap shrink-0"
              >
                <FolderInput className="w-3.5 h-3.5 text-sky-400" />
                Import Folder
              </button>
              <button
                type="button"
                onClick={handleAutoBindSuggested}
                disabled={assets.length === 0}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg bg-[#1B2230] hover:bg-[#252E40] disabled:opacity-40 border border-white/10 text-xs font-medium text-emerald-300 whitespace-nowrap shrink-0"
                title="Match filenames & folders against Groove Engine's 24 minigames & cues"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-Associate
              </button>
            </div>
          </div>
        </section>

        {/* Read-only Google Drive importer for RhythmGrooveDecompiled */}
        <DriveAssetBrowser
          disabled={isImporting}
          onImportFiles={handleImportFileList}
          onNotify={onNotify}
        />

        {/* Main 2-Column Workspace */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: 24-Game Scene & Cue Association + Live Stage */}
          <div className="xl:col-span-7 space-y-6">
            <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <h2 className="font-display text-sm font-bold text-white">
                    Minigame Scene &amp; Cue Binding
                  </h2>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {GAME_META[selectedGame].summary} · Layout{' '}
                    <span className="font-mono text-slate-300">
                      {LAYOUT_OFF[selectedGame] !== undefined
                        ? `0x${LAYOUT_OFF[selectedGame]!.toString(16).toUpperCase()}`
                        : 'unverified'}
                    </span>
                  </div>
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

              {/* Stage Image Layers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    { key: 'backdropAssetId', label: 'Stage Backdrop Layer' },
                    { key: 'actorAssetId', label: 'Primary Actor / Sprite Sheet' },
                    { key: 'foregroundAssetId', label: 'Foreground Overlay Layer' },
                    { key: 'prologueAssetId', label: 'Game Intro / Prologue Art' },
                  ] as const
                ).map((slot) => (
                  <div key={slot.key}>
                    <label className="block text-xs text-slate-400 mb-1">{slot.label}</label>
                    <select
                      value={activeBinding[slot.key] ?? ''}
                      onChange={(e) =>
                        onUpdateGameBinding(selectedGame, {
                          ...activeBinding,
                          [slot.key]: e.target.value || undefined,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                    >
                      <option value="">Built-in Groove Vector Layer</option>
                      {imageAssets.map((img) => (
                        <option key={img.id} value={img.id}>
                          {img.name} ({img.width ?? '?'}×{img.height ?? '?'})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Native Switch Layout (BFLYT)</label>
                  <select
                    value={activeBinding.layoutAssetId ?? ''}
                    onChange={(e) =>
                      onUpdateGameBinding(selectedGame, {
                        ...activeBinding,
                        layoutAssetId: e.target.value || undefined,
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                  >
                    <option value="">None (Use Scene Canvas)</option>
                    {layoutAssets.map((lyt) => (
                      <option key={lyt.id} value={lyt.id}>
                        {lyt.name} ({lyt.bflytData?.panes.length ?? 0} panes)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Native 3D Model (BFRES)</label>
                  <select
                    value={activeBinding.modelAssetId ?? ''}
                    onChange={(e) =>
                      onUpdateGameBinding(selectedGame, {
                        ...activeBinding,
                        modelAssetId: e.target.value || undefined,
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                  >
                    <option value="">None (Use Vector/2D Actor)</option>
                    {modelAssets.map((mdl) => (
                      <option key={mdl.id} value={mdl.id}>
                        {mdl.name} ({mdl.bfresData?.models.length ?? 0} models)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {bflanAssets.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="text-[11px] text-slate-400">
                    Bound BFLAN Keyframe Animations ({(activeBinding.bflanAssetIds ?? []).length} active)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {bflanAssets.map((anm) => {
                      const active = (activeBinding.bflanAssetIds ?? []).includes(anm.id);
                      return (
                        <button
                          key={anm.id}
                          type="button"
                          onClick={() => {
                            const curList = activeBinding.bflanAssetIds ?? [];
                            const nextList = active
                              ? curList.filter((id) => id !== anm.id)
                              : [...curList, anm.id];
                            onUpdateGameBinding(selectedGame, {
                              ...activeBinding,
                              bflanAssetIds: nextList,
                            });
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                            active
                              ? 'bg-[#FF5A36]/20 border-[#FF5A36]/60 text-white'
                              : 'bg-[#0E1117] border-white/10 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {anm.bflanData?.name ?? anm.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Per-Game BGM + Music Loader */}
              <div className="pt-3 border-t border-white/10 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs text-slate-400 mb-1">
                    Associated Music Track ({GAME_META[selectedGame].title})
                  </label>
                  <select
                    value={activeBinding.bgmAssetId ?? ''}
                    onChange={(e) =>
                      onUpdateGameBinding(selectedGame, {
                        ...activeBinding,
                        bgmAssetId: e.target.value || undefined,
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white"
                  >
                    <option value="">None linked</option>
                    {audioAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatBytes(a.sizeBytes)})
                      </option>
                    ))}
                  </select>
                </div>
                {activeBinding.bgmAssetId && (
                  <button
                    type="button"
                    onClick={() => {
                      const track = assets.find((a) => a.id === activeBinding.bgmAssetId);
                      if (track) void onApplyMusicAssetToProject(track);
                    }}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white whitespace-nowrap"
                  >
                    <Music className="w-3.5 h-3.5" />
                    Load into Timeline Audio
                  </button>
                )}
              </div>

              {/* Cue SFX Bindings reusing Groove Engine Cue Catalog */}
              <div className="pt-3 border-t border-white/10 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-200">
                    Cue Sound Effects ({cueSlots.length} verified slots)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Reuses Groove Engine cue addresses
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-white/5 border border-white/10 rounded-lg bg-[#0E1117]">
                  {cueSlots.map((slot) => {
                    const boundId = activeBinding.cueSfxMap[slot.key] ?? '';
                    const boundAsset = assets.find((a) => a.id === boundId);
                    return (
                      <div key={slot.key} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className="font-mono text-slate-300 truncate flex-1">{slot.label}</span>
                        <select
                          value={boundId}
                          onChange={(e) => {
                            const nextMap = { ...activeBinding.cueSfxMap };
                            if (e.target.value) nextMap[slot.key] = e.target.value;
                            else delete nextMap[slot.key];
                            onUpdateGameBinding(selectedGame, {
                              ...activeBinding,
                              cueSfxMap: nextMap,
                            });
                          }}
                          className="h-8 px-2 rounded border border-white/10 bg-[#141922] text-xs text-white max-w-[190px]"
                        >
                          <option value="">Synthesized Default</option>
                          {audioAssets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        {boundAsset && (
                          <button
                            type="button"
                            onClick={() => onAuditionAudioAsset(boundAsset)}
                            className="p-1.5 rounded bg-[#1B2230] hover:bg-[#252E40] text-emerald-300"
                            title="Audition SFX"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Frame Animation Clips (Sprite Sheet / JSON Atlas) */}
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      Sprite Sheet &amp; Animation Triggers
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Bind sliced frames to idle, beat, cue call, or native <code className="font-mono">anim</code>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddAnimationClip}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1B2230] hover:bg-[#252E40] border border-white/10 text-xs font-medium text-white"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#FF5A36]" />
                    Add Clip
                  </button>
                </div>

                {activeBinding.animations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-400">
                    No animation clips bound to {GAME_META[selectedGame].title} yet. Static actor sprite or
                    built-in Groove vector actor will render on stage.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeBinding.animations.map((clip, idx) => (
                      <div
                        key={clip.id}
                        className="rounded-lg border border-white/10 bg-[#0E1117] p-3 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={clip.triggerType}
                            onChange={(e) => {
                              const nextAnims = [...activeBinding.animations];
                              const t = e.target.value as LocalAnimationClipConfig['triggerType'];
                              nextAnims[idx] = {
                                ...clip,
                                triggerType: t,
                                triggerKey:
                                  t === 'idle' || t === 'beat'
                                    ? t
                                    : t === 'anim'
                                    ? 'Remix8'
                                    : cueSlots[0]?.key ?? `${selectedGame}:default`,
                              };
                              onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                            }}
                            className="h-8 px-2 rounded border border-white/10 bg-[#141922] text-xs text-white"
                          >
                            <option value="idle">Idle Loop</option>
                            <option value="beat">Every Beat</option>
                            <option value="cue">On Cue Call</option>
                            <option value="anim">On GTF Anim</option>
                          </select>

                          {clip.triggerType === 'cue' && (
                            <select
                              value={clip.triggerKey}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, triggerKey: e.target.value };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="h-8 px-2 rounded border border-white/10 bg-[#141922] font-mono text-xs text-white flex-1 min-w-[140px]"
                            >
                              {cueSlots.map((c) => (
                                <option key={c.key} value={c.key}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          )}

                          {clip.triggerType === 'anim' && (
                            <input
                              type="text"
                              value={clip.triggerKey}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = {
                                  ...clip,
                                  triggerKey: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 47),
                                };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              placeholder="Remix8"
                              className="h-8 px-2 rounded border border-white/10 bg-[#141922] font-mono text-xs text-white w-28"
                            />
                          )}

                          <select
                            value={clip.assetId}
                            onChange={(e) => {
                              const nextAnims = [...activeBinding.animations];
                              nextAnims[idx] = { ...clip, assetId: e.target.value };
                              onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                            }}
                            className="h-8 px-2 rounded border border-white/10 bg-[#141922] text-xs text-white flex-1 min-w-[140px]"
                          >
                            {imageAssets.map((img) => (
                              <option key={img.id} value={img.id}>
                                {img.name}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => {
                              onUpdateGameBinding(selectedGame, {
                                ...activeBinding,
                                animations: activeBinding.animations.filter((a) => a.id !== clip.id),
                              });
                            }}
                            className="p-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300"
                            title="Remove clip"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px] font-mono tabular-nums">
                          <label className="text-slate-400">
                            Cols
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={clip.cols}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, cols: Math.max(1, parseInt(e.target.value, 10) || 1) };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="mt-0.5 w-full h-7 px-1.5 rounded border border-white/10 bg-[#141922] text-white"
                            />
                          </label>
                          <label className="text-slate-400">
                            Rows
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={clip.rows}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, rows: Math.max(1, parseInt(e.target.value, 10) || 1) };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="mt-0.5 w-full h-7 px-1.5 rounded border border-white/10 bg-[#141922] text-white"
                            />
                          </label>
                          <label className="text-slate-400">
                            Start
                            <input
                              type="number"
                              min={0}
                              value={clip.startFrame}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, startFrame: Math.max(0, parseInt(e.target.value, 10) || 0) };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="mt-0.5 w-full h-7 px-1.5 rounded border border-white/10 bg-[#141922] text-white"
                            />
                          </label>
                          <label className="text-slate-400">
                            End
                            <input
                              type="number"
                              min={0}
                              value={clip.endFrame}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, endFrame: Math.max(0, parseInt(e.target.value, 10) || 0) };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="mt-0.5 w-full h-7 px-1.5 rounded border border-white/10 bg-[#141922] text-white"
                            />
                          </label>
                          <label className="text-slate-400">
                            Scale
                            <input
                              type="number"
                              step={0.1}
                              min={0.2}
                              max={3}
                              value={clip.scale}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, scale: parseFloat(e.target.value) || 1 };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="mt-0.5 w-full h-7 px-1.5 rounded border border-white/10 bg-[#141922] text-white"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 pt-4 text-slate-300 font-sans cursor-pointer">
                            <input
                              type="checkbox"
                              checked={clip.beatSync}
                              onChange={(e) => {
                                const nextAnims = [...activeBinding.animations];
                                nextAnims[idx] = { ...clip, beatSync: e.target.checked };
                                onUpdateGameBinding(selectedGame, { ...activeBinding, animations: nextAnims });
                              }}
                              className="accent-[#FF5A36]"
                            />
                            Beat Sync
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Live Stage Preview with Bound Local Assets */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <StagePreview
                timeline={timeline}
                currentTick={currentTick}
                bpm={bpm}
                sprites={sprites}
                prologueImageDataUrl={prologueImageDataUrl}
                vaultBindings={bindings}
                vaultAssets={assets}
                onPlayJingle={onPlayJingle}
              />
            </div>

            {/* Global System SFX (Switch / Metronome / Jingle / Playalong) */}
            <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-3">
              <h2 className="font-display text-sm font-bold text-white">
                Global System SFX &amp; Jingle Bindings
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {(
                  [
                    { key: 'switchSoftAssetId', label: 'Switch Transition (Soft)' },
                    { key: 'switchCutAssetId', label: 'Switch Transition (Cut)' },
                    { key: 'metronomeDownbeatAssetId', label: 'Metronome Downbeat' },
                    { key: 'playalongHitAssetId', label: 'Playalong Tap SFX' },
                  ] as const
                ).map((item) => (
                  <div key={item.key}>
                    <label className="block text-slate-400 mb-1">{item.label}</label>
                    <select
                      value={globalAudio[item.key] ?? ''}
                      onChange={(e) =>
                        onUpdateGlobalAudio({
                          ...globalAudio,
                          [item.key]: e.target.value || undefined,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] text-white"
                    >
                      <option value="">Synthesized Default</option>
                      {audioAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">Active Jingle Override ({JINGLE_PRESETS.find((j) => j.code === timeline.jingle)?.hex ?? 'Native'}):</span>
                <select
                  value={globalAudio.jingleAssetMap[timeline.jingle] ?? ''}
                  disabled={timeline.jingle < 0x158}
                  onChange={(e) => {
                    const nextMap = { ...globalAudio.jingleAssetMap };
                    if (e.target.value) nextMap[timeline.jingle] = e.target.value;
                    else delete nextMap[timeline.jingle];
                    onUpdateGlobalAudio({ ...globalAudio, jingleAssetMap: nextMap });
                  }}
                  className="h-8 px-2 rounded-lg border border-white/10 bg-[#0E1117] text-white flex-1 min-w-[180px]"
                >
                  <option value="">Synthesized Jingle</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </div>

          {/* Right: Local Vault Inventory + Honest Format Research Catalog */}
          <div className="xl:col-span-5 space-y-6">
            <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold text-white">
                  Local Asset Inventory ({filteredAssets.length})
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportMetadataJson}
                    disabled={assets.length === 0}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] disabled:opacity-40 text-[11px] font-medium text-slate-200"
                    title="Export scene/cue mapping JSON only (zero binary assets)"
                  >
                    <Download className="w-3 h-3" />
                    Map JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => void onPurgeVault()}
                    disabled={assets.length === 0}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 text-[11px] font-medium text-rose-200"
                  >
                    <Trash2 className="w-3 h-3" />
                    Purge Local
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'sprite', label: 'Sprites/BNTX' },
                    { id: 'texture_atlas', label: 'Atlases' },
                    { id: 'native_layout', label: 'BFLYT' },
                    { id: 'animation_clip', label: 'BFLAN' },
                    { id: 'native_model', label: 'BFRES' },
                    { id: 'music', label: 'Music' },
                    { id: 'sfx', label: 'SFX' },
                    { id: 'native_unparsed', label: 'Unparsed Bin' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setKindFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                      kindFilter === tab.id
                        ? 'bg-[#FF5A36] text-white'
                        : 'bg-[#0E1117] text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by filename or extracted folder path..."
                className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white placeholder:text-slate-500"
              />

              {filteredAssets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center space-y-2">
                  <Layers className="w-6 h-6 text-slate-500 mx-auto" />
                  <div className="text-xs font-medium text-slate-300">
                    {assets.length === 0
                      ? 'Your local vault is empty'
                      : 'No local assets match this filter'}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Drop extracted PNG/WebP sprite sheets, TexturePacker JSON atlases, or WAV/OGG/MP3 audio
                    files here to bind them to the 24 minigames.
                  </p>
                </div>
              ) : (
                <div className="max-h-[460px] overflow-y-auto divide-y divide-white/10 border border-white/10 rounded-lg bg-[#0E1117]">
                  {filteredAssets.map((asset) => (
                    <div key={asset.id} className="p-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-lg bg-[#141922] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                          {asset.imageDataUrl ? (
                            <img
                              src={asset.imageDataUrl}
                              alt={asset.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-contain"
                            />
                          ) : asset.kind === 'music' ? (
                            <Music className="w-4 h-4 text-sky-400" />
                          ) : asset.kind === 'sfx' ? (
                            <Volume2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-amber-400" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-white truncate">{asset.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                            {asset.kind}
                            {asset.nativeContainerFormat ? ` (${asset.nativeContainerFormat})` : ''} · {formatBytes(asset.sizeBytes)}
                            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                            {asset.atlasFrames?.length ? ` · ${asset.atlasFrames.length} frames` : ''}
                            {asset.bflytData ? ` · ${asset.bflytData.panes.length} panes` : ''}
                            {asset.bflanData ? ` · ${asset.bflanData.entries.length} entries` : ''}
                            {asset.bfresData ? ` · ${asset.bfresData.models.length} models` : ''}
                            {asset.suggestedGame ? ` · match:${asset.suggestedGame}` : ''}
                            {asset.associationAmbiguous && asset.matchedGames?.length
                              ? ` · ambiguous(${asset.matchedGames.join('/')})`
                              : ''}
                          </div>
                          {asset.relativePath !== asset.name && (
                            <div className="text-[10px] text-slate-500 font-mono truncate">
                              {asset.relativePath}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {(asset.kind === 'music' || asset.kind === 'sfx') && asset.audioBufferData && (
                            <button
                              type="button"
                              onClick={() => onAuditionAudioAsset(asset)}
                              className="p-1.5 rounded bg-[#1B2230] hover:bg-[#252E40] text-emerald-300"
                              title="Audition local audio"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void onDeleteAsset(asset.id)}
                            className="p-1.5 rounded bg-[#1B2230] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                            title="Delete from local vault"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {(asset.needsConversion || asset.conversionHint) && (
                        <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded px-2.5 py-1.5 leading-snug">
                          <span className="font-mono font-semibold">{asset.nativeContainerFormat}:</span>{' '}
                          {asset.conversionHint}
                        </div>
                      )}

                      {!asset.needsConversion && (asset.kind === 'sprite' || asset.kind === 'texture_atlas') && (
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { target: 'actor', label: `Bind Actor (${selectedGame})` },
                              { target: 'backdrop', label: 'Backdrop' },
                              { target: 'foreground', label: 'Foreground' },
                              { target: 'prologue', label: 'Intro' },
                            ] as const
                          ).map((btn) => (
                            <button
                              key={btn.target}
                              type="button"
                              onClick={() => handleQuickAssignAsset(asset, btn.target)}
                              className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-slate-200 whitespace-nowrap"
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {!asset.needsConversion && asset.kind === 'native_layout' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickAssignAsset(asset, 'layout')}
                            className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-sky-300 whitespace-nowrap"
                          >
                            Bind Layout ({selectedGame})
                          </button>
                        </div>
                      )}

                      {!asset.needsConversion && asset.kind === 'native_model' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickAssignAsset(asset, 'model')}
                            className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-sky-300 whitespace-nowrap"
                          >
                            Bind 3D Model ({selectedGame})
                          </button>
                        </div>
                      )}

                      {!asset.needsConversion && asset.kind === 'animation_clip' && asset.bflanData && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickAssignAsset(asset, 'bflan')}
                            className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-emerald-300 whitespace-nowrap"
                          >
                            Attach BFLAN Anim ({selectedGame})
                          </button>
                        </div>
                      )}

                      {!asset.needsConversion && (asset.kind === 'music' || asset.kind === 'sfx') && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickAssignAsset(asset, 'sfx_default')}
                            className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-slate-200 whitespace-nowrap"
                          >
                            Bind {selectedGame} Default SFX
                          </button>
                          <button
                            type="button"
                            onClick={() => void onApplyMusicAssetToProject(asset)}
                            className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-sky-300 whitespace-nowrap"
                          >
                            Load as Timeline Music
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Honest Resource Format Research Table */}
            <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-3">
              <div>
                <h2 className="font-display text-sm font-bold text-white">
                  Resource Format Status &amp; Research Roadmap
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Verified Groove Engine contracts vs extracted local formats vs Switch containers that
                  still require reverse engineering.
                </p>
              </div>
              <div className="overflow-x-auto border border-white/10 rounded-lg bg-[#0E1117]">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-b border-white/10 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Format</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {FORMAT_RESEARCH_CATALOG.map((row) => (
                      <tr key={row.extensionOrMagic}>
                        <td className="px-3 py-2 font-mono text-white whitespace-nowrap align-top">
                          {row.extensionOrMagic}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap align-top">
                          <span
                            className={
                              row.status === 'verified_groove_engine'
                                ? 'text-emerald-400 font-medium'
                                : row.status === 'supported_local_extracted'
                                ? 'text-sky-400 font-medium'
                                : 'text-amber-400 font-medium'
                            }
                          >
                            {row.status === 'verified_groove_engine'
                              ? 'Verified'
                              : row.status === 'supported_local_extracted'
                              ? 'Local Ready'
                              : 'Needs Research'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 leading-snug align-top">
                          {row.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
