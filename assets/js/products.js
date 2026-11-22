/* =========================================================
   Produtos e preços (área do administrador)
   Cadastrar, editar e excluir os produtos da lista. Os preços
   daqui entram na conta quando o cliente é encerrado.
   ========================================================= */

const Products = (() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Utils.escapeHTML;

  const dialog = $('#productsDialog');
  const form = $('#productForm');
  const nameInput = $('#productName');
  const priceInput = $('#productPrice');
  const formError = $('#productFormError');
  const search = $('#productSearch');
  const list = $('#productList');
  const sub = $('#productsSub');

  let editingId = null;
  let flashId = null;

  const priceText = (price) => price.toFixed(2).replace('.', ',');

  // Só ADMIN e admin editam; o Usuário apenas consulta (o servidor também confere)
  const editable = () => Roles.can(Api.role(), 'products.edit');

  function rowHtml(p) {
    if (p.id === editingId) {
      return `<li class="prod is-editing" data-id="${p.id}">
        <input class="prod__input prod__input--name" value="${esc(p.name)}" maxlength="60" autocomplete="off" aria-label="Nome do produto">
        <input class="prod__input prod__input--price" value="${priceText(p.price)}" inputmode="decimal" autocomplete="off" aria-label="Preço">
        <span class="prod__actions">
          <button type="button" class="btn btn--primary btn--sm" data-act="save">Salvar</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="cancel">Cancelar</button>
        </span>
        <small class="field__error prod__error"></small>
      </li>`;
    }
    return `<li class="prod${p.id === flashId ? ' is-new' : ''}" data-id="${p.id}">
      <span class="prod__name">${esc(p.name)}</span>
      <span class="prod__price">${Billing.money(Billing.toCents(p.price))}</span>
      ${editable() ? `<span class="prod__actions">
        <button type="button" class="icon-btn icon-btn--sm" data-act="edit" aria-label="Editar ${esc(p.name)}" data-tip="Editar">${Icons.svg('edit')}</button>
        <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="delete" aria-label="Excluir ${esc(p.name)}" data-tip="Excluir">${Icons.svg('trash')}</button>
      </span>` : ''}
    </li>`;
  }

  function render() {
    const all = Store.products().slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    sub.textContent = all.length
      ? `${Utils.plural(all.length, 'produto cadastrado', 'produtos cadastrados')}`
      : 'Nenhum produto cadastrado ainda';

    const q = Billing.norm(search.value);
    const shown = q ? all.filter((p) => Billing.norm(p.name).includes(q)) : all;
    list.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : `<li class="prod-empty">${all.length ? 'Nenhum produto encontrado.' : 'Cadastre o primeiro produto no campo acima.'}</li>`;
    flashId = null;
  }

  function setFormError(message) {
    formError.textContent = message || '';
    if (message) UI.shake(form);
  }

  function addProduct(e) {
    e.preventDefault();
    if (!editable()) return;
    const result = Store.addProduct({ name: nameInput.value, price: Billing.parsePrice(priceInput.value) });
    if (!result.ok) {
      setFormError(result.error);
      (Billing.parsePrice(priceInput.value) == null && nameInput.value.trim() ? priceInput : nameInput).focus();
      return;
    }
    setFormError('');
    flashId = result.product.id;
    nameInput.value = '';
    priceInput.value = '';
    search.value = '';
    render();
    nameInput.focus();
  }

  function saveEdit(row) {
    if (!editable()) return;
    const id = row.dataset.id;
    const result = Store.updateProduct(id, {
      name: row.querySelector('.prod__input--name').value,
      price: Billing.parsePrice(row.querySelector('.prod__input--price').value)
    });
    if (!result.ok) {
      row.querySelector('.prod__error').textContent = result.error;
      UI.shake(row);
      return;
    }
    editingId = null;
    flashId = id;
    render();
  }

  async function removeProduct(row) {
    if (!editable()) return;
    const product = Store.products().find((p) => p.id === row.dataset.id);
    if (!product) return;
    const ok = await UI.confirm({
      title: `Excluir ${product.name}?`,
      message: 'Contas já encerradas não mudam. Contas abertas deste produto ficam sem preço.',
      confirmText: 'Excluir'
    });
    if (!ok) return;
    const removed = Store.removeProduct(product.id);
    if (!removed) return;
    UI.toast(`${removed.product.name} excluído`, {
      type: 'info',
      action: { label: 'Desfazer', onClick: () => Store.restoreProduct(removed.product, removed.index) }
    });
  }

  function bind() {
    UI.Modal.bind(dialog);
    form.addEventListener('submit', addProduct);
    search.addEventListener('input', render);
    [nameInput, priceInput].forEach((el) => el.addEventListener('input', () => { if (formError.textContent) formError.textContent = ''; }));

    // Preço: só números, vírgula e ponto; formata ao sair do campo
    document.addEventListener('input', (e) => {
      if (e.target.matches('#productPrice, .prod__input--price')) e.target.value = e.target.value.replace(/[^\d.,]/g, '');
    });
    priceInput.addEventListener('blur', () => {
      const n = Billing.parsePrice(priceInput.value);
      if (n != null) priceInput.value = priceText(n);
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('.prod');
      if (btn.dataset.act === 'edit') {
        editingId = row.dataset.id;
        render();
        list.querySelector('.is-editing .prod__input--name')?.focus();
      }
      if (btn.dataset.act === 'cancel') { editingId = null; render(); }
      if (btn.dataset.act === 'save') saveEdit(row);
      if (btn.dataset.act === 'delete') removeProduct(row);
    });

    list.addEventListener('keydown', (e) => {
      const row = e.target.closest('.is-editing');
      if (!row) return;
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(row); }
      // Esc cancela só a edição (sem fechar a janela)
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editingId = null; render(); }
    });

    Store.subscribe((state, reason) => {
      if (dialog.open && (reason.type === 'replace' || reason.type === 'restore' || String(reason.type).startsWith('product'))) {
        // Não interrompe quem está editando uma linha
        if (!(editingId && reason.type === 'product:update')) render();
      }
    });
  }

  bind();

  return {
    open() {
      const canEdit = editable();
      form.hidden = !canEdit;
      document.getElementById('productsTitle').textContent = canEdit ? 'Produtos e preços' : 'Preços dos produtos';
      editingId = null;
      formError.textContent = '';
      search.value = '';
      render();
      UI.Modal.open(dialog);
      nameInput.focus();
    }
  };
})();
