/* =========================================================
   Números por garçom, usados nas métricas e na planilha

   Duas contas diferentes:
   - RESPONSÁVEL pela mesa: contas pagas no período e o
     faturamento delas. Vale quem era o responsável quando a
     conta foi encerrada. A soma bate com o faturamento total.
   - QUEM LANÇOU: itens pedidos no período, mesmo em contas
     ainda abertas. O "valor lançado" usa o preço pago (conta
     encerrada) ou o preço atual (conta aberta): não é dinheiro
     recebido.
   ========================================================= */

(function (root) {
  const billing = () => root.Billing || require('./billing.js');

  /**
   * state: { clients, products, employees }
   * Devolve só quem teve algum movimento, do maior faturamento para o menor.
   */
  function compute(state, start) {
    const Billing = billing();
    const rows = new Map();
    const names = new Map(state.employees.map((e) => [e.id, e]));
    const inPeriod = (iso) => !!iso && new Date(iso).getTime() >= start;

    const row = (id) => {
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          name: names.get(id)?.name || '—',
          active: !!names.get(id)?.active,
          paidTabs: 0, revenueCents: 0, openTabs: 0,
          items: 0, orders: 0, launchedCents: 0, unpricedItems: 0, tabs: new Set()
        });
      }
      return rows.get(id);
    };

    for (const client of state.clients) {
      if (!client.closedAt) row(client.waiterId).openTabs += 1;
      else if (client.payment && inPeriod(client.closedAt)) {
        const r = row(client.waiterId);
        r.paidTabs += 1;
        r.revenueCents += client.payment.totalCents;
      }

      const unit = new Map(Billing.bill(client, state.products).lines.map((l) => [Billing.norm(l.product), l.unitCents]));
      for (const item of client.items) {
        const cents = unit.get(Billing.norm(item.product));
        for (const order of item.orders) {
          if (!inPeriod(order.at)) continue;
          const r = row(order.waiterId);
          r.items += order.qty;
          r.orders += 1;
          r.tabs.add(client.id);
          if (cents == null) r.unpricedItems += order.qty;
          else r.launchedCents += cents * order.qty;
        }
      }
    }

    return [...rows.values()]
      .map(({ tabs, ...r }) => ({
        ...r,
        tabsServed: tabs.size,
        avgTicketCents: r.paidTabs ? Math.round(r.revenueCents / r.paidTabs) : null
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents || b.items - a.items || a.name.localeCompare(b.name, 'pt-BR'));
  }

  const WaiterStats = { compute };
  root.WaiterStats = WaiterStats;
  if (typeof module !== 'undefined') module.exports = WaiterStats;
})(typeof window !== 'undefined' ? window : globalThis);
