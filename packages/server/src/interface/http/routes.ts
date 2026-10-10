import express from 'express';
import type { HealthResponse, HelloResponse } from '@monorepotest/shared';

/** /v1/api 下的业务路由表（挂载前缀见 app.ts 的 API_PREFIX） */
export class ApiRoutes {
    readonly router: express.Router = express.Router();

    constructor() {
        this.router.get('/health', (_req, res) => {
            const data: HealthResponse = { status: 'ok', timestamp: new Date().toISOString() };
            res.json(data);
        });

        this.router.get('/hello', (_req, res) => {
            const data: HelloResponse = { message: 'Hello from monorepotest server!' };
            res.json(data);
        });
    }
}
