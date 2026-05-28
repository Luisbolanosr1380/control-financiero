/**
 * Allowlist: decide si un email autenticado puede entrar al sistema.
 * Lee ALLOWED_EMAILS (lista separada por coma) y ALLOWED_DOMAIN (con o sin "@").
 * Si ninguno está definido, NADIE pasa (fail-closed).
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();

  const emailsRaw = (process.env.ALLOWED_EMAILS ?? '').trim();
  const domainRaw = (process.env.ALLOWED_DOMAIN ?? '').trim();

  const emails = emailsRaw
    ? emailsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  if (emails.includes(e)) return true;

  if (domainRaw) {
    const domain = domainRaw.startsWith('@') ? domainRaw.toLowerCase() : '@' + domainRaw.toLowerCase();
    if (e.endsWith(domain)) return true;
  }

  return false;
}
