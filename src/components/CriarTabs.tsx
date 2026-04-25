/**
 * CriarTabs.tsx
 * Wrapper com 3 subtabs dentro da aba "Criar":
 *   - Básico: <CarrosselInstagram /> (gerador atual, intacto)
 *   - Máquina: <Maquina /> (modo BrandsDecoded com pipeline editorial em etapas)
 *   - Brand Kits: <BrandKits /> (movido da aba Studio)
 */

import React, { useState } from 'react';
import { Layers, Wand2, Palette } from 'lucide-react';
import CarrosselInstagram from './CarrosselInstagram';
import Maquina, { MaquinaInitialIdea } from './Maquina';
import BrandKits from './BrandKits';

type SubTabId = 'basico' | 'maquina' | 'brandkits';

interface CriarTabsProps {
  prefillScript?: string;
  prefillTopic?: string;
  initialMaquinaIdea?: MaquinaInitialIdea | null;
  onClearMaquinaIdea?: () => void;
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
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default function CriarTabs({
  prefillScript,
  prefillTopic,
  initialMaquinaIdea,
  onClearMaquinaIdea,
}: CriarTabsProps) {
  // Se a aba foi aberta com uma ideia para a Máquina, abre direto na subtab Máquina
  const [subTab, setSubTab] = useState<SubTabId>(initialMaquinaIdea ? 'maquina' : 'basico');

  return (
    <>
      <SubTabBar
        tabs={[
          { id: 'basico',    label: 'Básico',    icon: Layers },
          { id: 'maquina',   label: 'Máquina',   icon: Wand2 },
          { id: 'brandkits', label: 'Brand Kits', icon: Palette },
        ]}
        active={subTab}
        onChange={setSubTab}
      />

      {subTab === 'basico' && (
        <CarrosselInstagram prefillScript={prefillScript} prefillTopic={prefillTopic} />
      )}
      {subTab === 'maquina' && (
        <Maquina initialIdea={initialMaquinaIdea} onClearInitialIdea={onClearMaquinaIdea} />
      )}
      {subTab === 'brandkits' && <BrandKits />}
    </>
  );
}
