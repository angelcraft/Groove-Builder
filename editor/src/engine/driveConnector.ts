// Strictly read-only Google Drive scope (never requests write/delete permissions)
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

export const DEFAULT_DRIVE_FOLDER_NAME = 'RhythmGrooveDecompiled';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveAuthMode = 'google_gis_env' | 'unconfigured';

export interface DriveUserSummary {
  email: string | null;
  displayName: string | null;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isFolder: boolean;
  modifiedTime?: string;
}

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleGisWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          include_granted_scopes: boolean;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GisTokenClient;
        revoke?: (token: string, done?: () => void) => void;
      };
    };
  };
}

function readViteEnv(key: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const val = env?.[key];
  return typeof val === 'string' ? val.trim() : '';
}

export function resolveDriveAuthConfig(): {mode: DriveAuthMode; gisClientId: string | null} {
  const gisClientId = readViteEnv('VITE_GOOGLE_OAUTH_CLIENT_ID') || null;
  return {mode: gisClientId ? 'google_gis_env' : 'unconfigured', gisClientId};
}

const resolvedAuthConfig = resolveDriveAuthConfig();

export function getDriveAuthMode(): DriveAuthMode {
  return resolvedAuthConfig.mode;
}

export function isDriveAuthConfigured(): boolean {
  return resolvedAuthConfig.mode !== 'unconfigured';
}

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUserSummary: DriveUserSummary | null = null;

function loadGoogleGisScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Google Identity Services requires a browser environment.'));
  }
  const win = window as GoogleGisWindow;
  if (win.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed loading Google Identity Services script.')),
        { once: true }
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed loading Google Identity Services script.'));
    };
    document.head.appendChild(script);
  });
}

async function signInWithStandaloneGis(
  clientId: string
): Promise<{ user: DriveUserSummary; accessToken: string }> {
  await loadGoogleGisScript();
  const win = window as GoogleGisWindow;
  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    throw new Error('Google Identity Services client did not initialize.');
  }
  const token = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      include_granted_scopes: false,
      scope: SCOPES.join(' '),
      callback: (resp: GisTokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description || resp.error || 'Google Drive sign-in was cancelled or denied.'
            )
          );
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Google sign-in popup was blocked or closed.'));
      },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  cachedAccessToken = token;
  cachedUserSummary = { email: 'Google Drive (Read-only)', displayName: 'Google Account' };
  return { user: cachedUserSummary, accessToken: token };
}

export function initDriveAuth(
  onAuthSuccess?: (user: DriveUserSummary, token: string) => void,
  onAuthFailure?: () => void
): () => void {
  if (cachedAccessToken && cachedUserSummary) onAuthSuccess?.(cachedUserSummary, cachedAccessToken);
  else onAuthFailure?.();
  if (isDriveAuthConfigured()) void loadGoogleGisScript().catch(() => {});
  return () => {};
}

export async function signInWithGoogleDrive(): Promise<{user: DriveUserSummary; accessToken: string}> {
  const {gisClientId} = resolvedAuthConfig;
  if (!gisClientId) throw new Error('Set VITE_GOOGLE_OAUTH_CLIENT_ID or import from disk.');
  return signInWithStandaloneGis(gisClientId);
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  const tokenToRevoke = cachedAccessToken;
  cachedAccessToken = null;
  cachedUserSummary = null;
  if (tokenToRevoke && typeof window !== 'undefined') {
    const win = window as GoogleGisWindow;
    win.google?.accounts?.oauth2?.revoke?.(tokenToRevoke);
  }
}

export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function assertValidDriveId(id: string): string {
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(id)) {
    throw new Error(`Invalid Google Drive file identifier: ${id}`);
  }
  return id;
}

async function driveJsonFetch<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please sign in again.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Google Drive API error (${res.status}): ${errText.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

interface DriveListResponse {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
  }>;
}

function mapDriveFiles(data: DriveListResponse): DriveItem[] {
  const list = data.files ?? [];
  const items: DriveItem[] = [];
  for (const f of list) {
    if (!f.id || !f.name || !f.mimeType) continue;
    items.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.size ? Number(f.size) || 0 : 0,
      isFolder: f.mimeType === DRIVE_FOLDER_MIME,
      modifiedTime: f.modifiedTime,
    });
  }
  items.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export async function findDriveFolderByName(
  folderName: string,
  accessToken: string
): Promise<DriveItem | null> {
  const safeName = escapeDriveQueryLiteral(folderName.trim());
  if (!safeName) return null;
  const q = `name = '${safeName}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,modifiedTime)',
    pageSize: '10',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  const data = await driveJsonFetch<DriveListResponse>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  const folders = mapDriveFiles(data);
  return folders[0] ?? null;
}

export async function listDriveFolderChildren(
  folderId: string,
  accessToken: string,
  pageSize = 100
): Promise<DriveItem[]> {
  const safeId = assertValidDriveId(folderId);
  const q = `'${safeId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    pageSize: String(Math.min(200, Math.max(1, pageSize))),
    orderBy: 'folder,name',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  const data = await driveJsonFetch<DriveListResponse>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  return mapDriveFiles(data);
}

export async function searchDriveItemsByName(
  query: string,
  accessToken: string,
  pageSize = 60
): Promise<DriveItem[]> {
  const safeQ = escapeDriveQueryLiteral(query.trim());
  if (!safeQ) return [];
  const q = `name contains '${safeQ}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    pageSize: String(Math.min(100, Math.max(1, pageSize))),
    orderBy: 'folder,name',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  const data = await driveJsonFetch<DriveListResponse>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  return mapDriveFiles(data);
}

export async function downloadDriveFileBytes(
  item: DriveItem,
  accessToken: string,
  maxBytes: number
): Promise<Uint8Array> {
  const safeId = assertValidDriveId(item.id);
  if (item.sizeBytes > maxBytes) {
    throw new Error(
      `Drive file '${item.name}' (${item.sizeBytes} B) exceeds ${maxBytes} B local vault limit.`
    );
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(safeId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please sign in again.');
  }
  if (!res.ok) {
    throw new Error(`Failed downloading '${item.name}' from Google Drive (${res.status}).`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > maxBytes) {
    throw new Error(
      `Downloaded file '${item.name}' size (${buf.byteLength} B) is outside safe bounds (1..${maxBytes} B).`
    );
  }
  return new Uint8Array(buf);
}
