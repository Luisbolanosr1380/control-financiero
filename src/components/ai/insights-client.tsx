'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import type { AnalisisRegistro, CostoAcumulado } from '@/lib/db/ai-analisis';

// Tipo de cambio aproximado USD→GTQ (mismo que el server)
const TC_APROX = 7.7;

const fmtUSD = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const fmtUSDtoQ = (n: number) => `${fmtUSD(n)} ~ ${Q(n * TC_APROX)}`;

interface Props {
  ultimo: AnalisisRegistro | null;
  historial: AnalisisRegistro[];
  costo: CostoAcumulado;
  puedeGenerar?: boolean;
  proximaVentana?: string | null;
}

export function AiInsightsClient({ ultimo, historial, costo, puedeGenerar = true, proximaVentana = null }: Props) {
  const router = useRouter();
  const [viendoId, setViendoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cuál se está mostrando: el seleccionado o el último por default
  const actual: AnalisisRegistro | null = viendoId
    ? historial.find(h => h.id === viendoId) ?? ultimo
    : ultimo;

  const regenerar = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ai/analisis', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(typeof data?.error === 'string' ? data.error : `Error HTTP ${resp.status}`);
      } else {
        // server revalidó /ai; refresh trae el nuevo último + historial + costo actualizados
        setViendoId(null);
        router.refresh();
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
            Lectura del negocio generada con AI. Persiste en Airtable — no se pierde al recargar.
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={regenerar}
            disabled={loading || !puedeGenerar}
            title={!puedeGenerar && proximaVentana
              ? `Análisis manual disponible solo lunes y últimos 2 días del mes. Próxima ventana: ${proximaVentana}.`
              : !puedeGenerar
                ? 'Tu rol no incluye la generación de análisis manual.'
                : undefined}
          >
            {loading ? <><I.Refresh size={13} /> Generando…</> : <><I.Sparkles size={13} /> Regenerar análisis</>}
          </button>
        </div>
      </div>

      {/* Aviso fijo */}
      <div className="card" style={{ marginBottom: 18, background: '#FBF3E0', borderColor: 'var(--amber)' }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <I.Alert size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Generado por AI a partir de tus datos.</strong> Los números vienen del sistema; la lectura es interpretación. Validá antes de decidir — la AI no calcula, redacta.
          </div>
        </div>
      </div>

      {/* Costo */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
        <CostoKpi
          label="Este análisis"
          big={actual ? fmtUSD(actual.costoUSD) : '—'}
          sub={actual ? `~ ${Q(actual.costoUSD * TC_APROX)}` : ''}
        />
        <CostoKpi
          label="Acumulado en AI"
          big={fmtUSD(costo.totalUSD)}
          sub={`~ ${Q(costo.totalUSD * TC_APROX)} · ${costo.cantidad} análisis`}
        />
        <CostoKpi
          label="Este mes"
          big={fmtUSD(costo.esteMesUSD)}
          sub={`~ ${Q(costo.esteMesUSD * TC_APROX)}`}
        />
        <div className="kpi" style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          <div className="kpi-label">Conversión a quetzales</div>
          <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-2)' }}>
            <span className="num">Q{TC_APROX.toFixed(2)}</span> por USD ·
            <span style={{ color: 'var(--ink-4)' }}> tipo de cambio aproximado</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 6 }}>
            Precio Gemini 2.5 Flash: $0.30/M input · $2.50/M output
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 18, background: '#F5E2DD', borderColor: 'var(--wine)' }}>
          <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--ink-2)' }}>
            <I.Alert size={14} style={{ color: 'var(--wine)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>No se pudo generar el análisis.</strong>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{error}</div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 32, fontSize: 13 }}>
            <I.Refresh size={20} style={{ opacity: 0.55, marginBottom: 8 }} />
            <div>Generando análisis · esto puede tardar 15-30 segundos…</div>
          </div>
        </div>
      )}

      {!actual && !loading && !error && (
        <div className="card">
          <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 56, fontSize: 13 }}>
            <I.Sparkles size={26} style={{ opacity: 0.45, marginBottom: 10 }} />
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 6 }}>Sin análisis generado todavía.</div>
            <div>Tocá <strong>"Regenerar análisis"</strong> para crear el primero.</div>
          </div>
        </div>
      )}

      {actual && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
          {/* Texto del análisis actual */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Análisis del negocio</div>
              <div className="card-actions" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                <span className="num">{actual.modelo}</span>
                <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
                <span>{formatTimestamp(actual.fecha)}</span>
                <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
                <span className="num">{actual.duracionSeg.toFixed(1)}s</span>
                <span style={{ margin: '0 6px', color: 'var(--line-2)' }}>·</span>
                <span className="num">{actual.tokensInput + actual.tokensOutput} tok</span>
              </div>
            </div>
            <div className="card-pad" style={{ paddingTop: 14 }}>
              <Markdown text={actual.texto} />
            </div>
          </div>

          {/* Historial */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <div className="card-title">Histórico</div>
              <div className="card-actions">
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }} className="num">{historial.length}</span>
              </div>
            </div>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {historial.length === 0 ? (
                <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Sin análisis previos.</div>
              ) : historial.map(h => {
                const isActive = h.id === actual.id;
                const preview = h.texto.replace(/[#*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setViendoId(h.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '12px 16px', borderBottom: '1px solid var(--line-3)',
                      background: isActive ? 'var(--bg-2)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: isActive ? 600 : 500 }}>{formatTimestampShort(h.fecha)}</span>
                      <span className="num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{fmtUSD(h.costoUSD)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{preview}…</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CostoKpi({ label, big, sub }: { label: string; big: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{big}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }} className="num">{sub}</div>}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

function formatTimestampShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-GT', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/* Render mínimo de markdown (igual que antes). */
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
      out.push(<h2 key={`h-${idx}`} style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', margin: '20px 0 10px' }}>{line.replace(/^#\s+/, '')}</h2>);
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
      out.push(<p key={`p-${idx}`} style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 10px' }}>{inline(line)}</p>);
    }
  });
  flushList(lines.length);
  return <div>{out}</div>;
}

function inline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1] != null) parts.push(<strong key={k++} style={{ color: 'var(--ink)', fontWeight: 600 }}>{m[1]}</strong>);
    else if (m[2] != null) parts.push(<em key={k++} style={{ fontStyle: 'italic' }}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts.length ? parts : s;
}
