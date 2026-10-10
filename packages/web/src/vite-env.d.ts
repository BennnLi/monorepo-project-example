/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** API 基础路径（见 .env.development / .env.production，不以 / 结尾）；运行时可能缺失，代码侧需回退默认值 */
    readonly VITE_API_BASE?: string;
    /** Vite 代理目标（仅 vite.config.ts 使用） */
    readonly VITE_PROXY_TARGET?: string;
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}
