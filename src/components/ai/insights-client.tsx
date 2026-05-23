'use client';

import { useState } from 'react';
import { I } from '@/components/common/icons';

interface Resultado {
  modelo: string;
  generadoEn: string;
  ms: { calculos: number; ai: number; total: number };
  tokens?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  analisis: string;
}

export function AiInsightsClient() {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generar = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ai/analisis', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(typeof data?.error === 'string' ? data.error : `Error HTTP ${resp.status}`);
      } else {
        setRes({
          modelo: data.modelo,
          generadoEn: data.generadoEn,
          ms: data.ms,
          tokens: data.tokens,
          analisis: data.analisis,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Insights</h1>
          <div className="page-subtitle">
            Lectura del negocio generada con AI a partir de tus datos. Tarda unos segundos.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={generar} disabled={loading}>
            {loading ? <><I.Refresh size={13} /> Generando…</> : <><I.Sparkles size={13} /> Generar análisis</>}
          </button>
        </div>
      </div>

      {/* Nota fija sobre la naturaleza del análisis */}
      <div className="card" style={{ marginBottom: 18, background: '#FBF3E0', borderColor: 'var(--amber)' }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <I.Alert size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Generado por AI a partir de tus datos.</strong> Los números vienen del sistema; la lectura es interpretación. Validá antes de decidir — la AI no calcula, redacta.
          </div>
        </div>
      </div>

      {!res && !loading && !error && (
        <div className="card">
          <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 56, fontSize: 13 }}>
            <I.Sparkles size={26} style={{ opacity: 0.45, marginBottom: 10 }} />
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 6 }}>Sin análisis generado.</div>
            <div>Tocá <strong>"Generar análisis"</strong> para obtener una lectura accionable basada en tu cartera y facturación de los últimos 12 meses.</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="card">
          <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 56, fontSize: 13 }}>
            <div style={{ marginBottom: 10 }}><I.Refresh size={20} style={{ opacity: 0.55 }} /></div>
            Generando análisis · esto puede tardar 10-30 segundos…
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ background: '#F5E2DD', borderColor: 'var(--wine-bg, var(--wine))' }}>
          <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--ink-2)' }}>
            <I.Alert size={14} style={{ color: 'var(--wine)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>No se pudo generar el análisis.</strong>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{error}</div>
            </div>
          </div>
        </div>
      )}

      {res && !loading && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Análisis del negocio</div>
            <div className="card-actions" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              <span className="num">{res.modelo}</span>
              <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
              <span>{formatTimestamp(res.generadoEn)}</span>
              <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
              <span className="num">{(res.ms.total / 1000).toFixed(1)}s</span>
              {res.tokens?.totalTokens != null && (
                <>
                  <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
                  <span className="num">{res.tokens.totalTokens} tok</span>
                </>
              )}
            </div>
          </div>
          <div className="card-pad" style={{ paddingTop: 14 }}>
            <Markdown text={res.analisis} />
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

/**
 * Render mínimo de markdown: ## headings, listas - / 1., párrafos, **bold**, *italic*.
 * Suficiente para la salida estructurada del prompt.
 */
function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;

  const flushList = (key: number) => {
    if (listBuf.length === 0) return;
    const Tag = listKind === 'ol' ? 'ol' : 'ul';
    out.push(
      <Tag key={`list-${key}`} style={{ margin: '6px 0 14px 22px', paddingLeft: 0, lineHeight: 1.6, fontSize: 13.5, color: 'var(--ink-2)' }}>
        {listBuf.map((item, i) => <li key={i} style={{ marginBottom: 4 }}>{inline(item)}</li>)}
      </Tag>,
    );
    listBuf = [];
    listKind = null;
  };

  lines.forEach((line, idx) => {
    if (/^##\s+/.test(line)) {
      flushList(idx);
      out.push(
        <h3 key={`h-${idx}`} style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', margin: '20px 0 8px', letterSpacing: '-0.005em' }}>
          {line.replace(/^##\s+/, '')}
        </h3>,
      );
    } else if (/^#\s+/.test(line)) {
      flushList(idx);
      out.push(
        <h2 key={`h-${idx}`} style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', margin: '20px 0 10px' }}>
          {line.replace(/^#\s+/, '')}
        </h2>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (listKind !== 'ul') flushList(idx);
      listKind = 'ul';
      listBuf.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (listKind !== 'ol') flushList(idx);
      listKind = 'ol';
      listBuf.push(line.replace(/^\s*\d+\.\s+/, ''));
    } else if (line.trim() === '') {
      flushList(idx);
    } else {
      flushList(idx);
      out.push(
        <p key={`p-${idx}`} style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 10px' }}>
          {inline(line)}
        </p>,
      );
    }
  });
  flushList(lines.length);

  return <div>{out}</div>;
}

// Soporta **bold** y *italic* mínimos
function inline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1] != null) parts.push(<strong key={k++} style={{ color: 'var(--ink)', fontWeight: 600 }}>{m[1]}</strong>);
    else if (m[2] != null) parts.push(<em key={k++} style={{ fontStyle: 'italic' }}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts.length ? parts : s;
}
