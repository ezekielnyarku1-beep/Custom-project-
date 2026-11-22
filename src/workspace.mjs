import { randomBytes } from "node:crypto";
import {
  body,
  fail,
  name,
  addNode,
  addProject,
  owned,
  projectTrees,
} from "./api.mjs";
import { digest, email, mailEnabled, queueMail } from "./accounts.mjs";

const stages = ["To do", "In progress", "In review", "Done"];
const priorities = ["Nice to Have", "Should Have", "Must Have"];
function choice(value, options) {
  if (!options.includes(value)) fail(400, "Choose a valid option");
  return value;
}
export async function record(
  db,
  user,
  project,
  node,
  kind,
  message,
  alert = null,
  recipient = null,
) {
  const {
    rows: [event],
  } = await db.query(
    "INSERT INTO events(project_id,node_id,actor,kind,message) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [project, node, user.id, kind, message],
  );
  if (!alert) return;
  const { rows } = await db.query(
    `SELECT a.* FROM accounts a JOIN members m ON m.account_id=a.id WHERE m.workspace_id=$1
    AND a.id<>$2 AND (a.id=$3 OR ($4='Completion' AND (m.role IN ('Owner','Manager') OR EXISTS(SELECT 1 FROM events e WHERE e.node_id=$6 AND e.actor=a.id AND e.kind='Created'))))
    AND (m.role<>'Member' OR EXISTS(SELECT 1 FROM project_members WHERE project_id=$5 AND account_id=a.id))`,
    [user.workspace, user.id, recipient, alert, project, node],
  );
  for (const person of rows) {
    if (person.in_app)
      await db.query(
        "INSERT INTO notifications(event_id,recipient,kind) VALUES($1,$2,$3)",
        [event.id, person.id, alert],
      );
    if (person.email_alerts && mailEnabled())
      await queueMail(
        db,
        person.email,
        "Overview · " + alert,
        user.name +
          " " +
          message +
          "\n" +
          process.env.APP_URL +
          "/#/projects/" +
          project,
      );
  }
}
async function snapshot(db, user) {
  const queries = {
    projects:
      "SELECT p.*,EXISTS(SELECT 1 FROM stars WHERE project_id=p.id AND account_id=$2) starred FROM visible p ORDER BY COALESCE((SELECT max(created_at) FROM events WHERE project_id=p.id),p.created_at) DESC,p.id",
    areas:
      "SELECT id,name,project_id FROM areas WHERE project_id IN (SELECT id FROM visible) ORDER BY position",
    nodes:
      "SELECT n.*,n.parent_id AS \"parentId\",COALESCE((SELECT json_object_agg(area_id,value) FROM progress WHERE node_id=n.id),'{}') AS values FROM nodes n WHERE project_id IN (SELECT id FROM visible) ORDER BY position,id",
    members:
      "SELECT a.id,a.name,a.email,a.job_title,m.role,ARRAY(SELECT project_id FROM project_members WHERE account_id=a.id AND project_id IN (SELECT id FROM visible)) projects FROM accounts a JOIN members m ON m.account_id=a.id WHERE workspace_id=$3 ORDER BY a.name",
    activity:
      "SELECT e.id::text,e.kind,e.message,e.created_at,e.project_id,e.node_id,e.actor,a.name FROM events e JOIN accounts a ON a.id=e.actor WHERE project_id IN (SELECT id FROM visible) ORDER BY e.id DESC",
    notifications:
      "SELECT n.id::text,n.kind,n.seen,e.message,e.created_at,e.project_id,a.name FROM notifications n JOIN events e ON e.id=n.event_id JOIN accounts a ON a.id=e.actor WHERE n.recipient=$2 AND e.project_id IN (SELECT id FROM visible) ORDER BY n.id DESC",
    invitations:
      "SELECT email,role,expires_at FROM invitations WHERE workspace_id=$3 AND $5 AND expires_at>now() ORDER BY email",
    spaces:
      "SELECT w.id,w.name FROM workspaces w JOIN members m ON w.id=m.workspace_id WHERE m.account_id=$2 ORDER BY w.name,w.id",
    savedViews:
      "SELECT name,filters FROM saved_views WHERE account_id=$2 AND workspace_id=$3 ORDER BY name",
    attachments:
      "SELECT a.id,a.node_id,a.name,a.created_at,octet_length(a.content) size FROM attachments a JOIN nodes n ON n.id=a.node_id WHERE n.project_id IN (SELECT id FROM visible)",
  };
  const columns = Object.entries(queries).map(
    ([key, sql]) =>
      `(SELECT coalesce(json_agg(result),'[]') FROM (${sql}) result) AS "${key}"`,
  );
  const {
    rows: [data],
  } = await db.query(
    `WITH visible AS (SELECT id,name,description,due_date::text,created_at FROM projects WHERE owner_id=$1 AND ($4 OR EXISTS(SELECT 1 FROM project_members WHERE project_id=projects.id AND account_id=$2))) SELECT ${columns.join(",")},EXISTS(SELECT 1 FROM projects WHERE owner_id=$6) AS "legacyProjects"`,
    [
      user.project_key,
      user.id,
      user.workspace,
      user.role !== "Member",
      user.role === "Owner",
      user.email,
    ],
  );
  const trees = await projectTrees(db, data.projects, data);
  for (const project of data.projects) {
    const tree = trees.get(project.id);
    project.percent = tree.areas.length ? tree.root.percent : null;
  }
  data.tasks = data.nodes
    .filter((n) => n.kind === "activity")
    .map(
      ({
        id,
        project_id,
        name,
        stage,
        priority,
        assignee,
        description,
        checklist,
        due_date,
      }) => ({
        id,
        project_id,
        name,
        stage,
        priority,
        assignee,
        description,
        checklist,
        due_date,
      }),
    );
  delete data.nodes;
  delete data.areas;
  const { token, project_key, ...profile } = user;
  return { ...data, user: profile, mailEnabled: mailEnabled() };
}

export async function workspaceApi(db, request, user, path) {
  if (path === "unread" && request.method === "GET") {
    const {
      rows: [summary],
    } = await db.query(
      `SELECT count(*)::int count,max(n.id) latest FROM notifications n
      JOIN events e ON e.id=n.event_id JOIN projects p ON p.id=e.project_id
      WHERE n.recipient=$1 AND NOT n.seen AND p.owner_id=$2
      AND ($3 OR EXISTS(SELECT 1 FROM project_members WHERE project_id=p.id AND account_id=$1))`,
      [user.id, user.project_key, user.role !== "Member"],
    );
    return [200, summary];
  }
  if (path === "state" && request.method === "GET")
    return [200, await snapshot(db, user)];
  if (request.method !== "POST") fail(405, "Use POST for this action");
  const d = await body(request);
  const result = await change(db, user, path, d);
  return [200, result ?? { ok: true }];
}
async function change(db, u, path, d) {
  if (path === "save-view") {
    if (!d.filters || typeof d.filters !== "object" || Array.isArray(d.filters))
      fail(400, "Choose filters to save");
    await db.query(
      "INSERT INTO saved_views VALUES($1,$2,$3,$4) ON CONFLICT(account_id,workspace_id,name) DO UPDATE SET filters=excluded.filters",
      [u.id, u.workspace, name(d.name), d.filters],
    );
    return;
  }
  if (path === "delete-view") {
    await db.query(
      "DELETE FROM saved_views WHERE account_id=$1 AND workspace_id=$2 AND name=$3",
      [u.id, u.workspace, name(d.name)],
    );
    return;
  }
  const owner = u.role === "Owner",
    manager = u.role !== "Member";
  if (path === "import") {
    if (!owner) fail(403, "Workspace owner access required");
    if (!Array.isArray(d.projects) || !d.projects.length)
      fail(400, "Select saved projects to import");
    for (const p of d.projects) {
      const key = digest(
        JSON.stringify([u.workspace, name(p.name), p.time]),
      ).slice(0, 32);
      const existing = await db.query(
        "SELECT id FROM projects WHERE id=$1 AND owner_id=$2",
        [key, u.project_key],
      );
      if (existing.rowCount) continue;
      const project = await addProject(
        db,
        u,
        {
          name: p.name,
          description: p.description,
          areas: ["Progress"],
          groups: ["Tasks"],
        },
        key,
      );
      if (p.starred)
        await db.query("INSERT INTO stars VALUES($1,$2)", [project.id, u.id]);
      await record(
        db,
        u,
        project.id,
        null,
        "Project",
        "imported " + project.name,
      );
    }
    return;
  }
  if (path === "switch") {
    const r = await db.query(
      "UPDATE sessions SET workspace_id=$2 WHERE token=$1 AND EXISTS(SELECT 1 FROM members WHERE account_id=$3 AND workspace_id=$2)",
      [u.token, d.workspace, u.id],
    );
    if (!r.rowCount) fail(403, "Workspace access required");
    return;
  }
  if (path === "accept") {
    const {
      rows: [inv],
    } = await db.query(
      "DELETE FROM invitations WHERE token=$1 AND email=$2 AND expires_at>now() RETURNING *",
      [digest(String(d.code).trim()), u.email],
    );
    if (!inv) fail(400, "Use a valid invitation for your account email");
    await db.query(
      "INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [inv.workspace_id, u.id, inv.role],
    );
    await db.query("UPDATE sessions SET workspace_id=$2 WHERE token=$1", [
      u.token,
      inv.workspace_id,
    ]);
    return;
  }
  if (path === "profile") {
    await db.query("UPDATE accounts SET name=$1,job_title=$2 WHERE id=$3", [
      name(d.name),
      String(d.job_title ?? "").trim(),
      u.id,
    ]);
    return;
  }
  if (path === "preferences") {
    if (d.email_alerts && !mailEnabled())
      fail(503, "Email delivery is unavailable");
    await db.query(
      "UPDATE accounts SET in_app=$1,email_alerts=$2 WHERE id=$3",
      [d.in_app === true, d.email_alerts === true, u.id],
    );
    return;
  }
  if (["workspace", "invite", "revoke", "member"].includes(path)) {
    if (!owner) fail(403, "Workspace owner access required");
    if (path === "workspace") {
      await db.query("UPDATE workspaces SET name=$1 WHERE id=$2", [
        name(d.name),
        u.workspace,
      ]);
      return;
    }
    if (path === "member") {
      const {
        rows: [person],
      } = await db.query(
        "SELECT role FROM members WHERE workspace_id=$1 AND account_id=$2 FOR UPDATE",
        [u.workspace, d.id],
      );
      if (!person || person.role === "Owner")
        fail(400, "Choose an editable workspace member");
      if (d.remove === true) {
        await db.query(
          "DELETE FROM invitations WHERE workspace_id=$1 AND email=(SELECT email FROM accounts WHERE id=$2)",
          [u.workspace, d.id],
        );
        await db.query(
          "DELETE FROM members WHERE workspace_id=$1 AND account_id=$2",
          [u.workspace, d.id],
        );
        await db.query(
          "DELETE FROM sessions WHERE workspace_id=$1 AND account_id=$2",
          [u.workspace, d.id],
        );
      } else
        await db.query(
          "UPDATE members SET role=$1 WHERE workspace_id=$2 AND account_id=$3",
          [choice(d.role, ["Member", "Manager"]), u.workspace, d.id],
        );
      const ids = d.remove === true ? [] : d.projects;
      if (!Array.isArray(ids)) fail(400, "Select projects");
      const allowed = await db.query(
        "SELECT id FROM projects WHERE owner_id=$1 AND id=ANY($2)",
        [u.project_key, ids],
      );
      if (allowed.rowCount !== ids.length)
        fail(400, "Choose projects in this workspace");
      await db.query(
        "DELETE FROM project_members USING projects p WHERE project_id=p.id AND owner_id=$1 AND account_id=$2",
        [u.project_key, d.id],
      );
      await db.query(
        "INSERT INTO project_members SELECT unnest($1::uuid[]),$2",
        [ids, d.id],
      );
      if (d.remove === true || d.role === "Member")
        await db.query(
          "UPDATE nodes SET assignee=null FROM projects p WHERE nodes.project_id=p.id AND p.owner_id=$1 AND assignee=$2 AND NOT(p.id=ANY($3))",
          [u.project_key, d.id, ids],
        );
      return;
    }
    const address = email(d.email);
    if (path === "revoke") {
      await db.query(
        "DELETE FROM invitations WHERE workspace_id=$1 AND email=$2",
        [u.workspace, address],
      );
      return;
    }
    if (
      (
        await db.query(
          "SELECT 1 FROM members m JOIN accounts a ON a.id=m.account_id WHERE workspace_id=$1 AND email=$2",
          [u.workspace, address],
        )
      ).rowCount
    )
      fail(409, "Already a workspace member");
    const code = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO invitations(token,workspace_id,email,role) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,email) DO UPDATE SET token=excluded.token,role=excluded.role,expires_at=excluded.expires_at",
      [
        digest(code),
        u.workspace,
        address,
        choice(d.role, ["Member", "Manager"]),
      ],
    );
    if (mailEnabled())
      await queueMail(
        db,
        address,
        "Invitation to " + u.workspace_name,
        "Sign in at " +
          process.env.APP_URL +
          " and enter this code in Teams: " +
          code,
      );
    return { code };
  }
  if (path === "read") {
    await db.query(
      "UPDATE notifications n SET seen=true FROM events e JOIN projects p ON p.id=e.project_id WHERE e.id=n.event_id AND p.owner_id=$1 AND n.recipient=$2 AND ($3::bigint IS NULL OR n.id=$3)",
      [u.project_key, u.id, d.id ?? null],
    );
    return;
  }
  if (!d.project_id) fail(400, "Select a project");
  const [project] = await owned(db, u, { projectId: d.project_id });
  if (path === "star") {
    if (d.starred)
      await db.query("INSERT INTO stars VALUES($1,$2) ON CONFLICT DO NOTHING", [
        project.id,
        u.id,
      ]);
    else
      await db.query(
        "DELETE FROM stars WHERE project_id=$1 AND account_id=$2",
        [project.id, u.id],
      );
    return;
  }
  if (path === "delete-project") {
    if (!manager) fail(403, "Project management access required");
    await db.query("DELETE FROM projects WHERE id=$1", [project.id]);
    return;
  }
  if (path === "project") {
    if (!manager) fail(403, "Project management access required");
    await db.query(
      "UPDATE projects SET name=$1,description=$2,due_date=$3 WHERE id=$4",
      [
        name(d.name),
        String(d.description ?? ""),
        d.due_date || null,
        project.id,
      ],
    );
    await record(db, u, project.id, null, "Project", "updated " + name(d.name));
    return;
  }
  let task;
  if (
    d.id &&
    [
      "task",
      "comment",
      "delete-task",
      "attachment",
      "download",
      "delete-attachment",
    ].includes(path)
  ) {
    const { rows } = await db.query(
      "SELECT n.*,n.due_date::text AS due_date FROM nodes n WHERE project_id=$1 AND id=$2 AND kind='activity' FOR UPDATE",
      [project.id, d.id],
    );
    task = rows[0];
    if (!task) fail(404, "Task not found");
  }
  if (path === "download" && task) {
    const {
      rows: [file],
    } = await db.query(
      "SELECT name,encode(content,'base64') content FROM attachments WHERE id=$1 AND node_id=$2",
      [d.attachment_id, task.id],
    );
    if (!file) fail(404, "Attachment not found");
    return file;
  }
  if (["attachment", "delete-attachment"].includes(path) && task) {
    if (!manager && task.assignee !== u.id)
      fail(403, "Only assigned tasks can be updated");
    if (path === "attachment") {
      if (
        typeof d.content !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(d.content)
      )
        fail(400, "Invalid file");
      const content = Buffer.from(d.content, "base64");
      if (!content.length || content.length > 1048576)
        fail(400, "Choose a file between 1 byte and 1 MB");
      await db.query(
        "INSERT INTO attachments(node_id,name,content) VALUES($1,$2,$3)",
        [task.id, name(d.name), content],
      );
      await record(
        db,
        u,
        project.id,
        task.id,
        "Work update",
        "attached " + name(d.name) + " to " + task.name,
      );
    } else {
      const {
        rows: [file],
      } = await db.query(
        "DELETE FROM attachments WHERE id=$1 AND node_id=$2 RETURNING name",
        [d.attachment_id, task.id],
      );
      if (!file) fail(404, "Attachment not found");
      await record(
        db,
        u,
        project.id,
        task.id,
        "Work update",
        "removed attachment " + file.name + " from " + task.name,
      );
    }
    return;
  }
  if (path === "delete-task" && task) {
    if (!manager) fail(403, "Project management access required");
    await record(
      db,
      u,
      project.id,
      task.id,
      "Task update",
      "deleted " + task.name,
    );
    await db.query("DELETE FROM nodes WHERE id=$1", [task.id]);
    return;
  }
  const eligible = async (id) => {
    if (
      !(
        await db.query(
          "SELECT 1 FROM members WHERE workspace_id=$1 AND account_id=$2 AND (role<>'Member' OR EXISTS(SELECT 1 FROM project_members WHERE project_id=$3 AND account_id=$2))",
          [u.workspace, id, project.id],
        )
      ).rowCount
    )
      fail(400, "Select a member with project access");
  };
  if (path === "comment" && task) {
    if (d.mention) await eligible(d.mention);
    await record(
      db,
      u,
      project.id,
      task.id,
      "Comment",
      "commented on " + task.name + " · " + name(d.message),
      d.mention ? "Mention" : null,
      d.mention || null,
    );
    return;
  }
  if (path === "update") {
    await record(
      db,
      u,
      project.id,
      null,
      "Work update",
      "posted a work update · " + name(d.message),
    );
    return;
  }
  if (path !== "task") fail(404, "Action not found");
  if (!manager && (!task || task.assignee !== u.id))
    fail(403, "Only your assigned tasks can be updated");
  if (
    !manager &&
    Object.keys(d).some(
      (k) =>
        ![
          "id",
          "project_id",
          "stage",
          "expected_stage",
          "checklist",
          "description",
        ].includes(k),
    )
  )
    fail(403, "Only status can be changed");
  const taskName = name(d.name ?? task?.name);
  if (task && d.expected_stage && task.stage !== d.expected_stage)
    fail(409, "This task changed. Refresh before moving it again");
  if (
    Object.hasOwn(d, "description") &&
    (typeof d.description !== "string" || d.description.length > 20000)
  )
    fail(400, "Description must be at most 20,000 characters");
  if (
    Object.hasOwn(d, "checklist") &&
    (!Array.isArray(d.checklist) ||
      d.checklist.length > 100 ||
      d.checklist.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          typeof item.text !== "string" ||
          !item.text.trim() ||
          item.text.length > 500 ||
          typeof item.done !== "boolean",
      ))
  )
    fail(400, "Use up to 100 checklist items, each at most 500 characters");
  const stage = choice(d.stage ?? task?.stage ?? "To do", stages);
  const priority = choice(
    d.priority ?? task?.priority ?? "Should Have",
    priorities,
  );
  const assignee = Object.hasOwn(d, "assignee")
    ? d.assignee || null
    : (task?.assignee ?? null);
  if (assignee) await eligible(assignee);
  let taskId = task?.id;
  if (!task) {
    const {
      rows: [group],
    } = await db.query(
      "SELECT id FROM nodes WHERE project_id=$1 AND parent_id IS NULL ORDER BY position LIMIT 1",
      [project.id],
    );
    const parentId =
      group?.id ??
      (await addNode(db, project.id, { kind: "container", name: "Tasks" }));
    taskId = await addNode(db, project.id, {
      parentId,
      kind: "activity",
      type: "New",
      priority,
      name: taskName,
    });
  }
  await db.query(
    "UPDATE nodes SET name=$1,stage=$2,priority=$3,assignee=$4,due_date=CASE WHEN $5 THEN $6::date ELSE due_date END WHERE id=$7",
    [
      taskName,
      stage,
      priority,
      assignee,
      Object.hasOwn(d, "due_date"),
      d.due_date || null,
      taskId,
    ],
  );
  if (stage !== task?.stage)
    await db.query("UPDATE progress SET value=$1 WHERE node_id=$2", [
      [0, 50, 90, 100][stages.indexOf(stage)],
      taskId,
    ]);
  if (Object.hasOwn(d, "description"))
    await db.query("UPDATE nodes SET description=$1 WHERE id=$2", [
      d.description,
      taskId,
    ]);
  if (Object.hasOwn(d, "checklist"))
    await db.query("UPDATE nodes SET checklist=$1 WHERE id=$2", [
      JSON.stringify(d.checklist),
      taskId,
    ]);
  const changes = [];
  if (task && task.name !== taskName) changes.push("renamed from " + task.name);
  if (task && task.priority !== priority)
    changes.push("priority changed to " + priority);
  if (
    task &&
    Object.hasOwn(d, "due_date") &&
    task.due_date !== (d.due_date || null)
  )
    changes.push(d.due_date ? "due " + d.due_date : "deadline cleared");
  if (task?.assignee && !assignee) changes.push("assignment cleared");
  let message = !task
    ? "created " + taskName
    : stage !== task.stage
      ? "moved " + taskName + " to " + stage
      : "updated " + taskName;
  if (changes.length) message += " · " + changes.join(", ");
  await record(
    db,
    u,
    project.id,
    taskId,
    task ? "Task update" : "Created",
    message,
    stage === "Done" && task?.stage !== stage ? "Completion" : null,
    assignee,
  );
  if (assignee && assignee !== task?.assignee) {
    const {
      rows: [person],
    } = await db.query("SELECT name FROM accounts WHERE id=$1", [assignee]);
    await record(
      db,
      u,
      project.id,
      taskId,
      "Assignment",
      "assigned " + taskName + " to " + person.name,
      "Assignment",
      assignee,
    );
  }
  return { id: taskId };
}
