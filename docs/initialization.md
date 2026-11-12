# 工程初始化记录

日期：2026-11-11（Asia/Shanghai）。关联 ENG-002、ENG-003、ENG-012。用户已明确恢复代码开发、授权 GitHub 私有仓库，并要求项目工作全部迁往 E 盘。当前根目录 E:/Projects/material-review-agent。

## 已建立的工程基础

- Next.js 16.4.6 + React 19.3.1，App Router / Route Handlers；页面为中文工作台空态与本地环境状态，包含 404 和错误边界。
- TypeScript 5.9.3 严格检查（含 noUncheckedIndexedAccess）；Tailwind CSS 4.3.5、可继续用 shadcn CLI 管理的 components.json、基础 Button/Badge 与 Radix 组合。
- pnpm 11.25.0、直接依赖精确版本、pnpm-lock.yaml。AI SDK 7 已安装，但没有模型调用或业务推断。
- 服务端环境读取有 server-only 边界，AI_MODE 用 Zod 校验；/api/health 只返回白名单状态，不回传密钥。配置模式与真实接入状态独立，设置 live 不会自动连模型。
- ESLint 10 + @eslint/js、TypeScript、Next.js 核心/Web Vitals、React Hooks 规则；Prettier。保留来源原文，不格式化交接归档或需求正文。
- Playwright 桌面与移动 Chromium、UI/批量/报告入口、失败截图与轨迹；提交格式独立回归测试。
- 自定义 commit-msg 钩子与 pnpm git:setup；GitHub Actions 安装/检查/构建/浏览器测试流水线。

## 本地 Git 与远程

- main 分支；项目本地作者为用户提供的 feiyongjie / qq1258974529@gmail.com；不修改全局作者。
- 私有远程：https://github.com/qq2173704834/material-review-agent ，origin 使用 HTTPS。
- GitHub CLI 通过用户完成的官方设备授权登录 qq2173704834，未读取浏览器 Cookie、密码或要求用户发 Token。
- CLI 可执行文件在 E:/CodexTools/github-cli/bin/gh.exe，当前项目 credential helper 调用它；代理仅配置于当前仓库 GitHub 地址。凭据不写入仓库，未保留本次工具添加的全局 credential helper。
- 本轮可提交和推送初始化代码，不部署、不公开。

## 当前机器的存储与兼容性

初次安装时 C 盘可用空间约 1 GB，跨盘联接依赖出现 Next.js 入口解析问题，跨盘构建输出还导致 React 模块身份不一致。恢复同盘后构建通过；随后用户明确要求全部迁往 E 盘。

- 当前源码、.git、node_modules、.next、tests/、docs/、work/、outputs/ 均位于 E:/Projects/material-review-agent。node_modules 和 .next 为正常项目内目录，迁移后重新安装依赖与构建，避免沿用旧路径。
- pnpm 下载存储为 E:/CodexCache/material-review-agent/pnpm-store，Playwright 浏览器实际文件在 E:/CodexCache/playwright-browsers，系统默认浏览器缓存路径通过目录联接访问。
- 原 C 盘源码文件已迁移；会话仍占用的空目录可暂时存在。后续工具显式以 E 盘根目录执行。
- 迁移前旧依赖/构建保留在 work/migration/ 与 E 盘缓存中，不作为当前依赖或构建输入，默认不入 Git。
- dev/build 保留已验证的 Webpack 方式，共享配置不写本机依赖或构建路径。其他电脑直接克隆安装即可。

## 验证记录

- E盘依赖安装：pnpm install --frozen-lockfile 成功，当前平台288个包，锁文件无变动。
- pnpm check 通过：ESLint、Next路由类型生成、TypeScript、Prettier及4项提交格式单测。
- pnpm build 通过：生成 /、/_not-found、/setup 和 /api/health；类型检查与页面预渲染完成。
- pnpm test:e2e：桌面Chromium与移动Chromium共6项通过，覆盖空态/导航/能力边界、健康检查、404返回，无页面运行错误及横向溢出。
- pnpm dev 实际启动 http://127.0.0.1:3000 ，健康检查200；pnpm test:ui --ui-port 3200 实际启动并返回200，HTML测试报告已生成。
- 实际截图已检查，页面布局正常；截图与交付说明放outputs/，不进入仓库。
- 初始化关闭Next自动改写AGENTS规则功能，保留项目自主规则；next-env.d.ts由框架生成并忽略，类型检查先运行next typegen，支持首次克隆检查。
- 早期路径和空间导致的失败不计为通过。AT01—AT12、免费真实模型、PDF解析和数据库均未实现或执行。
- 初始化提交 045e784 已推送，GitHub Actions 首次完整验证通过（运行 43026647223）：干净安装、pnpm check、生产构建、浏览器安装与6项端到端场景均通过。运行链接：https://github.com/qq2173704834/material-review-agent/actions/runs/43026647223 。
- 根据首次CI实际弃用提示，更新Action到使用Node24的稳定发行版，固定Ubuntu24.04，避免旧运行声明及浮动操作系统；更新后的远程结果在交付记录中核实。
- 本地与origin/main提交一致，工作区干净；已提交4ac5311交接归档与045e784工程初始化。远程确认isPrivate=true、默认分支main。

## 初始化阶段的历史下一步

初始化完成后的历史计划为 ENG-004。后续功能推进、实际覆盖和当前未完成项以 `tasks.md` 与 `development-plan.md` 为准。
