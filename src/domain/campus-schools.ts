export const CAMPUS_SCHOOLS = [
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
