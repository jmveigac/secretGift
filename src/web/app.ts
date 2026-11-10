const page = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>secretGift · Amigo invisible</title>
<style>
:root{font-family:system-ui,sans-serif;color:#253b32;background:#f6f4ed}
body{margin:0;min-height:100vh;display:grid;place-items:center}
main{max-width:40rem;padding:3rem 1.5rem} .tag{color:#486d5a;font-weight:600;letter-spacing:.1em}
h1{font-size:clamp(3rem,10vw,5rem);margin:.5rem 0} p{line-height:1.7}
.status{background:white;border:1px solid #d3ddd5;border-radius:1rem;padding:1.25rem;margin-top:2rem}
button{font:inherit;background:#285440;color:white;border:0;border-radius:.5rem;padding:.7rem 1rem;cursor:pointer}
button:disabled{opacity:.6}small{display:block;margin-top:2rem}
</style>
<script src="/status.js" defer></script>
</head>
<body><main>
<p class="tag">AMIGO INVISIBLE · FASE 1</p><h1>secretGift</h1>
<p>Las sorpresas empiezan aquí. Estamos preparando un lugar para organizar el próximo amigo invisible.</p>
<div class="status"><p id="status" role="status" aria-live="polite">Comprobando conexión…</p>
<button id="retry" type="button">Comprobar de nuevo</button></div>
<small>Versión local inicial. Los sorteos y el envío de correos todavía no están disponibles en la web.</small>
<noscript><p>Activa JavaScript para comprobar la conexión o visita <a href="/api/health">el estado del servicio</a>.</p></noscript>
</main></body></html>`;

const script = `const status = document.getElementById('status');
const button = document.getElementById('retry');
async function check() {
  button.disabled = true;
  status.textContent = 'Comprobando conexión…';
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok || data.status !== 'ok') throw new Error('Unavailable');
    status.textContent = 'Servicio operativo. Todo listo para seguir construyendo.';
  } catch {
    status.textContent = 'No se ha podido conectar con el servicio. Prueba de nuevo.';
  } finally { button.disabled = false; }
}
button.addEventListener('click', check);
check();`;

const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer'
};

export default {
    fetch(request: Request): Response {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
        }
        const path = new URL(request.url).pathname;
        let body: string;
        let type: string;
        if (path === '/') { body = page; type = 'text/html; charset=utf-8'; }
        else if (path === '/status.js') { body = script; type = 'text/javascript; charset=utf-8'; }
        else if (path === '/api/health') { body = JSON.stringify({ status: 'ok' }); type = 'application/json'; }
        else return new Response(request.method === 'HEAD' ? null : 'Not found', { status: 404, headers });
        return new Response(request.method === 'HEAD' ? null : body, { headers: { ...headers, 'Content-Type': type } });
    }
};
