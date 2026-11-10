import { LocalStore, AppError } from './store';
import { page, script } from './ui';
export const BODY_LIMIT = 8192;
export const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer'
};
export const json = (value: unknown, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
export const createApp = (store = new LocalStore()) => ({
    async fetch(request: Request): Promise<Response> {
        try {
            const url = new URL(request.url), path = url.pathname, method = request.method;
            const participant = /^\/api\/participants\/([\da-f-]{36})$/.exec(path);
            const methods = path === '/' || path === '/app.js' || path === '/api/health' || path === '/api/state' ? ['GET', 'HEAD'] : path === '/api/participants' || path === '/api/draw' || path === '/api/draw/reset' ? ['POST'] : participant ? ['PUT', 'DELETE'] : null;
            if (!methods) return json({ error: 'Ruta no encontrada.' }, 404);
            if (!methods.includes(method)) return json({ error: 'Método no permitido.' }, 405, { Allow: methods.join(', ') });
            if (method === 'GET' || method === 'HEAD') {
                let result: Response;
                if (path === '/' || path === '/app.js') result = new Response(path === '/' ? page : script, { headers: { ...headers, 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' } });
                else result = json(path === '/api/health' ? { status: 'ok' } : await store.status());
                return method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result;
            }
            // Reject browser cross-origin writes, including simple form submissions.
            if ((request.headers.has('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Origen no permitido.' }, 403);
            if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Se requiere JSON.' }, 415);
            const reader = request.body?.getReader();
            const chunks: Uint8Array[] = []; let size = 0;
            if (reader) while (true) {
                const part = await reader.read(); if (part.done) break;
                size += part.value.byteLength;
                if (size > BODY_LIMIT) { await reader.cancel(); return json({ error: 'Solicitud demasiado grande.' }, 413); }
                chunks.push(part.value);
            }
            let input: unknown;
            try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: 'JSON no válido.' }, 400); }
            const action = path === '/api/draw' ? 'draw' : path === '/api/draw/reset' ? 'reset' : participant ? method === 'DELETE' ? 'delete' : 'edit' : 'add';
            return json(await store.mutate(action, input, participant?.[1]), action === 'add' ? 201 : 200);
        } catch (error) {
            return error instanceof AppError ? json({ error: error.message }, error.status) : json({ error: 'No se pudo acceder al almacenamiento local. Comprueba sus permisos y su integridad.' }, 503);
        }
    }
});
export default createApp();
