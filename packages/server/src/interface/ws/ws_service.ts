import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Logger } from '../../infra/logger/logger.js';

/** WebSocket 服务默认路径 */
export const WS_PATH = '/v1/api/ws';

/** 心跳检测间隔（毫秒）：超过一个周期未收到 pong 则判定为死连接 */
const HEARTBEAT_INTERVAL = 30_000;

/** 单帧消息上限（字节）：超出由 ws 以 1009 关闭连接，防止大帧耗尽内存/带宽 */
const MAX_PAYLOAD = 64 * 1024;

/** 最大并发连接数：超出后在升级阶段以 503 拒绝，防止连接数耗尽 */
const MAX_CLIENTS = 100;

/** 停止服务时等待客户端关闭握手的宽限期（毫秒），超时强制断开 */
const CLOSE_GRACE_MS = 300;

/** 将 ws 收到的原始数据（Buffer / ArrayBuffer / Buffer[]）按 UTF-8 解码为文本 */
const toUtf8 = (data: RawData): string => {
    if (Buffer.isBuffer(data)) {
        return data.toString('utf8');
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('utf8');
    }
    return Buffer.concat(data).toString('utf8');
};

export interface WsServiceOptions {
    /** 注入的日志器 */
    logger: Logger;
    /** 自定义 WS 路径，默认 WS_PATH */
    path?: string;
}

/**
 * WebSocket 服务（noServer 模式）：挂载到 HTTP server 的 upgrade 事件上。
 *
 * 协议约定（服务端 -> 客户端均为 JSON 文本帧）：
 * - 连接成功：`{"type":"connected","clients":N,"timestamp":"..."}`
 * - 收到消息后回显：`{"type":"echo","data":"<原文>","timestamp":"..."}`
 *
 * 资源限制：单帧上限 `MAX_PAYLOAD`，并发连接上限 `MAX_CLIENTS`。
 * 客户端成员与存活标记统一由 `#clients`（Map<WebSocket, boolean>）跟踪。
 */
export class WsService {
    readonly path: string;
    readonly #server: Server;
    readonly #logger: Logger;
    readonly #wss: WebSocketServer;
    /** 在线连接及其心跳存活标记（收到 pong 置回 true；false 表示待探测） */
    readonly #clients = new Map<WebSocket, boolean>();
    readonly #heartbeat: NodeJS.Timeout;

    constructor(server: Server, options: WsServiceOptions) {
        this.#server = server;
        this.path = options.path ?? WS_PATH;
        this.#logger = options.logger;
        this.#wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
        this.#wss.on('connection', this.#onConnection);
        this.#server.on('upgrade', this.#onUpgrade);
        this.#heartbeat = setInterval(() => {
            this.#checkAlive();
        }, HEARTBEAT_INTERVAL);
    }

    /**
     * 停止服务：清理心跳定时器、停止接受升级请求，向所有客户端发送关闭帧，
     * 宽限期结束后强制断开残留连接（保证 HTTP server.close() 回调不会被挂起）。
     */
    async close(): Promise<void> {
        clearInterval(this.#heartbeat);
        this.#server.off('upgrade', this.#onUpgrade);

        for (const ws of this.#clients.keys()) {
            ws.close(1001, 'server shutting down');
        }

        // 等待客户端完成关闭握手；不响应的客户端宽限期后强制断开
        const deadline = Date.now() + CLOSE_GRACE_MS;
        while (this.#clients.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
        }
        for (const ws of this.#clients.keys()) {
            ws.terminate();
        }
        this.#clients.clear();
        this.#wss.close();
    }

    readonly #onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname !== this.path) {
            // 非本服务路径：直接断开，避免连接悬挂
            socket.destroy();
            return;
        }
        if (this.#clients.size >= MAX_CLIENTS) {
            // 超出连接上限：在升级完成前以 503 拒绝
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
            return;
        }
        this.#wss.handleUpgrade(req, socket, head, (ws) => {
            this.#wss.emit('connection', ws, req);
        });
    };

    readonly #onConnection = (ws: WebSocket, req: IncomingMessage): void => {
        this.#clients.set(ws, true);
        this.#logger.info(
            `client connected from ${req.socket.remoteAddress ?? 'unknown'} ` +
                `(${String(this.#clients.size)} online)`,
        );

        ws.send(
            JSON.stringify({
                type: 'connected',
                clients: this.#clients.size,
                timestamp: new Date().toISOString(),
            }),
        );

        ws.on('pong', () => {
            // 连接可能已在关闭流程中被移除，避免重新写入造成泄漏
            if (this.#clients.has(ws)) {
                this.#clients.set(ws, true);
            }
        });

        ws.on('message', (raw, isBinary) => {
            // 回显消息，便于客户端验证链路（当前协议仅对文本做原样回显）
            ws.send(
                JSON.stringify({
                    type: 'echo',
                    data: isBinary ? '[binary message]' : toUtf8(raw),
                    timestamp: new Date().toISOString(),
                }),
            );
        });

        ws.on('close', () => {
            this.#clients.delete(ws);
            this.#logger.info(`client disconnected (${String(this.#clients.size)} online)`);
        });

        ws.on('error', (err) => {
            this.#logger.error('socket error', err);
        });
    };

    readonly #checkAlive = (): void => {
        for (const [ws, isAlive] of this.#clients) {
            if (!isAlive) {
                // 死连接：强制断开，close 事件会将其从 #clients 移除
                ws.terminate();
                continue;
            }
            this.#clients.set(ws, false);
            ws.ping();
        }
    };
}
