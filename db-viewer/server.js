import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve("/root/github/codex/data/codex-register.sqlite");
const PORT = 8002;

function query(db, sql) {
  try { return db.prepare(sql).all(); }
  catch (e) { return [{ error: e.message }]; }
}

function count(db, table) {
  try { const r = db.prepare("SELECT COUNT(*) as cnt FROM " + table).get(); return r?.cnt ?? 0; }
  catch { return 0; }
}

function jsonResponse(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);

  if (url.pathname === "/api/accounts") return jsonResponse(res, query(db, "SELECT * FROM accounts ORDER BY id DESC"));
  if (url.pathname === "/api/runs") return jsonResponse(res, query(db, "SELECT * FROM workflow_runs ORDER BY id DESC"));
  if (url.pathname === "/api/workers") return jsonResponse(res, query(db, "SELECT * FROM worker_slots ORDER BY id DESC LIMIT 200"));
  if (url.pathname === "/api/attempts") return jsonResponse(res, query(db, "SELECT * FROM registration_attempts ORDER BY id DESC LIMIT 200"));
  if (url.pathname === "/api/stats") {
    return jsonResponse(res, {
      accounts: count(db, "accounts"),
      runs: count(db, "workflow_runs"),
      workers: count(db, "worker_slots"),
      attempts: count(db, "registration_attempts"),
    });
  }

  const html = readFileSync(new URL("./index.html", import.meta.url), "utf-8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("DB Viewer: http://0.0.0.0:" + PORT);
});
