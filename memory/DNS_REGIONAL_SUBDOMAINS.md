# DNS — Regional Subdomain Routing

Allsale's geo-routing relies on hostnames like `au.allsale.co.nz` to pin a
visitor's region (currency + shipping rules). This document captures the
DNS records needed for each market, plus the one-time TLS certificate
expansion.

> ⚠️ **DNS lives outside this repo.** It is configured at the domain
> registrar (or DNS hosting provider — Cloudflare / Route 53 / Namecheap).
> The application code already does the right thing once the records are
> in place (see `src/contexts/RegionContext.tsx` → `regionFromHostname()`
> and `backend/routers/geo.py` → subdomain map).

---

## Records to add

All regional subdomains are **CNAMEs** that point to the apex domain. This
keeps the IP single-sourced — if the apex moves, every region follows
automatically.

| Subdomain | Type  | Target            | TTL  | Region |
|-----------|-------|-------------------|------|--------|
| `www`     | CNAME | `allsale.co.nz.`  | 300  | NZ (default) |
| `au`      | CNAME | `allsale.co.nz.`  | 300  | 🇦🇺 Australia |
| `us`      | CNAME | `allsale.co.nz.`  | 300  | 🇺🇸 United States |
| `uk`      | CNAME | `allsale.co.nz.`  | 300  | 🇬🇧 United Kingdom |
| `ca`      | CNAME | `allsale.co.nz.`  | 300  | 🇨🇦 Canada |
| `fj`      | CNAME | `allsale.co.nz.`  | 300  | 🇫🇯 Fiji |
| `ws`      | CNAME | `allsale.co.nz.`  | 300  | 🇼🇸 Samoa |
| `to`      | CNAME | `allsale.co.nz.`  | 300  | 🇹🇴 Tonga |
| `pg`      | CNAME | `allsale.co.nz.`  | 300  | 🇵🇬 Papua New Guinea |

If your DNS provider doesn't support CNAME at non-apex hostnames, use an
A-record pointing to the apex's resolved IPv4 (e.g. the Vercel / Render /
Emergent load balancer IP), and an AAAA-record for IPv6.

---

## TLS / SSL certificate

The wildcard cert `*.allsale.co.nz` covers every new subdomain
automatically — **no action needed** if you already have a wildcard.

If using per-host certs (e.g. via Let's Encrypt + HTTP-01 challenge),
re-issue with the expanded SAN list:

```
allsale.co.nz
www.allsale.co.nz
au.allsale.co.nz
us.allsale.co.nz
uk.allsale.co.nz
ca.allsale.co.nz
fj.allsale.co.nz
ws.allsale.co.nz
to.allsale.co.nz
pg.allsale.co.nz
```

---

## Validation

After DNS propagates (usually 5–60 minutes):

```bash
for sub in www au us uk ca fj ws to pg; do
  echo "=== $sub.allsale.co.nz ==="
  curl -sI "https://$sub.allsale.co.nz/" | head -1
  curl -s "https://$sub.allsale.co.nz/api/geo/detect" | python -m json.tool
done
```

Each subdomain should:
1. Return `HTTP/2 200` on `/`
2. Have the expected `country` in `/api/geo/detect`
3. Show prices in that region's currency (verified by switching tabs in DevTools)

---

## Rollback

If a regional subdomain misbehaves, simply remove or pause the DNS record
at the provider. The app keeps serving the apex `allsale.co.nz` and the
RegionContext falls back to NZ + Cloudflare geo-IP detection.

No code-level rollback needed.

---

## Future markets

Adding a new market (e.g. UAE) is now a 4-step change:

1. `backend/config.py` — add to `SUPPORTED_COUNTRIES` + (optionally) `FX_RATES_FROM_NZD`
2. `backend/services/fx.py` — if the currency isn't ECB-tracked, add to `_OPEN_ER_CCYS`
3. `backend/routers/geo.py` — extend the subdomain map
4. `frontend/src/contexts/RegionContext.tsx` — extend the `CountryCode` union and add a switch case
5. Add the DNS CNAME from this doc (and reissue the cert if non-wildcard)

That's it. No DB migration. No re-deploy of the React Native app required
(the country list is fetched from `/api/currency/rates` at runtime).
