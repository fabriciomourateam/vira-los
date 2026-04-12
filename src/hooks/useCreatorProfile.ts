import { useState, useEffect } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CreatorProfile {
  handle: string;        // @seucanal
  niche: string;         // ex: fitness, hormônios
  audience: string;      // ex: "homens 25-45 que treinam"
  toneKeywords: string[]; // ex: ["direto", "técnico", "sem rodeios"]
  expressions: string;   // frases e expressões típicas que usa
  exampleCopy: string;   // exemplo de copy/legenda que escreveu antes
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'viralOS-creator-profile';

const DEFAULT_PROFILE: CreatorProfile = {
  handle: '',
  niche: '',
  audience: '',
  toneKeywords: [],
  expressions: '',
  exampleCopy: '',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

function loadFromStorage(): CreatorProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw);
    // Garante que campos ausentes recebem valores padrão
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function useCreatorProfile(): [
  CreatorProfile,
  (profile: CreatorProfile) => void,
  boolean,
] {
  const [profile, setProfileState] = useState<CreatorProfile>(loadFromStorage);

  // Sincroniza quando outra aba atualiza o localStorage
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setProfileState(loadFromStorage());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function setProfile(newProfile: CreatorProfile) {
    setProfileState(newProfile);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
  }

  const isConfigured = !!(profile.niche && profile.handle);

  return [profile, setProfile, isConfigured];
}
