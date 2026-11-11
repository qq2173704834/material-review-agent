# 网页功能测试

当前提供工程初始化场景，不包含 AT01—AT12 业务验收。使用合成状态，不调用外部 AI、不上传真实材料。

## 准备与运行

```sh
pnpm install --frozen-lockfile
pnpm test:install
pnpm build
pnpm test:e2e
pnpm test:ui
pnpm test:report
```

测试启动本机 3100 端口的生产构建，并强制使用无模型配置的模拟环境。端口被占用会失败，不复用未知服务；UI 模式同样需要先 build。UI 可选择功能/场景、查看步骤和浏览器过程。

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

模拟模式验证受控流程；真实工具集成验证实际解析行为；免费真实联调验证实际模型、解析和检索。真实服务接入后再添加独立标记与入口，不用跳过或模拟结果冒充真实通过。
