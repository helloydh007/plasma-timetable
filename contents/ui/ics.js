/*
 * iCalendar（RFC 5545）解析 —— 只实现课程表需要的部分。
 *
 * 为什么用 ICS 当导入格式：
 *   国内高校的教务系统五花八门，但「课表 → .ics」这条路上已经有大量现成工具
 *   （zju-ical、fzu-ics、uestc-coursetable-parser、Class2ICS、GTMD 青果 等），
 *   而且 ICS 是唯一能用 RRULE 表达「单双周 / 限定周次」的标准格式：
 *     RRULE:FREQ=WEEKLY;INTERVAL=2  就是单周或双周，DTSTART 落在第几周决定奇偶。
 *   所以它既能覆盖国内课表，又不依赖任何一家学校私有接口。
 *
 * 时间处理约定：
 *   带 TZID 参数的时间按「本地墙钟时间」解析，不带 Z 的浮动时间同理。
 *   课表是给人看的作息表，用户就在那个时区，不需要做时区换算。
 *   只有显式带 Z 的时间才按 UTC 解析，再交给本地时间显示。
 */

.pragma library

var MAX_OCCURRENCES = 400;

// 有些教务系统导出的 RRULE 只有 FREQ=WEEKLY，既无 COUNT 也无 UNTIL，
// 字面意思是"永远每周"。课表场景下按"这一学期"理解，取一个上限，
// 免得一门课在 2030 年的那一周还冒出来。
var WEEKS_WHEN_OPEN_ENDED = 30;

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function dayKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// 折成"日序号"，用于按天比较（避免 UNTIL 的时分秒把最后一天截掉）
function dayIndex(d) {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// ── RFC 5545 §3.1 折行还原：换行后紧跟空格/TAB 的行属于上一行 ──
function unfold(text) {
    var s = String(text || "");
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.replace(/\n[ \t]/g, "");
    return s;
}

// ── 把 "NAME;PARAM=VALUE:value" 拆成三段。冒号要跳开引号内的部分 ──
function splitLine(line) {
    var colon = -1;
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
        var c = line.charAt(i);
        if (c === '"') {
            inQuote = !inQuote;
        } else if (c === ":" && !inQuote) {
            colon = i;
            break;
        }
    }
    if (colon < 0) {
        return null;
    }
    var head = line.substring(0, colon);
    var parts = head.split(";");
    var params = {};
    for (var p = 1; p < parts.length; p++) {
        var eq = parts[p].indexOf("=");
        if (eq > 0) {
            params[parts[p].substring(0, eq).toUpperCase()] =
                parts[p].substring(eq + 1).replace(/^"|"$/g, "");
        }
    }
    return { name: parts[0].toUpperCase(), params: params, value: line.substring(colon + 1) };
}

// 单次扫描反转义。不能用连续 replace：\n 与 \\ 的先后顺序会互相破坏。
// 用 while 而不是 for：转义要一次吃掉两个字符，for 的自增会多跳一个。
function unescapeText(s) {
    var str = String(s == null ? "" : s);
    var out = "";
    var i = 0;
    while (i < str.length) {
        var c = str.charAt(i);
        if (c === "\\" && i + 1 < str.length) {
            var n = str.charAt(i + 1);
            if (n === "n" || n === "N") {
                out += "\n";
                i += 2;
                continue;
            }
            if (n === "," || n === ";" || n === "\\") {
                out += n;
                i += 2;
                continue;
            }
        }
        out += c;
        i++;
    }
    return out;
}

var DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

// 返回 { date: Date, allDay: bool }；无法解析返回 null
function parseDateValue(value) {
    var m = DATE_RE.exec(String(value || "").trim());
    if (!m) {
        return null;
    }
    var y = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var da = Number(m[3]);
    var allDay = (m[4] === undefined);
    var hh = allDay ? 0 : Number(m[4]);
    var mi = allDay ? 0 : Number(m[5]);
    var ss = allDay ? 0 : Number(m[6]);
    var d = m[7]
        ? new Date(Date.UTC(y, mo, da, hh, mi, ss))   // 带 Z：UTC 瞬间
        : new Date(y, mo, da, hh, mi, ss);           // 浮动/带 TZID：本地墙钟
    return { date: d, allDay: allDay };
}

function parseRRule(value) {
    var out = {};
    var segs = String(value || "").split(";");
    for (var i = 0; i < segs.length; i++) {
        var eq = segs[i].indexOf("=");
        if (eq > 0) {
            out[segs[i].substring(0, eq).toUpperCase()] = segs[i].substring(eq + 1).toUpperCase();
        }
    }
    return out;
}

// 把周期事件展开成具体日期。课程表只可能遇到 FREQ=WEEKLY；
// 其它频率（个别教务系统会导出 MONTHLY）按「仅一次」处理，宁可少显示也不乱显示。
function expandWeekly(start, rule, exdates) {
    var freq = rule && rule.FREQ ? rule.FREQ : "WEEKLY";
    if (freq !== "WEEKLY") {
        return [start];
    }
    var interval = parseInt((rule.INTERVAL || "1"), 10);
    if (!(interval >= 1)) {
        interval = 1;
    }
    var count = rule.COUNT ? parseInt(rule.COUNT, 10) : 0;
    var until = rule.UNTIL ? parseDateValue(rule.UNTIL) : null;
    var untilDay = until ? dayIndex(until.date) : null;
    if (!(count > 0) && untilDay === null) {
        count = WEEKS_WHEN_OPEN_ENDED;
    }

    var skip = {};
    var list = exdates || [];
    for (var i = 0; i < list.length; i++) {
        skip[dayKey(list[i])] = true;
    }

    var out = [];
    var cur = new Date(start.getTime());
    for (var n = 0; n < MAX_OCCURRENCES; n++) {
        if (count > 0 && n >= count) {
            break;
        }
        if (untilDay !== null && dayIndex(cur) > untilDay) {
            break;
        }
        if (!skip[dayKey(cur)]) {
            out.push(new Date(cur.getTime()));
        }
        cur.setDate(cur.getDate() + 7 * interval);
    }
    return out;
}

/*
 * 解析整份 ICS。
 * 返回 { events: [...], errors: [...] }，每个 event：
 *   { uid, summary, location, description,
 *     start: Date, end: Date, allDay: bool,
 *     rrule, exdates: [Date], dates: [Date] }
 */
function parseIcs(text) {
    var lines = unfold(text).split("\n");
    var raw = [];
    var errors = [];
    var cur = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) {
            continue;
        }
        var kv = splitLine(line);
        if (!kv) {
            continue;
        }
        if (kv.name === "BEGIN" && kv.value.toUpperCase() === "VEVENT") {
            cur = {};
            continue;
        }
        if (kv.name === "END" && kv.value.toUpperCase() === "VEVENT") {
            if (cur) {
                raw.push(cur);
            }
            cur = null;
            continue;
        }
        if (!cur) {
            continue;
        }
        if (kv.name === "UID") {
            cur.uid = kv.value;
        } else if (kv.name === "SUMMARY") {
            cur.summary = unescapeText(kv.value);
        } else if (kv.name === "LOCATION") {
            cur.location = unescapeText(kv.value);
        } else if (kv.name === "DESCRIPTION") {
            cur.description = unescapeText(kv.value);
        } else if (kv.name === "DTSTART") {
            cur.dtstart = parseDateValue(kv.value);
        } else if (kv.name === "DTEND") {
            cur.dtend = parseDateValue(kv.value);
        } else if (kv.name === "RRULE") {
            cur.rrule = parseRRule(kv.value);
        } else if (kv.name === "EXDATE") {
            cur.exdates = cur.exdates || [];
            var vs = kv.value.split(",");
            for (var v = 0; v < vs.length; v++) {
                var pd = parseDateValue(vs[v]);
                if (pd) {
                    cur.exdates.push(pd.date);
                }
            }
        }
    }

    // 文件在 VEVENT 中间就结束（粘贴被截断、下载不全）：保留已解析的部分并记一条警告。
    // 静默丢弃会让用户以为"导进来的课本来就少一门"。
    if (cur) {
        raw.push(cur);
        errors.push("文件在最后一条事件中间结束，可能不完整");
    }

    var events = [];
    for (var e = 0; e < raw.length; e++) {
        var r = raw[e];
        if (!r.dtstart) {
            errors.push("VEvent 缺少可解析的 DTSTART：" + (r.summary || r.uid || "(无标题)"));
            continue;
        }
        if (!r.summary) {
            errors.push("VEvent 缺少 SUMMARY，已跳过");
            continue;
        }
        var dates;
        if (r.rrule) {
            dates = expandWeekly(r.dtstart.date, r.rrule, r.exdates);
        } else {
            dates = [r.dtstart.date];
        }
        events.push({
            uid: r.uid || "",
            summary: r.summary,
            location: r.location || "",
            description: r.description || "",
            start: r.dtstart.date,
            end: r.dtend ? r.dtend.date : null,
            allDay: r.dtstart.allDay,
            rrule: r.rrule || null,
            exdates: r.exdates || [],
            dates: dates
        });
    }
    return { events: events, errors: errors };
}

// 从 DESCRIPTION 里捞教师名。各校写法不同，这里只认最常见的几种前缀
function teacherFromDescription(desc) {
    if (!desc) {
        return "";
    }
    var m = /(?:教师|老师|授课教师|Teacher)\s*[:：]\s*([^\n;；]+)/i.exec(desc);
    return m ? m[1].trim() : "";
}

// 每节课的分钟数（用于排序和"下一节课"计算）
function minutesOf(d) {
    return d.getHours() * 60 + d.getMinutes();
}

/*
 * 展开成"某天有哪些课"。这是界面直接消费的结构。
 * 注意：内部完全按**具体日期**匹配，不用周次。
 *   周次只是给人看的标签，需要时再用 termStart 换算。
 *   这样即使开学日填错，课表显示的日期也依然是对的。
 */
function toSessions(parsed) {
    var out = [];
    for (var i = 0; i < parsed.events.length; i++) {
        var ev = parsed.events[i];
        for (var d = 0; d < ev.dates.length; d++) {
            var start = ev.dates[d];
            var end = null;
            if (ev.end && ev.start) {
                var spanMin = Math.round((ev.end.getTime() - ev.start.getTime()) / 60000);
                end = new Date(start.getTime() + spanMin * 60000);
            }
            out.push({
                date: start,
                day: dayKey(start),
                weekday: start.getDay(),
                startMinutes: minutesOf(start),
                endMinutes: end ? minutesOf(end) : minutesOf(start),
                startTime: pad2(start.getHours()) + ":" + pad2(start.getMinutes()),
                endTime: end ? pad2(end.getHours()) + ":" + pad2(end.getMinutes()) : "",
                summary: ev.summary,
                location: ev.location,
                teacher: teacherFromDescription(ev.description),
                allDay: ev.allDay
            });
        }
    }
    out.sort(function (a, b) {
        if (a.day !== b.day) {
            return a.day < b.day ? -1 : 1;
        }
        return a.startMinutes - b.startMinutes;
    });
    return out;
}

// 按日期分组：{ "2026-09-07": [session, ...], ... }
function groupByDay(sessions) {
    var map = {};
    for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        if (!map[s.day]) {
            map[s.day] = [];
        }
        map[s.day].push(s);
    }
    return map;
}

// 某一天的行数（用于统计，也方便测试）
function countOn(sessions, day) {
    var n = 0;
    for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].day === day) {
            n++;
        }
    }
    return n;
}

/*
 * 把解析结果转成内部课表模型。
 *
 * CM 参数是 coursmodel 模块，由调用方传进来。
 * 为什么用传参而不是 import：.pragma library 文件里不能写 import 语句
 * （QML 会报 "Unexpected token import"），跨模块调用只能显式接。
 *
 * existing = 现有模型 { termStart, periods, totalWeeks }。
 * 已有作息表时优先用它：那可能是用户调过的、或从 WakeUp 导入的更细的节次划分，
 * 不该被一份 ICS 覆盖掉。
 */
function toModel(parsed, CM, existing) {
    existing = existing || {};
    var warnings = [];
    var errors = [];
    var i, j;

    // ── 1. 作息时间表 ──
    var periods = (existing.periods && existing.periods.length) ? existing.periods : [];
    var derivedPeriods = false;
    if (periods.length === 0) {
        var intervals = [];
        for (i = 0; i < parsed.events.length; i++) {
            var ev0 = parsed.events[i];
            if (ev0.allDay || !ev0.start) {
                continue;
            }
            var s0 = minutesOf(ev0.start);
            var span0 = ev0.end ? Math.round((ev0.end.getTime() - ev0.start.getTime()) / 60000) : 0;
            if (span0 <= 0) {
                span0 = 45;
            }
            intervals.push({ start: s0, end: s0 + span0 });
        }
        periods = CM.periodsFromIntervals(intervals);
        derivedPeriods = periods.length > 0;
    }

    // ── 2. 开学日 ──
    var termStart = existing.termStart || "";
    var inferredTermStart = false;
    if (!termStart) {
        var earliest = null;
        for (i = 0; i < parsed.events.length; i++) {
            var ds = parsed.events[i].dates || [];
            for (j = 0; j < ds.length; j++) {
                if (earliest === null || ds[j].getTime() < earliest.getTime()) {
                    earliest = ds[j];
                }
            }
        }
        if (earliest) {
            termStart = CM.isoOf(CM.dateFromDayIndex(CM.mondayOf(earliest)));
            inferredTermStart = true;
        }
    }
    if (!termStart) {
        errors.push("无法确定开学日期：文件里没有可用的课程日期。");
        return { model: null, warnings: warnings, errors: errors };
    }

    var mm = { termStart: termStart };

    // ── 3. 逐条展开成时段 ──
    var slots = [];
    var allDaySkipped = 0;
    var unmapped = 0;
    var beforeTerm = 0;
    var maxWeek = 0;

    for (i = 0; i < parsed.events.length; i++) {
        var ev = parsed.events[i];
        if (ev.allDay || !ev.start) {
            allDaySkipped++;   // 考试之类的整天事件不进周网格
            continue;
        }
        var startMin = minutesOf(ev.start);
        var span = ev.end ? Math.round((ev.end.getTime() - ev.start.getTime()) / 60000) : 45;
        if (span <= 0) {
            span = 45;
        }
        var map = CM.mapEvent(periods, startMin, startMin + span);
        if (!map) {
            unmapped++;
            continue;
        }
        for (j = 0; j < ev.dates.length; j++) {
            var week = CM.weekOf(mm, ev.dates[j]);
            if (week < 1) {
                beforeTerm++;
                continue;
            }
            if (week > maxWeek) {
                maxWeek = week;
            }
            slots.push({
                name: ev.summary,
                teacher: teacherFromDescription(ev.description),
                room: ev.location,
                weekday: CM.weekdayOf(ev.dates[j]),
                startPeriod: map.startPeriod,
                endPeriod: map.endPeriod,
                weeks: [week],
                color: ""
            });
        }
    }

    if (allDaySkipped > 0) {
        warnings.push("跳过 " + allDaySkipped + " 个整天事件（考试等），它们不属于周课表。");
    }
    if (unmapped > 0) {
        warnings.push(unmapped + " 个事件的开始时间对不上任何一节，已跳过。");
    }
    if (beforeTerm > 0) {
        warnings.push(beforeTerm + " 节课的日期早于第 1 周（开学日可能填错了），已跳过。");
    }
    if (slots.length === 0) {
        errors.push("没有解析出任何可用的课程时段。");
        return { model: null, warnings: warnings, errors: errors };
    }

    var courses = CM.assignColors(CM.mergeSlots(slots));
    var totalWeeks = Math.max(
        Math.max(1, maxWeek),
        Math.round(Number(existing.totalWeeks) || 0)
    );

    if (derivedPeriods) {
        warnings.push("作息时间表是从 ICS 推出来的（每行 = 一个上课时段），可在「学期」页调整。");
    }
    if (inferredTermStart) {
        warnings.push("开学日是按 ICS 里最早的课推断的（" + termStart + "），请核对。");
    }

    return {
        model: {
            version: 1,
            termStart: termStart,
            totalWeeks: totalWeeks,
            periods: periods,
            courses: courses
        },
        warnings: warnings,
        errors: errors
    };
}
