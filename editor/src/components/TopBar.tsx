import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Download, FolderOpen, FileCode2, Layers, Package } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton.tsx';

export type WorkspaceTab = 'timeline' | 'stage' | 'vault' | 'customize' | 'code';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onImportClick: () => void;
  onExportGtf: () => void;
  onExportGtl: () => void;
  onExportGrooveEditor: () => void;
  onExportGrooveRuntime: () => void;
  hasSourceZip: boolean;
  onDownloadSourceZip: () => void;
  onLoadTemplate: (key: 'ejemplo' | 'showcase') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  onImportClick,
  onExportGtf,
  onExportGtl,
  onExportGrooveEditor,
  onExportGrooveRuntime,
  hasSourceZip,
  onDownloadSourceZip,
  onLoadTemplate,
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const navItems: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'stage', label: 'Stage & Intro' },
    { id: 'vault', label: 'Local Vault' },
    { id: 'customize', label: 'Sprites & .groove' },
    { id: 'code', label: 'GTF / GTL' },
  ];

  return (
    <header className="flex items-center justify-between gap-4 md:gap-8 px-4 md:px-6 h-14 border-b border-white/10 bg-[#0E1117] shrink-0">
      {/* Zone 1: Brand Title */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onTabChange('timeline');
        }}
        className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
      >
        Groove Builder
      </a>

      {/* Zone 2: Primary Navigation Tabs */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                active
                  ? 'border-[#FF5A36] text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onImportClick}
          className="py-1.5 text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          Import
        </button>
      </nav>

      {/* Zone 3: Primary Action + Install */}
      <div className="flex items-center gap-2 shrink-0" ref={menuRef}>
        <PWAInstallButton />
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#FF5A36] hover:bg-[#FF6E4E] px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5" />
            Export
            <ChevronDown className="w-3.5 h-3.5 opacity-80" />
          </button>

          {exportOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-white/10 bg-[#161B24] py-1.5 shadow-2xl z-50">
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExportGtf();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-white/5"
              >
                <FileCode2 className="w-4 h-4 text-[#FF5A36]" />
                <div>
                  <div className="font-semibold">Export multi.gtf</div>
                  <div className="text-[11px] text-slate-400">Groove Engine v0.5.0 native</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExportGtl();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-white/5"
              >
                <Layers className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold">Export multi.gtl</div>
                  <div className="text-[11px] text-slate-400">Compiled GTLM 1 format</div>
                </div>
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExportGrooveEditor();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-white/5"
              >
                <Package className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold">Export Authoring .groove</div>
                  <div className="text-[11px] text-slate-400">Preview bundle (audio, sprites, project)</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExportGrooveRuntime();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-white/5"
              >
                <Package className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold">Export Runtime .groove (Draft 0.3)</div>
                  <div className="text-[11px] text-slate-400">Multi · 2-file GE-155 compatible package</div>
                </div>
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onImportClick();
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
              >
                <FolderOpen className="w-4 h-4 text-slate-400" />
                Import .gtf / .gtl / .rhref / .groove
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onLoadTemplate('ejemplo');
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
              >
                <span>Load Official ejemplo.gtf</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onLoadTemplate('showcase');
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
              >
                <span>Load 24-Game Showcase</span>
              </button>
              {hasSourceZip && (
                <>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      setExportOpen(false);
                      onDownloadSourceZip();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-white/5"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="font-semibold">Download Source (.zip)</div>
                      <div className="text-[11px] text-slate-400">Clean GE-153 repo bundle</div>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
