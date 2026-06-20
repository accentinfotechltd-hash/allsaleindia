/**
 * RegionContext — single source of truth for the buyer's country & currency.
 *
 * Resolution priority:
 *   1. User profile country (from /auth/me when logged in)
 *   2. Stored value in AsyncStorage (last selection)
 *   3. Backend geo detection (/geo/detect uses cf-ipcountry)
 *   4. Default: NZ
 *
 * Provides `formatPrice(nzd)` which converts an NZD amount to the active
 * currency using rates fetched from /currency/rates.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

export type CountryCode = "NZ" | "AU" | "US" | "GB" | "CA" | "FJ";

export type CountryInfo = {
  code: CountryCode;
  name: string;
  currency: string;
  symbol: string;
  flag: string;
};

type Rates = Record<string, number>;

type RegionContextValue = {
  country: CountryCode;
  info: CountryInfo;
  countries: CountryInfo[];
  rates: Rates;
  ready: boolean;
  setCountry: (next: CountryCode, persist?: boolean) => Promise<void>;
  convert: (amountNzd: number) => number;
  formatPrice: (amountNzd: number, opts?: { showNzd?: boolean }) => string;
};

const FALLBACK: CountryInfo = {
  code: "NZ",
  name: "New Zealand",
  currency: "NZD",
  symbol: "$",
  flag: "🇳🇿",
};

const Ctx = createContext<RegionContextValue | null>(null);
const STORAGE_KEY = "allsale_country";

// Web only — map the current hostname to a locked region.
// www.allsale.co.nz → NZ, au.allsale.co.nz → AU, etc.
// Returns null on native (mobile app uses geo-detect + stored value).
function detectRegionFromHostname(): CountryCode | null {
  if (typeof window === "undefined" || !window.location) return null;
  const host = window.location.hostname.toLowerCase();
  const parts = host.split(".");
  const sub = parts.length > 2 ? parts[0] : "www";
  switch (sub) {
    case "au":
      return "AU";
    case "us":
      return "US";
    case "uk":
    case "gb":
      return "GB";
    case "ca":
      return "CA";
    case "fj":
      return "FJ";
    case "www":
    case "nz":
    case "allsale":
      return "NZ";
    default:
      return null; // unknown subdomain (seller., preview., etc.) → use normal flow
  }
}

// Auto-redirect to the buyer's IP-recommended subdomain (web only).
// Honours an `?no_redirect=1` query param so users can manually stay.
async function maybeAutoRedirect(currentRegion: CountryCode | null): Promise<void> {
  if (typeof window === "undefined" || !window.location) return;
  // Skip on the seller portal and on local dev (preview, localhost)
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith("seller.") || host.includes("localhost") || host.includes("emergentagent.com")) {
    return;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("no_redirect") === "1") return;
  // Only auto-redirect when we're on www. (so we don't bounce visitors who
  // explicitly chose au./us./etc.)
  if (!host.startsWith("www.") && !host.startsWith("allsale.")) return;
  try {
    const r = await api<{ subdomain: string; country: CountryCode }>(
      "/geo/auto-redirect",
      { auth: false },
    );
    if (r.subdomain && r.subdomain !== "www" && r.country !== currentRegion) {
      // Use replace so back button doesn't bounce them in a loop
      const target = `${url.protocol}//${r.subdomain}.allsale.co.nz${url.pathname}${url.search}`;
      window.location.replace(target);
    }
  } catch {
    /* silent */
  }
}

export function RegionProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<CountryCode>("NZ");
  const [countries, setCountries] = useState<CountryInfo[]>([FALLBACK]);
  const [rates, setRates] = useState<Rates>({ NZD: 1 });
  const [ready, setReady] = useState(false);

  // Fetch rates + countries once on mount; resolve initial country.
  useEffect(() => {
    (async () => {
      try {
        const rateRes = await api<{ rates: Rates; countries: CountryInfo[] }>(
          "/currency/rates",
          { auth: false },
        );
        setCountries(rateRes.countries);
        setRates(rateRes.rates);
        // Priority 0: hostname-based lock (web only). If the subdomain says
        // "this is the AU site", we lock to AU regardless of stored value.
        const fromHost = detectRegionFromHostname();
        if (fromHost && rateRes.countries.some((c) => c.code === fromHost)) {
          setCountryState(fromHost);
          // Persist so native sessions inherit the same default later.
          await storage.setItem(STORAGE_KEY, fromHost);
          setReady(true);
          // Don't auto-redirect once we're already on a subdomain.
          return;
        }
        // Stored?
        const stored = await storage.getItem<CountryCode>(STORAGE_KEY, null as any);
        if (stored && rateRes.countries.some((c) => c.code === stored)) {
          setCountryState(stored);
        } else {
          // Geo detect.
          try {
            const geo = await api<{ country: CountryCode }>("/geo/detect", {
              auth: false,
            });
            if (rateRes.countries.some((c) => c.code === geo.country)) {
              setCountryState(geo.country);
            }
          } catch {
            /* ignore */
          }
        }
        // Web-only: hop to the matching country subdomain if we're on www.
        await maybeAutoRedirect(fromHost);
      } catch {
        /* network failure: keep defaults */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const info = useMemo<CountryInfo>(
    () => countries.find((c) => c.code === country) || FALLBACK,
    [countries, country],
  );

  const setCountry = useCallback(
    async (next: CountryCode, persist = true) => {
      setCountryState(next);
      if (persist) {
        try {
          await storage.setItem(STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
        // Best-effort sync to backend if signed in.
        try {
          await api(`/auth/country`, { method: "POST", body: { country: next } });
        } catch {
          /* ignore — silent for guest users */
        }
      }
    },
    [],
  );

  const convert = useCallback(
    (amountNzd: number) => {
      const r = rates[info.currency] ?? 1;
      return Math.round(amountNzd * r * 100) / 100;
    },
    [rates, info.currency],
  );

  const formatPrice = useCallback(
    (amountNzd: number, opts?: { showNzd?: boolean }) => {
      const conv = convert(amountNzd);
      const primary = `${info.symbol}${conv.toFixed(2)}`;
      if (!opts?.showNzd || info.currency === "NZD") return primary;
      return `${primary}  ·  NZ$${amountNzd.toFixed(2)}`;
    },
    [convert, info.symbol, info.currency],
  );

  const value: RegionContextValue = {
    country,
    info,
    countries,
    rates,
    ready,
    setCountry,
    convert,
    formatPrice,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRegion(): RegionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRegion must be inside <RegionProvider>");
  return v;
}
