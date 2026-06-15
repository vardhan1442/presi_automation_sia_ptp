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

  if (typeof initializeDashboard === "function") {
    initializeDashboard();
  }
});
function initializeDashboard() {
  console.log("Dashboard initialized");
}
