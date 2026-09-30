import http from 'node:http';
import type { HealthResponse, HelloResponse } from '@monorepotest/shared';

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
    // CORS headers for development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = req.url || '/';

    if (url === '/api/health') {
        const data: HealthResponse = { status: 'ok', timestamp: new Date().toISOString() };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    if (url === '/api/hello') {
        const data: HelloResponse = { message: 'Hello from monorepotest server!' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${String(PORT)}`);
});
