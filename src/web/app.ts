import { LocalStore, AppError } from './store';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { assignmentContent } from './mail-template';
export const BODY_LIMIT = 8192;
export const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer'
};
export const json = (value: unknown, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
export const createApp = (store = new LocalStore()) => ({
    async fetch(request: Request): Promise<Response> {
        try {
            const url = new URL(request.url), path = url.pathname, method = request.method;
            const asset = /^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.exec(path);
            const participant = /^\/api\/participants\/([\da-f-]{36})$/.exec(path);
            const group = /^\/api\/groups\/([\da-f-]{36})$/.exec(path);
            const people = /^\/api\/groups\/([\da-f-]{36})\/people(?:\/([\da-f-]{36}))?$/.exec(path);
            const editions = /^\/api\/groups\/([\da-f-]{36})\/editions$/.exec(path);
            const scoped = /^\/api\/groups\/([\da-f-]{36})\/editions\/([\da-f-]{36})(?:\/(participants)(?:\/([\da-f-]{36}))?|\/(draw)(?:\/(send|reset))?)?$/.exec(path);
            const [, scopedGroupId, editionId, resource, memberId, drawResource, drawAction] = scoped ?? [];
            const scope = scoped ? { groupId: scopedGroupId, editionId } : undefined;
            let methods: string[] | null = null;
            if (path === '/api/groups') methods = ['GET', 'HEAD', 'POST'];
            else if (group) methods = ['GET', 'HEAD', 'PUT'];
            else if (people) methods = people[2] ? ['PUT'] : ['POST'];
            else if (editions) methods = ['POST'];
            else if (scoped) methods = resource === 'participants' ? memberId ? ['PUT', 'DELETE'] : ['POST'] : drawResource ? ['POST'] : ['GET', 'HEAD'];
            else if (path === '/' || asset || path === '/mail-preview' || path === '/api/health' || path === '/api/state') methods = ['GET', 'HEAD'];
            else if (path === '/api/participants' || path === '/api/draw' || path === '/api/draw/reset' || path === '/api/draw/send') methods = ['POST'];
            else if (participant) methods = ['PUT', 'DELETE'];
            if (!methods) return json({ error: 'Ruta no encontrada.' }, 404);
            if (!methods.includes(method)) return json({ error: 'Método no permitido.' }, 405, { Allow: methods.join(', ') });
            if (method === 'GET' || method === 'HEAD') {
                let result: Response;
                if (path === '/mail-preview') {
                    // Fixed synthetic data only: never read the store or invoke SMTP.
                    result = new Response(assignmentContent('Lucía (ejemplo ficticio)', 'Mateo (ejemplo ficticio)').html, { headers: {
                        ...headers, 'Content-Type': 'text/html; charset=utf-8',
                        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox"
                    } });
                }
                else if (path === '/' || asset) {
                    let content: string;
                    try { content = await fs.readFile(resolve(__dirname, '../../build/public', path === '/' ? 'index.html' : path.slice(1)), 'utf8'); }
                    catch (error) {
                        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json({ error: 'Ruta no encontrada.' }, 404);
                        throw error;
                    }
                    const type = path === '/' ? 'text/html' : asset?.[1] === 'css' ? 'text/css' : 'text/javascript';
                    result = new Response(content, { headers: { ...headers, 'Content-Type': `${type}; charset=utf-8` } });
                }
                else if (path === '/api/groups') result = json(await store.groups());
                else if (group) result = json(await store.group(group[1]));
                else result = json(path === '/api/health' ? { status: 'ok' } : await store.status(scope));
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
            if (path === '/api/groups') return json(await store.manage('createGroup', input), 201);
            if (group) return json(await store.manage('renameGroup', input, group[1]));
            if (people) return json(await store.manage(people[2] ? 'editPerson' : 'addPerson', input, people[1], people[2]), people[2] ? 200 : 201);
            if (editions) return json(await store.manage('createEdition', input, editions[1]), 201);
            if (scope) {
                if (drawAction === 'send') return json(await store.send(input, scope));
                const action = drawResource ? drawAction === 'reset' ? 'reset' : 'draw' : !memberId ? 'add' : method === 'DELETE' ? 'delete' : 'edit';
                return json(await store.mutate(action, input, memberId, scope), action === 'add' ? 201 : 200);
            }
            if (path === '/api/draw/send') return json(await store.send(input));
            const action = path === '/api/draw' ? 'draw' : path === '/api/draw/reset' ? 'reset' : participant ? method === 'DELETE' ? 'delete' : 'edit' : 'add';
            return json(await store.mutate(action, input, participant?.[1]), action === 'add' ? 201 : 200);
        } catch (error) {
            return error instanceof AppError ? json({ error: error.message }, error.status) : json({ error: 'No se pudo acceder al almacenamiento local. Comprueba sus permisos y su integridad.' }, 503);
        }
    }
});
export const defaultStore = new LocalStore();
export default createApp(defaultStore);
