/* =========================================================
   Métricas: indicadores, gráficos e tabela por cliente
   Tudo calculado a partir dos pedidos (cada um com data e hora)
   e desenhado em HTML/CSS puro (funciona offline).
   ========================================================= */

const Metrics = (() => {
  const esc = Utils.escapeHTML;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  // Horas em ordem de "expediente": começa às 6h para a madrugada ficar no fim
  const HOUR_ORDER = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const IDLE_ALERT_MIN = 60;

  const PERIODS = {
    today: { label: 'Hoje', start: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); } },
    '24h': { label: 'Últimas 24 horas', start: () => Date.now() - DAY },
    '7d': { label: 'Últimos 7 dias', start: () => Date.now() - 7 * DAY },
    '30d': { label: 'Últimos 30 dias', start: () => Date.now() - 30 * DAY },
    all: { label: 'Todo o período', start: () => 0 }
  };

  /* ---------- Formatação ---------- */
  const fmtNum = (n, digits = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const hourLabel = (h) => `${String(h).padStart(2, '0')}h`;

  function fmtDuration(ms) {
    const total = Math.round(ms / MIN);
    if (total < 60) return `${total} min`;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  const tableName = (c) => (c.table ? ` · Mesa ${c.table}` : '');

  /* ---------- Cálculo ---------- */
  function compute(state, periodKey) {
    const start = PERIODS[periodKey].start();
    const now = Date.now();

    const orders = [];
    state.clients.forEach((c) => c.items.forEach((item) => item.orders.forEach((o) => {
      const ts = new Date(o.at).getTime();
      if (ts >= start) orders.push({ ts, qty: o.qty, product: item.product, client: c });
    })));
    orders.sort((a, b) => a.ts - b.ts);

    const totalItems = orders.reduce((s, o) => s + o.qty, 0);

    // Por cliente
    const byClient = new Map();
    orders.forEach((o) => {
      const e = byClient.get(o.client) || { client: o.client, items: 0, orders: 0, first: o.ts, last: o.ts };
      e.items += o.qty;
      e.orders += 1;
      e.last = o.ts;
      byClient.set(o.client, e);
    });
    const clients = [...byClient.values()].sort((a, b) => b.items - a.items || a.first - b.first);

    // Por produto
    const byProduct = new Map();
    orders.forEach((o) => {
      const key = o.product.toLowerCase();
      const e = byProduct.get(key) || { name: o.product, qty: 0, clients: new Set() };
      e.qty += o.qty;
      e.clients.add(o.client.name);
      byProduct.set(key, e);
    });
    const products = [...byProduct.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'));

    // Por hora do dia
    const hours = new Array(24).fill(0);
    orders.forEach((o) => { hours[new Date(o.ts).getHours()] += o.qty; });
    const peakHour = totalItems ? hours.indexOf(Math.max(...hours)) : null;

    // Por dia e por dia da semana
    const byDay = new Map();
    const weekdays = new Array(7).fill(0);
    orders.forEach((o) => {
      const k = dayKey(o.ts);
      byDay.set(k, (byDay.get(k) || 0) + o.qty);
      weekdays[new Date(o.ts).getDay()] += o.qty;
    });

    // Por mesa
    const byTable = new Map();
    orders.forEach((o) => {
      if (!o.client.table) return;
      const e = byTable.get(o.client.table) || { table: o.client.table, items: 0, clients: new Set() };
      e.items += o.qty;
      e.clients.add(o.client.name);
      byTable.set(o.client.table, e);
    });
    const tables = [...byTable.values()].sort((a, b) => b.items - a.items);

    // Contas encerradas no período: tempo de permanência
    const closed = state.clients.filter((c) => c.closedAt && new Date(c.closedAt).getTime() >= start);

    // Faturamento: contas encerradas no período, com os valores guardados no pagamento
    const paid = closed.filter((c) => c.payment);
    const revenueCents = paid.reduce((sum, c) => sum + c.payment.totalCents, 0);
    const avgTicketCents = paid.length ? Math.round(revenueCents / paid.length) : null;
    const byMethod = new Map();
    paid.forEach((c) => {
      const e = byMethod.get(c.payment.method) || { method: c.payment.method, cents: 0, count: 0 };
      e.cents += c.payment.totalCents;
      e.count += 1;
      byMethod.set(c.payment.method, e);
    });
    const methods = [...byMethod.values()].sort((a, b) => b.cents - a.cents);
    const stays = closed.map((c) => new Date(c.closedAt) - new Date(c.createdAt));
    const avgStay = stays.length ? stays.reduce((s, v) => s + v, 0) / stays.length : null;

    // Tempo do cadastro até o primeiro pedido
    const firstWaits = [];
    state.clients.forEach((c) => {
      const created = new Date(c.createdAt).getTime();
      if (created < start) return;
      const firsts = c.items.flatMap((i) => i.orders.map((o) => new Date(o.at).getTime()));
      if (firsts.length) firstWaits.push(Math.min(...firsts) - created);
    });
    const avgFirstWait = firstWaits.length ? firstWaits.reduce((s, v) => s + v, 0) / firstWaits.length : null;

    // Contas abertas agora: há quanto tempo não pedem
    const open = state.clients.filter((c) => !c.closedAt).map((c) => {
      const all = c.items.flatMap((i) => i.orders.map((o) => new Date(o.at).getTime()));
      const last = all.length ? Math.max(...all) : null;
      const items = c.items.reduce((s, i) => s + i.qty, 0);
      return { client: c, items, last, idle: now - (last ?? new Date(c.createdAt).getTime()) };
    }).sort((a, b) => b.idle - a.idle);

    const lastHourItems = orders.filter((o) => o.ts >= now - HOUR).reduce((s, o) => s + o.qty, 0);

    return {
      orders, totalItems, clients, products, hours, peakHour, byDay, weekdays, tables,
      closed, avgStay, avgFirstWait, open, lastHourItems,
      paid, revenueCents, avgTicketCents, methods
    };
  }

  /* ---------- Peças visuais ---------- */
  function niceMax(max) {
    if (max <= 4) return Math.max(max, 1);
    const pow = 10 ** Math.floor(Math.log10(max));
    const steps = [1, 2, 2.5, 5, 10];
    const step = steps.find((s) => s * pow >= max / 2) * pow;
    return Math.ceil(max / step) * step;
  }

  // value e hint já chegam escapados; o title mostra o texto inteiro quando é cortado
  function kpi(label, value, hint = '') {
    return `<div class="mx-kpi" title="${label}: ${value}${hint ? ` · ${hint}` : ''}">
      <span class="mx-kpi__label">${label}</span>
      <strong class="mx-kpi__value">${value}</strong>
      ${hint ? `<span class="mx-kpi__hint">${hint}</span>` : ''}
    </div>`;
  }

  function card(title, sub, body, wide = false) {
    return `<section class="mx-card${wide ? ' mx-card--wide' : ''}">
      <header class="mx-card__head"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</header>
      ${body}
    </section>`;
  }

  /**
   * Colunas verticais (uma série). Só o maior valor recebe rótulo;
   * o resto aparece ao passar o mouse.
   */
  function columns(points, unit = 'itens') {
    const max = Math.max(...points.map((p) => p.value), 0);
    const top = niceMax(max);
    const peak = points.findIndex((p) => p.value === max && max > 0);
    const grid = [top, top / 2, 0].map((v) => `<div class="mx-grid__line"><span>${fmtNum(v)}</span></div>`).join('');

    const cols = points.map((p, i) => {
      const h = top ? (p.value / top) * 100 : 0;
      const tip = `${p.tip || p.label}: ${fmtNum(p.value)} ${unit}`;
      return `<div class="mx-col" data-viz-tip="${esc(tip)}">
        <div class="mx-col__plot">
          ${i === peak ? `<span class="mx-col__value" style="bottom:${h}%">${fmtNum(p.value)}</span>` : ''}
          <div class="mx-col__bar${p.value ? '' : ' is-zero'}" style="height:${h}%"></div>
        </div>
        <span class="mx-col__x">${esc(p.label)}</span>
      </div>`;
    }).join('');

    return `<div class="mx-columns" style="--n:${points.length}">
      <div class="mx-grid">${grid}</div>
      <div class="mx-columns__bars">${cols}</div>
    </div>`;
  }

  /** Barras horizontais com o valor na ponta. */
  function bars(rows, unit = 'itens', fmt = fmtNum) {
    if (!rows.length) return '<p class="mx-empty">Sem dados no período.</p>';
    const max = Math.max(...rows.map((r) => r.value));
    return `<ul class="mx-bars">${rows.map((r) => `
      <li class="mx-bar" data-viz-tip="${esc(`${r.tipLabel || r.label}: ${fmt(r.value)}${unit ? ` ${unit}` : ''}${r.extra ? ` · ${r.extra}` : ''}`)}">
        <span class="mx-bar__label">${esc(r.label)}${r.sub ? ` <em>${esc(r.sub)}</em>` : ''}</span>
        <span class="mx-bar__track"><span class="mx-bar__fill" style="width:${(r.value / max) * 100}%"></span></span>
        <span class="mx-bar__value">${fmt(r.value)}</span>
      </li>`).join('')}</ul>`;
  }

  /* ---------- Montagem ---------- */
  function render(container, state, periodKey) {
    const m = compute(state, periodKey);
    const period = PERIODS[periodKey];

    if (!m.orders.length) {
      container.innerHTML = `<div class="mx-empty mx-empty--big">
        <strong>Nenhum pedido em "${period.label.toLowerCase()}".</strong>
        <span>Escolha outro período ou lance alguns pedidos.</span>
      </div>${openAccountsCard(m)}`;
      return { subtitle: period.label };
    }

    const served = m.clients.length;
    const top = m.clients[0];
    const topProduct = m.products[0];
    const peak = m.peakHour;

    const kpis = [
      kpi('Faturamento', m.paid.length ? Billing.money(m.revenueCents) : '—',
        m.paid.length ? `${fmtNum(m.paid.length)} ${m.paid.length === 1 ? 'conta paga' : 'contas pagas'}` : 'nenhuma conta paga'),
      kpi('Ticket médio', m.avgTicketCents != null ? Billing.money(m.avgTicketCents) : '—', 'valor médio por conta paga'),
      kpi('Itens pedidos', fmtNum(m.totalItems), `em ${fmtNum(m.orders.length)} ${m.orders.length === 1 ? 'pedido' : 'pedidos'}`),
      kpi('Clientes atendidos', fmtNum(served), `média de ${fmtNum(m.totalItems / served, 1)} itens por cliente`),
      kpi('Horário de pico', `${hourLabel(peak)}–${hourLabel((peak + 1) % 24)}`, `${fmtNum(m.hours[peak])} itens nessa hora`),
      kpi('Mais consumiu', esc(top.client.name), `${fmtNum(top.items)} itens${esc(tableName(top.client))}`),
      kpi('Produto campeão', esc(topProduct.name), `${fmtNum(topProduct.qty)} unidades`),
      kpi('Permanência média', m.avgStay != null ? fmtDuration(m.avgStay) : '—',
        `${fmtNum(m.closed.length)} ${m.closed.length === 1 ? 'conta encerrada' : 'contas encerradas'}`),
      kpi('Até o 1º pedido', m.avgFirstWait != null ? fmtDuration(m.avgFirstWait) : '—', 'tempo médio após o cadastro'),
      kpi('Última hora', fmtNum(m.lastHourItems), 'itens nos últimos 60 min')
    ].join('');

    // Consumo por hora: só o trecho com movimento (na ordem do expediente)
    const active = HOUR_ORDER.filter((h) => m.hours[h] > 0);
    const from = HOUR_ORDER.indexOf(active[0]);
    const to = HOUR_ORDER.indexOf(active[active.length - 1]);
    const hourPoints = HOUR_ORDER.slice(from, to + 1).map((h) => ({
      label: hourLabel(h), tip: `${hourLabel(h)} às ${hourLabel((h + 1) % 24)}`, value: m.hours[h]
    }));

    const sections = [];
    sections.push(card('Consumo por hora', 'Itens pedidos em cada hora do dia', columns(hourPoints), true));

    sections.push(card('Quem mais consumiu', `Itens por cliente · top ${Math.min(10, served)}`,
      bars(m.clients.slice(0, 10).map((e) => ({
        label: e.client.name,
        sub: e.client.table ? `Mesa ${e.client.table}` : '',
        tipLabel: e.client.name + tableName(e.client),
        value: e.items,
        extra: `${e.orders} ${e.orders === 1 ? 'pedido' : 'pedidos'}`
      })))));

    if (m.methods.length) {
      sections.push(card('Formas de pagamento', 'Valor recebido em cada forma',
        bars(m.methods.map((e) => ({
          label: Billing.methodLabel(e.method),
          value: e.cents,
          extra: `${e.count} ${e.count === 1 ? 'conta' : 'contas'}`
        })), '', (cents) => Billing.money(cents))));
    }

    sections.push(card('Produtos mais pedidos', `Unidades por produto · top ${Math.min(10, m.products.length)}`,
      bars(m.products.slice(0, 10).map((p) => ({
        label: p.name,
        value: p.qty,
        extra: `${p.clients.size} ${p.clients.size === 1 ? 'cliente' : 'clientes'}`
      })), 'unidades')));

    if (m.byDay.size > 1) {
      const keys = [...m.byDay.keys()].sort();
      const days = [];
      for (let t = new Date(`${keys[0]}T12:00:00`).getTime(); dayKey(t) <= keys[keys.length - 1]; t += DAY) days.push(dayKey(t));
      sections.push(card('Consumo por dia', 'Itens pedidos em cada dia',
        columns(days.map((k) => ({ label: dayLabel(k), value: m.byDay.get(k) || 0 }))), true));

      sections.push(card('Dia da semana', 'Itens somados por dia da semana',
        columns(WEEKDAY_ORDER.map((d) => ({ label: WEEKDAYS[d], value: m.weekdays[d] })))));
    }

    if (m.tables.length) {
      sections.push(card('Mesas mais movimentadas', 'Itens por mesa',
        bars(m.tables.slice(0, 10).map((t) => ({
          label: `Mesa ${t.table}`,
          value: t.items,
          extra: [...t.clients].join(', ')
        })))));
    }

    sections.push(openAccountsCard(m));
    sections.push(clientTable(m));

    container.innerHTML = `<div class="mx-kpis">${kpis}</div><div class="mx-cards">${sections.join('')}</div>`;
    return { subtitle: `${period.label} · ${fmtNum(m.totalItems)} itens · ${fmtNum(served)} ${served === 1 ? 'cliente' : 'clientes'}` };
  }

  /** Contas abertas há mais tempo sem pedir (ajuda a não esquecer ninguém). */
  function openAccountsCard(m) {
    if (!m.open.length) return '';
    const rows = m.open.slice(0, 8).map((o) => {
      const alert = o.idle >= IDLE_ALERT_MIN * MIN;
      const what = o.last ? `último pedido há ${fmtDuration(o.idle)}` : `sem pedidos há ${fmtDuration(o.idle)}`;
      return `<li class="mx-open${alert ? ' is-alert' : ''}">
        <span class="mx-open__name">${esc(o.client.name)}${o.client.table ? ` <em>Mesa ${esc(o.client.table)}</em>` : ''}</span>
        <span class="mx-open__when">${what}</span>
        <span class="mx-open__items">${fmtNum(o.items)} ${o.items === 1 ? 'item' : 'itens'}</span>
        ${alert ? `<span class="mx-status">${Icons.svg('alert')} Parado</span>` : ''}
      </li>`;
    }).join('');
    return card('Contas abertas', `Há quanto tempo cada uma não pede · alerta após ${IDLE_ALERT_MIN} min`,
      `<ul class="mx-open-list">${rows}</ul>`);
  }

  /** Tabela com todos os clientes do período (também serve de "visão em tabela" dos gráficos). */
  function clientTable(m) {
    const rows = m.clients.map((e) => {
      const c = e.client;
      const stay = c.closedAt ? fmtDuration(new Date(c.closedAt) - new Date(c.createdAt)) : 'aberta';
      return `<tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.table || '—')}</td>
        <td class="num">${fmtNum(e.items)}</td>
        <td class="num">${fmtNum(e.orders)}</td>
        <td class="num">${Utils.formatWhen(new Date(e.first).toISOString())}</td>
        <td class="num">${Utils.formatWhen(new Date(e.last).toISOString())}</td>
        <td>${stay}</td>
      </tr>`;
    }).join('');
    return card('Resumo por cliente', 'Todos os clientes com pedidos no período', `
      <div class="mx-table-wrap"><table class="mx-table">
        <thead><tr><th>Cliente</th><th>Mesa</th><th class="num">Itens</th><th class="num">Pedidos</th><th class="num">Primeiro</th><th class="num">Último</th><th>Permanência</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`, true);
  }

  return { render, PERIODS };
})();
