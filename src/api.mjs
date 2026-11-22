import { record } from "./workspace.mjs";
import { calculate } from "./totals.mjs";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const summary = ({ children, ...node }) => node;

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function id(value) {
  if (typeof value !== "string" || !uuid.test(value))
    fail(400, "Expected a valid ID");
  return value;
}

export function name(value) {
  if (typeof value !== "string" || !value.trim())
    fail(400, "A name is required");
  return value.trim();
}

export async function body(request) {
  if(request.body!==undefined) {
    let data=request.body;
    if(Buffer.isBuffer(data))data=data.toString("utf8");
    if(typeof data==="string") {
      try {data=JSON.parse(data);}catch {fail(400,"Expected JSON");}
    }
    if(!data || typeof data!=="object" || Array.isArray(data))fail(400,"Expected a JSON object");
    if(Buffer.byteLength(JSON.stringify(data))>1500000)fail(413,"Request is too large");
    return data;
  }
  let raw = "";
  request.setEncoding("utf8");
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1500000) {
      request.resume();
      fail(413, "Request is too large");
    }
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(400, "Expected JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail(400, "Expected a JSON object");
  return data;
}

export async function owned(
  db,
  user,
  { projectId = null, nodeId = null } = {},
) {
  const { rows } = await db.query(
    `SELECT p.id, p.name FROM projects p WHERE p.owner_id = $1 AND ($4 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.account_id=$5))
      AND ($2::uuid IS NULL OR p.id = $2)
      AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM nodes n WHERE n.id = $3 AND n.project_id = p.id))
      ORDER BY p.created_at, p.id FOR UPDATE`,
    [user.project_key, projectId, nodeId, user.role !== "Member", user.id],
  );
  if ((projectId || nodeId) && !rows.length)
    fail(404, "Project or node not found");
  return rows;
}

export async function projectTrees(db, projects, loaded = null) {
  const ids = projects.map((p) => p.id);
  const trees = new Map(
    projects.map((p) => [
      p.id,
      { areas: [], root: { ...p, kind: "project", children: [] } },
    ]),
  );
  if (!ids.length) return trees;
  const areas = loaded
    ? { rows: loaded.areas }
    : await db.query(
        "SELECT id,name,project_id FROM areas WHERE project_id=ANY($1) ORDER BY position",
        [ids],
      );
  for (const { project_id, ...area } of areas.rows)
    trees.get(project_id).areas.push(area);
  const nodes = loaded
    ? { rows: loaded.nodes }
    : await db.query(
        `SELECT n.id,n.project_id,n.name,n.kind,n.type,n.priority,n.parent_id AS "parentId",
    COALESCE((SELECT json_object_agg(area_id,value) FROM progress WHERE node_id=n.id),'{}') AS values
    FROM nodes n WHERE n.project_id=ANY($1) ORDER BY n.position`,
        [ids],
      );
  const byId = new Map(nodes.rows.map((n) => [n.id, { ...n, children: [] }]));
  for (const node of byId.values())
    (byId.get(node.parentId) ?? trees.get(node.project_id).root).children.push(
      node,
    );
  for (const tree of trees.values())
    tree.root = calculate(
      tree.root,
      tree.areas.map((a) => a.id),
    );
  return trees;
}

async function detail(db, project, target = project.id) {
  const { areas, root } = (await projectTrees(db, [project])).get(project.id);
  function find(node, breadcrumb, code) {
    const path = [
      ...breadcrumb,
      { id: node.id, name: node.name, kind: node.kind, code },
    ];
    if (node.id === target)
      return {
        ...summary(node),
        code,
        areas,
        breadcrumb: path,
        children: node.children.map((child, index) => ({
          ...summary(child),
          code: childCode(code, index),
        })),
      };
    for (const [index, child] of node.children.entries()) {
      const match = find(child, path, childCode(code, index));
      if (match) return match;
    }
  }
  return find(root, [], null);
}

function childCode(parent, index) {
  return (parent ? parent + "." : "") + (index + 1);
}

export async function addNode(db, projectId, data) {
  const parent = data.parentId == null ? null : id(data.parentId);
  const { kind, type = null, priority = null } = data;
  if (kind !== "container" && (kind !== "activity" || !parent))
    fail(400, "Choose a valid node kind and parent");
  if (parent) {
    const result = await db.query(
      "SELECT 1 FROM nodes WHERE id = $1 AND project_id = $2 AND kind = 'container'",
      [parent, projectId],
    );
    if (!result.rowCount)
      fail(400, "Choose a parent container in this project");
  }
  const { rows } = await db.query(
    `INSERT INTO nodes (project_id, parent_id, kind, name, type, priority, position)
    SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(position) + 1, 0)
    FROM nodes WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [projectId, parent, kind, name(data.name), type, priority],
  );
  return rows[0].id;
}

export async function addProject(db, user, data, projectId = null) {
  if (!Array.isArray(data.areas) || !Array.isArray(data.groups))
    fail(400, "Areas and groups must be lists");
  const { rows } = await db.query(
    "INSERT INTO projects (id,name, owner_id,description,due_date) VALUES (coalesce($5,gen_random_uuid()),$1, $2,$3,$4) RETURNING id",
    [
      name(data.name),
      user.project_key,
      data.description ?? "",
      data.due_date || null,
      projectId,
    ],
  );
  const [project] = await owned(db, user, { projectId: rows[0].id });
  for (const [position, area] of data.areas.entries()) {
    await db.query(
      "INSERT INTO areas (project_id, name, position) VALUES ($1, $2, $3)",
      [project.id, name(area), position],
    );
  }
  for (const group of data.groups)
    await addNode(db, project.id, { kind: "container", name: group });
  return detail(db, project);
}

async function updateProgress(db, projectId, nodeId, values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    fail(400, "Expected area values");
  const node = await db.query(
    "SELECT 1 FROM nodes WHERE id = $1 AND project_id = $2 AND kind = 'activity'",
    [nodeId, projectId],
  );
  if (!node.rowCount) fail(400, "Only activities have editable progress");
  for (const [areaId, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 0 || value > 100)
      fail(400, "Progress must be a whole number from 0 to 100");
    const result = await db.query(
      `INSERT INTO progress (node_id, area_id, value)
      SELECT $1, id, $3 FROM areas WHERE id = $2 AND project_id = $4
      ON CONFLICT (node_id, area_id) DO UPDATE SET value = EXCLUDED.value`,
      [nodeId, id(areaId), value, projectId],
    );
    if (!result.rowCount) fail(400, "Choose an area in this project");
  }
}

export async function api(db, request, path, user) {
  const parts = /^\/api\/(projects|nodes)(?:\/([^/]+)(\/progress)?)?$/.exec(
    path,
  );
  if (!parts) fail(404, "Route not found");
  const [, resource, target, progress] = parts;
  const method = request.method;
  if (method === "GET" && !target && resource === "projects") {
    const projects = await owned(db, user);
    return [
      200,
      Array.from((await projectTrees(db, projects)).values(), (tree) =>
        summary(tree.root),
      ),
    ];
  }
  if (method === "POST" && !target) {
    if (user.role === "Member") fail(403, "Project management access required");
    const data = await body(request);
    if (resource === "projects") {
      const project = await addProject(db, user, data);
      await record(
        db,
        user,
        project.id,
        null,
        "Project",
        "created " + project.name,
      );
      return [201, project];
    }
    const [project] = await owned(db, user, { projectId: id(data.projectId) });
    const node = await detail(db, project, await addNode(db, project.id, data));
    await record(
      db,
      user,
      project.id,
      node.id,
      "Created",
      "created " + node.name,
    );
    return [201, node];
  }
  if (
    !target ||
    !(
      (method === "GET" && !progress) ||
      (method === "PATCH" && progress && resource === "nodes")
    )
  ) {
    fail(404, "Route not found");
  }
  const key = id(target).toLowerCase();
  const [project] = await owned(
    db,
    user,
    resource === "projects" ? { projectId: key } : { nodeId: key },
  );
  if (method === "PATCH") {
    if (
      user.role === "Member" &&
      !(
        await db.query("SELECT 1 FROM nodes WHERE id=$1 AND assignee=$2", [
          key,
          user.id,
        ])
      ).rowCount
    )
      fail(403, "Only your assigned tasks can be updated");
    await updateProgress(db, project.id, key, (await body(request)).values);
    const task = await detail(db, project, key);
    const stage =
      task.percent === 100
        ? "Done"
        : task.percent > 0
          ? "In progress"
          : "To do";
    const {
      rows: [previous],
    } = await db.query("SELECT stage,assignee FROM nodes WHERE id=$1", [key]);
    await db.query("UPDATE nodes SET stage=$1 WHERE id=$2", [stage, key]);
    await record(
      db,
      user,
      project.id,
      key,
      "Work update",
      "updated progress on " +
        task.name +
        " to " +
        Math.round(task.percent) +
        "%",
      stage === "Done" && previous.stage !== stage ? "Completion" : null,
      previous.assignee,
    );
  }
  return [200, await detail(db, project, key)];
}
