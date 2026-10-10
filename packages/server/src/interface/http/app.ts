import http, { type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { Logger } from '../../infra/logger/logger.js';
import { ApiRoutes } from './routes.js';

/** 所有 HTTP 接口的统一前缀 */
export const API_PREFIX = '/v1/api';

/**
 * web 构建产物目录：本文件上溯三级到「世界根」再进 public ——
 * dev（src/interface/http）为包根的 public/，dist（dist/src/interface/http，
 * 或上传后的部署根/src/interface/http）为部署根的 public/。
 * 镜像结构保证两种运行方式的相对深度一致，无需分支判断。
 */
const PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));

/**
 * 从错误对象提取 HTTP 状态码（body-parser 等中间件会附带 status / statusCode）。
 * 仅接受 400–599，其余（含未知错误）回退 500。
 */
const extractStatus = (err: unknown): number => {
    if (typeof err === 'object' && err !== null) {
        const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
        for (const value of [status, statusCode]) {
            if (typeof value === 'number' && value >= 400 && value <= 599) {
                return value;
            }
        }
    }
    return 500;
};

export interface HttpServerOptions {
    /** 监听端口 */
    port: number;
    /** 注入的日志器 */
    logger: Logger;
    /** 允许的跨域来源，`['*']` 表示通配（开发环境默认）；为空表示不下发 CORS 头 */
    corsOrigins: readonly string[];
}

/** Express 应用 + HTTP server 封装：中间件、路由、监听与关闭 */
export class HttpServer {
    /** 底层 HTTP server（供 WsService 挂载 upgrade 事件） */
    readonly server: Server;
    readonly #port: number;
    readonly #logger: Logger;
    readonly #corsOrigins: readonly string[];
    readonly #app: express.Express;

    constructor(options: HttpServerOptions) {
        this.#port = options.port;
        this.#logger = options.logger;
        this.#corsOrigins = options.corsOrigins;
        this.#app = express();
        this.#configure();
        this.#app.use(API_PREFIX, new ApiRoutes().router);
        this.#configureErrorHandlers();
        this.server = http.createServer(this.#app);
    }

    /** 启动监听，端口占用等监听失败会 reject */
    listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onError = (err: Error): void => {
                this.server.off('listening', onListening);
                reject(err);
            };
            const onListening = (): void => {
                this.server.off('error', onError);
                resolve();
            };
            this.server.once('error', onError);
            this.server.once('listening', onListening);
            this.server.listen(this.#port);
        });
    }

    /** 关闭 HTTP server，停止接受新连接 */
    close(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => {
                resolve();
            });
        });
    }

    #configure(): void {
        this.#configureCors();
        this.#app.use(express.json());
        // 托管 web 打包产物（public），命中文件则直接返回，否则继续走 API 路由
        this.#app.use(express.static(PUBLIC_DIR));
    }

    #configureCors(): void {
        const options = {
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type'],
        };

        // 开发环境默认通配（['*']）
        if (this.#corsOrigins.includes('*')) {
            this.#app.use(cors({ ...options, origin: '*' }));
            return;
        }

        // 正式环境按白名单校验来源；为空则不下发 CORS 头（同源请求不受影响）
        if (this.#corsOrigins.length === 0) {
            return;
        }

        this.#app.use(
            cors({
                ...options,
                origin: (origin, callback) => {
                    // 无 Origin（同源 / 非浏览器请求）直接放行
                    if (!origin || this.#corsOrigins.includes(origin)) {
                        callback(null, true);
                        return;
                    }
                    callback(null, false);
                },
            }),
        );
    }

    #configureErrorHandlers(): void {
        // 未知路由统一返回 JSON 404
        this.#app.use((_req, res) => {
            res.status(404).json({ error: 'Not Found' });
        });

        // 统一错误处理（Express 5 会自动将 async 错误转发到这里）
        const errorHandler: express.ErrorRequestHandler = (err: unknown, _req, res, next) => {
            if (res.headersSent) {
                next(err);
                return;
            }
            // 尊重错误自带的状态码（如畸形 JSON 的 400），仅服务端错误记为 error
            const status = extractStatus(err);
            if (status >= 500) {
                this.#logger.error('request failed', err);
            } else {
                this.#logger.warn(`request failed with status ${String(status)}`, err);
            }
            res.status(status).json({ error: http.STATUS_CODES[status] ?? 'Error' });
        };
        this.#app.use(errorHandler);
    }
}
