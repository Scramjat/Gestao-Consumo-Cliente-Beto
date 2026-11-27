/* =========================================================
   Painel da plataforma: criar, suspender e redefinir o acesso
   dos estabelecimentos.
   A sessão vale só enquanto a aba estiver aberta. Textos vindos
   do servidor entram com textContent (nunca como HTML).
   ========================================================= */

(() => {
  const TOKEN_KEY = 'comanda:dono';
  const BASE = '/api/plataforma/estabelecimentos';
  const $ = (selector) => document.querySelector(selector);

  const els = {
    message: $('#message'),
    loginView: $('#loginView'),
    loginForm: $('#loginForm'),
    panelView: $('#panelView'),
    logout: $('#logout'),
    createForm: $('#createForm'),
    secretBox: $('#secretBox'),
    secretTitle: $('#secretTitle'),
    secretList: $('#secretList'),
    secretClose: $('#secretClose'),
    empty: $('#empty'),
    copyStatus: $('#copyStatus'),
    list: $('#list')
  };

  const token = {
    get: () => sessionStorage.getItem(TOKEN_KEY),
    set: (value) => sessionStorage.setItem(TOKEN_KEY, value),
    drop: () => sessionStorage.removeItem(TOKEN_KEY)
  };

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function showMessage(text) {
    els.message.textContent = text || '';
    els.message.hidden = !text;
    if (text) els.message.scrollIntoView({ block: 'nearest' });
  }

  function showSecret(title, entries) {
    els.secretTitle.textContent = title;
    els.secretList.replaceChildren(...entries.flatMap(([label, value]) => [el('dt', label), el('dd', value)]));
    els.secretBox.hidden = false;
    els.secretBox.scrollIntoView({ block: 'nearest' });
  }

  function hideSecret() {
    els.secretList.replaceChildren();
    els.secretBox.hidden = true;
  }

  function showView(logged) {
    els.loginView.hidden = logged;
    els.panelView.hidden = !logged;
    if (!logged) {
      hideSecret();
      els.list.replaceChildren();
    }
  }

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        cache: 'no-store',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('Não consegui falar com o servidor.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token.get()) {
      token.drop();
      showView(false);
      throw new Error('Sua sessão terminou. Entre de novo.');
    }
    if (!res.ok) throw new Error(data.erro || 'Não foi possível concluir.');
    return data;
  }

  /** Roda uma ação com o botão travado (evita clique duplo) e mostra o erro. */
  async function run(button, action) {
    button.disabled = true;
    showMessage('');
    try {
      await action();
    } catch (e) {
      showMessage(e.message);
    } finally {
      button.disabled = false;
    }
  }

  function actionButton(label, className, action) {
    const button = el('button', label, className);
    button.type = 'button';
    button.addEventListener('click', () => run(button, action));
    return button;
  }

  const when = (value) => (value ? new Date(value).toLocaleString('pt-BR') : 'nunca');

  function item(e) {
    const li = el('li');
    const title = el('h3', e.nome);
    if (!e.ativo) title.append(el('span', 'Suspenso', 'badge'));

    const actions = el('div', '', 'actions');
    actions.append(
      actionButton('Nova senha', 'secondary', async () => {
        if (!confirm(`Gerar uma nova senha para "${e.nome}"? Todos os aparelhos dele serão desconectados.`)) return;
        const r = await api('POST', `${BASE}/${e.id}/redefinir-senha`);
        showSecret(`Nova senha de ${e.nome}`, [['Login', e.login], ['Senha', r.senha]]);
      }),
      actionButton('Novo PIN', 'secondary', async () => {
        if (!confirm(`Gerar um novo PIN de gerente para "${e.nome}"? O PIN atual deixa de valer.`)) return;
        const r = await api('POST', `${BASE}/${e.id}/redefinir-pin`);
        showSecret(`Novo PIN de ${e.nome}`, [['PIN do gerente', r.pin]]);
      }),
      actionButton(e.ativo ? 'Suspender' : 'Reativar', e.ativo ? 'danger' : 'secondary', async () => {
        if (e.ativo && !confirm(`Suspender "${e.nome}"? Ninguém dele consegue usar o sistema até reativar.`)) return;
        await api('PATCH', `${BASE}/${e.id}`, { ativo: !e.ativo });
        await load();
      })
    );

    li.append(title, el('p', `Login: ${e.login} · Último acesso: ${when(e.ultimoAcesso)}`, 'muted'), actions);
    return li;
  }

  // Uma cópia por dia, com folga para o computador ter ficado desligado à noite
  const COPY_LATE_MS = 36 * 3600 * 1000;

  function showCopy(copy) {
    const late = !copy || Date.now() - new Date(copy.criadaEm).getTime() > COPY_LATE_MS;
    let text;
    if (!copy) text = 'Nenhuma cópia de segurança foi registrada. Se o banco se perder, não há como recuperar.';
    else if (late) text = `Cópia de segurança atrasada: a última é de ${when(copy.criadaEm)}.`;
    else if (!copy.conferida) text = `Última cópia: ${when(copy.criadaEm)}, sem teste de restauração.`;
    else text = `Última cópia: ${when(copy.criadaEm)}, com restauração testada.`;
    els.copyStatus.textContent = text;
    els.copyStatus.className = `copy-status ${late ? 'is-late' : copy.conferida ? 'is-ok' : 'is-warn'}`;
    els.copyStatus.hidden = false;
  }

  async function load() {
    const { estabelecimentos, ultimaCopia } = await api('GET', BASE);
    showCopy(ultimaCopia);
    els.list.replaceChildren(...estabelecimentos.map(item));
    els.empty.hidden = estabelecimentos.length > 0;
  }

  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      const data = Object.fromEntries(new FormData(els.loginForm));
      token.set((await api('POST', '/api/plataforma/login', data)).token);
      els.loginForm.reset();
      showView(true);
      await load();
    });
  });

  els.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    run(event.submitter, async () => {
      const r = await api('POST', BASE, Object.fromEntries(new FormData(els.createForm)));
      els.createForm.reset();
      showSecret(`Acesso de ${r.estabelecimento.nome}`, [
        ['Login', r.estabelecimento.login], ['Senha', r.senha], ['PIN do gerente', r.pin]
      ]);
      await load();
    });
  });

  els.secretClose.addEventListener('click', hideSecret);

  els.logout.addEventListener('click', () => {
    token.drop();
    showMessage('');
    showView(false);
  });

  if (token.get()) {
    showView(true);
    load().catch((e) => showMessage(e.message));
  }
})();
