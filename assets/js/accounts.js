/* =========================================================
   Acessos e senhas (painel de controle)
   - ADMIN vê e troca as senhas das 3 contas.
   - admin vê e troca as senhas dele e do Usuário.
   O servidor é quem decide o que cada um pode (roles.js); aqui só
   aparece o que ele devolve. A senha só é buscada ao clicar em
   "Mostrar" e volta a ficar escondida sozinha.
   ========================================================= */

const Accounts = (() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = Utils.escapeHTML;

  const dialog = $('#accessDialog');
  const list = $('#accessList');
  const sub = $('#accessSub');
  const warn = $('#accessWarn');

  const REVEAL_SECONDS = 20;
  let data = null;          // { eu, contas, banco }
  let editing = null;       // login da conta com o formulário de troca aberto
  const timers = new Map(); // login -> temporizador que esconde a senha
  const changeHandlers = new Set();

  const isLocalHost = () => ['localhost', '127.0.0.1'].includes(location.hostname);

  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
  }

  function editForm(c) {
    return `<form class="acc__edit" data-form>
      <label class="field">
        <span class="field__label">Nova senha</span>
        <input type="text" name="senha" maxlength="64" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Mínimo 6 caracteres">
      </label>
      ${c.funcao === 'user' ? '<p class="acc__warn">Trocar a senha do Usuário desconecta todos os atendentes.</p>' : ''}
      <small class="field__error" data-error></small>
      <div class="acc__edit-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-act="cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary btn--sm">Salvar senha</button>
      </div>
    </form>`;
  }

  function rowHtml(c) {
    const me = c.login === data.eu.login;
    return `<li class="acc" data-login="${esc(c.login)}">
      <div class="acc__head">
        <span class="acc__name"><strong>${esc(c.rotulo)}</strong><small>login: <code>${esc(c.login)}</code></small></span>
        ${me ? '<span class="acc__tag">você</span>' : ''}
        ${c.senhaPadrao ? '<span class="acc__tag acc__tag--warn">senha padrão</span>' : ''}
      </div>
      <p class="acc__meta">${c.ultimoAcesso ? `Último acesso: ${Utils.formatWhen(c.ultimoAcesso)}` : 'Ainda não entrou'}</p>
      <div class="acc__row">
        <span class="acc__label">Senha</span>
        <code class="acc__pass" data-pass>••••••••</code>
        <button type="button" class="btn btn--ghost btn--sm" data-act="reveal">Mostrar</button>
      </div>
      ${editing === c.login
        ? editForm(c)
        : '<button type="button" class="btn btn--soft btn--sm acc__change" data-act="change">Alterar senha</button>'}
    </li>`;
  }

  function render() {
    clearTimers();
    sub.textContent = `Você entrou como ${data.eu.login} (${data.eu.rotulo})`;
    list.innerHTML = data.contas.map(rowHtml).join('');

    const temporary = data.banco === 'arquivo' && !isLocalHost();
    warn.hidden = !temporary;
    if (temporary) {
      warn.textContent = 'O banco permanente (Neon) ainda não está conectado: quando o servidor reiniciar, os dados e as senhas voltam ao padrão.';
    }
  }

  async function load() {
    data = await Api.accounts();
  }

  function hide(li) {
    clearTimeout(timers.get(li.dataset.login));
    timers.delete(li.dataset.login);
    li.querySelector('[data-pass]').textContent = '••••••••';
    li.querySelector('[data-act="reveal"]').textContent = 'Mostrar';
  }

  async function reveal(li, btn) {
    // Segundo clique esconde de novo
    if (btn.textContent === 'Ocultar') return hide(li);
    btn.disabled = true;
    try {
      const password = await Api.revealPassword(li.dataset.login);
      li.querySelector('[data-pass]').textContent = password == null ? 'indisponível — defina uma nova senha' : password;
      btn.textContent = 'Ocultar';
      timers.set(li.dataset.login, setTimeout(() => hide(li), REVEAL_SECONDS * 1000));
    } catch (e) {
      UI.toast(e.message, { type: 'error' });
    } finally {
      btn.disabled = false;
    }
  }

  async function save(form) {
    const li = form.closest('.acc');
    const errorEl = form.querySelector('[data-error]');
    const input = form.querySelector('[name="senha"]');
    errorEl.textContent = '';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const account = await Api.changePassword(li.dataset.login, input.value);
      editing = null;
      await load();
      render();
      UI.toast(`Senha de ${account.login} alterada`, { type: 'success' });
      changeHandlers.forEach((fn) => fn());
    } catch (e) {
      errorEl.textContent = e.message;
      UI.shake(form);
      input.focus();
    } finally {
      submit.disabled = false;
    }
  }

  function bind() {
    UI.Modal.bind(dialog);
    dialog.addEventListener('close', () => { clearTimers(); editing = null; });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const li = btn.closest('.acc');
      if (btn.dataset.act === 'reveal') reveal(li, btn);
      if (btn.dataset.act === 'change') {
        editing = li.dataset.login;
        render();
        list.querySelector('.acc__edit input')?.focus();
      }
      if (btn.dataset.act === 'cancel') { editing = null; render(); }
    });

    list.addEventListener('submit', (e) => {
      e.preventDefault();
      save(e.target);
    });
  }

  bind();

  return {
    async open() {
      try {
        editing = null;
        await load();
        render();
        UI.Modal.open(dialog);
      } catch (e) {
        UI.toast(e.message, { type: 'error' });
      }
    },
    /** Avisa quando uma senha é trocada (para atualizar a faixa de aviso). */
    onChange(fn) { changeHandlers.add(fn); }
  };
})();
