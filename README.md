# MonorepoTest

基于 pnpm workspace 的 monorepo 项目，包含 server 端和 web 端。

## 技术栈

| 层级     | 技术                              |
| -------- | --------------------------------- |
| 包管理   | pnpm workspace                    |
| Server   | TypeScript + 原生 Node.js HTTP    |
| Web      | Vite + Vue 3 + TypeScript         |
| 代码规范 | ESLint 9 (flat config) + Prettier |
| 提交规范 | Husky + lint-staged               |

## 目录结构

```
monorepotest/
├── eslint.config.js          # ESLint flat config
├── .prettierrc               # Prettier 配置
├── tsconfig.base.json        # 共享 TypeScript 基础配置
└── packages/
    ├── server/               # 后端服务 (端口 3000)
    │   └── src/index.ts      # Node.js HTTP 服务
    └── web/                  # 前端应用 (端口 5173)
        └── src/              # Vue 3 SFC
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 同时启动 server 和 web
pnpm dev

# 单独启动
pnpm dev:server    # server 端 (tsx watch 热更新)
pnpm dev:web       # web 端 (Vite HMR)
```

## 构建

```bash
pnpm build           # 构建所有包
pnpm build:server    # 仅构建 server
pnpm build:web       # 仅构建 web
```

## 代码规范

```bash
pnpm lint            # ESLint 检查
pnpm lint:fix        # ESLint 自动修复
pnpm format          # Prettier 格式化
pnpm format:check    # 检查格式是否一致
```

提交代码时会自动通过 Husky + lint-staged 执行 lint 和 format 检查。

## API 接口

| 方法 | 路径          | 响应                                             |
| ---- | ------------- | ------------------------------------------------ |
| GET  | `/api/health` | `{ status: "ok", timestamp: "..." }`             |
| GET  | `/api/hello`  | `{ message: "Hello from monorepotest server!" }` |

开发模式下 Vite 会将 `/api/*` 请求代理到 server 端 `localhost:3000`。

## 环境变量

| 变量   | 默认值 | 说明            |
| ------ | ------ | --------------- |
| `PORT` | `3000` | Server 监听端口 |
