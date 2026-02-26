"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("hermes-theme");
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
      return;
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const initial = prefersDark ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("hermes-theme", next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button type="button" className="btn" onClick={toggleTheme}>
      {theme === "dark" ? "Light" : "Dark"} Mode
    </button>
  );
}
