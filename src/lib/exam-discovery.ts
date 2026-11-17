import { EXAM_CATEGORIES, type ExamCategoryId } from "../domain/exam-catalog.ts";

const aliases: Partial<Record<ExamCategoryId, string>> = {
  toeic: "TOEIC 托业 职场英语",
  pte: "PTE Academic 培生 学术英语",
  det: "DET 多邻国 英语测试",
  siele: "SIELE 西班牙语",
  "cambridge-advanced": "C1 Advanced CAE 剑桥高级英语",
  acca: "ACCA 特许公认会计师",
  cfa: "CFA 特许金融分析师",
  frm: "FRM 金融风险管理师",
  "aliyun-cert": "ACA ACP 阿里云认证",
  "aws-cert": "AWS Cloud Practitioner 亚马逊云认证",
  "microsoft-fundamentals": "AZ-900 Azure Fundamentals 微软基础认证",

  cet4: "CET4 CET-4 英语四级",
  cet6: "CET6 CET-6 英语六级",
  tem4: "TEM4 TEM-4 英语专四",
  tem8: "TEM8 TEM-8 英语专八",
  "french-specialty": "法语专四 法语专八",
  "japanese-specialty": "日语专四 日语专八",
  "german-specialty": "德语专四 德语专八",
  "russian-specialty": "俄语专四 俄语专八",
  ncre: "NCRE 计算机一级 计算机二级 计算机三级 计算机四级",
  nit: "NIT 计算机应用",
  teacher: "教资 NTCE",
  mandarin: "普通话 PSC 普测",
  graduate: "考研 研考",
  recommendation: "推免 保研",
  transfer: "专升本 专转本 专接本",
  "self-study": "自考",
  "equivalent-master": "同等学力 申硕",
  software: "软考 软件设计师 系统架构设计师 信息系统项目管理师",
  cpa: "CPA 注会",
  law: "法考 司法考试",
  accounting: "初级会计 中级会计 高级会计",
  "civil-national": "国考",
  "civil-province": "省考",
  public: "事业编",
  selection: "选调",
  pets: "PETS",
  wsk: "WSK PETS5 PETS-5",
  ielts: "IELTS",
  toefl: "TOEFL",
  jlpt: "JLPT N1 N2",
  topik: "TOPIK",
  bec: "BEC 商务英语",
  testdaf: "TestDaF",
  "delf-dalf": "DELF DALF",
  dele: "DELE",
  gre: "GRE",
  gmat: "GMAT",
  lsat: "LSAT",
  ccpt: "CCPT",
  mhk: "MHK",
  catti: "CATTI 笔译 口译",
  "interpretation-shanghai": "中级口译 高级口译",
  "social-work": "社工",
  tourism: "导游证",
  bank: "银行从业",
  securities: "证券从业",
  fund: "基金从业",
  futures: "期货从业",
  economics: "经济师",
  statistics: "统计师",
  auditing: "审计师",
  tax: "税务师",
  valuation: "资产评估师",
  patent: "专利代理师",
  "construction-first": "一建",
  "construction-second": "二建",
  "cost-engineer": "造价师",
  supervision: "监理",
  safety: "注安",
  fire: "消防",
  planner: "规划师",
  surveyor: "测绘师",
  health: "护师 药师 药士 检验技师",
  pharmacist: "执业药师",
  nurse: "护考",
};
export function examProfile(id: ExamCategoryId): {
  aliases: string;
  kind: string;
  audience: string;
  status: string;
} {
  const group = EXAM_CATEGORIES.find((item) => item[0] === id)?.[2];
  const kind =
    id === "recommendation"
      ? "资格认定"
      : [
            "graduate",
            "transfer",
            "civil-national",
            "civil-province",
            "public",
            "selection",
            "teacher-recruit",
          ].includes(id)
        ? "招生/招录"
        : id === "education-local"
          ? "综合公告"
          : group === "技术认证"
            ? "机构认证"
            : group === "国际财经"
              ? "专业认证"
              : "考试/测试";
  let audience = "查看报考条件、成绩与证书有效期，以及本校评奖计分规则。";
  if (
    group === "工程资格" ||
    group === "医学" ||
    ["equivalent-master", "patent", "cpa", "law"].includes(id)
  )
    audience = "适合关注专业资格与职业规划；报名条件涉及专业、学历、应届身份及相关年限。";
  if (group === "专业外语" || id === "tem4" || id === "tem8")
    audience =
      "专业四/八级与社会语言能力测试不同；通常由院校组织，请核对本校专业、年级和补考限制。";
  if (id === "teacher") audience = "在校可报年级按地区公告核对；笔面试通过后仍需教师资格认定。";
  if (id === "ncre") audience = "涵盖一至四级及不同科目，可查看考点提供的科目与获证条件。";
  return {
    aliases: aliases[id] ?? "",
    kind,
    audience,
    status: "查看最新考期与举办安排",
  };
}
export function matchesExamSearch(id: ExamCategoryId, query: string): boolean {
  const item = EXAM_CATEGORIES.find((entry) => entry[0] === id);
  if (!item) return false;
  const text = `${item.join(" ")} ${examProfile(id).aliases}`.normalize("NFKC").toLowerCase();
  return query
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
}
const rules: Array<[RegExp, ExamCategoryId]> = [
  [/法语.{0,8}(?:专业|专[四八])/, "french-specialty"],
  [/日语.{0,8}(?:专业|专[四八])/, "japanese-specialty"],
  [/德语.{0,8}(?:专业|专[四八])/, "german-specialty"],
  [/俄语.{0,8}(?:专业|专[四八])/, "russian-specialty"],
  [/英语专业.{0,5}八级|英语专八|专八|\bTEM-?8\b/i, "tem8"],
  [/英语专业.{0,5}四级|英语专四|专四|\bTEM-?4\b/i, "tem4"],
  [/计算机应用水平|\bNIT\b/i, "nit"],
  [/计算机.{0,8}(?:等级|[一二三四1234]级)|\bNCRE\b/i, "ncre"],
  [/推荐免试|推免|保研/, "recommendation"],
  [/同等学力|申硕/, "equivalent-master"],
  [/自学考试|高等教育自考/, "self-study"],
  [/专升本|专接本|专转本/, "transfer"],
  [/全国外语水平|\bWSK\b|\bPETS-?5\b/i, "wsk"],
  [/全国英语等级|\bPETS\b/i, "pets"],
  [/四、六级|四六级|英语四级|大学英语.{0,6}四级|\bCET-?4\b/i, "cet4"],
  [/英语六级|\bCET-?6\b/i, "cet6"],
  [/教师资格|教资|\bNTCE\b/i, "teacher"],
  [/普通话/, "mandarin"],
  [/翻译专业资格|\bCATTI\b/i, "catti"],
  [/中级口译|高级口译|上海.{0,6}口译/, "interpretation-shanghai"],
  [/雅思|\bIELTS\b/i, "ielts"],
  [/托福|\bTOEFL\b/i, "toefl"],
  [/日本语能力|\bJLPT\b/i, "jlpt"],
  [/韩国语能力|\bTOPIK\b/i, "topik"],
  [/德福|\bTestDaF\b/i, "testdaf"],
  [/\bDELF\b|\bDALF\b/i, "delf-dalf"],
  [/\bDELE\b/i, "dele"],
  [/\bGRE\b/i, "gre"],
  [/\bGMAT\b/i, "gmat"],
  [/\bLSAT\b/i, "lsat"],
  [/剑桥商务英语|\bBEC\b/i, "bec"],
  [/书画等级|\bCCPT\b/i, "ccpt"],
  [/少数民族汉语水平|\bMHK\b/i, "mhk"],
  [/注册会计师|注会|\bCPA\b/i, "cpa"],
  [/会计专业技术|(?:初级|中级|高级)会计/, "accounting"],
  [/法律职业资格|法考/, "law"],
  [/基金从业/, "fund"],
  [/期货从业/, "futures"],
  [/经济专业技术|经济师/, "economics"],
  [/统计师|统计专业技术/, "statistics"],
  [/审计师|审计专业技术/, "auditing"],
  [/税务师/, "tax"],
  [/资产评估师/, "valuation"],
  [/专利代理师/, "patent"],
  [/执业药师/, "pharmacist"],
  [/卫生专业技术|(?:初级|主管)护师/, "health"],
  [/护士.{0,5}资格/, "nurse"],
  [/医师.{0,5}资格/, "medicine"],
  [/一级建造师|一建/, "construction-first"],
  [/二级建造师|二建/, "construction-second"],
  [/造价工程师/, "cost-engineer"],
  [/监理工程师/, "supervision"],
  [/安全工程师/, "safety"],
  [/消防工程师/, "fire"],
  [/城乡规划师/, "planner"],
  [/测绘师/, "surveyor"],
  [/软考|计算机技术与软件/, "software"],
  [/社会工作者|社会工作师/, "social-work"],
  [/导游资格/, "tourism"],
  [/银行业专业人员|银行从业/, "bank"],
  [/证券.{0,12}(?:测试|水平评价|从业)/, "securities"],
  [/选调生/, "selection"],
  [/事业单位.{0,12}(?:招聘|招考)/, "public"],
  [/教师招聘|招教/, "teacher-recruit"],
  [/中央机关|国家公务员|国考/, "civil-national"],
  [/公务员|省考/, "civil-province"],
  [/研究生|考研|硕士招生/, "graduate"],
];
export function classifyExamTitle(title: string, fallback: string): ExamCategoryId {
  const text = title.normalize("NFKC");
  return (
    rules.find(([pattern]) => pattern.test(text))?.[1] ??
    EXAM_CATEGORIES.find(([id]) => id === fallback)?.[0] ??
    "education-local"
  );
}
export function classifyExamCategories(title: string, fallback: string): ExamCategoryId[] {
  const text = title.normalize("NFKC");
  const found = new Set(
    rules.filter(([pattern]) => pattern.test(text)).map(([, category]) => category),
  );
  if (/四、六级|四六级|四级.*六级/.test(text) && found.has("cet4")) found.add("cet6");
  if (
    [...found].some((id) =>
      ["french-specialty", "japanese-specialty", "german-specialty", "russian-specialty"].includes(
        id,
      ),
    )
  ) {
    if (!/英语专业.{0,5}四级|英语专四|\bTEM-?4\b/i.test(text)) found.delete("tem4");
    if (!/英语专业.{0,5}八级|英语专八|\bTEM-?8\b/i.test(text)) found.delete("tem8");
  }
  if (found.has("recommendation") || found.has("equivalent-master")) found.delete("graduate");
  if (found.has("wsk")) found.delete("pets");
  return found.size ? [...found] : [classifyExamTitle(title, fallback)];
}
