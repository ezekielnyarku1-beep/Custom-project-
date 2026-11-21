function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function calculate(node, areas) {
  const children = (node.children ?? []).map(child => calculate(child, areas));
  const activity = node.kind === "activity";
  const values = Object.fromEntries(areas.map(id => [
    id, activity ? node.values?.[id] ?? 0 : average(children.map(child => child.values[id])),
  ]));
  const percent = average(Object.values(values));
  const count = key => children.reduce((sum, child) => sum + child[key], 0);
  return {
    ...node, children, values, percent,
    status: percent === 100 ? "done" : percent > 0 ? "ongoing" : "not started",
    activities: activity ? 1 : count("activities"),
    mustHaves: activity ? Number(node.priority === "Must Have") : count("mustHaves"),
  };
}
