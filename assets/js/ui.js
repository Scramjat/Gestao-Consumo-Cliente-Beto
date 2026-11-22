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
    const timer = setTimeout(dismiss, action ? Math.max(duration, 5500) : duration);
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

  /** Horário de cada pedido: "21:04" ou "21:04 (1) · 23:10 (2)". `full` traz a data completa. */
  function orderTimes(item, full = false) {
    const fmt = full ? Utils.formatFull : Utils.formatWhen;
    if (item.orders.length === 1) return fmt(item.orders[0].at);
    return item.orders.map((o) => `${fmt(o.at)} (${o.qty})`).join(full ? '\n' : ' · ');
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

  function itemRow(item, highlight, closed, line) {
    const cls = highlight === 'new' ? 'is-new' : highlight === 'pulse' ? 'is-pulse' : '';
    return `
      <li class="item ${cls}" data-item-id="${item.id}">
        <span class="item__qty">${item.qty}</span>
        <span class="item__name">
          ${esc(item.product)}
          <span class="item__when" title="${orderTimes(item, true)}">${Icons.svg('clock')} ${orderTimes(item)}</span>
        </span>
        ${closed ? priceCell(line) : `<span class="item__actions">
          <button class="mini-btn" data-action="dec" aria-label="Diminuir ${esc(item.product)}">${Icons.svg('minus')}</button>
          <button class="mini-btn" data-action="inc" aria-label="Aumentar ${esc(item.product)}">${Icons.svg('plus')}</button>
        </span>`}
      </li>`;
  }

  function clientCard(client, { animateIn, delay, reason }) {
    const total = client.items.reduce((s, i) => s + i.qty, 0);
    const locked = client.items.length > 0;
    const closed = !!client.closedAt;
    const sameClient = reason && reason.clientId === client.id;

    // Valores da conta (encerrada: os guardados no pagamento; aberta: lista de preços atual)
    const bill = Billing.bill(client, Store.products());

    const items = client.items.map((item, i) => {
      let highlight = null;
      if (sameClient && reason.itemId === item.id) {
        highlight = reason.type === 'item:add' && reason.isNew ? 'new' : 'pulse';
      }
      return itemRow(item, highlight, closed, closed && client.payment ? bill.lines[i] : null);
    }).join('');

    // Parcial (conta aberta) ou total pago (conta encerrada)
    let billBox = '';
    if (closed && client.payment) {
      billBox = `<div class="bill-foot">
        <span class="bill-foot__label">Total consumido</span>
        <strong class="bill-foot__total">${Billing.money(bill.totalCents)}</strong>
        <span class="pay-badge">${Icons.svg('receipt')} ${esc(Billing.methodLabel(bill.method))}</span>
        ${bill.missing ? `<small class="bill-foot__warn">${Utils.plural(bill.missing, 'item', 'itens')} sem preço</small>` : ''}
      </div>`;
    } else if (!closed && locked && (bill.totalCents || bill.missing < bill.lines.length)) {
      billBox = `<div class="bill-sub">
        <span>Parcial</span>
        <strong>${Billing.money(bill.totalCents)}</strong>
        ${bill.missing ? `<small>${Utils.plural(bill.missing, 'item', 'itens')} sem preço</small>` : ''}
      </div>`;
    }

    const classes = ['client-card'];
    if (closed) classes.push('is-closed');
    if (animateIn) classes.push('is-new');
    if (sameClient && reason.type === 'client:update') classes.push('is-flash');

    const deleteTip = locked ? 'Já consumiu — não pode ser excluído' : 'Excluir cliente';
    const badge = closed
      ? `<span class="badge badge--done">${Icons.svg('check')} Encerrado</span>`
      : `<span class="badge ${total ? 'badge--on' : ''}">${Utils.plural(total, 'item', 'itens')}</span>`;

    const footer = closed
      ? `<span class="closed-note">${Icons.svg('receipt')} Encerrado ${Utils.isToday(client.closedAt) ? 'às ' : 'em '}${Utils.formatWhen(client.closedAt)} · ${Utils.plural(total, 'item', 'itens')}</span>
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
              ${Features.attendant && client.attendant ? `<span class="meta" title="Atendente">${Icons.svg('user')} ${esc(client.attendant)}</span>` : ''}
              <span class="meta">${Icons.svg('id')} ${client.cpf ? Utils.formatCPF(client.cpf) : 'Sem CPF'}</span>
              <span class="meta" title="Cadastrado em ${Utils.formatFull(client.createdAt)}">${Icons.svg('clock')} ${Utils.formatWhen(client.createdAt)} <em>· ${Utils.timeAgo(client.createdAt)}</em></span>
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

  function renderList(container, clients, reason) {
    let order = 0;
    container.innerHTML = clients.map((client) => {
      const animateIn = !seenCards.has(client.id);
      seenCards.add(client.id);
      const delay = animateIn ? Math.min(order++ * 45, 400) : 0;
      return clientCard(client, { animateIn, delay, reason });
    }).join('');
  }

  /** Esquece os cards já vistos (para animar de novo após carregar outros dados). */
  function resetSeen() { seenCards.clear(); }

  /** Atualiza um número com efeito de "pulo" se ele mudou. */
  function setStat(el, value) {
    const text = String(value);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }

  /** Remove o card com animação antes de apagar o dado. */
  function animateCardOut(card) {
    return new Promise((resolve) => {
      if (!card || reduceMotion()) return resolve();
      card.classList.add('is-leaving');
      setTimeout(resolve, 200);
    });
  }

  function shake(el) {
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
  }

  return { Modal, toast, confirm, renderList, resetSeen, setStat, animateCardOut, shake };
})();
