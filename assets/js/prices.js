/* =========================================================
   Consulta de preços (toda a equipe). Para mudar: Gerência.
   ========================================================= */

const Prices = (() => {
  const $ = (sel) => document.querySelector(sel);
  const dialog = $('#pricesDialog');
  const search = $('#priceSearch');
  const list = $('#priceList');

  function render() {
    const all = Store.products();
    const q = Billing.norm(search.value);
    const shown = all
      .filter((p) => !q || Billing.norm(p.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    list.innerHTML = shown.length
      ? shown.map((p) => `<li class="prod">
          <span class="prod__name">${Utils.escapeHTML(p.name)}</span>
          <span class="prod__price">${Billing.money(p.priceCents)}</span>
        </li>`).join('')
      : `<li class="prod-empty">${all.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda. O gerente cadastra em Gerência.'}</li>`;
  }

  UI.Modal.bind(dialog);
  search.addEventListener('input', render);
  Store.subscribe(() => { if (dialog.open) render(); });

  return {
    open() {
      search.value = '';
      render();
      UI.Modal.open(dialog);
    }
  };
})();
