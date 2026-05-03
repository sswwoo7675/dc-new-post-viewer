const { initDb } = require("./db");

const db = initDb();

const saveSnapshotStmt = db.prepare(`
  INSERT INTO posts_snapshot (
    post_no, source_url, category, title, author, date_text,
    views_text, recommend_text, reply_count, content_text, content_html, fetched_at
  ) VALUES (
    @post_no, @source_url, @category, @title, @author, @date_text,
    @views_text, @recommend_text, @reply_count, @content_text, @content_html, @fetched_at
  )
  ON CONFLICT(post_no) DO UPDATE SET
    source_url = excluded.source_url,
    category = excluded.category,
    title = excluded.title,
    author = excluded.author,
    date_text = excluded.date_text,
    views_text = excluded.views_text,
    recommend_text = excluded.recommend_text,
    reply_count = excluded.reply_count,
    content_text = excluded.content_text,
    content_html = excluded.content_html,
    fetched_at = excluded.fetched_at
`);

const savePredictionStmt = db.prepare(`
  INSERT INTO post_prediction (
    post_no, score, level, summary, reasons_json, signals_json, predictor_version, predicted_at
  ) VALUES (
    @post_no, @score, @level, @summary, @reasons_json, @signals_json, @predictor_version, @predicted_at
  )
  ON CONFLICT(post_no) DO UPDATE SET
    score = excluded.score,
    level = excluded.level,
    summary = excluded.summary,
    reasons_json = excluded.reasons_json,
    signals_json = excluded.signals_json,
    predictor_version = excluded.predictor_version,
    predicted_at = excluded.predicted_at
`);

const getSnapshotStmt = db.prepare(`
  SELECT *
  FROM posts_snapshot
  WHERE post_no = ?
`);

function savePostSnapshot(snapshot) {
  saveSnapshotStmt.run(snapshot);
}

function savePrediction(postNo, risk, predictorVersion, predictedAt) {
  savePredictionStmt.run({
    post_no: postNo,
    score: risk.score,
    level: risk.level,
    summary: risk.summary,
    reasons_json: JSON.stringify(risk.reasons || []),
    signals_json: JSON.stringify(risk.signals || []),
    predictor_version: predictorVersion,
    predicted_at: predictedAt
  });
}

function getPostSnapshot(postNo) {
  return getSnapshotStmt.get(postNo) || null;
}

module.exports = {
  getPostSnapshot,
  savePostSnapshot,
  savePrediction
};
