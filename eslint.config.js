import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import stylistic from '@stylistic/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    // 全局忽略
    {
        ignores: ['**/dist/**', '**/public/**', '**/node_modules/**', '**/*.d.ts'],
    },

    // 所有文件 — 基础推荐规则（不需要类型信息）
    eslint.configs.recommended,

    // TS/Vue 文件 — strict 类型检查规则（限定 files 避免作用于 .js）
    ...tseslint.configs.strictTypeChecked.map((config) => ({
        ...config,
        files: ['**/*.ts', '**/*.vue'],
    })),
    {
        files: ['**/*.ts', '**/*.vue'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
    },

    // Vue 文件
    ...pluginVue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
    },

    // 先关闭与 Prettier 冲突的规则
    prettier,

    // 再强制分号（放在 prettier 之后，覆盖其对 semi 的禁用）
    {
        files: ['**/*.ts', '**/*.vue'],
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            '@stylistic/semi': ['error', 'always'],
        },
    },
);
