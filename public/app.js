const POLL_MS = 20_000;

const elements = {
  postList: document.querySelector("#postList"),
  postViewer: document.querySelector("#postViewer"),
  viewerPane: document.querySelector(".viewer-pane"),
  statusText: document.querySelector("#statusText"),
  lastUpdated: document.querySelector("#lastUpdated"),
  refreshButton: document.querySelector("#refreshButton"),
  autoRefresh: document.querySelector("#autoRefresh"),
  notificationToggle: document.querySelector("#notificationToggle")
};

const state = {
  posts: [],
  selectedNo: null,
  currentArticleData: null,
  currentArticleLabel: null,
  isSavingLabel: false,
  labelStats: null,
  knownNos: new Set(JSON.parse(localStorage.getItem("knownPostNos") || "[]")),
  unreadNos: new Set(JSON.parse(localStorage.getItem("unreadPostNos") || "[]")),
  notificationsEnabled: localStorage.getItem("notificationsEnabled") === "true",
  firstLoad: true,
  timer: null
};

function riskLevelLabel(level = "low") {
  switch (level) {
    case "critical":
      return "매우 높음";
    case "high":
      return "높음";
    case "medium":
      return "주의";
    default:
      return "낮음";
  }
}

function riskBadgeText(risk) {
  if (!risk) return "";
  if (risk.level === "low") return "분탕 낮음";
  return `분탕 ${risk.score}%`;
}

function labelText(label) {
  switch (label) {
    case "troll":
      return "분탕글";
    case "normal":
      return "정상글";
    default:
      return "라벨 없음";
  }
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function saveKnownPosts() {
  const recent = state.posts.slice(0, 100).map((post) => post.no);
  const trimmed = [...new Set([...state.knownNos, ...recent])].slice(0, 200);
  state.knownNos = new Set(trimmed);
  localStorage.setItem("knownPostNos", JSON.stringify(trimmed));
}

function saveUnreadPosts() {
  const visibleUnread = state.posts
    .slice(0, 200)
    .map((post) => post.no)
    .filter((no) => state.unreadNos.has(no));
  state.unreadNos = new Set(visibleUnread);
  localStorage.setItem("unreadPostNos", JSON.stringify(visibleUnread));
}

function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function saveNotificationPreference() {
  localStorage.setItem("notificationsEnabled", String(state.notificationsEnabled));
}

function syncNotificationToggle() {
  if (!elements.notificationToggle) return;

  const supported = isNotificationSupported();
  const granted = supported && Notification.permission === "granted";
  const denied = supported && Notification.permission === "denied";

  elements.notificationToggle.disabled = !supported || denied;
  elements.notificationToggle.checked = supported && granted && state.notificationsEnabled;
  elements.notificationToggle.title = !supported
    ? "이 브라우저는 시스템 알림을 지원하지 않습니다."
    : denied
      ? "브라우저 설정에서 알림 차단을 해제해야 합니다."
      : "새 글이 발견되면 Windows 알림을 표시합니다.";
}

async function enableNotifications() {
  if (!isNotificationSupported()) {
    state.notificationsEnabled = false;
    saveNotificationPreference();
    syncNotificationToggle();
    elements.statusText.textContent = "이 브라우저는 Windows 알림을 지원하지 않습니다.";
    return false;
  }

  if (Notification.permission === "granted") {
    state.notificationsEnabled = true;
    saveNotificationPreference();
    syncNotificationToggle();
    return true;
  }

  if (Notification.permission === "denied") {
    state.notificationsEnabled = false;
    saveNotificationPreference();
    syncNotificationToggle();
    elements.statusText.textContent = "브라우저에서 알림이 차단되어 있어 Windows 알림을 켤 수 없습니다.";
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    state.notificationsEnabled = false;
    saveNotificationPreference();
    syncNotificationToggle();
    elements.statusText.textContent = "알림 권한이 허용되지 않아 Windows 알림을 켜지 못했습니다.";
    return false;
  }

  state.notificationsEnabled = true;
  saveNotificationPreference();
  syncNotificationToggle();
  elements.statusText.textContent = "Windows 알림이 켜졌습니다.";
  return true;
}

function disableNotifications() {
  state.notificationsEnabled = false;
  saveNotificationPreference();
  syncNotificationToggle();
  elements.statusText.textContent = "Windows 알림이 꺼졌습니다.";
}

function notifyNewPosts(posts) {
  if (!posts.length || !isNotificationSupported()) return;
  if (!state.notificationsEnabled || Notification.permission !== "granted") return;

  const [firstPost] = posts;
  const title = posts.length === 1 ? `새 글: ${firstPost.title}` : `새 글 ${posts.length}개 발견`;
  const body = posts.length === 1
    ? `${firstPost.author || "익명"} · ${firstPost.date || "방금"}`
    : `${firstPost.title} 외 ${posts.length - 1}개`;
  const notification = new Notification(title, {
    body,
    tag: "dcinside-new-posts",
    renotify: true
  });

  notification.onclick = () => {
    window.focus();
    if (firstPost?.no) loadArticle(firstPost.no);
    notification.close();
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPosts() {
  elements.postList.innerHTML = state.posts
    .map((post) => {
      const isActive = post.no === state.selectedNo;
      const isNew = state.unreadNos.has(post.no);
      const category = post.category || "일반";
      const reply = post.replyCount ? `댓글 ${post.replyCount}` : "댓글 0";
      const risk = post.trollRisk;
      const userLabel = post.userLabel;
      return `
        <li class="post-item">
          <button class="post-button${isActive ? " active" : ""}" type="button" data-no="${post.no}">
            <div class="post-head">
              <span class="category">${escapeHtml(category)}</span>
              <span class="post-title">${escapeHtml(post.title)}</span>
              ${isNew ? "<span class=\"badge-new\">NEW</span>" : ""}
              ${risk ? `<span class="risk-badge risk-badge-${escapeHtml(risk.level)}">${escapeHtml(riskBadgeText(risk))}</span>` : ""}
            </div>
            <div class="post-meta">
              <span>${escapeHtml(post.author || "익명")}</span>
              <span>${escapeHtml(post.date || post.fullDate || "")}</span>
              <span>${escapeHtml(reply)}</span>
              <span>조회 ${escapeHtml(post.views || "0")}</span>
              ${userLabel ? `<span class="label-pill label-pill-${escapeHtml(userLabel)}">내 라벨: ${escapeHtml(labelText(userLabel))}</span>` : ""}
            </div>
          </button>
        </li>
      `;
    })
    .join("");
}

function renderArticle(data) {
  const { post, comments, trollRisk } = data;
  const commentItems = comments.length
    ? comments
        .map(
          (comment) => `
            <li class="comment${comment.isReply ? " reply" : ""}">
              <div class="comment-meta">
                <span class="comment-author">${escapeHtml(comment.author)}</span>
                <span>${escapeHtml(comment.date || "")}</span>
              </div>
              <div class="comment-text">${escapeHtml(comment.text)}</div>
            </li>
          `
        )
        .join("")
    : "<li class=\"comment\"><div class=\"comment-text muted\">표시할 댓글이 없습니다.</div></li>";
  const riskReasons = (trollRisk?.reasons || [])
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  const riskPanel = trollRisk ? `
    <section class="risk-panel risk-panel-${escapeHtml(trollRisk.level)}">
      <div class="risk-panel-head">
        <strong>분탕 가능성 ${escapeHtml(String(trollRisk.score))}%</strong>
        <span class="risk-level-text">${escapeHtml(riskLevelLabel(trollRisk.level))}</span>
      </div>
      <p class="risk-summary">${escapeHtml(trollRisk.summary || "")}</p>
      ${riskReasons ? `<ul class="risk-reasons">${riskReasons}</ul>` : ""}
      <p class="risk-disclaimer">이 수치는 자동 판별 점수이며 실제 판단과 다를 수 있습니다.</p>
      <div class="label-actions">
        <button class="label-button label-button-troll${state.currentArticleLabel === "troll" ? " active" : ""}" type="button" data-label="troll" ${state.isSavingLabel ? "disabled" : ""}>분탕글</button>
        <button class="label-button label-button-normal${state.currentArticleLabel === "normal" ? " active" : ""}" type="button" data-label="normal" ${state.isSavingLabel ? "disabled" : ""}>정상글</button>
        <button class="label-button label-button-clear" type="button" data-label-clear ${state.isSavingLabel ? "disabled" : ""}>라벨 취소</button>
      </div>
      <p class="label-state">현재 라벨: ${escapeHtml(labelText(state.currentArticleLabel))}</p>
      <p class="label-help">이 라벨은 이후 판별 기준 개선에 사용됩니다.</p>
    </section>
  ` : "";

  elements.postViewer.className = "";
  elements.postViewer.innerHTML = `
    <section class="article">
      <header class="article-header">
        <a class="source-link" href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noreferrer">원문 열기</a>
        <h2>${escapeHtml(post.title)}</h2>
        <div class="article-meta">
          <span>${escapeHtml(post.category || "일반")}</span>
          <span>${escapeHtml(post.author || "익명")}</span>
          <span>${escapeHtml(post.date || "")}</span>
          ${post.views ? `<span>조회 ${escapeHtml(post.views)}</span>` : ""}
          ${post.recommend ? `<span>추천 ${escapeHtml(post.recommend)}</span>` : ""}
        </div>
        ${riskPanel}
      </header>
      <div class="article-content">${post.contentHtml}</div>
      <section class="comments">
        <h3 class="comments-header">댓글 ${comments.length}</h3>
        <ol class="comment-list">${commentItems}</ol>
      </section>
    </section>
  `;
}

function renderError(message) {
  elements.postViewer.className = "";
  elements.postViewer.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function resetViewerScroll() {
  elements.viewerPane?.scrollTo({ top: 0, behavior: "auto" });
}

async function loadPosts({ manual = false } = {}) {
  if (manual) elements.statusText.textContent = "새 글을 확인하는 중";

  const response = await fetch("/api/posts?limit=50", { cache: "no-store" });
  if (!response.ok) throw new Error("게시글 목록을 가져오지 못했습니다.");
  const data = await response.json();
  const previous = state.knownNos;
  const incoming = data.posts || [];
  const newlyDiscovered = incoming.filter((post) => !previous.has(post.no));

  state.posts = incoming;

  if (!state.firstLoad) {
    for (const post of newlyDiscovered) state.unreadNos.add(post.no);
    notifyNewPosts(newlyDiscovered);
  }

  state.firstLoad = false;
  renderPosts();

  for (const post of incoming) state.knownNos.add(post.no);
  saveKnownPosts();
  saveUnreadPosts();

  elements.statusText.textContent = newlyDiscovered.length
    ? `새 글 ${newlyDiscovered.length}개 발견`
    : `최근 글 ${incoming.length}개 표시 중`;
  elements.lastUpdated.textContent = `갱신 ${formatTime(data.fetchedAt)}`;
}

async function loadArticle(no) {
  state.selectedNo = no;
  state.unreadNos.delete(no);
  saveUnreadPosts();
  renderPosts();
  resetViewerScroll();
  elements.postViewer.className = "";
  elements.postViewer.innerHTML = "<div class=\"loading\">본문과 댓글을 불러오는 중입니다.</div>";

  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(no)}`, { cache: "no-store" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || data.error || "게시글을 가져오지 못했습니다.");
    }
    const data = await response.json();
    state.currentArticleData = data;
    state.currentArticleLabel = data.userLabel || null;
    renderArticle(data);
  } catch (error) {
    renderError(error.message);
  }
}

function syncPostLabel(no, label) {
  state.posts = state.posts.map((post) => (post.no === no ? { ...post, userLabel: label } : post));
}

async function saveLabel(no, label) {
  state.isSavingLabel = true;
  if (state.currentArticleData) renderArticle(state.currentArticleData);

  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(no)}/label`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "라벨 저장에 실패했습니다.");

    state.currentArticleLabel = data.label;
    if (state.currentArticleData) state.currentArticleData.userLabel = data.label;
    syncPostLabel(no, data.label);
    renderPosts();
    if (state.currentArticleData) renderArticle(state.currentArticleData);
    elements.statusText.textContent = "라벨이 저장되었습니다.";
    loadLabelStats().catch(() => {});
  } catch (error) {
    elements.statusText.textContent = error.message;
    if (state.currentArticleData) renderArticle(state.currentArticleData);
  } finally {
    state.isSavingLabel = false;
    if (state.currentArticleData) renderArticle(state.currentArticleData);
  }
}

async function clearSavedLabel(no) {
  state.isSavingLabel = true;
  if (state.currentArticleData) renderArticle(state.currentArticleData);

  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(no)}/label`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "라벨 취소에 실패했습니다.");

    state.currentArticleLabel = null;
    if (state.currentArticleData) state.currentArticleData.userLabel = null;
    syncPostLabel(no, null);
    renderPosts();
    if (state.currentArticleData) renderArticle(state.currentArticleData);
    elements.statusText.textContent = "라벨이 취소되었습니다.";
    loadLabelStats().catch(() => {});
  } catch (error) {
    elements.statusText.textContent = error.message;
    if (state.currentArticleData) renderArticle(state.currentArticleData);
  } finally {
    state.isSavingLabel = false;
    if (state.currentArticleData) renderArticle(state.currentArticleData);
  }
}

async function loadLabelStats() {
  const response = await fetch("/api/labels/stats", { cache: "no-store" });
  if (!response.ok) throw new Error("라벨 통계를 가져오지 못했습니다.");
  state.labelStats = await response.json();
}

function startTimer() {
  clearInterval(state.timer);
  if (!elements.autoRefresh.checked) return;

  state.timer = setInterval(() => {
    loadPosts().catch((error) => {
      elements.statusText.textContent = error.message;
    });
  }, POLL_MS);
}

elements.postList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-no]");
  if (!button) return;
  loadArticle(button.dataset.no);
});

elements.postViewer.addEventListener("click", (event) => {
  const labelButton = event.target.closest("[data-label]");
  if (labelButton && state.selectedNo && !state.isSavingLabel) {
    saveLabel(state.selectedNo, labelButton.dataset.label);
    return;
  }

  const clearButton = event.target.closest("[data-label-clear]");
  if (clearButton && state.selectedNo && !state.isSavingLabel) {
    clearSavedLabel(state.selectedNo);
  }
});

elements.refreshButton.addEventListener("click", () => {
  loadPosts({ manual: true }).catch((error) => {
    elements.statusText.textContent = error.message;
  });
});

elements.autoRefresh.addEventListener("change", startTimer);
elements.notificationToggle?.addEventListener("change", async (event) => {
  if (event.target.checked) {
    const enabled = await enableNotifications();
    if (!enabled) syncNotificationToggle();
    return;
  }

  disableNotifications();
});

if (state.notificationsEnabled && isNotificationSupported() && Notification.permission !== "granted") {
  state.notificationsEnabled = false;
  saveNotificationPreference();
}
syncNotificationToggle();

loadPosts()
  .catch((error) => {
    elements.statusText.textContent = error.message;
  })
  .finally(startTimer);

loadLabelStats().catch(() => {});
