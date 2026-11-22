const root = document.querySelector("#root");
const loadingScreen = root.querySelector(".skeleton-screen");
const pages = {
  "reset-password": {
    title: "Reset password",
    subtitle: "Choose a new password for your account.",
    fields: ["password", "confirmPassword"],
    action: "Reset password",
  },
  login: {
    title: "Sign in to Overview",
    subtitle: "Enter your account details to continue.",
    fields: ["email", "password"],
    action: "Sign in",
  },
  signup: {
    title: "Create your Overview account",
    subtitle: "Enter your details to get started.",
    fields: ["fullName", "email", "password", "confirmPassword"],
    action: "Create account",
  },
  "forgot-password": {
    title: "Reset your password",
    subtitle: "Enter the email address for your Overview account.",
    fields: ["email"],
    action: "Send reset link",
  },
};

const fields = {
  fullName: ["Full name", "text", "Your full name", "name"],
  email: ["Email address", "email", "you@example.com", "email"],
  password: ["Password", "password", "Enter your password", "current-password"],
  confirmPassword: [
    "Confirm password",
    "password",
    "Repeat your password",
    "new-password",
  ],
};

function template(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function link(page, text) {
  const anchor = document.createElement("a");
  anchor.href = "#/" + page;
  anchor.textContent = text;
  return anchor;
}

function field(name, page) {
  const fragment = template("field");
  const label = fragment.querySelector("label");
  const input = fragment.querySelector("input");
  const error = fragment.querySelector("small");
  const [caption, type, placeholder, autocomplete] = fields[name];

  label.textContent = caption;
  label.htmlFor = name;
  Object.assign(input, { id: name, name, type, placeholder, autocomplete });
  if (name === "password" && page === "signup")
    input.autocomplete = "new-password";
  error.id = name + "-error";
  input.setAttribute("aria-describedby", error.id);
  if (type === "email") {
    input.inputMode = "email";
    input.autocapitalize = "none";
  }
  if (type === "password") {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "password-toggle";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-label", "Show " + caption.toLowerCase());
    toggle.setAttribute("aria-controls", name);
    toggle.setAttribute("aria-pressed", "false");
    toggle.onclick = () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      toggle.textContent = visible ? "Hide" : "Show";
      toggle.setAttribute(
        "aria-label",
        toggle.textContent + " " + caption.toLowerCase(),
      );
      toggle.setAttribute("aria-pressed", String(visible));
    };
    input.classList.add("password-input");
    input.after(toggle);
  }
  return fragment;
}

function showErrors(form, errors, focus = true) {
  for (const input of form.querySelectorAll("input")) {
    const message = errors[input.name] || "";
    const error = document.getElementById(
      input.getAttribute("aria-describedby"),
    );
    input.setAttribute("aria-invalid", String(Boolean(message)));
    error.hidden = !message;
    error.textContent = message;
  }
  const first = form.querySelector('[aria-invalid="true"]');
  if (focus) first?.focus();
  return Boolean(first);
}

function validateForm(form, focus) {
  const values = Object.fromEntries(new FormData(form));
  return showErrors(form, validate(values), focus) ? null : values;
}

function setButtonLoading(button) {
  button.disabled = true;
  button.classList.add("button-loading");
  button.replaceChildren();
  const spinner = document.createElement("span");
  spinner.className = "button-spinner";
  spinner.setAttribute("aria-hidden", "true");
  button.append(spinner, "Loading...");
}

function initGoogleSignIn(page) {
  const container = document.getElementById("google-signin");
  if (!container) return;
  const initialize = () => {
    if (!window.google?.accounts?.id) return false;
    google.accounts.id.initialize({
      client_id: "147233286325-ohsfl4ro2kekg3a8uq8io9d8uqqfe7bd.apps.googleusercontent.com",
      callback: async (response) => {
        container.setAttribute("aria-busy", "true");
        try {
          await request("auth/google", { credential: response.credential });
          state = null;
          location.hash = "/home";
        } catch (error) {
          showError(container, error);
        } finally {
          container.removeAttribute("aria-busy");
        }
      },
    });
    container.replaceChildren();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "google-signin-button";
    button.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.798 2.715v2.258h2.908c1.702-1.567 2.686-3.875 2.686-6.614Z"/><path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.037-3.711H.956v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.963 10.71A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.282-1.71V4.958H.956A9 9 0 0 0 0 9c0 1.452.348 2.827.956 4.042l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.891 11.426 0 9 0A9 9 0 0 0 .956 4.958L3.963 7.29C4.672 5.163 6.656 3.58 9 3.58Z"/></svg>' +
      `<span>${page === "signup" ? "Sign up with Google" : "Sign in with Google"}</span>`;
    button.onclick = () => google.accounts.id.prompt();
    container.append(button);
    return true;
  };
  if (!initialize()) {
    let attempts = 0;
    const retry = setInterval(() => {
      if (initialize() || ++attempts >= 20) clearInterval(retry);
    }, 250);
  }
}

function renderAuthContent(page) {
  const { title, subtitle, fields, action } = pages[page];
  root.querySelector("h1").textContent = title;
  root.querySelector(".auth-eyebrow").textContent=page==="login"?"Welcome back":page==="signup"?"Get started":"Account recovery";
  root.querySelector(".subtitle").textContent = subtitle;
  const form = root.querySelector("form");
  const button = form.querySelector("button");
  const footer = root.querySelector(".form-footer");
  button.textContent = action;
  for (const name of fields) button.before(field(name, page));

  if (page === "login" || page === "signup") {
    const divider = document.createElement("div");
    divider.className = "auth-divider";
    divider.textContent = "or";
    const google = document.createElement("div");
    google.className = "google-signin";
    google.id = "google-signin";
    form.append(divider, google);
    initGoogleSignIn(page);
  }

  if (page === "login") {
    const forgot = link("forgot-password", "Forgot password?");
    forgot.className = "forgot";
    form.querySelector('label[for="password"]').after(forgot);
    footer.append("New to Overview? ", link("signup", "Sign up"));
  } else {
    footer.append(link("login", "Back to login"));
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = validateForm(form);
    if (!values || button.disabled) return;
    setButtonLoading(button);
    try {
      await request("auth/" + page, { ...values, token: route()[1] });
      if (!form.isConnected) return;
      if (page === "forgot-password")
        form.textContent =
          "If the address matches an account, a reset link will arrive by email.";
      else if (page === "reset-password") location.hash = "/login";
      else {
        state = null;
        location.hash = "/home";
      }
    } catch (error) {
      showError(form, error);
    } finally {
      button.disabled = false;
      button.classList.remove("button-loading");
      button.textContent = action;
    }
  };
}

function showError(container, error) {
  container.querySelector("[data-error]")?.remove();
  const p = document.createElement("p");
  p.dataset.error = "";
  p.setAttribute("role", "alert");
  p.textContent = error.message;
  container.prepend(p);
}
async function request(path, data) {
  const response = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  if(!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The API returned an unexpected response (HTTP "+response.status+"). Check the deployment’s API routing and server configuration.");
  }
  let result;
  try { result=await response.json(); }
  catch { throw new Error("The API returned invalid JSON. Please retry or check the server logs."); }
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? "Request failed"), {
      status: response.status,
    });
  return result;
}
const labels = {
  home: "Home",
  projects: "Projects",
  "my-tasks": "My Tasks",
  teams: "Teams",
  activity: "Activity",
  notifications: "Notifications",
  settings: "Settings",
};
const navPaths = {
  home: "M3 10l9-7 9 7v10h-6v-7H9v7H3z",
  projects: "M3 6h7l2 2h9v12H3z",
  "my-tasks": "M5 4h14v16H5z M8 12l3 3 5-6",
  teams: "M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M3 20a8 8 0 0 1 16 0 M17 6a3 3 0 0 1 0 6 M19 15q3 1 3 5",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  notifications: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 20q2 2 4 0",
  settings: "M3 7h5m4 0h9 M3 17h11m4 0h3 M8 4h4v6H8z M14 14h4v6h-4z",
};
const descriptions = {
  home: "Here’s what’s happening across your projects today.",
  projects: "Track tasks, owners, and deadlines.",
  "my-tasks": "Everything assigned to you, all in one place.",
  teams: "Manage members, roles, and project access.",
  activity: "Task changes, comments, and work updates.",
  notifications: "Important updates and conversations that involve you.",
  settings: "Manage your personal account and workspace preferences.",
};
const stages = ["To do", "In progress", "In review", "Done"];
const priorities = ["Nice to Have", "Should Have", "Must Have"];
const priorityLabels = {
  "Nice to Have": "Low",
  "Should Have": "Medium",
  "Must Have": "High",
};
let state,
  filters = {},
  lastRoute = "",
  version = 0;
const route = () => location.hash.replace(/^#\/?/, "").split("/");
const page = () => (Object.hasOwn(labels, route()[0]) ? route()[0] : "home");
const managing = () => state.user.role !== "Member";
const indexes = new WeakMap();
function byId(rows, id) {
  if (!indexes.has(rows)) indexes.set(rows, new Map(rows.map(item => [item.id, item])));
  return indexes.get(rows).get(id);
}
let indexedTasks, tasksByProject;
function projectTasks(id) {
  if (indexedTasks !== state.tasks) {
    tasksByProject = new Map();
    for (const task of state.tasks) {
      if (!tasksByProject.has(task.project_id)) tasksByProject.set(task.project_id, []);
      tasksByProject.get(task.project_id).push(task);
    }
    indexedTasks = state.tasks;
  }
  return tasksByProject.get(id) ?? [];
}
const tasksDone = (tasks) => tasks.filter((t) => t.stage === "Done").length;
const progress = (id) => {
  const percent = byId(state.projects, id)?.percent;
  if (percent != null) return Math.round(percent);
  const rows = projectTasks(id);
  return rows.length ? Math.round((100 * tasksDone(rows)) / rows.length) : 0;
};
const projectStatus = (id) => {
  const rows = projectTasks(id);
  const percent = byId(state.projects, id)?.percent;
  return rows.length &&
    (percent == null ? tasksDone(rows) === rows.length : percent === 100)
    ? "Completed"
    : progress(id) > 0 || rows.some((t) => t.stage !== "To do")
      ? "In progress"
      : "Planning";
};
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};
const overdue = (t) => t.due_date && t.due_date < day() && t.stage !== "Done";
const deadlineFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const activityFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const date = (v) => v ? deadlineFormat.format(new Date(v.length === 10 ? v + "T12:00:00" : v)) : "No deadline";
const when = (v) => activityFormat.format(new Date(v));
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const action = (id, label, key = "", cls = "") =>
  `<button type="button" class="${cls}" data-action="${id}" data-id="${esc(key)}">${esc(label)}</button>`;
const anchor = (path, label, cls = "") =>
  `<a class="${cls}" href="#/${esc(path)}">${esc(label)}</a>`;
const none = (text) => `<p class="empty">${esc(text)}</p>`;
const panel = (title, html) =>
  `<section class="block"><h2>${esc(title)}</h2>${html}</section>`;
const stats = (items) =>
  `<dl class="project-summary">${items.map(([label, value]) => `<div class="card"><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
const table = (headers, rows, empty) =>
  rows.length
    ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable table"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : none(empty);
const options = (pairs, selected) =>
  pairs
    .map((pair) => {
      const [v, label] = Array.isArray(pair) ? pair : [pair, pair];
      return `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
const filter = (key, label, pairs) =>
  `<label class="filter">${esc(label)} <select data-filter="${key}">${options([["", "All"], ...pairs], filters[key] ?? "")}</select></label>`;
const tabs = (key, values) =>
  `<div class="tabs">${values.map(([v, label]) => `<button data-filter-key="${key}" data-value="${esc(v)}" aria-pressed="${(filters[key] ?? "") === v}">${esc(label)}</button>`).join("")}</div>`;
const projectPairs = () => state.projects.map((p) => [p.id, p.name]);
const eligible = (id) =>
  state.members.filter((m) => m.role !== "Member" || m.projects.includes(id));
function projectCards(rows) {
  if (!rows.length) return none("No projects to show.");
  return `<div class="cards">${rows.map((p) => `<article class="card"><div class="section-heading"><span class="folder-icon" aria-hidden="true"></span><button class="star-button" data-action="star" data-id="${p.id}" aria-pressed="${p.starred}" aria-label="Star ${esc(p.name)}">${p.starred ? "★" : "☆"}</button></div><h3>${anchor("projects/" + p.id, p.name)}</h3><p class="project-description">${esc(p.description)}</p><progress value="${progress(p.id)}" max="100" aria-label="Project progress"></progress><small>${projectStatus(p.id)} · ${progress(p.id)}%</small></article>`).join("")}</div>`;
}
function feed(rows) {
  return rows.length
    ? `<div class="feed card">${rows.map((e) => `<article><span class="avatar" aria-hidden="true">${esc(e.name.slice(0, 1))}</span><div><strong>${esc(e.name)}</strong> ${esc(e.message)}<small>${anchor("projects/" + e.project_id, byId(state.projects, e.project_id)?.name ?? "Project")} · ${when(e.created_at)}</small></div></article>`).join("")}</div>`
    : none("No activity to show.");
}
const taskBatchSize = 40;
const taskLimits = new Map();
function taskBatch(key, rows, renderRows) {
  const limit = taskLimits.get(key) ?? taskBatchSize;
  const more = rows.length > limit
    ? `<button type="button" class="secondary more" data-more="${key}">Show more tasks (${rows.length - limit} remaining)</button>`
    : "";
  return renderRows(rows.slice(0, limit)) + more;
}
function home() {
  const { projects, tasks, activity } = state;
  const deadlines = [
    ...tasks
      .filter((t) => t.stage !== "Done")
      .map((t) => ({ ...t, link: t.project_id })),
    ...projects
      .filter((p) => projectStatus(p.id) !== "Completed")
      .map((p) => ({ ...p, link: p.id })),
  ]
    .filter((t) => t.due_date >= day())
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  return (
    stats([
      ["Total projects", projects.length, "In this workspace"],
      [
        "In progress",
        projects.filter((p) => projectStatus(p.id) === "In progress").length,
        "Active projects",
      ],
      [
        "Completed",
        projects.filter((p) => projectStatus(p.id) === "Completed").length,
        "Finished projects",
      ],
      ["Overdue tasks", tasks.filter(overdue).length, "Past their deadline"],
    ]) +
    panel(
      "Needs your attention",
      taskBatch("attention",
        tasks
          .filter(
            (t) =>
              overdue(t) ||
              (t.due_date === day() && t.stage !== "Done") ||
              t.stage === "In review",
          )
          .sort((a, b) => Number(overdue(b)) - Number(overdue(a))),
        taskCards,
      ),
    ) +
    panel(
      "Recent projects",
      projectCards(projects.slice(0, 3)) +
        anchor("projects", "View all projects", "more"),
    ) +
    `<div class="split">${panel("Recent activity", feed(activity.slice(0, 4)))}${panel(
      "Upcoming deadlines",
      table(
        ["Work", "Due"],
        deadlines.map((t) => [
          anchor("projects/" + t.link, t.name),
          date(t.due_date),
        ]),
        "No upcoming deadlines.",
      ),
    )}</div>`
  );
}
function projectsPage() {
  const id = route()[1];
  if (id) {
    const p = byId(state.projects, id);
    if (!p) return none("This project is unavailable.");
    return (
      `<div class="project-meta">${anchor("projects", "All projects")} · ${projectStatus(id)} · ${date(p.due_date)} ${managing() ? action("project", "Edit project", id, "secondary") : ""}</div>` +
      taskView(projectTasks(id)) +
      panel(
        "Project activity",
        action("update", "Post work update", id, "secondary") +
          feed(state.activity.filter((e) => e.project_id === id)),
      )
    );
  }
  const rows = state.projects.filter(
    (p) =>
      (!filters.status || projectStatus(p.id) === filters.status) &&
      (!filters.star || p.starred),
  );
  return (
    `<div class="toolbar">${tabs(
      "status",
      ["", "Planning", "In progress", "Completed"].map((s) => [
        s,
        s || "All projects",
      ]),
    )}${filter("star", "Show", [["star", "Starred"]])}</div>` +
    projectCards(rows.slice(0, 3)) +
    panel(
      "All projects",
      table(
        ["Project", "Status", "Progress", "Tasks done", "Due date"],
        rows.map((p) => [
          anchor("projects/" + p.id, p.name),
          projectStatus(p.id),
          progress(p.id) + "%",
          tasksDone(projectTasks(p.id)) + " / " + projectTasks(p.id).length,
          date(p.due_date),
        ]),
        "No matching projects.",
      ),
    )
  );
}
function taskView(source) {
  const rows = source.filter(
    (t) =>
      (!filters.stage || t.stage === filters.stage) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.project || t.project_id === filters.project) &&
      (!filters.assignee || t.assignee === filters.assignee) &&
      (!filters.due ||
        (filters.due === "overdue"
          ? overdue(t)
          : t.due_date >= day() && t.due_date <= day(6) && t.stage !== "Done")),
  );
  rows.sort((a, b) =>
    filters.sort === "priority"
      ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
      : filters.sort === "name"
        ? a.name.localeCompare(b.name)
        : filters.sort === "due"
          ? (a.due_date || "9999").localeCompare(b.due_date || "9999")
          : 0,
  );
  function stageControl(t) {
    if (!managing() && t.assignee !== state.user.id) return esc(t.stage);
    return `<select data-stage="${t.id}" ${pendingMoves.has(t.id) ? "disabled" : ""} aria-label="Status for ${esc(t.name)}">${options(stages, t.stage)}</select>`;
  }
  const open = (t) => action("task", t.name, t.id, "text-button");
  const person = (t) =>
    esc(byId(state.members, t.assignee)?.name ?? "Unassigned");
  const board = filters.view === "board";
  return (
    `<div class="toolbar">${tabs("view", [
      ["", "List"],
      ["board", "Board"],
    ])}${filter("stage", "Status", stages)}${filter(
      "priority",
      "Priority",
      priorities.map((p) => [p, priorityLabels[p]]),
    )}${filter("due", "Deadline", [
      ["overdue", "Overdue"],
      ["week", "Next 7 days"],
    ])}${
      page() === "my-tasks"
        ? filter("project", "Project", projectPairs())
        : filter(
            "assignee",
            "Assignee",
            eligible(route()[1]).map((m) => [m.id, m.name]),
          )
    }${filter("sort", "Sort", [
      ["due", "Deadline"],
      ["priority", "Priority"],
      ["name", "Name"],
    ])}${savedViewControls()}</div>` +
    (board
      ? `<div class="board">${stages
          .map(
            (s) =>
              `<section data-drop-stage="${s}"><h2>${s} <small>${rows.filter((t) => t.stage === s).length}</small></h2>${
                taskBatch(s, rows.filter((t) => t.stage === s), batch => batch
                  .map(
                    (t) =>
                      `<article class="card" draggable="${!pendingMoves.has(t.id) && (managing() || t.assignee === state.user.id)}" data-drag-task="${t.id}">${open(t)}<p>${priorityLabels[t.priority]} · ${person(t)}</p><small>${date(t.due_date)}</small>${stageControl(t)}</article>`,
                  )
                  .join("") || none("No tasks"))
              }</section>`,
          )
          .join("")}</div>`
      : taskBatch("list", rows, batch => `<div class="mobile-task-list">${taskCards(batch)}</div><div class="desktop-task-list">` +
        table(
          ["Task", "Project", "Priority", "Assignee", "Status", "Due date"],
          batch.map((t) => [
            open(t),
            anchor(
              "projects/" + t.project_id,
              byId(state.projects, t.project_id).name,
            ),
            priorityLabels[t.priority],
            person(t),
            stageControl(t),
            date(t.due_date),
          ]),
          "No tasks match this view.",
        ) +
        "</div>"))
  );
}
function myTasks() {
  const rows = state.tasks.filter((t) => t.assignee === state.user.id);
  return (
    stats([
      ["Assigned to me", rows.length, "Across your projects"],
      [
        "Due soon",
        rows.filter(
          (t) =>
            t.due_date >= day() && t.due_date <= day(6) && t.stage !== "Done",
        ).length,
        "Next seven days",
      ],
      ["Completed", tasksDone(rows), "Finished tasks"],
      ["Overdue", rows.filter(overdue).length, "Require attention"],
    ]) + taskView(rows)
  );
}

function teams() {
  const { members, invitations, tasks } = state;
  const manage = state.user.role === "Owner";
  return (
    stats([
      ["Team members", members.length, "Workspace members"],
      [
        "Managers",
        members.filter((m) => m.role === "Manager").length,
        "Coordinating delivery",
      ],
      [
        "Open assignments",
        tasks.filter((t) => t.assignee && t.stage !== "Done").length,
        "Across visible projects",
      ],
      manage
        ? ["Pending invitations", invitations.length, "Waiting to join"]
        : ["Projects", state.projects.length, "In your view"],
    ]) +
    `<div class="toolbar">${filter("role", "Role", ["Owner", "Manager", "Member"])}${action("accept", "Join with an invitation", "", "secondary")}</div><div class="cards">${members
      .filter((m) => !filters.role || m.role === filters.role)
      .map(
        (m) =>
          `<article class="card"><div class="member"><span class="avatar">${esc(m.name.slice(0, 1))}</span><div><h3>${esc(m.name)}</h3><small>${esc(m.job_title || m.role)}</small></div></div><hr><small>${esc(m.role)} · ${tasks.filter((t) => t.assignee === m.id && t.stage !== "Done").length} active tasks</small><p>${manage && m.role !== "Owner" ? action("member", "Manage member", m.id, "text-button") : esc(m.email)}</p></article>`,
      )
      .join("")}</div>` +
    (manage
      ? panel(
          "Pending invitations",
          table(
            ["Email", "Role", "Expires", "Action"],
            invitations.map((i) => [
              esc(i.email),
              i.role,
              date(i.expires_at),
              action("revoke", "Revoke", i.email, "text-button"),
            ]),
            "No pending invitations.",
          ),
        )
      : "")
  );
}
function activityPage() {
  const cutoff = Date.now() - Number(filters.period || 0) * 86400000;
  const rows = state.activity.filter(
    (e) =>
      (!filters.mine || e.actor === state.user.id) &&
      (!filters.project || e.project_id === filters.project) &&
      (!filters.kind || e.kind === filters.kind) &&
      (!filters.period || new Date(e.created_at) >= cutoff),
  );
  const week = state.activity.filter(
    (e) => Date.now() - new Date(e.created_at) < 7 * 86400000,
  );
  return `<div class="toolbar">${tabs("mine", [
    ["", "All activity"],
    ["me", "My activity"],
  ])}${filter("project", "Project", projectPairs())}${filter("kind", "Type", ["Created", "Assignment", "Task update", "Comment", "Work update", "Project"])}${filter(
    "period",
    "Period",
    [
      ["7", "Last 7 days"],
      ["30", "Last 30 days"],
    ],
  )}</div><div class="split">${feed(rows)}<aside class="card glance"><h2>This week at a glance</h2><strong>${week.length}</strong><p>Recorded team actions</p><hr><p>${week.filter((e) => e.kind === "Comment").length} comments</p><p>${week.filter((e) => e.kind === "Task update").length} task updates</p></aside></div>`;
}
function notificationsPage() {
  const rows = state.notifications.filter(
    (n) =>
      (!filters.unread || !n.seen) &&
      (!filters.kind || n.kind === filters.kind),
  );
  return (
    `<div class="toolbar">${tabs("unread", [
      ["", "All"],
      ["yes", "Unread"],
    ])}${filter("kind", "Type", ["Assignment", "Mention", "Completion"])}</div>` +
    (rows.length
      ? `<div class="feed card">${rows.map((n) => `<article><span class="avatar">${n.seen ? "✓" : "!"}</span><div><strong>${esc(n.kind)}</strong><p>${esc(n.name)} ${esc(n.message)}</p><small>${when(n.created_at)} · ${anchor("projects/" + n.project_id, "Open project")}</small></div>${n.seen ? "" : action("read", "Mark read", n.id, "secondary")}</article>`).join("")}</div>`
      : none("No notifications to show."))
  );
}
function input(key, label, value = "", type = "text", required = true) {
  return `<label>${esc(label)}<input name="${key}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "password" ? 'minlength="8" maxlength="256"' : ""}></label>`;
}
function select(key, label, pairs, value) {
  return `<label>${esc(label)}<select name="${key}">${options(pairs, value)}</select></label>`;
}
const check = (key, label, on, val = "on", disabled = false) =>
  `<label class="check"><input type="checkbox" name="${key}" value="${esc(val)}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}>${esc(label)}</label>`;
const form = (type, children, submit, id = "") =>
  `<form data-form="${type}" data-id="${esc(id)}">${children}<button>${esc(submit)}</button></form>`;
function browserProjects() {
  try {
    const rows = JSON.parse(localStorage.getItem("overviewProjects"));
    return Array.isArray(rows)
      ? rows.filter(
          (p) =>
            typeof p?.name === "string" &&
            /^\d{4}-\d\d-\d\dT/.test(p.time) &&
            Number.isFinite(Date.parse(p.time)),
        )
      : [];
  } catch {
    return [];
  }
}
function settings() {
  const u = state.user;
  const tab = filters.tab ?? "";
  let html;
  if (tab === "workspace")
    html =
      form(
        "switch",
        select(
          "workspace",
          "Active workspace",
          state.spaces.map((s) => [s.id, s.name]),
          u.workspace,
        ),
        "Switch workspace",
      ) +
      (u.role === "Owner"
        ? form(
            "workspace",
            input("name", "Workspace name", u.workspace_name),
            "Save workspace",
          )
        : "");
  else if (tab === "appearance")
    html = `<label>Theme <select data-theme-picker>${options([["light","Light"],["dark","Dark"],["system","System"]], themePreference)}</select></label>`;
  else if (tab === "preferences")
    html = form(
      "preferences",
      check("in_app", "In-app alerts", u.in_app) +
        check(
          "email_alerts",
          "Email alerts",
          u.email_alerts,
          "on",
          !state.mailEnabled,
        ) +
        (state.mailEnabled
          ? ""
          : "<small>Email delivery is unavailable in this installation.</small>"),
      "Save preferences",
    );
  else if (tab === "security")
    html = form(
      "password",
      input("current", "Current password", "", "password") +
        input("password", "New password", "", "password"),
      "Change password",
    );
  else
    html =
      `<div class="member"><span class="avatar">${esc(u.name.slice(0, 1))}</span><strong>${esc(u.email)}</strong></div>` +
      form(
        "profile",
        input("name", "Full name", u.name) +
          input("job_title", "Job title", u.job_title, "text", false),
        "Save profile",
      );
  const panes = [
    ["", "Personal profile"],
    ["workspace", "Workspace settings"],
    ["appearance", "Appearance"],
    ["preferences", "Notification preferences"],
    ["security", "Account security"],
  ];
  if (tab === "security" && state.legacyProjects)
    html += `<p>Earlier projects are associated with your email. Verify ownership through password recovery to move them into your personal workspace.</p>${anchor("forgot-password", "Recover earlier projects")}`;
  if (tab === "workspace" && u.role === "Owner" && browserProjects().length)
    html += form(
      "import",
      `<fieldset><legend>Projects saved in this browser</legend>${browserProjects()
        .map((p, i) => check("legacy", p.name, false, i))
        .join("")}</fieldset>`,
      "Import selected projects",
    );
  return `<div class="settings-grid">${tabs("tab", panes)}<section class="card"><h2>${panes.find(([v]) => v === tab)[1]}</h2>${html}</section></div>`;
}
const screens = {
  home,
  projects: projectsPage,
  "my-tasks": myTasks,
  teams,
  activity: activityPage,
  notifications: notificationsPage,
  settings,
};
function elementKey(node) {
  if (node.nodeType !== 1) return node.nodeName;
  const task = node.matches("article,tr")
    ? node.querySelector('[data-action="task"]')
    : null;
  return (
    node.tagName +
    "|" +
    (node.id ||
      node.dataset.form ||
      node.getAttribute("name") ||
      (task ? "task:" + task.dataset.id : "") ||
      node.getAttribute("data-stage") ||
      node.getAttribute("data-filter") ||
      node.getAttribute("data-drop-stage") ||
      (node.dataset.action
        ? node.dataset.action + ":" + node.dataset.id
        : "") ||
      node.getAttribute("href") ||
      node.className)
  );
}
function updateChildren(target, source) {
  const available = new Map();
  for (const node of Array.from(target.childNodes).reverse()) {
    const key = elementKey(node);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(node);
  }
  let cursor = target.firstChild;
  for (const desired of Array.from(source.childNodes)) {
    const existing = available.get(elementKey(desired))?.pop();
    const current = existing ?? desired.cloneNode(true);
    if (current !== cursor) target.insertBefore(current, cursor);
    if (existing) {
      if (current.nodeType === 3) {
        if (current.nodeValue !== desired.nodeValue)
          current.nodeValue = desired.nodeValue;
      } else if (current.nodeType === 1 && !current.isEqualNode(desired)) {
        for (const attr of Array.from(current.attributes))
          if (!desired.hasAttribute(attr.name))
            current.removeAttribute(attr.name);
        for (const attr of Array.from(desired.attributes))
          if (current.getAttribute(attr.name) !== attr.value)
            current.setAttribute(attr.name, attr.value);
        updateChildren(current, desired);
      }
      if (current.tagName === "SELECT") current.value = desired.value;
      if (current.tagName === "INPUT") {
        if (current.value !== desired.value) current.value = desired.value;
        current.checked = desired.checked;
      }
    }
    cursor = current.nextSibling;
  }
  for (const nodes of available.values())
    for (const node of nodes) node.remove();
}
function updateMarkup(target, html, incremental) {
  if (!incremental) {
    target.innerHTML = html;
    return;
  }
  const fragment = document.createElement("template");
  fragment.innerHTML = html;
  updateChildren(target, fragment.content);
}
function paint(incremental = false) {
  root.removeAttribute("aria-busy");
  const current = page(),
    u = state.user,
    project = current === "projects" && byId(state.projects, route()[1]);
  const unread = state.notifications.filter((n) => !n.seen).length;
  root.querySelector(".top-links a").textContent = unread
    ? "Notifications (" + unread + ")"
    : "Notifications";
  document.querySelector("#space-name").textContent = u.workspace_name;
  document.querySelector("#space-role").textContent = u.role + " · Workspace";
  document.querySelector("#current-view").textContent = labels[current];
  updateMarkup(
    document.querySelector("nav"),
    Object.entries(labels)
      .map(
        ([id, label]) =>
          `<a class="nav-link" href="#/${id}" ${current === id ? 'aria-current="page"' : ""}><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="${navPaths[id]}"/></svg>${label}${id === "notifications" && unread ? ` <b>${unread}</b>` : ""}</a>`,
      )
      .join(""),
    true,
  );
  let primary = "";
  if (managing() && (current === "home" || current === "projects"))
    primary = project
      ? action("task", "＋ New task")
      : action("project", "＋ New project");
  if (current === "teams" && u.role === "Owner")
    primary = action("invite", "＋ Invite member");
  if (current === "notifications" && unread)
    primary = action("read", "Mark all as read");
  const title = project
    ? project.name
    : current === "home"
      ? "Your work today"
      : current === "activity"
        ? "Team Activity"
        : labels[current];
  document.title = title + " | Overview";
  updateMarkup(
    document.querySelector("#content"),
    `<div class="section-heading"><div><h1>${esc(title)}</h1><p class="subtitle">${esc(project ? project.description : descriptions[current])}</p></div>${primary}</div>` +
      screens[current](),
    incremental,
  );
}
function dialog(title, html) {
  const modal = document.querySelector("dialog");
  document.querySelector("#dialog-title").textContent = title;
  document.querySelector("#dialog-content").innerHTML = html;
  if (!modal.open) modal.showModal();
}
let lastSynced = 0;
let syncingVersion;
const pendingMoves = new Map();
async function refresh(preserveDrafts = false) {
  const seq = ++version;
  syncingVersion = seq;
  let next;
  try {
    if (!state) {
      root.className = "skeleton-app";
      root.replaceChildren(loadingScreen);
    }
    root.setAttribute("aria-busy", "true");
    next = await request("workspace/state");
  } catch (error) {
    if (seq !== version) return;
    root.removeAttribute("aria-busy");
    throw error;
  } finally {
    if (syncingVersion === seq) syncingVersion = undefined;
  }
  if (seq !== version) return;
  if (next.user.id !== state?.user.id) {
    try {
      applyTheme(localStorage.getItem("overview.theme." + next.user.id));
      localStorage.setItem("overview.theme", themePreference);
    } catch {}
  }
  state = next;
  for (const [id, move] of pendingMoves) {
    const task = byId(state.tasks, id);
    if (task) task.stage = move.stage;
  }
  lastSynced = Date.now();
  root.removeAttribute("aria-busy");
  if (root.className !== "dashboard") {
    root.className = "dashboard";
    root.replaceChildren(template("dashboard"));
    root.querySelector(".wordmark").textContent = "Overview";
    setDrawer(false);
  }
  if (
    !preserveDrafts ||
    !root.querySelector('#content form[data-dirty="true"]')
  )
    paint(true);
}
function auth(pageName) {
  root.removeAttribute("aria-busy");
  root.className = "auth";
  root.replaceChildren(template("auth"));
  root.querySelector(".wordmark").textContent = "Overview";
  document.title = pages[pageName].title + " | Overview";
  renderAuthContent(pageName);
}
const mobileNavigation = matchMedia("(max-width:45rem)");
function setDrawer(open) {
  const sidebar = root.querySelector("#workspace-sidebar");
  if (!sidebar) return;
  const toggle = root.querySelector(".menu-toggle");
  const restoreFocus = sidebar.contains(document.activeElement);
  sidebar.classList.toggle("is-open", open);
  sidebar.inert = mobileNavigation.matches && !open;
  root.querySelector(".dashboard-main").inert = open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open) {
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    sidebar.querySelector(".drawer-close").focus();
  } else {
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    if (mobileNavigation.matches && restoreFocus) toggle.focus();
  }
}
mobileNavigation.addEventListener("change", () => setDrawer(false));
root.addEventListener("keydown", (event) => {
  const sidebar = event.target.closest(".sidebar.is-open");
  if (!sidebar) return;
  if (event.key === "Escape") setDrawer(false);
  if (event.key !== "Tab") return;
  const controls = sidebar.querySelectorAll("button:enabled, a[href]");
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
});
async function render() {
  const requested = route()[0];
  const changed = lastRoute !== location.hash;
  if (changed) {
    taskLimits.clear();
    filters = {};
    lastRoute = location.hash;
  }
  root.querySelector("dialog[open]")?.close();
  setDrawer(false);
  if (Object.hasOwn(pages, requested)) {
    version++;
    auth(requested);
    return;
  }
  if (state && root.className === "dashboard") {
    paint();
    if (changed) {
      document.querySelector("#content").focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    if (Date.now() - lastSynced > 30000 && syncingVersion === undefined)
      refresh(true).catch(handleError);
    return;
  }
  try {
    await refresh();
  } catch (error) {
    if (error.status === 401) {
      state = null;
      location.hash = "/login";
    } else {
      root.replaceChildren();
      root.className = "";
      root.innerHTML = action("retry", "Retry loading workspace");
      showError(root, error);
    }
  }
}
function editor(type, id) {
  if (type === "project") {
    const p = byId(state.projects, id) ?? {};
    dialog(
      id ? "Edit project" : "New project",
      form(
        type,
        input("name", "Project name", p.name) +
          input("description", "Description", p.description, "text", false) +
          input("due_date", "Deadline", p.due_date, "date", false),
        id ? "Save changes" : "Create project",
        id,
      ) +
        (id ? action("delete-project", "Delete project", id, "secondary") : ""),
    );
  } else if (type === "task") {
    const t = byId(state.tasks, id) ?? {},
      project = t.project_id ?? route()[1];
    const people = eligible(project).map((m) => [m.id, m.name]);
    let fields = managing()
      ? input("name", "Task name", t.name) +
        select(
          "priority",
          "Priority",
          priorities.map((p) => [p, priorityLabels[p]]),
          t.priority ?? "Should Have",
        ) +
        select(
          "assignee",
          "Assignee",
          [["", "Unassigned"], ...people],
          t.assignee,
        ) +
        input("due_date", "Deadline", t.due_date, "date", false)
      : "";
    fields += select("stage", "Status", stages, t.stage) + taskDetailFields(t);
    const edit = managing() || t.assignee === state.user.id;
    const info = edit
      ? form("task", fields, id ? "Save task" : "Create task", id)
      : `<p>${esc(t.description)}</p><ul>${(t.checklist ?? []).map((item) => `<li>${item.done ? "Completed" : "Open"} · ${esc(item.text)}</li>`).join("")}</ul>` +
        none(
          t.stage +
            " · " +
            priorityLabels[t.priority] +
            " · " +
            date(t.due_date),
        );
    const comments = id
      ? panel(
          "Comments",
          feed(
            state.activity.filter(
              (e) => e.node_id === id && e.kind === "Comment",
            ),
          ) +
            form(
              "comment",
              input("message", "Comment") +
                select("mention", "Mention a member", [
                  ["", "No mention"],
                  ...people,
                ]),
              "Post comment",
              id,
            ),
        )
      : "";
    dialog(
      t.name ?? "New task",
      info +
        attachmentPanel(t, edit) +
        comments +
        (id && managing()
          ? action("delete-task", "Delete task", id, "secondary")
          : ""),
    );
  } else if (type === "invite")
    dialog(
      "Invite member",
      form(
        type,
        input("email", "Email address", "", "email") +
          select("role", "Workspace role", ["Member", "Manager"]),
        "Create invitation",
      ),
    );
  else if (type === "accept")
    dialog(
      "Join a workspace",
      form(type, input("code", "Invitation code"), "Join workspace"),
    );
  else if (type === "member") {
    const m = byId(state.members, id);
    dialog(
      m.name,
      form(
        type,
        select("role", "Role", ["Member", "Manager"], m.role) +
          `<fieldset><legend>Project assignments</legend>${state.projects.map((p) => check("projects", p.name, m.projects.includes(p.id), p.id)).join("") || "No projects yet."}</fieldset>`,
        "Save member",
        id,
      ) + action("remove", "Remove from workspace", id, "secondary"),
    );
  } else if (type === "update")
    dialog(
      "Post work update",
      form(type, input("message", "Work update"), "Post update", id),
    );
}
async function mutate(path, values) {
  const destination = location.hash;
  const result = await request(path, values);
  if (root.className !== "dashboard") return result;
  await refresh(location.hash !== destination);
  return result;
}
root.addEventListener("click", async (event) => {
  if (event.target.closest("dialog a[href]"))
    root.querySelector("dialog").close();
  if (event.target.closest("#close-dialog")) {
    root.querySelector("dialog").close();
    return;
  }
  const menu = event.target.closest(".menu-toggle");
  if (menu) {
    setDrawer(true);
    return;
  }
  if (event.target.closest(".drawer-close, .drawer-backdrop, .sidebar.is-open a[href]")) setDrawer(false);
  const tab = event.target.closest("[data-filter-key]");
  const more = event.target.closest("[data-more]");
  if (more) {
    const key = more.dataset.more;
    const previous = taskLimits.get(key) ?? taskBatchSize;
    taskLimits.set(key, previous + taskBatchSize);
    const section = more.closest("[data-drop-stage], .block, #content");
    paint(true);
    const list = key === "list"
      ? section.querySelector(matchMedia("(max-width:45rem)").matches ? ".mobile-task-list" : ".desktop-task-list")
      : section;
    const firstNew = list?.querySelectorAll('[data-action="task"]')[previous];
    firstNew?.focus({ preventScroll: true });
    return;
  }
  if (tab) {
    if (tab.getAttribute("aria-pressed") === "true") return;
    taskLimits.clear();
    filters[tab.dataset.filterKey] = tab.dataset.value;
    paint(true);
    return;
  }
  const btn = event.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const { action: type, id } = btn.dataset;
  btn.disabled = true;
  try {
    if (type === "retry") await render();
    else if (type === "logout") {
      await request("auth/logout", {});
      state = null;
      location.hash = "/login";
    } else if (type === "star")
      await mutate("workspace/star", {
        project_id: id,
        starred: !byId(state.projects, id).starred,
      });
    else if (type === "read")
      await mutate("workspace/read", { id: id || null });
    else if (type === "revoke") {
      if (confirm("Revoke this invitation?"))
        await mutate("workspace/revoke", { email: id });
    } else if (type === "delete-project" || type === "delete-task") {
      const project = type === "delete-project";
      const item = byId(project ? state.projects : state.tasks, id);
      if (
        confirm(
          "Permanently delete " +
            item.name +
            (project ? " and its tasks, comments and activity" : "") +
            "?",
        )
      ) {
        await mutate("workspace/" + type, {
          id,
          project_id: project ? id : item.project_id,
        });
        root.querySelector("dialog").close();
        if (project) location.hash = "/projects";
      }
    } else if (type === "remove") {
      if (confirm("Remove this member and clear their assignments?")) {
        await mutate("workspace/member", { id, remove: true });
        root.querySelector("dialog").close();
      }
    } else if (type === "add-check") {
      const list = btn.closest("fieldset").querySelector("[data-checklist]");
      if (list.children.length >= 100)
        throw Error("Use up to 100 checklist items");
      list.insertAdjacentHTML("beforeend", checklistRow());
      list.lastElementChild.querySelector("input[type=text]").focus();
    } else if (type === "remove-check") btn.closest("[data-check-row]").remove();
    else if (type === "save-view")
      dialog(
        "Save current view",
        form("save-view", input("name", "View name"), "Save view"),
      );
    else if (type === "delete-view" && confirm("Delete this saved view?")) {
      await mutate("workspace/delete-view", { name: id });
      delete filters.saved;
      paint();
    } else if (type === "undo-move" && undoMove) {
      const move = undoMove;
      await mutate("workspace/task", move);
      if (undoMove === move) undoMove = null;
    } else if (type === "download" || type === "delete-attachment") {
      const file = byId(state.attachments, id),
        task = byId(state.tasks, file.node_id);
      const values = {
        id: task.id,
        project_id: task.project_id,
        attachment_id: id,
      };
      if (type === "download") {
        const result = await request("workspace/download", values);
        const bytes = Uint8Array.from(
          atob(result.content.replace(/\s/g, "")),
          (c) => c.charCodeAt(0),
        );
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = result.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else if (confirm("Remove this attachment?")) {
        await mutate("workspace/delete-attachment", values);
        refreshTaskDialog(task.id);
      }
    } else editor(type, id);
  } catch (error) {
    handleError(error);
  } finally {
    btn.disabled = false;
  }
});
function handleError(error) {
  if (error.status === 401) {
    state = null;
    location.hash = "/login";
    return;
  }
  showError(
    root.querySelector("dialog[open] #dialog-content") ??
      root.querySelector("#content") ??
      root,
    error,
  );
}
root.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.matches("[data-theme-picker]")) {
    applyTheme(el.value);
    try {
      localStorage.setItem("overview.theme." + state.user.id, themePreference);
      localStorage.setItem("overview.theme", themePreference);
    } catch { saveFeedback("Theme applied for this session. Browser storage is unavailable."); }
    return;
  }
  if (el.dataset.filter) {
    taskLimits.clear();
    filters[el.dataset.filter] = el.value;
    paint(true);
  }
  if (el.dataset.stage) {
    const t = byId(state.tasks, el.dataset.stage);
    el.disabled = true;
    try {
      await moveTask(t, el.value);
    } catch (error) {
      handleError(error);
    } finally {
      el.disabled = false;
    }
  }
});
root.addEventListener("submit", async (event) => {
  const f = event.target;
  if (f.id === "search-form") {
    event.preventDefault();
    const query = f.elements.q.value.trim().toLowerCase();
    const projects = state.projects.filter((p) =>
      (p.name + " " + p.description).toLowerCase().includes(query),
    );
    const tasks = state.tasks.filter((t) =>
      t.name.toLowerCase().includes(query),
    );
    dialog(
      "Search results",
      panel("Projects", projectCards(projects)) +
        panel(
          "Tasks",
          table(
            ["Task", "Project"],
            tasks.map((t) => [
              action("task", t.name, t.id, "text-button"),
              anchor(
                "projects/" + t.project_id,
                byId(state.projects, t.project_id).name,
              ),
            ]),
            "No matching tasks.",
          ),
        ),
    );
    return;
  }
  if (!f.dataset.form) return;
  event.preventDefault();
  const btn =
    event.submitter ??
    f.querySelector("button:not([type]),button[type=submit]");
  if (!btn) return;
  if (btn.disabled) return;
  btn.disabled = true;
  const caption = btn.textContent;
  btn.textContent = "Saving...";
  const type = f.dataset.form,
    id = f.dataset.id,
    fd = new FormData(f),
    d = Object.fromEntries(fd);
  let path = "workspace/" + type;
  if (id) d.id = id;
  if (type === "save-view") d.filters = { ...filters };
  if (type === "project" && !id) {
    path = "projects";
    d.areas = ["Progress"];
    d.groups = ["Tasks"];
  }
  if ((type === "project" && id) || type === "update") d.project_id = id;
  if (type === "task" || type === "comment")
    d.project_id = byId(state.tasks, id)?.project_id ?? route()[1];
  if (type === "task") {
    d.checklist = Array.from(f.querySelectorAll("[data-check-row]"))
      .map((row) => ({
        text: row.querySelector("input[type=text]").value.trim(),
        done: row.querySelector("input[type=checkbox]").checked,
      }))
      .filter((item) => item.text);
  }
  if (type === "member") d.projects = fd.getAll("projects");
  if (type === "import")
    d.projects = fd.getAll("legacy").map((i) => browserProjects()[Number(i)]);
  if (type === "preferences") {
    d.in_app = fd.has("in_app");
    d.email_alerts = fd.has("email_alerts");
  }
  if (type === "password") path = "auth/password";
  const destination = location.hash;
  const modal = f.closest("dialog");
  try {
    const result = await mutate(path, d);
    if (location.hash !== destination || root.className !== "dashboard" ||
        (modal && (!modal.open || !f.isConnected))) return;
    if (type === "invite")
      dialog(
        "Invitation ready",
        `<p>Share this code privately with ${esc(d.email)}. They can enter it under Teams after signing in.</p><label>Invitation code<input readonly value="${esc(result.code)}"></label>`,
      );
    else if (type === "comment") refreshTaskDialog(id, true);
    else {
      modal?.close();
      if (type === "project" && !id) location.hash = "/projects/" + result.id;
      else {
        saveFeedback("Changes saved.");
      }
    }
  } catch (error) {
    handleError(error);
  } finally {
    btn.disabled = false;
    btn.textContent = caption;
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});
root.addEventListener("input", (event) => {
  const form = event.target.closest("#content form");
  if (form) form.dataset.dirty = "true";
});
let checkingAlerts = false;
async function checkAlerts() {
  if (
    checkingAlerts ||
    document.hidden ||
    !state ||
    root.className !== "dashboard"
  )
    return;
  checkingAlerts = true;
  const active = state;
  try {
    const { count, latest } = await request("workspace/unread");
    if (state !== active || root.className !== "dashboard") return;
    const unread = state.notifications.filter((n) => !n.seen);
    const label = root.querySelector(".top-links a");
    label.textContent = count
      ? "Notifications (" + count + ")"
      : "Notifications";
    if (
      page() === "notifications" &&
      (count !== unread.length || latest !== (unread[0]?.id ?? null))
    )
      await refresh();
  } catch (error) {
    if (error.status === 401) handleError(error);
  } finally {
    checkingAlerts = false;
  }
}
window.setInterval(checkAlerts, 45000);
window.addEventListener("focus", checkAlerts);
function taskCards(rows) {
  return rows.length
    ? '<div class="task-cards">' +
        rows
          .map(
            (t) =>
              '<article class="card">' +
              action("task", t.name, t.id, "text-button") +
              "<p>" +
              esc(byId(state.projects, t.project_id)?.name) +
              "</p><p>" +
              esc(byId(state.members, t.assignee)?.name ?? "Unassigned") +
              " · " +
              priorityLabels[t.priority] +
              '</p><p class="' +
              (overdue(t) ? "overdue" : "") +
              '">' +
              (overdue(t) ? "Overdue · " : "") +
              date(t.due_date) +
              "</p>" +
              (managing() || t.assignee === state.user.id
                ? '<label>Status<select data-stage="' +
                  t.id +
                  '"' +
                  (pendingMoves.has(t.id) ? " disabled" : "") +
                  ">" +
                  options(stages, t.stage) +
                  "</select></label>"
                : esc(t.stage)) +
              "</article>",
          )
          .join("") +
        "</div>"
    : none("You’re all caught up.");
}
function savedViewControls() {
  return (
    "<label>Saved view<select data-saved-view>" +
    options(
      [
        ["", "Choose a view"],
        ...(state.savedViews ?? []).map((v) => [v.name, v.name]),
      ],
      filters.saved ?? "",
    ) +
    "</select></label>" +
    action("save-view", "Save view", "", "secondary") +
    (filters.saved
      ? action("delete-view", "Delete saved view", filters.saved, "secondary")
      : "")
  );
}
function checklistRow(item = { text: "", done: false }) {
  return (
    '<div data-check-row class="check-row"><input type="checkbox" aria-label="Checklist item complete" ' +
    (item.done ? "checked" : "") +
    '><input type="text" aria-label="Checklist item" maxlength="500" value="' +
    esc(item.text) +
    '">' +
    action("remove-check", "Remove", "", "text-button") +
    "</div>"
  );
}
function taskDetailFields(t) {
  return (
    '<label>Description<textarea name="description" maxlength="20000" rows="4">' +
    esc(t.description) +
    "</textarea></label><fieldset><legend>Checklist</legend><div data-checklist>" +
    (t.checklist ?? []).map(checklistRow).join("") +
    "</div>" +
    action("add-check", "Add checklist item", "", "secondary") +
    "</fieldset>"
  );
}
function refreshTaskDialog(id, commentPosted = false) {
  const modal = root.querySelector("dialog[open]");
  if (!modal) return;
  const draft = modal.querySelector('form[data-form="task"]');
  const comment = modal.querySelector('form[data-form="comment"]');
  if ((draft ?? comment)?.dataset.id !== id) return;
  editor("task", id);
  if (draft) modal.querySelector('form[data-form="task"]')?.replaceWith(draft);
  if (comment && !commentPosted)
    modal.querySelector('form[data-form="comment"]')?.replaceWith(comment);
}
function attachmentPanel(t, edit) {
  if (!t.id) return "";
  return panel(
    "Attachments",
    (state.attachments ?? [])
      .filter((a) => a.node_id === t.id)
      .map(
        (a) =>
          '<div class="attachment">' +
          action("download", a.name, a.id, "text-button") +
          (edit
            ? action("delete-attachment", "Remove", a.id, "text-button")
            : "") +
          "</div>",
      )
      .join("") +
      (edit
        ? '<label>Attach a file (up to 1 MB)<input type="file" data-upload="' +
          t.id +
          '"></label>'
        : ""),
  );
}
let undoMove;
async function moveTask(task, stage) {
  if (task.stage === stage || pendingMoves.has(task.id)) return;
  const previous = task.stage;
  const workspace = state.user.workspace;
  const destination = location.hash;
  pendingMoves.set(task.id, { stage });
  task.stage = stage;
  paint(true);
  saveFeedback("Saving task...");
  try {
    await request("workspace/task", {
      id: task.id,
      project_id: task.project_id,
      stage,
      expected_stage: previous,
    });
  } catch (error) {
    pendingMoves.delete(task.id);
    if (state?.user.workspace === workspace) {
      const current = byId(state.tasks, task.id);
      if (current) current.stage = previous;
      if (root.className === "dashboard") paint(true);
    }
    saveFeedback("Task could not be saved. Your change was reverted.");
    throw error;
  }
  pendingMoves.delete(task.id);
  if (state?.user.workspace !== workspace || root.className !== "dashboard")
    return;
  saveFeedback(pendingMoves.size ? "Saving tasks..." : "Task saved");
  try {
    await refresh(true);
  } catch (error) {
    if (error.status === 401) {
      handleError(error);
      return;
    }
    if (root.className === "dashboard" && state?.user.workspace === workspace) paint(true);
    saveFeedback("Task saved. Refresh to load the latest totals.");
  }
  if (location.hash !== destination || state?.user.workspace !== workspace || root.className !== "dashboard") return;
  undoMove = {
    id: task.id,
    project_id: task.project_id,
    stage: previous,
    expected_stage: stage,
  };
  const notice = document.createElement("div");
  root.querySelector('[data-action="undo-move"]')?.closest(".notice")?.remove();
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.innerHTML =
    esc(task.name + " moved to " + stage) +
    " " +
    action("undo-move", "Undo", "", "text-button");
  root.querySelector("#content")?.prepend(notice);
}
let feedbackTimer;
function saveFeedback(message) {
  clearTimeout(feedbackTimer);
  let status = document.getElementById("save-feedback");
  if (!status) {
    status = document.createElement("div");
    status.id = "save-feedback";
    status.setAttribute("role", "status");
    document.body.append(status);
  }
  status.textContent = message;
  if (!pendingMoves.size)
    feedbackTimer = setTimeout(() => status.remove(), 5000);
}
root.addEventListener("dragstart", (event) => {
  const card = event.target.closest('[data-drag-task][draggable="true"]');
  if (card) {
    event.dataTransfer.setData("text/plain", card.dataset.dragTask);
    event.dataTransfer.effectAllowed = "move";
  }
});
root.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-drop-stage]")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
});
root.addEventListener("drop", async (event) => {
  const column = event.target.closest("[data-drop-stage]");
  if (!column) return;
  event.preventDefault();
  const task = byId(state.tasks, event.dataTransfer.getData("text/plain"));
  if (!task) return;
  try {
    await moveTask(task, column.dataset.dropStage);
  } catch (error) {
    handleError(error);
  }
});
root.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.matches("[data-saved-view]")) {
    taskLimits.clear();
    const view = state.savedViews.find((v) => v.name === el.value);
    filters = view ? { ...view.filters, saved: view.name } : {};
    paint(true);
  }
  if (el.dataset.upload) {
    const file = el.files[0];
    if (!file) return;
    try {
      if (file.size === 0 || file.size > 1048576)
        throw Error("Choose a file between 1 byte and 1 MB");
      el.disabled = true;
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(Error("Unable to read this file"));
        reader.readAsDataURL(file);
      });
      const task = byId(state.tasks, el.dataset.upload);
      await mutate("workspace/attachment", {
        id: task.id,
        project_id: task.project_id,
        name: file.name,
        content,
      });
      refreshTaskDialog(task.id);
    } catch (error) {
      handleError(error);
    } finally {
      el.disabled = false;
    }
  }
});
render();
