# 单实例发布、备份恢复与运行检查

日期：2026-11-14。ENG-035 / REL-01、REL-02。以下配置是待目标环境验证的发布产物；本轮只操作本机隔离数据，不发布公网、不读取真实密钥。

## 运行产物和资源

- `pnpm install --frozen-lockfile`、`pnpm build`生成Next.js生产产物；Node24、pnpm11.25.0锁定主版本。Windows既有启动命令保持`pnpm dev`/`pnpm start`。
- `deploy/Dockerfile`提供Linux单实例构建，显式编译受审查的better-sqlite3，包含Sharp/Canvas/Tesseract及本地中英语言数据，系统FFmpeg/FFprobe；非root用户运行。构建上下文排除真实环境文件、原件、数据库和Git历史。
- `deploy/compose.yaml`提供单实例持久卷、仅环回暴露应用端口和Caddy反代；`deploy/Caddyfile`限制52MB请求体并转发真实Host。外部只能通过HTTPS代理进入，不能直接暴露应用端口。
- 初始工程预算为2CPU/4GiB内存，持久盘建议至少20GiB并保留1GiB告警线；这是待容量实测的起点，不是已测容量保证。单份25MP图片、PDF前200页/最多20页OCR、8项OCR排队及既有上传限额继续适用。透视候选限制最长边2048像素，不复原遮挡信息。
- 发布前锁定基础镜像的准确digest、记录构建Git提交与镜像ID；当前机器没有Docker，未验证Linux容器的空环境启动，不能把本地Next构建记成容器通过。

## HTTPS和生产入口

1. 在授权主机配置DNS与80/443，仅在目标主机本地将`deploy/environment.example`复制成忽略的`.env.deploy`，填写`APP_PUBLIC_ORIGIN=https://实际域名`。上线模型凭据只写此本地文件。
2. 在部署Shell设置`APP_HOST=实际域名`后运行`docker compose -f deploy/compose.yaml build`及`up -d`。此步骤需真实主机与发布授权，本轮未执行。
3. 无容器时用`node --env-file=.env.deploy scripts/start-production.mjs`。入口要求真实账号模式、HTTPS公开origin、可写数据目录、已有构建、OCR数据和两个媒体工具路径；不会接受测试身份旁路。应用默认绑定127.0.0.1。
4. `APP_PUBLIC_ORIGIN`是操作员配置的唯一外部来源，Host必须匹配。不信任客户端`X-Forwarded-Proto`。认证cookie按此来源设置Secure/HttpOnly/SameSite=Lax，写请求拒绝其他Origin。反向代理必须保留Host。
5. 使用独立测试账号从外部浏览器验收完整流程、A/B隔离和跨站拒绝；本机自签TLS回归只证明代理配置的本地行为，不证明公网证书、DNS、防火墙或容量。

## 完整快照

旧`pnpm platform:admin backup`仍是数据库备份，不能替代以下完整快照。

```powershell
pnpm backup:full backup --data-dir E:\Projects\material-review-agent\.local-data --dest E:\ReviewBackups
pnpm backup:full verify --backup E:\ReviewBackups\snapshot-实际编号
pnpm backup:full restore --backup E:\ReviewBackups\snapshot-实际编号 --target E:\ReviewRestore\新目录
```

目的地必须独立于数据目录；示例E盘是本机副本，不是外置灾备。实际外置挂载点/访问权限和恢复目标尚待确定。

快照同时持有平台库和审查库的写预留锁，序列化两个完整SQLite快照，再复制它们引用的全部历史原件并按数据库SHA-256核对。执行中审查、文件缺失、哈希冲突或锁超时会失败，不把`.pending-*`当有效备份。在途上传未提交的文件不属于该恢复点；并发删除先删原件造成缺失时整份备份失败，后续重试。备份会短时阻塞写入，大数据量应安排维护窗口；单库512MiB以上拒绝此内存序列化方案。

清单记录格式、schema、文件路径/长度/哈希、恢复点时间和耗时；验证还检查SQLite完整性/外键和每个数据库原件引用。默认不复制`.env`、日志、缓存和未引用临时文件。当前原生文件权限为目录0700/文件0600；Windows实际保密性还取决于目标目录NTFS ACL，外置目的地须单独确认。

恢复仅接受不存在的新目录，不能覆盖现用库。验证通过后复制清单内文件并记录恢复回执；失败的暂存目录保留用于诊断，绝不自动切换服务。备份包含账号密码哈希、恢复码摘要与会话，按私密数据保护，不要作为公开附件。

## 升级和回滚

1. 固定当前提交/镜像ID，等待执行结束，生成并验证完整快照。
2. 停止目标服务，保留旧镜像及原卷快照；在新目录恢复并用目标版本启动，检查兼容性和迁移。审查库schema22、平台库schema4（新增目标、知识资源、助手私有历史、反馈及自动任务；向后兼容schema3升级），高于本版本的数据库拒绝降级。
3. 确认账号登录、归属、历史证据/原件、公告收藏、修订复检与导出后再切换流量；仍使用真实账号模式。
4. 回滚时停止新服务，恢复升级前快照至另一新目录，再用对应旧镜像启动；不要让旧代码直接打开已迁移的新库。升级后写入在回滚中可能丢失，必须记录实际时间窗口；不承诺无损回滚。

## 本地告警通道与受控计划

默认通道为受限本地JSONL日志/进程标准输出，不发送邮件、短信或Webhook。一次检查：

```powershell
pnpm ops:check --data-dir E:\Projects\material-review-agent\.local-data --health-url http://127.0.0.1:3000/api/health --backup-dir E:\ReviewBackups
```

检查服务readiness、可用磁盘、最新快照年龄与完整性、采集连续3次失败、过去24小时模型错误/已知Token及未知用量。模型调用另存不含URL/配置/用户/正文的本地操作账本，覆盖成功和失败调用；历史执行快照补充旧记录，Token不完整时明确告警，不能据此计算真实账单。健康页只返回ok/unavailable，不披露库路径或业务信息。

选定外置目的地和运维策略后，可由目标环境的服务管理器运行：

```powershell
pnpm ops:check --watch --with-backup --interval-minutes 5 --backup-every-minutes 1440 --retain-days 14 --data-dir E:\Projects\material-review-agent\.local-data --backup-dir 外置挂载点
```

这是建议的每日快照/14天保留策略，尚未在用户现用数据或公网环境启用；RPO/RTO需按规模确认。至少保留最近两个有效快照；仅清理所选备份根内符合命名且完整性验证通过的旧快照，不自动清理损坏或临时目录。监控日志按日期分文件，长期日志归档策略需随磁盘规模配置。部署后应由服务管理器保障巡检进程存活，并演练服务/磁盘/损坏备份/采集失败告警。

单次巡检正常退出0，有告警退出2；备份CLI失败退出1。生产HTTPS检查需在巡检进程设置同一APP_PUBLIC_ORIGIN，后续核对Host配置。所有日志仅必要汇总和固定事件码，不输出异常响应、密码、令牌或材料正文。

## 本轮验证与外部待项

实际命令、结果和恢复耗时以`capability-follow-up-acceptance.md`为准。真实主机/域名与证书、Linux容器启动、外置副本权限与定时服务、业务并发与预算、外部完整走查仍须在授权环境验证；多实例不在本方案内。
