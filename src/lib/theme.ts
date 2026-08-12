// Theme (light/dark) — persisted in localStorage, applied as a `data-theme`
// attribute on <html> so index.css variable overrides flip the whole app.
// Default: dark (matches the pre-light-mode look); the inline script in
// index.html applies the stored theme before first paint to avoid a flash.
import { useCallback, useState } from "react";

export const THEME_STORAGE_KEY = "qorvexa.theme";
export type Theme = "dark" | "light";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

export function initTheme() {
  applyTheme(getStoredTheme());
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const toggle = useCallback((next: Theme) => {
    setTheme(next);
    applyTheme(next);
  }, []);
  return [theme, toggle];
}
