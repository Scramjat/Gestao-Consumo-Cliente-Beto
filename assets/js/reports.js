/* =========================================================
   Relatórios da gerência: métricas e planilha do Excel
   Os dados são buscados com a liberação do PIN e apagados da
   tela ao fechar. Quando a liberação vence, o PIN é pedido de
   novo.
   ========================================================= */

const Reports = (() => {
  const $ = (sel) => document.querySelector(sel);
  const REFRESH_MS = 60000;
  const DAY_MS = 24 * 3600 * 1000;

  const els = {
    dialog: $('#metricsDialog'),
    sub: $('#metricsSub'),
    period: $('#metricsPeriod'),
    content: $('#metricsContent'),
    tooltip: $('#metricsTooltip'),
    excel: $('#btnExcel')
  };

  let period = 'today';
  let timer = null;
  let request = 0;          // só a resposta do pedido mais recente vale

  const periodStart = (key) => Metrics.PERIODS[key].start();

  async function fetchData(key) {
    // A folga no fim cobre um relógio do aparelho atrasado em relação ao servidor
    const params = new URLSearchParams({
      de: new Date(periodStart(key)).toISOString(),
      ate: new Date(Date.now() + DAY_MS).toISOString(),
      abertas: '1'
    });
    const data = await Api.request('GET', `/api/gerencia/historico?${params}`, { manager: true, retry: 1 });
    return Store.fromServer(data);
  }

  function showError(message) {
    els.content.innerHTML = `<div class="mx-empty mx-empty--big">
      <strong>Não foi possível carregar.</strong>
      <span>${Utils.escapeHTML(message)}</span>
    </div>`;
    els.sub.textContent = '';
  }

  /** Sem o PIN válido não há relatório. */
  function handle(error, onOther) {
    if (error.status === 403) {
      UI.Modal.close(els.dialog);
      Manage.expired(error.message);
    } else if (Api.hasSession()) {
      onOther(error.message);
    }
  }

  /**
   * `animate` só ao abrir ou trocar o período. Nas atualizações automáticas
   * os números mudam sem as animações de entrada, para a tela não "piscar".
   */
  async function load({ animate = false } = {}) {
    const mine = ++request;
    if (animate) {
      els.content.innerHTML = '<p class="mx-empty">Carregando…</p>';
      els.sub.textContent = '';
    }
    let state;
    try {
      state = await fetchData(period);
    } catch (e) {
      if (mine !== request) return;
      // Falha numa atualização automática: mantém o que já está na tela
      handle(e, (message) => { if (animate) showError(message); });
      return;
    }
    if (mine !== request || !els.dialog.open) return;
    els.tooltip.hidden = true;
    els.content.classList.toggle('mx-static', !animate);
    els.sub.textContent = Metrics.render(els.content, state, period).subtitle;
  }

  /* ---------- Excel ---------- */
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Ex.: "Comanda Bar do Beto - Hoje 2026-11-02 23h40.xlsx" */
  function fileName(key) {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}h${two(now.getMinutes())}`;
    const place = Api.establishment()?.nome || '';
    return `Comanda ${place} - ${Metrics.PERIODS[key].label} ${stamp}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  }

  /** A planilha sai do mesmo período da tela, com os dados buscados na hora. */
  function exportExcel() {
    const key = period;
    UI.whileBusy(els.excel, async () => {
      try {
        const start = periodStart(key);
        const state = await fetchData(key);
        if (!els.dialog.open) return;
        if (!state.clients.length) {
          UI.toast('Não há contas nesse período.', { type: 'warning' });
          return;
        }
        download(Excel.build(state, start), fileName(key), Excel.MIME);
        UI.toast('Planilha baixada', { type: 'success' });
      } catch (e) {
        handle(e, (message) => UI.toast(message, { type: 'error' }));
      }
    });
  }

  /* ---------- Dica flutuante dos gráficos (lê o texto de data-viz-tip) ---------- */
  function bindTooltip() {
    const tip = els.tooltip;
    const card = els.dialog.querySelector('.modal__card');
    const show = (target, x, y) => {
      tip.textContent = target.dataset.vizTip;
      tip.hidden = false;
      const box = card.getBoundingClientRect();
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(x - box.left - w / 2, 8), box.width - w - 8);
      tip.style.left = `${left}px`;
      tip.style.top = `${y - box.top - tip.offsetHeight - 12}px`;
    };
    els.content.addEventListener('pointermove', (e) => {
      const target = e.target.closest('[data-viz-tip]');
      if (target) show(target, e.clientX, e.clientY);
      else tip.hidden = true;
    });
    els.content.addEventListener('pointerleave', () => { tip.hidden = true; });
    els.dialog.querySelector('.modal__body').addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
    // No celular: tocar mostra a dica
    els.content.addEventListener('click', (e) => {
      const target = e.target.closest('[data-viz-tip]');
      if (!target) return;
      const r = target.getBoundingClientRect();
      show(target, r.left + r.width / 2, r.top);
    });
  }

  function open() {
    UI.Modal.open(els.dialog);
    load({ animate: true });
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  }

  function bind() {
    UI.Modal.bind(els.dialog);
    els.dialog.addEventListener('close', () => {
      request += 1;
      clearInterval(timer);
      els.content.innerHTML = '';
      els.sub.textContent = '';
      els.tooltip.hidden = true;
    });
    els.period.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (!btn || btn.classList.contains('is-active')) return;
      els.period.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('is-active', b === btn));
      period = btn.dataset.period;
      load({ animate: true });
    });
    els.excel.addEventListener('click', exportExcel);
    $('#btnReports').addEventListener('click', open);
    bindTooltip();
  }

  bind();
})();
