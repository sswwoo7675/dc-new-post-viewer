const { initDb } = require("./db");

const db = initDb();

const getLabelStmt = db.prepare(`
  SELECT label, created_at, updated_at
  FROM post_label
  WHERE post_no = ?
`);

const upsertLabelStmt = db.prepare(`
  INSERT INTO post_label (post_no, label, created_at, updated_at)
  VALUES (@post_no, @label, @created_at, @updated_at)
  ON CONFLICT(post_no) DO UPDATE SET
    label = excluded.label,
    updated_at = excluded.updated_at
`);

const deleteLabelStmt = db.prepare(`
  DELETE FROM post_label
  WHERE post_no = ?
`);

const insertEventStmt = db.prepare(`
  INSERT INTO label_event (post_no, action, from_label, to_label, created_at)
  VALUES (@post_no, @action, @from_label, @to_label, @created_at)
`);

const statsStmt = db.prepare(`
  SELECT
    COUNT(*) AS totalLabeled,
    SUM(CASE WHEN label = 'troll' THEN 1 ELSE 0 END) AS trollCount,
    SUM(CASE WHEN label = 'normal' THEN 1 ELSE 0 END) AS normalCount,
    MAX(updated_at) AS updatedAt
  FROM post_label
`);

function getLabel(postNo) {
  return getLabelStmt.get(postNo) || null;
}

function getLabelsForPosts(postNos) {
  if (!postNos.length) return {};

  const placeholders = postNos.map(() => "?").join(", ");
  const stmt = db.prepare(`
    SELECT post_no, label
    FROM post_label
    WHERE post_no IN (${placeholders})
  `);

  const rows = stmt.all(...postNos);
  return Object.fromEntries(rows.map((row) => [row.post_no, row.label]));
}

function setLabel(postNo, label) {
  if (!["troll", "normal"].includes(label)) {
    throw new Error("Invalid label");
  }

  const now = new Date().toISOString();
  const existing = getLabel(postNo);

  upsertLabelStmt.run({
    post_no: postNo,
    label,
    created_at: existing?.created_at || now,
    updated_at: now
  });

  insertEventStmt.run({
    post_no: postNo,
    action: "set",
    from_label: existing?.label || null,
    to_label: label,
    created_at: now
  });

  return {
    postNo,
    label,
    savedAt: now
  };
}

function clearLabel(postNo) {
  const existing = getLabel(postNo);
  const now = new Date().toISOString();

  if (existing) {
    deleteLabelStmt.run(postNo);
  }

  insertEventStmt.run({
    post_no: postNo,
    action: "clear",
    from_label: existing?.label || null,
    to_label: null,
    created_at: now
  });

  return {
    postNo,
    label: null,
    savedAt: now
  };
}

function getLabelStats() {
  const row = statsStmt.get() || {};
  return {
    totalLabeled: row.totalLabeled || 0,
    trollCount: row.trollCount || 0,
    normalCount: row.normalCount || 0,
    updatedAt: row.updatedAt || null
  };
}

module.exports = {
  clearLabel,
  getLabel,
  getLabelsForPosts,
  getLabelStats,
  setLabel
};
