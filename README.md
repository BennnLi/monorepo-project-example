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
    ├── server/               # 后端服务 (端口 8081)
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
pnpm build           # 构建所有包（先 web 后 server，保证 public 就绪）
pnpm build:server    # 仅构建 server
pnpm build:web       # 仅构建 web
```

> `build:web` 的产物先落到 `packages/server/public/`（Vite `outDir`，已 gitignore）；
> 随后 server 构建把 TS 编译为 `dist/src/*`（与 `src/` 结构镜像，相对路径行为一致），
> 并将 `public/`、仓库根 `.env.production` 与生成的部署用 `package.json`
> （剥离 workspace 依赖与 devDependencies）组装进 `dist/`。
> 修改仓库根 `.env.production` 后需重新构建才会进入 `dist/`。

## 部署

`pnpm build` 后，`packages/server/dist/` 即为可部署单元：

```
dist/
├── src/               # 编译后的 server 源码（镜像 src/ 结构）
├── public/            # web 构建产物
├── .env.production    # 生产 env（构建时从仓库根拷入）
└── package.json       # 生成的部署清单（仅生产依赖，"start": "node src/index.js"）
```

将 `dist/` 压缩上传到服务器后：

```bash
# 安装生产依赖（二选一；package.json 已剥离 workspace 协议，npm 亦可用）
pnpm install --prod        # 或 npm install --omit=dev

# 启动（NODE_ENV 必须由进程环境变量指定，写文件无效）
NODE_ENV=production node src/index.js   # 或 npm start
```

要求 Node >= 22（`process.loadEnvFile`）。机密配置不要写进入库的
`.env.production`，在服务器上以进程环境变量下发（优先级最高）。

## 依赖管理

按依赖性质决定安装位置，遵循以下原则：

| 依赖性质                                                                   | 装在哪                                                        | 命令               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------ |
| 代码 `import` 的运行时依赖                                                 | 各包自己的 `package.json`（多包共用时版本用 `catalog:` 统一） | 见下方「单包安装」 |
| 各包独立使用的开发依赖                                                     | 该包的 `package.json`                                         | 见下方「单包安装」 |
| 所有包的**脚本/配置**共用的工具（ESLint、Prettier、Husky、lint-staged 等） | 根 `package.json` 的 `devDependencies`                        | 见下方「安装到根」 |

```bash
# 单包安装（在根目录执行，--filter 指定包）
pnpm --filter @monorepotest/server add <pkg>
pnpm --filter @monorepotest/server add -D <pkg>

# 单包安装（或 cd 进入包目录后直接 pnpm add <pkg>）

# 给所有包同时安装同一依赖
pnpm -r add <pkg>          # 运行时依赖
pnpm -r add -D <pkg>       # 开发依赖

# 安装到 workspace 根（工具链依赖）
pnpm add -D <pkg>          # 根目录执行
pnpm add -D -w <pkg>       # 子包目录执行，-w 表示装到根
```

### 多包共用依赖的版本统一（catalog）

多个包共用同一依赖（如 `typescript`）时，在 `pnpm-workspace.yaml` 声明一次版本，各包引用 `catalog:` 而不写具体版本，升级只改一处：

```yaml
# pnpm-workspace.yaml
catalog:
    typescript: ^5.6.0
```

```jsonc
// 各包 package.json
{
    "devDependencies": {
        "typescript": "catalog:",
    },
}
```

改完执行 `pnpm install` 生效。

### 纪律

- **代码 `import` 的依赖必须在该包的 `package.json` 中显式声明**，不要依赖 Node 向上查找目录解析到根 `node_modules` 的隐式行为。
- **不要**在 `.npmrc` 使用 `shamefully-hoist=true` 等全量扁平化配置，它会掩盖未声明的依赖。
- 用 `pnpm why <pkg>` 排查某依赖是被谁引入的。

## 代码规范

```bash
pnpm lint            # ESLint 检查
pnpm lint:fix        # ESLint 自动修复
pnpm format          # Prettier 格式化
pnpm format:check    # 检查格式是否一致
```

提交代码时会自动通过 Husky + lint-staged 执行 lint 和 format 检查。

## API 接口

所有接口统一前缀 `/v1/api`：

| 方法 | 路径             | 响应                                                                                                 |
| ---- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| GET  | `/v1/api/health` | `{ status: "ok", timestamp: "..." }`                                                                 |
| GET  | `/v1/api/hello`  | `{ message: "Hello from monorepotest server!" }`                                                     |
| WS   | `/v1/api/ws`     | WebSocket：连接后推送 `connected` 事件，消息回显。单帧上限 64KB，最多 100 个并发连接（超出返回 503） |

开发模式下 Vite 会将 `/v1/api/*` 请求（含 WebSocket 升级）代理到 server 端 `localhost:8081`。

## 环境变量

通过环境变量区分开发环境（development）与正式环境（production）。**server 与 web 共用仓库根目录的同一份 env 文件**，无需各写一份：

```
.env.example        # 入库的示例文件，含全部变量说明
.env.development    # 开发环境默认值（入库）
.env.production     # 正式环境默认值（入库）
.env                # 可选的基础覆盖（不入库）
.env*.local         # 本机机密（不入库，已 gitignore）
```

两端按各自规则读取**同一批文件**，互不干扰：

- **server**（`process.loadEnvFile`，先入为主）：进程环境变量 > `.env.{NODE_ENV}` > `.env`
- **web**（Vite 原生，`envDir` 指向仓库根目录）：`vite dev` 读 `.env` + `.env.development`，`vite build` 读 `.env` + `.env.production`

> 仅 `VITE_` 前缀的变量会注入前端代码，**机密配置严禁使用该前缀**；server 变量（无前缀）不会进入构建产物。

### 变量一览

| 变量                | 消费方 | 默认值                    | 说明                                                                                                                                                        |
| ------------------- | ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | server | `development`             | 运行环境，仅接受 `development` / `production`，决定加载哪个 env 文件。**只能由进程环境变量指定**（写进文件不生效，需在加载前读取）                          |
| `PORT`              | server | `8081`                    | HTTP 监听端口                                                                                                                                               |
| `LOG_LEVEL`         | server | dev `debug` / prod `info` | 日志等级：`debug` / `info` / `warn` / `error`                                                                                                               |
| `CORS_ORIGIN`       | server | 空                        | 允许的跨域来源，逗号分隔，每项须为完整 origin（如 `https://app.example.com`，非法值启动时报错）。**正式环境**为空则不下发 CORS 头；开发环境未配置时默认 `*` |
| `MQTT_SERVER`       | server | 空                        | MQTT 服务地址（预留）                                                                                                                                       |
| `VITE_API_BASE`     | web    | `/v1/api`                 | API 基础路径（不以 `/` 结尾）。开发环境走 Vite 代理；正式部署可改为完整后端地址                                                                             |
| `VITE_PROXY_TARGET` | web    | `http://localhost:8081`   | 开发服务器对 `/v1/api`（含 WS）的代理目标，仅 `vite.config.ts` 使用                                                                                         |

不同环境的行为差异：

|          | development                                    | production                            |
| -------- | ---------------------------------------------- | ------------------------------------- |
| CORS     | `*`（放行所有来源）                            | 按 `CORS_ORIGIN` 白名单，为空则不下发 |
| 日志等级 | `debug`                                        | `info`                                |
| 日志格式 | pino-pretty 彩色人类可读输出                   | pino-pretty 彩色人类可读输出          |
| 加载文件 | 根目录 `.env` + `.env.development`（两端相同） | 根目录 `.env` + `.env.production`     |

```bash
# 开发（默认 development）
pnpm dev

# 正式环境启动 server（PowerShell）
$env:NODE_ENV="production"; pnpm start
# 正式环境启动 server（bash）
NODE_ENV=production pnpm start
```

> 修改根目录 `.env*` 文件后需手动重启 dev server（`tsx watch` 只监听源码变更）；Vite 端会自动重启（改 env 文件会触发重启）。
