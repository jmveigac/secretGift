import { createServer } from 'node:http';
import app from './app';

export const createWebServer = () => createServer(async (request, response) => {
    try {
        const result = app.fetch(new Request(new URL(request.url ?? '/', 'http://localhost'), {
            method: request.method ?? 'GET'
        }));
        const body = await result.text();
        response.statusCode = result.status;
        result.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(body);
    } catch {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Internal server error');
    }
});

if (require.main === module) {
    const host = process.env.WEB_HOST ?? '127.0.0.1';
    const server = createWebServer();
    server.listen(8787, host, () => console.log(`secretGift: http://${host}:8787`));
    const stop = () => server.close();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
}
