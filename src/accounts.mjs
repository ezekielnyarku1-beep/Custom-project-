import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
import { body, fail, name } from "./api.mjs";

const derive = promisify(scrypt);
const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function email(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    fail(400, "Enter a valid email address");
  return value.trim().toLowerCase();
}
export function mailEnabled() {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.APP_URL,
  );
}
export async function queueMail(db, to, subject, message) {
  await db.query(
    "INSERT INTO mail_queue(recipient,subject,body) VALUES($1,$2,$3)",
    [to, subject, message],
  );
}
export async function deliverNextMail(db, send = fetch) {
  const {
    rows: [mail],
  } = await db.query(
    "SELECT * FROM mail_queue WHERE next_attempt<=now() ORDER BY next_attempt,id LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
  if (mail) {
    let delivered = false;
    try {
      const result = await send("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": "overview-" + mail.id,
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [mail.recipient],
          subject: mail.subject,
          text: mail.body,
        }),
      });
      delivered = result.ok;
      if (!delivered) console.error("Mail delivery deferred", result.status);
    } catch {
      console.error("Mail delivery unavailable");
    }
    await db.query(
      delivered
        ? "DELETE FROM mail_queue WHERE id=$1"
        : "UPDATE mail_queue SET attempts=attempts+1,next_attempt=now()+least(60,attempts+1)*interval '1 minute' WHERE id=$1",
      [mail.id],
    );
  }
}
export function startMailer(pool) {
  if (!mailEnabled()) return;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    let db;
    try {
      db = await pool.connect();
      await db.query("BEGIN");
      await deliverNextMail(db);
      await db.query("COMMIT");
    } catch {
      if (db) await db.query("ROLLBACK").catch(() => {});
    } finally {
      db?.release();
      running = false;
    }
  }, 5000).unref();
}
async function hashPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 256)
    fail(400, "Use a password between 8 and 256 characters");
  const salt = token();
  return salt + "." + (await derive(value, salt, 64)).toString("hex");
}
async function matches(value, hash) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    typeof hash !== "string"
  )
    return false;
  const [salt, key] = hash.split(".");
  return timingSafeEqual(
    await derive(value, salt, 64),
    Buffer.from(key, "hex"),
  );
}
function cookie(request, value, age) {
  const secure =
    process.env.VERCEL === "1" || process.env.APP_URL?.startsWith("https://") || request.socket.encrypted;
  return (
    "overview_session=" +
    value +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    age +
    (secure ? "; Secure" : "")
  );
}
export async function identity(db, request) {
  const raw = /(?:^|;\s*)overview_session=([0-9a-f]{64})(?:;|$)/.exec(
    request.headers.cookie ?? "",
  )?.[1];
  if (!raw) fail(401, "Sign in to continue");
  const {
    rows: [user],
  } = await db.query(
    `SELECT a.id,a.name,a.email,a.job_title,a.in_app,a.email_alerts,m.role,w.id workspace,w.name workspace_name,w.project_key,s.token
    FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN workspaces w ON w.id=s.workspace_id
    JOIN members m ON m.workspace_id=w.id AND m.account_id=a.id WHERE s.token=$1 AND s.expires_at>now()`,
    [digest(raw)],
  );
  if (!user) fail(401, "Your session has expired");
  return user;
}
async function newSession(db, request, user, workspace) {
  const raw = token();
  await db.query(
    "INSERT INTO sessions(token,account_id,workspace_id) VALUES($1,$2,$3)",
    [digest(raw), user, workspace],
  );
  return [200, { ok: true }, { "Set-Cookie": cookie(request, raw, 2592000) }];
}
export async function accountApi(db, request, path) {
  if (request.method !== "POST") fail(405, "Use POST for this action");
  const data = await body(request);
  if (path === "google") {
    if (!process.env.GOOGLE_CLIENT_ID)
      fail(503, "Google sign-in is not configured");
    let ticket;
    try {
      ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken: String(data.credential ?? ""),
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      fail(401, "Google sign-in could not be verified");
    }
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true)
      fail(401, "A verified Google email address is required");
    const address = email(payload.email);
    const googleSub = String(payload.sub);
    let user = (
      await db.query(
        "SELECT id FROM accounts WHERE google_sub=$1 OR email=$2 ORDER BY (google_sub=$1) DESC LIMIT 1",
        [googleSub, address],
      )
    ).rows[0];
    if (!user) {
      user = (
        await db.query(
          "INSERT INTO accounts(email,name,google_sub,password_hash) VALUES($1,$2,$3,NULL) RETURNING id",
          [address, name(payload.name || payload.email), googleSub],
        )
      ).rows[0];
      const {
        rows: [space],
      } = await db.query(
        "INSERT INTO workspaces(name) VALUES('Personal workspace') RETURNING id",
      );
      await db.query("INSERT INTO members VALUES($1,$2,'Owner')", [
        space.id,
        user.id,
      ]);
    } else {
      await db.query(
        "UPDATE accounts SET google_sub=$1 WHERE id=$2 AND google_sub IS NULL",
        [googleSub, user.id],
      );
    }
    const {
      rows: [membership],
    } = await db.query(
      "SELECT workspace_id FROM members WHERE account_id=$1 ORDER BY (role='Owner') DESC LIMIT 1",
      [user.id],
    );
    if (!membership) fail(409, "This account has no workspace");
    return newSession(db, request, user.id, membership.workspace_id);
  }
  if (path === "signup") {
    const address = email(data.email);
    const password = await hashPassword(data.password);
    const {
      rows: [user],
    } = await db.query(
      "INSERT INTO accounts(email,name,password_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
      [address, name(data.fullName), password],
    );
    if (!user) fail(409, "This email already has an account");
    const {
      rows: [space],
    } = await db.query(
      "INSERT INTO workspaces(name) VALUES('Personal workspace') RETURNING id",
    );
    await db.query("INSERT INTO members VALUES($1,$2,'Owner')", [
      space.id,
      user.id,
    ]);
    return newSession(db, request, user.id, space.id);
  }
  if (path === "login") {
    const {
      rows: [user],
    } = await db.query(
      "SELECT a.id,a.password_hash,m.workspace_id FROM accounts a JOIN members m ON m.account_id=a.id WHERE a.email=$1 ORDER BY (m.role='Owner') DESC LIMIT 1",
      [email(data.email)],
    );
    if (!user || !(await matches(data.password, user.password_hash)))
      fail(401, "Email or password is incorrect");
    return newSession(db, request, user.id, user.workspace_id);
  }
  if (path === "forgot-password") {
    if (!mailEnabled())
      fail(
        503,
        "Password reset emails are unavailable until email delivery is configured",
      );
    const {
      rows: [user],
    } = await db.query("SELECT id,email FROM accounts WHERE email=$1", [
      email(data.email),
    ]);
    if (user) {
      const raw = token();
      await db.query(
        "INSERT INTO password_resets(account_id,token) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at",
        [user.id, digest(raw)],
      );
      await queueMail(
        db,
        user.email,
        "Reset your Overview password",
        process.env.APP_URL + "/#/reset-password/" + raw,
      );
    }
    return [200, { ok: true }];
  }
  if (path === "reset-password") {
    const {
      rows: [row],
    } = await db.query(
      "DELETE FROM password_resets WHERE token=$1 AND expires_at>now() RETURNING account_id",
      [digest(String(data.token))],
    );
    if (!row) fail(400, "Reset link has expired or has already been used");
    await db.query("UPDATE accounts SET password_hash=$1 WHERE id=$2", [
      await hashPassword(data.password),
      row.account_id,
    ]);
    await db.query(
      `UPDATE projects p SET owner_id=w.project_key FROM accounts a
      JOIN members m ON m.account_id=a.id AND m.role='Owner' JOIN workspaces w ON w.id=m.workspace_id
      WHERE a.id=$1 AND p.owner_id=a.email`,
      [row.account_id],
    );
    await db.query("DELETE FROM sessions WHERE account_id=$1", [
      row.account_id,
    ]);
    return [200, { ok: true }];
  }
  const user = await identity(db, request);
  if (path === "logout") {
    await db.query("DELETE FROM sessions WHERE token=$1", [user.token]);
    return [200, { ok: true }, { "Set-Cookie": cookie(request, "", 0) }];
  }
  if (path === "password") {
    const {
      rows: [row],
    } = await db.query(
      "SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE",
      [user.id],
    );
    if (!(await matches(data.current, row.password_hash)))
      fail(403, "Current password is incorrect");
    await db.query("UPDATE accounts SET password_hash=$1 WHERE id=$2", [
      await hashPassword(data.password),
      user.id,
    ]);
    await db.query("DELETE FROM sessions WHERE account_id=$1", [user.id]);
    await db.query("DELETE FROM password_resets WHERE account_id=$1", [
      user.id,
    ]);
    return newSession(db, request, user.id, user.workspace);
  }
  fail(404, "Account action not found");
}
