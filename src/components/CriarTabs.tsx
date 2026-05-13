/**
 * CriarTabs.tsx
 * Wrapper com 2 subtabs dentro da aba "Criar":
 *   - Básico: <CarrosselInstagram /> (gerador de carrosseis)
 *   - Reels:  <ReelsGerador /> (converte carrosseis salvos em roteiros de Reels)
 */

import React, { useState, useEffect } from 'react';
import { Layers, Video } from 'lucide-react';
import CarrosselInstagram from './CarrosselInstagram';
import ReelsGerador from './ReelsGerador';

type SubTabId = 'basico' | 'reels';

interface CriarTabsProps {
  prefillScript?: string;
  prefillTopic?: string;
  initialReelsCarouselId?: string | null;
  onClearReelsCarouselId?: () => void;
}

function SubTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: SubTabId; label: string; icon: React.ComponentType<any> }[];
  active: SubTabId;
  onChange: (id: SubTabId) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-4">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all ${
            active === id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon size={13} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default function CriarTabs({
  prefillScript,
  prefillTopic,
  initialReelsCarouselId,
  onClearReelsCarouselId,
}: CriarTabsProps) {
  const [subTab, setSubTab] = useState<SubTabId>(initialReelsCarouselId ? 'reels' : 'basico');
  const [internalReelsCarouselId, setInternalReelsCarouselId] = useState<string | null>(null);

  // Quando vem um carouselId de fora (botão "Gerar Reels" via deep-link), abre direto a Reels
  useEffect(() => {
    if (initialReelsCarouselId) setSubTab('reels');
  }, [initialReelsCarouselId]);

  // Disparado pelo botão "Gerar Reels" no card de cada carrossel salvo do Básico
  function handleGenerateReelsFromCarousel(carouselId: string) {
    setInternalReelsCarouselId(carouselId);
    setSubTab('reels');
  }

  return (
    <>
      <SubTabBar
        tabs={[
          { id: 'basico', label: 'Carrossel', icon: Layers },
          { id: 'reels',  label: 'Reels',  icon: Video },
        ]}
        active={subTab}
        onChange={setSubTab}
      />
      <div style={{ display: subTab === 'basico' ? 'block' : 'none' }}>
        <CarrosselInstagram
          prefillScript={prefillScript}
          prefillTopic={prefillTopic}
          onGenerateReels={handleGenerateReelsFromCarousel}
        />
      </div>
      <div style={{ display: subTab === 'reels' ? 'block' : 'none' }}>
        <ReelsGerador
          initialCarouselId={initialReelsCarouselId || internalReelsCarouselId}
          onConsumeInitialCarouselId={() => {
            setInternalReelsCarouselId(null);
            onClearReelsCarouselId?.();
          }}
        />
      </div>
    </>
  );
}
