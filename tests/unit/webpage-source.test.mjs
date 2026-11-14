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

test("正文附件优先于大导航且保持数量、去重与地址限制", () => {
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import {extractWebpageContent} from './src/lib/server/webpage-fetcher.ts';
    const noise = Array.from({length:310},(_,i)=>'<a href="/menu/'+i+'.pdf">导航'+i+'</a>').join('');
    for(const container of ['article','main','div class="attachment-down textBox"']) {
      const tag=container.split(' ')[0];
      const html='<body><div>'+noise+'</div><'+container+'><a href="./rules.pdf">新细则</a><a href="./rules.pdf">重复</a><a href="http://127.0.0.1/private.pdf">私网</a></'+tag+'></body>';
      const p=extractWebpageContent(html,'https://example.com/notices/detail.html');
      assert.equal(p.attachments[0].name,'新细则');
      assert.equal(p.attachments[0].url,'https://example.com/notices/rules.pdf');
      assert.equal(p.attachments.length,20);
      assert.equal(p.links.length,300);
      assert.equal(p.attachments.filter(a=>a.url.endsWith('/rules.pdf')).length,1);
      assert.ok(!p.attachments.some(a=>a.url.includes('127.0.0.1')));
    }
    const p=extractWebpageContent('<body><div><a href="/plain.pdf">普通旧站附件</a></div></body>','https://example.com/');
    assert.equal(p.attachments[0].name,'普通旧站附件');
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
