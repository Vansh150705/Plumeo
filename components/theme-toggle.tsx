'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/** Light/dark toggle. Flips the `.dark` class on <html> (the dark palette lives
 *  in globals.css) and persists the choice to localStorage. The marketing
 *  landing scopes its own light theme via `.plumeo`, so it stays untouched. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('plumeo-theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable (private mode) — theme still applies for the session */
    }
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md hover:bg-accent transition"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch. */}
      {mounted && dark
        ? <Sun className="size-4 text-muted-foreground" />
        : <Moon className="size-4 text-muted-foreground" />}
    </button>
  );
}
