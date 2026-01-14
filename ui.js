// Minimal UI helpers (tabs only). Kept separate from app.js to avoid mixing game logic.

function setupTabs(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  if(!tabs.length || !panels.length) return;

  const activate = (panelId) => {
    for(const t of tabs){
      const isActive = t.dataset.tab === panelId;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for(const p of panels){
      const isActive = p.id === panelId;
      p.classList.toggle('active', isActive);
    }
  };

  for(const t of tabs){
    t.addEventListener('click', () => activate(t.dataset.tab));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
});
