# 全国候选来源实际采集核验

日期：2026-11-14。使用独立临时数据库，未使用真实账号或密钥。19个来源中16个至少形成一条草稿，合计73个草稿；另3个未识别到适配公告。成功来源的重复采集均新增0版本。部分来源仍有个别详情失败。公开原文可读、形成草稿、分类准确、审核发布是不同验收层级，本记录不把草稿计为正式公告。

实际发布0条、启用来源0个；本次不更改用户现用数据库。逐条URL/摘要哈希/复查结果见data/source-audit-2026-11-14.json。

| 考试              | 入口                        | 草稿数 | 结果                                                                 |
| ----------------- | --------------------------- | -----: | -------------------------------------------------------------------- |
| gmat              | https://gmat-main.neea.cn/  |      3 | 检查3条候选，新增/变化草稿3条，详情失败0条；未自动发布。             |
| gre               | https://gre-main.neea.cn/   |      5 | 检查5条候选，新增/变化草稿5条，详情失败0条；未自动发布。             |
| lsat              | https://lsat.neea.edu.cn/   |      0 | 列表可访问，但未识别到适配的考试公告链接；需调整来源入口或人工导入。 |
| mhk               | https://mhk.neea.edu.cn/    |      1 | 检查2条候选，新增/变化草稿1条，详情失败1条；未自动发布。             |
| graduate          | https://yz.chsi.com.cn/     |      7 | 检查8条候选，新增/变化草稿7条，详情失败1条；未自动发布。             |
| teacher           | https://ntce.neea.edu.cn/   |      4 | 检查5条候选，新增/变化草稿4条，详情失败1条；未自动发布。             |
| ccpt              | https://ccpt.neea.edu.cn/   |      3 | 检查4条候选，新增/变化草稿3条，详情失败1条；未自动发布。             |
| wsk               | https://wsk.neea.edu.cn/    |      4 | 检查5条候选，新增/变化草稿4条，详情失败1条；未自动发布。             |
| pets              | https://pets.neea.edu.cn/   |      3 | 检查4条候选，新增/变化草稿3条，详情失败1条；未自动发布。             |
| nit               | https://nit.neea.edu.cn/    |      7 | 检查7条候选，新增/变化草稿7条，详情失败0条；未自动发布。             |
| ncre              | https://ncre.neea.edu.cn/   |      3 | 检查4条候选，新增/变化草稿3条，详情失败1条；未自动发布。             |
| bec               | https://bec.neea.cn/        |      4 | 检查4条候选，新增/变化草稿4条，详情失败0条；未自动发布。             |
| equivalent-master | https://tdxl.neea.edu.cn/   |      4 | 检查5条候选，新增/变化草稿4条，详情失败1条；未自动发布。             |
| cet4              | https://cet.neea.edu.cn/    |      3 | 检查4条候选，新增/变化草稿3条，详情失败1条；未自动发布。             |
| jlpt              | https://jlpt-main.neea.cn/  |      0 | 列表可访问，但未识别到适配的考试公告链接；需调整来源入口或人工导入。 |
| delf-dalf         | https://delf-dalf.neea.cn/  |      7 | 检查7条候选，新增/变化草稿7条，详情失败0条；未自动发布。             |
| dele              | https://dele.neea.cn/       |      7 | 检查7条候选，新增/变化草稿7条，详情失败0条；未自动发布。             |
| topik             | https://topik-main.neea.cn/ |      0 | 列表可访问，但未识别到适配的考试公告链接；需调整来源入口或人工导入。 |
| self-study        | https://zikao.neea.edu.cn/  |      8 | 检查8条候选，新增/变化草稿8条，详情失败0条；未自动发布。             |

复跑：`node --experimental-transform-types scripts/audit-exam-sources.mjs --network`，每次新建.local-data/source-audit/run-*，不覆盖用户数据库。个别详情异常不代表整个网站停用；本轮没有绕过登录、验证码或TLS验证。
