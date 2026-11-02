/* CunDrop 面板逻辑 (Aurora UI) */
const $ = (s) => document.querySelector(s);
let FILES = [], SHARES = [];
const QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // R2 免费额度 10GB

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2200);
}
function fmtSize(n) {
  n = +n || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function fmtDate(ms) {
  return new Date(+ms || 0).toLocaleString("zh-CN", { hour12: false }).slice(0, 16);
}
function kindOf(mime) {
  mime = mime || "";
  if (mime.startsWith("video")) return "video";
  if (mime.startsWith("image")) return "image";
  if (mime.startsWith("audio")) return "audio";
  return "file";
}
const fileUrl = (id, download) =>
  "/api/files/file?id=" + encodeURIComponent(id) + (download ? "&download=1" : "");
async function api(url, opt = {}) {
  const r = await fetch(url, opt);
  if (r.status === 401) { location.href = "/login.html"; throw new Error("未登录"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("请求失败 " + r.status));
  return j;
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

/* ---------- 视图切换 ---------- */
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("#view-" + b.dataset.view).classList.remove("hidden");
    if (b.dataset.view === "shares") loadShares();
    if (b.dataset.view === "settings") loadSysinfo();
  })
);

/* ---------- 文件库 ---------- */
async function loadFiles() {
  const q = $("#search").value.trim();
  const j = await api("/api/files" + (q ? "?q=" + encodeURIComponent(q) : ""));
  FILES = j.files;
  renderFiles();
  const st = await api("/api/stats");
  $("#statCount").textContent = st.count;
  $("#statSize").textContent = fmtSize(st.bytes);
  $("#statShares").textContent = st.shares;
  const pct = Math.min(100, (st.bytes / QUOTA_BYTES) * 100);
  $("#statQuota").textContent = pct.toFixed(1) + "%";
  $("#quotaBar").style.width = Math.max(pct, st.bytes > 0 ? 1.5 : 0) + "%";
}
function thumbHtml(f) {
  const kind = kindOf(f.mime);
  if (kind === "image") return `<img src="${fileUrl(f.id)}" alt="" loading="lazy">`;
  if (kind === "video")
    return `<video src="${fileUrl(f.id)}" preload="metadata" muted playsinline></video><span class="play-badge">▶ 视频</span>`;
  if (kind === "audio") return `<div class="file-icon audio"></div>`;
  return `<div class="file-icon file"></div>`;
}
function renderFiles() {
  $("#emptyFiles").classList.toggle("hidden", FILES.length > 0);
  $("#fileList").innerHTML = FILES.map((f) => `
    <div class="fcard">
      <div class="thumb" onclick="openPreview('${f.id}')">${thumbHtml(f)}</div>
      <div class="fcard-body">
        <div class="file-name" title="${escAttr(f.name)}">${esc(f.name)}</div>
        <div class="file-sub">${fmtSize(f.size)} · ${fmtDate(f.created_at)}</div>
        <div class="fcard-actions">
          <button class="btn primary" onclick="openShare('${f.id}', '${escAttr(f.name)}')">分享</button>
          <a class="btn icon-only" title="下载" href="${fileUrl(f.id, true)}">⬇</a>
          <button class="btn danger icon-only" title="删除" onclick="delFile('${f.id}')">🗑</button>
        </div>
      </div>
    </div>`).join("");
}
$("#search").addEventListener("input", () => {
  clearTimeout($("#search")._t);
  $("#search")._t = setTimeout(loadFiles, 300);
});

async function delFile(id) {
  if (!confirm("确定删除这个文件吗？R2 上的源文件也会一起删除。")) return;
  await api("/api/files?id=" + encodeURIComponent(id), { method: "DELETE" });
  toast("已删除");
  loadFiles();
}

/* ---------- 预览 ---------- */
let pvFile = null;
function openPreview(id) {
  const f = FILES.find((x) => x.id === id);
  if (!f) return;
  pvFile = f;
  const kind = kindOf(f.mime);
  $("#pvName").textContent = f.name;
  $("#pvMeta").textContent = `${fmtSize(f.size)} · ${fmtDate(f.created_at)}`;
  const box = $("#pvBox");
  if (kind === "video") box.innerHTML = `<video src="${fileUrl(f.id)}" controls playsinline autoplay></video>`;
  else if (kind === "image") box.innerHTML = `<img src="${fileUrl(f.id)}" alt="">`;
  else if (kind === "audio") box.innerHTML = `<audio src="${fileUrl(f.id)}" controls autoplay></audio>`;
  else box.innerHTML = `<div class="empty">此类型暂不支持在线预览，可直接下载。</div>`;
  $("#pvDownload").href = fileUrl(f.id, true);
  $("#previewModal").classList.remove("hidden");
}
function closePreview() {
  $("#pvBox").innerHTML = ""; // 停掉视频/音频播放并释放连接
  $("#previewModal").classList.add("hidden");
  pvFile = null;
}
$("#pvClose").onclick = closePreview;
$("#previewModal").addEventListener("click", (e) => { if (e.target.id === "previewModal") closePreview(); });
$("#pvShare").onclick = () => { if (pvFile) { const f = pvFile; closePreview(); openShare(f.id, f.name); } };

/* ---------- 上传（预签名 URL 直传 R2，带进度） ---------- */
const dz = $("#dropzone"), fi = $("#fileInput");
$("#uploadBtn").onclick = () => fi.click();
dz.onclick = () => fi.click();
["dragover", "dragenter"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", (ev) => uploadMany(ev.dataTransfer.files));
fi.addEventListener("change", () => { uploadMany(fi.files); fi.value = ""; });

async function uploadMany(files) {
  for (const f of files) uploadOne(f);
}
function uploadOne(file) {
  const box = document.createElement("div");
  box.className = "up-item";
  box.innerHTML = `<div class="up-top"><span>${esc(file.name)}</span><span class="pct">准备…</span></div><div class="up-bar"><i></i></div>`;
  $("#uploadList").prepend(box);
  const bar = box.querySelector(".up-bar i"), pct = box.querySelector(".pct");

  (async () => {
    const init = await api("/api/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || "application/octet-stream" }),
    });
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", init.upload_url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const p = Math.round((e.loaded / e.total) * 100);
          bar.style.width = p + "%"; pct.textContent = p + "%";
        }
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("R2 返回 " + xhr.status)));
      xhr.onerror = () => reject(new Error("网络错误（多为 R2 CORS 未配置）"));
      xhr.send(file);
    });
    await api("/api/files/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: init.id, r2_key: init.r2_key, name: file.name, size: file.size, mime: file.type || "application/octet-stream" }),
    });
    box.classList.add("done"); pct.textContent = "完成 ✓";
    setTimeout(() => box.remove(), 2500);
    loadFiles();
  })().catch((e) => {
    box.classList.add("error"); pct.textContent = "失败";
    toast("上传失败：" + e.message);
  });
}

/* ---------- 分享 ---------- */
let shareFileId = null;
function openShare(id, name) {
  shareFileId = id;
  $("#shareFileName").textContent = name;
  $("#shareResult").classList.add("hidden");
  $("#sharePwd").value = "";
  $("#shareViews").value = "";
  $("#shareModal").classList.remove("hidden");
}
$("#shareCancel").onclick = () => $("#shareModal").classList.add("hidden");
$("#shareCreate").onclick = async () => {
  try {
    const days = $("#shareExpire").value ? +$("#shareExpire").value : null;
    const maxViews = $("#shareViews").value ? +$("#shareViews").value : null;
    const j = await api("/api/shares", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: shareFileId,
        expires_in_days: days,
        max_views: maxViews,
        password: $("#sharePwd").value,
      }),
    });
    $("#shareUrl").value = location.origin + "/f/" + j.token;
    $("#shareResult").classList.remove("hidden");
    loadShares();
  } catch (e) { toast(e.message); }
};
$("#copyBtn").onclick = async () => {
  await navigator.clipboard.writeText($("#shareUrl").value);
  toast("链接已复制");
};

async function loadShares() {
  const j = await api("/api/shares");
  SHARES = j.shares;
  $("#emptyShares").classList.toggle("hidden", SHARES.length > 0);
  $("#shareList").innerHTML = SHARES.map((s) => {
    const exp = s.expires_at ? fmtDate(s.expires_at) + " 到期" : "永久有效";
    const gone = s.expires_at && s.expires_at < Date.now();
    const usedUp = s.max_views && s.views >= s.max_views;
    return `
    <div class="file-row">
      <div class="file-icon ${kindOf(s.mime)}"></div>
      <div class="file-info">
        <div class="file-name">${esc(s.name)}
          ${s.has_password ? '<span class="tag pwd">密码</span>' : ""}
          ${gone ? '<span class="tag exp">已过期</span>' : ""}
          ${usedUp ? '<span class="tag exp">次数用完</span>' : ""}
        </div>
        <div class="file-sub"><a href="/f/${s.token}" target="_blank">/f/${s.token}</a> · ${exp}${s.max_views ? " · 最多 " + s.max_views + " 次" : ""} · ${s.views} 次查看</div>
      </div>
      <div class="file-actions">
        <button class="btn small" onclick="copyShare('${s.token}')">复制</button>
        <button class="btn small danger" onclick="delShare('${s.token}')">删除</button>
      </div>
    </div>`;
  }).join("");
}
async function copyShare(token) {
  await navigator.clipboard.writeText(location.origin + "/f/" + token);
  toast("链接已复制");
}
async function delShare(token) {
  if (!confirm("删除这个分享链接？文件本身不受影响。")) return;
  await api("/api/shares?token=" + encodeURIComponent(token), { method: "DELETE" });
  toast("已删除"); loadShares();
}

/* ---------- 设置 ---------- */
async function loadSysinfo() {
  const box = $("#sysinfo");
  const labels = {
    ADMIN_PASSWORD: "登录密码",
    SESSION_SECRET: "会话密钥",
    CF_ACCOUNT_ID: "Cloudflare 账户 ID",
    D1_DATABASE_ID: "D1 数据库 ID",
    D1_API_TOKEN: "D1 API Token",
    R2_ACCESS_KEY_ID: "R2 Key ID",
    R2_SECRET_ACCESS_KEY: "R2 Secret",
  };
  try {
    const h = await api("/api/health");
    let html = "";
    for (const [k, label] of Object.entries(labels)) {
      html += `<div class="health-row">${h.secrets[k] ? "✅" : "❌"} ${label} <code>${k}</code></div>`;
    }
    html += `<div class="health-row">${h.d1.ok ? "✅" : "❌"} D1 数据库连接${h.d1.ok ? "" : "——" + esc(h.d1.error)}</div>`;
    html += `<div class="health-row">${h.r2.ok ? "✅" : "❌"} R2 存储桶连接${h.r2.ok ? "" : "——" + esc(h.r2.error)}</div>`;
    box.innerHTML = html;
  } catch (e) {
    box.textContent = "❌ " + e.message;
  }
}

loadFiles();
