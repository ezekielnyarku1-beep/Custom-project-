const root = document.querySelector("#root");
const appName = document.title;
const projectStorageKey = "overviewProjects";
let loggedIn = false;
let storageAvailable = true;
let renderSequence = 0;

function skeleton(variant) {
  const element = document.createElement("span");
  element.className = "skeleton skeleton-" + variant;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function renderAuthSkeleton(fieldNames) {
  const brand = root.querySelector(".brand");
  brand.replaceChildren(skeleton("brand-name"));
  const brandCopy = document.createElement("div");
  brandCopy.className = "skeleton-brand-copy";
  brandCopy.append(skeleton("tagline"));
  const headline = document.createElement("div");
  headline.className = "skeleton-headline";
  headline.append(skeleton("headline-line"), skeleton("headline-line"), skeleton("headline-short"));
  brandCopy.append(headline);
  brand.append(brandCopy, skeleton("note"));
  const content = root.querySelector(".form-content");
  const fieldsContainer = content.querySelector("form");
  fieldsContainer.replaceChildren();
  fieldNames.forEach(() => {
    const field = document.createElement("div");
    field.className = "field";
    field.append(skeleton("label"), skeleton("input"));
    fieldsContainer.append(field);
  });
  fieldsContainer.append(skeleton("button"));
  content.replaceChildren(skeleton("heading"), skeleton("subtitle"), fieldsContainer);
}

function renderDashboardSkeleton() {
  const sidebar = root.querySelector(".sidebar");
  const nav = document.createElement("div");
  nav.className = "skeleton-nav";
  sidebar.replaceChildren(skeleton("brand-name"), skeleton("workspace"), nav);
  for (let index = 0; index < 3; index += 1) nav.append(skeleton("nav"));
  root.querySelector(".topbar").replaceChildren(skeleton("breadcrumb"), skeleton("search"));
  const dashboardContent = root.querySelector(".dashboard-content");
  const heading = dashboardContent.querySelector(".section-heading");
  const headingGroup = document.createElement("div");
  headingGroup.className = "skeleton-heading-group";
  headingGroup.append(skeleton("heading"), skeleton("subtitle"));
  heading.replaceChildren(headingGroup, skeleton("button-small"));
  const summary = dashboardContent.querySelector(".project-summary");
  for (let index = 0; index < 3; index += 1) {
    const card = document.createElement("div");
    card.className = "card";
    card.append(skeleton("summary-label"), skeleton("summary-value"));
    summary.append(card);
  }
  const banner = dashboardContent.querySelector(".project-banner");
  banner.replaceWith(skeleton("project-banner"));
  const projects = dashboardContent.querySelector(".projects-section");
  const cards = projects.querySelector(".cards");
  for (let index = 0; index < 3; index += 1) {
    const card = document.createElement("div");
    card.className = "card skeleton-card";
    card.append(skeleton("icon"), skeleton("title"), skeleton("description"));
    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.append(skeleton("status"), skeleton("status"));
    card.append(footer);
    cards.append(card);
  }
  projects.replaceChildren(skeleton("heading-small"), cards);
  const activity = dashboardContent.querySelector(".activity-section");
  const activityList = activity.querySelector(".activity-list");
  for (let index = 0; index < 2; index += 1) {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.append(skeleton("icon"), skeleton("activity-name"), skeleton("activity-description"), skeleton("activity-time"));
    activityList.append(row);
  }
  activity.replaceChildren(skeleton("heading-small"), activityList);
}

function store(key, value, fallback) {
  const result = value === undefined ? fallback : value;
  if (!storageAvailable) return result;
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key)) ?? fallback;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageAvailable = false;
  }
  return result;
}

function session(value) {
  loggedIn = store("loggedIn", value, loggedIn) === true;
  return loggedIn;
}
const pages = {
  login: {
    title: "Welcome back",
    subtitle: "Enter your details to sign in to your account.",
    fields: ["email", "password"],
    action: "Sign in",
  },
  signup: {
    title: "Create an account",
    subtitle: "Enter your details to get started.",
    fields: ["fullName", "email", "password", "confirmPassword"],
    action: "Create account",
  },
  "forgot-password": {
    title: "Forgot password?",
    subtitle: "Enter the email address for your account.",
    fields: ["email"],
    action: "Send reset link",
  },
};

const fields = {
  fullName: ["Full name", "text", "Your full name", "name"],
  email: ["Email address", "email", "you@example.com", "email"],
  password: ["Password", "password", "Enter your password", "current-password"],
  confirmPassword: ["Confirm password", "password", "Repeat your password", "new-password"],
  projectName: ["Project name", "text", "Name your project", "off"],
};

const projects = [
  { name: "Website refresh", description: "A new home for a fresh perspective.", status: "In progress", time: "2 hours ago", activity: "You updated the project overview." },
  { name: "Product launch", description: "Everything you need for the big day.", status: "Planning", time: "Yesterday", activity: "You created a new project." },
  { name: "Ideas & inspiration", description: "A little space for your next big idea.", status: "Collecting", time: "2 days ago" },
];

const savedProjects = store(projectStorageKey);
if (validProjects(savedProjects)) {
  projects.splice(0, projects.length, ...savedProjects.map(({ tone, ...project }) => project));
}

function saveProjects() {
  store(projectStorageKey, projects);
}

function template(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function link(page, text) {
  const anchor = document.createElement("a");
  anchor.href = "#/" + page;
  anchor.textContent = text;
  return anchor;
}

function projectTime(project) {
  const date = new Date(project.time);
  return Number.isNaN(date.getTime()) ? project.time : date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
  if (name === "password" && page === "signup") input.autocomplete = "new-password";
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
      toggle.setAttribute("aria-label", toggle.textContent + " " + caption.toLowerCase());
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
    const error = document.getElementById(input.getAttribute("aria-describedby"));
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

function renderScreen(layout, showLoading, showContent, delay) {
  const sequence = ++renderSequence;
  root.className = layout;
  root.setAttribute("aria-busy", "true");
  root.setAttribute("aria-label", "Loading");
  root.replaceChildren(template(layout));
  showLoading();
  window.setTimeout(() => {
    if (sequence !== renderSequence) return;
    root.replaceChildren(template(layout));
    for (const wordmark of root.querySelectorAll(".wordmark")) wordmark.textContent = appName;
    showContent();
    root.removeAttribute("aria-busy");
    root.removeAttribute("aria-label");
  }, delay);
}

function renderAuthContent(page) {
  const { title, subtitle, fields, action } = pages[page];
  root.querySelector("h1").textContent = title;
  root.querySelector(".subtitle").textContent = subtitle;
  const form = root.querySelector("form");
  const button = form.querySelector("button");
  const footer = root.querySelector(".form-footer");
  button.textContent = action;
  for (const name of fields) button.before(field(name, page));

  if (page === "login") {
    const forgot = link("forgot-password", pages["forgot-password"].title);
    forgot.className = "forgot";
    button.before(forgot);
    footer.append("Don't have an account? ", link("signup", "Sign up"));
  } else {
    footer.append(link("login", "Back to login"));
  }

  form.onsubmit = event => {
    event.preventDefault();
    if (button.disabled) return;
    if (!validateForm(form)) return;
    setButtonLoading(button);
    window.setTimeout(() => {
      if (!form.isConnected) return;
      if (page === "forgot-password") {
        const status = document.createElement("p");
        status.setAttribute("role", "status");
        form.replaceWith(status);
        status.textContent = "If this email exists, we sent a reset link.";
      } else {
        session(true);
        location.hash = "/dashboard";
      }
    }, 700);
  };
  form.oninput = () => {
    if (form.querySelector('[aria-invalid="true"]')) {
      validateForm(form, false);
    }
  };
}

function renderDashboardContent() {
  let view = "Home";
  const cards = root.querySelector(".cards");
  const search = root.querySelector("#project-search");
  const projectsHeading = root.querySelector("#projects-heading");
  const viewAll = root.querySelector("#view-all-projects");
  const emptyProjects = root.querySelector("#empty-projects");
  const dialog = root.querySelector("dialog");
  const content = root.querySelector("#dialog-content");
  const menu = root.querySelector("#sidebar-menu");
  const menuToggle = root.querySelector(".menu-toggle");

  function setMenu(open) {
    if (!open && menu.contains(document.activeElement) && menuToggle.getClientRects().length) {
      menuToggle.focus();
    }
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.classList.toggle("is-open", open);
  }

  menuToggle.onclick = () => setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
  root.querySelector(".sidebar").onkeydown = event => {
    if (event.key === "Escape") setMenu(false);
  };

  function openDialog(title) {
    root.querySelector("#dialog-title").textContent = title;
    content.replaceChildren();
    dialog.showModal();
  }

  function openProject(project) {
    openDialog(project.name);
    const description = document.createElement("p");
    description.textContent = project.description || "No description added.";
    const status = document.createElement("p");
    status.textContent = "Status: " + project.status;
    content.append(description, status);
  }

  function updateProjects(focusedProject) {
    cards.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matches = projects.filter(project =>
      (view !== "Starred" || project.starred) &&
      (project.name + " " + project.description).toLowerCase().includes(query)
    );
    const visible = view === "Home" && !query ? matches.slice(0, 3) : matches;
    for (const project of visible) {
      const card = template("project-card");
      const title = card.querySelector(".project-title");
      title.textContent = project.name;
      title.onclick = () => openProject(project);
      card.querySelector(".project-description").textContent = project.description;
      const status = card.querySelector(".status");
      status.textContent = project.status;
      status.classList.add(projectTones[project.status]);
      card.querySelector(".card-footer small").textContent = "Edited " + projectTime(project);
      const star = card.querySelector(".star-button");
      star.textContent = project.starred ? "★" : "☆";
      star.setAttribute("aria-pressed", String(Boolean(project.starred)));
      star.setAttribute("aria-label", (project.starred ? "Unstar " : "Star ") + project.name);
      star.onclick = () => {
        project.starred = !project.starred;
        saveProjects();
        updateProjects(project);
      };
      cards.append(card);
      if (project === focusedProject) star.focus();
    }
    emptyProjects.hidden = visible.length > 0;
    emptyProjects.textContent = !query && view === "Starred"
      ? "No starred projects yet."
      : "No projects match your search.";
    if (focusedProject && !visible.includes(focusedProject)) projectsHeading.focus();
    root.querySelector("#project-count").textContent = projects.length;
    const summary = root.querySelector(".project-summary");
    summary.replaceChildren();
    for (const [label, count] of [
      ["Total projects", projects.length],
      ["In progress", projects.filter(project => project.status === "In progress").length],
      ["Starred", projects.filter(project => project.starred).length],
    ]) {
      const item = document.createElement("div");
      item.className = "card";
      const caption = document.createElement("dt");
      const number = document.createElement("dd");
      caption.textContent = label;
      number.textContent = count;
      item.append(caption, number);
      summary.append(item);
    }
    root.querySelector("#storage-notice").hidden = storageAvailable;
    root.querySelector("#featured-description").textContent =
      "Jump back into " + projects[0].name + " and keep the momentum going.";
    root.querySelector("#current-view").textContent = view;
    projectsHeading.textContent = view === "Home" ? "Recent projects" : view;
    viewAll.hidden = view !== "Home";
    for (const button of root.querySelectorAll(".nav-link[data-view]")) {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const activity = root.querySelector(".activity-list");
    activity.replaceChildren();
    for (const project of projects.filter(project => project.activity)) {
      const row = template("activity-row");
      row.querySelector("strong").textContent = project.name;
      row.querySelector("p").textContent = project.activity;
      row.querySelector("small").textContent = projectTime(project);
      activity.append(row);
    }
  }

  function selectView(nextView) {
    view = nextView;
    search.value = "";
    setMenu(false);
    updateProjects();
  }

  for (const button of root.querySelectorAll("[data-view]")) {
    button.onclick = () => {
      selectView(button.dataset.view);
      if (button === viewAll || menuToggle.getClientRects().length) projectsHeading.focus();
    };
  }
  search.oninput = () => updateProjects();
  root.querySelector("#close-dialog").onclick = () => dialog.close();
  root.querySelector("#open-project").onclick = () => openProject(projects[0]);
  root.querySelector("#new-project").onclick = () => {
    openDialog("New project");
    const form = document.createElement("form");
    form.noValidate = true;
    const button = document.createElement("button");
    button.textContent = "Create project";
    form.append(field("projectName"), button);
    content.append(form);
    form.onsubmit = event => {
      event.preventDefault();
      const values = validateForm(form);
      if (!values) return;
      const name = values.projectName.trim();
      projects.unshift({ name, description: "", status: "Planning", time: new Date().toISOString(), activity: "You created a new project." });
      saveProjects();
      dialog.close();
      selectView("All projects");
    };
    form.querySelector("input").focus();
  };
  root.querySelector("#logout").onclick = () => {
    session(false);
    location.hash = "/login";
  };
  updateProjects();
}

function render() {
  const requested = location.hash.slice(2);
  const loggedIn = session();
  const page = loggedIn ? "dashboard" : Object.hasOwn(pages, requested) ? requested : "login";
  if (location.hash !== "#/" + page) {
    history.replaceState(null, "", "#/" + page);
  }
  if (loggedIn) {
    renderScreen("dashboard", renderDashboardSkeleton, renderDashboardContent, 850);
  } else {
    renderScreen("auth", () => renderAuthSkeleton(pages[page].fields), () => renderAuthContent(page), 650);
  }
  document.title = (loggedIn ? "Dashboard" : pages[page].title) + " | " + appName;
}

window.addEventListener("hashchange", render);
window.addEventListener("pageshow", render);
window.addEventListener("storage", event => {
  if (event.key === "loggedIn" || event.key === null) render();
});
