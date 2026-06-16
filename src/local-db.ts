import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

interface WorkflowRun {
  id: number;
  workflow: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  success_count: number;
  failure_count: number;
  options_json: string;
  last_error: string | null;
}

interface RegistrationAttempt {
  id: number;
  run_id: number;
  status: string;
  phone: string;
  email: string;
  password: string;
  sms_activation_id: string;
  sms_country: string;
  sms_cost: string;
  cpa_status: string;
  cpa_auth_file: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface Account {
  id: number;
  phone: string;
  email: string;
  password: string;
  access_token: string;
  token_expires_at: string | null;
  cpa_auth_file: string;
  cpa_base_url: string;
  ip_address: string;
  ip_country: string;
  ip_city: string;
  ip_isp: string;
  ip_is_residential: number;
  created_at: string;
  updated_at: string;
  status: string;
}

interface WorkerSlot {
  worker_id: string;
  run_id: number;
  attempt_id: number | null;
  status: string;
  phone: string;
  activation_id: string;
  bind_email: string;
  started_at: string;
  finished_at: string | null;
  sms_deadline_at: string | null;
  email_deadline_at: string | null;
  last_error: string | null;
  cancel_reason: string | null;
  retry_count: number;
}

export class LocalDB {
  private db: DatabaseSync;

  constructor(dbPath: string = "data/codex-register.sqlite") {
    const dir = join(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        options_json TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS registration_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        phone TEXT,
        email TEXT,
        password TEXT,
        sms_activation_id TEXT,
        sms_country TEXT,
        sms_cost TEXT,
        cpa_status TEXT,
        cpa_auth_file TEXT,
        error TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        password TEXT NOT NULL,
        access_token TEXT NOT NULL,
        token_expires_at TEXT,
        cpa_auth_file TEXT,
        cpa_base_url TEXT,
        ip_address TEXT,
        ip_country TEXT,
        ip_city TEXT,
        ip_isp TEXT,
        ip_is_residential INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_attempts_run_id ON registration_attempts(run_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);

      CREATE TABLE IF NOT EXISTS worker_slots (
        worker_id TEXT PRIMARY KEY,
        run_id INTEGER NOT NULL,
        attempt_id INTEGER,
        status TEXT NOT NULL DEFAULT 'idle',
        phone TEXT,
        activation_id TEXT,
        bind_email TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        sms_deadline_at TEXT,
        email_deadline_at TEXT,
        last_error TEXT,
        cancel_reason TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
        FOREIGN KEY (attempt_id) REFERENCES registration_attempts(id)
      );

      CREATE INDEX IF NOT EXISTS idx_worker_slots_run_id ON worker_slots(run_id);
      CREATE INDEX IF NOT EXISTS idx_worker_slots_status ON worker_slots(status);
    `);
  }

  createWorkflowRun(workflow: string, options?: object): number {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_runs (workflow, options_json)
      VALUES (?, ?)
    `);
    const result = stmt.run(workflow, options ? JSON.stringify(options) : null);
    return result.lastInsertRowid as number;
  }

  finishWorkflowRun(runId: number, status: string, successCount: number, failureCount: number, lastError?: string): void {
    const stmt = this.db.prepare(`
      UPDATE workflow_runs
      SET status = ?, finished_at = datetime('now'), success_count = ?, failure_count = ?, last_error = ?
      WHERE id = ?
    `);
    stmt.run(status, successCount, failureCount, lastError || null, runId);
  }

  createAttempt(runId: number): number {
    const stmt = this.db.prepare(`
      INSERT INTO registration_attempts (run_id, status)
      VALUES (?, 'running')
    `);
    const result = stmt.run(runId);
    return result.lastInsertRowid as number;
  }

  updateAttempt(attemptId: number, data: Partial<RegistrationAttempt>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
    if (data.phone !== undefined) { fields.push("phone = ?"); values.push(data.phone); }
    if (data.email !== undefined) { fields.push("email = ?"); values.push(data.email); }
    if (data.password !== undefined) { fields.push("password = ?"); values.push(data.password); }
    if (data.sms_activation_id !== undefined) { fields.push("sms_activation_id = ?"); values.push(data.sms_activation_id); }
    if (data.sms_country !== undefined) { fields.push("sms_country = ?"); values.push(data.sms_country); }
    if (data.sms_cost !== undefined) { fields.push("sms_cost = ?"); values.push(data.sms_cost); }
    if (data.cpa_status !== undefined) { fields.push("cpa_status = ?"); values.push(data.cpa_status); }
    if (data.cpa_auth_file !== undefined) { fields.push("cpa_auth_file = ?"); values.push(data.cpa_auth_file); }
    if (data.error !== undefined) { fields.push("error = ?"); values.push(data.error); }

    if (data.status === "ok" || data.status === "failed") {
      fields.push("finished_at = datetime('now')");
    }

    if (fields.length === 0) return;

    values.push(attemptId);
    const stmt = this.db.prepare(`
      UPDATE registration_attempts
      SET ${fields.join(", ")}
      WHERE id = ?
    `);
    stmt.run(...values);
  }

  saveAccount(account: Omit<Account, "id" | "created_at" | "updated_at">): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO accounts (phone, email, password, access_token, token_expires_at, cpa_auth_file, cpa_base_url, ip_address, ip_country, ip_city, ip_isp, ip_is_residential, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      account.phone,
      account.email,
      account.password,
      account.access_token,
      account.token_expires_at || null,
      account.cpa_auth_file || null,
      account.cpa_base_url || null,
      account.ip_address || null,
      account.ip_country || null,
      account.ip_city || null,
      account.ip_isp || null,
      account.ip_is_residential || 0,
      account.status || "active"
    );
    return result.lastInsertRowid as number;
  }

  listAccounts(): Account[] {
    const stmt = this.db.prepare("SELECT * FROM accounts ORDER BY created_at DESC");
    return stmt.all() as Account[];
  }

  listRuns(): WorkflowRun[] {
    const stmt = this.db.prepare("SELECT * FROM workflow_runs ORDER BY started_at DESC");
    return stmt.all() as WorkflowRun[];
  }

  listAttempts(runId: number): RegistrationAttempt[] {
    const stmt = this.db.prepare("SELECT * FROM registration_attempts WHERE run_id = ? ORDER BY started_at DESC");
    return stmt.all(runId) as RegistrationAttempt[];
  }

  exportTokens(outputPath: string): number {
    const { appendFileSync } = require("node:fs");
    const accounts = this.listAccounts();
    const activeAccounts = accounts.filter(a => a.status === "active" && a.access_token);

    let count = 0;
    for (const account of activeAccounts) {
      appendFileSync(outputPath, account.access_token + "\n", "utf8");
      count++;
    }

    return count;
  }

  getStats(): { runs: number; attempts: number; accounts: number; workers: number } {
    const runs = (this.db.prepare("SELECT COUNT(*) as count FROM workflow_runs").get() as any).count;
    const attempts = (this.db.prepare("SELECT COUNT(*) as count FROM registration_attempts").get() as any).count;
    const accounts = (this.db.prepare("SELECT COUNT(*) as count FROM accounts").get() as any).count;
    const workers = (this.db.prepare("SELECT COUNT(*) as count FROM worker_slots").get() as any).count;
    return { runs, attempts, accounts, workers };
  }

  // ─── Worker Slot 管理 ───

  createWorkerSlot(workerId: string, runId: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO worker_slots (worker_id, run_id, status)
      VALUES (?, ?, 'idle')
    `);
    stmt.run(workerId, runId);
  }

  updateWorkerSlot(workerId: string, data: Partial<WorkerSlot>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.attempt_id !== undefined) { fields.push("attempt_id = ?"); values.push(data.attempt_id); }
    if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
    if (data.phone !== undefined) { fields.push("phone = ?"); values.push(data.phone); }
    if (data.activation_id !== undefined) { fields.push("activation_id = ?"); values.push(data.activation_id); }
    if (data.bind_email !== undefined) { fields.push("bind_email = ?"); values.push(data.bind_email); }
    if (data.sms_deadline_at !== undefined) { fields.push("sms_deadline_at = ?"); values.push(data.sms_deadline_at); }
    if (data.email_deadline_at !== undefined) { fields.push("email_deadline_at = ?"); values.push(data.email_deadline_at); }
    if (data.last_error !== undefined) { fields.push("last_error = ?"); values.push(data.last_error); }
    if (data.cancel_reason !== undefined) { fields.push("cancel_reason = ?"); values.push(data.cancel_reason); }
    if (data.retry_count !== undefined) { fields.push("retry_count = ?"); values.push(data.retry_count); }

    // 终态时记录 finished_at
    if (data.status && ["success", "failed", "timed_out", "cancelled"].includes(data.status)) {
      fields.push("finished_at = datetime('now')");
    }

    if (fields.length === 0) return;

    values.push(workerId);
    const stmt = this.db.prepare(`
      UPDATE worker_slots
      SET ${fields.join(", ")}
      WHERE worker_id = ?
    `);
    stmt.run(...values);
  }

  getWorkerSlot(workerId: string): WorkerSlot | null {
    const stmt = this.db.prepare("SELECT * FROM worker_slots WHERE worker_id = ?");
    return stmt.get(workerId) as WorkerSlot | null;
  }

  getActiveWorkers(runId: number): WorkerSlot[] {
    const stmt = this.db.prepare(`
      SELECT * FROM worker_slots
      WHERE run_id = ? AND status NOT IN ('idle', 'success', 'failed', 'timed_out', 'cancelled')
      ORDER BY started_at
    `);
    return stmt.all(runId) as WorkerSlot[];
  }

  getIdleWorkers(runId: number): WorkerSlot[] {
    const stmt = this.db.prepare(`
      SELECT * FROM worker_slots
      WHERE run_id = ? AND status = 'idle'
      ORDER BY started_at
    `);
    return stmt.all(runId) as WorkerSlot[];
  }

  deleteWorkerSlot(workerId: string): void {
    const stmt = this.db.prepare("DELETE FROM worker_slots WHERE worker_id = ?");
    stmt.run(workerId);
  }

  close(): void {
    this.db.close();
  }
}
