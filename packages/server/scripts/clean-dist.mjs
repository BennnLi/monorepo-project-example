// 构建前清空 dist：tsc 只覆盖同名产物，不删除已移除源码对应的陈旧文件
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
rmSync(distDir, { recursive: true, force: true });
