export type Theme = "system" | "light" | "dark";
const KEY = "st.theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // storage unavailable
  }
  return "system";
}

export function applyTheme(theme: Theme = getTheme()) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage unavailable
  }
  applyTheme(theme);
}

export function watchSystemTheme() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
}
