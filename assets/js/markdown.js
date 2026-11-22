/* =========================================================
   Notas em Markdown para o Obsidian
   Usado pelo site (botão de baixar) e pelo servidor (que grava no cofre).
     - Uma nota por dia, com cada pedido e seu horário
     - Uma nota com as contas que estão abertas agora
   ========================================================= */

(function (root) {
  const pad = (n) => String(n).padStart(2, '0');

  /** "2026-11-02" no horário local */
  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function time(iso) {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function dateTime(iso) {
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${time(iso)}`;
  }

  function longDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  function formatCPF(cpf) {
    return cpf && cpf.length === 11
      ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`
      : '—';
  }

  // Dados antigos não têm o horário de cada pedido
  const ordersOf = (client, item) => (item.orders && item.orders.length
    ? item.orders
    : [{ qty: item.qty, at: item.addedAt || client.createdAt }]);

  // Evita quebrar a tabela do Markdown
  const cell = (text) => String(text).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');

  /** Junta tudo o que aconteceu, separado por dia. */
  function eventsByDay(state) {
    const days = {};
    const day = (iso) => (days[dayKey(iso)] ||= { orders: [], registered: [], closed: [] });

    state.clients.forEach((c) => {
      day(c.createdAt).registered.push(c);
      if (c.closedAt) day(c.closedAt).closed.push(c);
      c.items.forEach((item) => ordersOf(c, item).forEach((o) => {
        day(o.at).orders.push({ at: o.at, client: c.name, table: c.table || '', qty: o.qty, product: item.product });
      }));
    });
    return days;
  }

  function itemsSummary(client) {
    return client.items.map((i) => `${i.qty} ${i.product}`).join(', ');
  }

  function dayNote(key, events) {
    const orders = events.orders.slice().sort((a, b) => a.at.localeCompare(b.at));
    const lines = [
      '---',
      `data: ${key}`,
      `pedidos: ${orders.length}`,
      'tags: [comanda]',
      '---',
      '',
      `# Pedidos de ${longDate(key)}`,
      ''
    ];

    if (orders.length) {
      lines.push('| Hora | Cliente | Mesa | Pedido |', '|---|---|---|---|');
      orders.forEach((o) => lines.push(`| ${time(o.at)} | ${cell(o.client)} | ${cell(o.table || '—')} | ${o.qty} ${cell(o.product)} |`));
    } else {
      lines.push('_Nenhum pedido neste dia._');
    }

    if (events.closed.length) {
      lines.push('', '## Contas encerradas', '');
      events.closed
        .slice().sort((a, b) => a.closedAt.localeCompare(b.closedAt))
        .forEach((c) => lines.push(`- **${time(c.closedAt)}** — ${c.name}: ${itemsSummary(c)}`));
    }

    if (events.registered.length) {
      lines.push('', '## Clientes cadastrados', '');
      events.registered
        .slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((c) => lines.push(`- **${time(c.createdAt)}** — ${c.name}${c.table ? ` (Mesa ${c.table})` : ''} (CPF: ${formatCPF(c.cpf)})`));
    }

    lines.push('');
    return lines.join('\n');
  }

  /** { "2026-11-02": "conteúdo da nota", ... } */
  function dayNotes(state) {
    const days = eventsByDay(state);
    const notes = {};
    Object.keys(days).forEach((key) => { notes[key] = dayNote(key, days[key]); });
    return notes;
  }

  /** Nota de um dia só (para o botão de baixar). */
  function singleDayNote(state, key) {
    return dayNote(key, eventsByDay(state)[key] || { orders: [], registered: [], closed: [] });
  }

  function openAccountsNote(state) {
    const open = state.clients.filter((c) => !c.closedAt);
    const lines = [
      '---',
      `atualizado: ${state.updatedAt}`,
      `contas_abertas: ${open.length}`,
      'tags: [comanda]',
      '---',
      '',
      '# Contas abertas',
      '',
      `_Atualizado em ${dateTime(state.updatedAt)}_`,
      ''
    ];

    if (!open.length) lines.push('_Nenhuma conta aberta._');

    open.forEach((c) => {
      lines.push(`## ${c.name}`);
      lines.push(`- **Mesa:** ${c.table || '—'}`);
      if (c.attendant) lines.push(`- **Atendente:** ${c.attendant}`);
      lines.push(`- **CPF:** ${formatCPF(c.cpf)}`);
      lines.push(`- **Cadastro:** ${dateTime(c.createdAt)}`);
      lines.push('- **Consumo:**');
      if (!c.items.length) lines.push('  - _nada ainda_');
      c.items.forEach((i) => {
        const orders = ordersOf(c, i);
        const when = orders.map((o) => `${dateTime(o.at)}${orders.length > 1 ? ` (${o.qty})` : ''}`).join(', ');
        lines.push(`  - ${i.qty} ${i.product} — ${when}`);
      });
      lines.push('');
    });

    return lines.join('\n');
  }

  const Markdown = { dayKey, dayNotes, singleDayNote, openAccountsNote };
  root.Markdown = Markdown;
  if (typeof module !== 'undefined') module.exports = Markdown;
})(typeof window !== 'undefined' ? window : globalThis);
