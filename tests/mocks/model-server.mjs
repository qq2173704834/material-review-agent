import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.end("ok");
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  const prompt = payload.messages.find((message) => message.role === "user")?.content ?? "";
  if (prompt.includes("AUTH_FAILURE")) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: { message: "secret detail must not be exposed", type: "authentication_error" },
      }),
    );
    return;
  }
  let result;
  if (prompt.includes("连接测试")) result = { ok: true };
  else {
    const context = JSON.parse(prompt);
    if (context.noticeParagraphs) {
      const paragraph = context.noticeParagraphs[0];
      result = {
        rules: [
          {
            description: paragraph.text,
            target: "项目说明",
            strength: "required",
            applicabilityScope: "unknown",
            applicabilityCondition: "",
            parameters: [],
            checkability: /字数|文件大小|恰好/.test(paragraph.text) ? "deterministic" : "assisted",
            uncertainty: "",
            paragraphIndex: paragraph.paragraphIndex,
            quotedText: paragraph.text.includes("INVALID_SOURCE") ? "没有这段原文" : paragraph.text,
          },
        ],
      };
    } else {
      if (context.rule.description.includes("SLOW_MODEL"))
        await new Promise((resolve) => setTimeout(resolve, 5000));
      const snippet = context.snippets[0];
      const passed = snippet.text.includes("100");
      const quotedText = snippet.text.slice(0, 200);
      result = {
        matching: "confirmed",
        targetMaterialIds: [snippet.materialId],
        verdict: passed ? "passed" : "failed",
        reason: passed ? "材料给出了可核对的样本量。" : "材料只有标题，没有提供样本量。",
        recommendation: passed ? "" : "补充实际样本量与测试结果。",
        evidence: [
          {
            materialId: snippet.materialId,
            segmentIndex: snippet.segmentIndex,
            quotedText: context.rule.description.includes("INVALID_EVIDENCE")
              ? "模型编造的材料句子"
              : quotedText,
          },
        ],
      };
    }
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      id: "controlled-model-response",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: payload.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(result) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
    }),
  );
});
server.listen(3310, "127.0.0.1");
