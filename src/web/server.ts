import { createServer } from 'node:http';
import app, { BODY_LIMIT, json, defaultStore } from './app';
import { MissingDatabaseError } from './database';

export const createWebServer = (application = app) => createServer(async (request, response) => {
    try {
        // Authority is restricted to local names and the actual listening port.
        // Never let an arbitrary Host (or absolute request target) define trust.
        const authority = request.headers.host?.toLowerCase();
        const port = request.socket.localPort;
        const allowed = ['localhost', '127.0.0.1', '[::1]'].map(host => `${host}:${port}`);
        if (!authority || !allowed.includes(authority)) {
            const result = json({ error: 'Autoridad no permitida.' }, 403);
            response.statusCode = result.status;
            result.headers.forEach((value, name) => response.setHeader(name, value));
            response.end(await result.text());
            return;
        }
        const target = request.url ?? '/';
        if (!target.startsWith('/') || target.startsWith('//')) throw new Error('Invalid request target');
        const url = new URL(target, `http://${authority}`);
        if (url.host !== authority) throw new Error('Invalid request authority');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) {
            size += chunk.length;
            if (size > BODY_LIMIT) {
                const result = json({ error: 'Solicitud demasiado grande.' }, 413);
                response.statusCode = result.status;
                result.headers.forEach((value, name) => response.setHeader(name, value));
                response.end(await result.text());
                return;
            }
            chunks.push(chunk);
        }
        const method = request.method ?? 'GET';
        const requestHeaders = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) requestHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
        const result = await application.fetch(new Request(url, {
            method, headers: requestHeaders,
            body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks)
        }));
        response.statusCode = result.status;
        result.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(await result.text());
    } catch {
        const result = json({ error: 'Solicitud no válida.' }, 400);
        response.statusCode = result.status;
        result.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(await result.text());
    }
});
if (require.main === module) {
    const host = process.env.WEB_HOST ?? '127.0.0.1';
    const server = createWebServer();
    defaultStore.status().then(() => {
        server.listen(8787, host, () => console.log(`secretGift: http://${host}:8787`));
    }).catch((error) => {
        console.error(error instanceof MissingDatabaseError
            ? 'Falta la base SQLite, pero existe la clave: restaura la base con su clave original. No se ha creado una base vacía.'
            : 'No se pudo abrir el almacenamiento: comprueba la integridad, los permisos y la clave original.');
        process.exitCode = 1;
    });
    const stop = () => server.close();
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
