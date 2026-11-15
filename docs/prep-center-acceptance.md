# 备考中心与体验修复实施验收

日期：2026-11-15，ENG-080。当前为本地工程验收记录；本表区分工程实现与需要额外条件的验收，不以概念稿或生产构建替代功能测试。

实现入口：`/me`管理目标，`/me/preparation?goal=目标ID`进入备考中心。保留考试发现首页、账号、收藏、通用自查与历史任务。新增个人计划保存在平台SQLite中，按账号与目标隔离；新增状态表和生成请求表随整库备份恢复，不读取或修改现用真实用户数据。

## PREP 逐条记录

| 条件       | 实现内容               | 状态                                            | 核对依据                                                                     |
| ---------- | ---------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| PREP-01.A1 | 目标导航与切换         | 本地工程核对通过                                | 备考页面、preparation.spec、accounts.spec                                    |
| PREP-01.A2 | 概览与空态             | 本地工程核对通过                                | 备考页面、preparation.spec、accounts.spec                                    |
| PREP-01.A3 | 继续学习与节点入口     | 本地工程核对通过                                | 备考页面、preparation.spec、accounts.spec                                    |
| PREP-01.A4 | 持久化与账号边界       | 本地工程核对通过                                | 备考页面、preparation.spec、accounts.spec                                    |
| PREP-02.A1 | 月历与多事件           | 本地工程核对通过                                | goal-schedule、preparation.spec、reminders.spec                              |
| PREP-02.A2 | 日期详情与精度         | 本地工程核对通过                                | goal-schedule、preparation.spec、reminders.spec                              |
| PREP-02.A3 | 未知与较远日期         | 本地工程核对通过                                | goal-schedule、preparation.spec、reminders.spec                              |
| PREP-02.A4 | 移动日程与去重         | 本地工程核对通过                                | goal-schedule、preparation.spec、reminders.spec                              |
| PREP-03.A1 | 唯一场次关联           | 本地工程核对通过                                | goal-schedule、preparation.test、exams.spec、catalog.spec                    |
| PREP-03.A2 | 北京时间倒计时         | 本地工程核对通过                                | goal-schedule、preparation.test、exams.spec、catalog.spec                    |
| PREP-03.A3 | 变更、撤回与暂停       | 本地工程核对通过                                | goal-schedule、preparation.test、exams.spec、catalog.spec                    |
| PREP-03.A4 | 日期边界与匹配测试     | 本地工程核对通过                                | goal-schedule、preparation.test、exams.spec、catalog.spec                    |
| PREP-04.A1 | 可编辑阶段             | 本地工程核对通过                                | preparation-store、preparation-center、preparation.spec                      |
| PREP-04.A2 | 个人区间建议           | 本地工程核对通过                                | preparation-store、preparation-center、preparation.spec                      |
| PREP-04.A3 | 通用建议与手动任务     | 本地工程核对通过                                | preparation-store、preparation-center、preparation.spec                      |
| PREP-04.A4 | 不覆盖历史与完成任务   | 本地工程核对通过                                | preparation-store、preparation-center、preparation.spec                      |
| PREP-05.A1 | 任务增删编辑           | 本地工程核对通过                                | preparation-store、preparation.spec、preparation.test                        |
| PREP-05.A2 | 统一进度分母           | 本地工程核对通过                                | preparation-store、preparation.spec、preparation.test                        |
| PREP-05.A3 | 完成日期与实际时长     | 本地工程核对通过                                | preparation-store、preparation.spec、preparation.test                        |
| PREP-05.A4 | 版本冲突与保存恢复     | 本地工程核对通过                                | preparation-store、preparation.spec、preparation.test                        |
| PREP-06.A1 | 当前目标阶段资源       | 本地工程核对通过                                | preparationResources、learning-actions、preparation.spec、portal.spec        |
| PREP-06.A2 | 资料详情与返回阶段     | 本地工程核对通过                                | preparationResources、learning-actions、preparation.spec、portal.spec        |
| PREP-06.A3 | 资料转任务与防重复     | 本地工程核对通过                                | preparationResources、learning-actions、preparation.spec、portal.spec        |
| PREP-06.A4 | 资源状态与版本变化     | 本地工程核对通过                                | preparationResources、learning-actions、preparation.spec、portal.spec        |
| PREP-07.A1 | 目标上下文和偏好       | 本地工程核对通过                                | prepPlanSchema、generatePreparation、preparation.spec                        |
| PREP-07.A2 | 日计划及时间预算       | 本地工程核对通过                                | prepPlanSchema、generatePreparation、preparation.spec                        |
| PREP-07.A3 | 结构和资源引用校验     | 本地工程核对通过                                | prepPlanSchema、generatePreparation、preparation.spec                        |
| PREP-07.A4 | 生成异常与真实模型联调 | 部分：模拟及开关/约束已验证，真实模型生成未联调 | prepPlanSchema、generatePreparation、preparation.spec                        |
| PREP-08.A1 | 草稿与个人计划分离     | 本地工程核对通过                                | mutatePreparation、preparation.spec                                          |
| PREP-08.A2 | 编辑、选择与采用       | 本地工程核对通过                                | mutatePreparation、preparation.spec                                          |
| PREP-08.A3 | 重排保留完成和锁定任务 | 本地工程核对通过                                | mutatePreparation、preparation.spec                                          |
| PREP-08.A4 | 历史、撤销与冲突保护   | 本地工程核对通过                                | mutatePreparation、preparation.spec                                          |
| PREP-09.A1 | 文件、要求及判定分离   | 本地工程核对通过                                | EvidencePane、SourceEvidencePreview、student-journey.spec、capabilities.spec |
| PREP-09.A2 | 原版本与文本/区域证据  | 本地工程核对通过                                | EvidencePane、SourceEvidencePreview、student-journey.spec、capabilities.spec |
| PREP-09.A3 | 补充、替换与实际复检   | 本地工程核对通过                                | EvidencePane、SourceEvidencePreview、student-journey.spec、capabilities.spec |
| PREP-09.A4 | 执行有效性与报告入口   | 本地工程核对通过                                | EvidencePane、SourceEvidencePreview、student-journey.spec、capabilities.spec |
| PREP-10.A1 | 统一校园视觉           | 本地工程核对通过                                | globals.css、preparation.spec、user-experience.spec、隔离截图                |
| PREP-10.A2 | 响应式、缩放与键盘     | 本地工程核对通过                                | globals.css、preparation.spec、user-experience.spec、隔离截图                |
| PREP-10.A3 | 减少动态和空错状态     | 本地工程核对通过                                | globals.css、preparation.spec、user-experience.spec、隔离截图                |
| PREP-10.A4 | 连续旅程与学生体验走查 | 部分：自动旅程已实现，实际学生走查保留          | globals.css、preparation.spec、user-experience.spec、隔离截图                |
| PREP-11.A1 | 实际记录热力图         | 本地工程核对通过                                | learningDays、preparation.test、preparation.spec                             |
| PREP-11.A2 | 日期明细和更正         | 本地工程核对通过                                | learningDays、preparation.test、preparation.spec                             |
| PREP-11.A3 | 同长度周期对照         | 本地工程核对通过                                | learningDays、preparation.test、preparation.spec                             |
| PREP-11.A4 | 短周期、手机和数据边界 | 本地工程核对通过                                | learningDays、preparation.test、preparation.spec                             |
| PREP-12.A1 | 自报测评增删改         | 本地工程核对通过                                | comparableScores、AssessmentChart、ScoreTrend、preparation.spec              |
| PREP-12.A2 | 可比维度与雷达对照     | 本地工程核对通过                                | comparableScores、AssessmentChart、ScoreTrend、preparation.spec              |
| PREP-12.A3 | 实际日期成绩趋势       | 本地工程核对通过                                | comparableScores、AssessmentChart、ScoreTrend、preparation.spec              |
| PREP-12.A4 | 薄弱项到计划与数据边界 | 本地工程核对通过                                | comparableScores、AssessmentChart、ScoreTrend、preparation.spec              |

## 关联体验与缺陷

UXR-09—13：统一目标操作行、加减图标、短暂忙碌/成功反馈、编辑定位与取消、未定日期目标保留及明确场次匹配。BUG-040—042按对应边界用例及截图复核。

UXR-14—19：考试中心精简介绍、常用/更多筛选、字段名小标签与独立移除、统一查找/重置、省级入口重排、删除采集诊断；公告列表不再截断2000条后声称全量计数。管理员原始记录和权限保留。既有每日调度通过隔离时钟和合成驱动验证，未擅自启用现用来源；目标环境持续运行及真实日更仍需部署运行条件。BUG-043—045按筛选、目录权限及布局复核。

UXR-20—28：学习资料精简通用免责摘要，保留原正文及原文入口；收藏/已看/隐藏为图文按钮，状态按实际服务端写入，成功提示自动消失；学习筛选复用小标签、依赖清理和重置；学习偏好收纳且隐私深链可展开。资料主入口与标题一致，按账号/查询保存浏览位置。目标材料页用中文状态，模型用量按需展开；新建和任务页说明考试材料自查用途，错误/404不给普通用户工程日志指令。

UXR-19.A1/A4的目标环境运行、UXR-24.A4的真实模型/完整独立走查保留条件；其余条件仍以最终逐条表为准，不把历史EXP/PORT88条或原始114条相加为新功能数量。

## 真实边界

- AI计划先保存可编辑草稿；采用必须主动确认。模型输出日期、分钟数与资料引用由服务端验证；不同请求、重复采用、并发版本和撤销后续修改均有保护。生成与助手共用小时配额，另有计划生成上限；请求记录只在私有平台库保留，30天清理。模拟计划清楚标识，未调用真实DeepSeek、未验证生成质量或实际学习效果。
- 学习热力图只统计完成日期和明确录入的实际分钟；预计时长、打开资料不计学习成果。自测为用户自报；不同体系、满分或维度不自动混画，不预测通过概率。
- 材料自查复用真实执行快照，五类判定与执行状态、待复检分别显示。当前文件与执行时文件版本分别可看，带坐标才画证据框；更换文件后的结果必须实际复检。
- 页面截图与自动化使用合成目标/材料/成绩，不进入正式用户库。保留原有next.config.ts、src/instrumentation.ts、tsconfig.json的三个改动，哈希不变。不推送、部署或关机。

## 最终验证记录

单元测试98/98通过。最终构建、边界回归、格式及静态检查结果将在下方追加。已人工核对手机计划、路线、材料清单和320px学习回顾截图，截图位于忽略目录`outputs/eng-080/`。较早返回场景曾暴露page=1规范化引起的位置恢复缺陷；修复后以最终回归结果为准。

## 本地试用路径

1. 在项目目录运行`pnpm dev`，登录后进入“我的考试”，选一个目标点击“我的备考”。
2. 在概览/日历核对时间；无日期目标仍保留。进入路线建立通用阶段，添加一个任务，再切回概览核对进度。
3. 录入实际学习时长或自测后查看学习回顾；资料点击不自动完成任务。
4. AI学习计划先生成并编辑草稿，确认后加入个人计划；已有完成/锁定任务不会被重排覆盖。使用真实服务前核对AI处理设置及模型可用性。
5. 材料自查查看要求、当前文件和实际结果，进入原文证据/整改/复检；返回可回到对应目标。

## 关联条件的保留范围

UXR-09—28已实现本轮界面与数据路径；UXR-19.A1/A4仍待目标环境持续日更，UXR-24.A4仍待真实服务与完整独立走查，UXR-28.A4的完整浏览器前进/后退、多页与账号切换组合矩阵保留人工复核。该项不因单个手机返回测试通过而全量关闭。UXR-04.A4的目标/日程与布局重开问题已修复并隔离回归；最终用户视觉审视仍保留。BUG-040—045本地修复，不宣称已修改历史真实用户记录。

最终验证（2026-11-15）：生产构建成功；ESLint与TypeScript无错误；单元测试98/98通过；完整平台边界Playwright 98/98通过（47.8秒），包括7个新增备考场景及桌面/手机学生旅程。320/390/768/1280/1920px与125%/150%缩放检查通过，代表截图已人工查看。本轮测试均使用独立合成账号/数据与模拟AI，不读取现用用户库。旧OCR用例执行时仍输出既有语言包加载警告，其断言通过；本轮不把该结果计作OCR中文识别质量独立验收。未调用真实DeepSeek、未启用目标环境持续日更、未完成实际学生走查或完整独立返回组合矩阵。
