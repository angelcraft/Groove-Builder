import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  Cloud,
  Download,
  FileCode2,
  Folder,
  LogOut,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  DEFAULT_DRIVE_FOLDER_NAME,
  downloadDriveFileBytes,
  type DriveItem,
  type DriveUserSummary,
  findDriveFolderByName,
  getDriveAccessToken,
  initDriveAuth,
  isDriveAuthConfigured,
  listDriveFolderChildren,
  searchDriveItemsByName,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from '../engine/driveConnector.ts';
import {
  MAX_LOCAL_ASSET_BYTES,
  MAX_VAULT_IMPORT_BATCH_BYTES,
  MAX_VAULT_IMPORT_FILES,
} from '../engine/localAssetVault.ts';

interface DriveAssetBrowserProps {
  disabled?: boolean;
  onImportFiles: (files: File[]) => Promise<void>;
  onNotify: (msg: string, kind?: 'info' | 'error') => void;
}

interface Crumb {
  id: string;
  name: string;
}

function formatDriveBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function makeFileWithRelPath(bytes: Uint8Array, name: string, mimeType: string, relPath: string): File {
  const safeBuf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(safeBuf).set(bytes);
  const file = new File([safeBuf], name, { type: mimeType || 'application/octet-stream' });
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relPath,
      configurable: true,
    });
  } catch {
    // fallback if environment forbids redefining webkitRelativePath
  }
  return file;
}

export const DriveAssetBrowser: React.FC<DriveAssetBrowserProps> = ({
  disabled = false,
  onImportFiles,
  onNotify,
}) => {
  const driveConfigured = isDriveAuthConfigured();
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<DriveUserSummary | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [folderQuery, setFolderQuery] = useState(DEFAULT_DRIVE_FOLDER_NAME);
  const [fileSearch, setFileSearch] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = initDriveAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  const openFolderByName = async (targetName: string, tokenOverride?: string) => {
    const token = tokenOverride ?? getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const folder = await findDriveFolderByName(targetName, token);
      if (!folder) {
        setBreadcrumbs([]);
        setItems([]);
        setStatusMessage(`Folder "${targetName}" not found in Google Drive. Try searching below.`);
        return;
      }
      const children = await listDriveFolderChildren(folder.id, token);
      setBreadcrumbs([{ id: folder.id, name: folder.name }]);
      setItems(children);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed reading Google Drive folder.';
      if (/expired/i.test(msg)) setNeedsAuth(true);
      setStatusMessage(msg);
      onNotify(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const openSubfolder = async (folder: DriveItem) => {
    const token = getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const children = await listDriveFolderChildren(folder.id, token);
      setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
      setItems(children);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed opening subfolder.';
      if (/expired/i.test(msg)) setNeedsAuth(true);
      onNotify(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateBreadcrumb = async (index: number) => {
    const token = getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const target = breadcrumbs[index];
    if (!target) return;
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const children = await listDriveFolderChildren(target.id, token);
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
      setItems(children);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed navigating Drive folder.';
      if (/expired/i.test(msg)) setNeedsAuth(true);
      onNotify(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const runSearch = async (query: string) => {
    const token = getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const found = await searchDriveItemsByName(trimmed, token);
      setItems(found);
      setStatusMessage(
        found.length > 0
          ? `Found ${found.length} Google Drive match(es) for "${trimmed}".`
          : `No Google Drive items matched "${trimmed}".`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Drive search failed.';
      if (/expired/i.test(msg)) setNeedsAuth(true);
      onNotify(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const res = await signInWithGoogleDrive();
      setUser(res.user);
      setNeedsAuth(false);
      await openFolderByName(folderQuery || DEFAULT_DRIVE_FOLDER_NAME, res.accessToken);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.',
        'error'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGoogleDrive();
    setUser(null);
    setNeedsAuth(true);
    setBreadcrumbs([]);
    setItems([]);
    setStatusMessage(null);
  };

  const importDriveItems = async (targets: DriveItem[]) => {
    const token = getDriveAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const downloadable = targets.filter((t) => !t.isFolder);
    if (downloadable.length === 0) {
      onNotify('No files in this folder to import. Open a subfolder first.', 'error');
      return;
    }

    const capped = downloadable.slice(0, MAX_VAULT_IMPORT_FILES);
    let cumulative = 0;
    const withinBudget: DriveItem[] = [];
    for (const f of capped) {
      if (f.sizeBytes > MAX_LOCAL_ASSET_BYTES) continue;
      if (cumulative + f.sizeBytes > MAX_VAULT_IMPORT_BATCH_BYTES) break;
      cumulative += f.sizeBytes;
      withinBudget.push(f);
    }

    if (withinBudget.length === 0) {
      onNotify('Selected Drive files exceed the 48 MiB per-batch local vault limit.', 'error');
      return;
    }

    setIsDownloading(true);
    try {
      const pathPrefix = breadcrumbs.map((b) => b.name).join('/');
      const files: File[] = [];
      for (const item of withinBudget) {
        const bytes = await downloadDriveFileBytes(item, token, MAX_LOCAL_ASSET_BYTES);
        const relPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;
        files.push(makeFileWithRelPath(bytes, item.name, item.mimeType, relPath));
      }
      await onImportFiles(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed importing Drive files.';
      if (/expired/i.test(msg)) setNeedsAuth(true);
      onNotify(msg, 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const currentFilesCount = items.filter((i) => !i.isFolder).length;

  return (
    <section className="rounded-xl border border-white/10 bg-[#141922] p-5 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
            <h2 className="font-display text-sm font-bold text-white">
              Google Drive Import ({DEFAULT_DRIVE_FOLDER_NAME})
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Read-only access to your Google Drive folder. Selected{' '}
            <span className="font-mono text-slate-300">.bntx / .bflyt / .bflan / .bfres / .png / .wav</span>{' '}
            files are copied straight into device-local IndexedDB—never modified on Drive and never published.
          </p>
          {!driveConfigured && (
            <p className="text-[11px] text-amber-300/90 leading-snug pt-0.5">
              Standalone build: set <span className="font-mono">VITE_GOOGLE_OAUTH_CLIENT_ID</span> in <span className="font-mono">.env.local</span> to enable Google Drive sign-in.
            </p>
          )}
        </div>

        {needsAuth ? (
          <button
            type="button"
            disabled={isSigningIn || disabled}
            onClick={() => void handleSignIn()}
            className="inline-flex items-center gap-2.5 h-10 px-4 rounded-lg bg-white hover:bg-slate-100 text-[#1F1F1F] border border-slate-300 text-xs font-semibold shadow-sm transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
              <path fill="none" d="M0 0h48v48H0z" />
            </svg>
            <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-slate-300 font-mono truncate max-w-[180px]">
              {user?.email ?? 'Google Drive Connected'}
            </span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-white/10 bg-[#1B2230] hover:bg-[#252E40] text-[11px] font-medium text-slate-200"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
        )}
      </div>

      {!needsAuth && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={folderQuery}
              onChange={(e) => setFolderQuery(e.target.value)}
              placeholder="Folder name (e.g. RhythmGrooveDecompiled)"
              className="h-9 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white flex-1 min-w-[180px]"
            />
            <button
              type="button"
              disabled={isLoading || isDownloading}
              onClick={() => void openFolderByName(folderQuery)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#1B2230] hover:bg-[#252E40] border border-white/10 text-xs font-medium text-white whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Open Folder
            </button>
            <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
              <input
                type="search"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch(fileSearch);
                }}
                placeholder="Search file (e.g. ring, hoop, bntx)..."
                className="h-9 px-3 rounded-lg border border-white/10 bg-[#0E1117] text-xs text-white flex-1 min-w-0"
              />
              <button
                type="button"
                disabled={isLoading || !fileSearch.trim()}
                onClick={() => void runSearch(fileSearch)}
                className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-[#1B2230] hover:bg-[#252E40] disabled:opacity-40 border border-white/10 text-xs text-slate-200 whitespace-nowrap"
              >
                <Search className="w-3.5 h-3.5" />
                Find
              </button>
            </div>
            <button
              type="button"
              disabled={isLoading || isDownloading}
              onClick={() => {
                setFileSearch('ring');
                void runSearch('ring');
              }}
              className="h-9 px-3 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-xs font-medium text-sky-300 whitespace-nowrap"
            >
              Quick Find: RING
            </button>
          </div>

          {breadcrumbs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-[#0E1117] border border-white/10 rounded-lg px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-1 text-slate-300 min-w-0">
                {breadcrumbs.map((b, i) => (
                  <React.Fragment key={b.id}>
                    {i > 0 && <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                    <button
                      type="button"
                      onClick={() => void navigateBreadcrumb(i)}
                      className="hover:text-white font-mono truncate max-w-[180px]"
                    >
                      {b.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              {currentFilesCount > 0 && (
                <button
                  type="button"
                  disabled={isDownloading || disabled}
                  onClick={() => void importDriveItems(items)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#FF5A36] hover:bg-[#FF6E4E] disabled:opacity-50 text-[11px] font-semibold text-white whitespace-nowrap shrink-0"
                >
                  <Download className="w-3 h-3" />
                  {isDownloading
                    ? 'Importing...'
                    : `Import Folder Files (${Math.min(currentFilesCount, MAX_VAULT_IMPORT_FILES)})`}
                </button>
              )}
            </div>
          )}

          {statusMessage && (
            <div className="text-[11px] text-slate-300 bg-[#0E1117] border border-white/10 rounded-lg px-3 py-2">
              {statusMessage}
            </div>
          )}

          {items.length > 0 && (
            <div className="max-h-56 overflow-y-auto divide-y divide-white/5 border border-white/10 rounded-lg bg-[#0E1117]">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-white/[0.03]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (item.isFolder) void openSubfolder(item);
                    }}
                    className={`flex items-center gap-2 min-w-0 flex-1 text-left ${
                      item.isFolder ? 'cursor-pointer text-sky-300 hover:text-sky-200' : 'cursor-default text-slate-200'
                    }`}
                  >
                    {item.isFolder ? (
                      <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <FileCode2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className="font-mono truncate">{item.name}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {!item.isFolder && item.sizeBytes > 0 && (
                      <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {formatDriveBytes(item.sizeBytes)}
                      </span>
                    )}
                    {item.isFolder ? (
                      <button
                        type="button"
                        onClick={() => void openSubfolder(item)}
                        className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] text-[10px] font-medium text-slate-200"
                      >
                        Open
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isDownloading || disabled}
                        onClick={() => void importDriveItems([item])}
                        className="px-2 py-1 rounded bg-[#1B2230] hover:bg-[#252E40] disabled:opacity-40 text-[10px] font-medium text-emerald-300"
                      >
                        Import
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
