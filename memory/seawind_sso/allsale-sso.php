<?php
/**
 * ============================================================================
 *  allsale-sso.php  —  Drop-in SSO bridge for shop.allsale.co.nz
 *  Author: Allsale  ·  Version: 1.0  ·  Zero-dependency
 *
 *  WHAT THIS DOES:
 *  Generates a signed, short-lived (55s) JWT and redirects the logged-in user
 *  to https://shop.allsale.co.nz, where they are auto-signed-in seamlessly.
 *
 *  REQUIREMENTS:
 *  - PHP 7.2+ (uses random_bytes & hash_hmac, both built-in)
 *  - NO composer, NO external libraries
 *
 *  INSTALLATION (3 minutes):
 *  ----------------------------------------------------------------------------
 *  1. Drop this file anywhere in your project (e.g. /lib/allsale-sso.php)
 *  2. include_once '/lib/allsale-sso.php'; once at startup
 *  3. Wherever the user has an active session, call:
 *
 *        $url = allsale_sso_url([
 *            'id'    => $session_user_id,
 *            'email' => $session_user_email,
 *            'name'  => $session_user_full_name,   // optional
 *        ]);
 *        header('Location: ' . $url);
 *        exit;
 *
 *     OR render a button:
 *
 *        echo '<a href="' . htmlspecialchars($url, ENT_QUOTES) . '">Shop now →</a>';
 *
 *  4. (Optional) Add an auto-redirect endpoint like /shop-now.php with just:
 *
 *        <?php
 *        require_once __DIR__ . '/lib/allsale-sso.php';
 *        require_once __DIR__ . '/auth.php';   // your session/auth bootstrap
 *        if (!current_user_logged_in()) {
 *            header('Location: /login.php?next=/shop-now.php');
 *            exit;
 *        }
 *        $u = current_user();
 *        header('Location: ' . allsale_sso_url([
 *            'id'    => $u->id,
 *            'email' => $u->email,
 *            'name'  => $u->name,
 *        ]));
 *
 *  SECURITY NOTES:
 *  - The SSO_SECRET below must NEVER appear in any browser-facing code.
 *  - Always serve over HTTPS in production (token in URL).
 *  - Tokens expire in 55s and are one-time-use (server enforces jti uniqueness).
 *  - To rotate the secret, coordinate with Allsale to swap both sides at once.
 * ============================================================================
 */

// ---------- CONFIG -----------------------------------------------------------
const ALLSALE_SSO_SECRET   = 'Q4JPl9N4vwecIQCHr0q_XcbjzvhY96s9KchpLT_KjUOQ51RwsofZ5YZhxjoAv8ng';
const ALLSALE_SSO_ISSUER   = 'allsale.co.nz';
const ALLSALE_SSO_AUDIENCE = 'shop.allsale.co.nz';
const ALLSALE_SHOP_URL     = 'https://shop.allsale.co.nz';
const ALLSALE_SSO_TTL      = 55;  // seconds (server max = 60)


// ---------- Internal: base64url encode/decode --------------------------------
function _allsale_b64url(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}


// ---------- Internal: build HS256 JWT (no library needed) --------------------
function _allsale_make_jwt(array $payload): string {
    $header_b64  = _allsale_b64url(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
    $payload_b64 = _allsale_b64url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $signing_in  = $header_b64 . '.' . $payload_b64;
    $sig_b64     = _allsale_b64url(hash_hmac('sha256', $signing_in, ALLSALE_SSO_SECRET, true));
    return $signing_in . '.' . $sig_b64;
}


/**
 * Build a one-shot redirect URL that auto-logs $user into shop.allsale.co.nz.
 *
 * @param array  $user  ['id' => int|string, 'email' => string, 'name' => ?string]
 * @param string $next  Path inside the shop to land on (default home)
 * @return string Full URL — redirect the browser here
 * @throws InvalidArgumentException if user data is missing
 */
function allsale_sso_url(array $user, string $next = '/(tabs)/home'): string {
    if (empty($user['id']))    throw new InvalidArgumentException('allsale_sso_url: user.id is required');
    if (empty($user['email'])) throw new InvalidArgumentException('allsale_sso_url: user.email is required');

    // Generate a unique jti — server caches these for 2 min to block replay
    try {
        $jti = bin2hex(random_bytes(16));
    } catch (Exception $e) {
        // Extremely rare random_bytes failure — fall back to uniqid (still unique enough)
        $jti = uniqid('', true) . dechex(mt_rand());
    }

    $now = time();
    $token = _allsale_make_jwt([
        'iss'   => ALLSALE_SSO_ISSUER,
        'aud'   => ALLSALE_SSO_AUDIENCE,
        'sub'   => (string) $user['id'],
        'email' => strtolower(trim($user['email'])),
        'name'  => isset($user['name']) ? (string) $user['name'] : '',
        'iat'   => $now,
        'exp'   => $now + ALLSALE_SSO_TTL,
        'jti'   => $jti,
    ]);

    return ALLSALE_SHOP_URL . '/sso?token=' . urlencode($token)
         . '&next=' . urlencode($next);
}


/**
 * Convenience: print a styled "Shop now" anchor tag inline.
 * Use in templates:  <?php allsale_sso_button($currentUser); ?>
 */
function allsale_sso_button(array $user, string $label = 'Shop now →', string $css_class = 'btn btn-primary'): void {
    try {
        $url = allsale_sso_url($user);
        printf(
            '<a href="%s" class="%s">%s</a>',
            htmlspecialchars($url, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($css_class, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
        );
    } catch (Exception $e) {
        // Fail silently — render a plain link to the shop landing page
        printf(
            '<a href="%s" class="%s">%s</a>',
            htmlspecialchars(ALLSALE_SHOP_URL, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($css_class, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
        );
    }
}


// ===========================================================================
//  FRAMEWORK-SPECIFIC EXAMPLES (uncomment + adapt the one you use):
// ===========================================================================

/* ---------- LARAVEL --------------------------------------------------------
// routes/web.php
Route::get('/shop-now', function () {
    if (!auth()->check()) return redirect()->route('login');
    $u = auth()->user();
    return redirect(allsale_sso_url([
        'id'    => $u->id,
        'email' => $u->email,
        'name'  => $u->name,
    ]));
})->name('shop-now');
*/

/* ---------- SYMFONY -------------------------------------------------------
// In a controller:
public function shopNow(): RedirectResponse {
    $user = $this->getUser();
    if (!$user) return $this->redirectToRoute('login');
    return $this->redirect(allsale_sso_url([
        'id'    => $user->getId(),
        'email' => $user->getEmail(),
        'name'  => $user->getFullName(),
    ]));
}
*/

/* ---------- VANILLA PHP / OsClass / CodeIgniter --------------------------
// /shop-now.php
session_start();
require_once __DIR__ . '/lib/allsale-sso.php';
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
*/

/* ---------- OSCLASS -------------------------------------------------------
// In oc-content/plugins/your-theme/hooks.php or similar:
osc_add_hook('after_user_menu', function () {
    if (!osc_is_web_user_logged_in()) return;
    $u = User::newInstance()->findByPrimaryKey(osc_logged_user_id());
    echo allsale_sso_button([
        'id'    => $u['pk_i_id'],
        'email' => $u['s_email'],
        'name'  => $u['s_name'],
    ], 'Visit Allsale Shop →');
});
*/
