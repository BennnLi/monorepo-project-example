// 组装可部署的 dist（在 tsc 之后运行）：
//   1. public/      → dist/public/    web 构建产物（vite outDir 在包根，此处收进 dist）
//   2. .env.production → dist/        服务器侧 env（机密仍应通过进程环境变量下发）
//   3. package.json → dist/（重新生成）剥离 workspace 依赖与 devDependencies，
//                     供部署机执行 install --prod；含 "type": "module" 与 version
//                     （logger 运行时通过 createRequire 读取 version）
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(pkgRoot, 'dist');
const repoRoot = path.join(pkgRoot, '..', '..');

const assembled = [];

// public → dist/public（清掉上次的旧 hash 资产；web 未构建时跳过）
rmSync(path.join(distDir, 'public'), { recursive: true, force: true });
const publicDir = path.join(pkgRoot, 'public');
if (existsSync(publicDir)) {
    cpSync(publicDir, path.join(distDir, 'public'), { recursive: true });
    assembled.push('public');
}

// 仓库根 .env.production → dist/（不存在时跳过，部署机可全靠进程环境变量）
const prodEnv = path.join(repoRoot, '.env.production');
if (existsSync(prodEnv)) {
    cpSync(prodEnv, path.join(distDir, '.env.production'));
    assembled.push('.env.production');
}

// 生成部署用 package.json
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const deployPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    // process.loadEnvFile 需要 Node 22+
    engines: { node: '>=22' },
    scripts: { start: 'node src/index.js' },
    // 剔除 workspace: 协议依赖（部署机上不属于任何 workspace）；devDependencies 不进生产
    dependencies: Object.fromEntries(
        Object.entries(pkg.dependencies ?? {}).filter(
            ([, range]) => !range.startsWith('workspace:'),
        ),
    ),
};
writeFileSync(path.join(distDir, 'package.json'), `${JSON.stringify(deployPkg, null, 4)}\n`);
assembled.push('package.json');

process.stdout.write(`assemble-dist: dist/{src, ${assembled.join(', ')}} ready\n`);
