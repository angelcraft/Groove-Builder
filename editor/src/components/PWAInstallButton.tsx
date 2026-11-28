import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#1B2230] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-[#252E40] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        title="Install Groove Builder on Windows or Android"
      >
        <Download className="w-3.5 h-3.5" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#1B2230] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-[#252E40] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="w-3.5 h-3.5" />
          Install
        </button>
        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#161B24] p-6 shadow-xl">
              <h3 className="text-base font-semibold text-white">Install Groove Builder</h3>
              <p className="mt-2 text-sm text-slate-300">
                1. Tap Share in your browser toolbar.
                <br />
                2. Choose Add to Home Screen for offline studio mode.
              </p>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#FF5A36] py-2.5 text-sm font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
