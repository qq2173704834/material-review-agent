# 网页功能测试

覆盖任务、通知、规则版本、七种材料格式及边界、确定性工具、逐项进度与取消；新增受控模型集成覆盖真实模式代码链、逐字引用校验、复检和报告。自动化使用合成材料，不调用真实模型；AT01—AT12 未全部完成验收。

## 准备与运行

```sh
pnpm install --frozen-lockfile
pnpm test:install
pnpm build
pnpm test:e2e
pnpm test:model
pnpm test:ui
pnpm test:report
```

测试启动本机 3100 端口的生产构建，并强制使用无模型配置的模拟环境。端口被占用会失败，不复用未知服务；UI 模式同样需要先 build。UI 可选择功能/场景、查看步骤和浏览器过程。

`test:model` 单独使用 `playwright.live.config.ts`，3110 端口启动应用、3310 端口启动受控兼容模型服务，固定合成密钥和独立 `.local-data/model-e2e` 目录。覆盖连接、真实模式规则/语义链、材料证据伪造、来源伪造、授权错误、取消、片段截断、数值工具边界及复检报告。命令不会使用 `.env.local` 的真实凭据；不得把受控模型输出描述成真实 AI 准确率验证。

```sh
pnpm test:e2e --project=chromium
pnpm test:e2e --grep "健康检查"
pnpm test:unit
```

默认覆盖桌面 Chromium 与移动 Chromium；失败保存截图和轨迹。打开 HTML 报告查看断言与附件。安装浏览器失败时检查网络，然后重试 test:install；页面启动失败检查 build 和 3100 端口。报告、截图和浏览器缓存不提交。

## 目录与模式

- fixtures/：固定合成通知、材料和预期事实；随业务功能加入。
- e2e/：按功能组织的浏览器场景。
- helpers/：页面操作、数据准备与受限清理；只删除测试创建的数据。
- mocks/：受控外部服务响应；模拟验证不能证明真实 AI 能力。
- scripts/：样例生成和测试辅助入口。
- unit/：当前自定义提交校验回归，不等同产品验收。

模拟模式验证受控流程；真实工具集成验证实际解析行为；免费或付费真实联调验证实际模型、解析和检索。当前 DeepSeek 的实际小样例联调记录见 `docs/model-setup.md`；只用合成内容，不把用户材料默认发往外部服务。
