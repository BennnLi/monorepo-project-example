import { createRequire } from 'node:module';
import pino, { type Logger as PinoLogger } from 'pino';
import config from '../../config/index.js';

// package.json 在源码目录之外，用 createRequire 运行时读取，避免 JSON 模块导入限制：
// dev 读包根的 package.json，dist 运行时读部署根下随构建生成的 package.json
const { version } = createRequire(import.meta.url)('../../../package.json') as {
    version: string;
};

const logger = pino({
    level: config.logLevel,
    // 开发与生产统一走 pino-pretty 人类可读输出；它是 dependencies（非 dev），
    // 否则生产 install --prod 后 worker 线程按模块名加载会失败
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: `[${version}] {msg}`,
        },
    },
    formatters: {
        level: (label: string) => {
            return { level: label.toUpperCase() };
        },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

export interface Logger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    child?(bindings: Record<string, unknown>): Logger;
}
export interface LoggerOptions {
    name?: string;
}

const serializeError = (error: unknown): string => {
    if (error instanceof Error) {
        return JSON.stringify(
            {
                name: error.name,
                message: error.message,
                stack: error.stack,
                // ...(error as any).cause && { cause: serializeError((error as any).cause) }
            },
            null,
            2,
        );
    }

    if (typeof error === 'object' && error !== null) {
        return JSON.stringify(error, null, 2);
    }

    return String(error);
};

/**
 * 用指定的 pino 实例与消息前缀构造 Logger 包装。
 *
 * @param target 底层 pino 实例（child 绑定的结构化字段挂在它上面）
 * @param prefix 消息前缀，如 `[Http] `
 * @param childName 当前名称；undefined 表示未命名，不暴露 child()
 */
const wrap = (target: PinoLogger, prefix: string, childName?: string): Logger => {
    const base: Logger = {
        info: (...args) => {
            target.info(prefix + args.join(' '));
        },
        warn: (...args) => {
            target.warn(prefix + args.join(' '));
        },
        error: (...args) => {
            const processedArgs = args.map((arg) =>
                arg instanceof Error ? serializeError(arg) : String(arg),
            );
            target.error(prefix + processedArgs.join(' '));
        },
        debug: (...args) => {
            target.debug(prefix + args.join(' '));
        },
    };

    if (childName === undefined) {
        return base;
    }

    return {
        ...base,
        child: (bindings) => {
            // name 用于层级前缀，其余字段交给 pino.child 绑定，保证结构化上下文不丢失
            const { name, ...rest } = bindings;
            const nextName = typeof name === 'string' ? `${childName}:${name}` : childName;
            return wrap(target.child(rest), `[${nextName}] `, nextName);
        },
    };
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
    const name = options.name;
    return wrap(logger, name ? `[${name}] ` : '', name);
};
