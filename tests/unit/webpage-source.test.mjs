import { test } from "node:test";
import { execFileSync } from "node:child_process";

test("网页正文和附件解析排除脚本、私网及非文件链接", () => {
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { extractWebpageContent, fetchPublicResource } from './src/lib/server/webpage-fetcher.ts';
    const result = extractWebpageContent('<html><title>公开通知</title><body><nav>不应作为正文</nav><article><p>提交文件要求正文。</p><a href="../files/rules.pdf?v=1">要求附件</a><a href="../files/rules.pdf?v=1">重复附件</a><a href="http://127.0.0.1/secret.pdf">内网链接</a><a href="javascript:alert(1)">脚本</a></article><script>secret script</script></body></html>', 'https://example.com/notices/detail.html');
    assert.equal(result.title,'公开通知');
    assert.ok(result.text.includes('提交文件要求正文'));
    assert.ok(!result.text.includes('secret script'));
    assert.ok(!result.text.includes('不应作为正文'));
    assert.deepEqual(result.attachments,[{url:'https://example.com/files/rules.pdf?v=1',name:'要求附件'}]);
    await assert.rejects(fetchPublicResource('http://127.0.0.1/test.pdf'), /非公开网络/);
    await assert.rejects(fetchPublicResource('http://[::1]/test.pdf'), /非公开网络/);
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
