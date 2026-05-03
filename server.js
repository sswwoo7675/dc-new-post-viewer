const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const { initDb } = require("./lib/db");
const { getLabel, getLabelsForPosts, getLabelStats, setLabel, clearLabel } = require("./lib/label-service");
const { getPostSnapshot, savePostSnapshot, savePrediction } = require("./lib/post-store");
const { analyzePostRisk, extractPlainText } = require("./lib/troll-risk");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const GALLERY_ID = process.env.GALLERY_ID || "dataprocessing";
const PREDICTOR_VERSION = "rule-v1";
const BASE_URL = "https://gall.dcinside.com";
const LIST_URL = `${BASE_URL}/mini/board/lists/?id=${encodeURIComponent(GALLERY_ID)}`;
const VIEW_URL = `${BASE_URL}/mini/board/view/?id=${encodeURIComponent(GALLERY_ID)}&no=`;
const PUBLIC_DIR = path.join(__dirname, "public");

const HEADERS = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "referer": LIST_URL,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
};

let cachedList = { fetchedAt: 0, posts: [] };
const CACHE_MS = 8_000;
const MAX_LIST_PAGES = 5;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const IMAGE_HOST_ALLOWLIST = [
  "dcinside.co.kr",
  "dcinside.com",
  "dcimg6.dcinside.co.kr",
  "image.dcinside.com",
  "nstatic.dcinside.com"
];

initDb();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendBuffer(res, status, buffer, headers = {}) {
  res.writeHead(status, headers);
  res.end(buffer);
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
    const total = chunks.reduce((sum, item) => sum + item.length, 0);
    if (total > 1024 * 1024) {
      throw new Error("Request body too large");
    }
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stripTags(html = "") {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(text = "") {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function attr(html = "", name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = html.match(pattern);
  return decodeEntities(match?.[2] || match?.[3] || match?.[4] || "");
}

function firstMatch(html = "", regex, fallback = "") {
  const match = html.match(regex);
  return match ? match[1] : fallback;
}

function extractElementInnerHtml(html = "", className = "") {
  const classPattern = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openTagRegex = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${classPattern}\\b[^"']*["'][^>]*>`, "i");
  const openMatch = openTagRegex.exec(html);
  if (!openMatch) return "";

  const start = openMatch.index + openMatch[0].length;
  let depth = 1;
  let cursor = start;
  const tagRegex = /<\/?div\b[^>]*>/gi;
  tagRegex.lastIndex = start;

  while (depth > 0) {
    const tagMatch = tagRegex.exec(html);
    if (!tagMatch) return html.slice(start);

    if (tagMatch[0][1] === "/") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, tagMatch.index);
      }
    } else {
      depth += 1;
    }

    cursor = tagRegex.lastIndex;
  }

  return html.slice(start, cursor);
}

function absolutizeUrl(url = "") {
  const clean = decodeEntities(url).trim();
  if (!clean) return "";
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("/")) return `${BASE_URL}${clean}`;
  return clean;
}

async function decodeResponse(response) {
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1];
  const candidates = [charset, "utf-8", "euc-kr", "ks_c_5601-1987"].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate).decode(buffer);
    } catch {
      // Try the next label.
    }
  }

  return Buffer.from(buffer).toString("utf8");
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`DCInside request failed (${response.status})`);
  }

  const html = await decodeResponse(response);
  if (!html.trim()) {
    throw new Error("DCInside returned an empty response");
  }

  return html;
}

function buildListUrl(page = 1) {
  const url = new URL(LIST_URL);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function inputValue(html = "", idOrName = "") {
  const byId = new RegExp(`<input\\b[^>]*\\bid=["']${idOrName}["'][^>]*>`, "i");
  const byName = new RegExp(`<input\\b[^>]*\\bname=["']${idOrName}["'][^>]*>`, "i");
  const tag = html.match(byId)?.[0] || html.match(byName)?.[0] || "";
  return attr(tag, "value");
}

function parsePosts(html) {
  const posts = [];
  const rowRegex = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let row;

  while ((row = rowRegex.exec(html))) {
    const rowAttrs = row[1];
    const body = row[2];
    const no = attr(rowAttrs, "data-no") || stripTags(firstMatch(body, /<td[^>]*class="[^"]*\bgall_num\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i));
    if (!/^\d+$/.test(no)) continue;

    const classes = attr(rowAttrs, "class");
    const rowType = attr(rowAttrs, "data-type");
    const category = stripTags(firstMatch(body, /<td[^>]*class="[^"]*\bgall_subject\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i));
    const titleCell = firstMatch(body, /<td[^>]*class="[^"]*\bgall_tit\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const titleAnchor = titleCell.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    const commentText = stripTags(firstMatch(titleCell, /<span[^>]*class="[^"]*\breply_num\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const replyCount = Number(commentText.replace(/[^\d]/g, "")) || 0;
    const writerMatch = body.match(/<td\b([^>]*\bclass="[^"]*\bgall_writer\b[^"]*"[^>]*)>([\s\S]*?)<\/td>/i);
    const writerAttrs = writerMatch?.[1] || "";
    const writerCell = writerMatch?.[2] || "";
    const writerTag = writerCell.match(/<span\b([^>]*)>/i)?.[1] || "";
    const dateCell = body.match(/<td\b([^>]*)class="[^"]*\bgall_date\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const view = stripTags(firstMatch(body, /<td[^>]*class="[^"]*\bgall_count\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i));
    const recommend = stripTags(firstMatch(body, /<td[^>]*class="[^"]*\bgall_recommend\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i));

    const title = stripTags(titleAnchor?.[2] || titleCell).replace(/\[\d+\]$/, "").trim();
    if (!title) continue;

    posts.push({
      no,
      category,
      title,
      author: attr(writerAttrs, "data-nick") || attr(writerTag, "title") || stripTags(writerCell),
      ip: attr(writerAttrs, "data-ip") || attr(writerTag, "data-ip"),
      uid: attr(writerAttrs, "data-uid") || attr(writerTag, "data-uid"),
      date: stripTags(dateCell?.[2] || ""),
      fullDate: attr(dateCell?.[1] || "", "title"),
      views: view,
      recommend,
      replyCount,
      isNotice: /\bnotice\b/.test(classes) || rowType === "icon_notice" || category === "공지",
      url: titleAnchor ? absolutizeUrl(attr(titleAnchor[1], "href")) : `${VIEW_URL}${no}`
    });
  }

  return posts.filter((post) => !post.isNotice);
}

function normalizeContentHtml(html = "", articleNo = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, " href=\"#\"")
    .replace(/\ssrc\s*=\s*["']\/\/([^"']+)["']/gi, " src=\"https://$1\"")
    .replace(/\shref\s*=\s*["']\/\/([^"']+)["']/gi, " href=\"https://$1\"")
    .replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
      const currentSrc = attr(attrs, "src");
      const lazySrc = attr(attrs, "data-original") || attr(attrs, "data-src");
      const src = absolutizeUrl(lazySrc || currentSrc);
      const alt = attr(attrs, "alt");
      const proxiedSrc = src ? buildImageProxyUrl(src, articleNo) : "";
      return proxiedSrc ? `<img src="${escapeHtml(proxiedSrc)}" alt="${escapeHtml(alt)}" loading="lazy">` : "";
    })
    .replace(/<a\b([^>]*)>/gi, (_, attrs) => {
      const href = absolutizeUrl(attr(attrs, "href"));
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">` : "<a>";
    });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAjaxCommentContent(comment) {
  const memo = String(comment?.memo || "");
  const text = stripTags(memo);
  if (text) return text;

  const dcconAlt = attr(memo, "title") || attr(memo, "alt") || attr(memo, "conalt");
  if (dcconAlt) return `[디시콘 ${dcconAlt}]`;

  if (/<img\b/i.test(memo)) return "[이미지 댓글]";

  return "";
}

function buildImageProxyUrl(sourceUrl, articleNo = "") {
  const params = new URLSearchParams({ url: sourceUrl });
  if (articleNo) params.set("no", articleNo);
  return `/media/image?${params.toString()}`;
}

function sniffMime(buffer) {
  if (!buffer || buffer.length < 4) return "application/octet-stream";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function isAllowedImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      IMAGE_HOST_ALLOWLIST.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

function parseArticle(html, no) {
  const titleBlock = firstMatch(html, /<div[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const title = stripTags(firstMatch(html, /<span[^>]*class="[^"]*\btitle_subject\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i))
    || stripTags(firstMatch(titleBlock, /<span[^>]*>([\s\S]*?)<\/span>/i));
  const category = stripTags(firstMatch(html, /<span[^>]*class="[^"]*\btitle_headtext\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
  const writerMatch = html.match(/<div\b([^>]*\bclass="[^"]*\bgall_writer\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/i);
  const writerAttrs = writerMatch?.[1] || "";
  const writerBlock = writerMatch?.[2] || "";
  const writerSpan = writerBlock.match(/<span\b([^>]*)>/i)?.[1] || "";
  const rawContent = extractElementInnerHtml(html, "write_div");
  const meta = stripTags(firstMatch(html, /<div[^>]*class="[^"]*\bfl\b[^"]*\bgall_date\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i));

  return {
    no,
    category,
    title: title || `게시글 ${no}`,
    author: attr(writerAttrs, "data-nick") || attr(writerSpan, "title") || stripTags(writerBlock),
    ip: attr(writerAttrs, "data-ip") || attr(writerSpan, "data-ip"),
    uid: attr(writerAttrs, "data-uid") || attr(writerSpan, "data-uid"),
    date: meta || stripTags(firstMatch(html, /<span[^>]*class="[^"]*\bgall_date\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)),
    views: stripTags(firstMatch(html, /조회\s*([0-9,]+)/i)),
    recommend: stripTags(firstMatch(html, /추천\s*([0-9,]+)/i)),
    replyCount: Number(inputValue(html, "comment_cnt")) || Number(stripTags(firstMatch(html, /댓글\s*([0-9,]+)/i))) || 0,
    contentHtml: normalizeContentHtml(rawContent || "<p>본문을 찾지 못했습니다.</p>", no),
    sourceUrl: `${VIEW_URL}${encodeURIComponent(no)}`
  };
}

function buildRiskPayload(post, contentText = "") {
  return analyzePostRisk({
    no: post.no,
    category: post.category,
    title: post.title,
    contentText,
    replyCount: post.replyCount
  });
}

function toSnapshotRecord(post, fetchedAt) {
  return {
    post_no: String(post.no),
    source_url: post.sourceUrl,
    category: post.category || "",
    title: post.title,
    author: post.author || "",
    date_text: post.date || "",
    views_text: post.views || "",
    recommend_text: post.recommend || "",
    reply_count: Number(post.replyCount) || 0,
    content_text: extractPlainText(post.contentHtml || ""),
    content_html: post.contentHtml || "",
    fetched_at: fetchedAt
  };
}

function enrichPostWithRisk(post) {
  const risk = buildRiskPayload(post, post.title);
  return {
    ...post,
    trollRisk: {
      score: risk.score,
      level: risk.level,
      summary: risk.summary
    }
  };
}

function parseAjaxComments(payload) {
  if (!payload || !Array.isArray(payload.comments)) return [];

  return payload.comments
    .filter((comment) => comment && comment.del_yn !== "Y" && comment.is_delete !== "1")
    .map((comment) => ({
      id: String(comment.no || ""),
      author: stripTags(comment.gallog_icon || comment.name || "익명"),
      date: stripTags(comment.reg_date || ""),
      text: parseAjaxCommentContent(comment),
      isReply: Number(comment.depth || 0) > 0 || String(comment.parent || "") !== String(comment.c_no || comment.parent || "")
    }))
    .filter((comment) => comment.text);
}

async function fetchAjaxComments(no, articleHtml) {
  const eSno = inputValue(articleHtml, "e_s_n_o");
  if (!eSno) return [];

  const secretArticleKey = inputValue(articleHtml, "secret_article_key");
  const gallType = inputValue(articleHtml, "_GALLTYPE_") || "MI";
  const body = new URLSearchParams({
    id: GALLERY_ID,
    no,
    cmt_id: GALLERY_ID,
    cmt_no: no,
    focus_cno: "",
    focus_pno: "",
    e_s_n_o: eSno,
    comment_page: "1",
    sort: "D",
    prevCnt: "",
    board_type: "",
    _GALLTYPE_: gallType,
    secret_article_key: secretArticleKey
  });

  const response = await fetch(`${BASE_URL}/board/comment/`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "referer": `${VIEW_URL}${encodeURIComponent(no)}`
    },
    body
  });

  if (!response.ok) return [];

  try {
    return parseAjaxComments(JSON.parse(await decodeResponse(response)));
  } catch {
    return [];
  }
}

function parseComments(html) {
  const comments = [];
  const commentArea = firstMatch(html, /<ul[^>]*class="[^"]*\bcmt_list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i) || html;
  const liRegex = /<li\b([^>]*(?:comment_li|ub-content)[^>]*)>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(commentArea))) {
    const attrs = match[1];
    const body = match[2];
    const id = attr(attrs, "id") || attr(attrs, "data-no") || String(comments.length + 1);
    const nicknameBlock = firstMatch(body, /<span[^>]*class="[^"]*(?:nickname|nick)[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || firstMatch(body, /<em[^>]*>([\s\S]*?)<\/em>/i);
    const textBlock = firstMatch(body, /<p[^>]*class="[^"]*(?:usertxt|comment_dccon|cmt_txtbox)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || firstMatch(body, /<div[^>]*class="[^"]*\btxt\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const date = stripTags(firstMatch(body, /<span[^>]*class="[^"]*\bdate_time\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || firstMatch(body, /<span[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const text = stripTags(textBlock);

    if (!text || /댓글돌이|등록된 댓글이 없습니다/.test(text)) continue;

    comments.push({
      id,
      author: stripTags(nicknameBlock) || "익명",
      date,
      text,
      isReply: /\breply\b|\bdepth\b|re_comment/i.test(attrs + body)
    });
  }

  return comments;
}

async function getPosts(limit = 50) {
  const now = Date.now();
  if (now - cachedList.fetchedAt < CACHE_MS && cachedList.posts.length >= limit) {
    return cachedList;
  }

  const posts = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_LIST_PAGES && posts.length < limit; page += 1) {
    const html = await fetchHtml(buildListUrl(page));
    const pagePosts = parsePosts(html);

    for (const post of pagePosts) {
      if (seen.has(post.no)) continue;
      seen.add(post.no);
      posts.push(enrichPostWithRisk(post));
      if (posts.length >= limit) break;
    }

    if (!pagePosts.length) break;
  }

  cachedList = { fetchedAt: now, posts };
  return cachedList;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/posts") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
    const list = await getPosts(limit);
    const labels = getLabelsForPosts(list.posts.slice(0, limit).map((post) => post.no));
    sendJson(res, 200, {
      galleryId: GALLERY_ID,
      fetchedAt: new Date(list.fetchedAt).toISOString(),
      posts: list.posts.slice(0, limit).map((post) => ({
        ...post,
        userLabel: labels[post.no] || null
      }))
    });
    return;
  }

  if (url.pathname === "/api/labels/stats") {
    sendJson(res, 200, getLabelStats());
    return;
  }

  const postMatch = url.pathname.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch && req.method === "GET") {
    const no = postMatch[1];
    const html = await fetchHtml(`${VIEW_URL}${encodeURIComponent(no)}`);
    const post = parseArticle(html, no);
    const fetchedAt = new Date().toISOString();
    const trollRisk = buildRiskPayload(post, extractPlainText(post.contentHtml));
    let comments = parseComments(html);
    if (!comments.length && post.replyCount > 0) {
      comments = await fetchAjaxComments(no, html);
    }
    savePostSnapshot(toSnapshotRecord(post, fetchedAt));
    savePrediction(post.no, trollRisk, PREDICTOR_VERSION, fetchedAt);
    sendJson(res, 200, {
      fetchedAt,
      post,
      comments,
      trollRisk,
      userLabel: getLabel(post.no)?.label || null
    });
    return;
  }

  const labelMatch = url.pathname.match(/^\/api\/posts\/(\d+)\/label$/);
  if (labelMatch && req.method === "POST") {
    const no = labelMatch[1];
    const body = await readJsonBody(req);
    if (!["troll", "normal"].includes(body.label)) {
      sendJson(res, 400, { error: "Invalid label value" });
      return;
    }

    if (!getPostSnapshot(no)) {
      sendJson(res, 409, { error: "게시글 스냅샷이 없습니다. 먼저 글 상세를 열어주세요." });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      ...setLabel(no, body.label)
    });
    return;
  }

  if (labelMatch && req.method === "DELETE") {
    const no = labelMatch[1];
    if (!getPostSnapshot(no)) {
      sendJson(res, 409, { error: "게시글 스냅샷이 없습니다. 먼저 글 상세를 열어주세요." });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      ...clearLabel(no)
    });
    return;
  }

  sendJson(res, 404, { error: "API endpoint not found" });
}

async function handleMedia(req, res, url) {
  if (url.pathname !== "/media/image") {
    sendText(res, 404, "Not found");
    return;
  }

  const sourceUrl = url.searchParams.get("url") || "";
  const articleNo = url.searchParams.get("no") || "";
  if (!isAllowedImageUrl(sourceUrl)) {
    sendText(res, 400, "Invalid image URL");
    return;
  }

  const response = await fetch(sourceUrl, {
    headers: {
      ...HEADERS,
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "referer": articleNo ? `${VIEW_URL}${encodeURIComponent(articleNo)}` : LIST_URL
    },
    redirect: "follow"
  });

  if (!response.ok) {
    sendText(res, response.status, "Image fetch failed");
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const upstreamType = response.headers.get("content-type") || "";
  const contentType = upstreamType.startsWith("image/") ? upstreamType : sniffMime(buffer);

  sendBuffer(res, 200, buffer, {
    "content-type": contentType,
    "cache-control": "public, max-age=3600",
    "content-length": String(buffer.length)
  });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/media/")) {
      await handleMedia(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 502, {
      error: "DCInside 데이터를 가져오지 못했습니다.",
      detail: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DCInside viewer running at http://${HOST}:${PORT}`);
});
