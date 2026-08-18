"use client";

// Dark / Light / System.
//
// "System" is a real answer, not a cop-out — a lot of people set their machine
// to flip at sunset and expect apps to follow. An app that ignores that is one
// they fight with twice a day.

import { useEffect, useState } from "react";
import { THEME_KEY, resolveTheme, themeNote, type ThemePref } from "@/lib/theme";

const OPTIONS: ThemePref[] = ["dark", "light", "system"];

export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");
  const [sysDark, setSysDark] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY) as ThemePref | null;
      if (saved && OPTIONS.includes(saved)) setPref(saved);
    } catch { /* private window */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSysDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-qtheme", resolveTheme(pref, sysDark));
  }, [pref, sysDark]);

  function choose(p: ThemePref) {
    setPref(p);
    try { window.localStorage.setItem(THEME_KEY, p); } catch { /* private window */ }
  }

  return (
    <span className="q-themebar" title={themeNote(pref, sysDark)}>
      <span className="q-themeset">
        {OPTIONS.map((o) => (
          <button key={o} aria-pressed={pref === o} onClick={() => choose(o)}>
            {o}
          </button>
        ))}
      </span>
    </span>
  );
}
