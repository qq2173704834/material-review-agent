# 材料预审工作台

由当前通知或项目要求驱动的通用材料预审 Agent：提取要求、匹配材料、逐项核验，提供可追溯的问题说明、整改建议与复检报告。

当前为 **v0.1.0 工程初始化版**：任务空态、环境状态、服务端健康检查、严格类型与代码检查、自定义提交校验及 Playwright 桌面/移动测试入口。任务保存、PDF、动态规则、模型调用、复检及报告尚未实现，没有预置演示结论。

本机工作目录已按用户要求迁移到 `E:\Projects\material-review-agent`，后续开发、Git、文档与测试均在此目录进行。

## 安装和运行

需要 Node.js 24、pnpm 11.25.0、Git。依赖版本由 pnpm-lock.yaml 锁定。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

访问 http://127.0.0.1:3000 。开发与生产服务默认仅绑定本机，无需模型密钥或数据库即可启动初始化页面。

按需将 .env.example 复制为 .env.local。默认 AI_MODE=mock；本版没有模型调用，设置 live 或填写密钥也不会自动调用。免费真实接口在后续服务端接入，密钥不可使用 NEXT_PUBLIC_ 前缀或进入 Git。

```sh
pnpm check
pnpm build
pnpm start
```

check 包括 ESLint、TypeScript、Prettier 检查和提交校验单测。生产启动先 build。/api/health 返回白名单状态，不返回密钥、服务地址或原始环境。

## 网页功能测试

```sh
pnpm test:install
pnpm build
pnpm test:e2e
pnpm test:ui
pnpm test:report
```

测试自动在本机 3100 端口启动生产构建，覆盖桌面/移动 Chromium。UI 可按场景运行，失败保留轨迹/截图。详见 [tests/README.md](tests/README.md)。当前覆盖工程基础，AT01—AT12 业务场景尚未执行。

## 技术和目录

React + Next.js App Router / Route Handlers、严格 TypeScript、Tailwind CSS + shadcn/ui 基础组件、Vercel AI SDK、Zod、pnpm、ESLint、Prettier、Playwright。状态库按需引入。

```text
src/app/                 页面、布局与健康检查
src/components/          工作台壳与基础 UI
src/domain/              判定、执行、结果有效性等类型
src/lib/server/          仅服务端环境读取
scripts/                 Git 配置与提交格式校验
.githooks/               当前仓库提交钩子
.github/workflows/       工程 CI
 tests/                  场景、样例、模拟与辅助工具
 docs/                   需求、计划、决策与真实进度
```

数据库、存储、PDF 解析与检索尚未实现，建议见 [决策记录](docs/decisions.md)。本地单人版未实现多人权限隔离，请勿直接作为公开服务部署。

## Git 协作

首次克隆后执行 `pnpm git:setup` 启用当前仓库提交钩子；每位协作者自行设置本地作者。使用 main 分支，不修改全局 Git 设置。

```text
[类型(编号)]: 中文摘要

目的：为什么进行本次修改。
变更：实现或修复了什么。
验证：实际执行的检查及结果；未执行时说明原因。
```

工程编号先在任务记录登记，需求沿用原编号，缺陷建立真实记录。格式校验不能代替编号真实性和暂存审查。密钥、本地数据、依赖和测试产物、work/、outputs/ 默认忽略。用户授权建立 GitHub 私有仓库，公开与部署另行决定。

## 项目资料

- [项目规则](AGENTS.md)：协作、命名、提交、安全与测试约定。
- [需求](docs/requirements.md)：114 条编号需求及 12 场景。
- [计划](docs/development-plan.md)、[任务](docs/tasks.md)：分功能顺序与实际状态。
- [环境记录](docs/environment.md)、[测试策略](docs/test-strategy.md)：环境和验证边界。
- [原始交接](docs/handoff/handoff-prompt.md)：历史快照。

临时名称为材料预审工作台，团队信息待提供。比赛信息来自交接历史资料，实际提交前核对最新官方通知。本轮不部署、不制作比赛材料。
