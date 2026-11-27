/* =========================================================
   Quem está atendendo neste aparelho
   Cada pedido sai no nome do funcionário escolhido aqui.
   ========================================================= */

const Waiter = (() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Utils.escapeHTML;

  const dialog = $('#waiterDialog');
  const list = $('#waiterList');
  const empty = $('#waiterEmpty');
  const chip = $('#btnWaiter');
  const chipName = $('#waiterName');

  let waiting = null;     // quem pediu a escolha e está esperando a resposta
  let shown = '';

  function renderList() {
    const people = Store.activeEmployees();
    const current = Store.waiter()?.id;
    const html = people.map((p) => `
      <li><button type="button" class="waiter-option${p.id === current ? ' is-active' : ''}" data-id="${p.id}" style="--hue:${Utils.hue(p.name)}">
        <span class="avatar" aria-hidden="true">${esc(Utils.initials(p.name))}</span>
        <span>${esc(p.name)}</span>
      </button></li>`).join('');
    // Só redesenha se mudou, para a atualização automática não tirar o botão debaixo do dedo
    if (html !== shown) {
      list.innerHTML = html;
      shown = html;
    }
    empty.hidden = people.length > 0;
  }

  function render() {
    const current = Store.waiter();
    chipName.textContent = current ? current.name : 'Escolher';
    chip.classList.toggle('is-empty', !current);
    if (dialog.open) renderList();
  }

  function finish(result) {
    const done = waiting;
    waiting = null;
    done?.(result);
  }

  /** Abre a escolha. Resolve com o funcionário, ou null se a pessoa desistir. */
  function choose() {
    finish(null);
    renderList();
    UI.Modal.open(dialog);
    return new Promise((resolve) => { waiting = resolve; });
  }

  /** Garante que há alguém escolhido antes de uma ação. */
  const ensure = async () => Store.waiter() || choose();

  function bind() {
    UI.Modal.bind(dialog);
    chip.addEventListener('click', () => { choose(); });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.waiter-option');
      if (!btn) return;
      Store.setWaiter(btn.dataset.id);
      finish(Store.waiter());
      UI.Modal.close(dialog);
    });
    dialog.addEventListener('close', () => finish(null));
    $('#waiterManage').addEventListener('click', () => {
      UI.Modal.close(dialog);
      Manage.open('team');
    });
    Store.subscribe(render);
  }

  bind();

  return { choose, ensure, render };
})();
