# 产品需求待办

更新：2026-11-14（Asia/Shanghai）。本页统一登记考试扩充与考试信息/学习服务两个新增需求批次，后续规划以此作为入口。**只完成需求文档，应用代码尚未实施；本页全部待办均未关闭。**

## 当前产品方向

面向在校学生的考试信息与学习服务平台：登录后查看近期考试及每日更新，设定考试目标，在学习页获取资料与资讯，通过右下角卡通AI助手进行有知识来源的考试咨询和学习答疑；个人中心承载目标、收藏、进度及材料准备。原材料预审作为个人目标内的子功能，复用已有引擎和历史任务。

## 两批新增需求统计

| 批次                   | 登记任务     | 需求组 | 条件 | 已完成实现验收 | 待实施 | 说明                                                       |
| ---------------------- | ------------ | -----: | ---: | -------------: | -----: | ---------------------------------------------------------- |
| 考试目录与来源扩充     | ENG-036      |      8 |   32 |              0 |     32 | 现有29类，新增39类候选；68类目标仍需核验有效状态和来源     |
| 考试信息、学习与AI服务 | ENG-037      |     14 |   56 |              0 |     56 | 本轮产品定位、首页、知识问答、学习、个人中心和自动预审需求 |
| 本页合计               | 两批新增需求 |     22 |   88 |              0 |     88 | 条件数量，不代表88个互不重叠功能或全项目剩余数量           |

这些待办与原114条、OPT、UX、平台EXAM/AUTH/LINK和CAP/REL分别追踪；旧记录中的已实现能力用于复用，不能直接关闭本页新场景。原人工验收和部署/质量条件继续保留在[需求总状态](requirements-status.md)。

## 待办目录

| 编号    | 功能组                                     | 条件数 | 状态   | 需求依据                                        |
| ------- | ------------------------------------------ | -----: | ------ | ----------------------------------------------- |
| EXP-01  | 目录结构与类型治理（P0）                   |      4 | 待实施 | [EXP-01](exam-expansion-requirements.md)        |
| EXP-02  | 发现、检索与分组浏览（P0）                 |      4 | 待实施 | [EXP-02](exam-expansion-requirements.md)        |
| EXP-03  | 官方来源及覆盖分层（P0）                   |      4 | 待实施 | [EXP-03](exam-expansion-requirements.md)        |
| EXP-04  | 报考对象与资格提示（P0）                   |      4 | 待实施 | [EXP-04](exam-expansion-requirements.md)        |
| EXP-05  | 公告采集与分类质量（P0）                   |      4 | 待实施 | [EXP-05](exam-expansion-requirements.md)        |
| EXP-06  | 高校细则参考与证据（P1）                   |      4 | 待实施 | [EXP-06](exam-expansion-requirements.md)        |
| EXP-07  | 内容审核及既有流程兼容（P1）               |      4 | 待实施 | [EXP-07](exam-expansion-requirements.md)        |
| EXP-08  | 验收资产与状态核对（P0）                   |      4 | 待实施 | [EXP-08](exam-expansion-requirements.md)        |
| PORT-01 | 首页定位与导航重组（P0）                   |      4 | 待实施 | [PORT-01](exam-learning-portal-requirements.md) |
| PORT-02 | 近期考试与热门信息首页（P0）               |      4 | 待实施 | [PORT-02](exam-learning-portal-requirements.md) |
| PORT-03 | 每日更新与时效管理（P0）                   |      4 | 待实施 | [PORT-03](exam-learning-portal-requirements.md) |
| PORT-04 | 我的考试目标与偏好（P0）                   |      4 | 待实施 | [PORT-04](exam-learning-portal-requirements.md) |
| PORT-05 | 考试与学习知识库（P0）                     |      4 | 待实施 | [PORT-05](exam-learning-portal-requirements.md) |
| PORT-06 | 卡通AI助手入口与对话体验（P0基础，P1历史） |      4 | 待实施 | [PORT-06](exam-learning-portal-requirements.md) |
| PORT-07 | 基于知识库的考试咨询与学习答疑（P0）       |      4 | 待实施 | [PORT-07](exam-learning-portal-requirements.md) |
| PORT-08 | 学习资源与资料子页面（P0）                 |      4 | 待实施 | [PORT-08](exam-learning-portal-requirements.md) |
| PORT-09 | 根据考试需求推荐学习内容（P1）             |      4 | 待实施 | [PORT-09](exam-learning-portal-requirements.md) |
| PORT-10 | 个人中心与备考进度（P0）                   |      4 | 待实施 | [PORT-10](exam-learning-portal-requirements.md) |
| PORT-11 | 基于考试信息的个人材料预审（P0）           |      4 | 待实施 | [PORT-11](exam-learning-portal-requirements.md) |
| PORT-12 | 自动预审触发与执行控制（P1）               |      4 | 待实施 | [PORT-12](exam-learning-portal-requirements.md) |
| PORT-13 | 内容、隐私与模型服务治理（P0）             |      4 | 待实施 | [PORT-13](exam-learning-portal-requirements.md) |
| PORT-14 | 验收、兼容与真实效果（P0）                 |      4 | 待实施 | [PORT-14](exam-learning-portal-requirements.md) |

## 状态维护规则

- 当前完成的是ENG-036/ENG-037的需求整理，EXP/PORT功能条件均为待实施。后续实现任务在安排开发时另登记，不能把“文档已完成”当作功能已完成。
- 状态更新需关联具体条件、实现版本和验证证据，允许开发中、待验收、部分通过；真实样本、用户走查和部署条件分别记录。
- 需求之间已有复用和关联，不重复建设认证、公告历史、收藏或预审引擎，也不通过删除旧验收条件提高完成率。
- 本次不排编码批次、选知识库厂商、启动调度、调用真实AI或部署。正式设计/开发待用户后续安排，优先级只是需求建议。

## 需求资料

- [考试扩充需求](exam-expansion-requirements.md)：候选目录、来源覆盖、资格提示与高校参考。
- [调研依据](exam-expansion-research.md)：1份已读高校细则、18个可读官方入口及失败范围。
- [考试信息与学习服务需求](exam-learning-portal-requirements.md)：本轮产品结构与56条验收条件。
- [任务记录](tasks.md)、[当前决策](decisions.md)：需求授权、范围和实际交付。
