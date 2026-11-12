# 材料预审工作台

由当前通知或项目要求驱动的通用材料预审 Agent：提取要求、匹配材料、逐项核验，提供可追溯的问题说明、整改建议与复检报告。

当前为 **v0.1.0 本地审查闭环开发版**：任务与通知版本保存、多格式材料解析、模拟/真实模型规则提取、确定性规格工具、有原文证据的模型辅助审查、材料版本失效提示、复检对比及 Markdown 报告。真实模式已用 DeepSeek 的合成样例联通；复杂规则和真实业务材料仍需评估，不代表全部 114 条规划需求已完成。

本机工作目录已按用户要求迁移到 `E:\Projects\material-review-agent`，后续开发、Git、文档与测试均在此目录进行。

## 安装和运行

需要 Node.js 24、pnpm 11.25.0、Git。依赖版本由 pnpm-lock.yaml 锁定。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

访问 http://127.0.0.1:3000 。开发与生产服务默认仅绑定本机。任务、原件和解析内容保存在项目 `.local-data/`，SQLite 自动初始化和迁移；模拟模式无需模型密钥。

首次配置时复制 `.env.example` 为 `.env.local`；已有配置时直接编辑，避免覆盖密钥。模板默认 `AI_MODE=mock`，真实调用使用 `AI_MODE=live`。DeepSeek 示例：

```dotenv
AI_MODE=live
AI_PROVIDER=deepseek
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_API_KEY=在本机填写你的密钥
AI_TIMEOUT_MS=60000
AI_MAX_CALLS_PER_REVIEW=12
```

模型名与额度以服务商控制台为准。填写 API 根地址，不填写 `/chat/completions`；重启服务后访问 `/setup`，点击“测试模型连接”。测试只发送合成请求，生成规则发送通知，运行语义审查发送相关材料片段；密钥只在服务端使用。详见 [模型配置与联调](docs/model-setup.md)。

## 本地操作流程

1. 新建任务，粘贴通知，或导入公开网页、PDF、DOCX、TXT 要求文件，并填写项目背景。
2. 生成规则草稿，查看必须/建议/可选、条件、真实模型标识和原文位置。生成后会自动更新检查入口。
3. 在任务详情按需添加补充 PDF、DOCX、TXT 或公开网页来源；可单独移除补充来源。另可上传 PDF、DOCX、TXT、XLSX、CSV、JPG、PNG 材料。单文件最多 20 MiB，每批最多 10 个/50 MiB。补充来源目前会保存并展示，但规则提取和审查仅使用主通知。
4. 运行检查，查看逐项进度、结论、要求引用与材料证据；可取消。真实模式用模型匹配具体材料，文件格式、大小、数量、PDF 总页数仍由程序比较。
5. 上传相同文件名的修订材料会保存新版本，旧结果标记“待复检”。重新检查后比较同一规则下已解决、仍存在、新增和变化待确认的结果。
6. 从当前或历史执行快照导出 Markdown 报告，包含版本、五类判定、证据、限制、模型时间与 token 用量。

目前限制：扫描 PDF OCR、复杂命名模式、正文/摘要范围计数、网页附件自动获取、复杂跨材料一致性及多人访问权限尚未完成。JPG/PNG 使用本地简体中文和英文模型提取文字；低置信度会标为部分解析并要求人工核对，图片 OCR 不保证识别表格结构、手写内容或图章真实性。可识别的同目标、同单位数值上下界、明确固定截止日期及明确排他格式冲突会阻止自动判定，允许用户在新规则版本中选择依据；简单公历日期区间可对唯一材料日期作确定性比较。规则明确要求一致的项目名称、负责人、单位、团队或项目编号可在材料中逐项比较，字段缺失或歧义时不会自动定论。日期区间以外的表达、材料有多个日期、不同措辞目标、非排他格式、单位换算及隐含替代关系仍需人工核对。补充来源会参加规则提取，但语义规则审查仍需人工确认各条来源之间的关系。规则可人工增删停用，材料可人工匹配，条件信息可集中补充；这些能力不等于所有规则结构和边界都已覆盖。每条语义规则最多检索 60 个片段/24,000 字符；覆盖不足不会直接判通过或违规。通知真实提取上限 40,000 字符/100 条输出，默认每次审查最多 12 个模型步骤，每步至多一次重试，执行总时限 180 秒。模型意见仍需人工复核。

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
pnpm test:model
pnpm test:ui
pnpm test:report
```

普通 E2E 在 3100 端口以模拟模式启动生产构建；模型集成 E2E 在 3110/3310 端口使用受控本地兼容接口，不读取真实密钥、不会调用收费服务。两者覆盖桌面/移动 Chromium。模型集成通过仅证明代码流程与防护分支，不代表真实模型准确率。详见 [tests/README.md](tests/README.md)。

## 技术和目录

React + Next.js App Router / Route Handlers、严格 TypeScript、Tailwind CSS + shadcn/ui 基础组件、Vercel AI SDK、Zod、pnpm、ESLint、Prettier、Playwright。状态库按需引入。

```text
src/app/                 页面、布局、任务/模型/材料/检查/报告 API
src/components/          任务、规则、材料与结果工作台
src/domain/              规则、材料、判定、执行与模型用量契约
src/lib/server/          SQLite、文档解析、模型接入与证据审查
src/lib/                 确定性工具、复检与 Markdown 报告
scripts/                 Git 配置与提交格式校验
.githooks/               当前仓库提交钩子
.github/workflows/       工程 CI
 tests/                  场景、样例、模拟与辅助工具
 docs/                   需求、计划、决策与真实进度
```

当前解析使用 PDF.js、Mammoth、ExcelJS 与 UTF-8 文本/CSV 工具。检索是受限的片段词项排序，尚无向量索引与复杂 RAG。本地单人版未实现多人权限隔离，需要账户与授权后才能作为公开服务部署。

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
