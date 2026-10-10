import config, { type ApplicationConfig } from '../config/index.js';
import { createLogger, type Logger } from '../infra/logger/logger.js';
import { HttpServer } from '../interface/http/app.js';
import { WsService } from '../interface/ws/ws_service.js';

export interface BootstrapOptions {
    /** 监听端口，默认取 config.port（环境变量 PORT） */
    port?: number;
}

/**
 * 应用引导器：负责依赖初始化与注入、应用启动与销毁。
 *
 * - `load()`：创建 HttpServer / WsService 并注入日志器，启动监听，注册退出信号
 * - `unload()`：注销信号，停止 WS、关闭 HTTP，释放全部资源
 */
export default class Bootstrap {
    readonly #config: ApplicationConfig;
    readonly #logger: Logger;
    #httpServer?: HttpServer;
    #wsService?: WsService;

    constructor(appConfig: ApplicationConfig = config) {
        this.#config = appConfig;
        this.#logger = createLogger({ name: 'App' });
    }

    /** 初始化依赖、完成注入并启动 HTTP/WS 服务 */
    async load(): Promise<void> {
        // 依赖初始化与注入
        this.#httpServer = new HttpServer({
            port: this.#config.port,
            logger: createLogger({ name: 'Http' }),
            corsOrigins: config.corsOrigins,
        });
        this.#wsService = new WsService(this.#httpServer.server, {
            logger: createLogger({ name: 'Ws' }),
        });

        try {
            await this.#httpServer.listen();
        } catch (err) {
            // 监听失败（如端口占用）：回滚已初始化的依赖，避免资源泄漏
            await this.unload();
            throw err;
        }

        this.#logger.debug(JSON.stringify(this.#config));
        this.#logger.info(
            `Server running at http://localhost:${String(this.#config.port)} [${config.nodeEnv}]`,
        );

        process.on('SIGINT', this.#onSigint);
        process.on('SIGTERM', this.#onSigterm);
    }

    /** 销毁应用：注销信号，停止 WS 并关闭 HTTP 服务 */
    async unload(): Promise<void> {
        process.off('SIGINT', this.#onSigint);
        process.off('SIGTERM', this.#onSigterm);

        // WsService.close 为异步（等待关闭握手宽限期），需等待其完成再关 HTTP
        await this.#wsService?.close();
        this.#wsService = undefined;

        if (this.#httpServer) {
            await this.#httpServer.close();
            this.#httpServer = undefined;
        }

        this.#logger.info('application unloaded');
    }

    readonly #onSigint = (): void => {
        void this.#shutdown('SIGINT');
    };

    readonly #onSigterm = (): void => {
        void this.#shutdown('SIGTERM');
    };

    async #shutdown(signal: string): Promise<void> {
        this.#logger.info(`${signal} received, shutting down...`);
        // 兜底：避免残留连接阻止进程退出；未能完成优雅关闭视为失败，以非零码退出
        setTimeout(() => {
            this.#logger.error('shutdown timed out, forcing exit');
            process.exit(1);
        }, 3000).unref();

        try {
            await this.unload();
            process.exit(0);
        } catch (err) {
            this.#logger.error('shutdown failed', err);
            process.exit(1);
        }
    }
}
