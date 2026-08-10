import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Sparkles, PenLine, FileText, MessageCircle, Brain, Send } from 'lucide-react';

export interface ChatMsg { role: 'user' | 'assistant'; text: string; }

export interface NodeData {
  id: string; x: number; y: number; width: number;
  content: string; isProcessing: boolean;
  isNew?: boolean; isStreaming?: boolean;
  imageData?: string;
  isBrainstorm?: boolean;
  chatHistory?: ChatMsg[];
}

interface SelectionMenu { screenX: number; screenY: number; start: number; end: number; text: string; }
interface EnhanceSugg { screenX: number; screenY: number; start: number; end: number; original: string; enhanced: string; note: string; loading: boolean; }

interface Props {
  node: NodeData;
  isSelected: boolean; scale: number; isSpaceHeld: boolean;
  isDragActive: boolean; isDropTarget: boolean;
  onSelect: () => void; onUpdate: (u: Partial<NodeData>) => void;
  onDelete: () => void; onBringToFront: () => void;
  onConnectionDragStart: (fromCanvasX: number, fromCanvasY: number, mouseScreenX: number, mouseScreenY: number) => void;
  onHeightChange: (h: number) => void;
  connectedContents?: string[];
}

const THRESHOLD = 48;
const MAX_CONTENT_H = 480;
const DOT_COLORS = [
  '#818cf8','#a78bfa','#c084fc','#e879f9','#f472b6',
  '#fb923c','#facc15','#4ade80','#34d399','#38bdf8',
  '#60a5fa','#f87171','#fbbf24','#a3e635','#2dd4bf',
];

function toRatio(d: number, a: 'shrink' | 'expand') {
  return a === 'shrink' ? Math.max(0.12, 1 - Math.abs(d) / 450) : Math.min(4.5, 1 + d / 200);
}

export default function TextNode({
  node, isSelected, scale, isSpaceHeld, isDragActive, isDropTarget,
  onSelect, onUpdate, onDelete, onBringToFront,
  onConnectionDragStart, onHeightChange, connectedContents,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; nx: number; ny: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDelta, setResizeDelta] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const [handleHover, setHandleHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resizeRef = useRef<{ startY: number } | null>(null);

  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [isSelectionProcessing, setIsSelectionProcessing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [cardH, setCardH] = useState(220);

  const [enhanceSugg, setEnhanceSugg] = useState<EnhanceSugg | null>(null);
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Pixel dissolve delete ─────────────────────────────────────
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    deleteTimerRef.current = setTimeout(() => { onDelete(); }, 1120);
  }, [onDelete]);

  useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);

  // ── Brainstorm send ──────────────────────────────────────────
  async function sendBrainstorm() {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMsg = { role: 'user', text: chatInput.trim() };
    const newHistory = [...(node.chatHistory || []), userMsg];
    onUpdate({ chatHistory: newHistory, content: chatInput.trim() });
    setChatInput('');
    if (chatInputRef.current) chatInputRef.current.style.height = 'auto';
    setChatLoading(true);
    const isFirst = !node.chatHistory || node.chatHistory.length === 0;
    try {
      const res = await fetch('/api/brainstorm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory,
          contextNodes: (connectedContents || []).map(c => ({ content: c })),
          nodeContext: isFirst && node.content.trim() ? node.content : null,
        }),
      });
      const data = await res.json();
      if (data.result) {
        const aiMsg: ChatMsg = { role: 'assistant', text: data.result };
        onUpdate({ chatHistory: [...newHistory, aiMsg], content: data.result });
      }
    } catch { /* silent */ }
    setChatLoading(false);
  }

  // ── Chat auto-scroll ─────────────────────────────────────────
  const chatHistLen = node.chatHistory?.length ?? 0;
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatHistLen, chatLoading]);

  // ── Track card height ─────────────────────────────────────────
  useEffect(() => {
    if (!cardRef.current) return;
    const obs = new ResizeObserver(entries => {
      const h = entries[0].contentRect.height;
      setCardH(h); onHeightChange(h);
    });
    obs.observe(cardRef.current);
    return () => obs.disconnect();
  }, [onHeightChange]);

  // ── Auto-grow textarea ────────────────────────────────────────
  useEffect(() => {
    if (!textareaRef.current || node.isProcessing || node.imageData) return;
    const ta = textareaRef.current;
    ta.style.height = 'auto'; ta.style.overflowY = 'hidden';
    if (ta.scrollHeight > MAX_CONTENT_H) {
      ta.style.height = MAX_CONTENT_H + 'px'; ta.style.overflowY = 'auto';
      if (node.isStreaming) ta.scrollTop = ta.scrollHeight;
    } else { ta.style.height = ta.scrollHeight + 'px'; }
  }, [node.content, node.isProcessing, node.isStreaming, node.imageData]);

  // ── Focus new nodes ───────────────────────────────────────────
  useEffect(() => {
    if (node.isNew && !node.isStreaming && !node.imageData && textareaRef.current)
      setTimeout(() => textareaRef.current?.focus(), 140);
  }, [node.isNew, node.isStreaming, node.imageData]);

  // ── Dismiss menus on outside click ───────────────────────────
  useEffect(() => {
    if (!selectionMenu && !enhanceSugg) return;
    const h = () => { setSelectionMenu(null); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [selectionMenu, enhanceSugg]);

  // ══════════════════════════════════════════════════════════════
  //  DRAG TO MOVE
  // ══════════════════════════════════════════════════════════════
  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isSpaceHeld) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(); onBringToFront();
    setIsDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y };
  }, [isSpaceHeld, node.x, node.y, onSelect, onBringToFront]);

  // ══════════════════════════════════════════════════════════════
  //  RESIZE HANDLE
  // ══════════════════════════════════════════════════════════════
  const onHandleDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || node.isProcessing || node.isStreaming) return;
    e.preventDefault(); e.stopPropagation();
    setBaseH(cardRef.current!.getBoundingClientRect().height / scale);
    setIsResizing(true); setResizeDelta(0); setError(null);
    resizeRef.current = { startY: e.clientY };
  }, [node.isProcessing, node.isStreaming, scale]);

  // ══════════════════════════════════════════════════════════════
  //  GLOBAL MOUSE (drag + resize)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isDragging && !isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (isDragging && dragRef.current)
        onUpdate({ x: dragRef.current.nx + (e.clientX - dragRef.current.sx) / scale, y: dragRef.current.ny + (e.clientY - dragRef.current.sy) / scale });
      if (isResizing && resizeRef.current) setResizeDelta((e.clientY - resizeRef.current.startY) / scale);
    };
    const onUp = async (e: MouseEvent) => {
      if (isResizing && resizeRef.current) {
        const delta = (e.clientY - resizeRef.current.startY) / scale;
        if (Math.abs(delta) >= THRESHOLD) {
          const action = delta < 0 ? 'shorten' : 'expand';
          if (!node.content.trim()) { setError('Add some text first'); setTimeout(() => setError(null), 2500); }
          else {
            onUpdate({ isProcessing: true });
            try {
              const res = await fetch('/api/process-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: node.content, action, ratio: toRatio(delta, delta < 0 ? 'shrink' : 'expand') }) });
              const data = await res.json();
              onUpdate({ content: data.result || node.content, isProcessing: false });
              if (!data.result) { setError(data.error || 'Error'); setTimeout(() => setError(null), 4000); }
            } catch { onUpdate({ isProcessing: false }); setError('Server unreachable'); setTimeout(() => setError(null), 4000); }
          }
        }
        setIsResizing(false); setResizeDelta(0);
      }
      if (isDragging) setIsDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDragging, isResizing, scale, node.content, onUpdate]);

  // ══════════════════════════════════════════════════════════════
  //  CONNECTION DOT DRAG
  // ══════════════════════════════════════════════════════════════
  const onDotMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    onConnectionDragStart(node.x + node.width, node.y + cardH / 2, e.clientX, e.clientY);
  }, [node.x, node.y, node.width, cardH, onConnectionDragStart]);

  // ══════════════════════════════════════════════════════════════
  //  TEXT SELECTION MENU
  // ══════════════════════════════════════════════════════════════
  const onTextMouseUp = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const ta = textareaRef.current!;
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end) { setSelectionMenu(null); return; }
    const text = node.content.slice(start, end).trim();
    if (text.length < 2) { setSelectionMenu(null); return; }
    const cardRect = cardRef.current?.getBoundingClientRect();
    // anchor menu to the right edge of the card, vertically near the mouse
    setSelectionMenu({ screenX: cardRect ? cardRect.right : e.clientX, screenY: e.clientY, start, end, text });
  }, [node.content]);

  const handleSelectionAction = useCallback(async (action: string) => {
    if (!selectionMenu) return;
    const { start, end, text } = selectionMenu;
    setSelectionMenu(null); setIsSelectionProcessing(true);
    try {
      const res = await fetch('/api/process-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, action, ratio: 1 }) });
      const data = await res.json();
      if (data.result) onUpdate({ content: node.content.slice(0, start) + data.result + node.content.slice(end) });
    } catch { /* silent */ }
    setIsSelectionProcessing(false);
  }, [selectionMenu, node.content, onUpdate]);

  // ── Enhance: show suggestion preview ─────────────────────────
  const handleEnhance = useCallback(async () => {
    if (!selectionMenu) return;
    const { start, end, text, screenX, screenY } = selectionMenu;
    setSelectionMenu(null);
    setEnhanceSugg({ screenX, screenY, start, end, original: text, enhanced: '', note: '', loading: true });
    try {
      const res = await fetch('/api/enhance-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await res.json();
      setEnhanceSugg(prev => prev ? { ...prev, enhanced: data.enhanced || text, note: data.note || '', loading: false } : null);
    } catch {
      setEnhanceSugg(null);
    }
  }, [selectionMenu]);

  const acceptEnhancement = useCallback(() => {
    if (!enhanceSugg) return;
    onUpdate({ content: node.content.slice(0, enhanceSugg.start) + enhanceSugg.enhanced + node.content.slice(enhanceSugg.end) });
    setEnhanceSugg(null);
  }, [enhanceSugg, node.content, onUpdate]);

  // ── Copy prompt (image nodes) ─────────────────────────────────
  const copyPrompt = useCallback(() => {
    let toCopy = node.content;
    try { const j = JSON.parse(node.content); toCopy = j.recreate_prompt || node.content; } catch { /* use raw */ }
    navigator.clipboard.writeText(toCopy);
    setCopyConfirm(true);
    setTimeout(() => setCopyConfirm(false), 2000);
  }, [node.content]);

  // ── Derived ────────────────────────────────────────────────────
  const dir: 'shrink' | 'expand' | null = resizeDelta < -THRESHOLD ? 'shrink' : resizeDelta > THRESHOLD ? 'expand' : null;
  const pct = dir ? Math.round(toRatio(resizeDelta, dir) * 100) : 100;
  const cardHForResize = (!node.isBrainstorm && isResizing) ? Math.max(80, baseH + resizeDelta) : undefined;
  const wordCount = node.content.trim() ? node.content.trim().split(/\s+/).length : 0;
  const showDot = isDropTarget || (isHovered && !isDragActive);

  const DOT_PX = 16, dotSize = DOT_PX / scale, dotOffset = dotSize / 2, borderW = 2 / scale;
  const gripColor = dir === 'shrink' ? '#3b82f6' : dir === 'expand' ? '#22c55e' : handleHover ? '#aaa' : '#d1d5db';
  const handleBg = dir === 'shrink' ? `rgba(59,130,246,${0.1 + Math.min(0.4, Math.abs(resizeDelta) / 350)})` : dir === 'expand' ? `rgba(34,197,94,${0.1 + Math.min(0.4, resizeDelta / 350)})` : handleHover ? 'rgba(0,0,0,0.025)' : 'transparent';
  const cardBoxShadow = node.isStreaming ? undefined : isDropTarget ? '0 0 0 2px rgba(124,58,237,0.8), 0 0 0 8px rgba(124,58,237,0.15), 0 16px 48px rgba(0,0,0,0.5)' : isSelected ? `0 0 0 2px ${dir === 'shrink' ? '#3b82f6' : dir === 'expand' ? '#22c55e' : '#3b82f6'}, 0 16px 48px rgba(0,0,0,0.55)` : '0 4px 28px rgba(0,0,0,0.4)';
  const dotsPerRow = Math.floor((node.width - 36) / 13);

  // Is the content a valid JSON object? (for image nodes display)
  let isJsonContent = false;
  try { if (node.imageData && node.content.trim().startsWith('{')) { JSON.parse(node.content); isJsonContent = true; } } catch { /* not json */ }

  return (
    <div
      data-nodeid={node.id}
      style={{ position: 'absolute', left: node.x, top: node.y, width: node.width, userSelect: isDragging ? 'none' : 'auto', zIndex: isSelected || isDropTarget ? 100 : 1, animation: node.isNew ? 'nodeIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both' : undefined }}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* ── Card ────────────────────────────────────────── */}
      <div
        ref={cardRef}
        style={{ borderRadius: 14, background: '#F6F0E9', overflow: isResizing ? 'hidden' : 'visible', height: cardHForResize, minHeight: node.isBrainstorm ? 460 : undefined, display: 'flex', flexDirection: 'column', transition: isResizing ? 'none' : 'box-shadow 0.15s ease', boxShadow: cardBoxShadow, animation: node.isStreaming ? 'streamGlow 2s ease-in-out infinite' : undefined, opacity: isDeleting ? 0 : 1 }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '10px 12px', background: '#EDE7DC', borderBottom: '1px solid #DDD5C8', borderRadius: '14px 14px 0 0', display: 'flex', alignItems: 'center', gap: 8, cursor: isDragging ? 'grabbing' : 'grab' }} onMouseDown={onHeaderDown}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,4px)', gap: '3px', flexShrink: 0 }}>
            {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#d0d4d9' }} />)}
          </div>
          <span style={{ flex: 1, fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: node.isBrainstorm ? (chatLoading ? '#555' : '#888') : node.isStreaming ? '#7c3aed' : node.isProcessing ? '#3b82f6' : isSelectionProcessing ? '#f59e0b' : node.imageData ? '#6366f1' : '#adb5bd' }}>
            {node.isBrainstorm
              ? (chatLoading ? 'Thinking…' : 'Brainstorm')
              : node.isStreaming ? (node.imageData ? '✦ Analyzing…' : '✦ AI Writing…')
              : node.isProcessing ? 'Rewriting…'
              : isSelectionProcessing ? 'Improving…'
              : node.imageData ? '🖼 Image Node'
              : 'Text Node'}
          </span>
          {wordCount > 0 && !node.isProcessing && !node.isStreaming && !node.imageData && !node.isBrainstorm && <span style={{ fontFamily: 'Inter,system-ui', fontSize: 10, color: '#A5A5A5', fontWeight: 500 }}>{wordCount}w</span>}
          {(node.isProcessing || isSelectionProcessing) && <div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid #dbeafe', borderTopColor: '#3b82f6', animation: 'spin 0.65s linear infinite', flexShrink: 0 }} />}
          {node.isStreaming && <div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid #ede9fe', borderTopColor: '#7c3aed', animation: 'spin 0.65s linear infinite', flexShrink: 0 }} />}
          {chatLoading && node.isBrainstorm && <div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid #e0e0e0', borderTopColor: '#555', animation: 'spin 0.65s linear infinite', flexShrink: 0 }} />}
          {!node.isBrainstorm && !node.isProcessing && !node.isStreaming && !node.imageData && (
            <button onClick={e => { e.stopPropagation(); onUpdate({ isBrainstorm: true, chatHistory: [] }); }} onMouseDown={e => e.stopPropagation()}
              style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0, color: '#C8C0B8', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s, background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#1a1a1a'; e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#C8C0B8'; e.currentTarget.style.background = 'transparent'; }}
              title="Switch to Brainstorm">
              <Brain size={13} strokeWidth={2} />
            </button>
          )}
          <button onClick={handleDeleteClick} onMouseDown={e => e.stopPropagation()} style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0, color: '#B8AFA6', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s, background 0.15s' }} onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.color = '#B8AFA6'; e.currentTarget.style.background = 'transparent'; }}><X size={13} strokeWidth={2.5} /></button>
        </div>

        {/* Pasted image */}
        {node.imageData && (
          <div style={{ flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
            <img src={node.imageData} alt="Pasted" style={{ width: '100%', display: 'block', maxHeight: 220, objectFit: 'cover' }} />
          </div>
        )}

        {/* Content */}
        {node.isBrainstorm ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 8px', display: 'flex', flexDirection: 'column', gap: 9, minHeight: 300, maxHeight: 400 }}>
              {(node.chatHistory?.length ?? 0) === 0 && !chatLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '52px 16px', flex: 1 }}>
                  <Brain size={26} color="#C4BAB0" strokeWidth={1.5} />
                  <p style={{ margin: 0, fontFamily: 'Inter,system-ui', fontSize: 11, color: '#C4BAB0', textAlign: 'center', lineHeight: 1.6 }}>Ask anything — ideas, structure,<br />critique, connections.</p>
                </div>
              )}
              {node.chatHistory?.map((msg, i) => (
                <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '9px 13px', borderRadius: msg.role === 'user' ? '14px 14px 3px 14px' : '14px 14px 14px 3px', background: msg.role === 'user' ? '#1a1a1a' : '#EDE7DC', color: msg.role === 'user' ? '#f0f0f0' : '#1a1a1a', fontFamily: "'Lora','Georgia',serif", fontSize: 13, lineHeight: 1.65, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: 'flex-start', padding: '10px 14px', borderRadius: '14px 14px 14px 3px', background: '#EDE7DC', display: 'flex', gap: 5, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#999', animation: 'dotPulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />)}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, borderTop: '1px solid #DDD5C8', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={e => { setChatInput(e.target.value); const ta = e.currentTarget; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 72) + 'px'; }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBrainstorm(); } }}
                placeholder="Ask, explore, challenge…"
                rows={1}
                style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontFamily: "'Lora','Georgia',serif", fontSize: 13, lineHeight: 1.6, color: '#1a1a1a', minHeight: 22, maxHeight: 72, overflowY: 'auto', padding: 0 }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
              <button onClick={e => { e.stopPropagation(); sendBrainstorm(); }} onMouseDown={e => e.stopPropagation()} disabled={!chatInput.trim() || chatLoading}
                style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: chatInput.trim() && !chatLoading ? '#1a1a1a' : '#D8D0C8', cursor: chatInput.trim() && !chatLoading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}>
                <Send size={13} color={chatInput.trim() && !chatLoading ? '#fff' : '#F6F0E9'} strokeWidth={2} />
              </button>
            </div>
          </div>
        ) : node.isProcessing ? (
          <div style={{ padding: '18px 16px 14px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {Array.from({ length: dotsPerRow * 7 }, (_, i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: DOT_COLORS[i % DOT_COLORS.length], animation: 'dotPulse 1.8s ease-in-out infinite', animationDelay: `${((i * 0.04) % 1.8).toFixed(2)}s` }} />
              ))}
            </div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter,system-ui', fontSize: 11, color: '#9ca3af' }}><Sparkles size={11} /> Rewriting…</div>
          </div>
        ) : node.imageData && isJsonContent ? (
          // JSON display for image nodes
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: MAX_CONTENT_H }}>
            <pre style={{ margin: 0, padding: '14px 16px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, lineHeight: 1.7, color: '#374151', background: '#f8fafc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {(() => {
                try {
                  const j = JSON.parse(node.content);
                  return JSON.stringify(j, null, 2);
                } catch { return node.content; }
              })()}
            </pre>
          </div>
        ) : (
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={node.content}
              onChange={e => onUpdate({ content: e.target.value })}
              readOnly={!!node.isStreaming}
              placeholder={node.imageData ? 'Analyzing image…' : 'type your mind off...'}
              style={{ display: 'block', width: '100%', border: 'none', outline: 'none', resize: 'none', padding: '18px', fontFamily: node.imageData ? "'JetBrains Mono','Fira Code',monospace" : "'Lora','Georgia',serif", fontSize: node.imageData ? 11 : 15, lineHeight: node.imageData ? 1.7 : 1.8, color: '#1a1a2e', background: 'transparent', minHeight: 100, boxSizing: 'border-box', cursor: node.isStreaming ? 'default' : 'text' }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onMouseUp={onTextMouseUp}
            />
            {node.isStreaming && <span style={{ position: 'absolute', bottom: 20, right: 20, width: 2, height: 18, background: 'linear-gradient(180deg,#7c3aed,#ec4899)', borderRadius: 2, animation: 'blink 1s step-end infinite' }} />}
          </div>
        )}

        {/* Copy prompt button for image nodes */}
        {node.imageData && node.content && !node.isStreaming && (
          <div style={{ flexShrink: 0, padding: '10px 14px', borderTop: '1px solid #DDD5C8', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={e => { e.stopPropagation(); copyPrompt(); }}
              onMouseDown={e => e.stopPropagation()}
              style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: 'transparent', cursor: 'pointer', fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 600, color: copyConfirm ? '#22c55e' : '#6b7280', transition: 'all 0.15s', letterSpacing: '0.02em' }}
              onMouseEnter={e => { if (!copyConfirm) { e.currentTarget.style.borderColor = '#9ca3af'; e.currentTarget.style.color = '#374151'; } }}
              onMouseLeave={e => { if (!copyConfirm) { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#6b7280'; } }}>
              {copyConfirm ? '✓ Copied' : 'Copy prompt'}
            </button>
          </div>
        )}

        {/* Resize handle (not for image nodes or brainstorm nodes) */}
        {!node.imageData && !node.isBrainstorm && (
          <div style={{ flexShrink: 0, height: 30, borderTop: '1px solid #DDD5C8', borderRadius: '0 0 14px 14px', cursor: (node.isProcessing || node.isStreaming) ? 'not-allowed' : 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: handleBg, transition: isResizing ? 'none' : 'background 0.2s ease', userSelect: 'none' }}
            onMouseDown={onHandleDown} onMouseEnter={() => setHandleHover(true)} onMouseLeave={() => setHandleHover(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
              {[30, 20, 30].map((w, i) => <div key={i} style={{ width: w, height: 2, borderRadius: 2, background: gripColor, transition: 'background 0.15s' }} />)}
            </div>
            {dir && (<>
              <div style={{ position: 'absolute', left: 12, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 700, color: dir === 'shrink' ? '#3b82f6' : '#22c55e' }}>
                <span>{dir === 'shrink' ? '↑' : '↓'}</span><span>{dir === 'shrink' ? 'SHORTEN' : 'EXPAND'}</span>
              </div>
              <div style={{ position: 'absolute', right: 12, fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 700, color: dir === 'shrink' ? '#3b82f6' : '#22c55e' }}>{pct}%</div>
            </>)}
            {!dir && handleHover && !node.isProcessing && !node.isStreaming && <span style={{ position: 'absolute', right: 12, fontFamily: 'Inter,system-ui', fontSize: 9, fontWeight: 500, color: '#adb5bd', whiteSpace: 'nowrap' }}>↑ shorten · ↓ expand</span>}
          </div>
        )}
      </div>

      {/* ── Connection dot ────────────────────────────────── */}
      {showDot && (
        <div onMouseDown={onDotMouseDown}
          style={{ position: 'absolute', right: -dotOffset, top: cardH / 2 - dotOffset, width: dotSize, height: dotSize, borderRadius: '50%', background: 'linear-gradient(135deg,#7c3aed,#ec4899)', border: `${borderW}px solid white`, cursor: 'crosshair', zIndex: 200, animation: 'dotGlow 1.5s ease-in-out infinite', transition: 'transform 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.4)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          title="Drag to connect"
        />
      )}

      {/* Drop target label */}
      {isDropTarget && (
        <div style={{ position: 'absolute', bottom: -36, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700, fontFamily: 'Inter,system-ui', whiteSpace: 'nowrap', color: '#fff', background: 'rgba(124,58,237,0.9)', pointerEvents: 'none', zIndex: 200 }}>
          Release to connect
        </div>
      )}

      {/* Resize tooltip */}
      {dir && !node.isProcessing && (
        <div style={{ position: 'absolute', bottom: -42, left: '50%', transform: 'translateX(-50%)', padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: 'Inter,system-ui', whiteSpace: 'nowrap', color: '#fff', background: dir === 'shrink' ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)' : 'linear-gradient(135deg,#22c55e,#15803d)', boxShadow: dir === 'shrink' ? '0 4px 14px rgba(59,130,246,0.5)' : '0 4px 14px rgba(34,197,94,0.5)', zIndex: 200, pointerEvents: 'none' }}>
          {dir === 'shrink' ? `Shorten to ~${pct}%` : `Expand to ~${pct}%`}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div style={{ position: 'absolute', bottom: -42, left: '50%', transform: 'translateX(-50%)', padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: 'Inter,system-ui', whiteSpace: 'nowrap', color: '#fff', background: 'linear-gradient(135deg,#ef4444,#b91c1c)', zIndex: 200, pointerEvents: 'none' }}>
          {error}
        </div>
      )}

      {/* ── Pixel dissolve overlay ───────────────────────── */}
      {isDeleting && (() => {
        const PS = 10;
        const cols = Math.ceil(node.width / PS);
        const rows = Math.ceil(Math.max(cardH, 80) / PS);
        // LCG pseudo-random — deterministic per pixel, visually scattered
        const lcg = (s: number) => Math.imul(s, 1664525) + 1013904223 >>> 0;
        const GRAYS = ['#fff','#e4e4e4','#c8c8c8','#aaa','#888','#555','#2a2a2a','#111'];
        return (
          <div style={{ position: 'absolute', top: 0, left: 0, width: node.width, height: cardH, borderRadius: 14, overflow: 'hidden', pointerEvents: 'none', zIndex: 500 }}>
            {Array.from({ length: rows }, (_, r) =>
              Array.from({ length: cols }, (_, c) => {
                const s1 = lcg(r * 997 + c * 31 + 1);
                const s2 = lcg(s1);
                const s3 = lcg(s2);
                const delay = s1 % 920;           // 0–920 ms, fully random
                const dur   = 60 + s2 % 120;      // 60–180 ms, per-pixel duration
                const bg    = GRAYS[s3 % GRAYS.length];
                return (
                  <div key={`${r}-${c}`} style={{ position: 'absolute', left: c * PS, top: r * PS, width: PS, height: PS, background: bg, animationName: 'pixelEat', animationDuration: `${dur}ms`, animationDelay: `${delay}ms`, animationFillMode: 'both', animationTimingFunction: 'steps(1,end)' }} />
                );
              })
            )}
          </div>
        );
      })()}

      {/* ── Text Selection Menu ──────────────────────────── */}
      {selectionMenu && (
        <div onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', left: selectionMenu.screenX + 10, top: selectionMenu.screenY, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 2, background: '#111', border: '1px solid #2e2e2e', borderRadius: 12, padding: '6px', boxShadow: '0 8px 32px rgba(0,0,0,0.7)', zIndex: 99999, animation: 'menuIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          {([
            { label: 'Enhance',  icon: <Sparkles size={13} strokeWidth={2} />, isEnhance: true },
            { label: 'Improve',  icon: <PenLine   size={13} strokeWidth={2} />, action: 'improve' },
            { label: 'Formal',   icon: <FileText  size={13} strokeWidth={2} />, action: 'formal' },
            { label: 'Casual',   icon: <MessageCircle size={13} strokeWidth={2} />, action: 'informal' },
          ] as const).map(btn => (
            <button key={btn.label}
              onClick={() => ('isEnhance' in btn && btn.isEnhance) ? handleEnhance() : handleSelectionAction((btn as { action: string }).action)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#b0b0b0', fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'background 0.1s, color 0.1s', textAlign: 'left' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#b0b0b0'; }}>
              {btn.icon}{btn.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Enhance Suggestion Panel ─────────────────────── */}
      {enhanceSugg && (
        <div onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', left: enhanceSugg.screenX, top: enhanceSugg.screenY - 16, transform: 'translateX(-50%) translateY(-100%)', width: 340, background: '#0f0a1e', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 16, padding: '16px', boxShadow: '0 16px 56px rgba(0,0,0,0.75)', zIndex: 99999, backdropFilter: 'blur(20px)', animation: 'enhanceIn 0.2s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.06em', textTransform: 'uppercase' }}>✦ Enhance suggestion</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setEnhanceSugg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
          </div>

          {enhanceSugg.loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', fontFamily: 'Inter,system-ui', fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #3b0764', borderTopColor: '#7c3aed', animation: 'spin 0.65s linear infinite' }} />
              Thinking…
            </div>
          ) : (<>
            {/* Original → Enhanced */}
            <div style={{ marginBottom: 10 }}>
              <p style={{ margin: '0 0 4px', fontFamily: 'Inter,system-ui', fontSize: 9, fontWeight: 600, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Original</p>
              <p style={{ margin: 0, fontFamily: "'Lora','Georgia',serif", fontSize: 12, color: '#4b5563', lineHeight: 1.6, textDecoration: 'line-through', opacity: 0.6 }}>{enhanceSugg.original}</p>
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 4px', fontFamily: 'Inter,system-ui', fontSize: 9, fontWeight: 600, color: '#7c3aed', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Enhanced</p>
              <p style={{ margin: 0, fontFamily: "'Lora','Georgia',serif", fontSize: 13, color: '#e5e7eb', lineHeight: 1.65 }}>{enhanceSugg.enhanced}</p>
            </div>
            {enhanceSugg.note && (
              <p style={{ margin: '0 0 14px', fontFamily: 'Inter,system-ui', fontSize: 11, color: '#6d28d9', fontStyle: 'italic', lineHeight: 1.5, borderLeft: '2px solid #4c1d95', paddingLeft: 10 }}>💡 {enhanceSugg.note}</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEnhanceSugg(null)}
                style={{ flex: 1, padding: '8px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'transparent', color: '#6b7280', fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 600 }}>
                Dismiss
              </button>
              <button onClick={acceptEnhancement}
                style={{ flex: 2, padding: '8px', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#7c3aed,#ec4899)', color: '#fff', fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 700, boxShadow: '0 4px 16px rgba(124,58,237,0.4)' }}>
                ✦ Accept
              </button>
            </div>
          </>)}
          {/* Caret */}
          <div style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 10, height: 10, background: '#0f0a1e', borderBottom: '1px solid rgba(124,58,237,0.4)', borderRight: '1px solid rgba(124,58,237,0.4)' }} />
        </div>
      )}
    </div>
  );
}
