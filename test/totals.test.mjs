import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../src/totals.mjs";

const areas = ["Design", "Frontend"];
const activity = (design, frontend, priority = "Must Have") => ({
  kind: "activity", priority, values: { Design: design, Frontend: frontend },
});

test("nested groups have equal weight even with different activity counts", () => {
  const input = { children: [
    { children: [{ children: [activity(100, 50), activity(0, 0, "Should Have")] }] },
    { children: [activity(100, 100)] },
  ] };
  const before = structuredClone(input);
  const project = calculate(input, areas);
  const [groupA, groupB] = project.children;
  const [module] = groupA.children;
  assert.deepEqual(module.children.map(node => node.percent), [75, 0]);
  assert.deepEqual(module.values, { Design: 50, Frontend: 25 });
  assert.equal(module.percent, 37.5);
  assert.deepEqual([groupA.percent, groupA.activities, groupA.mustHaves], [37.5, 2, 1]);
  assert.equal(groupB.percent, 100);
  assert.equal(groupB.status, "done");
  assert.deepEqual(project.values, { Design: 75, Frontend: 62.5 });
  assert.deepEqual([project.percent, project.activities, project.mustHaves], [68.75, 3, 2]);
  assert.deepEqual(input, before);
});

test("empty containers and missing area values count as zero", () => {
  const empty = calculate({}, areas);
  assert.deepEqual(empty.values, { Design: 0, Frontend: 0 });
  assert.equal(empty.percent, 0);
  assert.equal(empty.status, "not started");
  assert.equal(calculate({ kind: "activity", values: { Design: 1 } }, areas).percent, 0.5);
});
