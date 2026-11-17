# 环境配置与复现

作品：考试与学习。团队：AI先锋。更新：2026年11月17日。

## 运行环境与依赖清单

使用Node.js 24、pnpm 11.25.0。应用依赖和开发依赖列在package.json，精确解析版本记录在pnpm-lock.yaml；pnpm-workspace.yaml包含审核后的构建策略和间接依赖覆盖。安装使用冻结锁文件，保留这三个文件。

主要依赖包括Next.js与React、TypeScript、Tailwind CSS、better-sqlite3、Vercel AI SDK与OpenAI兼容适配器、Zod、PDF.js、Mammoth、ExcelJS、Tesseract.js、Sharp、JSZip。测试采用Node test runner、Playwright和axe。许可证随各依赖包保留，可在安装后查看。

## 本地开发

在项目根目录复制.env.example为.env.local。PowerShell执行：

```powershell
Copy-Item .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

CMD复制命令为`copy .env.example .env.local`。默认模拟模式不需要模型密钥。浏览器打开http://127.0.0.1:3000，注册用户名和密码，保存恢复码。本地数据首次运行时创建，默认目录为.local-data。

生产构建与本机运行：

```sh
pnpm build
pnpm start
```

默认端口3000，开发及本机生产命令绑定127.0.0.1。修改环境变量后重新启动服务。

## 原生模块与媒体工具

better-sqlite3必须与当前Node主版本及平台匹配。项目关闭依赖安装时的自动脚本，首次安装若缺少原生绑定，应先安装当前平台的C++与Python构建工具，再显式执行：

```sh
npm rebuild better-sqlite3
node -e "const D=require('better-sqlite3'); new D(':memory:').close()"
```

Windows构建环境可使用Visual Studio Build Tools的C++工作负载与Python；Linux使用Python3、make和g++。不要复制其他Node版本或其他系统的node_modules。deploy/Dockerfile已提供Node24 Linux构建环境，并显式编译及验证此模块，适合需要一致环境的复现。

OCR语言数据随依赖安装，包括中文简体和英文。Windows x64默认使用可选依赖中的FFmpeg/FFprobe；其他平台或替换媒体工具时设置FFMPEG_PATH和FFPROBE_PATH。Docker运行层已安装FFmpeg工具。

## 环境变量

根目录.env.example用于本地开发；deploy/environment.example与deploy/environment.private.example用于生产部署。模板中的示例域名、镜像标签和密码哈希必须在实际部署时替换。

| 配置                                          | 用途                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| AI_MODE                                       | mock为演示，live连接真实模型；默认mock                     |
| AI_PROVIDER / AI_BASE_URL / AI_MODEL          | 服务商、兼容接口根地址及模型ID；以服务商实际可用模型为准   |
| AI_API_KEY                                    | 服务端密钥，保存在忽略的环境文件中；不添加NEXT_PUBLIC_前缀 |
| AI_TIMEOUT_MS                                 | 单步超时，模板为60000毫秒                                  |
| AI_MAX_CALLS_PER_REVIEW / AI_MAX_ATTEMPTS     | 审查模型步骤上限与单步尝试上限；模板为12与2                |
| ASSISTANT_ENABLED / ASSISTANT_HOURLY_LIMIT    | 助手开关与每账号每小时提问上限                             |
| EXAM_SCHEDULER                                | 来源采集调度开关                                           |
| AUTO_REVIEW_ENABLED / AUTO_REVIEW_DAILY_LIMIT | 自动材料审查开关及每日任务上限，可关闭自动执行             |
| REVIEW_DATA_DIR                               | 数据持久目录；本地默认.local-data，Docker为/data           |
| REVIEW_AUTH_MODE                              | 部署设为accounts，使用用户名与密码                         |
| APP_HOST / APP_PUBLIC_ORIGIN                  | 公网主机名及对应HTTPS来源；用于代理和服务端来源校验        |
| DEPLOY_TAG                                    | 已构建应用镜像的标签                                       |
| GATE_USER / GATE_PASSWORD_HASH                | 私人入口认证用户名与Caddy生成的密码哈希                    |
| FFMPEG_PATH / FFPROBE_PATH                    | 媒体工具绝对路径                                           |

真实AI仅在服务端读取配置。启用live前填写有效密钥并确认服务额度；使用助手、要求提取和材料语义检查会发送所需文本到配置的模型服务。模拟模式与真实模式的记录分别保留。

## Docker部署

在源码根目录构建镜像：

```sh
docker build -f deploy/Dockerfile -t material-review-agent:submission .
```

按私人部署模板建立根目录.env.deploy，填写APP_HOST、APP_PUBLIC_ORIGIN、DEPLOY_TAG及入口验证信息，DEPLOY_TAG与镜像标签一致。通过Caddy的hash-password交互命令生成哈希；不要在命令行明文传密码。使用前确认.env.deploy仅部署账号可读，且不加入Git。

```sh
docker compose --env-file .env.deploy -f deploy/compose.private.yaml up -d
docker compose --env-file .env.deploy -f deploy/compose.private.yaml ps
```

应用数据保存在review-data卷；3000端口只映射服务器环回，外部通过Caddy的80/443访问。需设置可解析的主机名并允许HTTPS，云防火墙不开放3000。代理自动管理HTTPS证书，应用容器以非root用户运行。

升级前使用pnpm backup:full备份并验证独立恢复；巡检命令为pnpm ops:check。定时运维示例在deploy/目录。不要删除数据卷来升级应用。正式评审若使用在线演示，应另外交付可用的入口方式和普通测试账号，管理员账号单独管理。

## 验证与版本

单元测试执行pnpm test:unit。浏览器测试先执行pnpm test:install及pnpm build，再选择tests/README.md中的对应命令。模型受控测试使用固定回答验证业务流程，真实模型接入需另行运行。

源码快照与Git历史副本的使用方式见交付包中的源码与版本说明。Git仓库保留开发历史；环境文件、账号数据库和上传材料不在源码中。
