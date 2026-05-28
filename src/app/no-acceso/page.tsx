import { currentUser } from '@clerk/nextjs/server';
import { SignOutButton } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default async function NoAccesoPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '—';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 480,
        background: 'var(--paper-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 12,
        padding: 32,
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Sin acceso al sistema</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 4 }}>
          La cuenta <strong style={{ color: 'var(--ink-2)' }}>{email}</strong> no está autorizada
          para usar este sistema.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 24 }}>
          Contactá al administrador para solicitar acceso.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button className="btn btn-primary" style={{ padding: '8px 16px' }}>
            Cerrar sesión
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
