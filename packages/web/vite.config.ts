import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 共享 env 文件位于仓库根目录（与 server 共用同一份 .env / .env.{mode}）
const repoRoot = resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
    // 按 mode 加载根目录的 .env / .env.{mode}，VITE_PROXY_TARGET 仅供本配置使用
    const env = loadEnv(mode, repoRoot);

    return {
        plugins: [vue()],
        // import.meta.env 同样从根目录的 env 文件注入
        envDir: repoRoot,
        resolve: {
            alias: {
                '@': resolve(import.meta.dirname, 'src'),
            },
        },
        build: {
            // 产物直接输出到 server 的静态目录，pnpm build:web 后 server 即可托管
            // outDir 在本包根之外，必须显式 emptyOutDir 才会清空旧产物
            outDir: resolve(import.meta.dirname, '../server/public'),
            emptyOutDir: true,
        },
        server: {
            port: 5173,
            proxy: {
                '/v1/api': {
                    target: env.VITE_PROXY_TARGET || 'http://localhost:8081',
                    changeOrigin: true,
                    ws: true,
                },
            },
        },
    };
});
