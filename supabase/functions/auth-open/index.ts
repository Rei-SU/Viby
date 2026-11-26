// auth-open: HTTPS landing page for Supabase auth links.
//
// Supabase verifies the one-time token and redirects here with `?code=…`.
// Browsers suppress a server redirect straight to a custom scheme (no user
// gesture), which left a blank page. This page shows one button; the click is
// the gesture that lets Windows hand `viby://auth/callback?code=…` to the app.
//
// The page is public by design: the code is single-use and PKCE-bound to the
// verification started in the app. Nothing secret is rendered.

function page(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Viby</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0b0d; color: #f2f2f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { width: min(420px, calc(100vw - 48px)); text-align: center; }
  h1 { font-size: 20px; font-weight: 650; margin: 0 0 10px; }
  p { font-size: 14px; line-height: 1.6; color: #a7a7b0; margin: 0 0 22px; }
  a {
    display: inline-block; padding: 11px 20px; border-radius: 999px;
    background: #f2f2f5; color: #0b0b0d; text-decoration: none;
    font-size: 14px; font-weight: 650;
  }
  .error { color: #ff8b8b; }
  small { display: block; margin-top: 18px; font-size: 12px; color: #6f6f78; }
</style>
</head>
<body>
<main>
  <h1>Open Viby</h1>
  <p id="copy">Finish signing in to Viby.</p>
  <a id="open" href="viby://auth/callback">Open Viby</a>
  <small id="detail"></small>
</main>
<script>
  (function () {
    var params = new URLSearchParams(location.search);
    if (!params.get('code') && location.hash.length > 1) {
      var hash = new URLSearchParams(location.hash.slice(1));
      hash.forEach(function (value, key) {
        if (!params.has(key)) params.set(key, value);
      });
    }
    var target = new URL('viby://auth/callback');
    ['code', 'token_hash', 'type', 'error', 'error_description', 'access_token', 'refresh_token', 'expires_in', 'token_type'].forEach(function (key) {
      var value = params.get(key);
      if (value) target.searchParams.set(key, value);
    });
    var copy = document.getElementById('copy');
    var detail = document.getElementById('detail');
    var error = params.get('error_description') || params.get('error');
    if (error) {
      copy.textContent = 'This link could not be used.';
      copy.className = 'error';
      detail.textContent = error;
    } else if (!params.get('code') && !params.get('token_hash')) {
      copy.textContent = 'This link is missing its sign-in code. Request a new one from Viby.';
    }
    document.getElementById('open').href = target.toString();
  })();
</script>
</body>
</html>`
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    }
  })
}

Deno.serve((req: Request): Response => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
  return page()
})
