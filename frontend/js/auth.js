const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8000'
    : 'https://safecharge-backend.up.railway.app';

// ── DOM refs ────────────────────────────────────────────────────────────────
const signupForm = document.getElementById("signup-form");
const signinForm = document.getElementById("signin-form");
const authError = document.getElementById("auth-error");

// ── Helpers ─────────────────────────────────────────────────────────────────

function showError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
}

function hideError() {
  authError.hidden = true;
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait\u2026" : btn.dataset.label;
}

function saveSession(data) {
  sessionStorage.setItem("sc_token", data.token);
  sessionStorage.setItem("sc_user", JSON.stringify(data.user));
}

// ── Password strength (signup only) ─────────────────────────────────────────

if (signupForm) {
  const pw = document.getElementById("password");
  const rules = {
    length: document.getElementById("rule-length"),
    upper: document.getElementById("rule-upper"),
    lower: document.getElementById("rule-lower"),
    number: document.getElementById("rule-number"),
  };

  pw.addEventListener("input", () => {
    const v = pw.value;
    rules.length.classList.toggle("met", v.length >= 8);
    rules.upper.classList.toggle("met", /[A-Z]/.test(v));
    rules.lower.classList.toggle("met", /[a-z]/.test(v));
    rules.number.classList.toggle("met", /[0-9]/.test(v));
  });
}

// ── Sign Up ─────────────────────────────────────────────────────────────────

if (signupForm) {
  const btn = document.getElementById("signup-btn");
  btn.dataset.label = btn.textContent;

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const name = signupForm.name.value.trim();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;
    const confirm = document.getElementById("confirm-password").value;

    if (!name) return showError("Please enter your name.");
    if (!email) return showError("Please enter your email.");
    if (password !== confirm) return showError("Passwords do not match.");
    if (password.length < 8) return showError("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(password)) return showError("Password needs an uppercase letter.");
    if (!/[a-z]/.test(password)) return showError("Password needs a lowercase letter.");
    if (!/[0-9]/.test(password)) return showError("Password needs a number.");

    setLoading(btn, true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail = data.detail;
        if (Array.isArray(detail)) {
          showError(detail.map((d) => d.msg).join(" "));
        } else {
          showError(detail || "Sign up failed.");
        }
        return;
      }

      saveSession(data);
      window.location.href = "../index.html";
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setLoading(btn, false);
    }
  });
}

// ── Sign In ─────────────────────────────────────────────────────────────────

if (signinForm) {
  const btn = document.getElementById("signin-btn");
  btn.dataset.label = btn.textContent;

  signinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const email = signinForm.email.value.trim();
    const password = signinForm.password.value;

    if (!email) return showError("Please enter your email.");
    if (!password) return showError("Please enter your password.");

    setLoading(btn, true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail = data.detail;
        if (Array.isArray(detail)) {
          showError(detail.map((d) => d.msg).join(" "));
        } else {
          showError(detail || "Sign in failed.");
        }
        return;
      }

      saveSession(data);
      window.location.href = "../index.html";
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setLoading(btn, false);
    }
  });
}
