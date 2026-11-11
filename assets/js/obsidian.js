/* =========================================================
   Banco de dados no Obsidian
   O servidor local (server/server.js) grava dentro do cofre:
     Comanda/dados.json            -> todos os dados (o site lê daqui)
     Comanda/Contas abertas.md     -> quem está com a conta aberta agora
     Comanda/Dias/AAAA-MM-DD.md    -> cada pedido do dia, com o horário
     Comanda/backup/               -> cópia dos dados de cada dia
   A conexão é automática. Se o servidor cair, os dados ficam
   guardados no navegador e são enviados assim que ele voltar.

   Modo local: hospedado sem servidor (ex.: GitHub Pages, aberto no
   tablet) os dados ficam só no aparelho. O modo é lembrado para
   não mostrar erro quando o app abrir sem internet.
   ========================================================= */

const Obsidian = (() => {
  const API = '/api/estado';
  const HEALTH = '/api/saude';
  const HEARTBEAT_MS = 5000;

  const MODE_KEY = 'comanda:modo';

  const listeners = new Set();
  let local = location.protocol === 'file:' || readMode() === 'local';

  let status = local ? 'local' : 'connecting';
  let vault = '';
  let folderPath = '';
  let pendingState = null;  // alterações ainda não gravadas
  let saveTimer = null;
  let queue = Promise.resolve();

  function readMode() {
    try { return localStorage.getItem(MODE_KEY); } catch { return null; }
  }

  function becomeLocal() {
    local = true;
    pendingState = null;
    try { localStorage.setItem(MODE_KEY, 'local'); } catch { /* ignora */ }
    setStatus('local');
  }

  function setStatus(next) {
    if (next === status) return;
    status = next;
    listeners.forEach((fn) => fn(status, { vault, path: folderPath }));
  }

  function payload(state) {
    return JSON.stringify({ estado: state });
  }

  /** 'ok' = servidor respondeu; 'none' = site sem servidor (404); 'down' = sem resposta. */
  async function checkHealth() {
    try {
      const res = await fetch(HEALTH, { cache: 'no-store' });
      if (res.status === 404) return 'none';
      if (!res.ok) return 'down';
      const info = await res.json().catch(() => null);
      if (!info || !info.ok) return 'none';
      vault = info.cofre;
      folderPath = info.pasta;
      return 'ok';
    } catch {
      return 'down';
    }
  }

  function flush() {
    if (local || !pendingState) return queue;
    const state = pendingState;
    pendingState = null;
    const body = payload(state);
    queue = queue.then(async () => {
      setStatus('saving');
      try {
        const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
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

  /** Verifica o servidor periodicamente e reenvia o que ficou pendente. */
  async function heartbeat() {
    if (local) return;
    const ok = (await checkHealth()) === 'ok';
    if (!ok) setStatus('offline');
    else if (pendingState) flush();
    else if (status === 'offline' || status === 'connecting') setStatus('connected');
  }

  return {
    status: () => status,
    vaultName: () => vault,
    folderPath: () => folderPath,
    isConnected: () => status === 'connected' || status === 'saving',
    isLocal: () => local,
    hasPending: () => !!pendingState,

    onStatus(fn) {
      listeners.add(fn);
      fn(status, { vault, path: folderPath });
    },

    /** Conecta e devolve os dados gravados no cofre (ou null). */
    async init() {
      if (local) return null;
      const health = await checkHealth();
      if (health === 'none') { becomeLocal(); return null; }
      setInterval(heartbeat, HEARTBEAT_MS);
      try {
        if (health !== 'ok') throw new Error('servidor sem resposta');
        const res = await fetch(API, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const { estado } = await res.json();
        setStatus('connected');
        return estado;
      } catch (e) {
        console.warn('Banco indisponível', e);
        setStatus('offline');
        return null;
      }
    },

    /** Agenda a gravação (agrupa várias alterações seguidas). */
    scheduleSave(state, delay = 400) {
      if (local) return;
      pendingState = state;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, delay);
    },

    saveNow(state) {
      if (local) return Promise.resolve();
      pendingState = state;
      clearTimeout(saveTimer);
      return flush();
    },

    /** Envio de emergência ao fechar a aba, para não perder a última alteração. */
    flushOnExit() {
      if (local || !pendingState) return;
      clearTimeout(saveTimer);
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload(pendingState),
        keepalive: true
      }).catch(() => {});
    }
  };
})();
