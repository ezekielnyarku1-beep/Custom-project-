import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { accountApi, identity, deliverNextMail } from "../src/accounts.mjs";
import { api } from "../src/api.mjs";
import { workspaceApi } from "../src/workspace.mjs";

test(
  "workspace collaboration, notifications and authorization",
  { skip: !process.env.OVERVIEW_TEST_DATABASE_URL },
  async () => {
    const client = new pg.Client({
      connectionString: process.env.OVERVIEW_TEST_DATABASE_URL,
    });
    await client.connect();
    const mailEnv = Object.fromEntries(
      ["APP_URL", "MAIL_FROM", "RESEND_API_KEY"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    Object.assign(process.env, {
      APP_URL: "https://overview.example",
      MAIL_FROM: "overview@example.test",
      RESEND_API_KEY: "unused-in-transaction",
    });
    function request(data, cookie, method = "POST") {
      const req = Readable.from(
        data === undefined ? [] : [Buffer.from(JSON.stringify(data))],
      );
      return Object.assign(req, { method, headers: { cookie }, socket: {} });
    }
    async function signup(name) {
      const data = {
        email: randomUUID() + "@example.test",
        fullName: name,
        password: randomUUID(),
      };
      const result = await accountApi(client, request(data), "signup");
      const cookie = result[2]["Set-Cookie"].split(";")[0];
      return {
        data,
        cookie,
        user: await identity(client, request({}, cookie)),
      };
    }
    const change = async (u, path, d) =>
      (await workspaceApi(client, request(d), u, path))[1];
    const snapshot = async (u) =>
      (
        await workspaceApi(
          client,
          request(undefined, undefined, "GET"),
          u,
          "state",
        )
      )[1];
    try {
      await client.query("BEGIN");
      const owner = await signup("Owner"),
        member = await signup("Member");
      const u = owner.user;
      assert.equal((await snapshot(u)).projects.length, 0);
      const [, p] = await api(
        client,
        request({ name: "Launch", areas: ["Design"], groups: ["Tasks"] }),
        "/api/projects",
        u,
      );
      const invite = await change(u, "invite", {
        email: member.user.email,
        role: "Member",
      });
      await change(member.user, "accept", { code: invite.code });
      const m = await identity(client, request({}, member.cookie));
      assert.equal(m.role, "Member");
      assert.equal((await snapshot(m)).projects.length, 0);
      await assert.rejects(
        change(m, "project", { project_id: p.id, name: "Invalid" }),
        { status: 404 },
      );
      await change(u, "member", { id: m.id, role: "Member", projects: [p.id] });
      await change(m, "preferences", { in_app: true, email_alerts: true });
      const task = await change(u, "task", {
        project_id: p.id,
        name: "Write brief",
        assignee: m.id,
        due_date: "2027-01-10",
      });
      assert.equal((await snapshot(m)).notifications[0].kind, "Assignment");
      await change(m, "task", {
        id: task.id,
        project_id: p.id,
        description: "Acceptance criteria",
        checklist: [{ text: "Review draft", done: true }],
      });
      assert.equal((await snapshot(u)).tasks[0].checklist[0].done, true);
      await assert.rejects(
        change(m, "task", { id: task.id, project_id: p.id, checklist: [null] }),
        { status: 400 },
      );
      assert.equal(
        (await snapshot(u)).tasks[0].checklist[0].text,
        "Review draft",
      );
      await assert.rejects(
        change(m, "task", {
          id: task.id,
          project_id: p.id,
          stage: "Done",
          expected_stage: "In review",
        }),
        { status: 409 },
      );
      await change(m, "attachment", {
        id: task.id,
        project_id: p.id,
        name: "brief.txt",
        content: Buffer.from("Brief").toString("base64"),
      });
      const attachment = (await snapshot(m)).attachments[0];
      assert.equal(
        (
          await change(m, "download", {
            id: task.id,
            project_id: p.id,
            attachment_id: attachment.id,
          })
        ).content.trim(),
        Buffer.from("Brief").toString("base64"),
      );
      await change(m, "delete-attachment", {
        id: task.id,
        project_id: p.id,
        attachment_id: attachment.id,
      });
      await change(m, "save-view", {
        name: "High priority",
        filters: { priority: "Must Have", sort: "due" },
      });
      assert.equal((await snapshot(m)).savedViews.length, 1);
      assert.equal((await snapshot(u)).savedViews.length, 0);
      await change(m, "delete-view", { name: "High priority" });
      await assert.rejects(
        change(m, "task", {
          project_id: p.id,
          id: task.id,
          priority: "Must Have",
        }),
        { status: 403 },
      );
      await change(u, "comment", {
        project_id: p.id,
        id: task.id,
        message: "Review requested",
        mention: m.id,
      });
      assert.equal((await snapshot(m)).notifications[0].kind, "Mention");
      await change(m, "task", { project_id: p.id, id: task.id, stage: "Done" });
      const state = await snapshot(u);
      assert.equal(state.notifications[0].kind, "Completion");
      assert.equal(state.tasks[0].stage, "Done");
      assert.equal(state.tasks[0].due_date, "2027-01-10");
      assert.equal(
        (
          await api(
            client,
            request(undefined, undefined, "GET"),
            "/api/projects/" + p.id,
            u,
          )
        )[1].percent,
        100,
      );
      await change(u, "read", {});
      assert.ok((await snapshot(u)).notifications.every((n) => n.seen));
      await change(u, "update", {
        project_id: p.id,
        message: "Approved for delivery",
      });
      assert.equal((await snapshot(u)).activity[0].kind, "Work update");
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM mail_queue WHERE recipient=$1",
            [m.email],
          )
        ).rows[0].n,
        3,
      );
      const queued = await client.query(
        "SELECT id FROM mail_queue WHERE recipient=$1 ORDER BY id LIMIT 1",
        [m.email],
      );
      const mailId = queued.rows[0].id;
      await client.query(
        "UPDATE mail_queue SET next_attempt='-infinity' WHERE id=$1",
        [mailId],
      );
      await deliverNextMail(client, async () => ({ ok: false, status: 503 }));
      assert.equal(
        (
          await client.query("SELECT attempts FROM mail_queue WHERE id=$1", [
            mailId,
          ])
        ).rows[0].attempts,
        1,
      );
      await client.query(
        "UPDATE mail_queue SET next_attempt='-infinity' WHERE id=$1",
        [mailId],
      );
      await deliverNextMail(client, async (url, options) => {
        assert.equal(JSON.parse(options.body).to[0], m.email);
        assert.equal(options.headers["Idempotency-Key"], "overview-" + mailId);
        return { ok: true };
      });
      assert.equal(
        (await client.query("SELECT 1 FROM mail_queue WHERE id=$1", [mailId]))
          .rowCount,
        0,
      );
      await change(u, "member", { id: m.id, role: "Member", projects: [] });
      assert.equal((await snapshot(m)).tasks.length, 0);
      assert.equal((await snapshot(m)).notifications.length, 0);
      await accountApi(
        client,
        request(
          { current: owner.data.password, password: randomUUID() },
          owner.cookie,
        ),
        "password",
      );
      await assert.rejects(identity(client, request({}, owner.cookie)), {
        status: 401,
      });
      await accountApi(client, request({ email: u.email }), "forgot-password");
      const reset = await client.query(
        "SELECT body FROM mail_queue WHERE recipient=$1 AND subject='Reset your Overview password'",
        [u.email],
      );
      const token = reset.rows[0].body.split("/").pop();
      const password = randomUUID();
      await accountApi(client, request({ token, password }), "reset-password");
      await assert.rejects(
        accountApi(client, request({ token, password }), "reset-password"),
        { status: 400 },
      );
      assert.equal(
        (
          await accountApi(
            client,
            request({ email: u.email, password }),
            "login",
          )
        )[0],
        200,
      );
      await change(u, "delete-task", { project_id: p.id, id: task.id });
      assert.equal((await snapshot(u)).tasks.length, 0);
      await change(u, "delete-project", { project_id: p.id });
      assert.equal((await snapshot(u)).projects.length, 0);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      for (const [key, value] of Object.entries(mailEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
