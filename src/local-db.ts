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
  token_backend: string;
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

interface HotmailAccount {
  id: number;
  email: string;
  password: string;
  client_id: string;
  refresh_token: string;
  status: string;  // unused / used / failed
  used_at: string | null;
  created_at: string;
}

interface OrphanedAccount {
  id: number;
  phone: string;
  email: string;
  password: string;
  activation_id: string | null;
  error_type: string;  // email_already_in_use / email_otp_failed / cpa_callback_failed / other
  error_message: string | null;
  sms_code: string | null;
  openai_registered: number;  // 1=OpenAI 已注册成功，0=未创建
  recovered_email: string | null;  // 恢复后绑定的新邮箱
  resolved: number;  // 0=未解决，1=已手动解决
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
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
        token_backend TEXT DEFAULT 'cpa',
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

      CREATE TABLE IF NOT EXISTS hotmail_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        client_id TEXT,
        refresh_token TEXT,
        status TEXT NOT NULL DEFAULT 'unused',  -- unused / used / failed
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_hotmail_status ON hotmail_accounts(status);

      CREATE TABLE IF NOT EXISTS orphaned_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        password TEXT NOT NULL,
        activation_id TEXT,
        error_type TEXT NOT NULL,          -- email_already_in_use / email_otp_failed / cpa_callback_failed / other
        error_message TEXT,
        sms_code TEXT,                     -- 收到的短信验证码（如果有的话）
        openai_registered INTEGER DEFAULT 1,  -- OpenAI 是否已注册成功
        recovered_email TEXT,              -- 恢复后绑定的新邮箱
        resolved INTEGER DEFAULT 0,        -- 是否已手动解决
        resolved_at TEXT,
        resolved_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_orphaned_resolved ON orphaned_accounts(resolved);
      CREATE INDEX IF NOT EXISTS idx_orphaned_phone ON orphaned_accounts(phone);
    `);

    // 兼容旧数据库：给 orphaned_accounts 加 recovered_email 列
    try {
      this.db.prepare("ALTER TABLE orphaned_accounts ADD COLUMN recovered_email TEXT").run();
    } catch {
      // 列已存在，忽略
    }

    // 兼容旧数据库：给 accounts 加 token_backend 列
    try {
      this.db.prepare("ALTER TABLE accounts ADD COLUMN token_backend TEXT DEFAULT 'cpa'").run();
    } catch {
      // 列已存在，忽略
    }
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
      INSERT OR REPLACE INTO accounts (phone, email, password, access_token, token_expires_at, cpa_auth_file, cpa_base_url, ip_address, ip_country, ip_city, ip_isp, ip_is_residential, token_backend, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      account.token_backend || "cpa",
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

  // ─── Hotmail 邮箱管理 ───

  importHotmailAccounts(accounts: Array<{email: string, password: string, client_id: string, refresh_token: string}>): number {
    let imported = 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO hotmail_accounts (email, password, client_id, refresh_token)
      VALUES (?, ?, ?, ?)
    `);
    for (const account of accounts) {
      const result = stmt.run(account.email, account.password, account.client_id, account.refresh_token);
      if (result.changes > 0) {
        imported++;
      }
    }
    return imported;
  }

  getUnusedHotmailAccount(): HotmailAccount | null {
    // 优先使用全新未用的邮箱（unused），如果没有再使用可重试的邮箱（retryable）
    const stmt = this.db.prepare(`
      SELECT * FROM hotmail_accounts
      WHERE status IN ('unused', 'retryable')
      ORDER BY
        CASE status
          WHEN 'unused' THEN 0
          WHEN 'retryable' THEN 1
        END,
        created_at ASC
      LIMIT 1
    `);
    return stmt.get() as HotmailAccount | null;
  }

  markHotmailAccountUsed(email: string): void {
    const stmt = this.db.prepare("UPDATE hotmail_accounts SET status = 'used', used_at = datetime('now') WHERE email = ?");
    stmt.run(email);
  }

  markHotmailAccountFailed(email: string): void {
    const stmt = this.db.prepare("UPDATE hotmail_accounts SET status = 'failed', used_at = datetime('now') WHERE email = ?");
    stmt.run(email);
  }

  markHotmailAccountRetryable(email: string): void {
    // 标记为可重试（网络超时等错误，可以被其他手机号重试）
    const stmt = this.db.prepare("UPDATE hotmail_accounts SET status = 'retryable', used_at = datetime('now') WHERE email = ?");
    stmt.run(email);
  }

  resetHotmailAccount(email: string): void {
    // 重置为可重试状态（而不是 unused，这样可以区分全新邮箱和重试邮箱）
    const stmt = this.db.prepare("UPDATE hotmail_accounts SET status = 'retryable', used_at = datetime('now') WHERE email = ?");
    stmt.run(email);
  }

  listHotmailAccounts(status?: string): HotmailAccount[] {
    if (status) {
      const stmt = this.db.prepare("SELECT * FROM hotmail_accounts WHERE status = ? ORDER BY created_at DESC");
      return stmt.all(status) as HotmailAccount[];
    }
    const stmt = this.db.prepare("SELECT * FROM hotmail_accounts ORDER BY created_at DESC");
    return stmt.all() as HotmailAccount[];
  }

  getHotmailAccountStats(): {unused: number, retryable: number, used: number, failed: number, total: number} {
    const unused = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts WHERE status = 'unused'").get() as any).count;
    const retryable = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts WHERE status = 'retryable'").get() as any).count;
    const used = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts WHERE status = 'used'").get() as any).count;
    const failed = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts WHERE status = 'failed'").get() as any).count;
    const total = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts").get() as any).count;
    return {unused, retryable, used, failed, total};
  }

  hasAvailableHotmailAccounts(): boolean {
    // 检查是否还有可用的邮箱（unused 或 retryable）
    const count = (this.db.prepare("SELECT COUNT(*) as count FROM hotmail_accounts WHERE status IN ('unused', 'retryable')").get() as any).count;
    return count > 0;
  }

  // ─── 孤儿账号管理 ───

  saveOrphanedAccount(account: {
    phone: string;
    email: string;
    password: string;
    activation_id?: string;
    error_type: string;
    error_message?: string;
    sms_code?: string;
    openai_registered?: number;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO orphaned_accounts (phone, email, password, activation_id, error_type, error_message, sms_code, openai_registered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      account.phone,
      account.email,
      account.password,
      account.activation_id || null,
      account.error_type,
      account.error_message || null,
      account.sms_code || null,
      account.openai_registered ?? 1
    );
    return result.lastInsertRowid as number;
  }

  listOrphanedAccounts(resolved?: boolean): OrphanedAccount[] {
    if (resolved !== undefined) {
      const stmt = this.db.prepare("SELECT * FROM orphaned_accounts WHERE resolved = ? ORDER BY created_at DESC");
      return stmt.all(resolved ? 1 : 0) as OrphanedAccount[];
    }
    const stmt = this.db.prepare("SELECT * FROM orphaned_accounts ORDER BY created_at DESC");
    return stmt.all() as OrphanedAccount[];
  }

  resolveOrphanedAccount(id: number, note: string, recoveredEmail?: string): void {
    if (recoveredEmail) {
      const stmt = this.db.prepare("UPDATE orphaned_accounts SET resolved = 1, resolved_at = datetime('now'), resolved_note = ?, recovered_email = ? WHERE id = ?");
      stmt.run(note, recoveredEmail, id);
    } else {
      const stmt = this.db.prepare("UPDATE orphaned_accounts SET resolved = 1, resolved_at = datetime('now'), resolved_note = ? WHERE id = ?");
      stmt.run(note, id);
    }
  }

  updateOrphanedAccountRegistered(id: number, value: number): void {
    const stmt = this.db.prepare("UPDATE orphaned_accounts SET openai_registered = ? WHERE id = ?");
    stmt.run(value, id);
  }

  updateOrphanedNote(id: number, note: string): void {
    const stmt = this.db.prepare("UPDATE orphaned_accounts SET resolved_note = ? WHERE id = ?");
    stmt.run(note, id);
  }

  getUnresolvedOrphans(limit?: number): OrphanedAccount[] {
    if (limit !== undefined) {
      const stmt = this.db.prepare("SELECT * FROM orphaned_accounts WHERE resolved = 0 ORDER BY created_at ASC LIMIT ?");
      return stmt.all(limit) as OrphanedAccount[];
    }
    const stmt = this.db.prepare("SELECT * FROM orphaned_accounts WHERE resolved = 0 ORDER BY created_at ASC");
    return stmt.all() as OrphanedAccount[];
  }

  getOrphanedAccountStats(): {unresolved: number, resolved: number, total: number} {
    const unresolved = (this.db.prepare("SELECT COUNT(*) as count FROM orphaned_accounts WHERE resolved = 0").get() as any).count;
    const resolved = (this.db.prepare("SELECT COUNT(*) as count FROM orphaned_accounts WHERE resolved = 1").get() as any).count;
    const total = (this.db.prepare("SELECT COUNT(*) as count FROM orphaned_accounts").get() as any).count;
    return {unresolved, resolved, total};
  }

  close(): void {
    this.db.close();
  }
}
