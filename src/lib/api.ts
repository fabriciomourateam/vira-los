const BASE = (import.meta.env.VITE_API_URL as string) || '';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get:    <T>(path: string)                  => req<T>('GET',    path),
  post:   <T>(path: string, body?: unknown)  => req<T>('POST',   path, body),
  patch:  <T>(path: string, body?: unknown)  => req<T>('PATCH',  path, body),
  delete: <T>(path: string)                  => req<T>('DELETE', path),
  upload: <T>(path: string, form: FormData)  => req<T>('POST',   path, form),
};

export function uploadsUrl(filename: string): string {
  return `${BASE}/uploads/${filename}`;
}

export async function checkBackend(): Promise<boolean> {
  try {
    await fetch(`${BASE}/api/health`);
    return true;
  } catch {
    return false;
  }
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ContentItem {
  id: string;
  title: string;
  type: 'video' | 'carousel';
  file_path: string;
  thumbnail: string | null;
  caption: string;
  hashtags: string;
  created_at: string;
}

export interface RepeatRule {
  type: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  end_date?: string | null;
}

export interface Schedule {
  id: string;
  content_item_id: string;
  content_title: string;
  content_type: 'video' | 'carousel';
  thumbnail: string | null;
  file_path: string;
  platforms: string; // JSON string
  caption: string;
  hashtags: string;
  scheduled_for: string;
  repeat_rule: string; // JSON string or 'none'
  status: 'pending' | 'posting' | 'done' | 'partial' | 'failed' | 'cancelled';
  error_message: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface PlatformStatus {
  connected: boolean;
  username: string | null;
  expires_at: string | null;
}

export interface PlatformsStatus {
  instagram: PlatformStatus;
  tiktok: PlatformStatus;
  youtube: PlatformStatus;
}

export interface ViralReference {
  id: string;
  url: string;
  title: string;
  platform: string;
  format: string;
  notes: string;
  hook: string;
  tags: string; // JSON
  saved_at: string;
}

export interface HookTemplate {
  id: string;
  text: string;
  category: string;
  use_count: number;
  created_at: string;
}

export interface ContentIdea {
  id: string;
  title: string;
  body: string;
  status: 'idea' | 'in_progress' | 'done';
  tags: string; // JSON
  created_at: string;
}
