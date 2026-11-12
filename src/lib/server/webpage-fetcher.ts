import "server-only";

import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

import { parse } from "parse5";
import { Agent, fetch as undiciFetch } from "undici";
import type { Response as UndiciResponse } from "undici";

const MAXIMUM_WEBPAGE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 12_000;
const EXCLUDED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "form",
  "aside",
  "button",
]);

export interface FetchedWebpage {
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  attrs?: Array<{ name: string; value: string }>;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = address.split(".").map(Number);
    const [a = 0, b = 0, c = 0] = bytes;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

function createPublicOnlyAgent(): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) {
            callback(error, "", 0);
            return;
          }
          if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
            callback(new Error("网页地址解析到非公开网络，已阻止访问。"), "", 0);
            return;
          }
          if (options?.all) callback(null, addresses);
          else {
            const first = addresses[0];
            if (!first) callback(new Error("网页地址无法解析。"), "", 0);
            else callback(null, first.address, first.family);
          }
        });
      },
    },
  });
}

function validateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请填写有效的公开网页 URL。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("仅支持无登录凭据的公开 HTTP/HTTPS 网页，且端口仅限 80 或 443。");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname))
    throw new Error("网页地址解析到非公开网络，已阻止访问。");
  return url;
}

async function readLimitedBody(response: UndiciResponse): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_WEBPAGE_BYTES)
    throw new Error("网页内容超过 4 MiB 限制。");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("网页没有可读取的内容。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMUM_WEBPAGE_BYTES) {
      await reader.cancel();
      throw new Error("网页内容超过 4 MiB 限制。");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    throw new Error("网页使用了暂不支持的文字编码。");
  }
}

function findElement(root: HtmlNode, name: string): HtmlNode | undefined {
  if (root.tagName === name) return root;
  for (const child of root.childNodes ?? []) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return undefined;
}

function collectText(root: HtmlNode, output: string[]): void {
  if (root.nodeName === "#text") {
    const text = root.value?.replace(/\s+/g, " ").trim();
    if (text) output.push(text);
    return;
  }
  if (root.tagName && EXCLUDED_ELEMENTS.has(root.tagName)) return;
  if (root.tagName === "br" || root.tagName === "p" || /^h[1-6]$/.test(root.tagName ?? ""))
    output.push("\n");
  for (const child of root.childNodes ?? []) collectText(child, output);
  if (["p", "li", "tr", "section", "article"].includes(root.tagName ?? "")) output.push("\n");
}

function htmlToText(source: string): { title: string; text: string } {
  const document = parse(source) as unknown as HtmlNode;
  const titleNode = findElement(document, "title");
  const titleParts: string[] = [];
  if (titleNode) collectText(titleNode, titleParts);
  const body = findElement(document, "body") ?? document;
  const contentParts: string[] = [];
  collectText(body, contentParts);
  return {
    title: titleParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300),
    text: contentParts
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
  };
}

export async function fetchPublicWebpage(rawUrl: string): Promise<FetchedWebpage> {
  let url = validateUrl(rawUrl);
  const dispatcher = createPublicOnlyAgent();
  try {
    let response: UndiciResponse | undefined;
    for (let redirects = 0; redirects <= MAXIMUM_REDIRECTS; redirects += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        response = await undiciFetch(url, {
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "MaterialReviewWorkbench/0.1 (+public webpage import)",
          },
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("网页请求超时。", { cause: error });
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
        const blocked = cause instanceof Error && cause.message.includes("非公开网络");
        throw new Error(
          blocked ? cause.message : "无法连接该公开网页；请检查地址或改为粘贴原文。",
          {
            cause: error,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!response) throw new Error("网页请求失败。");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === MAXIMUM_REDIRECTS)
          throw new Error("网页重定向次数超出限制或目标无效。");
        url = validateUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!response) throw new Error("网页请求失败。");
    if (response.status === 401 || response.status === 403 || response.status === 407)
      throw new Error("网页需要登录、授权或代理认证，未尝试绕过访问限制。");
    if (!response.ok) throw new Error(`网页返回 HTTP ${response.status}。`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType))
      throw new Error("该地址未返回 HTML 网页内容。");
    const { title, text } = htmlToText(decodeHtml(await readLimitedBody(response), contentType));
    if (text.length < 40) throw new Error("网页正文过短或无法提取；可改为粘贴原文。");
    if (text.length > 200_000) throw new Error("提取正文超过 200,000 字符限制。");
    return { url: url.toString(), title, text, fetchedAt: new Date().toISOString() };
  } finally {
    await dispatcher.close();
  }
}
