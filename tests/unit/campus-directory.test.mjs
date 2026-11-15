import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPUS_SCHOOLS,
  CAMPUS_PROVINCES,
  CAMPUS_DIRECTORY_INFO,
  searchCampusSchools,
  hasCampusNoticeSource,
} from "../../src/domain/campus-schools.ts";

test("教育部2026名单覆盖3196所、31地区及三种办学层次，原学校ID保持", () => {
  assert.equal(CAMPUS_DIRECTORY_INFO.asOf, "2026-06-17");
  assert.equal(CAMPUS_SCHOOLS.length, 3196);
  assert.equal(CAMPUS_PROVINCES.length, 31);
  assert.equal(new Set(CAMPUS_SCHOOLS.map((school) => school.id)).size, 3196);
  assert.equal(new Set(CAMPUS_SCHOOLS.map((school) => school.code)).size, 3196);
  assert.equal(CAMPUS_SCHOOLS.filter((school) => school.level === "本科").length, 1412);
  assert.equal(CAMPUS_SCHOOLS.filter((school) => school.level === "专科").length, 1540);
  assert.equal(CAMPUS_SCHOOLS.filter((school) => school.level === "成人高校").length, 244);
  for (const [name, id] of [
    ["上海第二工业大学", "sspu"],
    ["上海师范大学", "shnu"],
    ["上海工程技术大学", "sues"],
  ]) {
    assert.equal(searchCampusSchools(name).schools[0].id, id);
    assert.equal(hasCampusNoticeSource(id), true);
  }
  for (const name of ["西藏大学", "新疆大学", "深圳职业技术大学", "国家开放大学"]) {
    const school = searchCampusSchools(name).schools[0];
    assert.equal(school.name, name);
    assert.equal(hasCampusNoticeSource(school.id), false);
    assert.equal(school.url, "");
  }
});

test("学校全名优先、常用简称大小写空白可查，歧义别名保留多所且地区可缩小", () => {
  assert.equal(searchCampusSchools(" 北 大 ").schools[0].name, "北京大学");
  assert.equal(searchCampusSchools("sjtu").schools[0].name, "上海交通大学");
  assert.equal(searchCampusSchools("第二工业大学").schools[0].id, "sspu");
  assert.equal(
    searchCampusSchools("南大").schools.some((school) => school.name === "南京大学"),
    true,
  );
  assert.equal(
    searchCampusSchools("南大").schools.some((school) => school.name === "南昌大学"),
    true,
  );
  assert.equal(searchCampusSchools("南大", "江西省").schools[0].name, "南昌大学");
  assert.equal(searchCampusSchools("没有此学校-合成测试").total, 0);
  assert.ok(searchCampusSchools("", "广东省").total > 100);
  assert.equal(searchCampusSchools("").schools.length, 40);
  assert.equal(searchCampusSchools("大学", "", 8).schools.length, 8);
});
