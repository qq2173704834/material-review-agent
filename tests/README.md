# 网页功能测试

覆盖任务、来源/规则/材料版本、七种材料格式及扫描 PDF、规格工具、历史证据、增量复检、工作台与报告。普通 E2E 使用模拟业务模式但实际解析文件；test:model 使用受控接口。另有需显式运行的真实模型/公开附件脚本，记录见 docs/acceptance-2026-11-13.md，不能将不同模式混称真实模型验收。

## 准备与运行

```sh
pnpm install --frozen-lockfile
pnpm test:install
pnpm build
pnpm test:e2e
pnpm test:model
pnpm test:ui
pnpm test:report
```

测试启动本机 3100 端口的生产构建，并强制使用无模型配置的模拟环境。端口被占用会失败，不复用未知服务；UI 模式同样需要先 build。UI 可选择功能/场景、查看步骤和浏览器过程。

`test:model` 单独使用 `playwright.live.config.ts`，3110 端口启动应用、3310 端口启动受控兼容模型服务，固定合成密钥和独立 `.local-data/model-e2e` 目录。覆盖连接、真实模式规则/语义链、材料证据伪造、来源伪造、授权错误、取消、片段截断、数值工具边界及复检报告。命令不会使用 `.env.local` 的真实凭据；不得把受控模型输出描述成真实 AI 准确率验证。

```sh
pnpm test:e2e --project=chromium
pnpm test:e2e --grep "健康检查"
pnpm test:unit
```

默认覆盖桌面 Chromium 与移动 Chromium；失败保存截图和轨迹。打开 HTML 报告查看断言与附件。安装浏览器失败时检查网络，然后重试 test:install；页面启动失败检查 build 和 3100 端口。报告、截图和浏览器缓存不提交。

## 目录与模式

- fixtures/：固定合成通知、材料和预期事实；随业务功能加入。
- e2e/：按功能组织的浏览器场景。
- helpers/：页面操作、数据准备与受限清理；只删除测试创建的数据。
- mocks/：受控外部服务响应；模拟验证不能证明真实 AI 能力。
- scripts/：样例生成和测试辅助入口。
- unit/：当前自定义提交校验回归，不等同产品验收。

模拟模式验证受控流程；真实工具集成验证实际解析行为；真实联调验证实际模型、解析和检索。只用合成内容，不把用户材料默认发往外部服务。

## 真实验收脚本

先构建，单独终端将 REVIEW_DATA_DIR 设置为 .local-data/quality-evaluation、AI_MODE 设置为 live、AI_MAX_CALLS_PER_REVIEW 设置为 4，使用本地 .env.local 启动 pnpm start --port 3120。不要对正在使用生产构建的服务并行运行 build。

- `node tests/scripts/live-acceptance.mjs`：6 组实际 AT 复合场景；调用真实服务，使用合成材料。
- `node scripts/evaluate-quality.mjs`：两领域 20 组/60 条工程参考预期；调用真实服务，输出源码摘要、实际快照、用量和原始计数。
- `node tests/scripts/live-attachments.mjs`：公开 W3C 页面及直接附件的真实下载/解析/去重/隔离；需要外网，不调用模型。网站变化或网络失败保留失败记录，不伪装成通过。

结果保存至忽略的 .local-data/quality-results/。固定合成参考标签不是独立人工标注；详见 docs/quality-evaluation.md 中预留的人工复核表。AT01—AT12 所列样例覆盖通过，不表示所有业务边界均已覆盖。

## 本轮扩展能力

新增安全ZIP实际输出/CRC/数量/层级/路径检查、链接与仓库记录、视频规格和时间证据、模板字段与范围统计、背景建议、相似提醒、历史版本选择、敏感提醒、结果追问、整改分工/认领、提交包选择/命名，以及多身份任务授权。

`pnpm test:access` 使用3120端口、独立数据库与固定合成身份，测试匿名拒绝、任务/列表/首页隔离、授权和撤销、编码URL、跨站写入、浏览器登录和退出。普通E2E和受控模型测试显式禁用真实身份配置，避免继承本机凭据。

本地媒体平台依赖为可选安装；Windows x64实际执行视频合成、ffprobe元数据和画面OCR。其他平台需要配置本地媒体工具，测试中跳过的能力不得记作通过。测试生成物、真实联调结果与本地数据库继续忽略。
