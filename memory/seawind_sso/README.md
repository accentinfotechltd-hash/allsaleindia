# Allsale SSO Bridge — Drop-in Pack for Seawind

This pack lets logged-in users on **`allsale.co.nz`** (the classifieds site)
seamlessly enter **`shop.allsale.co.nz`** (the new e-commerce app) without
re-entering their email/password.

## 📦 What's in this pack
- `allsale-sso.php` — single-file, zero-dependency PHP drop-in (PHP 7.2+)
- `README.md` — this file

## 🚀 3-step install for Seawind

### Step 1: Drop the file in
Save `allsale-sso.php` anywhere in the project, for example:
```
/lib/allsale-sso.php
```

### Step 2: Include it once at startup
```php
require_once __DIR__ . '/lib/allsale-sso.php';
```

### Step 3: Use it wherever needed
**Option A — Auto-redirect endpoint** (recommended). Create `/shop-now.php`:
```php
<?php
require_once __DIR__ . '/lib/allsale-sso.php';
require_once __DIR__ . '/your-auth-bootstrap.php';   // loads $_SESSION etc.

if (empty($_SESSION['user_id'])) {
    header('Location: /login.php?next=' . urlencode('/shop-now.php'));
    exit;
}

header('Location: ' . allsale_sso_url([
    'id'    => $_SESSION['user_id'],
    'email' => $_SESSION['user_email'],
    'name'  => $_SESSION['user_name'] ?? '',
]));
exit;
```
Now any link to `https://allsale.co.nz/shop-now.php` auto-signs the user into
the shop. Add it to the nav menu, footer, banner, etc.

**Option B — Inline button** in any template:
```php
<?php
require_once __DIR__ . '/lib/allsale-sso.php';
if (!empty($_SESSION['user_id'])) {
    allsale_sso_button([
        'id'    => $_SESSION['user_id'],
        'email' => $_SESSION['user_email'],
        'name'  => $_SESSION['user_name'] ?? '',
    ], 'Visit Allsale Shop →');
}
?>
```

## ✅ Verify it's working

### 1. Confirm the shop is ready to receive tokens:
```bash
curl https://shop.allsale.co.nz/api/auth/sso/healthcheck
```
Expected response:
```json
{"configured":true,"audience":"shop.allsale.co.nz","allowed_issuers":["allsale.co.nz"],"max_token_ttl_seconds":60,"algorithm":"HS256"}
```

### 2. Generate a test JWT and submit it:
```bash
php -r "
require 'allsale-sso.php';
echo allsale_sso_url(['id'=>1, 'email'=>'test@example.com', 'name'=>'Test User']);
"
```
Open the printed URL in a browser. You should land on the shop, signed in as
`test@example.com`.

## 🔐 Security

| Concern | Mitigation |
|---------|------------|
| Token theft via URL/referrer | TTL = 55s · one-time-use `jti` blocked server-side · HTTPS-only |
| Replay attack | `jti` cached for 2 min · server returns 401 "already used" |
| Privilege escalation | Only `iss=allsale.co.nz` accepted · whitelisted server-side |
| Wrong audience | Server enforces `aud=shop.allsale.co.nz` |
| Future-dated `iat` | Server rejects |
| Long TTL | Server rejects anything > 60s |
| Compromised secret | Rotate by changing on both sides simultaneously |

## ⚠️ Production checklist

- [ ] Move `ALLSALE_SSO_SECRET` from the file constant into an environment
      variable (e.g., `.env`) and read via `getenv('ALLSALE_SSO_SECRET')`
- [ ] Force HTTPS on all SSO-related routes
- [ ] Add a rate-limit on `/shop-now.php` (max ~20 req/min/IP)
- [ ] Log SSO redirects for audit (`user_id`, `jti`, `timestamp`, `ip`)
- [ ] Coordinate with Allsale (sales@allsale.co.nz) for the secret rotation
      window when going live

## ❓ Troubleshooting

| Error from shop | Cause | Fix |
|-----------------|-------|-----|
| `401 Invalid SSO token` | Wrong secret, expired, or malformed | Re-check `ALLSALE_SSO_SECRET` matches exactly |
| `401 SSO issuer not allowed` | `iss` claim wrong | Must be `allsale.co.nz` (no scheme, no slash) |
| `401 SSO token already used` | Reused jti | Each redirect must generate a new token (helper does this automatically) |
| `401 SSO token TTL too long` | `exp - iat > 60` | Keep `ALLSALE_SSO_TTL` ≤ 55 (default) |
| `503 SSO is not configured` | Allsale backend not deployed yet | Confirm with Allsale that the production deploy is live |

## 📞 Contact

- **Technical:** dev@allsale.co.nz
- **Shared secret rotation:** coordinate via secure channel (1Password / encrypted email)
