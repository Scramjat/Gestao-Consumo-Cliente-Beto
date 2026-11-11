/* =========================================================
   Tema claro / escuro
   Roda no <head> para aplicar o tema antes de desenhar a página.
   Sempre abre no modo claro; o botão troca o tema só enquanto
   o sistema estiver aberto.
   ========================================================= */

const Theme = (() => {
  const root = document.documentElement;

  // Escolha antiga salva no aparelho (não é mais usada): apaga
  try { localStorage.removeItem('comanda:tema'); } catch { /* ignora */ }

  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  /** Alterna o tema. `origin` ({x, y}) é o ponto de onde a animação circular começa. */
  function toggle(origin) {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';

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

  apply('light');

  return { toggle, current: () => root.dataset.theme };
})();
