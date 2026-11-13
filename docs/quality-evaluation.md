# 真实模型工程回归评估

记录日期：2026-11-13。实际模型：DeepSeek deepseek-flash。开始时间（UTC）：2026-11-12T17:19:00.549Z。

本轮使用固定合成材料，标注由开发过程中编写，是工程参考预期，**不是独立人工金标准**。20 组覆盖竞赛提交与项目申报两个领域、共 60 条参考规则。样例结构较简单且有重复，不代表真实业务分布。4 组带 held-out-regression 标签，但本轮均已参与调试/复测，不再作为未见测试集宣传。

源代码摘要 SHA-256：14bdeced9af9544203c0d087d10686de33047f6a3d6ceb913cae316314a3b786。该摘要对应模型回归执行时的 src；其后修复附件 URL 持久化与前端编辑/上传交互，不改变提取/审查语义。语义管线版本为 2026-11-13-6。

| 指标                  | 分子/分母或实际值 | 解释                                         |
| --------------------- | ----------------- | -------------------------------------------- |
| 完成任务              | 20/20             | 真实模型及工具执行                           |
| 参考规则匹配精确率    | 60/60             | 基于固定规则描述匹配，不是独立人工语义判定   |
| 参考规则召回          | 60/60             | 同上                                         |
| 判定吻合              | 60/60             | 与工程参考预期一致                           |
| 问题检出              | 16/16             | 参考失败项                                   |
| 误报                  | 0/39              | 参考通过项中的错误失败                       |
| 文本证据定位          | 30/30             | 引用可在对应材料片段定位；不等于业务结论正确 |
| 保留不确定项          | 5                 | 5 个明确干扰指令样例                         |
| 总耗时                | 63322 ms          | 本机逐任务测量总和                           |
| 模型操作              | 35                | 提取/匹配/语义操作，操作内部最多两次请求     |
| 已报告输入/输出 token | 39314/7599        | 累加服务返回用量                             |
| 费用                  | 未估算            | 未配置有版本价格来源，以服务商账单为准       |

首轮曾因模型把无条件写成条件、复述 Schema 等问题仅完成 5/20 任务；中间轮完成 18/20，修复后本轮达到上述结果。失败记录保存在本机 .local-data/quality-results/，不删除或改写为通过。

## 复现

先 pnpm build，再在单独 PowerShell 终端设置 REVIEW_DATA_DIR 为项目 .local-data/quality-evaluation、AI_MODE 为 live、AI_MAX_CALLS_PER_REVIEW 为 4，运行 pnpm start --port 3120。凭据从本地忽略的 .env.local 读取。然后运行 node scripts/evaluate-quality.mjs 与 node tests/scripts/live-acceptance.mjs。实际模型会消耗服务额度，脚本只上传固定合成资料，不上传用户任务。

样例及标注依据：tests/fixtures/quality-cases.mjs；结果原始快照：.local-data/quality-results/latest.json；验收映射：acceptance-2026-11-13.md。自动化结果、使用模型、时间和用量可以变化。

## 独立人工复核登记

下表预留人工复核字段；没有填写审核人或把工程预期写成人工已确认。OPT-09.A3 的“60 条人工标注”仍未达成。领域专家可逐项审查固定输入、要求依据、预期及实际结果，记录争议后形成独立标注版本；需另加入真实授权材料、复杂布局与未见样例，才能提出业务质量目标。

| 样例       | 领域     | 参考项  | 预期               | 标注依据                                                        | 人工结论/审核人/争议 |
| ---------- | -------- | ------- | ------------------ | --------------------------------------------------------------- | -------------------- |
| QUALITY-01 | 竞赛提交 | format  | failed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-01 | 竞赛提交 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-01 | 竞赛提交 | content | failed             | 原文第 3 段：必须给出测试样本量；材料为 missing 样本。          | 待人工复核           |
| QUALITY-02 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-02 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-02 | 竞赛提交 | content | needs_confirmation | 原文第 3 段：必须给出测试样本量；材料为 injection 样本。        | 待人工复核           |
| QUALITY-03 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-03 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-03 | 竞赛提交 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-04 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-04 | 竞赛提交 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-04 | 竞赛提交 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-05 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-05 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-05 | 竞赛提交 | content | failed             | 原文第 3 段：必须给出测试样本量；材料为 missing 样本。          | 待人工复核           |
| QUALITY-06 | 竞赛提交 | format  | failed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-06 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-06 | 竞赛提交 | content | needs_confirmation | 原文第 3 段：必须给出测试样本量；材料为 injection 样本。        | 待人工复核           |
| QUALITY-07 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-07 | 竞赛提交 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-07 | 竞赛提交 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-08 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-08 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-08 | 竞赛提交 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-09 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-09 | 竞赛提交 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-09 | 竞赛提交 | content | failed             | 原文第 3 段：必须给出测试样本量；材料为 missing 样本。          | 待人工复核           |
| QUALITY-10 | 竞赛提交 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-10 | 竞赛提交 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-10 | 竞赛提交 | content | needs_confirmation | 原文第 3 段：必须给出测试样本量；材料为 injection 样本。        | 待人工复核           |
| QUALITY-11 | 项目申报 | format  | failed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-11 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-11 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-12 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-12 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-12 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-13 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-13 | 项目申报 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-13 | 项目申报 | content | failed             | 原文第 3 段：必须给出测试样本量；材料为 missing 样本。          | 待人工复核           |
| QUALITY-14 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-14 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-14 | 项目申报 | content | needs_confirmation | 原文第 3 段：必须给出测试样本量；材料为 injection 样本。        | 待人工复核           |
| QUALITY-15 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-15 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-15 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-16 | 项目申报 | format  | failed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-16 | 项目申报 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-16 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-17 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-17 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-17 | 项目申报 | content | failed             | 原文第 3 段：必须给出测试样本量；材料为 missing 样本。          | 待人工复核           |
| QUALITY-18 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-18 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-18 | 项目申报 | content | needs_confirmation | 原文第 3 段：必须给出测试样本量；材料为 injection 样本。        | 待人工复核           |
| QUALITY-19 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-19 | 项目申报 | size    | failed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-19 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |
| QUALITY-20 | 项目申报 | format  | passed             | 原文第 1 段：所有材料必须为 TXT 格式。                          | 待人工复核           |
| QUALITY-20 | 项目申报 | size    | passed             | 原文第 2 段：总大小上界 500 字节，按上传 UTF-8 实际字节数比较。 | 待人工复核           |
| QUALITY-20 | 项目申报 | content | passed             | 原文第 3 段：必须给出测试样本量；材料为 provided 样本。         | 待人工复核           |

## 剩余需求阶段真实回归（2026-11-13）

DeepSeek deepseek-flash，20/20 合成任务，60/60 参考判定、16/16 参考问题、0/39 非问题误报、30/30 逐字位置引用；35 次模型操作，39,289 输入 / 7,594 输出 token，47,768ms。启动于 08:23:07Z，源码摘要与后续修复差异见 acceptance-remaining-39.md。这仍是工程参考集，不能声称独立人工准确率或泛化质量。费用按服务商账单，本地不虚估。

新增仓库与视频的真实接口、解析及证据辅助联调另存 .local-data/new-capability-results/latest.json。最终生产构建通过之后重验，使用公开仓库与合成视频；不使用用户真实材料。OPT-09.A3/A4 仍待独立人工复核和指标生成。
