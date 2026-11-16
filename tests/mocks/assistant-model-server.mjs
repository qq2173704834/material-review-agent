import { createServer } from "node:http";
createServer(async (request, response) => {
  if (request.url === "/health") return response.end("ok");
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const payload = JSON.parse(raw);
  const prompt = JSON.parse(payload.messages.find((item) => item.role === "user").content);
  if (prompt.question.includes("FAIL_MODEL")) {
    response.writeHead(401, { "Content-Type": "application/json" });
    return response.end(JSON.stringify({ error: { message: "synthetic authentication failure" } }));
  }
  const source = prompt.sources[0];
  const isPlan =
    prompt.question.includes("一周入门安排") &&
    prompt.kind.includes("学习建议") &&
    payload.messages.some(
      (item) => item.role === "system" && item.content.includes("不为通用学习计划追问地区或考期"),
    );
  const result = {
    answer: isPlan
      ? "AI学习建议：假设基础为入门。\n" +
        ["单词", "听力", "阅读", "语法", "写作", "复习", "总结"]
          .map((task, index) => `第${index + 1}天：${task}20分钟，练习10分钟，每天共30分钟。`)
          .join("\n")
      : prompt.kind.includes("学习建议")
        ? "AI学习建议：先梳理知识点，再进行生成练习；并非官方真题。"
        : "仅依据合成来源核对申请条件。",
    citations: source
      ? [
          {
            id: source.id,
            version: source.version,
            quote: prompt.question.includes("INVALID_QUOTE")
              ? "原文中没有的合成句子"
              : source.text.slice(0, 80),
          },
        ]
      : [],
  };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      id: "synthetic-assistant",
      object: "chat.completion",
      created: 1,
      model: "synthetic-assistant",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(
              prompt.question.includes("INVALID_STRUCTURE")
                ? { answer: ["错误数组"], citations: [] }
                : result,
            ),
          },
          finish_reason: "stop",
        },
      ],
      ...(prompt.question.includes("UNKNOWN_USAGE")
        ? {}
        : { usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }),
    }),
  );
}).listen(3311, "127.0.0.1");
