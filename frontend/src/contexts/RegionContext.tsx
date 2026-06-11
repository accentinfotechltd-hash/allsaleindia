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

export type CountryCode = "NZ" | "AU" | "US" | "GB" | "CA";

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
