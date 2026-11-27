import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, AlertCircle, RefreshCw } from 'lucide-react';
import {
  compileGtf,
  decompileToGtf,
  emitGtl,
  GtfError,
  parseGtl,
  Timeline,
} from '../engine/gtfEngine.ts';

interface CodeStudioProps {
  timeline: Timeline;
  onApplyTimeline: (tl: Timeline) => void;
  onDownloadGtf: () => void;
  onDownloadGtl: () => void;
}

export const CodeStudio: React.FC<CodeStudioProps> = ({
  timeline,
  onApplyTimeline,
  onDownloadGtf,
  onDownloadGtl,
}) => {
  const [mode, setMode] = useState<'gtf' | 'gtl'>('gtf');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError(null);
    if (mode === 'gtf') {
      setText(decompileToGtf(timeline, timeline.title || 'Groove Builder'));
    } else {
      setText(emitGtl(timeline, timeline.title || 'Groove Builder'));
    }
  }, [timeline, mode]);

  const handleApply = () => {
    try {
      const next = mode === 'gtf' ? compileGtf(text, 'multi.gtf') : parseGtl(text, 'multi.gtl');
      setError(null);
      onApplyTimeline(next);
    } catch (e) {
      setError(e instanceof GtfError || e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0E1117] p-4 md:p-6 overflow-hidden">
      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col rounded-xl border border-white/10 bg-[#141922] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-[#161B24]">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0E1117]">
            <button
              type="button"
              onClick={() => setMode('gtf')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'gtf' ? 'bg-[#FF5A36] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              multi.gtf (Groove Tickflow)
            </button>
            <button
              type="button"
              onClick={() => setMode('gtl')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'gtl' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              multi.gtl (GTLM 1)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Apply to Timeline
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-slate-200"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={mode === 'gtf' ? onDownloadGtf : onDownloadGtl}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-xs font-medium text-white"
            >
              <Download className="w-3.5 h-3.5 text-[#FF5A36]" />
              Download .{mode}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-mono">{error}</span>
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full p-4 bg-[#0B0E14] font-mono text-xs leading-relaxed text-slate-200 resize-none focus:outline-none"
        />

        <div className="px-4 py-2.5 border-t border-white/10 bg-[#161B24] text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>
            Switch SD order (Groove Engine v0.5.0): sd:/groove/multi.gtf · sd:/groove/stages/multi/multi.gtf · sd:/groove/multi.gtl
          </span>
          <span className="font-mono tabular-nums">480 ticks = 1 beat</span>
        </div>
      </div>
    </div>
  );
};
