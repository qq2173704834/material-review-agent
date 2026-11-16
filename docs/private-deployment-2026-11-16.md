# ENG-105 私人云端部署

## 范围

用户购买腾讯云香港入门服务器，Ubuntu 24.04、2核2GB、40GB磁盘。当前只供本人访问，后续评委开放另行处理；不改变GitHub私有状态。入口密码是访问限制，任何持有密码的人均能进入网站登录界面，因此不分享该密码。

服务器使用独立持久数据卷，不复制本地账号、材料、数据库或 `.env.local`。初始 `AI_MODE=mock`、`EXAM_SCHEDULER=off`、`AUTO_REVIEW_ENABLED=off`；真实模型与采集上线仍待后续联调。全新云端账号需要重新注册并自行保管恢复码。

## 部署配置

- `deploy/compose.private.yaml`：独立Compose项目、应用仅绑定127.0.0.1:3000、数据持久卷、开机自动重启，应用内存限1400MiB，代理192MiB。此限制适合初步单人验证，不代表OCR/视频等重任务容量已通过。
- `deploy/Caddyfile.private`：自动HTTPS，所有请求统一入口认证，反代保留Host，移除入口Authorization再转发。证书签发验证与HTTP跳转由Caddy管理，业务不走明文HTTP。
- `deploy/environment.private.example`：配置模板；实际 `.env.deploy` 权限0600、Git与Docker上下文忽略，bcrypt哈希用单引号保留美元符号。
- 源码归档仅含已跟踪文件的当前内容，原有三个配置工作区改动随部署使用，未加入本次提交。无Git历史、依赖、构建缓存、本地数据库或密钥。归档清单留在忽略目录 `work/deployment/`。

服务器工作目录 `/home/ubuntu/material-review-deploy/source`。操作命令均在此目录，需使用 `sudo docker`：

```sh
sudo docker compose --env-file .env.deploy -f deploy/compose.private.yaml config --quiet
sudo docker compose --env-file .env.deploy -f deploy/compose.private.yaml up -d
sudo docker compose --env-file .env.deploy -f deploy/compose.private.yaml ps
sudo docker compose --env-file .env.deploy -f deploy/compose.private.yaml logs --tail 80 app
sudo docker compose --env-file .env.deploy -f deploy/compose.private.yaml restart
```

不要使用 `down -v`，会删除数据卷；不要将完整Compose展开配置或环境变量输出到聊天/公开日志。正常更新前先备份，使用旧镜像与快照回滚，具体见 operations-runbook.md。更改入口密码使用新随机密码重新生成bcrypt哈希并重建proxy服务，撤销旧入口密码；不需要修改用户网站密码。

## 验收记录

已完成私人部署与验收。SSH、公钥认证、免交互sudo、Docker29.1.3/Compose2.40.3已验证。服务器原有约2GB swap保留，没有重复创建。Caddy2.11.9配置验证通过，Let’s Encrypt证书签发成功；用户在腾讯云放行TCP443后，从本机直接访问外部HTTPS通过。

- 地址：`https://43-135-50-146.sslip.io`。HTTP308跳转HTTPS，未认证的页面/API/静态资源/文件下载均401，错误入口密码401；通过入口后仍需网站账号登录。3000仅服务器环回监听，外部连接不通。
- 受保护HTTPS冒烟：初始36项（经SSH隧道保持真实TLS/Host）、容器重建后外部验证7项、直接外部验证22项、清理验证7项通过。包含账号注册登录、Secure/HttpOnly Cookie、9个主要页面、普通账号禁止管理接口、跨站写拒绝、目标与任务保存、A/B任务404和目标隔离；计数包含重复登录等检查，不代表72个不同业务用例。
- 浏览器外部验证：1440px与390px下首页/日程共4次检查通过，无页面脚本异常与横向溢出；截图位于 `outputs/eng-105/`，含已删除的合成测试账号。测试账号及其目标、任务已通过账号注销接口清理；没有删除其他账号或本地用户数据。
- 公共数据：使用仓库已有的审核导入命令将initial6条、expansion7条官方公告导入云端，重复导入新增0/跳过13，未覆盖既有内容。校园通知与学习目录沿用代码内公开快照。不是迁移本地私人数据库，也不是已启用在线采集。
- Linux原生依赖：SQLite内存库、Canvas/Sharp图像、FFmpeg/FFprobe运行通过；离线中英OCR在合成图片上实际命中“测试材料”“DEPLOY”“1024”。Tesseract初始化仍输出一条非致命的额外语言加载警告，实际中英断言通过，记录保留，不将其称为完全无警告或任意材料准确率验收。
- 当前空闲应用约125MiB、代理约34MiB；磁盘约28GiB可用。以上是单人冒烟时点，不是压力/大文件并发测试结果。

BUG-065已修复：Node24内置fetch探针在相同Host配置下返回503，node:http返回200。Dockerfile改用node:http；当前首个已构建镜像通过Compose覆盖同一健康检查，应用容器重建后healthy，任务/目标持久性通过。没有放宽Host/Origin检查，也没有为此重新构建应用镜像。

构建来源为 `b3e3be0` 加原三个工作区配置，完整文件清单在本地忽略目录；镜像 `material-review-agent:b3e3be0` 的ID为 `sha256:fda0090a4ec1c516e13cd0a70921181779e4ec9efd41a7bfc13a5a72351afa05`。实际Node基础镜像digest为 `sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`；Caddy固定为 `2.11.9@sha256:4e2425f6009577e7c651010f16679c28f7d12df3e7b1914f941a7a3370746b3c`。当前部署的门禁/探针配置单独在本轮提交，不冒称已存在于原b3镜像中。

当前临时地址采用sslip.io解析服务映射IP，无额外域名费用，依赖第三方DNS的持续可用性；并非已购买独立域名。服务器到期日按控制台为2026-12-16，评审未结束时需续费，不因一月购买自动保证覆盖全部评审期。

## 仍待正式演示前完成

真实DeepSeek配置与实际调用验收；自动采集/更新策略；对外评委访问与测试账号；外置备份及恢复演练、重任务容量与完整用户走查。以上没有借本轮基础部署验收标为通过。现阶段入口说明与随机密码只保存在本机忽略文件 `work/deployment/私人访问说明.txt`，服务器仅保存入口密码的bcrypt哈希。
