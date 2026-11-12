# DeepSeek 本地配置与真实联调

更新：2026-11-12（Asia/Shanghai）。路径：`E:\Projects\material-review-agent\.env.local`。

## 填写配置

本机文件已建立；直接编辑 `AI_API_KEY=` 一行，不需要将密钥发到聊天或提交 Git。新机器才需要复制 `.env.example`。

```dotenv
AI_MODE=live
AI_PROVIDER=deepseek
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_API_KEY=替换为你控制台生成的完整密钥
AI_TIMEOUT_MS=60000
AI_MAX_CALLS_PER_REVIEW=12
NEXT_TELEMETRY_DISABLED=1
```

不添加 `Bearer ` 前缀，不填写账号密码。密钥含特殊字符时用英文双引号包围完整值。文件名必须是 `.env.local`，不能是 `.env.local.txt`。配置通过服务端读取，不回传密钥或原始服务错误。

官方当前入口与模型名称在 2026-11-12 核对：[首次调用](https://api-docs.deepseek.com/)、[API Key 控制台](https://platform.deepseek.com/api_keys)。当前文档示例为 `deepseek-flash`；如账号可用模型变化，使用控制台列出的 ID。其他兼容服务可替换 provider、base URL、model 和密钥，特殊协议需要单独适配。

## 启动与连接测试

CMD：

```bat
cd /d E:\Projects\material-review-agent
pnpm dev
```

PowerShell：

```powershell
Set-Location E:\Projects\material-review-agent
pnpm dev
```

修改配置后用 Ctrl+C 停止并重启现有服务，不同时启动两个 3000 端口服务。生产运行使用 `pnpm build` 后 `pnpm start`。

打开 `http://127.0.0.1:3000/setup`，点击“测试模型连接”。成功会显示实际 provider/model、时间和 token 用量；只发送合成请求。403/401 检查密钥和授权，402 检查余额，429 等待限流解除，404/400 检查根地址、模型 ID 和 JSON 输出支持。连接成功不等于完成业务效果评估。

## 审查与报告

- 真实模式的“生成规则”会发送本次通知段落。模型输出须符合 Zod 契约，引用必须逐字定位原文；无法定位则拒绝保存，无静默模拟回退。
- “运行检查”会发送任务背景、规则和受限材料片段。模型先匹配材料，程序再比较可执行的文件属性；语义结论须有真实材料 ID、版本和逐字片段引用。
- 明确不适用、条件不明、规则不确定等先由本地逻辑处理。标题存在不代表实质满足，未检索到不代表全文不存在；上下文截断或解析不完整时，模型通过/未通过会降级待确认。
- 相同文件名再次上传视为该材料的新版本。通知、规则集、背景或材料变化会使旧结果待复检；同一规则集下比较前后判定，只将“未通过 → 通过”计为已解决。
- 报告保留选定执行快照、证据、未核验内容与模型步骤。没有获得服务商价格/余额，报告只列实际 token 用量，不臆算费用。

## 调用上限

每步超时默认 60 秒，最多一次自动重试（HTTP 请求最多两次）。每次审查默认 12 个模型步骤，允许配置 1—30；每条语义规则最多 4,000 输出 token；提取规则最多 12,000 输出 token。审查总时限 180 秒，超限保留此前结果和未执行项。点击取消会中断当前模型请求。Token 用量以响应中报告值为准，失败/中断步骤可能没有完整用量，账单以服务商为准。

## 2026-11-12 实际联调

- 模型：DeepSeek `deepseek-flash`，官方兼容接口。
- 连接测试：12:04:53（Asia/Shanghai），输入 72 / 输出 5 token，1 次请求成功。
- 合成业务样例：12:05:24—12:05:35（Asia/Shanghai）。通知要求项目说明提供实际测试样本量、通过数量且不能只有标题。
- 提取出 3 条独立规则，引用逐字核验通过；首次材料仅有标题/待填写栏目，3 项未通过；同名 v2 补入“测试100份、通过95份”，复检3项通过并导出报告，记录已解决3项。
- 业务共7个模型步骤，实际输入6,738 / 输出1,765 token，均成功、没有重试。加连接测试共输入6,810 / 输出1,770 token。未查询价格与余额，费用未知。
- 本机合成任务 ID：`4f7ba269-29d8-4aa2-8486-dcfa19fbb290`。数据保存在本机，不进入 Git；这个案例只能证明该小样例链路，不是跨领域准确率评测。
