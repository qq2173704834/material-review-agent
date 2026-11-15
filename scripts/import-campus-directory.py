"""Import MOE .xls attachments into the runtime school directory (requires xlrd).

Usage: python scripts/import-campus-directory.py regular.xls adult.xls
Inputs are downloaded separately from the source URLs recorded in the output.
This command only writes repository data; it never opens application databases.
"""

import hashlib
import json
from pathlib import Path
import re
import sys

import xlrd

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/t20260618_1441074.html"
ATTACHMENTS = [
    "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618416094865984.xls",
    "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618307096079727.xls",
]


def read_schools(path: Path, adult: bool) -> list[dict]:
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    province = ""
    result = []
    for index in range(3, sheet.nrows):
        row = sheet.row_values(index)
        if not row[1]:
            if row[0]:
                province = re.split(r"[（(]", str(row[0]))[0].strip()
            continue
        code = str(int(row[2])) if isinstance(row[2], float) else str(row[2]).strip()
        if not province or not re.fullmatch(r"\d{10}", code):
            raise ValueError(f"Invalid school row: {index}")
        result.append({
            "code": code,
            "name": str(row[1]).strip(),
            "province": province,
            "city": "" if adult else str(row[4]).strip(),
            "level": "成人高校" if adult else str(row[5]).strip(),
        })
    return result


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Expected regular.xls and adult.xls")
    paths = [Path(arg) for arg in sys.argv[1:]]
    regular = read_schools(paths[0], False)
    adult = read_schools(paths[1], True)
    schools = regular + adult
    if len(regular) != 2952 or len(adult) != 244:
        raise ValueError("Attachment counts differ from the MOE publication")
    if len({school["code"] for school in schools}) != len(schools):
        raise ValueError("Duplicate school identifier")
    output = {
        "source": SOURCE,
        "asOf": "2026-06-17",
        "checkedAt": "2026-11-15",
        "scope": "中国内地，不含港澳台地区高校",
        "attachments": [
            {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for url, path in zip(ATTACHMENTS, paths)
        ],
        "counts": {"regular": len(regular), "adult": len(adult), "total": len(schools)},
        "schools": schools,
    }
    target = ROOT / "src/domain/campus-directory.json"
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(schools)} schools across {len({s['province'] for s in schools})} provinces")


if __name__ == "__main__":
    main()
