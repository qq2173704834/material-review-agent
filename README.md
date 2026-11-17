# 考试与学习

AI先锋团队的大学生备考Web应用，提供考试信息、校园通知、个人目标与日程、学习资源、AI助手和考试材料自检。

## 本地启动

需要Node.js 24与pnpm 11.25.0。复制.env.example为.env.local，安装锁定依赖后启动：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开http://127.0.0.1:3000，注册用户名和密码并保存恢复码。模拟模式无需模型密钥。生产运行执行pnpm build，然后pnpm start。

真实AI配置见docs/model-setup.md。源码使用环境模板，不包含真实密钥、账号数据库和用户上传文件。SQLite在首次运行时创建。

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

演示视频：https://www.bilibili.com/video/BV1Cssg6AEPu/

依赖及锁定版本见package.json与pnpm-lock.yaml。安装依赖后可在对应包中查看其许可证。
