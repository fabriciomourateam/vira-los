/**
 * StudioCriacao.tsx
 * Studio de Criação de Designs — módulo integrado ao ViralOS
 *
 * Aceita contexto de: ideia (ContentIdea), trend (Oportunidade) ou criação livre
 * Formatos: carousel | story | post | banner | logo | thumbnail
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Sparkles, Send, Loader2, Plus, Trash2, Edit3, Check, X,
  ChevronLeft, ChevronRight, Download, Copy, Save, Layers,
  Image, FileText, Hash, Eye, EyeOff, RefreshCw, Zap,
  LayoutTemplate, Palette, BookOpen, ArrowRight, Monitor,
  Smartphone, Square, Film, Type, Star,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ContentIdea {
  id: string;
  title: string;
  hook: string;
  format: string;
  funnelStage: 'TOFU' | 'MOFU' | 'BOFU';
  emotion: string;
  cta: string;
  contentType: string;
  numSlides: number;
  slideOutline: string[];
  whyItWorks: string;
  viralScore: number;
}

export interface Oportunidade {
  id: number;
  titulo_viral: string;
  tema: string;
  fonte: string;
  angulo_viral: string;
  formato: string;
  emocao: string;
  hook_reels: string;
  pontos_chave: string[];
  score_viral: number;
  por_que_funciona: string;
}

export type StudioContextType = 'idea' | 'trend' | 'blank';

export interface StudioContext {
  type: StudioContextType;
  data?: ContentIdea | Oportunidade;
}

interface BrandKit {
  id: string;
  name: string;
  brandName: string;
  industry: string;
  contentTone: string;
  designStyle: string;
  fontStyle: string;
  targetAudience: string;
  palette: string[];
  instagramHandle: string;
}

interface StudioMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  html_content: string | null;
  caption: string | null;
  hashtags: string[];
  created_at: string;
}

interface StudioConversation {
  id: string;
  title: string;
  format: string;
  brand_kit_id: string | null;
  context_type: string;
  context_data: any;
  messages: StudioMessage[];
  created_at: string;
  updated_at: string;
}

// ─── Formatos disponíveis ─────────────────────────────────────────────────────

const FORMATS = [
  { id: 'carousel',  label: 'Carrossel',  icon: Layers,        desc: '1080×1080 · Multi-slides' },
  { id: 'story',     label: 'Story',      icon: Smartphone,    desc: '1080×1920 · Vertical' },
  { id: 'post',      label: 'Post',       icon: Square,        desc: '1080×1080 · Quadrado' },
  { id: 'banner',    label: 'Banner',     icon: Monitor,       desc: '1200×628 · Horizontal' },
  { id: 'logo',      label: 'Logo',       icon: Star,          desc: '800×800 · Identidade' },
  { id: 'thumbnail', label: 'Thumbnail',  icon: Film,          desc: '1280×720 · YouTube' },
] as const;

type FormatId = typeof FORMATS[number]['id'];

// ─── Sugestões de prompt por formato + contexto ───────────────────────────────

function buildInitialPrompt(format: FormatId, ctx: StudioContext): string {
  if (ctx.type === 'idea') {
    const idea = ctx.data as ContentIdea;
    const formatLabel = FORMATS.find(f => f.id === format)?.label || format;
    return `Crie um ${formatLabel} baseado nesta ideia viral:\n\nTítulo: "${idea.title}"\nHook: "${idea.hook}"\nEmoção: ${idea.emotion}\nCTA: "${idea.cta}"${idea.slideOutline?.length ? `\n\nEstrutura dos slides:\n${idea.slideOutline.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}`;
  }
  if (ctx.type === 'trend') {
    const trend = ctx.data as Oportunidade;
    const formatLabel = FORMATS.find(f => f.id === format)?.label || format;
    return `Crie um ${formatLabel} baseado neste trend viral:\n\nTítulo: "${trend.titulo_viral}"\nHook: "${trend.hook_reels}"\nÂngulo: ${trend.angulo_viral}\nPontos-chave: ${(trend.pontos_chave || []).join(', ')}`;
  }
  return '';
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  initialContext?: StudioContext;
  onClearContext?: () => void;
}

export default function StudioCriacao({ initialContext, onClearContext }: Props) {
  // ── Conversas
  const [conversations, setConversations] = useState<StudioConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Seleções
  const [format, setFormat] = useState<FormatId>('carousel');
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string>('');

  // ── Input
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Preview
  const [previewMessage, setPreviewMessage] = useState<StudioMessage | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [copyCaption, setCopyCaption] = useState(false);
  const [copyHashtags, setCopyHashtags] = useState(false);

  // ── Contexto (ideia/trend)
  const [ctx, setCtx] = useState<StudioContext>(initialContext || { type: 'blank' });

  // ── Streaming
  const [streamingText, setStreamingText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Efeito: novo contexto vindo de fora ─────────────────────────────────

  useEffect(() => {
    if (initialContext) {
      setCtx(initialContext);
      const suggested = buildInitialPrompt(format, initialContext);
      if (suggested) setInput(suggested);
    }
  }, [initialContext]);

  // ─── Efeito: carrega dados iniciais ──────────────────────────────────────

  useEffect(() => {
    loadConversations();
    loadBrandKits();
  }, []);

  useEffect(() => {
    if (activeConvId) loadMessages(activeConvId);
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // ─── API calls ───────────────────────────────────────────────────────────

  async function loadConversations() {
    try {
      const r = await fetch(`${API}/api/studio/conversations`);
      if (r.ok) setConversations(await r.json());
    } catch {}
  }

  async function loadBrandKits() {
    try {
      const r = await fetch(`${API}/api/brand-kits`);
      if (r.ok) setBrandKits(await r.json());
    } catch {}
  }

  async function loadMessages(convId: string) {
    try {
      const r = await fetch(`${API}/api/studio/conversations/${convId}`);
      if (r.ok) {
        const data = await r.json();
        setMessages(data.messages || []);
        const lastAssistant = [...(data.messages || [])].reverse().find(m => m.role === 'assistant' && m.html_content);
        if (lastAssistant) setPreviewMessage(lastAssistant);
      }
    } catch {}
  }

  async function createConversation(): Promise<string> {
    const contextLabel = ctx.type === 'idea'
      ? (ctx.data as ContentIdea).title
      : ctx.type === 'trend'
        ? (ctx.data as Oportunidade).titulo_viral
        : null;

    const r = await fetch(`${API}/api/studio/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: contextLabel || 'Nova criação',
        format,
        brandKitId: selectedBrandKitId || null,
        contextType: ctx.type,
        contextData: ctx.data || null,
      }),
    });
    const conv = await r.json();
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    return conv.id;
  }

  async function saveMessage(convId: string, msg: Omit<StudioMessage, 'created_at'>): Promise<StudioMessage> {
    const r = await fetch(`${API}/api/studio/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    return r.json();
  }

  async function saveToGallery(msg: StudioMessage) {
    try {
      const contextLabel = ctx.type === 'idea'
        ? (ctx.data as ContentIdea).title
        : ctx.type === 'trend'
          ? (ctx.data as Oportunidade).titulo_viral
          : 'Design';

      await fetch(`${API}/api/studio/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: contextLabel,
          format,
          html_content: msg.html_content,
          caption: msg.caption,
          hashtags: msg.hashtags,
          brand_kit_id: selectedBrandKitId || null,
          conversation_id: activeConvId,
          message_id: msg.id,
        }),
      });
      toast.success('Post salvo na galeria!');
    } catch {
      toast.error('Erro ao salvar na galeria');
    }
  }

  // ─── Enviar mensagem + gerar design ──────────────────────────────────────

  async function handleSend() {
    const userMsg = input.trim();
    if (!userMsg || isGenerating) return;

    setInput('');
    setIsGenerating(true);
    setStreamingText('');

    // Cria conversa se ainda não existe
    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
      } catch {
        toast.error('Erro ao criar conversa');
        setIsGenerating(false);
        return;
      }
    }

    // Salva mensagem do usuário localmente
    const userMessage: StudioMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: userMsg,
      html_content: null,
      caption: null,
      hashtags: [],
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Salva no backend
    try {
      await saveMessage(convId, { ...userMessage, id: userMessage.id });
    } catch {}

    // Inicia streaming
    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = '';
    let parsedHtml: string | null = null;
    let parsedCaption = '';
    let parsedHashtags: string[] = [];

    try {
      const r = await fetch(`${API}/api/studio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: convId,
          format,
          brandKitId: selectedBrandKitId || null,
          contextType: ctx.type,
          contextData: ctx.data || null,
          userMessage: userMsg,
        }),
      });

      const reader = r.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              fullText += data.text;
              setStreamingText(fullText);
            } else if (data.type === 'done') {
              parsedHtml = data.htmlContent;
              parsedCaption = data.caption || '';
              parsedHashtags = data.hashtags || [];
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // Texto de exibição (sem HTML bruto)
      const displayText = fullText
        .replace(/```html[\s\S]*?```/gi, parsedHtml ? '✦ Design gerado com sucesso' : '[design]')
        .replace(/\*\*Legenda:\*\*[\s\S]*?(?=\*\*Hashtags:|$)/gi, '')
        .replace(/\*\*Hashtags:\*\*[\s\S]*/gi, '')
        .trim();

      // Salva resposta do assistente
      const assistantMsg: StudioMessage = {
        id: `tmp-ai-${Date.now()}`,
        role: 'assistant',
        content: displayText,
        html_content: parsedHtml,
        caption: parsedCaption,
        hashtags: parsedHashtags,
        created_at: new Date().toISOString(),
      };

      const saved = await saveMessage(convId, assistantMsg);
      const finalMsg = { ...assistantMsg, id: saved.id || assistantMsg.id };

      setMessages(prev => [...prev, finalMsg]);
      setStreamingText('');

      if (parsedHtml) {
        setPreviewMessage(finalMsg);
        setShowPreview(true);
      }

      // Atualiza título da conversa com base no contexto
      if (conversations.find(c => c.id === convId)?.title === 'Nova criação') {
        const label = ctx.type === 'idea'
          ? (ctx.data as ContentIdea)?.title
          : ctx.type === 'trend'
            ? (ctx.data as Oportunidade)?.titulo_viral
            : userMsg.slice(0, 40);
        if (label) {
          await fetch(`${API}/api/studio/conversations/${convId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: label }),
          });
          setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: label } : c));
        }
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error('Erro ao gerar design: ' + err.message);
        setStreamingText('');
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }

  // ─── Ações ────────────────────────────────────────────────────────────────

  function newConversation() {
    setActiveConvId(null);
    setMessages([]);
    setStreamingText('');
    setPreviewMessage(null);
    setCtx(initialContext || { type: 'blank' });
    if (initialContext) {
      setInput(buildInitialPrompt(format, initialContext));
    } else {
      setInput('');
    }
    textareaRef.current?.focus();
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`${API}/api/studio/conversations/${id}`, { method: 'DELETE' });
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
      setPreviewMessage(null);
    }
    toast.success('Conversa excluída');
  }

  async function renameConversation(id: string) {
    if (!renameValue.trim()) return;
    await fetch(`${API}/api/studio/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: renameValue.trim() }),
    });
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: renameValue.trim() } : c));
    setRenamingId(null);
  }

  function downloadHtml(msg: StudioMessage) {
    if (!msg.html_content) return;
    const blob = new Blob([msg.html_content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio-design-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyText(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  // ─── Contexto badge ───────────────────────────────────────────────────────

  function ContextBadge() {
    if (ctx.type === 'blank') return null;
    const isIdea = ctx.type === 'idea';
    const label = isIdea
      ? (ctx.data as ContentIdea)?.title
      : (ctx.data as Oportunidade)?.titulo_viral;
    const score = isIdea
      ? (ctx.data as ContentIdea)?.viralScore
      : (ctx.data as Oportunidade)?.score_viral;

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/10 border border-violet-500/30 rounded-lg text-xs">
        <Zap className="w-3 h-3 text-violet-400 shrink-0" />
        <span className="text-violet-300 font-medium shrink-0">
          {isIdea ? 'Ideia' : 'Trend'}:
        </span>
        <span className="text-white/70 truncate">{label}</span>
        {score && (
          <span className="ml-auto shrink-0 text-green-400 font-bold">{score}/10</span>
        )}
        {onClearContext && (
          <button
            onClick={() => { setCtx({ type: 'blank' }); setInput(''); onClearContext(); }}
            className="ml-1 text-white/40 hover:text-white/80"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 bg-[#0f0f13] rounded-xl border border-white/5 overflow-hidden">

      {/* ── Sidebar: histórico de conversas ── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-white/5 bg-[#0a0a0e]">
        <div className="p-3 border-b border-white/5">
          <button
            onClick={newConversation}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova criação
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-white/30 text-center mt-8 px-2">Nenhuma criação ainda</p>
          )}
          {conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => setActiveConvId(conv.id)}
              className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                activeConvId === conv.id
                  ? 'bg-violet-600/20 text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              {renamingId === conv.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameConversation(conv.id); if (e.key === 'Escape') setRenamingId(null); }}
                  onBlur={() => renameConversation(conv.id)}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 bg-transparent border-b border-violet-400 outline-none text-white text-xs"
                />
              ) : (
                <span className="flex-1 truncate">{conv.title}</span>
              )}

              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); setRenamingId(conv.id); setRenameValue(conv.title); }}
                  className="p-0.5 hover:text-white"
                >
                  <Edit3 className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={e => deleteConversation(conv.id, e)}
                  className="p-0.5 hover:text-red-400"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Área principal: chat ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Toolbar: formato + brand kit */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-[#0f0f13] flex-wrap">
          {/* Seletor de formato */}
          <div className="flex items-center gap-1">
            {FORMATS.map(f => {
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  title={`${f.label} · ${f.desc}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    format === f.id
                      ? 'bg-violet-600 text-white'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Seletor de Brand Kit */}
          <select
            value={selectedBrandKitId}
            onChange={e => setSelectedBrandKitId(e.target.value)}
            className="text-xs bg-white/5 border border-white/10 text-white/70 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
          >
            <option value="">Sem brand kit</option>
            {brandKits.map(k => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>

          {/* Toggle preview */}
          <button
            onClick={() => setShowPreview(v => !v)}
            className={`ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
              showPreview ? 'text-violet-300 bg-violet-500/10' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {showPreview ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Preview
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">

          {/* Chat */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

              {/* Badge de contexto */}
              {ctx.type !== 'blank' && messages.length === 0 && (
                <div className="max-w-xl mx-auto">
                  <ContextBadge />
                  <p className="text-xs text-white/30 text-center mt-3">
                    Contexto carregado. Descreva o design que deseja criar ou envie a sugestão abaixo.
                  </p>
                </div>
              )}

              {/* Estado vazio */}
              {messages.length === 0 && ctx.type === 'blank' && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-violet-600/20 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-white/60 text-sm font-medium">Studio de Criação</p>
                    <p className="text-white/30 text-xs mt-1">Selecione um formato e descreva o design</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                    {[
                      'Crie um carrossel sobre os 5 erros de dieta mais comuns',
                      'Faça um banner de lançamento de produto de suplementos',
                      'Gere um thumbnail chamativo sobre TRT e testosterona',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 rounded-lg transition-colors text-left"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Lista de mensagens */}
              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div className={`max-w-lg ${msg.role === 'user' ? 'order-first' : ''}`}>
                    <div className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-violet-600/80 text-white ml-auto'
                        : 'bg-white/5 text-white/80'
                    }`}>
                      {msg.content || '...'}
                    </div>

                    {/* Ações do design */}
                    {msg.role === 'assistant' && msg.html_content && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <button
                          onClick={() => { setPreviewMessage(msg); setShowPreview(true); }}
                          className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                        >
                          <Eye className="w-3 h-3" /> Ver design
                        </button>
                        <button
                          onClick={() => downloadHtml(msg)}
                          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                        >
                          <Download className="w-3 h-3" /> HTML
                        </button>
                        <button
                          onClick={() => saveToGallery(msg)}
                          className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                        >
                          <Save className="w-3 h-3" /> Salvar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming em progresso */}
              {isGenerating && (
                <div className="flex gap-3 justify-start">
                  <div className="w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Loader2 className="w-3 h-3 text-white animate-spin" />
                  </div>
                  <div className="max-w-lg bg-white/5 rounded-xl px-3.5 py-2.5 text-sm text-white/60">
                    {streamingText
                      ? streamingText.replace(/```html[\s\S]*?```/gi, '⟳ Gerando design...').slice(-300)
                      : <span className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Processando...</span>
                    }
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Contexto badge (quando tem mensagens) */}
            {ctx.type !== 'blank' && messages.length > 0 && (
              <div className="px-4 pb-1">
                <ContextBadge />
              </div>
            )}

            {/* Input */}
            <div className="shrink-0 px-4 pb-4 pt-2">
              <div className="flex gap-2 items-end bg-white/5 border border-white/10 rounded-xl p-2 focus-within:border-violet-500/50 transition-colors">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={`Descreva o design ${FORMATS.find(f => f.id === format)?.label.toLowerCase() || ''}...`}
                  rows={2}
                  className="flex-1 bg-transparent resize-none outline-none text-sm text-white/80 placeholder-white/25 leading-relaxed"
                />
                <button
                  onClick={isGenerating ? () => abortRef.current?.abort() : handleSend}
                  disabled={!isGenerating && !input.trim()}
                  className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    isGenerating
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : input.trim()
                        ? 'bg-violet-600 text-white hover:bg-violet-500'
                        : 'bg-white/5 text-white/20 cursor-not-allowed'
                  }`}
                >
                  {isGenerating ? <X className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-white/20 mt-1.5 text-center">Enter para enviar · Shift+Enter para nova linha</p>
            </div>
          </div>

          {/* ── Painel de preview ── */}
          <AnimatePresence>
            {showPreview && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 420, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 border-l border-white/5 bg-[#0a0a0e] flex flex-col overflow-hidden"
              >
                <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                  <span className="text-xs font-medium text-white/60">Preview do Design</span>
                  {previewMessage && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadHtml(previewMessage)}
                        className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
                      >
                        <Download className="w-3 h-3" /> HTML
                      </button>
                      <button
                        onClick={() => saveToGallery(previewMessage)}
                        className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                      >
                        <Save className="w-3 h-3" /> Salvar
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {previewMessage?.html_content ? (
                    <>
                      {/* Design iframe */}
                      <div className="w-full aspect-square rounded-lg overflow-hidden border border-white/10 bg-white">
                        <iframe
                          srcDoc={previewMessage.html_content}
                          title="Design Preview"
                          className="w-full h-full border-0 scale-[0.37] origin-top-left"
                          style={{ width: '270%', height: '270%' }}
                          sandbox="allow-same-origin"
                        />
                      </div>

                      {/* Legenda */}
                      {previewMessage.caption && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-white/50 flex items-center gap-1">
                              <FileText className="w-3 h-3" /> Legenda
                            </span>
                            <button
                              onClick={() => copyText(previewMessage.caption!, setCopyCaption)}
                              className="text-xs text-white/30 hover:text-white/70 flex items-center gap-1"
                            >
                              {copyCaption ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                              {copyCaption ? 'Copiado!' : 'Copiar'}
                            </button>
                          </div>
                          <p className="text-xs text-white/60 bg-white/5 rounded-lg px-3 py-2.5 leading-relaxed whitespace-pre-wrap">
                            {previewMessage.caption}
                          </p>
                        </div>
                      )}

                      {/* Hashtags */}
                      {previewMessage.hashtags?.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-white/50 flex items-center gap-1">
                              <Hash className="w-3 h-3" /> Hashtags
                            </span>
                            <button
                              onClick={() => copyText(previewMessage.hashtags.map(h => `#${h}`).join(' '), setCopyHashtags)}
                              className="text-xs text-white/30 hover:text-white/70 flex items-center gap-1"
                            >
                              {copyHashtags ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                              {copyHashtags ? 'Copiado!' : 'Copiar'}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {previewMessage.hashtags.map(h => (
                              <span key={h} className="text-[10px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 rounded-md">
                                #{h}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                      <LayoutTemplate className="w-8 h-8 text-white/10" />
                      <p className="text-xs text-white/30">O design aparecerá aqui</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
