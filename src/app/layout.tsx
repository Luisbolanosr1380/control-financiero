import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import './globals.css';
import { RegistroSW } from '@/components/pwa/registro-sw';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// MULTI-EMPRESA 1-D: título por deploy desde la config central.
import { empresaConfig } from '@/lib/config/empresa';

const CFG = empresaConfig();
export const metadata: Metadata = {
  title: CFG.titulo,
  description: 'Sistema operativo de contabilidad con Auros, asistente AI integrado',
  applicationName: CFG.nombreApp,
  // PWA: "Agregar a pantalla de inicio" en iOS usa estas etiquetas (Android lee el manifest).
  appleWebApp: { capable: true, title: CFG.nombreApp, statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/pwa/apple-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: CFG.colorMarca,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html lang="es" className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}>
        <body>
          {children}
          <RegistroSW />
          <Toaster position="top-right" richColors closeButton />
        </body>
      </html>
    </ClerkProvider>
  );
}
