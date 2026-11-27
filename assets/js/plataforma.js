/* =========================================================
   Painel da plataforma: criar, editar, suspender e redefinir o
   acesso dos estabelecimentos.
   A sessão vale só enquanto a aba estiver aberta. Textos vindos
   do servidor entram com textContent (nunca como HTML).
   Senhas e PINs não podem ser lidos: só definidos de novo.
   ========================================================= */

(() => {
  const TOKEN_KEY = 'comanda:dono';
  const BASE = '/api/plataforma/estabelecimentos';
  // Uma cópia por dia, com folga para o computador ter ficado desligado à noite
  const COPY_LATE_MS = 36 * 3600 * 1000;
  const $ = (selector) => document.querySelector(selector);

  const ids = [
    'loginView', 'loginForm', 'loginError', 'panelView', 'logout', 'openCreate', 'message', 'stats', 'countAll',
    'countActive', 'countSuspended', 'copyStatus', 'search', 'table', 'list', 'empty',
    'createDialog', 'createForm', 'createError',
    'editDialog', 'editTitle', 'editSub', 'dataForm', 'passwordForm', 'pinForm', 'statusText', 'statusError', 'toggleActive',
    'secretDialog', 'secretTitle', 'secretList', 'secretClose',
    'confirmDialog', 'confirmTitle', 'confirmText', 'confirmCancel', 'confirmOk', 'toast'
  ];
  const els = Object.fromEntries(ids.map((id) => [id, $(`#${id}`)]));

  let items = [];
  let filter = 'all';
  let editingId = null;
  let toastTimer = null;

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

  const when = (value) => (value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca entrou');
  const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function toast(text) {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.hidden = false;
    // Uma janela aberta cobre o resto da página: o aviso vai para dentro dela
    (document.querySelector('dialog[open] .dialog__card') || document.body).append(els.toast);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
  }

  function showMessage(text) {
    els.message.textContent = text || '';
    els.message.hidden = !text;
  }

  /* ---------- Servidor ---------- */
  function showView(logged) {
    els.loginView.hidden = logged;
    els.panelView.hidden = !logged;
    if (!logged) {
      // Nada do painel fica na tela depois de sair
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      els.list.replaceChildren();
      els.secretList.replaceChildren();
      items = [];
      editingId = null;
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
      els.loginError.textContent = 'Sua sessão terminou. Entre de novo.';
      throw new Error('Sua sessão terminou. Entre de novo.');
    }
    if (!res.ok) throw new Error(data.erro || 'Não foi possível concluir.');
    return data;
  }

  /** Roda uma ação com o botão travado (evita clique duplo) e mostra o erro. */
  async function run(button, errorEl, action) {
    if (button.disabled) return;
    button.disabled = true;
    errorEl.textContent = '';
    try {
      await action();
    } catch (e) {
      errorEl.textContent = e.message;
      if (errorEl === els.message) showMessage(e.message);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- Janelas ---------- */
  function ask({ title, text, ok, danger = false }) {
    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmOk.textContent = ok;
    els.confirmOk.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    els.confirmDialog.returnValue = '';
    els.confirmDialog.showModal();
    els.confirmCancel.focus();
    return new Promise((resolve) => {
      els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue === 'ok'), { once: true });
    });
  }

  function showSecret(title, entries) {
    els.secretTitle.textContent = title;
    els.secretList.replaceChildren(...entries.flatMap(([label, value]) => [el('dt', label), el('dd', value)]));
    els.secretDialog.showModal();
  }

  /* ---------- Lista ---------- */
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function row(e) {
    const li = el('li', '', `row${e.ativo ? '' : ' is-off'}`);

    const who = el('div', '', 'row__who');
    const avatar = el('span', initials(e.nome), 'avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const names = el('div', '', 'row__names');
    names.append(el('strong', e.nome), el('span', e.login));
    who.append(avatar, names);

    const status = el('div', '', 'row__status');
    status.append(el('span', e.ativo ? 'Ativo' : 'Suspenso', `pill ${e.ativo ? 'pill--ok' : 'pill--off'}`));

    const access = el('div', '', 'row__access');
    access.append(el('span', 'Último acesso: ', 'row__label'), el('span', when(e.ultimoAcesso)));

    const button = el('button', 'Gerenciar', 'btn row__action');
    button.type = 'button';
    button.setAttribute('aria-label', `Gerenciar ${e.nome}`);
    button.addEventListener('click', () => openEdit(e.id));

    li.append(who, status, access, button);
    return li;
  }

  function render() {
    const active = items.filter((e) => e.ativo).length;
    els.countAll.textContent = items.length;
    els.countActive.textContent = active;
    els.countSuspended.textContent = items.length - active;

    const q = normalize(els.search.value);
    const shown = items.filter((e) => (filter === 'all' || e.ativo === (filter === 'active'))
      && (!q || normalize(e.nome).includes(q) || e.login.includes(q)));

    els.list.replaceChildren(...shown.map(row));
    els.table.hidden = !shown.length;
    els.empty.hidden = shown.length > 0;
    els.empty.textContent = items.length
      ? 'Nenhum estabelecimento corresponde à busca ou ao filtro.'
      : 'Nenhum estabelecimento cadastrado. Comece em "Novo estabelecimento".';
  }

  function showCopy(copy) {
    const late = !copy || Date.now() - new Date(copy.criadaEm).getTime() > COPY_LATE_MS;
    let text;
    if (!copy) text = 'Nenhuma cópia de segurança foi registrada. Se o banco se perder, não há como recuperar.';
    else if (late) text = `Cópia de segurança atrasada: a última é de ${when(copy.criadaEm)}.`;
    else if (!copy.conferida) text = `Última cópia: ${when(copy.criadaEm)}, sem teste de restauração.`;
    else text = `Última cópia: ${when(copy.criadaEm)}, com restauração testada.`;
    els.copyStatus.textContent = text;
    els.copyStatus.className = `notice ${late ? 'notice--danger' : copy.conferida ? 'notice--ok' : 'notice--warn'}`;
    els.copyStatus.hidden = false;
  }

  async function load() {
    const data = await api('GET', BASE);
    items = data.estabelecimentos;
    showCopy(data.ultimaCopia);
    render();
  }

  /* ---------- Editar ---------- */
  const current = () => items.find((e) => e.id === editingId);

  /** Atualiza o que a janela mostra, sem apagar o que está sendo digitado nas outras partes. */
  function paintEdit() {
    const e = current();
    if (!e) return;
    els.editTitle.textContent = e.nome;
    els.editSub.textContent = `Login: ${e.login} · Último acesso: ${when(e.ultimoAcesso)}`;
    els.statusText.textContent = e.ativo
      ? 'Ativo. Suspender bloqueia o acesso na hora, sem apagar nenhum dado.'
      : 'Suspenso. Ninguém dele consegue usar o sistema. Os dados continuam guardados.';
    els.toggleActive.textContent = e.ativo ? 'Suspender acesso' : 'Reativar acesso';
    els.toggleActive.className = `btn ${e.ativo ? 'btn--danger' : 'btn--primary'}`;
  }

  function hidePasswords() {
    els.editDialog.querySelectorAll('[data-reveal]').forEach((button) => {
      button.previousElementSibling.type = 'password';
      button.textContent = 'Mostrar';
    });
  }

  function clearEdit() {
    [els.dataForm, els.passwordForm, els.pinForm].forEach((form) => {
      form.reset();
      form.querySelector('.form-error').textContent = '';
    });
    els.statusError.textContent = '';
    hidePasswords();
  }

  function openEdit(id) {
    editingId = id;
    const e = current();
    clearEdit();
    els.dataForm.elements.nome.value = e.nome;
    els.dataForm.elements.login.value = e.login;
    paintEdit();
    els.editDialog.showModal();
    els.editDialog.querySelector('.dialog__body').scrollTop = 0;
  }

  const errorOf = (form) => form.querySelector('.form-error');

  async function saveData(event) {
    event.preventDefault();
    const e = current();
    const nome = els.dataForm.elements.nome.value.trim();
    const login = els.dataForm.elements.login.value.trim().toLowerCase();
    if (nome === e.nome && login === e.login) {
      toast('Nada mudou.');
      return;
    }
    await run(els.dataForm.querySelector('[type="submit"]'), errorOf(els.dataForm), async () => {
      if (login !== e.login && !(await ask({
        title: 'Trocar o login?',
        text: `"${e.login}" deixa de funcionar. Avise o cliente: a próxima entrada é com "${login}".`,
        ok: 'Trocar login'
      }))) return;
      const r = await api('PATCH', `${BASE}/${e.id}`, { nome, login });
      await load();
      els.dataForm.elements.nome.value = r.estabelecimento.nome;
      els.dataForm.elements.login.value = r.estabelecimento.login;
      paintEdit();
      toast('Dados salvos.');
    });
  }

  /** Senha ou PIN: digitado pelo dono ou, com `generate`, sorteado pelo servidor. */
  async function saveSecret({ form, button, generate, field, route, label, check, confirmText }) {
    const e = current();
    const input = form.elements[field];
    const typed = input.value.trim();
    const problem = generate ? '' : check(typed);
    errorOf(form).textContent = problem;
    if (problem) {
      input.focus();
      return;
    }
    await run(button, errorOf(form), async () => {
      if (!(await ask({ title: `${generate ? 'Gerar' : 'Salvar'} ${label} de ${e.nome}?`, text: confirmText, ok: 'Confirmar' }))) return;
      const result = await api('POST', `${BASE}/${e.id}/${route}`, generate ? {} : { [field]: typed });
      form.reset();
      hidePasswords();
      showSecret(`Acesso de ${e.nome}`, [['Login', e.login], [field === 'pin' ? 'PIN do gerente' : 'Senha', result[field]]]);
    });
  }

  function bindSecretForm(form, options) {
    const send = (button, generate) => saveSecret({ ...options, form, button, generate });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send(form.querySelector('[type="submit"]'), false);
    });
    form.querySelector('[data-generate]').addEventListener('click', (event) => send(event.currentTarget, true));
  }

  function toggleActive() {
    const e = current();
    run(els.toggleActive, els.statusError, async () => {
      if (e.ativo && !(await ask({
        title: `Suspender ${e.nome}?`,
        text: 'Ninguém dele consegue usar o sistema até reativar. Nenhum dado é apagado.',
        ok: 'Suspender', danger: true
      }))) return;
      await api('PATCH', `${BASE}/${e.id}`, { ativo: !e.ativo });
      await load();
      paintEdit();
      toast(e.ativo ? 'Acesso suspenso.' : 'Acesso reativado.');
    });
  }

  /* ---------- Eventos ---------- */
  document.querySelectorAll('dialog [data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  // Fechar a janela apaga o que foi digitado
  els.editDialog.addEventListener('close', () => { clearEdit(); editingId = null; });
  els.secretDialog.addEventListener('close', () => els.secretList.replaceChildren());
  // A senha gerada não some com um Esc sem querer: só no botão
  els.secretDialog.addEventListener('cancel', (event) => event.preventDefault());
  els.secretClose.addEventListener('click', () => {
    els.secretList.replaceChildren();
    els.secretDialog.close();
  });
  els.confirmOk.addEventListener('click', () => els.confirmDialog.close('ok'));
  els.confirmCancel.addEventListener('click', () => els.confirmDialog.close());

  els.editDialog.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reveal]');
    if (!button) return;
    event.preventDefault();
    const input = button.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Ocultar' : 'Mostrar';
  });
  els.pinForm.elements.pin.addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
  });

  els.dataForm.addEventListener('submit', saveData);
  bindSecretForm(els.passwordForm, {
    field: 'senha', route: 'redefinir-senha', label: 'a senha',
    check: (value) => (value.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : ''),
    confirmText: 'A senha atual deixa de funcionar e todos os aparelhos deste estabelecimento são desconectados.'
  });
  bindSecretForm(els.pinForm, {
    field: 'pin', route: 'redefinir-pin', label: 'o PIN',
    check: (value) => (/^\d{6}$/.test(value) ? '' : 'O PIN precisa ter 6 números.'),
    confirmText: 'O PIN atual deixa de valer.'
  });
  els.toggleActive.addEventListener('click', toggleActive);

  els.openCreate.addEventListener('click', () => {
    els.createForm.reset();
    els.createError.textContent = '';
    els.createDialog.showModal();
  });
  els.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    run(els.createForm.querySelector('[type="submit"]'), els.createError, async () => {
      const r = await api('POST', BASE, Object.fromEntries(new FormData(els.createForm)));
      els.createDialog.close();
      showSecret(`Acesso de ${r.estabelecimento.nome}`, [
        ['Login', r.estabelecimento.login], ['Senha', r.senha], ['PIN do gerente', r.pin]
      ]);
      await load();
    });
  });

  els.stats.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    els.stats.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b === button));
    render();
  });
  els.search.addEventListener('input', render);

  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    run(els.loginForm.querySelector('[type="submit"]'), els.loginError, async () => {
      const data = Object.fromEntries(new FormData(els.loginForm));
      token.set((await api('POST', '/api/plataforma/login', data)).token);
      els.loginForm.reset();
      showMessage('');
      showView(true);
      await load();
    });
  });

  els.logout.addEventListener('click', () => {
    token.drop();
    showMessage('');
    els.loginError.textContent = '';
    showView(false);
  });

  if (token.get()) {
    showView(true);
    load().catch((e) => showMessage(e.message));
  }
})();
