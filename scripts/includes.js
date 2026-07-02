async function loadHTMLIncludes() {
  const includeElements = document.querySelectorAll("[data-include]");

  for (const el of includeElements) {
    const file = el.getAttribute("data-include");
    if (!file) continue;

    try {
      const response = await fetch(file);
      if (!response.ok) {
        throw new Error(`Failed to load ${file}: ${response.status}`);
      }
      el.innerHTML = await response.text();

      // innerHTML doesn't execute <script> tags — re-run them manually
      el.querySelectorAll("script").forEach(oldScript => {
        const s = document.createElement("script");
        s.textContent = oldScript.textContent;
        document.body.appendChild(s);
        s.remove();
      });
    } catch (error) {
      console.error(error);
      el.innerHTML = `<div style="color:red; padding:12px; border:1px solid red; margin:8px 0;">
        Failed to load section: ${file}
      </div>`;
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadHTMLIncludes();

  // Pre-populate the SSH form fields from localStorage (saved by index.html)
  if (typeof connLoad === "function") {
    const saved = connLoad();
    if (saved && saved.host) {
      const set = (id, val) => { const el = document.getElementById(id); if (el && !el.value) el.value = val; };
      set("loadSshHost", saved.host);
      set("loadSshPort", saved.port || 22);
      set("loadSshUser", saved.user || "");
      set("loadSshKey",  saved.key_path || "~/.ssh/id_ed25519");
    }
  }

  if (typeof initializeDashboard === "function") {
    initializeDashboard();
  }
});
function initializeDashboard() {
  console.log("Dashboard initialized");
}
