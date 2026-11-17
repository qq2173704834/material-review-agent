import "server-only";
import { decodeHtml } from "../html-decoding.ts";

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
  attachments: Array<{ url: string; name: string }>;
  links: Array<{ url: string; name: string }>;
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
  const [firstSegment = "", secondSegment = ""] = normalized.split(":");
  const firstValue = Number.parseInt(firstSegment || "0", 16);
  const secondValue = Number.parseInt(secondSegment || "0", 16);
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    firstValue < 0x2000 ||
    firstValue >= 0x4000 ||
    (firstValue === 0x2001 && (secondValue < 0x0200 || secondValue === 0x0db8)) ||
    firstValue === 0x2002
  );
}

/** 在连接所用的 DNS 查询中检查全部返回地址，任一地址不属于允许范围即拒绝连接。 */
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
  // 响应头可能缺失或低报长度，实际读取时继续累计字节并执行同一上限。
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

export function extractWebpageContent(
  source: string,
  baseUrl: string,
): {
  title: string;
  text: string;
  attachments: FetchedWebpage["attachments"];
  links: FetchedWebpage["links"];
} {
  const document = parse(source) as unknown as HtmlNode;
  const titleNode = findElement(document, "title");
  const titleParts: string[] = [];
  if (titleNode) collectText(titleNode, titleParts);
  const body = findElement(document, "body") ?? document;
  const contentParts: string[] = [];
  collectText(body, contentParts);
  const attachments: FetchedWebpage["attachments"] = [];
  const links: FetchedWebpage["links"] = [];
  function findAttachments(node: HtmlNode): void {
    if (node.tagName === "a") {
      const href = node.attrs?.find((attribute) => attribute.name === "href")?.value;
      try {
        const target = validateUrl(new URL(href ?? "", baseUrl).toString());
        const parts: string[] = [];
        collectText(node, parts);
        const name = parts.join(" ").trim().slice(0, 200);
        if (
          href &&
          name &&
          links.length < 300 &&
          !links.some((item) => item.url === target.toString())
        )
          links.push({ url: target.toString(), name });
        if (
          attachments.length < 20 &&
          href &&
          /\.(pdf|docx|txt)$/i.test(target.pathname) &&
          !attachments.some((item) => item.url === target.toString())
        ) {
          const parts: string[] = [];
          collectText(node, parts);
          attachments.push({
            url: target.toString(),
            name:
              parts.join(" ").trim().slice(0, 200) ||
              decodeURIComponent(target.pathname.split("/").pop() ?? "附件"),
          });
        }
      } catch {
        // URL 格式、协议、端口或字面 IP 校验失败的链接不进入候选列表。
      }
    }
    for (const child of node.childNodes ?? []) findAttachments(child);
  }
  // 优先遍历正文和附件区，避免全站导航先耗尽链接数量上限；随后补查整个正文树。
  function prioritizeContent(node: HtmlNode): void {
    if (node.tagName && EXCLUDED_ELEMENTS.has(node.tagName)) return;
    const markers = node.attrs
      ?.filter((attribute) => attribute.name === "class" || attribute.name === "id")
      .map((attribute) => attribute.value)
      .join(" ");
    if (
      node.tagName === "article" ||
      node.tagName === "main" ||
      /(?:^|\s)(?:attachment[-_](?:down|list|download)|article[-_](?:body|content)|TRS_Editor)(?:\s|$)/i.test(
        markers ?? "",
      )
    ) {
      findAttachments(node);
      return;
    }
    for (const child of node.childNodes ?? []) prioritizeContent(child);
  }
  prioritizeContent(body);
  findAttachments(body);
  return {
    title: titleParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300),
    attachments,
    links,
    text: contentParts
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
  };
}

/**
 * 在统一时限与响应大小限制内读取公开资源，重定向由本函数逐跳处理。
 * probe 仅获取状态和响应头，随即取消正文读取。
 */
export async function fetchPublicResource(
  rawUrl: string,
  probe = false,
): Promise<{ url: string; bytes: Uint8Array; contentType: string; status: number }> {
  let url = validateUrl(rawUrl);
  const dispatcher = createPublicOnlyAgent();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: UndiciResponse | undefined;
    for (let redirects = 0; redirects <= MAXIMUM_REDIRECTS; redirects += 1) {
      try {
        response = await undiciFetch(url, {
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept:
              "application/json,text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain",
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
      }
      if (!response) throw new Error("网页请求失败。");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === MAXIMUM_REDIRECTS)
          throw new Error("网页重定向次数超出限制或目标无效。");
        // 每跳重新校验 URL；下一次连接仍通过同一公开地址 DNS 校验。
        url = validateUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!response) throw new Error("网页请求失败。");
    if (probe) {
      await response.body?.cancel();
      return {
        url: url.toString(),
        bytes: new Uint8Array(),
        contentType: response.headers.get("content-type") ?? "",
        status: response.status,
      };
    }
    if (response.status === 401 || response.status === 403 || response.status === 407)
      throw new Error("网页需要登录、授权或代理认证，未尝试绕过访问限制。");
    if (!response.ok) throw new Error(`网页返回 HTTP ${response.status}。`);
    const contentType = response.headers.get("content-type") ?? "";
    return {
      url: url.toString(),
      bytes: await readLimitedBody(response),
      contentType,
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
    await dispatcher.destroy();
  }
}

export async function fetchPublicWebpage(rawUrl: string): Promise<FetchedWebpage> {
  const resource = await fetchPublicResource(rawUrl);
  if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(resource.contentType))
    throw new Error("该地址未返回 HTML 网页内容。");
  const { title, text, attachments, links } = extractWebpageContent(
    decodeHtml(resource.bytes, resource.contentType),
    resource.url,
  );
  if (text.length < 40) throw new Error("网页正文过短或无法提取；可改为粘贴原文。");
  if (text.length > 200_000) throw new Error("提取正文超过 200,000 字符限制。");
  return {
    url: resource.url,
    title,
    text,
    attachments,
    links,
    fetchedAt: new Date().toISOString(),
  };
}
