/* =========================================================
   Cobrança: preços, total da conta e forma de pagamento
   Valores guardados em centavos (inteiros), para nunca ter
   erro de arredondamento. Usado pelo site, pela planilha e
   pelas métricas.
   ========================================================= */

(function (root) {
  const METHODS = [
    { id: 'pix', label: 'PIX' },
    { id: 'credito', label: 'Crédito' },
    { id: 'debito', label: 'Débito' }
  ];

  const norm = (text) => String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  const toCents = (reais) => Math.round(Number(reais) * 100);

  /** 1050 -> "R$ 10,50" */
  function money(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Aceita "5", "5,5", "5.50", "R$ 5,00" e "1.234,56". Retorna reais (número) ou null. */
  function parsePrice(text) {
    let t = String(text || '').replace(/R\$/gi, '').replace(/\s/g, '');
    if (!t || /[^\d.,]/.test(t)) return null;
    if (t.includes(',')) {
      t = t.replace(/\./g, '').replace(',', '.');             // 1.234,56 -> 1234.56
    } else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) {
      t = t.replace(/\./g, '');                                // 1.500 -> 1500
    }
    if (/\.\d{3,}$/.test(t)) return null;                        // mais de 2 casas decimais
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
    return Math.round(n * 100) / 100;
  }

  /** Produto da lista pelo nome (sem diferenciar maiúsculas e acentos). */
  function findProduct(products, name) {
    const key = norm(name);
    return (products || []).find((p) => norm(p.name) === key) || null;
  }

  function methodLabel(id) {
    const m = METHODS.find((x) => x.id === id);
    return m ? m.label : '';
  }

  /**
   * Conta do cliente: uma linha por produto, com valor unitário e total.
   * Conta encerrada usa os valores guardados na hora do pagamento;
   * conta aberta usa a lista de preços atual.
   */
  function bill(client, products) {
    if (client.payment) {
      const p = client.payment;
      return { lines: p.items, totalCents: p.totalCents, missing: p.missing || 0, method: p.method, closed: true };
    }
    const lines = client.items.map((item) => {
      const found = findProduct(products, item.product);
      const unitCents = found ? toCents(found.price) : null;
      return {
        product: item.product,
        qty: item.qty,
        unitCents,
        totalCents: unitCents == null ? null : unitCents * item.qty
      };
    });
    return {
      lines,
      totalCents: lines.reduce((s, l) => s + (l.totalCents || 0), 0),
      missing: lines.filter((l) => l.unitCents == null).length,
      method: null,
      closed: false
    };
  }

  const Billing = { METHODS, norm, toCents, money, parsePrice, findProduct, methodLabel, bill };
  root.Billing = Billing;
  if (typeof module !== 'undefined') module.exports = Billing;
})(typeof window !== 'undefined' ? window : globalThis);
