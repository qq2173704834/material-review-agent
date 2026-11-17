# 考试与学习

AI先锋团队的大学生备考Web应用，提供考试信息、校园通知、个人目标与日程、学习资源、AI助手和考试材料自检。

## 团队信息

- 团队名称：AI先锋
- 参赛成员：费咏杰（单人团队）
- 所属院校：上海第二工业大学
- 所属专业：工程管理
- 学历：硕士研究生
- 指导教师：张洋

## 技术架构

浏览器使用React、Next.js App Router、TypeScript与Tailwind CSS呈现页面；服务端接口处理账号、考试内容、目标、日程、资料和材料自检。SQLite保存账号及业务记录，材料原件保存在独立数据目录。

材料处理先读取文档或通过OCR识别文字，再按通知要求检索相关片段。文件格式、大小和数量等明确规则由程序核对，DeepSeek辅助理解通知及检查内容，结果保留对应依据。模型通过服务端兼容接口接入，Zod校验结构化输出。

云端采用Docker运行应用，Caddy提供HTTPS与入口验证；数据使用持久卷，定时采集、备份和巡检独立运行。

## 本地启动

完整环境、原生依赖与部署配置说明见[环境配置](docs/environment-setup.md)。

需要Node.js 24与pnpm 11.25.0，完整依赖及精确版本见package.json和pnpm-lock.yaml。复制.env.example为.env.local，安装锁定依赖后启动：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开http://127.0.0.1:3000，注册用户名和密码并保存恢复码。模拟模式无需模型密钥。生产运行执行pnpm build，然后pnpm start。

真实AI配置见docs/model-setup.md。源码使用环境模板，不包含真实密钥、账号数据库和用户上传文件。SQLite在首次运行时创建。原生模块better-sqlite3需要匹配当前Node版本；若本机缺少构建条件，可使用deploy/Dockerfile中的Linux构建环境，Docker构建已包含Python、make、g++及原生模块编译步骤。

## 使用入口

首页查看考试信息；考试中心查找公告并保存目标；我的备考管理目标、日程和材料自检；校园通知选择学校；学习资源收藏资料；右下角AI助手提供咨询。

材料自检：新建材料自查，提供通知要求和文件，启动检查，查看问题与依据；修改文件后重新上传并重新检查，保存新的结果报告。

## 技术与目录

React、Next.js、TypeScript、Tailwind CSS、SQLite、DeepSeek兼容接口、文档解析与OCR。

- src/：页面、接口、账号与业务逻辑。
- public/及data/：界面资源与公开数据快照。
- tests/：单元、端到端、合成样例及受控模型测试。
- scripts/：运行、数据维护与工程工具。
- deploy/：Docker与HTTPS部署模板。
- docs/：项目介绍、模型配置、操作与测试说明。

## 检查与部署

pnpm test:unit运行单元测试；pnpm test:install安装测试浏览器；生产构建后可运行pnpm test:e2e、pnpm test:model和pnpm test:access。测试方式见tests/README.md。

云端使用deploy/Dockerfile，数据放独立持久卷。需要自行设置域名、入口认证、APP_PUBLIC_ORIGIN与环境文件；部署配置见deploy/compose.yaml和deploy/compose.private.yaml。

## 项目链接

代码仓库：https://github.com/qq2173704834/material-review-agent

演示视频：https://www.bilibili.com/video/BV1Cssg6AEPu/

技术文档：[技术说明](docs/submission/technical-document.md)。正式提交PDF与完整作品包由交付目录提供。

依赖及锁定版本见package.json与pnpm-lock.yaml。安装依赖后可在对应包中查看其许可证。
