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
- unit/：提交格式、安全回跳和网页正文/附件提取的独立回归，不等同产品验收。

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

## 交互改造专项（ENG-023）

`tests/e2e/interaction-workflow.spec.ts`覆盖六条UX-AT路径、自动上传/部分失败、人工要求版本保护、独立模拟示例、历史材料ZIP实际内容、导出失败恢复，以及axe的WCAG 2A/AA/2.1AA自动扫描（准备、结果、处理面板和引导）。既有工程回归使用`tests/helpers/task-ui.ts`明确打开所测试的处理面板，保留原业务断言。

受控模型另验证真实/模拟明确切换、零模拟模型调用以及模式变化禁止复用旧成绩。自动无障碍扫描不是屏幕阅读器人工验收，工程自动化也不替代3位首次用户走查；逐项状态见docs/interaction-acceptance.md。截图保存在忽略的test-results/ux-*.png，下一次普通测试会清理重建。

## 学生考试平台与真实账号（ENG-025—ENG-029）

- `pnpm test:platform`：3130端口、独立platform-e2e目录，真实用户名密码/恢复码/持久会话、匿名门禁、A/B授权及管理员私人材料隔离、草稿发布和指定版本防竞态、收藏/公告任务/更正采用、账号禁用恢复/注销原件清理、旧归属预演备份和独立恢复、手机注册与页面axe，以及服务端独立调度失败退避。未启用旧测试身份旁路。
- `pnpm test:sources`：3131端口、独立source-e2e目录，真实访问四六级、计算机等级、教资、研招网公开来源，列表与部分详情形成草稿、重复去重；日语入口另验失败记录；不发布、不调用大模型。结果摘要在忽略的work/official-source-acceptance-*.json。网络错误会作为失败报告，不改为模拟通过。
- `pnpm platform:admin`：受控本地角色/禁用/归属迁移和备份，默认预演，写操作需显式`--apply`。集成测试仅操作自己的隔离目录。

普通E2E默认输出目录会清理其子目录；若同时运行其他套件，先完成普通E2E，再运行平台/来源套件保留最终截图。旧受控模型数据长期保留，产品账号配额不套到显式legacy-test数据；不能以此绕开产品配额。

## 账号与考试平台边界扩展（ENG-030）

```sh
pnpm build
pnpm test:unit
pnpm test:boundaries
pnpm test:boundaries --grep "收藏达到500"
pnpm exec playwright show-report playwright-report/boundaries --host 127.0.0.1
```

新增13项安全回跳单测，以及`tests/platform-boundaries/`中的46项独立平台用例：23项账号/权限、21项公告/收藏/关联预审、2项实际原件下载与分页流程。包含并发注册和恢复、多设备会话撤销、弱密码与请求限额、授权/注销隔离、草稿保密、日期及引用校验、500条收藏容量、超过100版的持久快照、明确采用更正与待复检、共同四六级筛选和分页保留条件。

边界套件用3132端口的生产构建，强制模拟模型、真实账号认证、关闭采集调度，无外网或真实模型调用。每次命令在`.local-data/platform-boundary-e2e/<运行标识>/`创建独立数据库；配置和SQL辅助均检查目录边界，不重置用户数据。少数容量、长历史、限频窗口和会话数量场景直接构造隔离库前置条件，业务行为仍通过真实HTTP接口或浏览器断言，不将这些种子记作采集成功。

HTML报告在`playwright-report/boundaries/`；失败截图和轨迹在`test-results/platform-boundaries/`。新套件已加入GitHub Actions工作流；本轮执行的是本地检查，未宣称远程CI运行成功。覆盖与缺陷复现见[测试扩展记录](../docs/test-expansion-2026-11-13.md)，人工、扩源与上线专项状态继续以原验收表为准。

## 本轮新增回归（ENG-047）

`pnpm build`后执行`pnpm test:platform`，现共8条平台测试。`identity.spec.ts`覆盖同昵称账号区分、目标/反馈隔离、修改昵称刷新、实际退出/登录切换、匿名门禁和未加载JS时表单禁止提交；`deadline.spec.ts`覆盖首页/列表/详情/收藏的截止提示、仅日期精度、成绩状态、摘录提示、管理员入口、手机无溢出以及虚拟时间跨截止后的状态与倒计时同步变化。

这些测试只使用`.local-data/platform-e2e`及其合成账号。独立专项服务可使用环境变量`REVIEW_POLISH_TEST_DATA_DIR`指定名为`polish-e2e`的隔离目录；不指向真实用户数据库。截图位于忽略的`work/polish-desktop.png`、`work/polish-mobile.png`。

## ENG-050 本轮增量回归

`pnpm build`后运行`pnpm exec playwright test --config playwright.boundaries.config.ts tests/platform-boundaries/portal.spec.ts`：包含明确地区知识检索、不保存模式仅限频/耗用元数据、空考期、取消/摘录禁止自动预审、首页范围/数量、高校原始细则带入及隐藏资料恢复等13项。

`pnpm exec playwright test --config playwright.assistant.config.ts`在独立3145应用与3311受控兼容模型上验证同意门禁、原文引用、幂等、成功/失败耗用及未知Token。数据仅保存在`.local-data/assistant-e2e`，合成密钥、无真实模型计费，不等同独立真实模型效果验收。

`node scripts/check-product-backlog.mjs`只校验EXP/PORT原88条在逐条验收台账无缺漏/重复，不把文档一致性当功能通过。真实来源核验可显式运行`node --experimental-transform-types scripts/audit-exam-sources.mjs --network`，每次建立独立source-audit数据库，草稿不自动发布。

## ENG-055 官方PDF与规则片段定位

生产构建后运行 `pnpm exec playwright test --config playwright.goal-sources.config.ts`，使用3146端口和独立SQLite目录。真实读取NCRE公开考纲PDF，合成公告和材料、模拟规则模型；验证目标未读拦截、双来源提取、引用定位、重复导入和跨账号隔离。网络失败真实报错，不用模拟PDF替代。单元回归 `tests/unit/rule-source-segments.test.mjs` 覆盖不连续片段编号和全局偏移。

## ENG-056—ENG-060内容、真实模型与来源

- `node scripts/audit-official-knowledge.mjs --network`：27条公开短引用逐字核对，9类资料；不写应用数据库。
- `node scripts/audit-source-provenance.mjs --network`：20条网站主办/发布关系原文与总入口链接核对，不解释为国际考试全球主办权。
- `node scripts/audit-exam-sources.mjs --network --scope=registered`：只读真实库公开来源元数据复制到新隔离库，当前43来源实际列表/详情/持久化/重复去重，不启用和发布；省级可用provincial范围。最新31成功/12查询或失败，156待审草稿版本。
- `pnpm exec playwright test --config playwright.quality.config.ts`：独立账号、正常加载本地模型凭据、最多3次真实请求且首错停止，不能加入免费日常测试。输出work/real-model-quality.json供独立复核；不以API成功算效果通过。
- 最新单元91条、全量平台边界77条通过；GB2312/GBK真实字节与编码优先级、14种省级路径及查询门禁有回归。旧158条审查流程通过记录单列，不能替代88条验收。

ENG-061：`student-journey.spec.ts`覆盖1280/390首次登录至个人预审连续UI旅程，模拟回答明确标注；全量边界79条通过。截图保存在忽略的test-results/portal-journey-{1280,390}.png。此项不替代独立学生密度走查或真实模型质量评审。
