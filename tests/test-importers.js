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
    "parityOf", "applyParity", "normalizeSpan", "weeksDisplay", "isArrayLike"
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

console.log("################ 结果 ################");
if (fails.length === 0) {
    console.log(`全部通过：${pass} 项`);
} else {
    console.log(`通过 ${pass} 项，失败 ${fails.length} 项：\n`);
    for (const f of fails) console.log("  ✗ " + f + "\n");
    process.exitCode = 1;
}
