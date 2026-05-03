const KEYWORDS = {
  adLead: ["오픈채팅", "오카", "텔레", "텔레그램", "디스코드", "문의", "상담", "홍보", "부업", "수익", "지원금"],
  politics: ["대통령", "국힘", "국민의힘", "민주당", "좌파", "우파", "보수", "진보", "탄핵", "선거", "정치"],
  certTarget: ["정처기", "정보처리기사", "정보처리 기사"],
  certNegative: ["쓸모없", "필요없", "왜 따", "시간낭비", "버려라", "무쓸모", "의미없", "쓸데없", "안 따", "안따"],
  certDismissive: ["굳이", "후회", "도전자", "메리트", "가성비", "필요한가", "의미가 있", "이제 안"],
  certHardDismissive: ["뽑지도 않", "왜 굳이", "왜 따냐", "왜 따지", "도전자가 있구나", "쓸모없는 자격증", "개발자 이제"],
  abuseStrong: ["병신", "병신 같", "개돼지", "쓰레기", "지능", "애미", "븅신", "좆", "씨발", "ㅄ", "지잡", "깝치", "씹헬", "ㅈ같"],
  abuseMild: ["새끼", "지랄", "딸딸이치", "꼬이", "패다오"],
  infoTone: ["후기", "비교", "분석", "공부", "합격", "질문", "정리", "공유", "경험", "방법", "팁"]
};

const URL_PATTERN = /(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|co\.kr|kr|io|gg))/i;

function decodeEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripTags(html = "") {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractPlainText(value = "") {
  return stripTags(value);
}

function normalizeText(value = "") {
  return extractPlainText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function countKeywordHits(text = "", keywords = []) {
  if (!text) return 0;
  return keywords.reduce((count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function pushSignal(signals, reasons, code, weight, count, reason) {
  if (!weight) return;
  signals.push({ code, weight, count });
  reasons.push(reason);
}

function summarizeReasons(reasons, score) {
  if (!reasons.length) {
    return score >= 30
      ? "일부 분탕 신호가 감지되었습니다."
      : "뚜렷한 분탕 신호가 감지되지 않았습니다.";
  }

  return reasons.slice(0, 2).join(" ");
}

function toLevel(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function analyzePostRisk(input = {}) {
  const titleText = normalizeText(input.title || "");
  const contentText = normalizeText(input.contentText || "");
  const categoryText = normalizeText(input.category || "");
  const combined = `${titleText} ${contentText}`.trim();
  const condensed = `${categoryText} ${titleText}`.trim();

  const reasons = [];
  const signals = [];
  let score = 0;

  const hasUrl = URL_PATTERN.test(combined);
  const adHits = countKeywordHits(combined, KEYWORDS.adLead);
  const politicsHits = countKeywordHits(combined, KEYWORDS.politics);
  const certTargetHits = countKeywordHits(combined, KEYWORDS.certTarget);
  const certNegativeHits = countKeywordHits(combined, KEYWORDS.certNegative);
  const certDismissiveHits = countKeywordHits(combined, KEYWORDS.certDismissive);
  const certHardDismissiveHits = countKeywordHits(combined, KEYWORDS.certHardDismissive);
  const abuseHits = countKeywordHits(combined, KEYWORDS.abuseStrong);
  const abuseMildHits = countKeywordHits(combined, KEYWORDS.abuseMild);
  const infoHits = countKeywordHits(combined, KEYWORDS.infoTone);
  const repeatedPunct = (combined.match(/[!?~]{2,}|ㅋ{4,}|ㅎ{4,}/g) || []).length;
  const shortProvocative = combined && combined.length < 60;
  const titleHasCertTarget = countKeywordHits(titleText, KEYWORDS.certTarget) >= 1;
  const titleHasCertNegative = countKeywordHits(titleText, KEYWORDS.certNegative) >= 1;
  const titleHasCertHardDismissive = countKeywordHits(titleText, KEYWORDS.certHardDismissive) >= 1;

  if (adHits >= 1) {
    score += 15;
    pushSignal(signals, reasons, "ad.keyword", 15, adHits, "광고·외부 유도 표현이 감지되었습니다.");
  }

  if (adHits >= 2) {
    score += 20;
    pushSignal(signals, reasons, "ad.keyword.cluster", 20, adHits, "광고성 표현이 반복되었습니다.");
  }

  if (hasUrl && adHits >= 1) {
    score += 20;
    pushSignal(signals, reasons, "ad.url", 20, 1, "링크와 광고성 표현이 함께 감지되었습니다.");
  }

  if (politicsHits === 1) {
    score += 12;
    pushSignal(signals, reasons, "politics.keyword", 12, politicsHits, "정치 관련 키워드가 감지되었습니다.");
  } else if (politicsHits >= 2) {
    score += 25;
    pushSignal(signals, reasons, "politics.keyword.cluster", 25, politicsHits, "정치 관련 키워드가 반복되었습니다.");
  }

  if (certTargetHits >= 1 && certNegativeHits >= 1) {
    score += 18;
    pushSignal(signals, reasons, "cert.dismissive", 18, certNegativeHits, "정처기 폄하 패턴이 감지되었습니다.");
  }

  if (certTargetHits >= 1 && certDismissiveHits >= 1) {
    score += 12;
    pushSignal(signals, reasons, "cert.dismissive.soft", 12, certDismissiveHits, "정처기 무용론 성격의 표현이 감지되었습니다.");
  }

  if (certTargetHits >= 1 && certHardDismissiveHits >= 1) {
    score += 20;
    pushSignal(signals, reasons, "cert.dismissive.hard", 20, certHardDismissiveHits, "정처기 무용론 성격의 도발적 표현이 감지되었습니다.");
  }

  if (titleHasCertTarget && (titleHasCertNegative || titleHasCertHardDismissive)) {
    score += 8;
    pushSignal(signals, reasons, "cert.dismissive.title", 8, 1, "제목에서 정처기 폄하 성격이 직접적으로 드러났습니다.");
  }

  if (abuseHits === 1) {
    score += 15;
    pushSignal(signals, reasons, "abuse.strong", 15, abuseHits, "강한 비하 표현이 감지되었습니다.");
  } else if (abuseHits >= 2) {
    score += 25;
    pushSignal(signals, reasons, "abuse.strong.cluster", 25, abuseHits, "강한 비하 표현이 반복되었습니다.");
  }

  if (abuseMildHits >= 1 && (certTargetHits >= 1 || politicsHits >= 1)) {
    score += 8;
    pushSignal(signals, reasons, "abuse.mild.combo", 8, abuseMildHits, "대상 비하 성격의 표현이 함께 감지되었습니다.");
  }

  if (
    (certTargetHits >= 1 && certNegativeHits >= 1 && abuseHits >= 1) ||
    (certTargetHits >= 1 && certDismissiveHits >= 1 && abuseHits >= 1) ||
    (certTargetHits >= 1 && certHardDismissiveHits >= 1 && abuseHits >= 1)
  ) {
    score += 20;
    pushSignal(signals, reasons, "cert.troll.combo", 20, 1, "정처기 폄하와 공격적 표현이 함께 감지되었습니다.");
  }

  if (politicsHits >= 1 && abuseHits >= 1) {
    score += 15;
    pushSignal(signals, reasons, "politics.abuse.combo", 15, 1, "정치 키워드와 공격적 표현이 함께 감지되었습니다.");
  }

  if (repeatedPunct >= 1) {
    score += 8;
    pushSignal(signals, reasons, "provocative.punctuation", 8, repeatedPunct, "도발적인 반복 표현이 감지되었습니다.");
  }

  if (
    shortProvocative &&
    (abuseHits >= 1 || adHits >= 1 || (certTargetHits >= 1 && (certNegativeHits >= 1 || certDismissiveHits >= 1 || certHardDismissiveHits >= 1)))
  ) {
    score += 8;
    pushSignal(signals, reasons, "provocative.short", 8, 1, "짧고 자극적인 문장 패턴이 감지되었습니다.");
  }

  if (infoHits >= 1) {
    const weight = infoHits >= 2 ? -12 : -8;
    score += weight;
    signals.push({ code: "mitigation.info", weight, count: infoHits });
  }

  if (
    contentText.length >= 120 &&
    abuseHits === 0 &&
    adHits === 0 &&
    politicsHits <= 1 &&
    certNegativeHits === 0 &&
    certDismissiveHits === 0 &&
    certHardDismissiveHits === 0
  ) {
    score -= 6;
    signals.push({ code: "mitigation.longform", weight: -6, count: 1 });
  }

  if (categoryText.includes("정보") || condensed.includes("질문")) {
    score -= 4;
    signals.push({ code: "mitigation.category", weight: -4, count: 1 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    level: toLevel(score),
    summary: summarizeReasons(reasons, score),
    reasons,
    signals
  };
}

module.exports = {
  analyzePostRisk,
  extractPlainText
};
