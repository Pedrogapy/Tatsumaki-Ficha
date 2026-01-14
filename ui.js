// Minimal UI helpers (tabs). Kept separate from app.js to avoid mixing game logic.

function setupTabs(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  if(!tabs.length || !panels.length) return;

  const tabByPanel = (id) => tabs.find(t => t.dataset.tab === id);

  const activate = (panelId, focusTab = false) => {
    for(const t of tabs){
      const isActive = t.dataset.tab === panelId;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.tabIndex = isActive ? 0 : -1;
      if(isActive && focusTab) t.focus();
    }
    for(const p of panels){
      const isActive = p.id === panelId;
      p.classList.toggle('active', isActive);
    }
  };

  // click
  for(const t of tabs){
    t.addEventListener('click', () => activate(t.dataset.tab, true));
  }

  // keyboard navigation
  const tablist = document.querySelector('.tabs');
  if(tablist){
    tablist.addEventListener('keydown', (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if(!keys.includes(e.key)) return;
      const active = tabs.findIndex(t => t.classList.contains('active'));
      if(active < 0) return;

      let next = active;
      if(e.key === 'ArrowLeft') next = (active - 1 + tabs.length) % tabs.length;
      if(e.key === 'ArrowRight') next = (active + 1) % tabs.length;
      if(e.key === 'Home') next = 0;
      if(e.key === 'End') next = tabs.length - 1;

      e.preventDefault();
      const id = tabs[next].dataset.tab;
      activate(id, true);
    });
  }

  // ensure tabindex correct
  const initial = tabs.find(t => t.classList.contains('active')) || tabs[0];
  activate(initial.dataset.tab, false);
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
});
