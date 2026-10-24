import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.remove("light");
    root.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // R186-6 (H-F5): storage-blocked embeds throw on access and this
    // initializer runs in render above every error boundary — degrade
    // to the dark default instead of unmounting the whole root.
    try {
      const stored = localStorage.getItem("sn_theme") as Theme | null;
      return stored === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    // Best-effort persistence: a throwing setItem (quota/private mode)
    // must not kill the effect — the theme already applied for this
    // session (the auth/cart storage guards' sibling).
    try {
      localStorage.setItem("sn_theme", theme);
    } catch {
      // ignore — storage unavailable, preference is session-only then
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
