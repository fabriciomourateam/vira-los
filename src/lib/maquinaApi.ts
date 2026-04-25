/**
 * maquinaApi.ts
 * Wrapper das chamadas REST para /api/maquina/* e /api/pexels.
 */

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type MaquinaTemplate = 'brandsdecoded' | 'fmteam';

export interface MaquinaBriefing {
  tema: string;
  nicho?: string;
  marca?: string;
  handle?: string;
  cor?: string;
  estilo?: 'classico' | 'moderno' | 'minimalista' | 'bold' | string;
  tipo?: 'tendencia' | 'tese' | 'case' | 'previsao' | string;
  cta?: string;
  slides?: 5 | 7 | 9 | 12 | number;
  imagensPedidas?: number;
  template?: MaquinaTemplate;
}

export interface MaquinaCarrossel {
  id: string;
  briefing: MaquinaBriefing;
  headlines: string[] | string;
  headlineEscolhida: string | null;
  estrutura: string | null;
  html: string | null;
  legenda: string | null;
  status: 'draft' | 'approved' | 'rendered';
  title: string;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaquinaCheck {
  anthropic: boolean;
  pexels: boolean;
  model: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `${path} retornou ${res.status}`);
  return data as T;
}

export const maquinaApi = {
  check: async (): Promise<MaquinaCheck> => {
    const res = await fetch(`${API}/api/maquina/check`);
    return res.json();
  },

  headlines: (tema: string, nicho?: string, brandKitId?: string, template?: MaquinaTemplate) =>
    postJson<{ headlines: string }>('/api/maquina/headlines', { tema, nicho, brandKitId, template }),

  structure: (headline: string, tema: string, conversationHistory: unknown[] = [], template?: MaquinaTemplate) =>
    postJson<{ structure: string }>('/api/maquina/structure', { headline, tema, conversationHistory, template }),

  generate: (params: {
    tema: string;
    headline: string;
    cta?: string;
    slides?: number;
    nicho?: string;
    brandKitId?: string;
    conversationHistory?: unknown[];
    template?: MaquinaTemplate;
  }) => postJson<{ html: string }>('/api/maquina/generate', params),

  full: (params: {
    tema: string;
    headlineIndex?: number;
    cta?: string;
    slides?: number;
    nicho?: string;
    brandKitId?: string;
  }) => postJson<{ headline: string; structure: string; html: string; headlines: string }>('/api/maquina/full', params),

  // CRUD do histórico
  list: async (): Promise<MaquinaCarrossel[]> => {
    const res = await fetch(`${API}/api/maquina/carrosseis`);
    const data = await res.json();
    return data.carrosseis || [];
  },
  get: async (id: string): Promise<MaquinaCarrossel | null> => {
    const res = await fetch(`${API}/api/maquina/carrosseis/${id}`);
    if (!res.ok) return null;
    return res.json();
  },
  save: (item: Partial<MaquinaCarrossel>) =>
    postJson<MaquinaCarrossel>('/api/maquina/carrosseis', item),
  patch: async (id: string, data: Partial<MaquinaCarrossel>) => {
    const res = await fetch(`${API}/api/maquina/carrosseis/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  remove: async (id: string) => {
    await fetch(`${API}/api/maquina/carrosseis/${id}`, { method: 'DELETE' });
  },
};

export interface PexelsPhoto {
  id: number;
  url: string;
  thumb: string;
  alt: string;
  photographer: string;
}

export const pexelsApi = {
  search: async (query: string, orientation: 'portrait' | 'landscape' | 'square' = 'portrait', perPage = 5): Promise<{ url: string | null; photos: PexelsPhoto[] }> => {
    const params = new URLSearchParams({ query, orientation, per_page: String(perPage) });
    const res = await fetch(`${API}/api/pexels?${params}`);
    return res.json();
  },
  batch: async (
    queries: { id: string; query: string; orientation?: string }[]
  ): Promise<{ results: Record<string, { url: string; thumb: string; photographer: string } | null> }> => {
    const res = await fetch(`${API}/api/pexels/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    return res.json();
  },
};
