/*
 * WakeUp 课程表 备份文件（.wakeup_schedule）解析
 *
 * 文件不是 JSON，而是「一行一段 JSON」的文本，按行号固定：
 *   0  未用（版本/标题）
 *   1  timeTable      [{node, startTime, endTime}]        作息时间表
 *   2  tableInfo      {startDate, tableName}              开学日期
 *   3  courseInfos    [{id, courseName, teacher, color}]  课程
 *   4  courseDetails  [{id, day, startNode, step,
 *                       startWeek, endWeek, type, room,
 *                       ownTime, teacher}]                排课
 *
 * 这里不按行号取，而是逐行试解析、按内容认领。行号是某个版本的实现细节，
 * 换个版本就可能整体挪位；按形状认则不会。
 *
 * 字段语义（已对照两个第三方解析器确认）：
 *   day        1=周一 … 7=周日
 *   type       0=每周  1=单周  2=双周
 *   startNode  起始节次；step 是连续几节
 *   ownTime    为真表示自定义时间课程，不是常规课，跳过
 *   color      #AARRGGBB（前两位是透明度），要截成 #RRGGBB
 *
 * 这个格式的好处是自带作息时间表和开学日期，
 * 所以导入之后用户不需要再配任何东西。
 */

.pragma library

function isArray(v) {
    return Object.prototype.toString.call(v) === "[object Array]";
}

function isObject(v) {
    return v !== null && typeof v === "object" && !isArray(v);
}

// #AARRGGBB / #RRGGBB / #RGB → #rrggbb；认不出来返回空串（交给色板兜底）
function normalizeColor(s) {
    var v = String(s == null ? "" : s).trim();
    if (v.charAt(0) === "#") {
        v = v.substring(1);
    }
    if (/^[0-9a-fA-F]{8}$/.test(v)) {
        v = v.substring(2);
    }
    if (/^[0-9a-fA-F]{6}$/.test(v)) {
        return "#" + v.toLowerCase();
    }
    if (/^[0-9a-fA-F]{3}$/.test(v)) {
        return "#" + v.toLowerCase();
    }
    return "";
}

function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
}

// 开学日期：可能是 "2026-09-07"、毫秒时间戳，也可能带时间部分
function parseStartDate(v) {
    if (v === null || v === undefined || v === "") {
        return "";
    }
    if (typeof v === "number" || /^\d{10,}$/.test(String(v))) {
        var ms = Number(v);
        if (ms < 1e12) {
            ms = ms * 1000;   // 秒级时间戳
        }
        var d = new Date(ms);
        if (isFinite(d.getTime())) {
            return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
        }
        return "";
    }
    var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v));
    if (!m) {
        return "";
    }
    return m[1] + "-" + pad2(Number(m[2])) + "-" + pad2(Number(m[3]));
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function minutesOfTime(s) {
    var m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/.exec(String(s || ""));
    if (!m) {
        return -1;
    }
    var h = Number(m[1]);
    var mi = Number(m[2]);
    if (h > 23 || mi > 59) {
        return -1;
    }
    return h * 60 + mi;
}

function timeOfMinutes(n) {
    return pad2(Math.floor(n / 60)) + ":" + pad2(Math.round(n % 60));
}

/*
 * 逐行试解析 JSON，按内容认领。返回 {timeTable, tableInfo, courseInfos, courseDetails}
 */
function extractBlocks(text) {
    var out = { timeTable: null, tableInfo: null, courseInfos: null, courseDetails: null };
    // 开头的 UTF-8 BOM 会让第一行不是合法 JSON，先去掉
    var lines = String(text || "").replace(/^\uFEFF/, "").split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\r$/, "").trim();
        if (!line || (line.charAt(0) !== "[" && line.charAt(0) !== "{")) {
            continue;
        }
        var v;
        try {
            v = JSON.parse(line);
        } catch (e) {
            continue;   // 这一行不是 JSON，继续找
        }
        if (isArray(v) && v.length > 0 && isObject(v[0])) {
            var k = Object.keys(v[0]);
            if (out.courseInfos === null && k.indexOf("courseName") >= 0) {
                out.courseInfos = v;
            } else if (out.courseDetails === null && k.indexOf("startNode") >= 0) {
                out.courseDetails = v;
            } else if (out.timeTable === null && k.indexOf("node") >= 0
                       && (k.indexOf("startTime") >= 0 || k.indexOf("endTime") >= 0)) {
                out.timeTable = v;
            }
        } else if (isObject(v) && out.tableInfo === null && v.startDate !== undefined) {
            out.tableInfo = v;
        }
    }
    return out;
}

/*
 * 主入口。返回 { model, warnings, errors }，
 * model 是 coursmodel.emptyModel() 形状的子集，由调用方决定覆盖哪些字段。
 */
function parseWakeUp(text) {
    var warnings = [];
    var errors = [];
    var blocks = extractBlocks(text);

    if (!blocks.courseInfos && !blocks.courseDetails) {
        errors.push("没找到 WakeUp 的课程数据。请确认导出的是 .wakeup_schedule 备份文件"
            + "（在 WakeUp 里点分享 → 导出备份），而不是截图或其它文件。");
        return { model: null, warnings: warnings, errors: errors };
    }

    // ── 作息时间表 ──
    var periods = [];
    var tt = blocks.timeTable || [];
    for (var i = 0; i < tt.length; i++) {
        var p = tt[i] || {};
        var node = Math.round(num(p.node, i + 1));
        var s = minutesOfTime(p.startTime);
        var e = minutesOfTime(p.endTime);
        if (node >= 1 && s >= 0 && e > s) {
            periods.push({ node: node, start: timeOfMinutes(s), end: timeOfMinutes(e) });
        }
    }
    periods.sort(function (a, b) { return a.node - b.node; });
    if (periods.length === 0) {
        warnings.push("文件里没有作息时间表，节次时间需要手动填写。");
    }

    // ── 开学日期 ──
    var termStart = blocks.tableInfo ? parseStartDate(blocks.tableInfo.startDate) : "";
    if (!termStart) {
        warnings.push("文件里没有开学日期，周次将无法对应到具体日期。");
    }

    // ── 课程信息（按 id 索引）──
    var info = {};
    var infos = blocks.courseInfos || [];
    for (var j = 0; j < infos.length; j++) {
        var it = infos[j] || {};
        var id = String(num(it.id, j));
        info[id] = {
            name: String(it.courseName || "").trim() || "未命名",
            teacher: String(it.teacher || "").trim(),
            color: normalizeColor(it.color)
        };
    }

    // ── 排课 → 内部课程 ──
    var courses = [];
    var maxWeek = 0;
    var skippedOwnTime = 0;
    var details = blocks.courseDetails || [];
    for (var d = 0; d < details.length; d++) {
        var c = details[d] || {};

        // 自定义时间的课不属于常规周课表，放进来只会在网格上乱飘
        if (c.ownTime) {
            skippedOwnTime++;
            continue;
        }

        var day = Math.round(num(c.day, 0));
        if (!(day >= 1 && day <= 7)) {
            warnings.push("有一节课的星期取值异常（" + c.day + "），已跳过。");
            continue;
        }

        var startNode = Math.round(num(c.startNode, 0));
        if (!(startNode >= 1)) {
            warnings.push("有一节课的起始节次异常（" + c.startNode + "），已跳过。");
            continue;
        }
        var step = Math.round(num(c.step, 1));
        if (!(step >= 1)) {
            step = 1;
        }

        var startWeek = Math.round(num(c.startWeek, 1));
        var endWeek = Math.round(num(c.endWeek, startWeek));
        if (!(startWeek >= 1)) {
            startWeek = 1;
        }
        if (endWeek < startWeek) {
            endWeek = startWeek;
        }

        // type：0 每周 / 1 单周 / 2 双周
        var type = Math.round(num(c.type, 0));
        var weeks = [];
        for (var w = startWeek; w <= endWeek; w++) {
            if (type === 1 && w % 2 === 0) {
                continue;
            }
            if (type === 2 && w % 2 === 1) {
                continue;
            }
            weeks.push(w);
        }
        if (weeks.length === 0) {
            warnings.push("有一节课的周次为空（第 " + startWeek + "-" + endWeek + " 周，type=" + type + "），已跳过。");
            continue;
        }
        if (endWeek > maxWeek) {
            maxWeek = endWeek;
        }

        var meta = info[String(num(c.id, -1))] || { name: "", teacher: "", color: "" };
        var name = meta.name || String(c.courseName || "").trim() || "未命名";
        var teacher = String(c.teacher || "").trim() || meta.teacher;

        courses.push({
            name: name,
            teacher: teacher,
            room: String(c.room || "").trim(),
            weekday: day,
            startPeriod: startNode,
            endPeriod: startNode + step - 1,
            weeks: weeks,
            color: meta.color
        });
    }

    if (skippedOwnTime > 0) {
        warnings.push("跳过 " + skippedOwnTime + " 节「自定义时间」的课（不属于常规周课表）。");
    }
    if (courses.length === 0) {
        errors.push("文件中没有可用的常规课程。");
        return { model: null, warnings: warnings, errors: errors };
    }

    return {
        model: {
            version: 1,
            termStart: termStart,
            totalWeeks: Math.max(1, maxWeek),
            periods: periods,
            courses: courses
        },
        warnings: warnings,
        errors: errors
    };
}
