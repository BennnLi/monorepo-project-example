import Bootstrap from './application/bootstrap.js';

const bootstrap = new Bootstrap();

// 启动失败时输出错误并退出进程
void bootstrap.load().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
