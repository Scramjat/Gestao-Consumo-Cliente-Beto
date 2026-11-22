/* =========================================================
   As três contas: criação, login, painel de senhas
   Regras de quem pode ver/trocar a senha de quem: assets/js/roles.js
   ========================================================= */

const Roles = require('../assets/js/roles.js');
const Auth = require('./auth.js');

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 64;

function createAccounts({ storage, secret, encryptionKey, initialPassword, log = () => {} }) {
  const cache = new Map();   // login -> conta (fica em memória; o servidor é um só)
  let dummyHash = null;

  async function init() {
    (await storage.listAccounts()).forEach((a) => cache.set(a.login, a));

    // Cria as contas que faltam, todas com a senha padrão (ou a definida em SENHA_INICIAL)
    for (const def of Roles.ACCOUNTS) {
      if (cache.has(def.login)) continue;
      const password = initialPassword || Roles.SENHA_PADRAO;
      const account = {
        login: def.login,
        role: def.id,
        passwordHash: await Auth.hashPassword(password),
        passwordEnc: Auth.encrypt(password, encryptionKey),
        isDefault: password === Roles.SENHA_PADRAO,
        tokenVersion: 1,
        lastLogin: null
      };
      await storage.saveAccount(account);
      cache.set(def.login, account);
      log(`Conta criada: ${def.login} (${def.label})`);
    }
  }

  /** O que a tela pode saber de uma conta (nunca a senha). */
  const publicInfo = (a) => ({
    login: a.login,
    funcao: a.role,
    rotulo: Roles.label(a.role),
    ultimoAcesso: a.lastLogin,
    senhaPadrao: !!a.isDefault
  });

  /** Confere usuário e senha. Devolve a conta ou null. */
  async function login(usuario, senha) {
    const account = cache.get(String(usuario || '').trim());
    // A conta do hash sempre roda, mesmo sem conta, para o tempo de resposta não revelar nada
    dummyHash ||= await Auth.hashPassword('sem-conta');
    const ok = await Auth.verifyPassword(String(senha || '').trim(), account ? account.passwordHash : dummyHash);
    if (!account || !ok) return null;
    account.lastLogin = new Date().toISOString();
    try { await storage.saveAccount(account); } catch (e) { log(`Não consegui gravar o último acesso: ${e.message}`); }
    return account;
  }

  const tokenFor = (account) => Auth.createToken(account.login, account.tokenVersion, secret);

  /** Conta dona do token, se ele ainda vale (senha não trocada desde que foi criado). */
  function fromToken(token) {
    const data = Auth.verifyToken(token, secret);
    const account = data && cache.get(data.u);
    return account && account.tokenVersion === data.v ? account : null;
  }

  /** As contas que quem está logado pode ver no painel. */
  function list(viewer) {
    return (Roles.PASSWORD_ACCESS[viewer.role] || []).map((login) => cache.get(login)).filter(Boolean).map(publicInfo);
  }

  /** A senha de uma conta, só para quem tem permissão. */
  function reveal(viewer, login) {
    if (!Roles.canViewPassword(viewer.role, login) || !cache.has(login)) {
      return { status: 403, erro: 'Você não tem permissão para ver essa senha.' };
    }
    const password = Auth.decrypt(cache.get(login).passwordEnc, encryptionKey);
    log(`Senha de ${login} vista por ${viewer.login}`);
    return { status: 200, senha: password };   // null = a chave mudou; a tela pede para definir outra
  }

  async function changePassword(viewer, login, novaSenha) {
    if (!Roles.canChangePassword(viewer.role, login) || !cache.has(login)) {
      return { status: 403, erro: 'Você não tem permissão para trocar essa senha.' };
    }
    const password = String(novaSenha || '').trim();
    if (password.length < MIN_PASSWORD) return { status: 400, erro: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` };
    if (password.length > MAX_PASSWORD) return { status: 400, erro: `A senha pode ter no máximo ${MAX_PASSWORD} caracteres.` };
    if (password === login) return { status: 400, erro: 'A senha não pode ser igual ao login.' };

    const account = cache.get(login);
    account.passwordHash = await Auth.hashPassword(password);
    account.passwordEnc = Auth.encrypt(password, encryptionKey);
    account.isDefault = password === Roles.SENHA_PADRAO;
    account.tokenVersion += 1;   // derruba todas as sessões dessa conta
    await storage.saveAccount(account);
    log(`Senha de ${login} trocada por ${viewer.login}`);

    // Quem trocou a própria senha continua logado, com uma sessão nova
    const result = { status: 200, conta: publicInfo(account) };
    if (login === viewer.login) result.token = tokenFor(account);
    return result;
  }

  return { init, login, tokenFor, fromToken, list, reveal, changePassword, publicInfo, MIN_PASSWORD };
}

module.exports = { createAccounts };
