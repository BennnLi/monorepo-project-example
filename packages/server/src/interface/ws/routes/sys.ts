import type { WebSocketConnection } from '../types.js';

export const login = {
    auth: false,
    handler(socket: WebSocketConnection) {
        // 认证成功：标记已认证并解除认证超时
        socket.auth = true;
        if (socket.authTimeout !== null) {
            clearTimeout(socket.authTimeout);
            socket.authTimeout = null;
        }
        return { error: 0 };
    },
};

export const timestamp = {
    auth: false,
    handler() {
        return {
            error: 0,
            data: {
                timestamp: Date.now(),
            },
        };
    },
};
