import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from '../state/store';

/** Resolves the theme preference and applies it to <html data-theme>. */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useStore((s) => s.theme);
  const presenting = useStore((s) => s.presenting);
  const presentDark = useStore((s) => s.presentation.dark);
  const [sysDark, setSysDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const h = () => setSysDark(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  let resolved: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
  if (presenting) resolved = presentDark ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);
  return resolved;
}

/** Resolved dark/light theme, provided by <App>. */
export const DarkContext = createContext(false);
export function useDark(): boolean {
  return useContext(DarkContext);
}
