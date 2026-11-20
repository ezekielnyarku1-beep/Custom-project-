const projectTones = {
  "In progress": "blue",
  Planning: "amber",
  Collecting: "green",
};

function validate({ fullName, email, password, confirmPassword, projectName }) {
  const errors = {};

  for (const [field, value, message] of [
    ["fullName", fullName, "Enter your full name."],
    ["projectName", projectName, "Enter a project name."],
  ]) {
    if (value !== undefined && !value.trim()) errors[field] = message;
  }
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (password !== undefined && password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }
  if (confirmPassword !== undefined && confirmPassword !== password) {
    errors.confirmPassword = "Passwords must match.";
  }
  return errors;
}

function validProjects(value) {
  return Array.isArray(value) && value.length > 0 && value.every(project =>
    project && typeof project.name === "string" && project.name.trim() &&
    typeof project.description === "string" && typeof project.time === "string" &&
    Object.hasOwn(projectTones, project.status) &&
    (project.activity === undefined || typeof project.activity === "string") &&
    (project.starred === undefined || typeof project.starred === "boolean")
  );
}
