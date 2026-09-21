/*
 * 两个导入器 + 模型 的联合测试。
 *   node tests/test-importers.js
 *
 * 验证的核心命题：ICS 和 WakeUp 两条完全不同的路径，
 * 最终都落到同一个模型上，并且网格查询（第几周、星期几）给出的结果一致可预期。
 */

const fs = require("fs");
const path = require("path");

const UI = path.join(__dirname, "..", "contents", "ui");

// QML 的 .pragma library 在普通 JS 里是语法错误，加载时剥掉
function loadQmlJs(file, names) {
    const src = fs
        .readFileSync(file, "utf8")
        .replace(/^\s*\.pragma\s+library\s*$/m, "");
    return new Function(src + "\nreturn {" + names.join(",") + "};")();
}

const CM = loadQmlJs(path.join(UI, "coursemodel.js"), [
    "PALETTE", "emptyModel", "parseModel", "serializeModel", "describeModel",
    "pad2", "minutesOfTime", "timeOfMinutes", "weekdayOf", "dayIndex",
    "dateFromDayIndex", "mondayOf", "parseIsoDate", "isoOf", "weekOf", "dateOf",
    "weekdayNames", "weekdayLabel", "parsePeriodsText", "periodsToText",
    "rowCount", "rowOfNode", "periodAt", "periodsFromIntervals",
    "mapTimeToPeriods", "mapEvent", "colorFor", "normalizeCourse", "mergeSlots",
    "assignColors", "coursesOn", "coursesInWeek", "courseNames",
    "workAsFor", "parseWorkAs", "serializeWorkAs", "parseWeeksText", "weeksToText", "periodByNode", "textColorFor"
]);
const ICS = loadQmlJs(path.join(UI, "ics.js"), [
    "unfold", "parseIcs", "teacherFromDescription", "minutesOf", "toSessions", "toModel"
]);
const WU = loadQmlJs(path.join(UI, "wakeup.js"), [
    "parseWakeUp", "normalizeColor", "parseStartDate", "extractBlocks"
]);

let pass = 0;
const fails = [];
function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        pass++;
    } else {
        fails.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
    }
}
function ok(label, cond, detail) {
    if (cond) {
        pass++;
    } else {
        fails.push(`${label}${detail ? "\n      " + detail : ""}`);
    }
}

console.log("################ 一、WakeUp 导入 ################\n");

const wuText = fs.readFileSync(path.join(__dirname, "sample.wakeup_schedule"), "utf8");
const wu = WU.parseWakeUp(wuText);
check("WakeUp 无错误", wu.errors, []);
ok("WakeUp 拿到模型", wu.model !== null);

// wakeup.js 保持自包含（不依赖 coursmodel），合并去重放在调用侧做
wu.model.courses = CM.assignColors(CM.mergeSlots(wu.model.courses));
const wm = CM.parseModel(CM.serializeModel(wu.model));

check("开学日期取自 tableInfo", wm.termStart, "2026-09-07");
check("作息表 10 节", wm.periods.length, 10);
check("作息表首节", [wm.periods[0].node, wm.periods[0].start, wm.periods[0].end], [1, "08:00", "08:45"]);
check("作息表末节", [wm.periods[9].node, wm.periods[9].start, wm.periods[9].end], [10, "19:55", "20:40"]);
check("总周数", wm.totalWeeks, 18);
check("课程数（已去掉 ownTime）", wm.courses.length, 5);

const byName = {};
for (const c of wm.courses) byName[c.name] = c;

check("高等数学 周次", byName["高等数学A"].weeks, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
check("高等数学 节次", [byName["高等数学A"].startPeriod, byName["高等数学A"].endPeriod], [1, 2]);
check("高等数学 星期", byName["高等数学A"].weekday, 1);
// CourseInfo.color 是 #AARRGGBB，必须截成 #RRGGBB
check("ARGB 颜色截成 RGB", byName["高等数学A"].color, "#3f51b5");
// 没有 color 的课要拿到色板颜色，不能是空
ok("缺省颜色由色板兜底", /^#[0-9a-f]{6}$/.test(byName["大学英语"].color), byName["大学英语"].color);

// type=1 单周：startWeek=1 endWeek=15，只保留奇数周
check("单周课周次", byName["大学物理"].weeks, [1,3,5,7,9,11,13,15]);
check("单周课节次", [byName["大学物理"].startPeriod, byName["大学物理"].endPeriod], [3, 4]);
check("单周课地点", byName["大学物理"].room, "西2-305");

// teacher 只写在 courseDetails 里没写在 courseInfos 里，要能从排课行取到
check("教师从排课行回退", byName["大学英语"].teacher, "赵六");

// ownTime 自定义时间课程不进网格
ok("ownTime 已跳过", byName["专业课导论"] === undefined);
ok("ownTime 有提示", wu.warnings.some(w => w.includes("自定义时间")), wu.warnings.join(" | "));

// 配色：不同课不能撞色。这里埋着 WakeUp 自带的颜色，而没自带颜色的课
// 要从色板里取 —— 若按"下一个下标"分配就会撞上前面用掉的那几个
const distinctNames = [...new Set(wm.courses.map(c => c.name))];
const colorOf = {};
for (const c of wm.courses) colorOf[c.name] = c.color;
const usedColors = distinctNames.map(n => colorOf[n]);
ok("不同课不撞色", new Set(usedColors).size === usedColors.length,
    distinctNames.map(n => n + "=" + colorOf[n]).join(" , "));
// 同一门课的多个时段（周一和周三各一节）必须同色，且不占用两个色板名额
const multiSlots = CM.assignColors(CM.mergeSlots([
    { name: "线性代数", teacher: "钱十", room: "A101", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1], color: "" },
    { name: "线性代数", teacher: "钱十", room: "A101", weekday: 3, startPeriod: 1, endPeriod: 2, weeks: [1], color: "" },
    { name: "概率论", teacher: "孙十一", room: "B202", weekday: 2, startPeriod: 3, endPeriod: 4, weeks: [1], color: "" }
]));
ok("同一门课多个时段同色", multiSlots[0].color === multiSlots[1].color,
    multiSlots.map(c => c.name + "=" + c.color).join(" , "));
ok("另一门课颜色不同", multiSlots[0].color !== multiSlots[2].color,
    multiSlots.map(c => c.name + "=" + c.color).join(" , "));

console.log("WakeUp 解析摘要：", CM.describeModel(wm));
if (wu.warnings.length) console.log("提示：\n  " + wu.warnings.join("\n  "));

// 重复行合并：同一门课被拆成多行时，周次应该并起来而不是画两个重叠块
const dup = WU.parseWakeUp(
    '[\n[{"id":1,"courseName":"线性代数","teacher":"钱十"}]\n' +
    '[{"id":1,"day":2,"startNode":1,"step":2,"startWeek":1,"endWeek":9,"type":1,"room":"A101"},' +
    '{"id":1,"day":2,"startNode":1,"step":2,"startWeek":2,"endWeek":10,"type":2,"room":"A101"}]\n'
);
const dupCourses = CM.mergeSlots(dup.model.courses);
check("单双周拆成两行时合并", dupCourses.length, 1);
check("合并后周次为并集", dupCourses[0].weeks, [1,2,3,4,5,6,7,8,9,10]);

console.log("\n################ 二、ICS 导入 ################\n");

const icsText = fs.readFileSync(path.join(__dirname, "sample.ics"), "utf8");
const parsed = ICS.parseIcs(icsText);
const im = ICS.toModel(parsed, CM, {});
check("ICS 无错误", im.errors, []);
ok("ICS 拿到模型", im.model !== null);

const icsModel = CM.parseModel(CM.serializeModel(im.model));
check("推断开学日 = 最早的课所在周的周一", icsModel.termStart, "2026-09-07");
// 作息表从 ICS 推：样本里有 5 个不同的上课时段
check("推导出 5 个时段", icsModel.periods.length, 5);
check("首时段", [icsModel.periods[0].start, icsModel.periods[0].end], ["08:00", "09:40"]);
check("末时段", [icsModel.periods[4].start, icsModel.periods[4].end], ["19:00", "20:30"]);
check("总周数", icsModel.totalWeeks, 18);

const ibyName = {};
for (const c of icsModel.courses) ibyName[c.name] = c;
check("课程数", icsModel.courses.length, 6);

const math = ibyName["高等数学A"];
check("高等数学 星期/节次", [math.weekday, math.startPeriod, math.endPeriod], [1, 1, 1]);
check("高等数学 周次 1-16", math.weeks, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
check("高等数学 地点（折行已还原）", math.room, "紫金港校区东一教学楼A座101多媒体教室（靠近南门）");
check("高等数学 教师（从 DESCRIPTION）", math.teacher, "张三");

check("单周课周次", ibyName["大学物理（单周）"].weeks, [1,3,5,7,9,11,13,15]);
check("双周课周次", ibyName["大学物理实验（双周）"].weeks, [2,4,6,8,10,12,14,16]);
check("英语 18 周（UNTIL 末周没被砍）", ibyName["大学英语（读写译）"].weeks.length, 18);
check("体育 停课周已剔除", ibyName["体育（篮球）"].weeks, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].filter(w => w !== 14));
check("讲座落在第 11 周", ibyName["形势与政策专题讲座"].weeks, [11]);
ok("全天考试已跳过", ibyName["期末考试（高等数学A）"] === undefined);
ok("全天事件有提示", im.warnings.some(w => w.includes("整天事件")), im.warnings.join(" | "));

console.log("ICS 解析摘要：", CM.describeModel(icsModel));
if (im.warnings.length) console.log("提示：\n  " + im.warnings.join("\n  "));

console.log("\n################ 三、网格查询（两条路径共用）################\n");

// 第 1 周周三：单周课；第 2 周周三：双周课 —— 同一格交替出现
check("ICS 第1周周三", CM.coursesOn(icsModel, 1, 3).map(c => c.name), ["大学物理（单周）"]);
check("ICS 第2周周三", CM.coursesOn(icsModel, 2, 3).map(c => c.name), ["大学物理实验（双周）"]);
check("ICS 第3周周三", CM.coursesOn(icsModel, 3, 3).map(c => c.name), ["大学物理（单周）"]);

// 第 14 周周五体育停课，网格上应当空着
check("ICS 第14周周五 无课", CM.coursesOn(icsModel, 14, 5).map(c => c.name), []);
check("ICS 第15周周五 有课", CM.coursesOn(icsModel, 15, 5).map(c => c.name), ["体育（篮球）"]);

// WakeUp 这边同一个查询
check("WakeUp 第1周周三", CM.coursesOn(wm, 1, 3).map(c => c.name), ["大学物理"]);
check("WakeUp 第2周周三 单周课不出现", CM.coursesOn(wm, 2, 3).map(c => c.name), []);
check("WakeUp 第1周周一", CM.coursesOn(wm, 1, 1).map(c => c.name), ["高等数学A"]);
check("WakeUp 第17周周一 已结课", CM.coursesOn(wm, 17, 1).map(c => c.name), []);
check("WakeUp 第11周周三 有两门", CM.coursesOn(wm, 11, 3).map(c => c.name), ["大学物理", "形势与政策专题讲座"]);

// 周次 → 具体日期
check("第1周周三的日期", CM.isoOf(CM.dateOf(icsModel, 1, 3)), "2026-09-09");
check("第18周周五的日期", CM.isoOf(CM.dateOf(icsModel, 18, 5)), "2027-01-08");
check("日期 → 周次 往返", CM.weekOf(icsModel, CM.dateOf(icsModel, 12, 6)), 12);

console.log("\n################ 四、坏输入 ################\n");

const bad1 = WU.parseWakeUp("这不是备份文件");
ok("WakeUp 垃圾输入报错", bad1.errors.length > 0 && bad1.model === null);
ok("WakeUp 报错提到导出方法", bad1.errors[0].includes(".wakeup_schedule"), bad1.errors[0]);

const bad2 = ICS.toModel(ICS.parseIcs(""), CM, {});
ok("ICS 空输入报错", bad2.errors.length > 0 && bad2.model === null);

// 配置里的 JSON 被手改坏了，不能崩，要退回空模型
check("坏 JSON → 空模型", CM.parseModel("{不是json").courses, []);
check("类型错 JSON → 空模型", CM.parseModel('{"courses":"x","totalWeeks":"y"}').courses, []);
check("超范围取值被夹紧", (() => {
    const m = CM.parseModel(JSON.stringify({
        totalWeeks: 999,
        periods: [{ node: 1, start: "08:00", end: "09:00" }, { node: 2, start: "09:00", end: "08:00" }],
        courses: [{ name: "x", weekday: 99, startPeriod: 5, endPeriod: 1, weeks: [3, 3, -2, "a"] }]
    }));
    return [m.totalWeeks, m.periods.length, m.courses[0].weekday, m.courses[0].endPeriod, m.courses[0].weeks];
})(), [20, 1, 1, 5, [3]]);

// 作息表文本解析
check("作息表文本", CM.parsePeriodsText("1 08:00-08:45\n# 注释\n2 08:55-09:40").periods,
    [{ node: 1, start: "08:00", end: "08:45" }, { node: 2, start: "08:55", end: "09:40" }]);
ok("作息表坏行有报错", CM.parsePeriodsText("1 08:00-08:45\n瞎写\n").errors.length === 1);
check("作息表往返", CM.parsePeriodsText(CM.periodsToText(wm.periods)).periods, wm.periods);

// 时间落在已有作息表上（用户先导了 WakeUp 的 10 小节，再导 ICS）
// 08:00-09:40 应当落到第 1-2 节，而不是把整个作息表换掉
const withPeriods = ICS.toModel(parsed, CM, { termStart: "2026-09-07", periods: wm.periods, totalWeeks: 18 });
const wp = withPeriods.model;
check("复用已有作息表", wp.periods.length, 10);
check("跨度落到 1-2 节", (() => {
    const c = wp.courses.filter(x => x.name === "高等数学A")[0];
    return [c.startPeriod, c.endPeriod];
})(), [1, 2]);
check("14:00-15:40 落到 5-6 节", (() => {
    const c = wp.courses.filter(x => x.name === "大学英语（读写译）")[0];
    return [c.startPeriod, c.endPeriod];
})(), [5, 6]);

// 调休日「按哪天的课表上课」：单独一个配置键，读写要能往返
check("调休表往返", CM.parseWorkAs(CM.serializeWorkAs({ "2026-10-10": 5, "2026-09-20": 0 })),
    { "2026-10-10": 5, "2026-09-20": 0 });
check("调休表：未设置返回 -1", CM.workAsFor({}, "2026-10-10"), -1);
check("调休表：不排课返回 0", CM.workAsFor({ "2026-10-10": 0 }, "2026-10-10"), 0);
check("调休表：按周五返回 5", CM.workAsFor({ "2026-10-10": 5 }, "2026-10-10"), 5);
check("调休表：越界值当未设置", CM.workAsFor({ "2026-10-10": 99 }, "2026-10-10"), -1);
check("调休表：坏 JSON 退回空", CM.serializeWorkAs(CM.parseWorkAs("{{坏")), "{}");
check("调休表：坏日期键被丢弃", CM.serializeWorkAs(CM.parseWorkAs('{"不是日期":3,"2026-10-10":3}')),
    '{"2026-10-10":3}');

console.log("################ 结果 ################");
if (fails.length === 0) {
    console.log(`全部通过：${pass} 项`);
} else {
    console.log(`通过 ${pass} 项，失败 ${fails.length} 项：\n`);
    for (const f of fails) console.log("  ✗ " + f + "\n");
    process.exitCode = 1;
}
