/**
 * HistoricoSidebar.tsx — Lista lateral dos carrosseis salvos.
 * Suporta archive reversível (mesmo padrão do CarrosselInstagram), clonar e abrir.
 */

import React from 'react';
import { Archive, ArchiveRestore, Trash2, FolderOpen, RefreshCw, Layers, Copy } from 'lucide-react';
import { MaquinaCarrossel } from '@/lib/maquinaApi';

interface HistoricoSidebarProps {
  items: MaquinaCarrossel[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (item: MaquinaCarrossel) => void;
  onClone: (item: MaquinaCarrossel) => void;
  onArchiveToggle: (item: MaquinaCarrossel) => void;
  onDelete: (item: MaquinaCarrossel) => void;
}

export default function HistoricoSidebar({
  items, loading, onRefresh, onOpen, onClone, onArchiveToggle, onDelete,
}: HistoricoSidebarProps) {
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-orange-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider">Histórico Máquina</h3>
        <button
          onClick={onRefresh}
          className={`ml-auto p-1 rounded hover:bg-secondary transition-colors ${loading ? 'animate-spin' : ''}`}
          title="Atualizar"
        >
          <RefreshCw className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      {active.length === 0 && archived.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic py-2">
          Nenhum carrossel salvo ainda. Salva o primeiro depois de gerar o HTML.
        </p>
      )}

      {active.length > 0 && (
        <div className="space-y-1">
          {active.map((item) => (
            <Row key={item.id} item={item} onOpen={onOpen} onClone={onClone} onArchive={onArchiveToggle} onDelete={onDelete} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <details className="pt-2 border-t border-border/50">
          <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">
            Arquivados ({archived.length})
          </summary>
          <div className="space-y-1 mt-1">
            {archived.map((item) => (
              <Row key={item.id} item={item} onOpen={onOpen} onClone={onClone} onArchive={onArchiveToggle} onDelete={onDelete} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Row({
  item, onOpen, onClone, onArchive, onDelete,
}: {
  item: MaquinaCarrossel;
  onOpen: (i: MaquinaCarrossel) => void;
  onClone: (i: MaquinaCarrossel) => void;
  onArchive: (i: MaquinaCarrossel) => void;
  onDelete: (i: MaquinaCarrossel) => void;
}) {
  const date = new Date(item.updated_at || item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return (
    <div className={`p-2 rounded-lg border transition-colors ${item.archived ? 'bg-secondary/40 border-border/50 opacity-70' : 'bg-secondary border-border hover:border-foreground/20'}`}>
      <button onClick={() => onOpen(item)} className="w-full text-left mb-1">
        <p className="text-xs font-medium leading-snug line-clamp-2">{item.title || item.briefing?.tema || 'Sem título'}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {date} · <span className="uppercase">{item.status}</span>
        </p>
      </button>
      <div className="flex gap-1">
        <ActionBtn icon={FolderOpen} title="Abrir" onClick={() => onOpen(item)} />
        <ActionBtn icon={Copy} title="Clonar como base" onClick={() => onClone(item)} />
        <ActionBtn
          icon={item.archived ? ArchiveRestore : Archive}
          title={item.archived ? 'Restaurar' : 'Arquivar'}
          onClick={() => onArchive(item)}
        />
        <ActionBtn icon={Trash2} title="Excluir" onClick={() => onDelete(item)} danger />
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon, title, onClick, danger,
}: { icon: React.ComponentType<any>; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded hover:bg-card transition-colors ${danger ? 'hover:text-red-400' : 'hover:text-foreground'} text-muted-foreground`}
    >
      <Icon className="w-3 h-3" />
    </button>
  );
}
