/* =========================================================
   Conexão com o servidor: dados, login e painel de acessos
   O servidor (server/server.js) guarda os dados (no Neon ou em
   arquivos) e confere o login das três contas.

   Estados: local (sem servidor, dados só no aparelho), connecting,
   connected, saving, offline (servidor fora do ar ou dormindo) e
   login (o servidor pede usuário e senha). Se o servidor cair, os
   dados ficam guardados no aparelho e são enviados quando ele voltar.
   ========================================================= */

const Api = (() => {
  const STATE_URL = '/api/estado';
  const HEALTH = '/api/saude';
  const LOGIN = '/api/login';
  const ACCOUNTS_URL = '/api/contas';
  const HEARTBEAT_MS = 5000;
  const MODE_KEY = 'comanda:modo';
  const TOKEN_KEY = 'comanda:token';
  const USER_KEY = 'comanda:usuario';
  const ROLE_KEY = 'comanda:funcao';

  const listeners = new Set();
  const reconnectHandlers = new Set();

  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignora */ } };
  const drop = (key) => { try { localStorage.removeItem(key); } catch { /* ignora */ } };

  let local = location.protocol === 'file:' || read(MODE_KEY) === 'local';
  let status = local ? 'local' : 'connecting';
  let authRequired = false;
  let database = '';          // 'postgres' (Neon) ou 'arquivo'
  let pendingState = null;    // alterações ainda não gravadas
  let saveTimer = null;
  let queue = Promise.resolve();
  let checking = false;

  function setStatus(next) {
    if (next === status) return;
    status = next;
    listeners.forEach((fn) => fn(status));
  }

  function becomeLocal() {
    local = true;
    pendingState = null;
    write(MODE_KEY, 'local');
    setStatus('local');
  }

  function headers(extra = {}) {
    const token = read(TOKEN_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  /** O servidor recusou a sessão (venceu, a senha foi trocada ou nunca existiu): pede login de novo. */
  function expireSession() {
    drop(TOKEN_KEY);
    setStatus('login');
  }

  /** kind: 'ok' = servidor respondeu; 'none' = site sem servidor (404); 'down' = sem resposta. */
  async function health() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(HEALTH, { cache: 'no-store', signal: controller.signal });
      if (res.status === 404) return { kind: 'none' };
      if (!res.ok) return { kind: 'down' };
      const info = await res.json().catch(() => null);
      if (!info || !info.ok) return { kind: 'none' };
      authRequired = !!info.auth;
      database = info.banco || '';
      return { kind: 'ok' };
    } catch {
      return { kind: 'down' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lê os dados do servidor. ok:false quando precisa de login ou o servidor não respondeu. */
  async function fetchRemote() {
    try {
      const res = await fetch(STATE_URL, { cache: 'no-store', headers: headers() });
      if (res.status === 401) { expireSession(); return { ok: false }; }
      if (!res.ok) throw new Error(res.status);
      const { estado } = await res.json();
      return { ok: true, estado };
    } catch (e) {
      console.warn('Não foi possível ler os dados do servidor', e);
      return { ok: false };
    }
  }

  function flush() {
    if (local || !pendingState || status === 'login') return queue;
    const state = pendingState;
    pendingState = null;
    const body = JSON.stringify({ estado: state });
    queue = queue.then(async () => {
      setStatus('saving');
      try {
        const res = await fetch(STATE_URL, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body });
        if (res.status === 401) {
          if (!pendingState) pendingState = state;
          expireSession();
          return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro || res.status);
        setStatus(pendingState ? 'saving' : 'connected');
      } catch (e) {
        console.warn('Falha ao gravar no banco; tentando de novo em instantes', e);
        // Guarda para reenviar, a menos que já exista uma versão mais nova esperando
        if (!pendingState) pendingState = state;
        setStatus('offline');
      }
    });
    return queue;
  }

  /** Confere o servidor de tempos em tempos; ao voltar, lê os dados e reenvia o que ficou pendente. */
  async function heartbeat() {
    if (local || checking) return;
    checking = true;
    try {
      const h = await health();
      if (h.kind === 'down') { if (status !== 'login') setStatus('offline'); return; }
      if (h.kind === 'none' || status === 'login') return;
      if (authRequired && !read(TOKEN_KEY)) { setStatus('login'); return; }

      if (status === 'offline' || status === 'connecting') {
        const r = await fetchRemote();
        if (!r.ok) return;
        setStatus('connected');
        reconnectHandlers.forEach((fn) => fn(r.estado));
      }
      if (pendingState) flush();
    } finally {
      checking = false;
    }
  }

  /** Chamada autenticada para o painel de acessos. Lança Error com a mensagem do servidor. */
  async function authed(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        cache: 'no-store',
        headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('Não consegui falar com o servidor. Confira a internet.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { expireSession(); throw new Error('Sua sessão terminou. Entre de novo.'); }
    if (!res.ok) throw new Error(data.erro || 'Não foi possível concluir.');
    return data;
  }

  return {
    status: () => status,
    isConnected: () => status === 'connected' || status === 'saving',
    isLocal: () => local,
    isAuthRequired: () => authRequired,
    hasSession: () => !!read(TOKEN_KEY),
    hasPending: () => !!pendingState,
    /** 'postgres' (Neon, permanente) ou 'arquivo' (some quando o Render reinicia). */
    database: () => database,

    /** Login da conta que está usando (ex.: "admin"). */
    user: () => read(USER_KEY) || '',
    /** Função: 'super' (ADMIN), 'admin' ou 'user'. Sem servidor (modo local) o aparelho é o dono: 'super'. */
    role: () => (local ? 'super' : read(ROLE_KEY) || 'user'),

    onStatus(fn) {
      listeners.add(fn);
      fn(status);
    },

    /** Chamado quando o servidor volta depois de ter ficado fora do ar (recebe os dados dele). */
    onReconnect(fn) { reconnectHandlers.add(fn); },

    /** Conecta e devolve os dados gravados no servidor (ou null). */
    async init() {
      if (local) return null;
      const h = await health();
      if (h.kind === 'none') { becomeLocal(); return null; }
      setInterval(heartbeat, HEARTBEAT_MS);
      if (h.kind === 'down') { setStatus('offline'); return null; }
      if (authRequired && !read(TOKEN_KEY)) { setStatus('login'); return null; }
      const r = await fetchRemote();
      if (!r.ok) { if (status !== 'login') setStatus('offline'); return null; }
      setStatus('connected');
      return r.estado;
    },

    /** Entra com usuário e senha. Devolve os dados do servidor; lança erro com a mensagem para a tela. */
    async login(usuario, senha) {
      let res;
      try {
        res = await fetch(LOGIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario, senha })
        });
      } catch {
        throw new Error('Não consegui falar com o servidor. Confira a internet e tente de novo.');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Não foi possível entrar.');
      write(TOKEN_KEY, data.token);
      write(USER_KEY, data.login || usuario);
      write(ROLE_KEY, data.funcao || 'user');
      const r = await fetchRemote();
      setStatus('connected');
      return r.ok ? r.estado : null;
    },

    logout() {
      drop(TOKEN_KEY);
      pendingState = null;
      setStatus('login');
    },

    /* ---------- Painel de acessos (ADMIN e admin) ---------- */

    /** As contas que esta função pode ver: { eu, contas: [{login, rotulo, ultimoAcesso, senhaPadrao}], banco }. */
    accounts: () => authed('GET', ACCOUNTS_URL),

    /** A senha de uma conta (null quando não dá para mostrar). Só com permissão. */
    async revealPassword(login) {
      return (await authed('POST', `${ACCOUNTS_URL}/senha-ver`, { login })).senha;
    },

    /** Troca a senha de uma conta. Se for a de quem está logado, a sessão é renovada. */
    async changePassword(login, senha) {
      const data = await authed('PUT', `${ACCOUNTS_URL}/senha`, { login, senha });
      if (data.token) write(TOKEN_KEY, data.token);
      return data.conta;
    },

    /** Agenda a gravação (agrupa várias alterações seguidas). */
    scheduleSave(state, delay = 400) {
      if (local || state.pristine) return;
      pendingState = state;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, delay);
    },

    saveNow(state) {
      // Uma lista nunca usada não pode ir para o servidor: apagaria os dados de lá
      if (local || state.pristine) return Promise.resolve();
      pendingState = state;
      clearTimeout(saveTimer);
      return flush();
    },

    /** Envio de emergência ao fechar a aba, para não perder a última alteração. */
    flushOnExit() {
      if (local || !pendingState || status === 'login') return;
      clearTimeout(saveTimer);
      fetch(STATE_URL, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ estado: pendingState }),
        keepalive: true
      }).catch(() => {});
    }
  };
})();
