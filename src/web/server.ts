import { createServer } from 'node:http';
import app, { BODY_LIMIT, json } from './app';

export const createWebServer = (application = app) => createServer(async (request, response) => {
    try {
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
        const result = await application.fetch(new Request(new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`), {
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
    server.listen(8787, host, () => console.log(`secretGift: http://${host}:8787`));
    const stop = () => server.close();
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
