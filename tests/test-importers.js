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
    "parseWeeksText", "weeksToText", "periodByNode", "textColorFor",
    "parityOf", "applyParity", "normalizeSpan", "weeksDisplay", "isArrayLike", "slotsOn", "dimColor",
    "cardsForDay", "dayLabel", "remainingCards", "dayTitle", "tagCards", "looksMisDecoded", "clockSkewSec", "clockOffsetToStore", "applyClockOffset"
]);
const ICS = loadQmlJs(path.join(UI, "ics.js"), [
    "splitLine", "unescapeText", "parseDateValue", "expandWeekly",
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

console.log("################ 五、单双周快捷选项 ################\n");

check("单周判定", CM.parityOf([1, 3, 5, 7]), 1);
check("双周判定", CM.parityOf([2, 4, 6]), 2);
check("混合判定为每周", CM.parityOf([1, 2, 3]), 0);
check("空周次判定为每周", CM.parityOf([]), 0);
check("单周只有一个也是单周", CM.parityOf([5]), 1);

// 按现有起止周重排
check("1-6 取单周", CM.applyParity([1, 2, 3, 4, 5, 6], 1, 20), [1, 3, 5]);
check("1-6 取双周", CM.applyParity([1, 2, 3, 4, 5, 6], 2, 20), [2, 4, 6]);
check("1-6 取每周", CM.applyParity([1, 2, 3, 4, 5, 6], 0, 20), [1, 2, 3, 4, 5, 6]);
check("起止不规整时按区间补", CM.applyParity([3, 7], 1, 20), [3, 5, 7]);
// 周次为空（新建的课）用 1..总周数 兜底，这样直接选单双周也有结果
check("空周次兜底取单周", CM.applyParity([], 1, 8), [1, 3, 5, 7]);
check("空周次兜底取双周", CM.applyParity([], 2, 8), [2, 4, 6, 8]);
check("总周数缺失时兜底 1 周", CM.applyParity([], 1, 0), [1]);
check("非法单双周值按每周处理", CM.applyParity([1, 2, 3, 4], 9, 20), [1, 2, 3, 4]);

// ── 反复切换不能缩水 ──
// 光看周次列表推不出原区间（[1,3,5] 的 min/max 是 1..5，原区间可能是 1..6），
// 所以范围单独记；不给范围的话每切一次就少两周。
const SPAN = [1, 16];
let shrink = CM.applyParity([], 0, 20, SPAN);          // 1..16
shrink = CM.applyParity(shrink, 1, 20, SPAN);          // 单周
check("切单周", shrink, [1, 3, 5, 7, 9, 11, 13, 15]);
shrink = CM.applyParity(shrink, 2, 20, SPAN);          // 双周
check("切双周", shrink, [2, 4, 6, 8, 10, 12, 14, 16]);
shrink = CM.applyParity(shrink, 0, 20, SPAN);          // 回每周，必须回到 1..16
check("切回每周不缩水", shrink,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
// 不给范围时（老数据）退回按周次推，此时会缩水 —— 这是已知的降级行为
check("无范围时退回按周次推", CM.applyParity([1, 3, 5], 0, 20), [1, 2, 3, 4, 5]);

// ── 周次范围 ──
check("范围优先于周次", CM.normalizeSpan([1, 16], [1, 3, 5]), [1, 16]);
check("无范围时按周次推", CM.normalizeSpan(null, [3, 7, 9]), [3, 9]);
check("周次为空且无范围", CM.normalizeSpan(null, []), null);
check("坏范围退回按周次推", CM.normalizeSpan([9, 1], [2, 4]), [2, 4]);

// ── 周次框的显示文本 ──
// 单周课要显示真实起止，否则 1-16 周的单周课显示成 "1-15单"，会让人以为第 16 周没排
check("单周显示真实起止", CM.weeksDisplay({ weeks: [1, 3, 5, 7, 9, 11, 13, 15], weekSpan: [1, 16] }), "1-16单");
check("双周显示真实起止", CM.weeksDisplay({ weeks: [2, 4, 6, 8, 10, 12, 14, 16], weekSpan: [1, 16] }), "1-16双");
check("每周按周次显示", CM.weeksDisplay({ weeks: [1, 2, 3], weekSpan: [1, 3] }), "1-3");
check("无范围时按周次推显示", CM.weeksDisplay({ weeks: [1, 3, 5] }), "1-5单");
// 显示的文本必须能被读回同一组周次
check("显示文本可读回", CM.parseWeeksText(
    CM.weeksDisplay({ weeks: [1, 3, 5, 7, 9, 11, 13, 15], weekSpan: [1, 16] })).weeks,
    [1, 3, 5, 7, 9, 11, 13, 15]);

// 单双周写成 "1-15单" 能省很多地方，且必须能原样读回来
check("单周序列显示为区间", CM.weeksToText([1, 3, 5, 7, 9, 11, 13, 15]), "1-15单");
check("双周序列显示为区间", CM.weeksToText([2, 4, 6, 8]), "2-8双");
check("连续区间仍用连字符", CM.weeksToText([1, 2, 3, 4]), "1-4");
check("零散周次逐个列出", CM.weeksToText([1, 4, 9]), "1,4,9");
check("单个周次", CM.weeksToText([3]), "3");
check("空周次", CM.weeksToText([]), "");

// 往返：周次 → 文本 → 周次，必须回到同一个集合
const roundTrips = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    [1, 3, 5, 7, 9, 11, 13, 15],
    [2, 4, 6, 8, 10, 12, 14, 16],
    [1, 3],
    [2, 4],
    [1, 2, 3],
    [1, 4, 9],
    [5],
    [1, 2, 5, 6, 7, 11]
];
let rtOk = true;
let rtDetail = "";
for (const w of roundTrips) {
    const text = CM.weeksToText(w);
    const back = CM.parseWeeksText(text).weeks;
    if (JSON.stringify(back) !== JSON.stringify(w)) {
        rtOk = false;
        rtDetail += `\n      ${JSON.stringify(w)} → "${text}" → ${JSON.stringify(back)}`;
    }
}
ok("周次文本往返一致", rtOk, rtDetail);

// 手输 "1-16单" 应当和勾选仅单周得到一样的结果
check("手输 1-16单 等价于仅单周",
    CM.parseWeeksText("1-16单").weeks, CM.applyParity(CM.parseWeeksText("1-16").weeks, 1, 20));
check("手输 1-16双 等价于仅双周",
    CM.parseWeeksText("1-16双").weeks, CM.applyParity(CM.parseWeeksText("1-16").weeks, 2, 20));
// 范围要取用户写下的起止，且必须在单双周过滤之前记下来
check("1-18双 的范围是 1-18", CM.parseWeeksText("1-18双").span, [1, 18]);
check("1-16单 的范围是 1-16", CM.parseWeeksText("1-16单").span, [1, 16]);
check("1,3,5 的范围是 1-5", CM.parseWeeksText("1,3,5").span, [1, 5]);
check("1-8,10-14 的范围是 1-14", CM.parseWeeksText("1-8,10-14").span, [1, 14]);
check("空文本没有范围", CM.parseWeeksText("").span, null);
// 用这个范围再切单双周，第 1 周不能丢
check("1-18双 再切单周含第1周",
    CM.applyParity(CM.parseWeeksText("1-18双").weeks, 1, 20, CM.parseWeeksText("1-18双").span),
    [1, 3, 5, 7, 9, 11, 13, 15, 17]);

// 下拉框选完再点编辑框，显示的文本要能被读回同样的周次与范围
check("显示文本可读回周次", CM.parseWeeksText(
    CM.weeksDisplay({ weeks: [1, 3, 5, 7, 9, 11, 13, 15], weekSpan: [1, 16] })).weeks,
    [1, 3, 5, 7, 9, 11, 13, 15]);
check("显示文本可读回范围", CM.parseWeeksText(
    CM.weeksDisplay({ weeks: [1, 3, 5, 7, 9, 11, 13, 15], weekSpan: [1, 16] })).span, [1, 16]);

// ── QML 的数组不是 JS 数组 ──
// 委托里的 modelData.weekSpan 打印出来是 [1,16]，但
// Object.prototype.toString.call() 给的不是 "[object Array]"（QML 的序列类型包装）。
// 判定若按类型来就会静默失败、退回默认分支 —— 这个 bug 只在真实 QML 里复现，
// node 里用数组字面量测永远发现不了，所以这里手工造一个「有 length 和下标但不是 Array」的对象。
const variantList = { 0: 1, 1: 16, length: 2 };
ok("复现：QVariantList 不是 Array",
    Object.prototype.toString.call(variantList) !== "[object Array]");
ok("QVariantList 形态的范围仍能识别",
    JSON.stringify(CM.normalizeSpan(variantList, [1, 3, 5])) === "[1,16]",
    JSON.stringify(CM.normalizeSpan(variantList, [1, 3, 5])));
check("QVariantList 形态的范围参与显示",
    CM.weeksDisplay({ weeks: [1, 3, 5, 7, 9, 11, 13, 15], weekSpan: variantList }), "1-16单");
check("QVariantList 形态的周次也能用",
    CM.parityOf({ 0: 1, 1: 3, 2: 5, length: 3 }), 1);

console.log("################ 六、中文与编码 ################\n");

// ── 中文本身就是常规输入，不是特例 ──
const zhIcs = fs.readFileSync(path.join(__dirname, "sample-zh.ics"), "utf8");
const zhModel = CM.parseModel(CM.serializeModel(ICS.toModel(ICS.parseIcs(zhIcs), CM, {}).model));
const zhByName = {};
for (const c of zhModel.courses) zhByName[c.name] = c;

check("中文课程名（含全角括号）", Object.keys(zhByName).sort(),
    ["大学物理（单周）", "高等数学A（上）"]);
check("中文地点（含折行还原）", zhByName["高等数学A（上）"].room,
    "紫金港校区东一教学楼A座101多媒体教室（靠近南门）");
check("中文教师（从 DESCRIPTION 的「教师：」取）", zhByName["高等数学A（上）"].teacher, "张三");
check("中文 TZID 不影响课次数量", zhByName["高等数学A（上）"].weeks.length, 16);

// ── 全角冒号当分隔符 ──
// 从网页、聊天记录里复制的 ICS，中文输入法常把 : 打成 ：，整份文件就解析不出来了
const fullWidth = zhIcs.replace(/^(SUMMARY|LOCATION|DESCRIPTION|UID|DTSTART|DTEND|RRULE|BEGIN|END)(?=[;:：])/gm,
    (m) => m.replace(/:$/, "："));
const fwRes = ICS.toModel(ICS.parseIcs(fullWidth), CM, {});
check("全角冒号也认（无错误）", fwRes.errors, []);
ok("全角冒号也认（拿到课程）", fwRes.model !== null);
if (fwRes.model) {
    const m = CM.parseModel(CM.serializeModel(fwRes.model));
    check("全角冒号下课程名正确", m.courses.map(c => c.name).sort(),
        ["大学物理（单周）", "高等数学A（上）"]);
}
// 取的是第一个冒号，所以值里的全角冒号原样保留
check("首个冒号才作分隔", ICS.splitLine("DESCRIPTION:教师：张三").value, "教师：张三");
check("全角冒号分隔时值仍干净", ICS.splitLine("DESCRIPTION：教师：张三").value, "教师：张三");
check("引号内的冒号不作分隔",
    ICS.splitLine('ATTENDEE;CN="张三:李四":mailto:x@y').value, "mailto:x@y");

// ── BOM ──
check("ICS 带 BOM 仍能解析", ICS.toModel(ICS.parseIcs("\uFEFF" + zhIcs), CM, {}).errors, []);
const zhWu = fs.readFileSync(path.join(__dirname, "sample-zh.wakeup_schedule"), "utf8");
const zhWuRes = WU.parseWakeUp(zhWu);
check("WakeUp 中文无错误", zhWuRes.errors, []);
check("WakeUp 中文课名", zhWuRes.model.courses.map(c => c.name).sort(),
    ["大学物理（单周）", "高等数学A（上）"]);
check("WakeUp 中文地点", zhWuRes.model.courses[0].room, "紫金港东1A-101");
check("WakeUp 带 BOM 仍能解析", WU.parseWakeUp("\uFEFF" + zhWu).errors, []);
check("WakeUp 中文单双周", zhWuRes.model.courses.filter(c => c.name === "大学物理（单周）")[0].weeks,
    [1, 3, 5, 7, 9, 11, 13, 15]);

// ── 编码没对上要拦住，不能静默导入乱码 ──
// GBK 文件被按 UTF-8 读时每个字节变成一个 U+0080–U+00FF 的字符。
// 结构（BEGIN/END、属性名）都是 ASCII，所以照样解析得出来，只是内容全错 ——
// 用户会拿到一份看起来正常、课名全错的课表，比直接失败糟得多。
const mojibake = Buffer.from(zhIcs, "utf8").toString("latin1");
ok("正常中文不误报", CM.looksMisDecoded(zhIcs) === false);
ok("正常英文不误报", CM.looksMisDecoded("BEGIN:VCALENDAR\nSUMMARY:Math 101\nEND:VCALENDAR") === false);
ok("少量重音字符不误报", CM.looksMisDecoded("SUMMARY:Müller Übung") === false);
ok("空文本不误报", CM.looksMisDecoded("") === false);
ok("GBK 误读能被识别", CM.looksMisDecoded(mojibake) === true);
ok("含替换字符能被识别", CM.looksMisDecoded("SUMMARY:高等\uFFFD数学") === true);
// 这条是重点：乱码文件确实「能解析成功」，所以必须靠前置检查拦住
ok("乱码确实能解析出课程（故必须前置拦截）",
    ICS.toModel(ICS.parseIcs(mojibake), CM, {}).model !== null);

console.log("################ 七、时钟校正 ################\n");

// 本机时钟被改动时，课表不能跟着错：用联网取到的服务端时间算偏移量，
// 显示时加上去（本机时钟的走时是准的，不准的只是偏移）。
const LOCAL = new Date(2026, 8, 21, 10, 0, 0);          // 本机读数 2026-09-21
const TERM = { termStart: "2026-09-07" };

check("本机准确时偏差接近 0", CM.clockSkewSec(LOCAL.toISOString(), LOCAL), 0);
check("偏差不到一天不校正",
    CM.clockOffsetToStore(new Date(2026, 8, 21, 10, 0, 30).toISOString(), LOCAL), 0);
check("偏差刚好一天就校正",
    CM.clockOffsetToStore(new Date(2026, 8, 22, 10, 0, 0).toISOString(), LOCAL), 86400);

// 用户把系统时间改早了 14 天：真实是 10-05，本机显示 09-21
const serverAhead = new Date(2026, 9, 5, 10, 0, 0).toISOString();
check("本机落后 14 天 → 偏移 +14 天",
    CM.clockOffsetToStore(serverAhead, LOCAL), 14 * 86400);
// 改晚了 30 天
check("本机超前 30 天 → 偏移 -30 天",
    CM.clockOffsetToStore(new Date(2026, 7, 22, 10, 0, 0).toISOString(), LOCAL), -30 * 86400);

// 断网必须返回 null（维持原值），不能返回 0 —— 那会把已有的校正清掉
check("取不到网络时间 → null", CM.clockOffsetToStore("", LOCAL), null);
check("网络时间非法 → null", CM.clockOffsetToStore("不是时间", LOCAL), null);
check("本机时间缺失 → null", CM.clockOffsetToStore(serverAhead, null), null);

check("偏移为 0 时时间不变", CM.applyClockOffset(LOCAL, 0).getTime(), LOCAL.getTime());
check("正偏移生效", CM.isoOf(CM.applyClockOffset(LOCAL, 14 * 86400)), "2026-10-05");
check("负偏移生效", CM.isoOf(CM.applyClockOffset(LOCAL, -30 * 86400)), "2026-08-22");
check("非法偏移按 0 处理", CM.applyClockOffset(LOCAL, "x").getTime(), LOCAL.getTime());
check("偏移为 null 按 0 处理", CM.applyClockOffset(LOCAL, null).getTime(), LOCAL.getTime());

// 关键一条：本机时间落后时，校正之后算出的周次与真实日期一致
check("不校正会算错周次", CM.weekOf(TERM, LOCAL), 3);
check("校正后落到真实的那一周",
    CM.weekOf(TERM, CM.applyClockOffset(LOCAL, 14 * 86400)), 5);
// 把系统时间改早几年时，不校正会显示「尚未开学」
const wayBack = new Date(2020, 0, 1, 10, 0, 0);
ok("时钟被改早几年：不校正周次为负", CM.weekOf(TERM, wayBack) < 0);
check("时钟被改早几年：校正后回到真实周次",
    CM.weekOf(TERM, CM.applyClockOffset(wayBack,
        CM.clockOffsetToStore(new Date(2026, 8, 21, 10, 0, 0).toISOString(), wayBack))), 3);

console.log("################ 八、非本周课程 ################\n");

// 模拟「有些课只在前几周上」
const offModel = CM.parseModel(JSON.stringify({
    termStart: "2026-09-07", totalWeeks: 18,
    periods: [{ node: 1, start: "08:00", end: "08:45" }],
    courses: [
        { name: "高等数学", weekday: 1, startPeriod: 1, endPeriod: 1, weeks: [1,2,3,4] },
        { name: "选修讲座", weekday: 1, startPeriod: 1, endPeriod: 1, weeks: [10] }
    ]
}));

// 第 3 周：两门课都在周一第一节，但只有高等数学这一周上
const w3 = CM.slotsOn(offModel, 3, 1, true);
check("第3周两格都在", w3.length, 2);
check("本周要上的排前面", w3.map(s => s.course.name), ["高等数学", "选修讲座"]);
check("本周标记", w3.map(s => s.meets), [true, false]);
check("默认不返回非本周的课", CM.slotsOn(offModel, 3, 1, false).map(s => s.course.name),
    ["高等数学"]);
// 第 10 周：轮到讲座，数学不上
const w10 = CM.slotsOn(offModel, 10, 1, true);
check("第10周本周标记对调", w10.map(s => [s.course.name, s.meets]),
    [["选修讲座", true], ["高等数学", false]]);
check("第10周默认只画讲座", CM.slotsOn(offModel, 10, 1, false).map(s => s.course.name),
    ["选修讲座"]);
// 星期几的过滤仍然生效
check("别的星期几不受影响", CM.slotsOn(offModel, 3, 2, true).length, 0);

// 灰显配色：要往灰里走，但仍认得出是哪门课（不是所有课都变成同一个灰）
const dimBlue = CM.dimColor("#3f51b5");
const dimTeal = CM.dimColor("#009688");
ok("灰显后仍带色相", dimBlue !== dimTeal, dimBlue + " vs " + dimTeal);
ok("灰显后确实变暗", (() => {
    const lum = h => {
        const v = h.replace("#", "");
        return 0.2126*parseInt(v.slice(0,2),16) + 0.7152*parseInt(v.slice(2,4),16) + 0.0722*parseInt(v.slice(4,6),16);
    };
    return Math.abs(lum(dimBlue) - lum("#3f51b5")) < 180;
})(), dimBlue);
check("灰显值合法", /^#[0-9a-f]{6}$/.test(dimBlue), true);
check("非法颜色有兜底", /^#[0-9a-f]{6}$/.test(CM.dimColor("不是颜色")), true);
check("灰显可重复（纯函数）", CM.dimColor("#3f51b5"), dimBlue);

console.log("################ 九、列表样式用的数据 ################\n");

const listModel = CM.parseModel(JSON.stringify({
    termStart: "2026-09-07", totalWeeks: 18,
    periods: [
        { node: 1, start: "08:00", end: "08:45" },
        { node: 2, start: "08:55", end: "09:40" },
        { node: 3, start: "14:00", end: "14:45" }
    ],
    courses: [
        { name: "高等数学", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1,2,3,4],
          room: "东1A-101", teacher: "张三", color: "#3f51b5" },
        { name: "大学英语", weekday: 1, startPeriod: 3, endPeriod: 3, weeks: [1,2,3,4],
          room: "外语楼", teacher: "赵六", color: "#00897b" }
    ]
}));

// 第 3 周周一（2026-09-21）
const cards = CM.cardsForDay(listModel, 3, 1);
check("卡片数量", cards.length, 2);
check("卡片按时间排", cards.map(c => c.name), ["高等数学", "大学英语"]);
check("时间文本", cards.map(c => c.time), ["08:00–09:40", "14:00–14:45"]);
check("起止分钟", [cards[0].startMinutes, cards[0].endMinutes], [480, 580]);
check("地点教师带出来了", [cards[0].room, cards[0].teacher], ["东1A-101", "张三"]);
check("颜色带出来了", cards[0].color, "#3f51b5");
// 这一周不上就没有卡片
check("非本周没有卡片", CM.cardsForDay(listModel, 9, 1), []);
check("没课的星期没有卡片", CM.cardsForDay(listModel, 3, 2), []);
// 作息表缺行时不该崩，时间留空
const noPeriods = CM.parseModel(JSON.stringify({
    termStart: "2026-09-07", totalWeeks: 18,
    courses: [{ name: "自习", weekday: 1, startPeriod: 1, endPeriod: 1, weeks: [1] }]
}));
const np = CM.cardsForDay(noPeriods, 1, 1);
check("没有作息表也能出卡片", np.length, 1);
check("时间文本为空而不是 NaN", np[0].time, "");
check("分钟为 -1", [np[0].startMinutes, np[0].endMinutes], [-1, -1]);

// 相对日期标签
const d0 = new Date(2026, 8, 21);
check("今天", CM.dayLabel(d0, new Date(2026, 8, 21)), "今天");
check("明天", CM.dayLabel(d0, new Date(2026, 8, 22)), "明天");
check("后天", CM.dayLabel(d0, new Date(2026, 8, 23)), "后天");
check("再往后用星期", CM.dayLabel(d0, new Date(2026, 8, 24)), "周四");
check("跨月也对", CM.dayLabel(d0, new Date(2026, 9, 1)), "周四");

// ── 「今日课程」：已上完的要滤掉，全上完则退而显示最近的一节 ──
const todayCardsFixture = [
    { name: "早课", startMinutes: 480, endMinutes: 580 },     // 08:00-09:40
    { name: "午课", startMinutes: 840, endMinutes: 940 },     // 14:00-15:40
    { name: "晚课", startMinutes: 1140, endMinutes: 1240 }    // 19:00-20:40
];
check("第一节课还没下课时三门都在",
    CM.remainingCards(todayCardsFixture, 500).map(c => c.name), ["早课", "午课", "晚课"]);
check("早课上完后只剩两门",
    CM.remainingCards(todayCardsFixture, 600).map(c => c.name), ["午课", "晚课"]);
check("正在上的那门要留着（还没下课）",
    CM.remainingCards(todayCardsFixture, 900).map(c => c.name), ["午课", "晚课"]);
check("刚好下课点就滤掉",
    CM.remainingCards(todayCardsFixture, 940).map(c => c.name), ["晚课"]);
check("全上完返回空",
    CM.remainingCards(todayCardsFixture, 1300), []);
check("空列表不崩", CM.remainingCards([], 600), []);
check("没有作息表(endMinutes<0)时一律保留",
    CM.remainingCards([{ name: "无时间", startMinutes: -1, endMinutes: -1 }], 1300).length, 1);

// 今日标题
check("今日标题", CM.dayTitle(new Date(2026, 8, 22)), "今天 · 9月22日 周二");
check("周日标题", CM.dayTitle(new Date(2026, 8, 27)), "今天 · 9月27日 周日");

// ── tagCards：两种来源的字段要统一，样式组件才不用猜 ──
const tagged = CM.tagCards([{ name: "A", room: "R", teacher: "T", color: "#111111",
                              start: "08:00", end: "09:40", time: "08:00–09:40",
                              startMinutes: 480, endMinutes: 580, 杂项: 1 }], true, "");
check("补齐 sameDay", tagged[0].sameDay, true);
check("补齐 dayLabel", tagged[0].dayLabel, "");
check("业务字段都带过来了",
    [tagged[0].name, tagged[0].room, tagged[0].teacher, tagged[0].color,
     tagged[0].time, tagged[0].startMinutes, tagged[0].endMinutes],
    ["A", "R", "T", "#111111", "08:00–09:40", 480, 580]);
check("只保留需要的字段", Object.keys(tagged[0]).sort(),
    ["color", "dayLabel", "end", "endMinutes", "name", "room", "sameDay",
     "start", "startMinutes", "teacher", "time"]);
check("sameDay 缺省为 false",
    CM.tagCards([{ name: "B" }], undefined, "明天")[0].sameDay, false);
check("dayLabel 缺省为空串", CM.tagCards([{ name: "B" }], false, null)[0].dayLabel, "");
check("空列表", CM.tagCards([], true, ""), []);

// 关键回归：明天的课不能被判成「正在上」
// （StyleToday 的 isCurrent 必须同时看 sameDay 和时间区间）
const tomorrowCard = CM.tagCards([{ name: "明天的课", startMinutes: 840, endMinutes: 1060,
                                    time: "14:00–17:40" }], false, "明天")[0];
const todayCard = CM.tagCards([{ name: "今天的课", startMinutes: 840, endMinutes: 1060,
                                 time: "14:00–17:40" }], true, "")[0];
function inProgress(c, minutes) {
    return c.sameDay && c.startMinutes >= 0 && c.endMinutes > c.startMinutes
        && minutes >= c.startMinutes && minutes < c.endMinutes;
}
ok("同时间段的明天的课：不算正在上", inProgress(tomorrowCard, 870) === false);
ok("同时间段的今天的课：算正在上", inProgress(todayCard, 870) === true);

console.log("################ 结果 ################");
if (fails.length === 0) {
    console.log(`全部通过：${pass} 项`);
} else {
    console.log(`通过 ${pass} 项，失败 ${fails.length} 项：\n`);
    for (const f of fails) console.log("  ✗ " + f + "\n");
    process.exitCode = 1;
}
