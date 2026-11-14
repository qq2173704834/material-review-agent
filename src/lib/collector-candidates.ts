interface CollectorLink {
  url: string;
  name: string;
}
interface CollectorSource {
  url: string;
  category: string;
}
const KEYWORDS = /报名|考试|招考|招生|成绩|准考证|资格|考务|通知|公告|考研|推免/;

export function collectorCandidates(
  links: readonly CollectorLink[],
  source: CollectorSource,
): CollectorLink[] {
  const host = new URL(source.url).hostname;
  const isNeea =
    host === "neea.edu.cn" ||
    host.endsWith(".neea.edu.cn") ||
    host === "neea.cn" ||
    host.endsWith(".neea.cn");
  const unique = new Map<string, CollectorLink>();
  for (const link of links) {
    try {
      const url = new URL(link.url);
      url.hash = "";
      if (
        url.hostname !== host ||
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      if (
        !KEYWORDS.test(link.name) ||
        /^(考试动态|考试大纲|成绩证明|成绩核查|报名流程|考试介绍)$/.test(link.name)
      )
        continue;
      if (/科研课题|采购|少儿|义务教育|中考|普通高考/.test(link.name)) continue;
      if (/\.(pdf|docx?|xlsx?|zip)$/i.test(url.pathname)) continue;
      // NEEA report URLs are detail pages; category/folder/home pages are navigation or standing guides.
      if (isNeea && !/^\/html\d*\/report\//i.test(url.pathname)) continue;
      if (
        source.category === "education-local" &&
        !/研究生|考研|推免|专升本|专接本|四六级|四、六级|四级|六级|计算机|教师资格|普通话|自学考试|同等学力|英语等级|外语水平|书画|汉语水平|职业资格/.test(
          link.name,
        )
      )
        continue;
      if (!unique.has(url.href)) unique.set(url.href, { ...link, url: url.href });
    } catch {
      /* Invalid links do not become fetch requests. */
    }
  }
  return [...unique.values()]
    .sort((a, b) => Number(/\/report\//.test(b.url)) - Number(/\/report\//.test(a.url)))
    .slice(0, 8);
}
