/* =========================================================
   Conexão com o servidor
   Guarda a sessão do estabelecimento no aparelho. A liberação da
   gerência (PIN) fica só na memória e é esquecida ao fechar a janela.

   Toda ação que cria algo leva um identificador próprio, então
   repetir o envio quando a internet falha nunca grava duas vezes.
   ========================================================= */

const Api = (() => {
  const SESSION_KEY = 'comanda:sessao';
  const TIMEOUT_MS = 15000;
  const RETRY_DELAYS_MS = [600, 1800];

  const listeners = { expired: new Set(), network: new Set() };
  const emit = (event, value) => listeners[event].forEach((fn) => fn(value));

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  let session = readSession();   // { token, estabelecimento }
  let managerToken = null;
  let online = true;

  function saveSession(next) {
    session = next;
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* sem armazenamento: a sessão vale só até fechar a aba */ }
  }

  function setOnline(next) {
    if (next === online) return;
    online = next;
    emit('network', online);
  }

  /** Identificador único. randomUUID só existe em https e em localhost. */
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;   // 0 = o servidor não respondeu
    }
  }

  async function attempt(method, url, body, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        cache: 'no-store',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      return { res, data: await res.json().catch(() => ({})) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `retry`: quantas vezes insistir quando o servidor não responde. Só use em
   * leituras e em ações que o servidor reconhece se chegarem repetidas.
   */
  async function request(method, url, { body, manager = false, retry = 0, auth = true } = {}) {
    const sentToken = auth ? session?.token : null;
    const headers = {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      ...(manager && managerToken ? { 'X-Gerencia': managerToken } : {})
    };

    for (let i = 0; ; i++) {
      let result = null;
      try { result = await attempt(method, url, body, headers); } catch { /* sem resposta */ }

      // 502 a 504: o servidor está acordando ou reiniciando
      if (!result || (result.res.status >= 502 && result.res.status <= 504)) {
        if (i < retry) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)]));
          continue;
        }
        setOnline(false);
        throw new ApiError(0, 'Sem resposta do servidor. Confira a internet e tente de novo.');
      }

      setOnline(true);
      const { res, data } = result;
      if (res.ok) return data;
      // A sessão venceu ou a senha foi trocada (ignora respostas de uma sessão antiga)
      if (res.status === 401 && sentToken && sentToken === session?.token && url !== '/api/gerencia') {
        saveSession(null);
        managerToken = null;
        emit('expired', 'Sua sessão terminou. Entre de novo.');
      }
      throw new ApiError(res.status, data.erro || 'Não foi possível concluir.');
    }
  }

  return {
    newId,
    request,
    on: (event, fn) => listeners[event].add(fn),
    isOnline: () => online,

    hasSession: () => !!session,
    establishment: () => session?.estabelecimento || null,

    async login(usuario, senha) {
      const data = await request('POST', '/api/login', { body: { usuario, senha }, auth: false });
      saveSession({ token: data.token, estabelecimento: data.estabelecimento });
      return data.estabelecimento;
    },

    logout() {
      saveSession(null);
      managerToken = null;
    },

    /** O acesso foi suspenso: volta para a tela de entrada com o motivo. */
    block(message) {
      saveSession(null);
      managerToken = null;
      emit('expired', message);
    },

    /* ---------- Gerência ---------- */
    isManager: () => !!managerToken,
    lockManager() { managerToken = null; },

    async unlockManager(pin) {
      managerToken = (await request('POST', '/api/gerencia', { body: { pin } })).gerencia;
    },

    async changePassword(senha) {
      const data = await request('PUT', '/api/gerencia/senha', { body: { senha }, manager: true });
      saveSession({ ...session, token: data.token });
      managerToken = data.gerencia;
    },

    async changePin(pin) {
      managerToken = (await request('PUT', '/api/gerencia/pin', { body: { pin }, manager: true })).gerencia;
    }
  };
})();
