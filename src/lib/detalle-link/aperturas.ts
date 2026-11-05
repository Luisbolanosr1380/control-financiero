/**
 * REGISTRO DE APERTURAS DEL LINK (031) · «¿alguien lo vio?» — PURO (sin IO, va al navegador de Finanzas).
 *
 * Qué se guarda por apertura: fecha y hora, dispositivo (movil / escritorio / tablet / desconocido) y navegador
 * (familia corta) derivados del user agent EN EL SERVIDOR, y un hash de la red (sha256(ip + secreto) truncado) que
 * sirve para distinguir «otra red» sin guardar la IP. Las aperturas desde la red de quien envió el link (Enviar al
 * cliente / Copiar link) se marcan «desde la red de quien envió (probablemente Golden)» y NO cuentan.
 *
 * «Abierto» nunca es «leído por el cliente»: un antivirus de correo puede ejecutar JS y contar como apertura.
 */

export type Dispositivo = 'movil' | 'escritorio' | 'tablet' | 'desconocido';
export const ETIQUETA_DISPOSITIVO: Record<Dispositivo, string> = { movil: 'móvil', escritorio: 'escritorio', tablet: 'tablet', desconocido: 'dispositivo desconocido' };

export interface AperturaLink {
  id: string; linkId: string; version: number; abiertoEn: string;
  dispositivo: Dispositivo; navegador: string; ipHash: string | null; respondio: boolean;
}

/** Dispositivo y familia de navegador a partir del user agent. Nunca devuelve el user agent completo. */
export function clasificarUserAgent(ua: string | null | undefined): { dispositivo: Dispositivo; navegador: string } {
  const s = String(ua ?? '').slice(0, 600);
  if (!s.trim()) return { dispositivo: 'desconocido', navegador: 'desconocido' };
  const esTablet = /\biPad\b|Tablet|Android(?!.*Mobile)/i.test(s);
  const esMovil = !esTablet && /\bMobile\b|iPhone|iPod|Android.*Mobile|Windows Phone|webOS|Opera Mini|IEMobile/i.test(s);
  const dispositivo: Dispositivo = esTablet ? 'tablet' : esMovil ? 'movil' : /Windows|Macintosh|X11|Linux|CrOS/i.test(s) ? 'escritorio' : 'desconocido';
  let navegador = 'otro';
  if (/MSOffice|Microsoft Office|Outlook/i.test(s)) navegador = 'Outlook';
  else if (/GoogleImageProxy|ggpht/i.test(s)) navegador = 'Gmail (proxy)';
  else if (/bot|crawler|spider|preview|scanner|urlscan|safelinks|proofpoint|mimecast|barracuda|curl|wget|python-requests|Go-http-client/i.test(s)) navegador = 'robot / antivirus';
  else if (/Edg(e|A|iOS)?\//i.test(s)) navegador = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) navegador = 'Opera';
  else if (/SamsungBrowser/i.test(s)) navegador = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(s)) navegador = 'Firefox';
  else if (/CriOS\//i.test(s)) navegador = 'Chrome';
  else if (/Chrome\/|Chromium\//i.test(s)) navegador = 'Chrome';
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) navegador = 'Safari';
  else if (/Safari\//i.test(s)) navegador = 'Safari';
  else if (/Trident|MSIE/i.test(s)) navegador = 'Internet Explorer';
  return { dispositivo, navegador };
}

export type MarcaRed = 'creador' | 'primera' | 'misma_red' | 'otra_red';
export const ETIQUETA_MARCA_RED: Record<MarcaRed, string> = {
  creador: 'desde la red de quien envió (probablemente Golden)',
  primera: 'primera apertura',
  misma_red: 'misma red que la primera',
  otra_red: 'otra red',
};

export interface ResumenAperturas {
  /** aperturas que cuentan (sin las de la red de quien envió) */ n: number;
  /** aperturas desde la red de quien envió */ propias: number;
  primera: string | null; ultima: string | null;
  /** dispositivos distintos entre las que cuentan (red + dispositivo + navegador) */ dispositivos: number;
  /** alguna apertura que cuenta tiene `respondio` */ respondio: boolean;
}

const esDelCreador = (a: AperturaLink, creadorIpHash: string | null | undefined): boolean => !!creadorIpHash && !!a.ipHash && a.ipHash === creadorIpHash;
const porFecha = (x: AperturaLink, y: AperturaLink) => Date.parse(x.abiertoEn) - Date.parse(y.abiertoEn);

/** Las aperturas que cuentan, de la más vieja a la más nueva. */
export function aperturasQueCuentan(aperturas: readonly AperturaLink[], creadorIpHash: string | null | undefined): AperturaLink[] {
  return aperturas.filter(a => !esDelCreador(a, creadorIpHash)).sort(porFecha);
}

export function resumenAperturas(aperturas: readonly AperturaLink[], creadorIpHash: string | null | undefined): ResumenAperturas {
  const cuentan = aperturasQueCuentan(aperturas, creadorIpHash);
  const dispositivos = new Set(cuentan.map(a => `${a.ipHash ?? ''}|${a.dispositivo}|${a.navegador}`)).size;
  return {
    n: cuentan.length, propias: aperturas.length - cuentan.length,
    primera: cuentan[0]?.abiertoEn ?? null, ultima: cuentan[cuentan.length - 1]?.abiertoEn ?? null,
    dispositivos, respondio: cuentan.some(a => a.respondio),
  };
}

/** Marca de red de una apertura respecto de la primera que cuenta y de la red de quien envió. */
export function marcaRed(a: AperturaLink, aperturas: readonly AperturaLink[], creadorIpHash: string | null | undefined): MarcaRed {
  if (esDelCreador(a, creadorIpHash)) return 'creador';
  const primera = aperturasQueCuentan(aperturas, creadorIpHash)[0];
  if (!primera || primera.id === a.id) return 'primera';
  return a.ipHash && primera.ipHash && a.ipHash === primera.ipHash ? 'misma_red' : 'otra_red';
}

/** «Abierto 3 veces · primera 4-nov 13:20 · última 5-nov 09:12 · 2 dispositivos» o «Sin abrir». */
export function textoAperturas(r: ResumenAperturas, fmt: (iso: string) => string): string {
  if (r.n === 0) return r.propias > 0 ? `Sin abrir (${r.propias} ${r.propias === 1 ? 'apertura' : 'aperturas'} desde la red de quien envió)` : 'Sin abrir';
  const partes = [`Abierto ${r.n === 1 ? '1 vez' : `${r.n} veces`}`];
  if (r.primera) partes.push(r.n === 1 ? fmt(r.primera) : `primera ${fmt(r.primera)}`);
  if (r.ultima && r.n > 1) partes.push(`última ${fmt(r.ultima)}`);
  if (r.n > 1) partes.push(`${r.dispositivos} ${r.dispositivos === 1 ? 'dispositivo' : 'dispositivos'}`);
  return partes.join(' · ');
}

/** Para la lista de Por facturar: «Visto» / «Sin abrir» con el detalle en el title. */
export function badgeVisto(r: ResumenAperturas | null | undefined, enviadaEn: string | null, fmt: (iso: string) => string, ahora = Date.now()): { visto: boolean; texto: string; title: string } {
  const dias = enviadaEn ? Math.max(0, Math.floor((ahora - Date.parse(enviadaEn)) / 86_400_000)) : 0;
  const hace = dias === 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
  if (!r || r.n === 0) return { visto: false, texto: 'Sin abrir', title: `Enviado ${hace} y sin abrir${dias >= 3 ? ': hay que llamar' : ''}${r && r.propias > 0 ? ` (${r.propias} desde la red de quien envió)` : ''}` };
  return { visto: true, texto: 'Visto', title: `${textoAperturas(r, fmt)} · enviado ${hace}` };
}
