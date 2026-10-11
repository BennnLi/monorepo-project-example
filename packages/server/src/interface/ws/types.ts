import type { WebSocket } from 'ws';

/**
 * 携带连接元数据的 WebSocket 实例（由 WsService 在接入时填充）。
 * 元数据直接挂在实例上，替代原模板中 lodash `_.set` 的写法。
 */
export type WebSocketConnection = WebSocket & {
    /** 连接 id（来自升级请求的 `?id=` 查询参数，连接内唯一） */
    id: string;
    /** 最近一次应用层心跳（文本 ping）时间戳 */
    lastHb: number;
    /** 是否已完成业务层认证（sys.login） */
    auth: boolean;
    /** 认证超时定时器，认证成功后清除 */
    authTimeout: NodeJS.Timeout | null;
};

/** 客户端 -> 服务端的请求报文 */
export interface SocketRequest<T = Record<string, unknown>> {
    /** 路由动作，如 `sys.login` */
    action: string;
    /** 请求序列号，原样回显在响应中，用于配对 */
    seq: string;
    data?: T;
}

/** 服务端 -> 客户端的响应报文（成功 `action` 后缀 `Rsp`，失败 `Resp`，沿用原模板） */
export interface SocketResponse extends SocketRequest {
    /** 0 为成功，其余为错误码（400/401/404/500 ...） */
    error: number;
    msg?: string;
}

/** 服务端 -> 客户端的广播报文（无 seq，不参与请求配对） */
export interface SocketBroadcast {
    action: string;
    data?: Record<string, unknown>;
}
