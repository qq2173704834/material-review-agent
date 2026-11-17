# ENG-117 核心代码注释记录

日期：2026-11-17。状态：已完成本地补充与验证。

## 参考与写法

实际阅读 openGauss 官方镜像仓库 `opengauss-mirror/openGauss-server`，参考版本固定为 `bcc5550f2f0eddfd1303e26146aa9fe3e9bce09e`：

- [heapam.cpp](https://github.com/opengauss-mirror/openGauss-server/blob/bcc5550f2f0eddfd1303e26146aa9fe3e9bce09e/src/gausskernel/storage/access/heap/heapam.cpp)：文件职责、接口用途及扫描分支的处理原因。
- [nodeAgg.cpp](https://github.com/opengauss-mirror/openGauss-server/blob/bcc5550f2f0eddfd1303e26146aa9fe3e9bce09e/src/gausskernel/runtime/executor/nodeAgg.cpp)：聚合流程说明，以及 `process_ordered_aggregate_single` 的调用前提、处理顺序和分支说明。

结合 TypeScript 使用中文 JSDoc 和行注释：复杂函数前说明职责、关键前提或返回语义；分支附近解释处理原因、坐标基准和状态衔接。内容以本项目实际实现为依据，简单赋值和直观操作不重复解释。本轮借鉴注释组织方式，未复制外部实现或版权头。

## 修改范围

共 16 个源码文件，仅修改注释。

| 模块       | 文件                                                                                                          | 注释重点                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 文档读取   | `src/lib/server/material-parser.ts`、`src/lib/server/pdf-parser.ts`                                           | 统一片段坐标、Office 容器检查、PDF 文本与 OCR 选择、页面覆盖及画布限制         |
| 规则与证据 | `src/lib/server/live-rule-extractor.ts`、`src/lib/evidence-retrieval.ts`、`src/lib/server/semantic-review.ts` | 来源逐字定位、检索预算与重叠、覆盖判定、引用校验、属性检查分工                 |
| 模型接入   | `src/lib/server/model-client.ts`                                                                              | 结构校验、统一超时、有上限重试、未知用量处理                                   |
| 复检与执行 | `src/lib/server/recheck-plan.ts`、`src/lib/server/review-runner.ts`                                           | 依赖键、复用条件、原始执行出处、进程内互斥、先保存再推送、结束清理             |
| 账号与网页 | `src/lib/server/account-auth.ts`、`src/lib/server/webpage-fetcher.ts`                                         | 密码派生、会话摘要与撤销、并发密码更新、DNS 校验、逐跳重定向和实际响应大小     |
| 助手与日程 | `src/lib/server/exam-assistant.ts`、`src/lib/goal-schedule.ts`、`src/lib/server/personal-schedule.ts`         | 上下文筛选、请求去重、回答引用、唯一公告关联、北京时间、稳定日程 ID 和修订校验 |
| 页面交互   | `src/components/task-editor.tsx`、`src/components/student-goals.tsx`、`src/components/review-execution.tsx`   | 保留未保存输入、目标保存后同步、只读加载与显式执行、确认项版本和 SSE 消息拼接  |

同时修正检索模块原有“预留一半预算”的注释：实际首轮在剩余预算不超过 18,000 字符时结束，改为解释预算分配目的，不改原数值或流程。

## 验证

- 逐文件审查差异，新增内容均为函数说明或逻辑注释。
- 对修改前后的 16 个文件分别用 TypeScript 解析并去注释打印，输出逐文件完全一致，语法诊断均为空。比较保留字符串、模板、正则、提示词和 JSX 内容。
- `next.config.ts`、`src/instrumentation.ts`、`tsconfig.json` 与本轮开始时的 SHA256 一致。
- 16 个源码文件的 Prettier 格式检查通过。
- `pnpm lint` 通过，零警告。
- `pnpm typecheck` 通过。
- `pnpm test:unit`：135 项通过，0 失败、0 跳过。
- `git diff --check` 通过。

修改前快照、比较脚本、逐文件结果和检查日志保存在本地 `work/comment-review-eng117/`。本轮未改变功能、提示词或用户文案；不需要更新云端镜像。保留此前的配置及技术 Word 工作区修改，本次结果保存为独立本地 Git 提交。
