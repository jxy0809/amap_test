(function () {
  var STORAGE = "amap-release-gate-v1";
  var ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  var SPI = "/standard/advertiser/leadsCollect";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE)) || {};
    } catch (e) {
      return {};
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE, JSON.stringify(state));
  }

  function rid(n) {
    var s = "";
    var bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    for (var i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
    return s;
  }

  var state = load();
  if (!state.probeId || !/^tsk_amap_[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(state.probeId)) {
    state.probeId = "tsk_amap_" + rid(8);
  }
  state.r008 = state.r008 || {};
  state.r021 = state.r021 || {};
  state.r009 = state.r009 || {};
  state.captures = state.captures || [];
  state.tab = state.tab || "path";

  var base = window.__GATE_BASE || "/";
  var origin = location.origin;
  var gateway = origin + base.replace(/\/$/, "") + "/" + state.probeId;
  var full = gateway + SPI;
  var rest = location.pathname.indexOf(base) === 0
    ? location.pathname.slice(base.length)
    : location.pathname.replace(/^\//, "");
  var captured = rest && rest !== "index.html" && rest !== "404.html";

  if (captured) {
    state.captures.unshift({
      at: new Date().toISOString(),
      path: location.pathname + location.search,
      referrer: document.referrer || ""
    });
    state.captures = state.captures.slice(0, 20);
    state.tab = "path";
    save(state);
  }

  function statusOf(key) {
    var v = (state[key] && state[key].verdict) || "";
    if (v === "pass") return "ok";
    if (v === "fail") return "bad";
    if (v === "warn") return "warn";
    return "open";
  }

  function labelOf(key) {
    var map = { pass: "通过", fail: "未通过", warn: "待补证", "": "未测" };
    return map[(state[key] && state[key].verdict) || ""] || "未测";
  }

  function norm(url) {
    return (url || "").trim().replace(/\/+$/, "");
  }

  function judgeEcho(raw) {
    var text = (raw || "").trim();
    if (!text) return { verdict: "", title: "还没有回显", detail: "把高德测试网关刷新后的地址贴到上面。" };
    var n = norm(text);
    var hostOnly = norm(origin);
    var siteRoot = norm(origin + base.replace(/\/$/, ""));
    if (n === hostOnly || n === siteRoot || n === hostOnly + base.replace(/\/$/, "")) {
      return {
        verdict: "fail",
        title: "回显被截成纯域名",
        detail: "高德没有保留 /" + state.probeId + "。创建页不能只展示「域名 + 任务段」，上线前这条方案不成立。"
      };
    }
    if (text !== n && n === norm(gateway)) {
      return {
        verdict: "warn",
        title: "路径还在，但多了末尾斜杠",
        detail: "任务段没被截掉。创建页约定不带末尾 /，填进去之前去掉斜杠，再刷新一次确认高德是否自己又加回去。"
      };
    }
    if (n === norm(gateway)) {
      return {
        verdict: "pass",
        title: "回显保留了任务段",
        detail: "测试网关接受「域名 + /" + state.probeId + "」且没有末尾斜杠。这只证明控制台回显没截断；联调时仍要用真实推送确认高德 POST 的就是这条地址。"
      };
    }
    if (n.indexOf(state.probeId) >= 0 && n.indexOf("leadsCollect") >= 0) {
      return {
        verdict: "warn",
        title: "回显带上了 SPI 后段",
        detail: "高德没有截断，但把 /standard/advertiser/leadsCollect 也存进去了。创建页只应填写网关段。请改回只含任务段的地址再刷新。"
      };
    }
    if (n.indexOf(state.probeId) >= 0) {
      return {
        verdict: "warn",
        title: "任务段还在，但和预期不完全一致",
        detail: "预期是 " + gateway + "。请对照多出来或少掉的部分，确认不是高德改写了路径。"
      };
    }
    return {
      verdict: "fail",
      title: "回显里没有任务段",
      detail: "粘贴的地址不含 " + state.probeId + "。若这是高德刷新后的原文，带路径的网关方案不成立。"
    };
  }

  function judgeBody(raw) {
    var text = (raw || "").trim();
    if (!text) return { verdict: "", title: "还没有应答", detail: "把联调时高德收到的响应体贴到上面，或点下面的示例填入。" };
    var json;
    try { json = JSON.parse(text); } catch (e) {
      return { verdict: "warn", title: "不是 JSON", detail: "高德若把这段当失败，会按重推规则再打。请贴原始 body。" };
    }
    var code = json && json.response && json.response.code;
    var data = json && json.response && json.response.data;
    if (code === "10000" && data && data.result === true && !data.advertiserId) {
      return {
        verdict: "pass",
        title: "落在成功示例：data.result = true",
        detail: "和 SPI 手册成功示例一致，也和当前实现一致。请再看高德是否就此停止重推。若它仍重推，改判失败并改走参数表结构。"
      };
    }
    if (data && (data.advertiserId || data.data)) {
      return {
        verdict: "fail",
        title: "落在参数表结构，不是当前实现",
        detail: "响应把 advertiserId 放进了 data。当前代码按成功示例只回 result:true。若高德只认这一种，上线前要改应答。"
      };
    }
    if (typeof data === "string") {
      return {
        verdict: "warn",
        title: "data 是字符串",
        detail: "可能仍是加密串。成功示例是对象。确认高德验这个应答时是否解密 data。"
      };
    }
    if (code === 10000 || code === "40004") {
      return {
        verdict: "warn",
        title: "有业务码，但 data 对不上示例",
        detail: "code=" + code + "。对照成功示例看 data 里有没有 result:true，并记录高德有没有重推。"
      };
    }
    return { verdict: "warn", title: "认不出结构", detail: "保留原文，联调时让高德指出它读取的字段。" };
  }

  function toast(msg) {
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1600);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("已复制"); }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("已复制"); } catch (e) { toast("复制失败"); }
    ta.remove();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function report() {
    function line(id, title) {
      var item = state[id] || {};
      return "- " + title + "：" + (labelOf(id)) + (item.note ? "\n  - 备注：" + item.note : "") + (item.echo ? "\n  - 回显：`" + item.echo + "`" : "") + (item.body ? "\n  - 应答：已记录" : "");
    }
    return [
      "# 高德客资上线前三项",
      "",
      "- 探针：`" + state.probeId + "`",
      "- 测试网关：`" + gateway + "`",
      "- 时间：" + new Date().toISOString(),
      "",
      line("r008", "R-008 网关能否带路径"),
      line("r021", "R-021 成功应答 data 结构"),
      line("r009", "R-009 生产网关不可改"),
      "",
      state.captures.length ? "- 本站捕获到的打开路径：" + state.captures.map(function (c) { return "`" + c.path + "`"; }).join("、") : "- 本站尚未捕获打开路径"
    ].join("\n");
  }

  function render() {
    var echoJudge = judgeEcho(state.r008.echo);
    var bodyJudge = judgeBody(state.r021.body);
    if (state.r021.retry === "yes") {
      bodyJudge = {
        verdict: "fail",
        title: "高德仍在重推",
        detail: bodyJudge.verdict === "pass"
          ? "响应已是 data.result=true，它仍重推，这套结构不能上线。"
          : bodyJudge.detail
      };
    } else if (state.r021.retry === "no" && bodyJudge.verdict === "pass") {
      bodyJudge = {
        verdict: "pass",
        title: "示例结构已被接受",
        detail: "响应是 data.result=true，且高德没有继续重推。"
      };
    } else if (bodyJudge.verdict === "pass") {
      bodyJudge = {
        verdict: "warn",
        title: "结构符合成功示例",
        detail: "还差一步：确认高德收到后不再重推。没确认之前不要当成通过。"
      };
    }
    var app = document.getElementById("app");
    var captureHtml = "";
    if (captured) {
      var hit = location.pathname.indexOf(state.probeId) >= 0;
      captureHtml = '<div class="banner"><strong>' + (hit ? "这条打开路径带有任务段" : "这条打开路径没有任务段") + '</strong>'
        + '<div class="mono">' + esc(location.pathname + location.search) + '</div>'
        + '<p class="muted" style="margin:8px 0 0">这是浏览器地址栏，不是高德 POST 正文。Pages 收不到 POST body。能用来证明的是：高德若把网关当成可打开的链接，路径有没有被它自己截掉。</p></div>';
    }

    app.innerHTML = ''
      + '<div class="wrap">'
      + '<header class="top"><div><h1>上线前三项确认</h1>'
      + '<p class="sub">给测试网关、联调应答、前端文案各留一条记录。结论存在这个浏览器里，可导出。不要把生产网关填到本页。</p></div></header>'
      + '<div class="pills">'
      + pill("R-008 路径", statusOf("r008"), labelOf("r008"))
      + pill("R-021 应答", statusOf("r021"), labelOf("r021"))
      + pill("R-009 锁定", statusOf("r009"), labelOf("r009"))
      + '</div>'
      + captureHtml
      + '<div class="tabs">'
      + tabBtn("path", "① 网关路径")
      + tabBtn("response", "② 成功应答")
      + tabBtn("lock", "③ 生产不可改")
      + '</div>'
      + panel()
      + '<div class="foot"><button class="btn" id="export">导出记录</button>'
      + '<button class="btn ghost" id="reset">换一个探针编号</button></div>'
      + '</div>';

    bind();

    function pill(name, kind, text) {
      return '<span class="pill"><i class="dot ' + kind + '"></i>' + name + ' · ' + text + '</span>';
    }
    function tabBtn(id, text) {
      return '<button type="button" data-tab="' + id + '"' + (state.tab === id ? ' class="on"' : '') + '>' + text + '</button>';
    }
    function panel() {
      if (state.tab === "response") return responsePanel();
      if (state.tab === "lock") return lockPanel();
      return pathPanel();
    }
    function pathPanel() {
      return '<section class="card"><h2>填进高德测试网关的地址</h2>'
        + '<p class="muted">末尾不要斜杠，也不要拼 SPI。高德若认「域名 + 路径」，保存后再刷新，回显应与下面第一行一致。</p>'
        + '<span class="label">测试网关（只填这一行）</span><div class="url mono" id="gw">' + esc(gateway) + '</div>'
        + '<div class="row" style="margin-top:8px"><button class="btn primary" id="copy-gw">复制测试网关</button></div>'
        + '<span class="label">高德自己会拼的后段（不要填进网关）</span><div class="url mono">' + esc(full) + '</div>'
        + '</section>'
        + '<section class="card"><h2>刷新后的回显</h2>'
        + '<ol><li>只在测试网关粘贴上面的地址，点生效配置。</li><li>刷新高德页面，把网关输入框里现在的值贴下来。</li><li>生产网关不要动。</li></ol>'
        + '<span class="label">高德回显</span><textarea id="echo" placeholder="粘贴刷新后的网关地址">' + esc(state.r008.echo || "") + '</textarea>'
        + '<div class="row" style="margin-top:8px">'
        + '<button class="btn" data-fill="keep">填入：路径还在</button>'
        + '<button class="btn" data-fill="cut">填入：被截成域名</button>'
        + '<button class="btn" data-fill="slash">填入：多了斜杠</button>'
        + '</div>'
        + verdictBox(echoJudge)
        + '<span class="label">备注</span><input id="echo-note" type="text" value="' + esc(state.r008.note || "") + '" placeholder="谁在哪套测试网关看的、截图放哪">'
        + '</section>'
        + (state.captures.length ? '<section class="card"><h2>本站看到的打开记录</h2><ul>'
          + state.captures.slice(0, 5).map(function (c) {
            return '<li class="mono">' + esc(c.at.slice(0, 19)) + ' ' + esc(c.path) + '</li>';
          }).join("") + '</ul><p class="muted">高德的客资推送是 POST。这里只可能留下别人用浏览器打开这条 URL 时的路径。</p></section>' : '');
    }
    function responsePanel() {
      var sampleOk = JSON.stringify({ response: { code: "10000", msg: "success", data: { result: true } } }, null, 2);
      var sampleDoc = JSON.stringify({ response: { code: "10000", msg: "success", data: { advertiserId: "…", data: { result: true } } } }, null, 2);
      return '<section class="card"><h2>文档两套说法</h2>'
        + '<p>成功示例写 <code>data.result = true</code>。参数表又写 data 里还有 advertiserId。当前实现跟成功示例。联调用高德是否停推来裁决。</p>'
        + '<div class="grid2"><div><span class="label">成功示例（当前实现）</span><pre class="schema">' + esc(sampleOk) + '</pre></div>'
        + '<div><span class="label">参数表（若高德实际读这个）</span><pre class="schema">' + esc(sampleDoc) + '</pre></div></div>'
        + '</section>'
        + '<section class="card"><h2>联调时高德侧看到的响应</h2>'
        + '<textarea id="body" placeholder="粘贴响应 JSON">' + esc(state.r021.body || "") + '</textarea>'
        + '<div class="row" style="margin-top:8px">'
        + '<button class="btn" id="fill-ok">填入成功示例</button>'
        + '<button class="btn" id="fill-doc">填入参数表结构</button>'
        + '</div>'
        + verdictBox(bodyJudge)
        + '<span class="label">高德之后有没有重推</span>'
        + '<div class="row">'
        + '<button class="btn' + (state.r021.retry === "no" ? " primary" : "") + '" data-retry="no">没有重推</button>'
        + '<button class="btn' + (state.r021.retry === "yes" ? " primary" : "") + '" data-retry="yes">仍在重推</button>'
        + '<button class="btn' + (state.r021.retry === "unknown" ? " primary" : "") + '" data-retry="unknown">还没看到</button>'
        + '</div>'
        + '<span class="label">备注</span><input id="body-note" type="text" value="' + esc(state.r021.note || "") + '" placeholder="哪一次推送、leadId、高德同学怎么说">'
        + '</section>';
    }
    function lockPanel() {
      return '<section class="card"><h2>给前端的说明</h2>'
        + '<div class="quote"><p>商家网关地址由系统分配。填进高德并生效之后，生产地址不能在高德后台自行修改，只能线下找高德改。</p>'
        + '<p>请先把测试网关跑通，再把同一条路径规则用到生产。删除这边的任务，不会改回高德已经生效的地址。</p></div>'
        + '<div class="row"><button class="btn primary" id="copy-copy">复制这段说明</button></div>'
        + '<label class="check"><input type="checkbox" id="acked"' + (state.r009.acked ? " checked" : "") + '>前端展示会带上「生产网关生效后不可自行修改」</label>'
        + '<span class="label">确认人</span><input id="who" type="text" value="' + esc(state.r009.who || "") + '" placeholder="姓名">'
        + verdictBox(state.r009.acked
          ? { verdict: "pass", title: "前端文案已确认", detail: "生产网关仍不要拿来做这次路径实验。" }
          : { verdict: "", title: "还没确认", detail: "勾选上面一项，表示详情页或编辑页会讲清楚锁死规则。" })
        + '</section>';
    }
    function verdictBox(j) {
      var kind = j.verdict === "pass" ? "ok" : j.verdict === "fail" ? "bad" : j.verdict === "warn" ? "warn" : "open";
      return '<div class="verdict ' + kind + '"><strong>' + esc(j.title) + '</strong><div>' + esc(j.detail) + '</div></div>';
    }
  }

  function persistEcho() {
    var j = judgeEcho(state.r008.echo);
    state.r008.verdict = j.verdict;
    if (j.verdict === "pass" && state.r008.retryWait) delete state.r008.retryWait;
    save(state);
  }

  function persistBody() {
    var j = judgeBody(state.r021.body);
    if (state.r021.retry === "yes" && j.verdict === "pass") j = { verdict: "fail", title: j.title, detail: j.detail };
    if (state.r021.retry === "yes") {
      state.r021.verdict = "fail";
    } else if (state.r021.retry === "no" && j.verdict === "pass") {
      state.r021.verdict = "pass";
    } else {
      state.r021.verdict = j.verdict === "pass" ? "warn" : j.verdict;
    }
    save(state);
  }

  function bind() {
    document.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.onclick = function () { state.tab = btn.getAttribute("data-tab"); save(state); render(); };
    });
    var echo = document.getElementById("echo");
    if (echo) {
      echo.oninput = function () { state.r008.echo = echo.value; persistEcho(); };
      echo.onchange = function () { render(); };
    }
    var echoNote = document.getElementById("echo-note");
    if (echoNote) echoNote.oninput = function () { state.r008.note = echoNote.value; save(state); };
    document.querySelectorAll("[data-fill]").forEach(function (btn) {
      btn.onclick = function () {
        var kind = btn.getAttribute("data-fill");
        if (kind === "keep") state.r008.echo = gateway;
        if (kind === "cut") state.r008.echo = origin;
        if (kind === "slash") state.r008.echo = gateway + "/";
        persistEcho();
        render();
      };
    });
    var copyGw = document.getElementById("copy-gw");
    if (copyGw) copyGw.onclick = function () { copy(gateway); };
    var body = document.getElementById("body");
    if (body) {
      body.oninput = function () { state.r021.body = body.value; persistBody(); };
      body.onchange = function () { render(); };
    }
    var fillOk = document.getElementById("fill-ok");
    if (fillOk) fillOk.onclick = function () {
      state.r021.body = JSON.stringify({ response: { code: "10000", msg: "success", data: { result: true } } }, null, 2);
      persistBody(); render();
    };
    var fillDoc = document.getElementById("fill-doc");
    if (fillDoc) fillDoc.onclick = function () {
      state.r021.body = JSON.stringify({ response: { code: "10000", msg: "success", data: { advertiserId: "demo", data: { result: true } } } }, null, 2);
      persistBody(); render();
    };
    document.querySelectorAll("[data-retry]").forEach(function (btn) {
      btn.onclick = function () { state.r021.retry = btn.getAttribute("data-retry"); persistBody(); render(); };
    });
    var bodyNote = document.getElementById("body-note");
    if (bodyNote) bodyNote.oninput = function () { state.r021.note = bodyNote.value; save(state); };
    var copyCopy = document.getElementById("copy-copy");
    if (copyCopy) copyCopy.onclick = function () {
      copy("商家网关地址由系统分配。填进高德并生效之后，生产地址不能在高德后台自行修改，只能线下找高德改。请先把测试网关跑通，再把同一条路径规则用到生产。删除这边的任务，不会改回高德已经生效的地址。");
    };
    var acked = document.getElementById("acked");
    if (acked) acked.onchange = function () {
      state.r009.acked = acked.checked;
      state.r009.verdict = acked.checked ? "pass" : "";
      save(state); render();
    };
    var who = document.getElementById("who");
    if (who) who.oninput = function () { state.r009.who = who.value; state.r009.note = who.value; save(state); };
    document.getElementById("export").onclick = function () { copy(report()); };
    document.getElementById("reset").onclick = function () {
      state.probeId = "tsk_amap_" + rid(8);
      state.r008 = {};
      state.captures = [];
      save(state);
      if (captured) location.href = base;
      else render();
    };
  }

  if (state.r008.echo) persistEcho();
  if (state.r021.body || state.r021.retry) persistBody();
  if (state.r009.acked) state.r009.verdict = "pass";
  render();
})();
