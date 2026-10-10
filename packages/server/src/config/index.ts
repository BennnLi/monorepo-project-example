import { existsSync } from 'node:fs';

/** 支持的运行环境 */
type NodeEnv = 'development' | 'production';

/** 可选的日志等级 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 按 NODE_ENV 加载 env 文件，目录候选（靠前优先）：
 *
 * 1. 仓库根（与 web 共享）：仅本地开发存在，用 `pnpm-workspace.yaml`
 *    作标识，避免部署机上误匹配任意上级目录里的同名文件
 * 2. 世界根：本文件在 src|dist/src/config 下上溯两级 —— dev 为包根
 *    （通常没有 env 文件），部署时为上传的部署根（构建会把
 *    `.env.production` 拷进去）
 *
 * `process.loadEnvFile` 为先入为主：不会覆盖已存在的键。因此按
 * `.env.{NODE_ENV}` → `.env` 的顺序加载，得到的优先级为：
 * 进程环境变量 > .env.{NODE_ENV} > .env
 *
 * 注意：NODE_ENV 本身必须由进程环境变量指定（在加载文件之前读取），
 * 写进 .env 文件不会生效。
 */
const loadEnvFiles = (nodeEnv: NodeEnv): void => {
    const repoRoot = new URL('../../../../', import.meta.url);
    const worldRoot = new URL('../../', import.meta.url);
    const dirs = existsSync(new URL('pnpm-workspace.yaml', repoRoot))
        ? [repoRoot, worldRoot]
        : [worldRoot];
    const files = dirs.flatMap((dir) => [new URL(`.env.${nodeEnv}`, dir), new URL('.env', dir)]);
    for (const file of files) {
        // 文件缺失时跳过（如仅克隆了 .env.example），loadEnvFile 缺文件会抛错
        if (existsSync(file)) {
            process.loadEnvFile(file);
        }
    }
};

const rawNodeEnv = process.env.NODE_ENV ?? 'development';
if (rawNodeEnv !== 'development' && rawNodeEnv !== 'production') {
    throw new Error(`Invalid NODE_ENV "${rawNodeEnv}", expected "development" or "production"`);
}
const nodeEnv: NodeEnv = rawNodeEnv;
loadEnvFiles(nodeEnv);

const isProd = nodeEnv === 'production';

/** 读取可选的字符串配置，空串视为未设置 */
const readString = (key: string): string => process.env[key]?.trim() || '';

/** 读取端口，未设置时取默认值 8081，非法值直接抛错 */
const readPort = (): number => {
    const raw = readString('PORT');
    if (raw === '') {
        return 8081;
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT "${raw}", expected an integer between 1 and 65535`);
    }
    return port;
};

/** 读取日志等级，未设置时按环境取默认值（development=debug，production=info） */
const readLogLevel = (): LogLevel => {
    const raw = readString('LOG_LEVEL');
    if (raw === '') {
        return isProd ? 'info' : 'debug';
    }
    if (raw !== 'debug' && raw !== 'info' && raw !== 'warn' && raw !== 'error') {
        throw new Error(`Invalid LOG_LEVEL "${raw}", expected debug | info | warn | error`);
    }
    return raw;
};

/**
 * 解析 CORS 允许来源：
 * - development：未配置时默认 `['*']`（开发环境放行所有来源）
 * - production：按 `CORS_ORIGIN`（逗号分隔）解析；为空表示不下发 CORS 头
 *
 * 每个条目必须是完整 origin（`scheme://host[:port]`，或通配符 `*`），并规范化为
 * 与浏览器 Origin 头一致的形式（小写 host、省略默认端口）；缺 scheme 等非法值
 * 直接抛错，避免白名单静默失效。
 */
const readCorsOrigins = (): readonly string[] => {
    const raw = readString('CORS_ORIGIN');
    const entries =
        raw === ''
            ? []
            : raw
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
    const origins = entries.map((entry) => {
        if (entry === '*') {
            return entry;
        }
        let url: URL;
        try {
            url = new URL(entry);
        } catch {
            throw new Error(
                `Invalid CORS_ORIGIN entry "${entry}", expected an origin like https://example.com`,
            );
        }
        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.pathname !== '/' ||
            url.search !== '' ||
            url.hash !== ''
        ) {
            throw new Error(
                `Invalid CORS_ORIGIN entry "${entry}", expected scheme://host[:port] without path/query`,
            );
        }
        return url.origin;
    });
    if (origins.length > 0) {
        return origins;
    }
    return isProd ? [] : ['*'];
};

/** 应用配置（来源于环境变量与 .env 文件，导入时完成加载与校验） */
export interface AppConfig {
    /** 运行环境 */
    readonly nodeEnv: NodeEnv;
    /** 是否为正式环境 */
    readonly isProd: boolean;
    /** HTTP 监听端口 */
    readonly port: number;
    /** 日志等级 */
    readonly logLevel: LogLevel;
    /** 允许的跨域来源，`['*']` 表示通配（开发环境默认）；为空表示不下发 CORS 头 */
    readonly corsOrigins: readonly string[];
    readonly mqtt: {
        /** MQTT 服务地址（预留，暂无消费方；与使用它的代码一起落地） */
        readonly server: string;
    };
}

const config: AppConfig = {
    nodeEnv,
    isProd,
    port: readPort(),
    logLevel: readLogLevel(),
    corsOrigins: readCorsOrigins(),
    mqtt: {
        server: readString('MQTT_SERVER'),
    },
};

export default config;

export type ApplicationConfig = typeof config;
