import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sliders, Layers, MonitorPlay, Package, FileCode2, FolderOpen, X, AlertTriangle, BookmarkPlus, HardDrive } from 'lucide-react';
import { RhythmAudioEngine } from './audio/rhythmAudio.ts';
import { BottomPickerDock } from './components/BottomPickerDock.tsx';
import { CodeStudio } from './components/CodeStudio.tsx';
import { CustomizationStudio } from './components/CustomizationStudio.tsx';
import { InspectorPanel } from './components/InspectorPanel.tsx';
import { LocalAssetVault } from './components/LocalAssetVault.tsx';
import { StagePreview } from './components/StagePreview.tsx';
import { TimelineEditor } from './components/TimelineEditor.tsx';
import { TopBar, type WorkspaceTab } from './components/TopBar.tsx';
import { TransportBar } from './components/TransportBar.tsx';
import { type CueDef, EXAMPLE_GTF, GAME_META, type GameId, getCuesForGame, LAYOUT_OFF, SHOWCASE_24_GTF, TPB } from './engine/cues.ts';
import {
  isValidAnimNameContract,
  isValidLayoutContract,
  snapCueArgsToContract,
} from './engine/engineContract.ts';
import {
  analyzeRuntimeExportImpact,
  checkPackageRegistryConflict,
  type CustomSpriteConfig,
  exportGroovePackage,
  generateProjectId,
  importGroovePackage,
  type PackageRegistryEntry,
  type RuntimeConversionImpact,
  type RuntimeTimelineFormat,
} from './engine/groovePackage.ts';
import {
  cloneTimeline,
  compileGtf,
  decompileToGtf,
  emitGtl,
  nextEventId,
  parseGtl,
  type Timeline,
  type TimelineEvent,
  validateTimeline,
} from './engine/gtfEngine.ts';
import { importRhreFile } from './engine/rhreImporter.ts';
import {
  buildPatternFromSelection,
  BUILTIN_PATTERNS,
  type EditorTool,
  instantiatePattern,
  loadFavoriteGames,
  loadRecentGames,
  loadUserPatterns,
  saveFavoriteGames,
  saveRecentGames,
  saveUserPatterns,
  type StoredPattern,
} from './engine/patternStore.ts';
import {
  deleteVaultAsset,
  type GameAssetBinding,
  getReferencedAudioAssetIds,
  type GlobalAudioBindings,
  loadLocalVault,
  type LocalAssetRecord,
  purgeLocalVault,
  saveVaultAssetsBatch,
  saveVaultBindings,
  upsertAssetsById,
} from './engine/localAssetVault.ts';
import { decodeUtf8Strict } from './engine/zipSecurity.ts';
import { useOnlineStatus } from './hooks/usePWAInstall.ts';

function triggerDownload(filename: string, content: Blob | string, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type MobileSubPane = 'timeline' | 'cues' | 'inspector';

export function App() {
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('timeline');
  const [mobilePane, setMobilePane] = useState<MobileSubPane>('timeline');

  // Timeline + Undo/Redo History
  const [timeline, setTimeline] = useState<Timeline>(() => compileGtf(EXAMPLE_GTF, 'ejemplo.gtf'));
  const [past, setPast] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);

  // Selection, RHREfresh Tools & Pattern Library state
  const [selectedGame, setSelectedGame] = useState<GameId>('KAERU');
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [draggedCue, setDraggedCue] = useState<CueDef | null>(null);
  const [favoriteGames, setFavoriteGames] = useState<GameId[]>(() => loadFavoriteGames());
  const [recentGames, setRecentGames] = useState<GameId[]>(() => loadRecentGames());
  const [userPatterns, setUserPatterns] = useState<StoredPattern[]>(() => loadUserPatterns());
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [savePatternModalOpen, setSavePatternModalOpen] = useState(false);
  const [patternDraftName, setPatternDraftName] = useState('');

  // Playback & Audio state
  const audioRef = useRef<RhythmAudioEngine | null>(null);
  if (!audioRef.current) {
    audioRef.current = new RhythmAudioEngine();
  }
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [bpm, setBpm] = useState(125);
  const [musicOffsetSec, setMusicOffsetSec] = useState(0);
  const [musicFile, setMusicFile] = useState<{ name: string; buffer: ArrayBuffer; mime: string } | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array>(new Float32Array(0));
  const [musicDurationSec, setMusicDurationSec] = useState(0);
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [sfxVolume, setSfxVolume] = useState(0.85);
  const [metronomeOn, setMetronomeOn] = useState(true);
  const [cueSfxOn, setCueSfxOn] = useState(true);

  // Timeline Grid
  const [snapDenominator, setSnapDenominator] = useState(4); // 1/4 beat = 120t
  const [zoomPxPerBeat, setZoomPxPerBeat] = useState(56);

  // Persistent Project Identity & Package State (GE-154 Draft 0.2)
  const [packageId, setPackageId] = useState<string>(() => generateProjectId());
  const [packageVersion, setPackageVersion] = useState<string>('1.0.0');
  const [runtimeFormat, setRuntimeFormat] = useState<RuntimeTimelineFormat>('gtf');
  const [lastExportSha256, setLastExportSha256] = useState<string | null>(null);
  const packageRegistryRef = useRef<Map<string, PackageRegistryEntry>>(new Map());
  const [runtimeConfirmModal, setRuntimeConfirmModal] = useState<{
    impact: RuntimeConversionImpact;
  } | null>(null);
  const [hasSourceZip, setHasSourceZip] = useState(false);

  // Customizations for .groove
  const [sprites, setSprites] = useState<Partial<Record<GameId, CustomSpriteConfig>>>({});
  const [prologueImage, setPrologueImage] = useState<{ name: string; dataUrl: string } | null>(null);

  // Local Asset Vault (strictly device-local IndexedDB; never bundled or uploaded)
  const [vaultAssets, setVaultAssets] = useState<LocalAssetRecord[]>([]);
  const [vaultBindings, setVaultBindings] = useState<Partial<Record<GameId, GameAssetBinding>>>({});
  const [vaultGlobalAudio, setVaultGlobalAudio] = useState<GlobalAudioBindings>({ jingleAssetMap: {} });
  const decodedVaultAudioIdsRef = useRef<Set<string>>(new Set());

  // Notifications
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToast({ text, kind });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/groove-builder-source.zip', { method: 'HEAD' })
      .then((res) => {
        if (!cancelled) {
          const ct = res.headers.get('content-type') || '';
          setHasSourceZip(res.ok && !ct.includes('text/html'));
        }
      })
      .catch(() => {
        if (!cancelled) setHasSourceZip(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load device-local asset vault from IndexedDB on mount (strictly no eager audio decode)
  useEffect(() => {
    let cancelled = false;
    loadLocalVault()
      .then((vault) => {
        if (cancelled) return;
        setVaultAssets(vault.assets);
        setVaultBindings(vault.bindings);
        setVaultGlobalAudio(vault.globalAudio);
        audioRef.current?.setLocalBindings(vault.bindings, vault.globalAudio);
      })
      .catch((err) => {
        if (cancelled) return;
        showToast(
          `Local Vault unavailable or failed to load: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    audioRef.current?.setLocalBindings(vaultBindings, vaultGlobalAudio);
  }, [vaultBindings, vaultGlobalAudio]);

  // Decode lazily on playback ONLY audio assets actively referenced in cue/global SFX bindings
  const ensureVaultAudioDecoded = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const referencedIds = getReferencedAudioAssetIds(vaultBindings, vaultGlobalAudio);
    if (referencedIds.size === 0) return;

    for (const a of vaultAssets) {
      if (!referencedIds.has(a.id)) continue;
      if (
        a.audioBufferData &&
        (a.kind === 'music' || a.kind === 'sfx') &&
        !audio.hasLocalAudioBuffer(a.id)
      ) {
        try {
          await audio.decodeAndRegisterLocalAudio(a.id, a.audioBufferData);
          decodedVaultAudioIdsRef.current.add(a.id);
        } catch {
          // Skip unplayable or over-budget file safely
        }
      }
    }
  }, [vaultAssets, vaultBindings, vaultGlobalAudio]);

  const commitTimeline = useCallback(
    (updater: (prev: Timeline) => Timeline, recordHistory = true) => {
      setTimeline((prev) => {
        const next = updater(cloneTimeline(prev));
        next.events.sort((a, b) => a.tick - b.tick);
        if (recordHistory) {
          setPast((p) => [...p.slice(-49), prev]);
          setFuture([]);
        }
        return next;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setFuture((f) => [timeline, ...f]);
      setTimeline(previous);
      return p.slice(0, -1);
    });
  }, [timeline]);

  const handleRedo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, timeline]);
      setTimeline(next);
      return f.slice(1);
    });
  }, [timeline]);

  // Live refs for AudioContext-clock lookahead scheduler
  const eventsRef = useRef(timeline.events);
  const finishTickRef = useRef(timeline.finish);
  const bpmRef = useRef(bpm);
  const musicOffsetRef = useRef(musicOffsetSec);
  const metronomeRef = useRef(metronomeOn);
  const cueSfxRef = useRef(cueSfxOn);

  useEffect(() => {
    eventsRef.current = timeline.events;
    finishTickRef.current = timeline.finish;
  }, [timeline.events, timeline.finish]);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    musicOffsetRef.current = musicOffsetSec;
  }, [musicOffsetSec]);
  useEffect(() => {
    metronomeRef.current = metronomeOn;
  }, [metronomeOn]);
  useEffect(() => {
    cueSfxRef.current = cueSfxOn;
  }, [cueSfxOn]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    audioRef.current?.stopPlayback();
  }, []);

  const startPlayback = useCallback(() => {
    void ensureVaultAudioDecoded();
    const audio = audioRef.current!;
    audio.startPlayback(currentTick, {
      getEvents: () => eventsRef.current,
      getMaxTick: () => finishTickRef.current,
      getBpm: () => bpmRef.current,
      getMusicOffsetSec: () => musicOffsetRef.current,
      getMetronomeOn: () => metronomeRef.current,
      getCueSfxOn: () => cueSfxRef.current,
      onReachedEnd: () => {
        setIsPlaying(false);
        setCurrentTick(0);
      },
    });
    setIsPlaying(true);
  }, [currentTick, ensureVaultAudioDecoded]);

  const togglePlay = useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, startPlayback, stopPlayback]);

  // Visual 60fps playhead loop reads AudioContext clock directly (scheduling lives in RhythmAudioEngine)
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const drawPlayhead = () => {
      const nextTick = audioRef.current?.getPlaybackTick(bpmRef.current) ?? 0;
      setCurrentTick(nextTick);
      if (nextTick < finishTickRef.current) {
        raf = requestAnimationFrame(drawPlayhead);
      }
    };
    raf = requestAnimationFrame(drawPlayhead);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      audioRef.current?.stopPlayback();
    };
  }, []);

  const handleSeekTick = useCallback(
    (tick: number) => {
      const clamped = Math.max(0, Math.round(tick));
      setCurrentTick(clamped);
      if (isPlaying) {
        audioRef.current?.seekPlayback(clamped);
      }
    },
    [isPlaying]
  );

  const storedPatterns = useMemo(
    () => [...BUILTIN_PATTERNS, ...userPatterns],
    [userPatterns]
  );

  const activePattern = useMemo(
    () => storedPatterns.find((p) => p.id === activePatternId) ?? null,
    [storedPatterns, activePatternId]
  );

  const activeCue = useMemo(() => {
    const list = getCuesForGame(selectedGame);
    return list[0] ?? null;
  }, [selectedGame]);

  const handleSelectGame = useCallback((g: GameId) => {
    setSelectedGame(g);
    setRecentGames((prev) => {
      const next = [g, ...prev.filter((x) => x !== g)].slice(0, 8);
      saveRecentGames(next);
      return next;
    });
  }, []);

  const handleToggleFavorite = useCallback((g: GameId) => {
    setFavoriteGames((prev) => {
      const next = prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g];
      saveFavoriteGames(next);
      return next;
    });
  }, []);

  // Cue / Event Mutations
  const insertCueAtTick = useCallback(
    (cue: CueDef, tick: number, withSwitch: boolean) => {
      const snapped = Math.max(0, Math.round(tick));
      const newIds: string[] = [];
      commitTimeline((tl) => {
        if (withSwitch) {
          const swId = nextEventId('sw');
          newIds.push(swId);
          tl.events.push({
            id: swId,
            tick: snapped,
            op: 'switch',
            game: cue.game,
            style: 0,
            sub: 2,
          });
        }
        const cueId = nextEventId('cue');
        newIds.push(cueId);
        tl.events.push({
          id: cueId,
          tick: snapped,
          op: 'call',
          game: cue.game,
          fn: cue.fn,
          args: [...cue.args] as [number, number, number, number],
          word: cue.word,
          tag: 'basic',
        });
        if (snapped >= tl.end) {
          tl.end = snapped + 4 * TPB;
          tl.finish = tl.end + 4 * TPB;
        }
        return tl;
      });
      handleSelectGame(cue.game);
      if (newIds.length) setSelectedEventIds([newIds[newIds.length - 1]]);
      if (cueSfxOn) {
        audioRef.current?.playCueSfx({
          id: 'preview',
          tick: snapped,
          op: 'call',
          game: cue.game,
          fn: cue.fn,
          args: cue.args,
          word: cue.word,
        });
      }
    },
    [commitTimeline, cueSfxOn, handleSelectGame]
  );

  const handleInsertSwitchAtTick = useCallback(
    (game: GameId, tick: number, cut: boolean) => {
      const snapped = Math.max(0, Math.round(tick));
      const id = nextEventId('sw');
      commitTimeline((tl) => {
        tl.events.push({
          id,
          tick: snapped,
          op: 'switch',
          game,
          style: cut ? -1 : 0,
          sub: 2,
        });
        return tl;
      });
      setSelectedEventIds([id]);
    },
    [commitTimeline]
  );

  const handleInsertSwitch = useCallback(
    (game: GameId, cut: boolean) => {
      handleInsertSwitchAtTick(game, currentTick, cut);
    },
    [handleInsertSwitchAtTick, currentTick]
  );

  const handleInsertFade = useCallback(() => {
    const id = nextEventId('fade');
    commitTimeline((tl) => {
      tl.events.push({
        id,
        tick: currentTick,
        op: 'fade',
        fadeLen: 480,
        alpha: 0.6,
      });
      return tl;
    });
    setSelectedEventIds([id]);
  }, [commitTimeline, currentTick]);

  const handleInsertAnim = useCallback(
    (game: GameId, animName = 'Remix8') => {
      const layout = LAYOUT_OFF[game];
      if (layout === undefined || !isValidLayoutContract(game, layout)) {
        showToast(`${game} has no verified layout in engine_contract.json`, 'error');
        return;
      }
      const cleanName = animName.replace(/[^A-Za-z0-9_]/g, '').slice(0, 47) || 'Remix8';
      if (!isValidAnimNameContract(cleanName)) {
        showToast('Invalid animation name (use [A-Za-z0-9_]{1,47})', 'error');
        return;
      }
      const id = nextEventId('anim');
      commitTimeline((tl) => {
        tl.events.push({
          id,
          tick: currentTick,
          op: 'anim',
          game,
          layout,
          animName: cleanName,
        });
        return tl;
      });
      setSelectedEventIds([id]);
    },
    [commitTimeline, currentTick, showToast]
  );

  const handleStampPatternAtTick = useCallback(
    (pattern: StoredPattern, tick: number, withSwitch: boolean) => {
      try {
        const created = instantiatePattern(pattern, tick, withSwitch);
        commitTimeline((tl) => {
          tl.events.push(...created);
          const maxCreated = created.reduce((m, e) => Math.max(m, e.tick), tick);
          if (maxCreated >= tl.end) {
            tl.end = maxCreated + 4 * TPB;
            tl.finish = tl.end + 4 * TPB;
          }
          return tl;
        });
        setSelectedEventIds(created.map((e) => e.id));
        if (cueSfxOn) {
          audioRef.current?.auditionPattern(pattern.events, bpm);
        }
        showToast(`Stamped pattern: ${pattern.name}`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [bpm, commitTimeline, cueSfxOn, showToast]
  );

  const handleStampToolClick = useCallback(
    (tick: number, withSwitch: boolean) => {
      if (activePattern) {
        handleStampPatternAtTick(activePattern, tick, withSwitch);
      } else if (activeCue) {
        insertCueAtTick(activeCue, tick, withSwitch);
      }
    },
    [activeCue, activePattern, handleStampPatternAtTick, insertCueAtTick]
  );

  const handleMoveEvents = useCallback(
    (moves: Array<{ id: string; tick: number }>) => {
      const map = new Map(moves.map((m) => [m.id, m.tick]));
      setTimeline((prev) => {
        const next = cloneTimeline(prev);
        for (const ev of next.events) {
          const t = map.get(ev.id);
          if (t !== undefined) ev.tick = Math.max(0, Math.round(t));
        }
        next.events.sort((a, b) => a.tick - b.tick);
        return next;
      });
    },
    []
  );

  const handleDuplicateMoveEvents = useCallback(
    (moves: Array<{ id: string; tick: number }>) => {
      const map = new Map(moves.map((m) => [m.id, m.tick]));
      const newIds: string[] = [];
      commitTimeline((tl) => {
        const clones: TimelineEvent[] = [];
        for (const ev of tl.events) {
          const t = map.get(ev.id);
          if (t !== undefined) {
            const copyId = nextEventId('dup');
            newIds.push(copyId);
            clones.push({
              ...ev,
              id: copyId,
              tick: Math.max(0, Math.round(t)),
              args: ev.args ? ([...ev.args] as [number, number, number, number]) : undefined,
            });
          }
        }
        tl.events.push(...clones);
        return tl;
      });
      if (newIds.length) setSelectedEventIds(newIds);
    },
    [commitTimeline]
  );

  const handleResizeEvent = useCallback((id: string, newSpanTicks: number) => {
    setTimeline((prev) => {
      const next = cloneTimeline(prev);
      const ev = next.events.find((e) => e.id === id);
      if (!ev) return prev;
      if (ev.op === 'fade') {
        ev.fadeLen = Math.max(60, Math.round(newSpanTicks));
      } else if (ev.op === 'call' && ev.game && ev.fn !== undefined && ev.args) {
        const desired = [...ev.args] as [number, number, number, number];
        if (ev.game === 'PARASOL' && ev.fn === 0x204970) {
          desired[0] = Math.max(120, Math.round(newSpanTicks / 4));
          ev.args = snapCueArgsToContract(ev.game, ev.fn, desired);
        } else if (ev.game === 'SOFTCATCH') {
          desired[1] = Math.max(120, Math.round(newSpanTicks / 4));
          ev.args = snapCueArgsToContract(ev.game, ev.fn, desired);
        } else if (ev.game === 'DANCER' || ev.game === 'BRUSH') {
          desired[0] = Math.max(2, Math.round(newSpanTicks / TPB));
          ev.args = snapCueArgsToContract(ev.game, ev.fn, desired);
        }
      }
      return next;
    });
  }, []);

  const handleDeleteEvents = useCallback(
    (ids: string[]) => {
      const delSet = new Set(ids);
      commitTimeline((tl) => {
        tl.events = tl.events.filter((e) => !delSet.has(e.id));
        return tl;
      });
      setSelectedEventIds((prev) => prev.filter((id) => !delSet.has(id)));
    },
    [commitTimeline]
  );

  const handleDuplicateEvents = useCallback(
    (ids: string[]) => {
      const sel = timeline.events.filter((e) => ids.includes(e.id));
      if (!sel.length) return;
      const newIds: string[] = [];
      commitTimeline((tl) => {
        for (const orig of sel) {
          const copyId = nextEventId('dup');
          newIds.push(copyId);
          tl.events.push({
            ...orig,
            id: copyId,
            tick: orig.tick + TPB,
            args: orig.args ? ([...orig.args] as [number, number, number, number]) : undefined,
          });
        }
        return tl;
      });
      setSelectedEventIds(newIds);
    },
    [commitTimeline, timeline.events]
  );

  const handleBatchNudge = useCallback(
    (ids: string[], deltaTicks: number) => {
      const set = new Set(ids);
      commitTimeline((tl) => {
        for (const ev of tl.events) {
          if (set.has(ev.id)) {
            ev.tick = Math.max(0, Math.round(ev.tick + deltaTicks));
          }
        }
        return tl;
      });
    },
    [commitTimeline]
  );

  const handleBatchTag = useCallback(
    (ids: string[], tag: string | null) => {
      const set = new Set(ids);
      commitTimeline((tl) => {
        for (const ev of tl.events) {
          if (set.has(ev.id) && ev.op === 'call') {
            ev.tag = tag;
          }
        }
        return tl;
      });
    },
    [commitTimeline]
  );

  const selectedEvents = useMemo(
    () => timeline.events.filter((e) => selectedEventIds.includes(e.id)),
    [timeline.events, selectedEventIds]
  );

  const handleOpenSavePattern = useCallback(() => {
    if (selectedEvents.length === 0) return;
    setPatternDraftName(`${GAME_META[selectedGame].title} Pattern`);
    setSavePatternModalOpen(true);
  }, [selectedEvents.length, selectedGame]);

  const handleConfirmSavePattern = useCallback(() => {
    try {
      const pat = buildPatternFromSelection(selectedEvents, patternDraftName, selectedGame);
      setUserPatterns((prev) => {
        const next = [pat, ...prev];
        saveUserPatterns(next);
        return next;
      });
      setActivePatternId(pat.id);
      setSavePatternModalOpen(false);
      showToast(`Saved reusable pattern: ${pat.name}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [patternDraftName, selectedEvents, selectedGame, showToast]);

  // Audio Loading
  const handleUploadMusic = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const { duration, peaks } = await audioRef.current!.loadAudioBuffer(buffer);
        setMusicFile({ name: file.name, buffer, mime: file.type || 'audio/*' });
        setMusicDurationSec(duration);
        setWaveformPeaks(peaks);
        showToast(`Loaded audio: ${file.name} (${duration.toFixed(1)}s)`);
      } catch (e) {
        showToast(`Could not decode audio: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
    [showToast]
  );

  const handleClearMusic = useCallback(() => {
    audioRef.current?.clearMusic();
    setMusicFile(null);
    setMusicDurationSec(0);
    setWaveformPeaks(new Float32Array(0));
  }, []);

  // Local Asset Vault Handlers (100% browser-local IndexedDB)
  const handleAddVaultAssets = useCallback(
    async (newAssets: LocalAssetRecord[]) => {
      const deduped = upsertAssetsById([], newAssets);
      try {
        const authoritative = await saveVaultAssetsBatch(deduped);
        setVaultAssets(authoritative);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Failed saving local assets to IndexedDB: ${msg}`, 'error');
        throw err;
      }
    },
    [showToast]
  );

  const handleUpdateVaultGameBinding = useCallback(
    (game: GameId, binding: GameAssetBinding) => {
      setVaultBindings((prev) => {
        const next = { ...prev, [game]: binding };
        void saveVaultBindings(next, vaultGlobalAudio).catch((err) => {
          showToast(
            `Failed saving vault binding: ${err instanceof Error ? err.message : String(err)}`,
            'error'
          );
        });
        return next;
      });
    },
    [vaultGlobalAudio, showToast]
  );

  const handleUpdateVaultGlobalAudio = useCallback(
    (nextGlobal: GlobalAudioBindings) => {
      setVaultGlobalAudio(nextGlobal);
      void saveVaultBindings(vaultBindings, nextGlobal).catch((err) => {
        showToast(
          `Failed saving global audio binding: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      });
    },
    [vaultBindings, showToast]
  );

  const handleDeleteVaultAsset = useCallback(
    async (assetId: string) => {
      try {
        await deleteVaultAsset(assetId);
        audioRef.current?.unregisterLocalAudio(assetId);
        decodedVaultAudioIdsRef.current.delete(assetId);
        setVaultAssets((prev) => prev.filter((a) => a.id !== assetId));

        const nextBindings: Partial<Record<GameId, GameAssetBinding>> = {};
        for (const [gameKey, b] of Object.entries(vaultBindings)) {
          if (!b) continue;
          const cueSfxMap: Record<string, string> = {};
          for (const [ck, aid] of Object.entries(b.cueSfxMap)) {
            if (aid !== assetId) cueSfxMap[ck] = aid;
          }
          nextBindings[gameKey as GameId] = {
            ...b,
            backdropAssetId: b.backdropAssetId === assetId ? undefined : b.backdropAssetId,
            actorAssetId: b.actorAssetId === assetId ? undefined : b.actorAssetId,
            foregroundAssetId: b.foregroundAssetId === assetId ? undefined : b.foregroundAssetId,
            prologueAssetId: b.prologueAssetId === assetId ? undefined : b.prologueAssetId,
            layoutAssetId: b.layoutAssetId === assetId ? undefined : b.layoutAssetId,
            modelAssetId: b.modelAssetId === assetId ? undefined : b.modelAssetId,
            bflanAssetIds: (b.bflanAssetIds ?? []).filter((id) => id !== assetId),
            bgmAssetId: b.bgmAssetId === assetId ? undefined : b.bgmAssetId,
            cueSfxMap,
            animations: b.animations.filter((clip) => clip.assetId !== assetId),
          };
        }
        const nextJingles: Record<number, string> = {};
        for (const [jc, aid] of Object.entries(vaultGlobalAudio.jingleAssetMap)) {
          if (aid !== assetId) nextJingles[Number(jc)] = aid;
        }
        const nextGlobal: GlobalAudioBindings = {
          ...vaultGlobalAudio,
          switchSoftAssetId:
            vaultGlobalAudio.switchSoftAssetId === assetId ? undefined : vaultGlobalAudio.switchSoftAssetId,
          switchCutAssetId:
            vaultGlobalAudio.switchCutAssetId === assetId ? undefined : vaultGlobalAudio.switchCutAssetId,
          metronomeDownbeatAssetId:
            vaultGlobalAudio.metronomeDownbeatAssetId === assetId
              ? undefined
              : vaultGlobalAudio.metronomeDownbeatAssetId,
          metronomeBeatAssetId:
            vaultGlobalAudio.metronomeBeatAssetId === assetId
              ? undefined
              : vaultGlobalAudio.metronomeBeatAssetId,
          playalongHitAssetId:
            vaultGlobalAudio.playalongHitAssetId === assetId ? undefined : vaultGlobalAudio.playalongHitAssetId,
          jingleAssetMap: nextJingles,
        };
        setVaultBindings(nextBindings);
        setVaultGlobalAudio(nextGlobal);
        await saveVaultBindings(nextBindings, nextGlobal);
      } catch (err) {
        showToast(
          `Failed deleting local vault asset: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    },
    [vaultBindings, vaultGlobalAudio, showToast]
  );

  const handlePurgeVault = useCallback(async () => {
    try {
      await purgeLocalVault();
      audioRef.current?.clearAllLocalAudio();
      decodedVaultAudioIdsRef.current.clear();
      setVaultAssets([]);
      setVaultBindings({});
      setVaultGlobalAudio({ jingleAssetMap: {} });
      showToast('Cleared all device-local IndexedDB vault assets and bindings.');
    } catch (err) {
      showToast(
        `Failed clearing local vault: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    }
  }, [showToast]);

  const handleAuditionVaultAudio = useCallback(
    (asset: LocalAssetRecord) => {
      if (!asset.audioBufferData) {
        showToast('Audio buffer unavailable for this asset', 'error');
        return;
      }
      void audioRef.current?.auditionBufferOnce(asset.audioBufferData, asset.id).catch((e) => {
        showToast(`Could not decode audio: ${e instanceof Error ? e.message : String(e)}`, 'error');
      });
    },
    [showToast]
  );

  const handleApplyVaultMusicToProject = useCallback(
    async (asset: LocalAssetRecord) => {
      if (!asset.audioBufferData) {
        showToast('Audio buffer unavailable for this asset', 'error');
        return;
      }
      try {
        const { duration, peaks } = await audioRef.current!.loadAudioBuffer(asset.audioBufferData);
        setMusicFile({
          name: asset.name,
          buffer: asset.audioBufferData.slice(0),
          mime: asset.mimeType || 'audio/*',
        });
        setMusicDurationSec(duration);
        setWaveformPeaks(peaks);
        showToast(`Loaded local BGM "${asset.name}" into timeline preview (${duration.toFixed(1)}s)`);
      } catch (e) {
        showToast(`Could not load BGM: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
    [showToast]
  );

  // Universal File Import (.gtf, .gtl, .rhref, .rhre3, .groove, audio)
  const handleImportFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith('.gtf')) {
          const text = decodeUtf8Strict(new Uint8Array(await file.arrayBuffer()), file.name);
          const tl = compileGtf(text, file.name);
          commitTimeline(() => tl);
          setCurrentTick(0);
          showToast(`Imported ${file.name} (${tl.events.length} events)`);
        } else if (lower.endsWith('.gtl')) {
          const text = decodeUtf8Strict(new Uint8Array(await file.arrayBuffer()), file.name);
          const tl = parseGtl(text, file.name);
          commitTimeline(() => tl);
          setCurrentTick(0);
          showToast(`Imported ${file.name} (GTLM 1)`);
        } else if (lower.endsWith('.rhref') || lower.endsWith('.rhre3') || lower.endsWith('.json')) {
          const res = await importRhreFile(file, file.name);
          commitTimeline(() => res.timeline);
          setBpm(res.bpm);
          setCurrentTick(0);
          showToast(
            res.warnings.length
              ? `Imported ${file.name} (${res.warnings.length} warnings — check console/inspector)`
              : `Imported ${file.name} at ${res.bpm} BPM`
          );
        } else if (lower.endsWith('.groove') || lower.endsWith('.zip')) {
          const pkg = await importGroovePackage(file);
          if (pkg.sha256) {
            const existing = packageRegistryRef.current.get(pkg.packageId);
            const conflict = checkPackageRegistryConflict(existing, {
              id: pkg.packageId,
              version: pkg.packageVersion,
              sha256: pkg.sha256,
            });
            if (conflict.status === 'version_conflict' || conflict.status === 'downgrade') {
              throw new Error(conflict.reason);
            }
            packageRegistryRef.current.set(pkg.packageId, {
              id: pkg.packageId,
              version: pkg.packageVersion,
              sha256: pkg.sha256,
            });
          }
          setPackageId(pkg.packageId);
          setPackageVersion(pkg.packageVersion);
          if (pkg.runtimeFormat) setRuntimeFormat(pkg.runtimeFormat);
          setLastExportSha256(pkg.sha256 ?? null);
          commitTimeline(() => pkg.timeline);
          setBpm(pkg.bpm);
          setMusicOffsetSec(pkg.musicOffsetSec);
          setSprites(pkg.sprites);
          setPrologueImage(pkg.prologueImage ?? null);
          if (pkg.musicFile) {
            const { duration, peaks } = await audioRef.current!.loadAudioBuffer(pkg.musicFile.buffer);
            setMusicFile(pkg.musicFile);
            setMusicDurationSec(duration);
            setWaveformPeaks(peaks);
          } else {
            audioRef.current?.clearMusic();
            setMusicFile(null);
            setMusicDurationSec(0);
            setWaveformPeaks(new Float32Array(0));
          }
          setCurrentTick(0);
          showToast(
            `Loaded ${pkg.profile === 'runtime' ? 'runtime' : 'authoring'} .groove: ${pkg.timeline.title || file.name} (${pkg.packageId})`
          );
        } else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/.test(lower)) {
          await handleUploadMusic(file);
        } else {
          showToast(`Unsupported file format: ${file.name}`, 'error');
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [commitTimeline, handleUploadMusic, showToast]
  );

  // Exports
  const handleExportGtf = useCallback(() => {
    const gtf = decompileToGtf(timeline, timeline.title || 'Groove Builder');
    triggerDownload('multi.gtf', gtf);
    showToast('Exported multi.gtf (Groove Engine v0.5.0)');
  }, [timeline, showToast]);

  const handleExportGtl = useCallback(() => {
    const gtl = emitGtl(timeline, timeline.title || 'Groove Builder');
    triggerDownload('multi.gtl', gtl);
    showToast('Exported multi.gtl (GTLM 1)');
  }, [timeline, showToast]);

  const performGrooveExport = useCallback(
    async (profile: 'editor' | 'runtime', rtFmt: RuntimeTimelineFormat = runtimeFormat) => {
      try {
        const result = await exportGroovePackage({
          profile,
          runtimeFormat: rtFmt,
          packageId,
          packageVersion,
          timeline,
          bpm,
          musicOffsetSec,
          musicFile,
          prologueImage,
          sprites,
        });
        setLastExportSha256(result.sha256);
        packageRegistryRef.current.set(packageId, {
          id: packageId,
          version: packageVersion,
          sha256: result.sha256,
        });
        const slug = (timeline.title || 'remix_21').toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'remix_21';
        const suffix = profile === 'runtime' ? `runtime_${rtFmt}` : 'editor';
        triggerDownload(`${slug}.${suffix}.groove`, result.blob, 'application/zip');
        showToast(
          `Exported ${slug}.${suffix}.groove (Draft 0.3 preview · SHA-256 ${result.sha256.slice(0, 12)}…)`
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [
      runtimeFormat,
      packageId,
      packageVersion,
      timeline,
      bpm,
      musicOffsetSec,
      musicFile,
      prologueImage,
      sprites,
      showToast,
    ]
  );

  const handleExportGrooveEditor = useCallback(() => {
    void performGrooveExport('editor');
  }, [performGrooveExport]);

  const handleExportGrooveRuntime = useCallback(() => {
    const impact = analyzeRuntimeExportImpact({
      packageId,
      packageVersion,
      timeline,
      bpm,
      musicOffsetSec,
      musicFile,
      prologueImage,
      sprites,
    });
    if (impact.hasChanges) {
      setRuntimeConfirmModal({ impact });
    } else {
      void performGrooveExport('runtime', runtimeFormat);
    }
  }, [
    packageId,
    packageVersion,
    timeline,
    bpm,
    musicOffsetSec,
    musicFile,
    prologueImage,
    sprites,
    runtimeFormat,
    performGrooveExport,
  ]);

  const handleDownloadSourceZip = useCallback(async () => {
    try {
      const res = await fetch('/groove-builder-source.zip');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      triggerDownload('groove-builder-ge153-source.zip', blob, 'application/zip');
      showToast('Downloaded Groove Builder source ZIP (GE-153)');
    } catch (e) {
      showToast(`Source ZIP unavailable: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [showToast]);

  // Keyboard shortcuts (RHREfresh 1-5/R tools, Space, Ctrl+Z/Y/D, Del)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedEventIds.length) {
        e.preventDefault();
        handleDuplicateEvents(selectedEventIds);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEventIds.length) {
        e.preventDefault();
        handleDeleteEvents(selectedEventIds);
      } else if (e.key === 'Escape') {
        setSelectedEventIds([]);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '1') setActiveTool('select');
        else if (e.key === '2') setActiveTool('switch');
        else if (e.key === '3') setActiveTool('pickaxe');
        else if (e.key === '4' || e.key.toLowerCase() === 'r') setActiveTool('ruler');
        else if (e.key === '5') setActiveTool('stamp');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    togglePlay,
    handleUndo,
    handleRedo,
    selectedEventIds,
    handleDeleteEvents,
    handleDuplicateEvents,
  ]);

  const validation = useMemo(() => validateTimeline(timeline), [timeline]);

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#0E1117] text-[#E6EDF3]"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        if (f) {
          e.preventDefault();
          void handleImportFile(f);
        }
      }}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".gtf,.gtl,.rhref,.rhre3,.json,.groove,.zip,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
          e.target.value = '';
        }}
      />

      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onImportClick={() => importInputRef.current?.click()}
        onExportGtf={handleExportGtf}
        onExportGtl={handleExportGtl}
        onExportGrooveEditor={handleExportGrooveEditor}
        onExportGrooveRuntime={handleExportGrooveRuntime}
        hasSourceZip={hasSourceZip}
        onDownloadSourceZip={handleDownloadSourceZip}
        onLoadTemplate={(key) => {
          const src = key === 'ejemplo' ? EXAMPLE_GTF : SHOWCASE_24_GTF;
          commitTimeline(() => compileGtf(src, `${key}.gtf`));
          setCurrentTick(0);
          showToast(key === 'ejemplo' ? 'Loaded official ejemplo.gtf' : 'Loaded 24-Minigame Showcase');
        }}
      />

      <TransportBar
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onStop={() => {
          stopPlayback();
          setCurrentTick(0);
        }}
        onJumpStart={() => handleSeekTick(0)}
        currentTick={currentTick}
        bpm={bpm}
        onBpmChange={setBpm}
        snapDenominator={snapDenominator}
        onSnapChange={setSnapDenominator}
        zoomPxPerBeat={zoomPxPerBeat}
        onZoomChange={setZoomPxPerBeat}
        metronomeOn={metronomeOn}
        onToggleMetronome={() => setMetronomeOn((v) => !v)}
        cueSfxOn={cueSfxOn}
        onToggleCueSfx={() => setCueSfxOn((v) => !v)}
        musicName={musicFile?.name ?? null}
        onUploadMusic={(f) => void handleUploadMusic(f)}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        hasActivePattern={Boolean(activePattern)}
      />

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'timeline' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Upper Split: RHREfresh Timeline Canvas + Right Stage & Mechanics Inspector */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Mobile Picker Sub-Pane */}
              {mobilePane === 'cues' && (
                <div className="flex lg:hidden w-full h-full">
                  <BottomPickerDock
                    selectedGame={selectedGame}
                    onSelectGame={handleSelectGame}
                    favoriteGames={favoriteGames}
                    recentGames={recentGames}
                    onToggleFavorite={handleToggleFavorite}
                    storedPatterns={storedPatterns}
                    activePatternId={activePatternId}
                    onSelectPattern={setActivePatternId}
                    onSaveSelectionAsPattern={handleOpenSavePattern}
                    onDeletePattern={(id) => {
                      setUserPatterns((prev) => {
                        const next = prev.filter((p) => p.id !== id);
                        saveUserPatterns(next);
                        return next;
                      });
                      if (activePatternId === id) setActivePatternId(null);
                    }}
                    canSavePattern={selectedEvents.length > 0}
                    onInsertCue={(cue, withSwitch) => {
                      insertCueAtTick(cue, currentTick, withSwitch);
                      setMobilePane('timeline');
                    }}
                    onStampPattern={(pat, withSwitch) => {
                      handleStampPatternAtTick(pat, currentTick, withSwitch);
                      setMobilePane('timeline');
                    }}
                    onAuditionCue={(cue) =>
                      audioRef.current?.playCueSfx({
                        id: 'aud',
                        tick: 0,
                        op: 'call',
                        game: cue.game,
                        fn: cue.fn,
                        args: cue.args,
                        word: cue.word,
                      })
                    }
                    onAuditionPattern={(pat) => audioRef.current?.auditionPattern(pat.events, bpm)}
                    onInsertSwitch={handleInsertSwitch}
                    onInsertFade={handleInsertFade}
                    onInsertAnim={(g) => handleInsertAnim(g, sprites[g]?.defaultAnim || 'Remix8')}
                    onDragStartCue={setDraggedCue}
                    onActivateStampTool={() => setActiveTool('stamp')}
                    mobileFullHeight
                  />
                </div>
              )}

              {/* Center Timeline Canvas */}
              <div className={`${mobilePane === 'timeline' ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0 h-full`}>
                <div className="lg:hidden">
                  <StagePreview
                    timeline={timeline}
                    currentTick={currentTick}
                    bpm={bpm}
                    sprites={sprites}
                    prologueImageDataUrl={prologueImage?.dataUrl}
                    vaultBindings={vaultBindings}
                    vaultAssets={vaultAssets}
                    onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                    onTriggerTapSound={() => audioRef.current?.playPlayalongTapSound()}
                    compact
                  />
                </div>

                <TimelineEditor
                  timeline={timeline}
                  currentTick={currentTick}
                  isPlaying={isPlaying}
                  bpm={bpm}
                  musicOffsetSec={musicOffsetSec}
                  musicDurationSec={musicDurationSec}
                  waveformPeaks={waveformPeaks}
                  zoomPxPerBeat={zoomPxPerBeat}
                  snapDenominator={snapDenominator}
                  activeTool={activeTool}
                  selectedGame={selectedGame}
                  activeCue={activeCue}
                  activePattern={activePattern}
                  selectedEventIds={selectedEventIds}
                  onSelectEvents={setSelectedEventIds}
                  onSeekTick={handleSeekTick}
                  onMoveEvents={handleMoveEvents}
                  onDuplicateMoveEvents={handleDuplicateMoveEvents}
                  onResizeEvent={handleResizeEvent}
                  onDeleteEvent={(id) => handleDeleteEvents([id])}
                  onDropNewCue={(cue, tick) => insertCueAtTick(cue, tick, false)}
                  onInsertSwitchAtTick={handleInsertSwitchAtTick}
                  onStampAtTick={handleStampToolClick}
                  onUpdateMarker={(marker, tick) => commitTimeline((tl) => ({ ...tl, [marker]: Math.max(0, tick) }))}
                  draggedCue={draggedCue}
                />
              </div>

              {/* Right Sidebar: Heaven Studio Stage Preview + Mechanics Inspector */}
              <div
                className={`${
                  mobilePane === 'inspector' ? 'flex w-full lg:w-[340px]' : 'hidden lg:flex lg:w-[340px]'
                } flex-col border-l border-white/10 shrink-0 h-full overflow-hidden`}
              >
                <div className="hidden lg:block shrink-0">
                  <StagePreview
                    timeline={timeline}
                    currentTick={currentTick}
                    bpm={bpm}
                    sprites={sprites}
                    prologueImageDataUrl={prologueImage?.dataUrl}
                    vaultBindings={vaultBindings}
                    vaultAssets={vaultAssets}
                    onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                    onTriggerTapSound={() => audioRef.current?.playPlayalongTapSound()}
                    compact
                  />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <InspectorPanel
                    timeline={timeline}
                    selectedEvents={selectedEvents}
                    validation={validation}
                    onUpdateTimeline={(patch) => commitTimeline((tl) => ({ ...tl, ...patch }))}
                    onUpdateEvent={(id, patch) =>
                      commitTimeline((tl) => {
                        const ev = tl.events.find((e) => e.id === id);
                        if (ev) Object.assign(ev, patch);
                        return tl;
                      })
                    }
                    onBatchNudge={handleBatchNudge}
                    onBatchTag={handleBatchTag}
                    onDeleteEvents={handleDeleteEvents}
                    onDuplicateEvents={handleDuplicateEvents}
                    onSaveSelectionAsPattern={handleOpenSavePattern}
                    onInsertSwitchBeforeCue={(ev) => {
                      if (!ev.game) return;
                      handleInsertSwitchAtTick(ev.game, Math.max(0, ev.tick - TPB), false);
                    }}
                    onSeekTick={handleSeekTick}
                  />
                </div>
              </div>
            </div>

            {/* Desktop Bottom 3-Tier RHREfresh Picker Dock */}
            <div className="hidden lg:block shrink-0">
              <BottomPickerDock
                selectedGame={selectedGame}
                onSelectGame={handleSelectGame}
                favoriteGames={favoriteGames}
                recentGames={recentGames}
                onToggleFavorite={handleToggleFavorite}
                storedPatterns={storedPatterns}
                activePatternId={activePatternId}
                onSelectPattern={setActivePatternId}
                onSaveSelectionAsPattern={handleOpenSavePattern}
                onDeletePattern={(id) => {
                  setUserPatterns((prev) => {
                    const next = prev.filter((p) => p.id !== id);
                    saveUserPatterns(next);
                    return next;
                  });
                  if (activePatternId === id) setActivePatternId(null);
                }}
                canSavePattern={selectedEvents.length > 0}
                onInsertCue={(cue, withSwitch) => insertCueAtTick(cue, currentTick, withSwitch)}
                onStampPattern={(pat, withSwitch) => handleStampPatternAtTick(pat, currentTick, withSwitch)}
                onAuditionCue={(cue) =>
                  audioRef.current?.playCueSfx({
                    id: 'aud',
                    tick: 0,
                    op: 'call',
                    game: cue.game,
                    fn: cue.fn,
                    args: cue.args,
                    word: cue.word,
                  })
                }
                onAuditionPattern={(pat) => audioRef.current?.auditionPattern(pat.events, bpm)}
                onInsertSwitch={handleInsertSwitch}
                onInsertFade={handleInsertFade}
                onInsertAnim={(g) => handleInsertAnim(g, sprites[g]?.defaultAnim || 'Remix8')}
                onDragStartCue={setDraggedCue}
                onActivateStampTool={() => setActiveTool('stamp')}
              />
            </div>
          </div>
        )}

        {activeTab === 'stage' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0E1117]">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <StagePreview
                  timeline={timeline}
                  currentTick={currentTick}
                  bpm={bpm}
                  sprites={sprites}
                  prologueImageDataUrl={prologueImage?.dataUrl}
                  vaultBindings={vaultBindings}
                  vaultAssets={vaultAssets}
                  onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                  onTriggerTapSound={() => audioRef.current?.playPlayalongTapSound()}
                />
              </div>
              <div className="rounded-xl border border-white/10 bg-[#141922] p-4">
                <InspectorPanel
                  timeline={timeline}
                  selectedEvents={selectedEvents}
                  validation={validation}
                  onUpdateTimeline={(patch) => commitTimeline((tl) => ({ ...tl, ...patch }))}
                  onUpdateEvent={(id, patch) =>
                    commitTimeline((tl) => {
                      const ev = tl.events.find((e) => e.id === id);
                      if (ev) Object.assign(ev, patch);
                      return tl;
                    })
                  }
                  onBatchNudge={handleBatchNudge}
                  onBatchTag={handleBatchTag}
                  onDeleteEvents={handleDeleteEvents}
                  onDuplicateEvents={handleDuplicateEvents}
                  onSaveSelectionAsPattern={handleOpenSavePattern}
                  onInsertSwitchBeforeCue={(ev) => {
                    if (!ev.game) return;
                    handleInsertSwitchAtTick(ev.game, Math.max(0, ev.tick - TPB), false);
                  }}
                  onSeekTick={handleSeekTick}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vault' && (
          <LocalAssetVault
            timeline={timeline}
            currentTick={currentTick}
            bpm={bpm}
            sprites={sprites}
            prologueImageDataUrl={prologueImage?.dataUrl}
            assets={vaultAssets}
            bindings={vaultBindings}
            globalAudio={vaultGlobalAudio}
            onAddAssets={handleAddVaultAssets}
            onDeleteAsset={handleDeleteVaultAsset}
            onPurgeVault={handlePurgeVault}
            onUpdateGameBinding={handleUpdateVaultGameBinding}
            onUpdateGlobalAudio={handleUpdateVaultGlobalAudio}
            onAuditionAudioAsset={handleAuditionVaultAudio}
            onApplyMusicAssetToProject={handleApplyVaultMusicToProject}
            onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
            onNotify={showToast}
          />
        )}

        {activeTab === 'customize' && (
          <CustomizationStudio
            packageId={packageId}
            packageVersion={packageVersion}
            runtimeFormat={runtimeFormat}
            lastExportSha256={lastExportSha256}
            timeline={timeline}
            currentTick={currentTick}
            bpm={bpm}
            musicOffsetSec={musicOffsetSec}
            musicName={musicFile?.name ?? null}
            musicVolume={musicVolume}
            sfxVolume={sfxVolume}
            sprites={sprites}
            prologueImage={prologueImage}
            vaultAssets={vaultAssets}
            vaultBindings={vaultBindings}
            onForkProjectId={() => {
              const forked = generateProjectId();
              setPackageId(forked);
              setPackageVersion('1.0.0');
              setLastExportSha256(null);
              showToast(`Forked project identity: ${forked}`);
            }}
            onUpdatePackageVersion={setPackageVersion}
            onUpdateRuntimeFormat={setRuntimeFormat}
            onUpdateTimeline={(patch) => commitTimeline((tl) => ({ ...tl, ...patch }))}
            onUpdateBpm={setBpm}
            onUpdateMusicOffset={setMusicOffsetSec}
            onUpdateMusicVolume={(v) => {
              setMusicVolume(v);
              audioRef.current?.setMusicVolume(v);
            }}
            onUpdateSfxVolume={(v) => {
              setSfxVolume(v);
              audioRef.current?.setSfxVolume(v);
            }}
            onUploadMusic={(f) => void handleUploadMusic(f)}
            onClearMusic={handleClearMusic}
            onUpdateSprite={(game, cfg) => {
              setSprites((prev) => {
                const next = { ...prev };
                if (!cfg) delete next[game];
                else next[game] = cfg;
                return next;
              });
            }}
            onSetPrologueImage={setPrologueImage}
            onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
            onExportGrooveEditor={handleExportGrooveEditor}
            onExportGrooveRuntime={handleExportGrooveRuntime}
            onImportGrooveClick={() => importInputRef.current?.click()}
            onInsertAnimAtPlayhead={(g, name) => {
              handleInsertAnim(g, name);
              showToast(`Inserted anim ${name} for ${g} @ ${(currentTick / TPB).toFixed(1)}b`);
            }}
          />
        )}

        {activeTab === 'code' && (
          <CodeStudio
            timeline={timeline}
            onApplyTimeline={(tl) => {
              commitTimeline(() => tl);
              showToast('Applied GTF/GTL edits to timeline');
            }}
            onDownloadGtf={handleExportGtf}
            onDownloadGtl={handleExportGtl}
          />
        )}
      </main>

      {/* Mobile / Android Bottom Studio Switcher (<= 15% height cap) */}
      <nav className="lg:hidden flex items-center justify-around border-t border-white/10 bg-[#141922] px-2 py-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            setActiveTab('timeline');
            setMobilePane('timeline');
          }}
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            activeTab === 'timeline' && mobilePane === 'timeline' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <Layers className="w-4 h-4 mb-0.5" />
          Timeline
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('timeline');
            setMobilePane('cues');
          }}
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            activeTab === 'timeline' && mobilePane === 'cues' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <Sliders className="w-4 h-4 mb-0.5" />
          24 Games
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('stage')}
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            activeTab === 'stage' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <MonitorPlay className="w-4 h-4 mb-0.5" />
          Stage
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('vault')}
          className={`flex flex-col items-center justify-center min-h-[44px] px-1.5 text-[11px] font-medium ${
            activeTab === 'vault' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <HardDrive className="w-4 h-4 mb-0.5" />
          Vault
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('customize')}
          className={`flex flex-col items-center justify-center min-h-[44px] px-1.5 text-[11px] font-medium ${
            activeTab === 'customize' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <Package className="w-4 h-4 mb-0.5" />
          .groove
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('code')}
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            activeTab === 'code' ? 'text-[#FF5A36]' : 'text-slate-400'
          }`}
        >
          <FileCode2 className="w-4 h-4 mb-0.5" />
          GTF
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium text-slate-400"
        >
          <FolderOpen className="w-4 h-4 mb-0.5" />
          Import
        </button>
      </nav>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="fixed bottom-16 lg:bottom-4 left-4 z-50 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-lg">
          Offline Mode — Local editor active
        </div>
      )}

      {/* Explicit Runtime .groove Export Conversion Modal */}
      {runtimeConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#141922] p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-base font-bold text-white">
                  Runtime .groove Conversion (Draft 0.3)
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  The runtime profile (<code className="font-mono text-sky-300">adapter: multi</code>) only
                  exports <code className="font-mono">manifest.json</code> and a single{' '}
                  <code className="font-mono">timeline.{runtimeFormat}</code>. The following editor items will
                  not be included:
                </p>
              </div>
            </div>

            {runtimeConfirmModal.impact.omittedAssets.length > 0 && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200 space-y-1">
                <div className="font-semibold">Omitted custom editor resources:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {runtimeConfirmModal.impact.omittedAssets.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {runtimeConfirmModal.impact.adjustments.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                <div className="font-semibold">Timeline / mode adjustments:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {runtimeConfirmModal.impact.adjustments.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">Primary runtime timeline format:</span>
              <select
                value={runtimeFormat}
                onChange={(e) => setRuntimeFormat(e.target.value as RuntimeTimelineFormat)}
                className="h-9 px-2.5 rounded-lg border border-white/10 bg-[#0E1117] font-mono text-xs text-white"
              >
                <option value="gtf">timeline.gtf</option>
                <option value="gtl">timeline.gtl (GTLM 1)</option>
              </select>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setRuntimeConfirmModal(null)}
                className="h-9 px-3.5 rounded-lg border border-white/10 bg-[#1B2230] text-xs font-medium text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setRuntimeConfirmModal(null);
                  void performGrooveExport('editor');
                }}
                className="h-9 px-3.5 rounded-lg border border-amber-500/40 bg-amber-500/15 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
              >
                Export Authoring .groove Instead
              </button>
              <button
                type="button"
                onClick={() => {
                  const fmt = runtimeFormat;
                  setRuntimeConfirmModal(null);
                  void performGrooveExport('runtime', fmt);
                }}
                className="h-9 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white"
              >
                Export Runtime .groove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Selection as Reusable Pattern Modal */}
      {savePatternModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#141922] p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <BookmarkPlus className="w-5 h-5 text-emerald-400" />
              <h3 className="font-display text-base font-bold text-white">
                Save Reusable Pattern ({selectedEvents.length} events)
              </h3>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Pattern Name</label>
              <input
                type="text"
                maxLength={64}
                value={patternDraftName}
                onChange={(e) => setPatternDraftName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white focus:outline-none focus:border-[#FF5A36]"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setSavePatternModalOpen(false)}
                className="h-9 px-3.5 rounded-lg border border-white/10 bg-[#1B2230] text-xs font-medium text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSavePattern}
                className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
              >
                Save Pattern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Toast */}
      {toast && (
        <div
          className={`fixed bottom-16 lg:bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-medium shadow-xl ${
            toast.kind === 'error'
              ? 'border-rose-500/40 bg-[#2A1419] text-rose-200'
              : 'border-white/15 bg-[#1B2230] text-slate-100'
          }`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
