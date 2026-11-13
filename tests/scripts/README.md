# 真实联调脚本

这些入口只应对本机隔离服务运行，使用固定合成材料。`.env.local` 的真实模型配置必须由服务端读取；不要把真实用户材料或凭据写入脚本。受控模型测试与真实服务联调分别登记，不混用准确率表述。

- `node scripts/evaluate-quality.mjs`：20 组、60 条工程参考预期；结果在 `.local-data/quality-results/`。不是独立人工金标准。
- `node tests/scripts/live-acceptance.mjs`：既有真实复合 AT 场景。
- `node tests/scripts/live-attachments.mjs`：公开通知关联附件、复用与任务隔离。
- `node tests/scripts/live-extended-capabilities.mjs`：实际 GitHub 官方内容接口读取 README/依赖文件，验证 blob 位置；真实结果追问；生成真实视频，经 ffprobe/ffmpeg/OCR 与模型辅助审查，检查时间点证据与抽样覆盖降级。默认本机3120端口，结果在 `.local-data/new-capability-results/`，记录构建编号及模型调用。

先 `pnpm build`，在独立 PowerShell 终端中设置 `REVIEW_DATA_DIR=.local-data/quality-evaluation`、`AI_MODE=live`、`AI_MAX_CALLS_PER_REVIEW=4`，再运行 `pnpm start --port 3120`。模型凭据来自本机配置，真实调用可能收费，以服务商账单为准。联调完成后停止本次启动的服务。

视频合成测试在当前 Windows x64 使用项目可选依赖中的 ffmpeg/ffprobe；其他平台需要自行配置 `FFMPEG_PATH` 与 `FFPROBE_PATH`，普通CI的视频实测会明确跳过，不能据此宣称其跨平台媒体执行已验收。
