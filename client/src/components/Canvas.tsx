import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Plus, ZoomIn, ZoomOut, Brain } from 'lucide-react';
import TextNode, { NodeData } from './TextNode';

interface Viewport { x: number; y: number; scale: number; }
export interface Connection { id: string; fromId: string; toId: string; }
interface ConnDrag { fromId: string; fromCX: number; fromCY: number; curCX: number; curCY: number; }

interface FloatMenu {
  screenX: number; screenY: number;
  canvasX: number; canvasY: number;
  fromId: string;
  mode: 'root' | 'merge-pick';
}

const MIN_SCALE = 0.08, MAX_SCALE = 6;
const NODE_WIDTH = 460, GAP_X = 520, OFFSET_Y = -40;

const PLATFORM_PILLS = [
  { key: 'instagram', label: '📸 Instagram', prompt: 'Rewrite as an Instagram caption. Start with a strong hook. Short punchy sentences, blank line every 2–3 sentences. Conversational tone. End with a question or CTA. Under 300 words.' },
  { key: 'linkedin',  label: '💼 LinkedIn',  prompt: 'Rewrite as a LinkedIn post. Bold opening hook. Professional yet engaging. Short paragraphs (2–3 sentences). Convert key ideas to bullet points with emojis (✅ 🔑 💡). End with a question or takeaway.' },
  { key: 'medium',    label: '📝 Medium',    prompt: 'Rewrite as a Medium article. Use ## subheadings. Insert [📸 Photo suggestion: describe image] between major sections. In-depth, conversational but authoritative. Strong narrative arc.' },
  { key: 'twitter',   label: '𝕏 Twitter',   prompt: 'Rewrite as a Twitter/X thread. Punchy hook tweet first. Number each tweet (1/ 2/ etc.), each under 280 chars. End with a CTA or summary tweet.' },
];

function uid() { return Math.random().toString(36).slice(2, 11); }
function c2s(cx: number, cy: number, vp: Viewport) { return { x: cx * vp.scale + vp.x, y: cy * vp.scale + vp.y }; }
function toCanvas(sx: number, sy: number, vp: Viewport) { return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }; }

// Pick the right edge based on relative position of two nodes
function getConnPts(fromNode: NodeData, toNode: NodeData, heights: Record<string, number>) {
  const fH = heights[fromNode.id] || 220;
  const tH = heights[toNode.id] || 220;
  const fCX = fromNode.x + fromNode.width / 2, fCY = fromNode.y + fH / 2;
  const tCX = toNode.x + toNode.width / 2,     tCY = toNode.y + tH / 2;
  const dx = tCX - fCX, dy = tCY - fCY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) return { p1: { x: fromNode.x + fromNode.width, y: fCY }, p2: { x: toNode.x, y: tCY }, dir: 'h' as const };
    else         return { p1: { x: fromNode.x, y: fCY }, p2: { x: toNode.x + toNode.width, y: tCY }, dir: 'h' as const };
  } else {
    if (dy >= 0) return { p1: { x: fCX, y: fromNode.y + fH }, p2: { x: tCX, y: toNode.y }, dir: 'v' as const };
    else         return { p1: { x: fCX, y: fromNode.y }, p2: { x: tCX, y: toNode.y + tH }, dir: 'v' as const };
  }
}

function screenBezier(p1: { x: number; y: number }, p2: { x: number; y: number }, dir: 'h' | 'v' = 'h') {
  if (dir === 'v') {
    const c = Math.abs(p2.y - p1.y) * 0.55;
    return `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + c}, ${p2.x} ${p2.y - c}, ${p2.x} ${p2.y}`;
  }
  const c = Math.abs(p2.x - p1.x) * 0.55;
  const sx = p2.x >= p1.x ? 1 : -1;
  return `M ${p1.x} ${p1.y} C ${p1.x + sx * c} ${p1.y}, ${p2.x - sx * c} ${p2.y}, ${p2.x} ${p2.y}`;
}

export default function Canvas() {
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connDrag, setConnDrag] = useState<ConnDrag | null>(null);
  const [floatMenu, setFloatMenu] = useState<FloatMenu | null>(null);
  // Prompt panel state — lives completely independently of floatMenu
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptSourceId, setPromptSourceId] = useState<string | null>(null);
  const [promptCanvasPos, setPromptCanvasPos] = useState<{ x: number; y: number } | null>(null);
  const [promptScreenPos, setPromptScreenPos] = useState<{ x: number; y: number } | null>(null);
  const [promptText, setPromptText] = useState('');

  const canvasRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef(viewport);
  const isPanRef = useRef(false);
  const panStart = useRef<{ cx: number; cy: number; vx: number; vy: number } | null>(null);
  const spaceRef = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { vpRef.current = viewport; }, [viewport]);

  // ── Keyboard ─────────────────────────────────────────────────────
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (t === 'TEXTAREA' || t === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); spaceRef.current = true; setIsSpaceHeld(true); }
      if (e.code === 'Escape') { setConnDrag(null); setFloatMenu(null); setPromptOpen(false); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { spaceRef.current = false; setIsSpaceHeld(false); } };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // ── Canvas pan ───────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (connDrag) return;
    const t = e.target as HTMLElement;
    const onSurface = t === canvasRef.current || !!t.dataset.surface;
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault(); isPanRef.current = true; setIsPanning(true);
      panStart.current = { cx: e.clientX, cy: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
    } else if (onSurface) {
      setSelectedId(null);
      setFloatMenu(null);
      setPromptOpen(false);
    }
  }, [connDrag]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanRef.current && panStart.current)
      setViewport(v => ({ ...v, x: panStart.current!.vx + e.clientX - panStart.current!.cx, y: panStart.current!.vy + e.clientY - panStart.current!.cy }));
  }, []);

  const onMouseUp = useCallback(() => { isPanRef.current = false; setIsPanning(false); panStart.current = null; }, []);

  // ── Connection drag (global) ──────────────────────────────────────
  useEffect(() => {
    if (!connDrag) return;
    const onMove = (e: MouseEvent) => {
      const c = toCanvas(e.clientX, e.clientY, vpRef.current);
      setConnDrag(prev => prev ? { ...prev, curCX: c.x, curCY: c.y } : null);
    };
    const onUp = (e: MouseEvent) => {
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let targetId: string | null = null;
      for (const el of els) {
        const nid = (el as HTMLElement).dataset?.nodeid;
        if (nid && nid !== connDrag.fromId) { targetId = nid; break; }
      }
      if (targetId) {
        const tid = targetId;
        setConnections(prev => {
          const dup = prev.some(c => (c.fromId === connDrag.fromId && c.toId === tid) || (c.fromId === tid && c.toId === connDrag.fromId));
          return dup ? prev : [...prev, { id: uid(), fromId: connDrag.fromId, toId: tid }];
        });
      } else {
        const c = toCanvas(e.clientX, e.clientY, vpRef.current);
        setFloatMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: c.x, canvasY: c.y, fromId: connDrag.fromId, mode: 'root' });
      }
      setConnDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [connDrag]);

  // ── Wheel zoom (textarea passthrough) ────────────────────────────
  useEffect(() => {
    const el = canvasRef.current!;
    const handler = (e: WheelEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const f = e.deltaY > 0 ? 0.91 : 1.09;
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setViewport(v => { const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * f)); const r = ns / v.scale; return { x: mx - (mx - v.x) * r, y: my - (my - v.y) * r, scale: ns }; });
      } else setViewport(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ── Node CRUD ────────────────────────────────────────────────────
  const addNode = useCallback(() => {
    const vp = vpRef.current;
    let x: number, y: number;
    if (lastPos.current) { x = lastPos.current.x + GAP_X; y = lastPos.current.y + OFFSET_Y; }
    else { x = (window.innerWidth / 2 - vp.x) / vp.scale - NODE_WIDTH / 2; y = (window.innerHeight / 2 - vp.y) / vp.scale - 140; }
    const id = uid();
    setNodes(p => [...p, { id, x, y, width: NODE_WIDTH, content: '', isProcessing: false, isNew: true }]);
    setOrder(p => [...p, id]);
    setSelectedId(id);
    lastPos.current = { x, y };
    setTimeout(() => setNodes(p => p.map(n => n.id === id ? { ...n, isNew: false } : n)), 400);
  }, []);

  const updateNode = useCallback((id: string, upd: Partial<NodeData>) => setNodes(p => p.map(n => n.id === id ? { ...n, ...upd } : n)), []);
  const deleteNode = useCallback((id: string) => {
    setNodes(p => p.filter(n => n.id !== id));
    setOrder(p => p.filter(x => x !== id));
    setConnections(p => p.filter(c => c.fromId !== id && c.toId !== id));
    setSelectedId(s => s === id ? null : s);
  }, []);
  const removeConnection = useCallback((connId: string) => setConnections(p => p.filter(c => c.id !== connId)), []);
  const bringToFront = useCallback((id: string) => setOrder(p => [...p.filter(x => x !== id), id]), []);
  const updateHeight = useCallback((id: string, h: number) => setNodeHeights(p => p[id] === h ? p : { ...p, [id]: h }), []);
  const onConnectionDragStart = useCallback((fromId: string, fromCX: number, fromCY: number, msx: number, msy: number) => {
    const c = toCanvas(msx, msy, vpRef.current);
    setConnDrag({ fromId, fromCX, fromCY, curCX: c.x, curCY: c.y });
  }, []);

  // ── Typewriter helper ─────────────────────────────────────────────
  const typewriterAnimate = useCallback((nodeId: string, full: string, onDone?: () => void) => {
    let idx = 0;
    const tick = () => {
      if (idx >= full.length) {
        setNodes(p => p.map(n => n.id === nodeId ? { ...n, isStreaming: false } : n));
        onDone?.();
        return;
      }
      setNodes(p => p.map(n => n.id === nodeId ? { ...n, content: n.content + full.slice(idx, idx + 4) } : n));
      idx += 4;
      setTimeout(tick, 16);
    };
    setTimeout(tick, 100);
  }, []);

  // ── Paste image from clipboard ────────────────────────────────
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string;
          const [header, base64] = dataUrl.split(',');
          const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const vp = vpRef.current;
          const x = (window.innerWidth / 2 - vp.x) / vp.scale - NODE_WIDTH / 2;
          const y = (window.innerHeight / 2 - vp.y) / vp.scale - 180;
          const id = uid();
          setNodes(p => [...p, { id, x, y, width: NODE_WIDTH, content: '', isProcessing: false, isStreaming: true, isNew: true, imageData: dataUrl }]);
          setOrder(p => [...p, id]);
          setTimeout(() => setNodes(p => p.map(n => n.id === id ? { ...n, isNew: false } : n)), 400);
          try {
            const res = await fetch('/api/describe-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mimeType }) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.result?.trim()) {
              typewriterAnimate(id, data.result);
            } else {
              setNodes(p => p.map(n => n.id === id ? { ...n, isStreaming: false, content: data.error || '⚠ Analysis failed' } : n));
            }
          } catch (err) {
            console.error('[WRITR] Image describe error:', err);
            setNodes(p => p.map(n => n.id === id ? { ...n, isStreaming: false, content: '⚠ Vision model unavailable' } : n));
          }
        };
        reader.readAsDataURL(file);
        break;
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [typewriterAnimate]);

  // ── Shared: create a streaming node + fetch + typewrite ───────────
  async function createAndStream(
    canvasX: number, canvasY: number,
    fromIds: string[],                  // nodes to connect from
    endpoint: string,
    body: Record<string, string>
  ) {
    const id = uid();
    const x = canvasX - NODE_WIDTH / 2;
    const y = canvasY - 110;
    setNodes(p => [...p, { id, x, y, width: NODE_WIDTH, content: '', isProcessing: false, isStreaming: true, isNew: true }]);
    setOrder(p => [...p, id]);
    setConnections(prev => [...prev, ...fromIds.map(fid => ({ id: uid(), fromId: fid, toId: id }))]);
    setTimeout(() => setNodes(p => p.map(n => n.id === id ? { ...n, isNew: false } : n)), 400);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data: { result?: string; error?: string } = {};
      try { data = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        console.error(`[WRITR] ${endpoint} failed:`, res.status, data);
        setNodes(p => p.map(n => n.id === id ? { ...n, isStreaming: false, content: `⚠ ${msg}` } : n));
        return;
      }
      if (data.result?.trim()) {
        typewriterAnimate(id, data.result);
      } else {
        console.error(`[WRITR] ${endpoint} returned empty result`, data);
        setNodes(p => p.map(n => n.id === id ? { ...n, isStreaming: false, content: data.error ? `⚠ ${data.error}` : '⚠ Empty response' } : n));
      }
    } catch (err) {
      console.error(`[WRITR] ${endpoint} network error:`, err);
      setNodes(p => p.map(n => n.id === id ? { ...n, isStreaming: false, content: `⚠ Network error — is the server running on port 3001?` } : n));
    }
  }

  // ── Float menu actions ────────────────────────────────────────────
  function openPromptFromMenu() {
    if (!floatMenu) return;
    setPromptSourceId(floatMenu.fromId);
    setPromptCanvasPos({ x: floatMenu.canvasX, y: floatMenu.canvasY });
    setPromptScreenPos({ x: floatMenu.screenX, y: floatMenu.screenY });
    setPromptText('');
    setPromptOpen(true);
    setFloatMenu(null);
  }

  function openMergePickFromMenu() {
    if (!floatMenu) return;
    setFloatMenu({ ...floatMenu, mode: 'merge-pick' });
  }

  function doNewNode() {
    if (!floatMenu) return;
    const id = uid();
    const x = floatMenu.canvasX - NODE_WIDTH / 2;
    const y = floatMenu.canvasY - 110;
    setNodes(p => [...p, { id, x, y, width: NODE_WIDTH, content: '', isProcessing: false, isNew: true }]);
    setOrder(p => [...p, id]);
    setConnections(p => [...p, { id: uid(), fromId: floatMenu.fromId, toId: id }]);
    setFloatMenu(null);
    setTimeout(() => setNodes(p => p.map(n => n.id === id ? { ...n, isNew: false } : n)), 400);
  }

  function doBrainstorm() {
    if (!floatMenu) return;
    const id = uid();
    const BWIDTH = 400;
    const x = floatMenu.canvasX - BWIDTH / 2;
    const y = floatMenu.canvasY - 230;
    setNodes(p => [...p, { id, x, y, width: BWIDTH, content: '', isProcessing: false, isNew: true, isBrainstorm: true, chatHistory: [] }]);
    setOrder(p => [...p, id]);
    setConnections(p => [...p, { id: uid(), fromId: floatMenu.fromId, toId: id }]);
    setFloatMenu(null);
    setTimeout(() => setNodes(p => p.map(n => n.id === id ? { ...n, isNew: false } : n)), 400);
  }

  async function doMergeWithNode(targetId: string) {
    if (!floatMenu) return;
    const from = nodes.find(n => n.id === floatMenu.fromId);
    const to   = nodes.find(n => n.id === targetId);
    if (!from?.content?.trim() || !to?.content?.trim()) return;
    const { canvasX, canvasY } = floatMenu;
    setFloatMenu(null);
    await createAndStream(canvasX, canvasY, [floatMenu.fromId, targetId], '/api/merge-text', { text1: from.content, text2: to.content });
  }

  // ── Prompt submit — reads directly from state (no stale closure) ──
  async function doPromptSubmit() {
    const prompt = promptText.trim();
    if (!promptSourceId || !prompt || !promptCanvasPos) return;
    const sourceNode = nodes.find(n => n.id === promptSourceId);
    if (!sourceNode?.content?.trim()) return;
    const { x, y } = promptCanvasPos;
    const sid = promptSourceId;
    const text = sourceNode.content;
    setPromptOpen(false);
    setPromptText('');
    await createAndStream(x, y, [sid], '/api/prompt-node', { text, prompt });
  }

  // ── Connection line midpoint (screen) ────────────────────────────
  function connMidScreen(conn: Connection) {
    const fromNode = nodes.find(n => n.id === conn.fromId);
    const toNode   = nodes.find(n => n.id === conn.toId);
    if (!fromNode || !toNode) return null;
    const { p1: p1c, p2: p2c } = getConnPts(fromNode, toNode, nodeHeights);
    const p1 = c2s(p1c.x, p1c.y, viewport);
    const p2 = c2s(p2c.x, p2c.y, viewport);
    return { mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
  }

  const sorted = [...nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const isDragActive = connDrag !== null;
  const cursor = isPanning ? 'grabbing' : connDrag ? 'crosshair' : isSpaceHeld ? 'grab' : 'default';

  // Nodes selectable in merge picker
  const mergePickNodes = floatMenu?.mode === 'merge-pick'
    ? nodes.filter(n => n.id !== floatMenu.fromId && n.content.trim())
    : [];

  return (
    <div ref={canvasRef}
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#0d0d0d', cursor }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>

      {/* ── Dot grid ─────────────────────────────────────────────── */}
      <div data-surface="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, #222 1.2px, transparent 1.2px)', backgroundSize: '28px 28px', backgroundPosition: `${viewport.x % 28}px ${viewport.y % 28}px` }} />

      {/* ── SVG lines ─────────────────────────────────────────────── */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 50, overflow: 'visible' }}>
        <defs>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c3aed" /><stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          <linearGradient id="dragGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.85" /><stop offset="100%" stopColor="#ec4899" stopOpacity="0.85" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {connections.map(conn => {
          const fromNode = nodes.find(n => n.id === conn.fromId);
          const toNode   = nodes.find(n => n.id === conn.toId);
          if (!fromNode || !toNode) return null;
          const { p1: p1c, p2: p2c, dir } = getConnPts(fromNode, toNode, nodeHeights);
          const p1 = c2s(p1c.x, p1c.y, viewport);
          const p2 = c2s(p2c.x, p2c.y, viewport);
          const d  = screenBezier(p1, p2, dir);
          return (
            <g key={conn.id} style={{ animation: 'connLineIn 0.45s ease-out both' }}>
              <path d={d} stroke="url(#lineGrad)" strokeWidth={8} fill="none" opacity={0.15} filter="url(#glow)" />
              <path d={d} stroke="url(#lineGrad)" strokeWidth={2.5} fill="none" strokeDasharray="10 6"
                style={{ animation: 'dashFlow 0.7s linear infinite' }} />
              <circle cx={p1.x} cy={p1.y} r={5} fill="#7c3aed"
                style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'springDotIn 0.75s cubic-bezier(0.34,1.56,0.64,1) both, gravityFloat 2.8s ease-in-out 0.75s infinite' }} />
              <circle cx={p2.x} cy={p2.y} r={5} fill="#ec4899"
                style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'springDotIn 0.75s cubic-bezier(0.34,1.56,0.64,1) 0.08s both, gravityFloat 2.8s ease-in-out 0.83s infinite' }} />
            </g>
          );
        })}

        {connDrag && (() => {
          const p1 = c2s(connDrag.fromCX, connDrag.fromCY, viewport);
          const p2 = c2s(connDrag.curCX, connDrag.curCY, viewport);
          const d  = screenBezier(p1, p2);
          return (
            <g>
              <path d={d} stroke="url(#dragGrad)" strokeWidth={7} fill="none" opacity={0.12} />
              <path d={d} stroke="url(#dragGrad)" strokeWidth={2} fill="none" strokeDasharray="8 5"
                style={{ animation: 'dashFlow 0.55s linear infinite' }} />
              <circle cx={p1.x} cy={p1.y} r={6} fill="#7c3aed" />
              <circle cx={p2.x} cy={p2.y} r={6} fill="#ec4899" opacity={0.8} />
            </g>
          );
        })()}
      </svg>

      {/* ── Remove (✕) buttons on connection midpoints ───────────── */}
      {connections.map(conn => {
        const mid = connMidScreen(conn);
        if (!mid) return null;
        return (
          <button key={`rm-${conn.id}`}
            onClick={e => { e.stopPropagation(); removeConnection(conn.id); }}
            title="Remove connection"
            style={{ position: 'absolute', left: mid.mx, top: mid.my, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'rgba(12,8,24,0.85)', color: '#555', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, backdropFilter: 'blur(8px)', transition: 'color 0.15s, background 0.15s', lineHeight: 1, padding: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.background = 'rgba(12,8,24,0.85)'; }}>
            ✕
          </button>
        );
      })}

      {/* ── Canvas world ─────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', transform: `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`, willChange: 'transform' }}>
        {sorted.map(node => {
          const connectedContents = node.isBrainstorm
            ? connections
                .filter(c => c.fromId === node.id || c.toId === node.id)
                .flatMap(c => {
                  const otherId = c.fromId === node.id ? c.toId : c.fromId;
                  const other = nodes.find(n => n.id === otherId);
                  return other?.content?.trim() && !other.isBrainstorm ? [other.content] : [];
                })
            : undefined;
          return (
            <TextNode key={node.id} node={node}
              isSelected={selectedId === node.id}
              scale={viewport.scale}
              isSpaceHeld={isSpaceHeld}
              isDragActive={isDragActive}
              isDropTarget={isDragActive && connDrag?.fromId !== node.id}
              onSelect={() => { setSelectedId(node.id); bringToFront(node.id); }}
              onUpdate={upd => updateNode(node.id, upd)}
              onDelete={() => deleteNode(node.id)}
              onBringToFront={() => bringToFront(node.id)}
              onConnectionDragStart={(fx, fy, mx, my) => onConnectionDragStart(node.id, fx, fy, mx, my)}
              onHeightChange={h => updateHeight(node.id, h)}
              connectedContents={connectedContents}
            />
          );
        })}
      </div>

      {/* ── Float menu (root or merge-pick mode) ─────────────────── */}
      {floatMenu && (() => {
        const W = floatMenu.mode === 'merge-pick' ? 260 : 220;
        const left = Math.min(floatMenu.screenX - W / 2, window.innerWidth - W - 12);
        const top  = Math.min(floatMenu.screenY + 10, window.innerHeight - 200);

        return (
          <div onMouseDown={e => e.stopPropagation()}
            style={{ position: 'fixed', left, top, width: W, background: 'rgba(10,6,22,0.97)', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 14, padding: '8px', boxShadow: '0 14px 56px rgba(0,0,0,0.75)', zIndex: 9000, backdropFilter: 'blur(20px)', animation: 'menuIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both' }}>

            {floatMenu.mode === 'root' && <>
              <p style={{ margin: '0 0 7px 4px', fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 600, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>From this node</p>
              <MenuBtn onClick={openPromptFromMenu} accent>✦ Prompt <Dim>— transform &amp; style</Dim></MenuBtn>
              <MenuBtn onClick={doBrainstorm}><Brain size={12} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5, marginTop: -1 }} /> Brainstorm <Dim>— think &amp; explore</Dim></MenuBtn>
              <MenuBtn onClick={openMergePickFromMenu}>⊕ Merge <Dim>— blend with another node</Dim></MenuBtn>
              <MenuBtn onClick={doNewNode}>○ New Node <Dim>— blank, connected</Dim></MenuBtn>
            </>}

            {floatMenu.mode === 'merge-pick' && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <button onClick={() => setFloatMenu({ ...floatMenu, mode: 'root' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>←</button>
                <p style={{ margin: 0, fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 600, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Pick a node to merge with</p>
              </div>
              {mergePickNodes.length === 0
                ? <p style={{ fontFamily: 'Inter,system-ui', fontSize: 12, color: '#4b5563', margin: '8px 4px', textAlign: 'center' }}>No other nodes with content</p>
                : mergePickNodes.map(n => (
                  <button key={n.id} onClick={() => doMergeWithNode(n.id)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(124,58,237,0.1)', color: '#c4b5fd', fontFamily: 'Inter,system-ui', fontSize: 12, fontWeight: 500, textAlign: 'left', marginBottom: 5, transition: 'background 0.12s', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.25)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.1)')}>
                    {n.content.slice(0, 55)}{n.content.length > 55 ? '…' : ''}
                  </button>
                ))
              }
            </>}
          </div>
        );
      })()}

      {/* ── Prompt Panel ─────────────────────────────────────────── */}
      {promptOpen && (() => {
        const W = 380;
        const sx = promptScreenPos?.x ?? window.innerWidth / 2;
        const sy = promptScreenPos?.y ?? window.innerHeight / 2;
        const left = Math.min(sx - W / 2, window.innerWidth - W - 12);
        const top  = Math.max(12, Math.min(sy - 20, window.innerHeight - 360));

        return (
          <div onMouseDown={e => e.stopPropagation()}
            style={{ position: 'fixed', left, top, width: W, background: 'rgba(10,6,22,0.98)', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 18, padding: '20px', boxShadow: '0 20px 72px rgba(0,0,0,0.85)', zIndex: 9000, backdropFilter: 'blur(24px)', animation: 'menuIn 0.2s cubic-bezier(0.34,1.56,0.64,1) both' }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontFamily: 'Inter,system-ui', fontSize: 13, fontWeight: 700, color: '#c4b5fd' }}>✦ Prompt Transform</span>
              <button onClick={() => { setPromptOpen(false); setPromptText(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 16, lineHeight: 1, padding: '0 2px', transition: 'color 0.12s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')} onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}>✕</button>
            </div>

            {/* Textarea first */}
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              placeholder={"Describe how to transform this…\ne.g. Rewrite as a product launch announcement"}
              rows={4}
              autoFocus
              style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.06)', color: '#e5e7eb', fontFamily: 'Inter,system-ui', fontSize: 12, lineHeight: 1.65, padding: '12px 14px', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.7)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.3)')}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doPromptSubmit(); } }}
            />

            {/* Platform pills */}
            <p style={{ margin: '0 0 8px 2px', fontFamily: 'Inter,system-ui', fontSize: 10, fontWeight: 600, color: '#4b5563', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Quick presets — click to load</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
              {PLATFORM_PILLS.map(p => (
                <button key={p.key} onClick={() => setPromptText(p.prompt)}
                  style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${promptText === p.prompt ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.1)'}`, cursor: 'pointer', background: promptText === p.prompt ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.05)', color: promptText === p.prompt ? '#c4b5fd' : '#9ca3af', fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                  onMouseEnter={e => { if (promptText !== p.prompt) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#e5e7eb'; } }}
                  onMouseLeave={e => { if (promptText !== p.prompt) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#9ca3af'; } }}>
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setPromptOpen(false); setPromptText(''); }}
                style={{ flex: 1, padding: '10px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', background: 'transparent', color: '#6b7280', fontFamily: 'Inter,system-ui', fontSize: 12, fontWeight: 600 }}>
                Cancel
              </button>
              <button onClick={doPromptSubmit} disabled={!promptText.trim()}
                style={{ flex: 2, padding: '10px', borderRadius: 11, border: 'none', cursor: promptText.trim() ? 'pointer' : 'default', background: promptText.trim() ? 'linear-gradient(135deg,#7c3aed,#ec4899)' : 'rgba(255,255,255,0.06)', color: promptText.trim() ? '#fff' : '#4b5563', fontFamily: 'Inter,system-ui', fontSize: 12, fontWeight: 700, boxShadow: promptText.trim() ? '0 4px 20px rgba(124,58,237,0.45)' : 'none', transition: 'all 0.15s' }}>
                ✦ Transform &nbsp;<span style={{ opacity: 0.65, fontWeight: 400, fontSize: 10 }}>⌘↵</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 10 }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ opacity: 0.08 }}><path d="M20 4L23.5 16.5H36L25.7 24.1L29.2 36.6L20 29L10.8 36.6L14.3 24.1L4 16.5H16.5L20 4Z" fill="#fff" /></svg>
          <p style={{ color: '#2e2e2e', fontSize: 15, fontFamily: 'Inter,system-ui', fontWeight: 500, margin: 0 }}>Your canvas is empty</p>
          <p style={{ color: '#222', fontSize: 12, fontFamily: 'Inter,system-ui', margin: 0 }}>Click + to place your first text node</p>
        </div>
      )}

      {/* Connection drag hint */}
      {connDrag && (
        <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,10,30,0.92)', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 12, padding: '8px 18px', fontFamily: 'Inter,system-ui', fontSize: 12, color: '#c4b5fd', fontWeight: 600, pointerEvents: 'none', zIndex: 9999 }}>
          Drop on a node to connect · Drop on canvas to open menu · Esc to cancel
        </div>
      )}

      {/* ── WRITR brand ──────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: 22, left: 24, zIndex: 100, pointerEvents: 'none', userSelect: 'none' }}>
        <span style={{ fontFamily: 'Inter,system-ui', fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em' }}>WRITR</span>
      </div>

      {/* Bottom bar */}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, background: '#161616', border: '1px solid #272727', borderRadius: 14, padding: '7px 12px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', userSelect: 'none', zIndex: 100 }}>
        <ToolBtn onClick={() => setViewport(v => ({ ...v, scale: Math.max(MIN_SCALE, v.scale * 0.83) }))}><ZoomOut size={13} /></ToolBtn>
        <button onClick={() => setViewport({ x: 0, y: 0, scale: 1 })} style={{ fontFamily: 'Inter,system-ui', fontSize: 11, fontWeight: 600, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '0 6px', minWidth: 40 }} onMouseEnter={e => (e.currentTarget.style.color = '#aaa')} onMouseLeave={e => (e.currentTarget.style.color = '#555')}>
          {Math.round(viewport.scale * 100)}%
        </button>
        <ToolBtn onClick={() => setViewport(v => ({ ...v, scale: Math.min(MAX_SCALE, v.scale * 1.2) }))}><ZoomIn size={13} /></ToolBtn>
        <div style={{ width: 1, height: 16, background: '#272727', margin: '0 4px' }} />
        <span style={{ fontSize: 10, color: '#2e2e2e', fontFamily: 'Inter,system-ui', whiteSpace: 'nowrap' }}>
          Space+drag to pan · Ctrl+scroll to zoom · hover edge to connect
        </span>
      </div>

      {/* Add button */}
      <button onClick={addNode}
        style={{ position: 'fixed', bottom: 24, right: 24, width: 52, height: 52, borderRadius: '50%', background: '#fff', color: '#0d0d0d', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s', zIndex: 100 }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.5)'; }}>
        <Plus size={20} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 11 }}>{children}</span>;
}

function MenuBtn({ onClick, children, accent }: { onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  const base = accent
    ? 'linear-gradient(135deg,rgba(124,58,237,0.22),rgba(236,72,153,0.12))'
    : 'rgba(255,255,255,0.05)';
  const hover = accent
    ? 'linear-gradient(135deg,rgba(124,58,237,0.38),rgba(236,72,153,0.28))'
    : 'rgba(255,255,255,0.1)';
  return (
    <button onClick={onClick}
      style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: base, color: accent ? '#c4b5fd' : '#9ca3af', fontFamily: 'Inter,system-ui', fontSize: 12, fontWeight: 600, textAlign: 'left', marginBottom: 5, transition: 'background 0.12s', display: 'block' }}
      onMouseEnter={e => (e.currentTarget.style.background = hover)}
      onMouseLeave={e => (e.currentTarget.style.background = base)}>
      {children}
    </button>
  );
}

function ToolBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ width: 28, height: 28, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s, color 0.12s' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.color = '#bbb'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#555'; }}>
      {children}
    </button>
  );
}
