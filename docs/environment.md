# 环境检查记录

检查日期：2026-11-11（Asia/Shanghai）。下文为首次接手快照；后续工程、Git 与实际运行结果见 initialization.md，不把历史“未执行”当作当前状态。

## 工程搭建阶段补充

- 用户已恢复开发；Next.js/React 工程、测试入口与本地 Git 已建立，依赖已实际安装并锁定。实际版本见 package.json 与 pnpm-lock.yaml。
- 使用用户提供的 Git 作者，只配置当前仓库；GitHub 官方设备授权后登录 qq2173704834，创建私有 material-review-agent 仓库。
- 本机系统代理为 127.0.0.1:7890。GitHub CLI 直连超时，经现有代理恢复；代理只用于本轮进程和当前仓库 GitHub 配置，未修改系统设置。
- 用户后续要求全部工作迁到 E 盘，当前根目录 E:/Projects/material-review-agent，源码、Git、依赖、构建与测试均在新目录。迁移验证见 initialization.md。
- GitHub CLI 在 E:/CodexTools/github-cli/bin/gh.exe；当前仓库 credential helper 调用它，不把凭据写入仓库。

## 目录与交接材料

- 用户指定根目录：`C:\Users\admin\Documents\Codex\2026-11-11\2173704834-11-11-20-16-01`。
- 检查时仅有空的 work/、outputs/，未发现应用代码、package.json 或仓库。
- 检查工作目录上级至磁盘根的 AGENTS.md，未发现既有上级规则文件；当前根规则由本轮新建。
- git status 返回“not a git repository”；当前未执行 git init。
- 完整读取 Downloads 中 handoff-prompt.md；压缩包包含 handoff-prompt.md、handoff-readme.md、requirements.md、project-rules.md、stage-summary.md 五份 Markdown，没有应用、凭据或测试产物。
- 独立 handoff-prompt.md 与压缩包内同名文件按完整文本比较一致。归档以指定文件名读取，未直接批量解压未知路径。
- docs/handoff/ 保存五份交接文档原文；docs/requirements.md 保留独立需求正文并增加当前接手状态说明。

## 实际可用工具

| 工具       | 实测版本/状态        | 说明                                                                                  |
| ---------- | -------------------- | ------------------------------------------------------------------------------------- |
| PowerShell | 当前 shell 可用      | 本轮使用其原生命令检查文件                                                            |
| Node.js    | v24.21.0             | 可执行；尚未验证与待选依赖组合的兼容性                                                |
| npm        | 11.19.0              | registry 配置为 https://registry.npmjs.org/                                           |
| pnpm       | 11.25.0              | 当前由 Codex bundled runtime fallback 的 pnpm.cmd 提供；未在项目内固定 packageManager |
| Git        | 可执行               | 未发现 user.name、user.email 配置输出；不能据此完成有效作者提交                       |
| Python     | 3.14.7               | 可执行，本轮无应用脚本开发                                                            |
| Docker     | 当前 PATH 未找到命令 | 不是本地文档阶段的前置条件                                                            |

## 网络及依赖查询

在用户要求暂停写代码之前，仅执行了只读包元数据查询，没有安装或生成依赖文件。

| 包                        | registry 当时返回的 version |
| ------------------------- | --------------------------- |
| next                      | 16.4.6                      |
| react                     | 19.3.1                      |
| ai                        | 7.0.169                     |
| @ai-sdk/openai-compatible | 3.0.90                      |
| pdf-parse                 | 2.4.5                       |
| @playwright/test          | 1.65.0                      |
| shadcn                    | 4.23.0                      |
| tailwindcss               | 4.3.5                       |

next、react、Playwright 查询出现约 12—15 秒请求耗时警告，随后返回结果。这只说明此次元数据查询可返回，不能证明完整下载、浏览器安装或稳定性；上述版本未做兼容性核实，也没有确认为项目版本。具体兼容稳定版本与锁文件在恢复工程开发后确定。

## 上一轮交接阶段未执行（历史）

未创建应用工程或测试工具，未写业务代码或配置代码，未安装依赖、创建锁文件、启动服务、构建、lint、类型检查、运行 Playwright、调用真实/免费模型、连接数据库、初始化 Git、提交、推送、部署。赛事页面未在本轮重新核实，交接包中的赛事信息属于历史快照。
