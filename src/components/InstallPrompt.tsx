import { useEffect, useState } from 'react';

export function InstallPrompt() {
  const [prompt, setPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!prompt) return null;

  const install = async () => {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setPrompt(null);
  };

  return (
    <button
      onClick={install}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '5px 10px',
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid #166534',
        borderRadius: '20px',
        fontFamily: 'Space Mono, monospace',
        fontSize: '9px',
        fontWeight: '700',
        letterSpacing: '0.1em',
        color: '#22c55e',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      ↓ INSTALL
    </button>
  );
}
