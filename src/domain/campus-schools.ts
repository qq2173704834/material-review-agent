import directory from "./campus-directory.json" with { type: "json" };

const connectedSchools = [
  {
    id: "sspu",
    name: "上海第二工业大学",
    url: "https://www.sspu.edu.cn/",
    status: "已接入公开通知",
  },
  {
    id: "shnu",
    name: "上海师范大学",
    url: "https://www.shnu.edu.cn/",
    status: "已接入教务公开通知",
  },
  {
    id: "sues",
    name: "上海工程技术大学",
    url: "https://www.sues.edu.cn/",
    status: "已接入教务公开通知",
  },
] as const;

export interface CampusSchool {
  id: string;
  code: string;
  name: string;
  province: string;
  city: string;
  level: string;
  url: string;
  status: string;
  aliases: readonly string[];
}
const schoolAliases: Record<string, string[]> = {
  北京大学: ["北大", "PKU"],
  清华大学: ["清华", "THU"],
  中国人民大学: ["人大"],
  北京师范大学: ["北师大"],
  北京航空航天大学: ["北航"],
  北京理工大学: ["北理工"],
  北京邮电大学: ["北邮"],
  中国农业大学: ["中国农大"],
  中国科学技术大学: ["中科大", "USTC"],
  复旦大学: ["复旦"],
  上海交通大学: ["上交", "上海交大", "SJTU"],
  浙江大学: ["浙大", "ZJU"],
  南京大学: ["南大", "NJU"],
  南昌大学: ["南大"],
  南开大学: ["南开"],
  天津大学: ["天大"],
  东南大学: ["东大"],
  东北大学: ["东大"],
  山东大学: ["山大"],
  山西大学: ["山大"],
  吉林大学: ["吉大"],
  厦门大学: ["厦大"],
  武汉大学: ["武大"],
  华中科技大学: ["华科", "华中大"],
  中山大学: ["中大"],
  中南大学: ["中南"],
  四川大学: ["川大"],
  重庆大学: ["重大"],
  西安交通大学: ["西交", "西安交大"],
  西北工业大学: ["西工大"],
  哈尔滨工业大学: ["哈工大"],
  哈尔滨工程大学: ["哈工程"],
  华东师范大学: ["华东师大"],
  华东理工大学: ["华理"],
  华南理工大学: ["华工"],
  上海第二工业大学: ["二工大", "SSPU"],
  上海师范大学: ["上师大"],
  上海工程技术大学: ["工程大", "上工程"],
};

export const CAMPUS_SCHOOLS: readonly CampusSchool[] = directory.schools.map((school) => {
  const connected = connectedSchools.find((item) => item.name === school.name);
  return {
    ...school,
    id: connected?.id ?? `moe-${school.code}`,
    url: connected?.url ?? "",
    status: connected?.status ?? "通知整理中",
    aliases: schoolAliases[school.name] || [],
  };
});
export const CAMPUS_DIRECTORY_INFO = {
  source: directory.source,
  asOf: directory.asOf,
  checkedAt: directory.checkedAt,
  counts: directory.counts,
  scope: directory.scope,
};
export const CAMPUS_PROVINCES = [...new Set(CAMPUS_SCHOOLS.map((school) => school.province))];

function normalizeSchoolQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}
/** Ambiguous aliases return all matching schools; selection always remains explicit. */
export function searchCampusSchools(
  query: string,
  province = "",
  limit = 40,
): { schools: CampusSchool[]; total: number } {
  const words = normalizeSchoolQuery(query)
    .split(/[，,、]+/u)
    .filter(Boolean);
  const matches = CAMPUS_SCHOOLS.filter(
    (school) =>
      (!province || school.province === province) &&
      words.every((word) =>
        [school.name, school.province, school.city, ...school.aliases].some((value) =>
          normalizeSchoolQuery(value).includes(word),
        ),
      ),
  ).toSorted((a, b) => {
    const rank = (school: CampusSchool): number =>
      !words.length && connectedSchools.some((item) => item.id === school.id)
        ? -1
        : normalizeSchoolQuery(school.name) === normalizeSchoolQuery(query)
          ? 0
          : school.aliases.some(
                (alias) => normalizeSchoolQuery(alias) === normalizeSchoolQuery(query),
              )
            ? 1
            : 2;
    return rank(a) - rank(b);
  });
  return { schools: matches.slice(0, Math.max(1, Math.min(60, limit))), total: matches.length };
}
export const CAMPUS_SOURCES = [
  {
    id: "sspu-main",
    schoolId: "sspu",
    department: "学校办公室",
    url: "https://www.sspu.edu.cn/2965/list.htm",
    pattern: "/20\\d{2}/\\d{4}/c2965a\\d+/page.htm",
  },
  {
    id: "sspu-jwc",
    schoolId: "sspu",
    department: "教务处",
    url: "https://jwc.sspu.edu.cn/897/list.htm",
    pattern: "/20\\d{2}/\\d{4}/c897a\\d+/page.htm",
  },
  {
    id: "sspu-xsc",
    schoolId: "sspu",
    department: "学生工作处",
    url: "https://xsc.sspu.edu.cn/490/list.htm",
    pattern: "/20\\d{2}/\\d{4}/c490a\\d+/page.htm",
  },
  {
    id: "shnu-jwc",
    schoolId: "shnu",
    department: "教务处",
    url: "https://jwc.shnu.edu.cn/tzgg/list.htm",
    pattern: "/[a-f0-9]{2}/[a-f0-9]{2}/c\\d+a\\d+/page.htm",
  },
  {
    id: "sues-jwc",
    schoolId: "sues",
    department: "教务处",
    url: "https://jwc.sues.edu.cn/",
    pattern: "/[a-f0-9]{2}/[a-f0-9]{2}/c2406[34]a\\d+/page.htm",
  },
] as const;

export function hasCampusNoticeSource(schoolId: string): boolean {
  return CAMPUS_SOURCES.some((source) => source.schoolId === schoolId);
}
