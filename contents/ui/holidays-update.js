/*
 * 节假日数据的「运行时联网更新」支持
 *
 * 职责划分（重要）：
 *   holidays.js  —— 内置数据表，由 tools/update-from-web.py 生成，请勿手工编辑
 *   本文件        —— 联网拉取、校验、缓存、查询合并的逻辑（纯 JS，可离线单测）
 *
 * 缓存只保存「内置数据里没有的年份」，因此不会随年份累积而膨胀。
 * 缓存在组件配置里（Plasmoid.configuration.holidayCache），格式：
 *     {"2027": {"off": {"2027-01-01": "元旦", ...}, "work": {"2027-01-10": "元旦"}}}
 *
 * 安全性：无论是刚拉取到的数据还是已存缓存，进入使用前都要过一遍 validate 系列
 * 函数。宁可什么都不显示，也不显示错误的节假日——它会实际影响行程安排。
 */

.pragma library

// 注意：.pragma library 脚本里不能写 `import "x.js" as Y`（QML 语法，JS 库不合法）。
// 因此本文件不依赖 holidays.js，需要内置数据的函数一律由调用方显式传入
// （见 builtinYears / statusFromCache 的签名）。这比模块级注入更清晰，
// 也不受 QML 引擎作用域与初始化顺序影响。

// 数据源（按顺序尝试）。两个都指向同一份社区数据集，第二个是 CDN 镜像，
// 在直连 GitHub 受限的网络环境下通常仍可用。
var URL_TEMPLATES = [
    "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/%1.json",
    "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/%1.json"
];

// 自动检查的间隔（天）。放假安排每年 11 月前后发布，按月检查足以在发布后
// 一个月内取到，且不会产生可观的流量。
var AUTO_CHECK_INTERVAL_DAYS = 30;

// 单次更新最多联网获取几个年份。用于兜住「内置数据极旧、积欠多年」的情形：
// 一次点更新只补最近的几个年份，其余留待下次点击（结果里会提示还剩几年）。
// 正常情况下积欠不会超过 1–2 年，这个上限不会触发。
var MAX_YEARS_PER_RUN = 5;

// 节假日名称 → 放假天数合理区间。
// 含「·」「、」的合并节日（如 2025 年的「国庆节、中秋节」连休 8 天）不适用
// 单节日区间，因此只对精确匹配的名称做天数检查。
var COUNT_RANGES = {
    "元旦":   [1, 3],
    "春节":   [7, 10],
    "清明节": [1, 4],
    "劳动节": [3, 6],
    "端午节": [1, 4],
    "中秋节": [1, 4],
    "国庆节": [5, 8]
};

// 节日的天文/政策窗口（月份均为 1 起算）。日期写错时几乎必然被其中一条抓住。
var INCLUDE_DATES = {
    "元旦":   [[1, 1]],
    "劳动节": [[5, 1]],
    "国庆节": [[10, 1]]
};
var WINDOWS = {
    "春节":   [1, 21, 2, 21],
    "清明节": [4, 4, 4, 6],
    "端午节": [5, 25, 6, 30],
    "中秋节": [9, 5, 10, 10]
};

function urlsFor(year) {
    var out = [];
    for (var i = 0; i < URL_TEMPLATES.length; i++) {
        out.push(URL_TEMPLATES[i].replace("%1", String(year)));
    }
    return out;
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function dayIndex(y, m, d) {
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function weekdayOf(y, m, d) {
    return new Date(y, m - 1, d).getDay();   // 0=周日 … 6=周六
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

// 对「已提取的 off/work 映射」做自检，返回问题描述数组（空数组 = 通过）。
function sanityProblems(off, work, year) {
    var problems = [];
    var k;

    for (k in off) {
        if (work.hasOwnProperty(k)) {
            problems.push("同一天既是放假又是补班：" + k);
        }
    }
    for (k in work) {
        var p = k.split("-");
        var dow = weekdayOf(Number(p[0]), Number(p[1]), Number(p[2]));
        if (dow !== 0 && dow !== 6) {
            problems.push("补班日 " + k + " 不在周末");
        }
    }

    // 每个节日的放假必须是一整段连续日期，且天数在合理区间
    var byName = {};
    for (k in off) {
        var n = off[k];
        if (!byName.hasOwnProperty(n)) {
            byName[n] = [];
        }
        byName[n].push(k);
    }
    for (var name in byName) {
        var ds = byName[name].slice().sort();
        for (var i = 1; i < ds.length; i++) {
            var a = ds[i - 1].split("-"), b = ds[i].split("-");
            if (dayIndex(Number(b[0]), Number(b[1]), Number(b[2]))
                    - dayIndex(Number(a[0]), Number(a[1]), Number(a[2])) !== 1) {
                problems.push(name + " 的放假区间不连续（" + ds[i - 1] + " → " + ds[i] + " 之间有断档）");
                break;
            }
        }
        var r = COUNT_RANGES[name];
        if (r && (ds.length < r[0] || ds.length > r[1])) {
            problems.push(name + " 放假 " + ds.length + " 天，超出合理区间 " + r[0] + "–" + r[1]);
        }
    }

    // 天文/政策窗口
    for (var wname in WINDOWS) {
        var hits = [];
        for (k in off) {
            if (off[k].indexOf(wname) >= 0) {
                var q = k.split("-");
                hits.push(dayIndex(Number(q[0]), Number(q[1]), Number(q[2])));
            }
        }
        if (!hits.length) {
            problems.push("缺少 " + wname + " 的数据");
            continue;
        }
        var w = WINDOWS[wname];
        var lo = dayIndex(year, w[0], w[1]);
        var hi = dayIndex(year, w[2], w[3]);
        var inside = false;
        for (var h = 0; h < hits.length; h++) {
            if (hits[h] >= lo && hits[h] <= hi) {
                inside = true;
            }
        }
        if (!inside) {
            problems.push(wname + " 不落在天文窗口内");
        }
    }
    for (var iname in INCLUDE_DATES) {
        var list = INCLUDE_DATES[iname];
        for (var j = 0; j < list.length; j++) {
            var key = year + "-" + pad2(list[j][0]) + "-" + pad2(list[j][1]);
            var found = false;
            for (k in off) {
                if (k === key && off[k].indexOf(iname) >= 0) {
                    found = true;
                }
            }
            // 只有该节日存在时才要求包含法定日（避免对数据缺失的年份误报）
            var hasHoliday = false;
            for (k in off) {
                if (off[k].indexOf(iname) >= 0) {
                    hasHoliday = true;
                }
            }
            if (hasHoliday && !found) {
                problems.push(iname + " 未包含 " + list[j][0] + " 月 " + list[j][1] + " 日");
            }
        }
    }

    var total = 0;
    for (k in off) {
        total++;
    }
    if (total < 20 || total > 40) {
        problems.push("全年放假 " + total + " 天，不在合理区间 20–40 天");
    }
    return problems;
}

// 校验一份数据源 payload。
// 返回 { ok, error, notPublished, off, work, papers }
//   notPublished = true 表示「该年份的数据源只有占位文件」，这是**预期内的正常状态**
//   （放假安排逐年发布），调用方应据此给出中性提示而非报错。
function validatePayload(payload, year) {
    var fail = function (msg, notPublished) {
        return { ok: false, error: msg, notPublished: notPublished === true,
                 off: {}, work: {}, papers: [] };
    };

    if (!payload || typeof payload !== "object") {
        return fail("返回内容不是 JSON 对象");
    }
    if (Number(payload.year) !== Number(year)) {
        return fail("请求 " + year + " 年，返回的却是 " + payload.year);
    }
    var days = payload.days;
    if (!days || !days.length) {
        return fail("数据源里 " + year + ".json 的 days 为空", true);
    }

    var off = {}, work = {}, papers = [];
    for (var i = 0; i < days.length; i++) {
        var d = days[i];
        if (!d || d.name === undefined || d.date === undefined || d.isOffDay === undefined) {
            return fail("第 " + (i + 1) + " 条记录缺少字段（需要 name/date/isOffDay）");
        }
        var ds = String(d.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
            return fail("日期格式异常：" + ds);
        }
        if (ds.substring(0, 4) !== String(year)) {
            continue;                       // 跨年的补班记录先忽略
        }
        if (d.isOffDay) {
            off[ds] = String(d.name);
        } else {
            work[ds] = String(d.name);
        }
    }
    if (payload.papers && payload.papers.length) {
        papers = payload.papers;
    }

    var problems = sanityProblems(off, work, Number(year));
    if (problems.length) {
        return fail("数据未通过自检：" + problems.join("；"));
    }
    // 数据源应标注政府网通知原文；没标注不算错，但要让调用方能看到
    var hasPaper = false;
    for (var p = 0; p < papers.length; p++) {
        if (String(papers[p]).indexOf("gov.cn") >= 0) {
            hasPaper = true;
        }
    }
    return { ok: true, error: "", off: off, work: work, papers: papers, hasOfficialSource: hasPaper };
}

/* ------------------------------------------------------------------ *
 * 缓存（存放于组件配置的字符串）
 * ------------------------------------------------------------------ */

// 解析缓存串；结构不合法则返回空缓存（静默降级，不抛异常）
function parseCache(str) {
    var empty = { years: {}, checkedAt: "", networkTime: "" };
    if (!str) {
        return empty;
    }
    var obj;
    try {
        obj = JSON.parse(str);
    } catch (e) {
        return empty;
    }
    if (!obj || typeof obj !== "object" || !obj.years || typeof obj.years !== "object") {
        return empty;
    }
    // 逐个年份做结构校验，坏数据直接丢弃
    var clean = {};
    for (var y in obj.years) {
        var e = obj.years[y];
        if (/^\d{4}$/.test(y) && e && typeof e.off === "object" && typeof e.work === "object") {
            clean[y] = { off: e.off, work: e.work };
        }
    }
    return {
        years: clean,
        checkedAt: typeof obj.checkedAt === "string" ? obj.checkedAt : "",
        networkTime: typeof obj.networkTime === "string" ? obj.networkTime : ""
    };
}

function serializeCache(cache) {
    return JSON.stringify({
        years: cache.years || {},
        checkedAt: cache.checkedAt || "",
        networkTime: cache.networkTime || ""
    });
}

// 把某个年份的数据并入缓存，返回新的缓存对象
function mergeYear(cache, year, off, work) {
    var years = {};
    for (var y in (cache.years || {})) {
        years[y] = cache.years[y];
    }
    years[String(year)] = { off: off, work: work };
    return {
        years: years,
        checkedAt: cache.checkedAt || "",
        networkTime: cache.networkTime || ""
    };
}

// 内置数据已覆盖的年份 + 缓存已覆盖的年份 = 无需再拉取的年份。
// builtinYears 由调用方传入（holidays.js 的 COVERED_YEARS）。
function coveredYears(cache, builtinYears) {
    var out = {};
    var list = builtinYears || [];
    for (var i = 0; i < list.length; i++) {
        out[String(list[i])] = true;
    }
    for (var y in (cache.years || {})) {
        out[y] = true;
    }
    return out;
}

// 时间基准年份：优先用上一次联网取回的**服务端时间**，其次才用本机时钟。
// 这样即使有人把系统时间改到 2030 年或 2020 年，也只会影响「还没联网过」的那一次，
// 一旦成功联网过，判断依据就固定为网络时间。
function referenceYear(cache, localNow) {
    var t = cache && cache.networkTime ? new Date(cache.networkTime) : null;
    if (t && !isNaN(t.getTime())) {
        return t.getFullYear();
    }
    return localNow.getFullYear();
}

// 本机时钟与网络时间的偏差（天）。无网络时间参考时返回 null。
function clockSkewDays(cache, localNow) {
    var t = cache && cache.networkTime ? new Date(cache.networkTime) : null;
    if (!t || isNaN(t.getTime())) {
        return null;
    }
    return Math.round((localNow.getTime() - t.getTime()) / 86400000);
}

// 需要联网获取的年份：从「最新已覆盖年份 + 1」一直排到「次年」，
// 因此中途遗漏的年份都会被补回来。
//
// 早期版本写死为 [当年, 次年]，会漏掉「某年忘记更新」的情形：例如 2027 年
// 没更新、2028 年 1 月才点，旧规则只取 2028/2029，2027 永远不会被补齐。
//
// 返回按**优先级**排序的完整列表（不截断），由调用方按 MAX_YEARS_PER_RUN 分批：
//   第一优先：当年、次年            —— 最要紧，必须最先拿到
//   第二优先：中间空档，由新到旧      —— 补得上最好，补不上也不影响前面
//
// 「空档排在后面」是刻意的：某些年份的数据源可能永远不存在（该补不回来），
// 若按由旧到新排序，这些空档会一直占着每次的配额，把当年的数据挤掉。
function yearsToFetch(cache, now, builtinYears) {
    var covered = coveredYears(cache, builtinYears);
    var refYear = referenceYear(cache, now);
    var newest = 0;
    for (var y in covered) {
        var n = Number(y);
        if (n > newest) {
            newest = n;
        }
    }

    var essential = [];
    for (var e = refYear; e <= refYear + 1; e++) {
        if (!covered.hasOwnProperty(String(e))) {
            essential.push(e);
        }
    }

    // 空档：从最新已覆盖年份往后到当年之前。完全没有已知数据时（内置表与缓存
    // 都为空）兜底覆盖最近两年，避免从 1 年一路排到今年。
    var start = newest > 0 ? newest + 1 : Math.max(1, refYear - 1);
    var gaps = [];
    for (var g = start; g < refYear; g++) {
        gaps.push(g);
    }
    gaps.reverse();                     // 由新到旧

    return essential.concat(gaps);
}

// 距上次检查是否已超过间隔。用时间基准年份对齐后再比较，
// 避免本机时钟被改动导致「永远不检查」或「每次启动都检查」。
function shouldAutoCheck(cache, now) {
    if (!cache.checkedAt) {
        return true;
    }
    var last = new Date(cache.checkedAt);
    if (isNaN(last.getTime())) {
        return true;
    }
    var ref = cache && cache.networkTime ? new Date(cache.networkTime) : null;
    if (!ref || isNaN(ref.getTime())) {
        ref = now;                      // 没有网络时间参考时才用本机时钟
    }
    var days = (ref.getTime() - last.getTime()) / 86400000;
    return days >= AUTO_CHECK_INTERVAL_DAYS;
}

/* ------------------------------------------------------------------ *
 * 联网拉取
 * ------------------------------------------------------------------ */

function hostOf(url) {
    var m = /^https?:\/\/([^\/]+)/.exec(url);
    return m ? m[1] : url;
}

function countKeys(obj) {
    var n = 0;
    for (var k in obj) {
        n++;
    }
    return n;
}

// 单次 HTTP GET，回调 (status, parsedJsonOrNull, serverTimeIso 或 "")。
// XMLHttpRequest 在 .pragma library 脚本里同样可用（已实测）。
//
// serverTimeIso 取自响应的 Date 头（CORS 安全头，跨域也可读），用于绕开
// 「本机时钟被改动」带来的判断偏差——年份该取哪些只依赖网络时间。
function fetchJson(url, onDone) {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
            return;
        }
        var parsed = null;
        try {
            parsed = JSON.parse(xhr.responseText);
        } catch (e) {
            parsed = null;
        }
        var serverTime = "";
        try {
            var h = xhr.getResponseHeader("Date");
            if (h) {
                var d = new Date(h);
                if (!isNaN(d.getTime())) {
                    serverTime = d.toISOString();
                }
            }
        } catch (e) { }
        onDone(xhr.status, parsed, serverTime);
    };
    xhr.open("GET", url, true);
    xhr.timeout = 15000;
    xhr.ontimeout = function () {
        onDone(0, null, "");        // 0 = 超时/传输失败
    };
    xhr.onerror = function () {
        onDone(0, null, "");
    };
    xhr.send();
}

// 拉取并校验需要更新的年份。
//   onProgress(text) —— 过程反馈（可为 null）
//   onDone(result)   —— 结束时调用一次：
//        { cache, fetched:[年份], failed:[年份], messages:[每步结果] }
// 任一源返回的、通过校验的数据才会被采用；未通过的会记录原因并尝试下一个源。
function runUpdate(cache, now, builtinYears, onProgress, onDone) {
    var progress = onProgress || function () {};
    var result = { cache: cache, fetched: [], failed: [], notPublished: [],
                   remaining: 0, messages: [] };
    var all = yearsToFetch(cache, now, builtinYears);
    var refYear = referenceYear(cache, now);
    var observedNetworkTime = "";
    var years = all.slice(0, MAX_YEARS_PER_RUN);
    result.remaining = all.length - years.length;

    if (!years.length) {
        result.messages.push("已是最新：内置数据与缓存已覆盖 " + now.getFullYear()
                             + " 年及次年，无需联网更新");
        onDone(result);
        return;
    }

    var yi = 0;

    function nextYear() {
        if (yi >= years.length) {
            if (result.remaining > 0) {
                result.messages.push("还有 " + result.remaining
                    + " 个年份的数据待获取，请再点一次「立即更新」继续。");
            }
            var netTime = observedNetworkTime || cache.networkTime || "";
            // 本机时钟与网络时间明显不符时说明一句：年份判断已改用网络时间，
            // 本机时间不准不会影响更新。
            if (observedNetworkTime) {
                var skew = Math.round((now.getTime()
                    - new Date(observedNetworkTime).getTime()) / 86400000);
                if (Math.abs(skew) >= 2) {
                    result.messages.push("提示：本机时间与网络时间相差约 " + Math.abs(skew)
                        + " 天，年份判断已改用网络时间（本机时间不准不影响更新）。");
                }
            }
            result.cache = {
                years: result.cache.years,
                checkedAt: now.toISOString(),
                networkTime: netTime
            };
            onDone(result);
            return;
        }
        var year = years[yi];
        var urls = urlsFor(year);
        var ui = 0;
        var sawNotPublished = false;      // 是否见过「只有占位文件」的源
        var reasons = [];                 // 各源的失败原因，最后汇总成一条

        function tryUrl() {
            if (ui >= urls.length) {
                if (sawNotPublished) {
                    // 预期内的正常状态：给出中性说明，不算失败
                    result.notPublished.push(year);
                    if (year < refYear) {
                        // 过去的年份数据源里没有 —— 补不上也没关系，明确告知，
                        // 避免看起来像每次更新都在出错。
                        result.messages.push(
                            year + " 年：数据源中不存在，已跳过（不影响其它年份）");
                    } else {
                        result.messages.push(
                            year + " 年：放假安排尚未发布（通常在上一年 11 月上旬公布）");
                    }
                } else {
                    result.failed.push(year);
                    result.messages.push(year + " 年：更新失败 — " + reasons.join("；"));
                }
                yi += 1;
                nextYear();
                return;
            }
            var url = urls[ui];
            progress("正在获取 " + year + " 年数据…（源 " + (ui + 1) + "/" + urls.length + "）");
            fetchJson(url, function (status, payload, serverTime) {
                if (serverTime && !observedNetworkTime) {
                    observedNetworkTime = serverTime;
                }
                if (status !== 200) {
                    // 404 表示该年份的文件还不存在 —— 与「只有占位文件」同义，
                    // 都是「尚未发布」这一预期内的状态，不该标成失败。
                    if (status === 404) {
                        sawNotPublished = true;
                    }
                    reasons.push("HTTP " + status + "（" + hostOf(url) + "）");
                    ui += 1;
                    tryUrl();
                    return;
                }
                var v = validatePayload(payload, year);
                if (!v.ok) {
                    if (v.notPublished) {
                        sawNotPublished = true;
                    }
                    reasons.push(v.error + "（" + hostOf(url) + "）");
                    ui += 1;
                    tryUrl();
                    return;
                }
                result.cache = mergeYear(result.cache, year, v.off, v.work);
                result.fetched.push(year);
                result.messages.push(year + " 年：已更新（放假 " + countKeys(v.off)
                    + " 天、补班 " + countKeys(v.work) + " 天）"
                    + (v.hasOfficialSource ? "，数据源自带政府网通知链接" : "，⚠ 数据源未标注政府网原文，请自行核实"));
                yi += 1;
                nextYear();
            });
        }
        tryUrl();
    }
    nextYear();
}

/* ------------------------------------------------------------------ *
 * 查询：缓存优先，其次内置数据
 * ------------------------------------------------------------------ */

// 只查「联网获取的缓存」，命中返回 { type, name, source: "cache" }，否则 null。
// 内置数据的兜底由调用方负责（qml 里写 `HolidaysNet.statusFromCache(...) || Holidays.statusFor(...)`），
// 这样本文件与 holidays.js 完全解耦。
function statusFromCache(y, m, d, cache) {
    var key = y + "-" + pad2(m) + "-" + pad2(d);
    var c = cache && cache.years ? cache.years[String(y)] : null;
    if (!c) {
        return null;
    }
    if (c.off && c.off.hasOwnProperty(key)) {
        return { type: "off", name: c.off[key], source: "cache" };
    }
    if (c.work && c.work.hasOwnProperty(key)) {
        return { type: "work", name: c.work[key], source: "cache" };
    }
    return null;
}
