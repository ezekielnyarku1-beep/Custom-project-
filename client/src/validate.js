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
