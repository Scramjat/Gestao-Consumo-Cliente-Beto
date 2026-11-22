/* =========================================================
   Contas e permissões
   Três contas fixas. Este arquivo é usado pelo servidor (que
   confere tudo de verdade) e pela tela (que só esconde o que a
   pessoa não pode usar), então as regras ficam sempre iguais.

     ADMIN  -> Super administrador (dono do sistema)
     admin  -> Administrador (responsável do cliente)
     user   -> Usuário (uma conta só, compartilhada por todos os atendentes)

   O login diferencia maiúsculas de minúsculas ("ADMIN" e "admin"
   são contas diferentes).
   ========================================================= */

(function (root) {
  /** Senha de todas as contas na primeira vez que o sistema liga. */
  const SENHA_PADRAO = 'beto';

  const ROLES = {
    super: { id: 'super', login: 'ADMIN', label: 'Super administrador' },
    admin: { id: 'admin', login: 'admin', label: 'Administrador' },
    user: { id: 'user', login: 'user', label: 'Usuário (atendentes)' }
  };

  /** As três contas, na ordem em que aparecem. */
  const ACCOUNTS = [ROLES.super, ROLES.admin, ROLES.user];

  /** De quais contas cada função pode VER e ALTERAR a senha. O Usuário não troca nem a própria. */
  const PASSWORD_ACCESS = {
    super: ['ADMIN', 'admin', 'user'],
    admin: ['admin', 'user'],
    user: []
  };

  const EVERYONE = ['super', 'admin', 'user'];

  /** O que cada função pode fazer. */
  const PERMISSIONS = {
    'accounts.panel': ['super', 'admin'],   // painel de controle (Acessos)
    'products.edit': ['super', 'admin'],    // cadastrar/editar preços (o Usuário só consulta)
    'backup': ['super', 'admin'],           // fazer e restaurar backup
    'clients.write': EVERYONE,
    'orders.write': EVERYONE,
    'accounts.close': EVERYONE,             // encerrar conta (registrar pagamento)
    'accounts.reopen': EVERYONE,
    'metrics': EVERYONE,
    'excel': EVERYONE
  };

  const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role);
  const canViewPassword = (role, login) => (PASSWORD_ACCESS[role] || []).includes(login);
  const canChangePassword = canViewPassword;
  const roleOfLogin = (login) => (ACCOUNTS.find((a) => a.login === login) || {}).id || null;
  const label = (role) => (ROLES[role] || {}).label || '';

  const Roles = {
    SENHA_PADRAO, ROLES, ACCOUNTS, PASSWORD_ACCESS, PERMISSIONS,
    can, canViewPassword, canChangePassword, roleOfLogin, label
  };
  root.Roles = Roles;
  if (typeof module !== 'undefined') module.exports = Roles;
})(typeof window !== 'undefined' ? window : globalThis);
