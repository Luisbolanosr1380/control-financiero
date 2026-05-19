'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { AIPanel } from '@/components/shell/ai-panel';
import { CommandPalette } from '@/components/shell/command-palette';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [aiOpen, setAiOpen] = useState(true);
  const [showCmdK, setShowCmdK] = useState(false);

  // Atajos de teclado globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCmdK((open) => !open);
      } else if (e.key === 'Escape') {
        setShowCmdK(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={'app' + (aiOpen ? ' ai-open' : '')}>
      <Sidebar />

      <div className="main">
        <Topbar aiOpen={aiOpen} setAiOpen={setAiOpen} onSearch={() => setShowCmdK(true)} />
        {children}
      </div>

      {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
      {showCmdK && <CommandPalette onClose={() => setShowCmdK(false)} />}
    </div>
  );
}
