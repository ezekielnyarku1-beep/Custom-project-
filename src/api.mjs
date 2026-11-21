import { calculate } from "./totals.mjs";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const summary = ({ children, ...node }) => node;

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail(400, "Expected a valid ID");
  return value;
}

function name(value) {
  if (typeof value !== "string" || !value.trim()) fail(400, "A name is required");
  return value.trim();
}

async function body(request) {
  let raw = "";
  request.setEncoding("utf8");
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65536) {
      request.resume();
      fail(413, "Request is too large");
    }
  }
  let data;
  try { data = JSON.parse(raw); } catch { fail(400, "Expected JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Expected a JSON object");
  return data;
}

async function owned(db, owner, { projectId = null, nodeId = null } = {}) {
  const { rows } = await db.query(
    `SELECT p.id, p.name FROM projects p WHERE p.owner_id = $1
      AND ($2::uuid IS NULL OR p.id = $2)
      AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM nodes n WHERE n.id = $3 AND n.project_id = p.id))
      ORDER BY p.created_at, p.id FOR UPDATE`,
    [owner, projectId, nodeId],
  );
  if ((projectId || nodeId) && !rows.length) fail(404, "Project or node not found");
  return rows;
}

async function tree(db, project) {
  const rows = async (sql) => (await db.query(sql, [project.id])).rows;
  const areas = await rows("SELECT id, name FROM areas WHERE project_id = $1 ORDER BY position");
  const nodes = await rows(`SELECT id, name, kind, type, priority, parent_id AS "parentId"
    FROM nodes WHERE project_id = $1 ORDER BY position`);
  const progress = await rows(`SELECT v.node_id, v.area_id, v.value FROM progress v
    JOIN nodes n ON v.node_id = n.id WHERE n.project_id = $1`);
  const root = { ...project, kind: "project", children: [] };
  const byId = new Map(nodes.map(node => [node.id, Object.assign(node, { children: [], values: {} })]));
  for (const node of nodes) (byId.get(node.parentId) ?? root).children.push(node);
  for (const value of progress) byId.get(value.node_id).values[value.area_id] = value.value;
  return { areas, root: calculate(root, areas.map(area => area.id)) };
}

async function detail(db, project, target = project.id) {
  const { areas, root } = await tree(db, project);
  function find(node, breadcrumb, code) {
    const path = [...breadcrumb, { id: node.id, name: node.name, kind: node.kind, code }];
    if (node.id === target) return {
      ...summary(node), code, areas, breadcrumb: path,
      children: node.children.map((child, index) => ({
        ...summary(child), code: childCode(code, index),
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

async function addNode(db, projectId, data) {
  const parent = data.parentId == null ? null : id(data.parentId);
  const { kind, type = null, priority = null } = data;
  if (kind !== "container" && (kind !== "activity" || !parent)) fail(400, "Choose a valid node kind and parent");
  if (parent) {
    const result = await db.query("SELECT 1 FROM nodes WHERE id = $1 AND project_id = $2 AND kind = 'container'", [parent, projectId]);
    if (!result.rowCount) fail(400, "Choose a parent container in this project");
  }
  const { rows } = await db.query(`INSERT INTO nodes (project_id, parent_id, kind, name, type, priority, position)
    SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(position) + 1, 0)
    FROM nodes WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2 RETURNING id`,
  [projectId, parent, kind, name(data.name), type, priority]);
  return rows[0].id;
}

async function addProject(db, owner, data) {
  if (!Array.isArray(data.areas) || !Array.isArray(data.groups)) fail(400, "Areas and groups must be lists");
  const { rows } = await db.query("INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id", [name(data.name), owner]);
  const [project] = await owned(db, owner, { projectId: rows[0].id });
  for (const [position, area] of data.areas.entries()) {
    await db.query("INSERT INTO areas (project_id, name, position) VALUES ($1, $2, $3)", [project.id, name(area), position]);
  }
  for (const group of data.groups) await addNode(db, project.id, { kind: "container", name: group });
  return detail(db, project);
}

async function updateProgress(db, projectId, nodeId, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail(400, "Expected area values");
  const node = await db.query("SELECT 1 FROM nodes WHERE id = $1 AND project_id = $2 AND kind = 'activity'", [nodeId, projectId]);
  if (!node.rowCount) fail(400, "Only activities have editable progress");
  for (const [areaId, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 0 || value > 100) fail(400, "Progress must be a whole number from 0 to 100");
    const result = await db.query(`INSERT INTO progress (node_id, area_id, value)
      SELECT $1, id, $3 FROM areas WHERE id = $2 AND project_id = $4
      ON CONFLICT (node_id, area_id) DO UPDATE SET value = EXCLUDED.value`, [nodeId, id(areaId), value, projectId]);
    if (!result.rowCount) fail(400, "Choose an area in this project");
  }
}

export async function api(db, request, path) {
  const parts = /^\/api\/(projects|nodes)(?:\/([^/]+)(\/progress)?)?$/.exec(path);
  if (!parts) fail(404, "Route not found");
  const [, resource, target, progress] = parts;
  const method = request.method;
  // Local demo identity only. Real authentication will replace this header in Phase 4.
  const owner = request.headers["x-demo-user"]?.trim().toLowerCase();
  if (!owner || owner.length > 254) fail(401, "Demo sign-in required");
  if (method === "GET" && !target && resource === "projects") {
    const projects = await owned(db, owner);
    return [200, await Promise.all(projects.map(async project => summary((await tree(db, project)).root)))];
  }
  if (method === "POST" && !target) {
    const data = await body(request);
    if (resource === "projects") return [201, await addProject(db, owner, data)];
    const [project] = await owned(db, owner, { projectId: id(data.projectId) });
    return [201, await detail(db, project, await addNode(db, project.id, data))];
  }
  if (!target || !((method === "GET" && !progress) || (method === "PATCH" && progress && resource === "nodes"))) {
    fail(404, "Route not found");
  }
  const key = id(target).toLowerCase();
  const [project] = await owned(db, owner, resource === "projects" ? { projectId: key } : { nodeId: key });
  if (method === "PATCH") await updateProgress(db, project.id, key, (await body(request)).values);
  return [200, await detail(db, project, key)];
}
