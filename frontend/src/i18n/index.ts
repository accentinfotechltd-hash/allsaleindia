/**
 * i18n — English + Hindi. Persists the chosen language in storage.
 * Use the `useTranslation()` hook anywhere: const { t, locale, setLocale } = useTranslation();
 */
import { I18n } from "i18n-js";
import { getLocales } from "expo-localization";
import { useEffect, useState, useCallback } from "react";

import { storage } from "@/src/utils/storage";

import en from "./locales/en";
import hi from "./locales/hi";
import es from "./locales/es";
import ar from "./locales/ar";
import zh from "./locales/zh";
import pt from "./locales/pt";
import fr from "./locales/fr";
import de from "./locales/de";
import ja from "./locales/ja";
import ko from "./locales/ko";
import bn from "./locales/bn";
import ta from "./locales/ta";
import id from "./locales/id";
import ru from "./locales/ru";

const LANG_KEY = "allsale_lang";
export const SUPPORTED = [
  { code: "en", label: "English", native: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi", native: "हिन्दी", flag: "🇮🇳" },
  { code: "es", label: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "zh", label: "Chinese", native: "中文", flag: "🇨🇳" },
  { code: "ar", label: "Arabic", native: "العربية", flag: "🇸🇦" },
  { code: "pt", label: "Portuguese", native: "Português", flag: "🇧🇷" },
  { code: "fr", label: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", label: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "ja", label: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "Korean", native: "한국어", flag: "🇰🇷" },
  { code: "bn", label: "Bengali", native: "বাংলা", flag: "🇧🇩" },
  { code: "ta", label: "Tamil", native: "தமிழ்", flag: "🇮🇳" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ru", label: "Russian", native: "Русский", flag: "🇷🇺" },
] as const;

export const i18n = new I18n({ en, hi, es, ar, zh, pt, fr, de, ja, ko, bn, ta, id, ru });
i18n.enableFallback = true;
i18n.defaultLocale = "en";

// Best-guess from device
const deviceLang = getLocales()[0]?.languageCode || "en";
i18n.locale = SUPPORTED.some((s) => s.code === deviceLang) ? deviceLang : "en";

let listeners: Array<() => void> = [];

export async function loadStoredLanguage(): Promise<void> {
  const stored = await storage.getItem<string>(LANG_KEY, "");
  if (stored && SUPPORTED.some((s) => s.code === stored)) {
    i18n.locale = stored;
    listeners.forEach((l) => l());
  }
}

export async function setLanguage(code: string): Promise<void> {
  if (!SUPPORTED.some((s) => s.code === code)) return;
  i18n.locale = code;
  await storage.setItem(LANG_KEY, code);
  listeners.forEach((l) => l());
}

export function useTranslation() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  const t = useCallback((key: string, opts?: Record<string, unknown>) => i18n.t(key, opts), []);
  return { t, locale: i18n.locale, setLocale: setLanguage };
}
