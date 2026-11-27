/* =========================================================
   Componentes de interface: modais, avisos (toasts),
   confirmação e desenho da lista de clientes.
   ========================================================= */

const UI = (() => {
  const esc = Utils.escapeHTML;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Modais (<dialog>) com animação de abrir/fechar ---------- */
  const Modal = {
    open(dialog) {
      dialog.classList.remove('is-closing');
      if (!dialog.open) dialog.showModal();
    },

    close(dialog) {
      if (!dialog.open || dialog.classList.contains('is-closing')) return;
      dialog.classList.add('is-closing');
      setTimeout(() => {
        // Se a janela foi reaberta durante a animação, ela continua aberta
        if (!dialog.classList.contains('is-closing')) return;
        dialog.classList.remove('is-closing');
        dialog.close();
      }, reduceMotion() ? 0 : 150);
    },

    /** Esc, botão [data-close] e clique fora fecham com animação. */
    bind(dialog) {
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); Modal.close(dialog); });
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog || e.target.closest('[data-close]')) Modal.close(dialog);
      });
    }
  };

  /* ---------- Toasts ---------- */
  const stack = document.getElementById('toastStack');
  const toastIcons = { success: 'check', error: 'error', warning: 'alert', info: 'info' };

  function toast(message, { type = 'info', action, duration = 3500 } = {}) {
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast__icon">${Icons.svg(toastIcons[type])}</span><span class="toast__msg"></span>`;
    el.querySelector('.toast__msg').textContent = message;

    const dismiss = () => {
      clearTimeout(timer);
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    };

    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { action.onClick(); dismiss(); });
      el.append(btn);
    }

    // No máximo 3 avisos visíveis
    while (stack.children.length >= 3) stack.firstElementChild.remove();
    stack.append(el);
    const wait = type === 'error' ? 6000 : duration;
    const timer = setTimeout(dismiss, action ? Math.max(wait, 5500) : wait);
    return dismiss;
  }

  /* ---------- Confirmação ---------- */
  const confirmDialog = document.getElementById('confirmDialog');
  Modal.bind(confirmDialog);

  function confirm({ title, message, confirmText = 'Confirmar', tone = 'danger', icon = 'trash' }) {
    const okBtn = document.getElementById('confirmOk');
    const iconBox = document.getElementById('confirmIcon');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    okBtn.textContent = confirmText;
    okBtn.className = `btn btn--${tone}`;
    iconBox.innerHTML = Icons.svg(icon);
    iconBox.classList.toggle('is-primary', tone === 'primary');
    iconBox.classList.toggle('is-done', tone === 'done');

    return new Promise((resolve) => {
      let result = false;
      const onClick = (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        result = btn.dataset.value === 'ok';
        Modal.close(confirmDialog);
      };
      confirmDialog.addEventListener('click', onClick);
      confirmDialog.addEventListener('close', () => {
        confirmDialog.removeEventListener('click', onClick);
        resolve(result);
      }, { once: true });
      Modal.open(confirmDialog);
      okBtn.focus();
    });
  }

  /* ---------- Lista de clientes ---------- */
  const seenCards = new Set();

  /** "21:04 Ana" ou "21:04 Ana (1) · 23:10 Bruno (2)". `full` traz a data completa. */
  function orderTimes(item, full = false) {
    const fmt = full ? Utils.formatFull : Utils.formatWhen;
    return item.orders.map((o) => {
      const who = `${fmt(o.at)} ${Store.employeeName(o.waiterId)}`;
      return item.orders.length === 1 ? who : `${who} (${o.qty})`;
    }).join(full ? '\n' : ' · ');
  }

  /** Valor da linha numa conta encerrada: total em destaque e "4 × R$ 10,00" embaixo. */
  function priceCell(line) {
    if (!line) return '';
    if (line.unitCents == null) return '<span class="item__price is-missing"><small>sem preço</small></span>';
    return `<span class="item__price">
      <strong>${Billing.money(line.totalCents)}</strong>
      <small>${line.qty} × ${Billing.money(line.unitCents)}</small>
    </span>`;
  }

  function itemRow(item, pulse, closed, line) {
    return `
      <li class="item ${pulse ? 'is-pulse' : ''}" data-item-key="${esc(item.key)}">
        <span class="item__qty">${item.qty}</span>
        <span class="item__name">
          ${esc(item.product)}
          <span class="item__when" title="${esc(orderTimes(item, true))}">${Icons.svg('clock')} ${esc(orderTimes(item))}</span>
        </span>
        ${closed ? priceCell(line) : `<span class="item__actions">
          <button class="mini-btn" data-action="dec" aria-label="Diminuir ${esc(item.product)}">${Icons.svg('minus')}</button>
          <button class="mini-btn" data-action="inc" aria-label="Aumentar ${esc(item.product)}">${Icons.svg('plus')}</button>
        </span>`}
      </li>`;
  }

  function clientCard(client, { animateIn, delay, changed }) {
    const total = client.items.reduce((s, i) => s + i.qty, 0);
    const locked = client.items.length > 0;
    const closed = !!client.closedAt;
    const bill = Store.billOf(client);

    const items = client.items.map((item) => {
      const line = closed ? bill.lines.find((l) => Billing.norm(l.product) === item.key) : null;
      return itemRow(item, changed.has(`${client.id}|${item.key}|${item.qty}`), closed, line);
    }).join('');

    // Parcial (conta aberta) ou total pago (conta encerrada)
    let billBox = '';
    if (closed) {
      billBox = `<div class="bill-foot">
        <span class="bill-foot__label">Total consumido</span>
        <strong class="bill-foot__total">${Billing.money(bill.totalCents)}</strong>
        <span class="pay-badge">${Icons.svg('receipt')} ${esc(Billing.methodLabel(bill.method))}</span>
        ${bill.missing ? `<small class="bill-foot__warn">${Utils.plural(bill.missing, 'item', 'itens')} sem preço</small>` : ''}
      </div>`;
    } else if (locked && (bill.totalCents || bill.missing < bill.lines.length)) {
      billBox = `<div class="bill-sub">
        <span>Parcial</span>
        <strong>${Billing.money(bill.totalCents)}</strong>
        ${bill.missing ? `<small>${Utils.plural(bill.missing, 'item', 'itens')} sem preço</small>` : ''}
      </div>`;
    }

    const classes = ['client-card'];
    if (closed) classes.push('is-closed');
    if (animateIn) classes.push('is-new');

    const deleteTip = locked ? 'Já consumiu — não pode ser excluído' : 'Excluir cliente';
    const badge = closed
      ? `<span class="badge badge--done">${Icons.svg('check')} Encerrado</span>`
      : `<span class="badge ${total ? 'badge--on' : ''}">${Utils.plural(total, 'item', 'itens')}</span>`;

    const closedBy = client.closedBy ? ` por ${esc(Store.employeeName(client.closedBy))}` : '';
    const footer = closed
      ? `<span class="closed-note">${Icons.svg('receipt')} Encerrado${closedBy} ${Utils.isToday(client.closedAt) ? 'às ' : 'em '}${Utils.formatWhen(client.closedAt)}</span>
         <button class="btn btn--ghost btn--sm" data-action="reopen">${Icons.svg('undo')} Reabrir</button>`
      : `<button class="btn btn--soft btn--sm" data-action="add-item">${Icons.svg('plus')} Consumo</button>
          <span class="client-card__tools">
            <span class="tip-wrap" data-tip="${locked ? 'Cliente pagou e foi embora' : 'Nada consumido para encerrar'}">
              <button class="btn btn--done btn--sm" data-action="close" ${locked ? '' : 'disabled'}>${Icons.svg('receipt')} Encerrar</button>
            </span>
            <button class="icon-btn icon-btn--sm" data-action="edit" data-tip="Editar" aria-label="Editar ${esc(client.name)}">${Icons.svg('edit')}</button>
            <span class="tip-wrap" data-tip="${deleteTip}">
              <button class="icon-btn icon-btn--sm icon-btn--danger" data-action="delete" aria-label="Excluir ${esc(client.name)}" ${locked ? 'disabled' : ''}>${Icons.svg('trash')}</button>
            </span>
          </span>`;

    return `
      <article class="${classes.join(' ')}" data-id="${client.id}" style="--hue:${Utils.hue(client.name)};--delay:${delay}ms">
        <header class="client-card__head">
          <div class="avatar" aria-hidden="true">${esc(Utils.initials(client.name))}</div>
          <div class="client-card__info">
            <h3 class="client-card__name" title="${esc(client.name)}">${esc(client.name)}</h3>
            <div class="client-card__meta">
              ${client.table ? `<span class="meta meta--table">${Icons.svg('table')} Mesa ${esc(client.table)}</span>` : ''}
              <span class="meta meta--waiter" title="Garçom responsável">${Icons.svg('user')} ${esc(Store.employeeName(client.waiterId))}</span>
              ${client.cpf ? `<span class="meta">${Icons.svg('id')} ${Utils.formatCPF(client.cpf)}</span>` : ''}
              <span class="meta" title="Aberta em ${Utils.formatFull(client.createdAt)}">${Icons.svg('clock')} ${Utils.formatWhen(client.createdAt)} <em>· ${Utils.timeAgo(client.createdAt)}</em></span>
            </div>
          </div>
          ${badge}
        </header>

        ${locked
          ? `<ul class="item-list">${items}</ul>`
          : '<p class="item-empty">Nada consumido ainda</p>'}
        ${billBox}

        <footer class="client-card__foot">
          ${footer}
        </footer>
      </article>`;
  }

  /* Quantidades já desenhadas: serve para destacar a linha que mudou (aqui ou em outro aparelho) */
  let knownLines = null;

  function renderList(container, clients) {
    const lines = new Set(Store.get().clients.flatMap((c) => c.items.map((i) => `${c.id}|${i.key}|${i.qty}`)));
    const changed = new Set(knownLines ? [...lines].filter((key) => !knownLines.has(key)) : []);
    knownLines = Store.isLoaded() ? lines : null;

    // Guarda onde estava o foco do teclado, pois os cards são redesenhados
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focus = focused && {
      id: focused.closest('.client-card')?.dataset.id,
      key: focused.closest('.item')?.dataset.itemKey,
      action: focused.dataset.action
    };

    let order = 0;
    container.innerHTML = clients.map((client) => {
      const animateIn = !seenCards.has(client.id);
      seenCards.add(client.id);
      const delay = animateIn ? Math.min(order++ * 45, 400) : 0;
      return clientCard(client, { animateIn, delay, changed });
    }).join('');

    if (focus?.id && focus.action) {
      const card = container.querySelector(`[data-id="${CSS.escape(focus.id)}"]`);
      const scope = focus.key ? card?.querySelector(`[data-item-key="${CSS.escape(focus.key)}"]`) : card;
      scope?.querySelector(`[data-action="${focus.action}"]`)?.focus({ preventScroll: true });
    }
  }

  /** Esquece o que já foi desenhado (ao trocar de estabelecimento). */
  function reset() {
    seenCards.clear();
    knownLines = null;
  }

  /** Atualiza um número com efeito de "pulo" se ele mudou. */
  function setStat(el, value) {
    const text = String(value);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }

  function shake(el) {
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
  }

  function setFieldError(input, errorEl, message) {
    errorEl.textContent = message || '';
    input.closest('.field')?.classList.toggle('has-error', !!message);
  }

  /** Trava o botão enquanto a ação vai ao servidor (evita envio em dobro). */
  async function whileBusy(button, work) {
    if (button.disabled) return undefined;
    button.disabled = true;
    try {
      return await work();
    } finally {
      button.disabled = false;
    }
  }

  /** Move a pílula do filtro segmentado até o botão marcado. */
  function moveThumb(group) {
    const active = group.querySelector('.is-active');
    const thumb = group.querySelector('.segmented__thumb');
    if (!active || !thumb) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.top = '0';
    // Posição em X e Y, pois no celular as abas ficam em 2 linhas
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }

  return { Modal, toast, confirm, renderList, reset, setStat, shake, setFieldError, whileBusy, moveThumb };
})();
