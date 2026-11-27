import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sliders, Layers, MonitorPlay, Package, FileCode2, FolderOpen, X } from 'lucide-react';
import { beatToSec, RhythmAudioEngine, secToBeat } from './audio/rhythmAudio.ts';
import { CodeStudio } from './components/CodeStudio.tsx';
import { CueLibrary } from './components/CueLibrary.tsx';
import { CustomizationStudio } from './components/CustomizationStudio.tsx';
import { InspectorPanel } from './components/InspectorPanel.tsx';
import { StagePreview } from './components/StagePreview.tsx';
import { TimelineEditor } from './components/TimelineEditor.tsx';
import { TopBar, WorkspaceTab } from './components/TopBar.tsx';
import { TransportBar } from './components/TransportBar.tsx';
import { CueDef, EXAMPLE_GTF, GameId, LAYOUT_OFF, SHOWCASE_24_GTF, TPB } from './engine/cues.ts';
import {
  isValidAnimNameContract,
  isValidLayoutContract,
  snapCueArgsToContract,
} from './engine/engineContract.ts';
import {
  CustomSpriteConfig,
  exportGroovePackage,
  importGroovePackage,
} from './engine/groovePackage.ts';
import {
  cloneTimeline,
  compileGtf,
  decompileToGtf,
  emitGtl,
  nextEventId,
  parseGtl,
  Timeline,
  TimelineEvent,
  validateTimeline,
} from './engine/gtfEngine.ts';
import { importRhreFile } from './engine/rhreImporter.ts';
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

  // Selection & Library state
  const [selectedGame, setSelectedGame] = useState<GameId>('KAERU');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draggedCue, setDraggedCue] = useState<CueDef | null>(null);

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

  // Customizations for .groove
  const [sprites, setSprites] = useState<Partial<Record<GameId, CustomSpriteConfig>>>({});
  const [prologueImage, setPrologueImage] = useState<{ name: string; dataUrl: string } | null>(null);

  // Notifications
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToast({ text, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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

  // Playback Loop with sample-accurate cue/metronome triggering
  const playStartPerfRef = useRef(0);
  const playStartTickRef = useRef(0);
  const lastProcessedTickRef = useRef(-1);
  const lastProcessedBeatRef = useRef(-1);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    audioRef.current?.stopMusic();
  }, []);

  const startPlayback = useCallback(() => {
    const audio = audioRef.current!;
    const startBeat = currentTick / TPB;
    const songSec = beatToSec(startBeat, bpm, musicOffsetSec);
    audio.startMusic(songSec);
    playStartPerfRef.current = performance.now();
    playStartTickRef.current = currentTick;
    lastProcessedTickRef.current = currentTick - 1;
    lastProcessedBeatRef.current = Math.floor(currentTick / TPB) - 1;
    setIsPlaying(true);
  }, [currentTick, bpm, musicOffsetSec]);

  const togglePlay = useCallback(() => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  }, [isPlaying, startPlayback, stopPlayback]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;

    const tickLoop = () => {
      const elapsedSec = (performance.now() - playStartPerfRef.current) / 1000;
      const deltaBeats = secToBeat(elapsedSec, bpm, 0);
      const nextTick = Math.round(playStartTickRef.current + deltaBeats * TPB);

      // Fire metronome beats crossed
      const prevBeat = lastProcessedBeatRef.current;
      const currBeat = Math.floor(nextTick / TPB);
      if (metronomeOn && currBeat > prevBeat) {
        for (let b = prevBeat + 1; b <= currBeat; b++) {
          if (b >= 0) audioRef.current?.playMetronome(b % 4 === 0);
        }
        lastProcessedBeatRef.current = currBeat;
      }

      // Fire events crossed
      const prevTick = lastProcessedTickRef.current;
      if (cueSfxOn && nextTick > prevTick) {
        for (const ev of timeline.events) {
          if (ev.tick > prevTick && ev.tick <= nextTick) {
            audioRef.current?.playCueSfx(ev);
          }
        }
      }
      lastProcessedTickRef.current = nextTick;

      setCurrentTick(nextTick);

      if (nextTick >= timeline.finish) {
        stopPlayback();
        setCurrentTick(0);
        return;
      }
      raf = requestAnimationFrame(tickLoop);
    };

    raf = requestAnimationFrame(tickLoop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, bpm, timeline.events, timeline.finish, metronomeOn, cueSfxOn, stopPlayback]);

  const handleSeekTick = useCallback(
    (tick: number) => {
      const clamped = Math.max(0, Math.round(tick));
      setCurrentTick(clamped);
      if (isPlaying) {
        const audio = audioRef.current!;
        audio.startMusic(beatToSec(clamped / TPB, bpm, musicOffsetSec));
        playStartPerfRef.current = performance.now();
        playStartTickRef.current = clamped;
        lastProcessedTickRef.current = clamped - 1;
        lastProcessedBeatRef.current = Math.floor(clamped / TPB) - 1;
      }
    },
    [isPlaying, bpm, musicOffsetSec]
  );

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
      if (newIds.length) setSelectedEventId(newIds[newIds.length - 1]);
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
    [commitTimeline, cueSfxOn]
  );

  const handleInsertSwitch = useCallback(
    (game: GameId, cut: boolean) => {
      const id = nextEventId('sw');
      commitTimeline((tl) => {
        tl.events.push({
          id,
          tick: currentTick,
          op: 'switch',
          game,
          style: cut ? -1 : 0,
          sub: 2,
        });
        return tl;
      });
      setSelectedEventId(id);
    },
    [commitTimeline, currentTick]
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
    setSelectedEventId(id);
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
      setSelectedEventId(id);
    },
    [commitTimeline, currentTick, showToast]
  );

  const handleMoveEvent = useCallback(
    (id: string, newTick: number) => {
      setTimeline((prev) => {
        const next = cloneTimeline(prev);
        const ev = next.events.find((e) => e.id === id);
        if (ev) ev.tick = Math.max(0, Math.round(newTick));
        next.events.sort((a, b) => a.tick - b.tick);
        return next;
      });
    },
    []
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

  const handleDeleteEvent = useCallback(
    (id: string) => {
      commitTimeline((tl) => {
        tl.events = tl.events.filter((e) => e.id !== id);
        return tl;
      });
      if (selectedEventId === id) setSelectedEventId(null);
    },
    [commitTimeline, selectedEventId]
  );

  const handleDuplicateEvent = useCallback(
    (id: string) => {
      const orig = timeline.events.find((e) => e.id === id);
      if (!orig) return;
      const copyId = nextEventId('dup');
      commitTimeline((tl) => {
        tl.events.push({
          ...orig,
          id: copyId,
          tick: orig.tick + TPB,
          args: orig.args ? ([...orig.args] as [number, number, number, number]) : undefined,
        });
        return tl;
      });
      setSelectedEventId(copyId);
    },
    [commitTimeline, timeline.events]
  );

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

  // Universal File Import (.gtf, .gtl, .rhref, .rhre3, .groove, audio)
  const handleImportFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith('.gtf')) {
          const text = await file.text();
          const tl = compileGtf(text, file.name);
          commitTimeline(() => tl);
          setCurrentTick(0);
          showToast(`Imported ${file.name} (${tl.events.length} events)`);
        } else if (lower.endsWith('.gtl')) {
          const text = await file.text();
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
          }
          setCurrentTick(0);
          showToast(`Loaded .groove package: ${pkg.timeline.title || file.name}`);
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

  const handleExportGroove = useCallback(async () => {
    try {
      const blob = await exportGroovePackage({
        timeline,
        bpm,
        musicOffsetSec,
        musicFile,
        prologueImage,
        sprites,
      });
      const slug = (timeline.title || 'remix_21').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      triggerDownload(`${slug}.groove`, blob, 'application/zip');
      showToast(`Exported ${slug}.groove bundle`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [timeline, bpm, musicOffsetSec, musicFile, prologueImage, sprites, showToast]);

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

  // Keyboard shortcuts
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEventId) {
        e.preventDefault();
        handleDeleteEvent(selectedEventId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, handleUndo, handleRedo, selectedEventId, handleDeleteEvent]);

  const validation = useMemo(() => validateTimeline(timeline), [timeline]);
  const selectedEvent = useMemo(
    () => timeline.events.find((e) => e.id === selectedEventId) ?? null,
    [timeline.events, selectedEventId]
  );

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
        onExportGroove={handleExportGroove}
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
      />

      {/* Main Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {activeTab === 'timeline' && (
          <>
            {/* Desktop Left Sidebar: 24-Game Cue Library */}
            <div className={`${mobilePane === 'cues' ? 'flex w-full lg:w-72' : 'hidden lg:flex lg:w-72'} shrink-0 h-full`}>
              <CueLibrary
                selectedGame={selectedGame}
                onSelectGame={setSelectedGame}
                onInsertCue={(cue, withSwitch) => {
                  insertCueAtTick(cue, currentTick, withSwitch);
                  setMobilePane('timeline');
                }}
                onInsertSwitch={handleInsertSwitch}
                onInsertFade={handleInsertFade}
                onInsertAnim={(g) => handleInsertAnim(g, sprites[g]?.defaultAnim || 'Remix8')}
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
                onDragStartCue={setDraggedCue}
              />
            </div>

            {/* Center Timeline Canvas */}
            <div className={`${mobilePane === 'timeline' ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0 h-full`}>
              {/* Compact stage strip on mobile timeline */}
              <div className="lg:hidden">
                <StagePreview
                  timeline={timeline}
                  currentTick={currentTick}
                  sprites={sprites}
                  prologueImageDataUrl={prologueImage?.dataUrl}
                  onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                  compact
                />
              </div>

              <TimelineEditor
                timeline={timeline}
                currentTick={currentTick}
                bpm={bpm}
                musicOffsetSec={musicOffsetSec}
                musicDurationSec={musicDurationSec}
                waveformPeaks={waveformPeaks}
                zoomPxPerBeat={zoomPxPerBeat}
                snapDenominator={snapDenominator}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
                onSeekTick={handleSeekTick}
                onMoveEvent={handleMoveEvent}
                onResizeEvent={handleResizeEvent}
                onDropNewCue={(cue, tick) => insertCueAtTick(cue, tick, false)}
                draggedCue={draggedCue}
              />
            </div>

            {/* Right Sidebar: Live Stage + Inspector */}
            <div
              className={`${
                mobilePane === 'inspector' ? 'flex w-full lg:w-[340px]' : 'hidden lg:flex lg:w-[340px]'
              } flex-col border-l border-white/10 shrink-0 h-full overflow-hidden`}
            >
              <div className="hidden lg:block shrink-0">
                <StagePreview
                  timeline={timeline}
                  currentTick={currentTick}
                  sprites={sprites}
                  prologueImageDataUrl={prologueImage?.dataUrl}
                  onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                  compact
                />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <InspectorPanel
                  timeline={timeline}
                  selectedEvent={selectedEvent}
                  validation={validation}
                  onUpdateTimeline={(patch) => commitTimeline((tl) => ({ ...tl, ...patch }))}
                  onUpdateEvent={(id, patch) =>
                    commitTimeline((tl) => {
                      const ev = tl.events.find((e) => e.id === id);
                      if (ev) Object.assign(ev, patch);
                      return tl;
                    })
                  }
                  onDeleteEvent={handleDeleteEvent}
                  onDuplicateEvent={handleDuplicateEvent}
                  onSeekTick={handleSeekTick}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'stage' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0E1117]">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <StagePreview
                  timeline={timeline}
                  currentTick={currentTick}
                  sprites={sprites}
                  prologueImageDataUrl={prologueImage?.dataUrl}
                  onPlayJingle={(code) => audioRef.current?.playJinglePreview(code)}
                />
              </div>
              <div className="rounded-xl border border-white/10 bg-[#141922] p-4">
                <InspectorPanel
                  timeline={timeline}
                  selectedEvent={selectedEvent}
                  validation={validation}
                  onUpdateTimeline={(patch) => commitTimeline((tl) => ({ ...tl, ...patch }))}
                  onUpdateEvent={(id, patch) =>
                    commitTimeline((tl) => {
                      const ev = tl.events.find((e) => e.id === id);
                      if (ev) Object.assign(ev, patch);
                      return tl;
                    })
                  }
                  onDeleteEvent={handleDeleteEvent}
                  onDuplicateEvent={handleDuplicateEvent}
                  onSeekTick={handleSeekTick}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'customize' && (
          <CustomizationStudio
            timeline={timeline}
            currentTick={currentTick}
            bpm={bpm}
            musicOffsetSec={musicOffsetSec}
            musicName={musicFile?.name ?? null}
            musicVolume={musicVolume}
            sfxVolume={sfxVolume}
            sprites={sprites}
            prologueImage={prologueImage}
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
            onExportGroove={handleExportGroove}
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
          onClick={() => setActiveTab('customize')}
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
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
