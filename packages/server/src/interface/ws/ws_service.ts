import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Logger } from '../../infra/logger/logger.js';
import routes from './routes/index.js';
import type {
    SocketBroadcast,
    SocketRequest,
    SocketResponse,
    WebSocketConnection,
} from './types.js';

/** WebSocket 服务默认路径 */
export const WS_PATH = '/v1/api/ws';

/** 应用层心跳标识：客户端文本 `ping`，服务端应答文本 `pong` */
const PING = 'ping';
const PONG = 'pong';

/** 心跳超时基数（毫秒）：连接后 60s 未认证断开，90s（1.5 倍）无心跳断开 */
const HB_TIMEOUT_MS = 60_000;

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

/** 路由处理器返回值：响应体（不含 action / seq，由服务端按请求补齐） */
type RouteHandlerReturn = Omit<SocketResponse, 'action' | 'seq'>;

/** 路由处理器上下文，暴露服务实例供路由调用广播等能力 */
export interface RouteCtx {
    server: WsService;
}

export interface Route {
    /** 是否要求连接已完成认证，默认（未显式声明时）为 true */
    auth?: boolean;
    handler: (
        socket: WebSocketConnection,
        ctx: RouteCtx,
    ) => RouteHandlerReturn | Promise<RouteHandlerReturn>;
}

/**
 * WebSocket 服务（noServer 模式）：挂载到 HTTP server 的 upgrade 事件上，
 * 负责连接接入、请求路由、响应下发与心跳清理。
 *
 * 连接约定：升级地址为 `${path}?id=<socketId>`，`id` 必填且不可重复，
 * 校验失败先完成升级、再以错误报文下发并关闭。
 *
 * 消息协议（JSON 文本帧，心跳除外）：
 * - 客户端 -> 服务端：`{"action":"sys.login","seq":"1","data":{}}`；心跳直接发送文本 `ping`
 * - 服务端 -> 客户端：`{"error":0,"seq":"1","action":"sys.loginRsp","data":{}}`；
 *   心跳应答文本 `pong`；失败响应 `action` 后缀为 `Resp`（沿用原模板），成功为 `Rsp`
 *
 * 连接生命周期：
 * - 连接后 `HB_TIMEOUT_MS` 内未完成 `sys.login` 会被服务端断开
 * - `HB_TIMEOUT_MS * 1.5` 内无心跳（文本 `ping`）的连接会被服务端清理
 *
 * 资源限制：单帧上限 `MAX_PAYLOAD`，并发连接上限 `MAX_CLIENTS`。
 * 连接按 id 统一由 `#socketsMap` 跟踪；心跳定时器在无连接时自动停止。
 */
export class WsService {
    readonly path: string;
    readonly #server: Server;
    readonly #logger: Logger;
    readonly #wss: WebSocketServer;
    /** 在线连接（key 为连接 id，元数据挂在连接实例上） */
    readonly #socketsMap = new Map<string, WebSocketConnection>();
    /** 心跳清理定时器，无连接时为 null（懒启动） */
    #hbInterval: NodeJS.Timeout | null = null;
    /** 扁平化的路由表，key 为 `namespace.key` 形式的 action */
    readonly #routes = new Map<string, Route>();
    readonly #ctx: RouteCtx;

    constructor(server: Server, options: WsServiceOptions) {
        this.#server = server;
        this.path = options.path ?? WS_PATH;
        this.#logger = options.logger;
        this.#wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
        this.#server.on('upgrade', this.#onUpgrade);
        this.#ctx = { server: this };
        this.#loadRoutes(routes);
    }

    /**
     * 停止服务：清理心跳定时器、停止接受升级请求，向所有客户端发送关闭帧，
     * 宽限期结束后强制断开残留连接（保证 HTTP server.close() 回调不会被挂起）。
     */
    async close(): Promise<void> {
        this.#endHbInterval();
        this.#server.off('upgrade', this.#onUpgrade);

        for (const conn of this.#socketsMap.values()) {
            this.#clearAuthTimeout(conn);
            conn.close(1001, 'server shutting down');
        }

        // 等待客户端完成关闭握手；不响应的客户端宽限期后强制断开
        const deadline = Date.now() + CLOSE_GRACE_MS;
        while (this.#socketsMap.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
        }
        for (const conn of [...this.#socketsMap.values()]) {
            conn.terminate();
        }
        this.#socketsMap.clear();
        this.#wss.close();
    }

    // ==================== 对路由暴露的能力 ====================

    /** 向连接发送文本（string 原样发送，object 序列化为 JSON）；连接非 OPEN 时忽略 */
    socketSend(socket: WebSocketConnection, data: string | object): void {
        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }
        socket.send(typeof data === 'string' ? data : JSON.stringify(data));
    }

    /** 下发成功响应：`action` 补 `Rsp` 后缀并回显请求 `seq` */
    responseOk(
        socket: WebSocketConnection,
        request: SocketRequest,
        response?: Pick<SocketResponse, 'data' | 'msg'>,
    ): void {
        this.socketSend(socket, {
            error: 0,
            seq: request.seq,
            action: `${request.action}Rsp`,
            data: response?.data,
            msg: response?.msg,
        });
    }

    /** 下发失败响应：`action` 补 `Resp` 后缀并记录告警日志 */
    responseFailed(
        socket: WebSocketConnection,
        request: SocketRequest,
        response: Pick<SocketResponse, 'error' | 'data' | 'msg'>,
    ): void {
        const data: SocketResponse = {
            error: response.error,
            seq: request.seq,
            action: `${request.action}Resp`,
            data: response.data,
            msg: response.msg,
        };
        this.#logger.warn(`responseFailed, data: ${JSON.stringify(data)}`);
        this.socketSend(socket, data);
    }

    /** 向满足过滤条件（缺省为全部）的连接广播消息，单个连接失败不影响其余连接 */
    broadcast(data: SocketBroadcast, filterFn?: (socket: WebSocketConnection) => boolean): void {
        const values = [...this.#socketsMap.values()];
        const socketList =
            filterFn !== undefined ? values.filter((socket) => filterFn(socket)) : values;
        socketList.forEach((socket) => {
            try {
                this.socketSend(socket, data);
            } catch (err) {
                this.#logger.error(`broadcast to ${socket.id} error`, err);
            }
        });
    }

    /** 向所有已完成认证的连接广播 */
    broadcastToAuthedSocket(data: SocketBroadcast): void {
        this.broadcast(data, (socket) => socket.auth);
    }

    // ==================== 升级与连接接入 ====================

    readonly #onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== this.path) {
            // 非本服务路径：直接断开，避免连接悬挂
            socket.destroy();
            return;
        }
        if (this.#socketsMap.size >= MAX_CLIENTS) {
            // 超出连接上限：在升级完成前以 503 拒绝
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
            return;
        }
        // 与原实现一致：先完成升级，再校验业务参数，错误通过 ws 消息下发
        this.#wss.handleUpgrade(req, socket, head, (ws) => {
            const id = url.searchParams.get('id') ?? '';
            const errMsg =
                id === ''
                    ? 'The query parameter id is required.'
                    : this.#socketsMap.has(id)
                      ? 'The socket ID already exists.'
                      : null;
            if (errMsg !== null) {
                this.socketSend(ws as WebSocketConnection, { error: 400, msg: errMsg });
                ws.close();
                return;
            }
            this.#handleSocketConnect(id, ws, req.socket.remoteAddress);
        });
    };

    /** 填充连接元数据、挂载事件监听并纳入心跳管理 */
    #handleSocketConnect(id: string, socket: WebSocket, remoteAddress?: string): void {
        const conn = socket as WebSocketConnection;
        conn.id = id;
        conn.lastHb = Date.now();
        conn.auth = false;
        // 认证超时：到点仍未 sys.login 则断开（定时器触发时由 #deleteSocket 统一清理）
        conn.authTimeout = setTimeout(() => {
            this.#logger.info(`socket ${id} auth timeout, closing`);
            this.#deleteSocket(id);
        }, HB_TIMEOUT_MS);

        conn.on('error', (err: unknown) => {
            this.#logger.error('socket error happen', err);
        });
        conn.on('close', () => {
            this.#detachSocket(conn);
            this.#logger.info(`client disconnected (${String(this.#socketsMap.size)} online)`);
        });
        conn.on('message', (rawData) => {
            void this.#onMessage(conn, toUtf8(rawData));
        });

        this.#socketsMap.set(id, conn);
        this.#startHbInterval();
        this.#logger.info(
            `client connected id=${id} from ${remoteAddress ?? 'unknown'} ` +
                `(${String(this.#socketsMap.size)} online)`,
        );
    }

    // ==================== 请求路由与响应 ====================

    async #onMessage(socket: WebSocketConnection, text: string): Promise<void> {
        let requestBody: SocketRequest | null = null;
        try {
            // 应用层心跳：刷新 lastHb 并应答 pong
            if (text === PING) {
                socket.lastHb = Date.now();
                this.socketSend(socket, PONG);
                return;
            }

            requestBody = JSON.parse(text) as SocketRequest;
            this.#logger.info(`handle message: ${text}`);

            const { action, seq } = requestBody;
            if (!action || !seq) {
                this.responseFailed(socket, requestBody, {
                    error: 400,
                    msg: 'action or seq is required',
                });
                return;
            }

            const route = this.#routes.get(action);
            if (route === undefined) {
                this.responseFailed(socket, requestBody, { error: 404, msg: 'action not found' });
                return;
            }

            const needAuth = route.auth !== false;
            if (needAuth && !socket.auth) {
                this.responseFailed(socket, requestBody, { error: 401, msg: 'unauthorized' });
                return;
            }

            const data = await route.handler(socket, this.#ctx);
            if (data.error === 0) {
                this.responseOk(socket, requestBody, data);
            } else {
                this.responseFailed(socket, requestBody, data);
            }
        } catch (err) {
            this.#logger.error('onMessage error happen', err);
            if (requestBody === null) {
                // 请求体都未能解析：无法回显 action/seq，按独立错误帧下发
                this.#logger.warn(`parse rawData error, rawData: ${text}`);
                this.socketSend(socket, {
                    error: 500,
                    seq: String(Date.now()),
                    msg: `parse message error, rawData ${text}`,
                });
                return;
            }
            this.responseFailed(socket, requestBody, {
                error: 500,
                msg: err instanceof Error ? err.message : 'unknown',
            });
        }
    }

    /** 将 `namespace.key` 形式的路由表展平为 `namespace.key` -> Route */
    #loadRoutes(routesMap: Record<string, Record<string, Route | Route['handler']>>): void {
        this.#routes.clear();
        Object.entries(routesMap).forEach(([namespace, routeObject]) => {
            Object.entries(routeObject).forEach(([key, route]) => {
                const action = `${namespace}.${key}`;
                this.#routes.set(
                    action,
                    typeof route === 'function' ? { auth: true, handler: route } : route,
                );
            });
        });
    }

    // ==================== 心跳清理 ====================

    #startHbInterval(): void {
        if (this.#hbInterval !== null) {
            return;
        }
        this.#logger.info('start hbInterval');
        this.#hbInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, conn] of [...this.#socketsMap.entries()]) {
                const diff = now - conn.lastHb;
                if (diff > HB_TIMEOUT_MS * 1.5) {
                    this.#logger.info(`socket hb timeout, id=${id}, diff: ${String(diff)}`);
                    // 判定为死连接：跳过关闭握手直接强制断开，close 事件完成清理
                    conn.terminate();
                }
            }
        }, HB_TIMEOUT_MS);
    }

    #endHbInterval(): void {
        if (this.#hbInterval !== null) {
            this.#logger.info('end hbInterval');
            clearInterval(this.#hbInterval);
            this.#hbInterval = null;
        }
    }

    /** 断开指定连接（关闭握手由 close 事件收尾） */
    #deleteSocket(id: string): void {
        const conn = this.#socketsMap.get(id);
        if (conn === undefined) {
            return;
        }
        if (conn.readyState === WebSocket.OPEN || conn.readyState === WebSocket.CONNECTING) {
            conn.close();
        } else {
            // 已无关闭握手可言（如半开连接）：直接强制断开，触发 close 事件完成清理
            conn.terminate();
        }
    }

    /** 将连接移出映射：清理认证超时定时器，无连接时停止心跳定时器（幂等） */
    #detachSocket(conn: WebSocketConnection): void {
        this.#clearAuthTimeout(conn);
        this.#socketsMap.delete(conn.id);
        if (this.#socketsMap.size === 0) {
            this.#endHbInterval();
        }
    }

    #clearAuthTimeout(conn: WebSocketConnection): void {
        if (conn.authTimeout !== null) {
            clearTimeout(conn.authTimeout);
            conn.authTimeout = null;
        }
    }
}
