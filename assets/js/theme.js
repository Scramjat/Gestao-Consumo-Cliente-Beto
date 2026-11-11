/* =========================================================
   Tema claro / escuro
   Roda no <head> para aplicar o tema antes de desenhar a página.
   ========================================================= */

const Theme = (() => {
  const KEY = 'comanda:tema';
  const root = document.documentElement;

  function preferred() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* armazenamento indisponível */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  /** Alterna o tema. `origin` ({x, y}) é o ponto de onde a animação circular começa. */
  function toggle(origin) {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* ignora */ }

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduceMotion) {
      apply(next);
      return next;
    }
    if (origin) {
      root.style.setProperty('--vt-x', `${origin.x}px`);
      root.style.setProperty('--vt-y', `${origin.y}px`);
    }
    document.startViewTransition(() => apply(next));
    return next;
  }

  apply(preferred());

  return { toggle, current: () => root.dataset.theme };
})();
