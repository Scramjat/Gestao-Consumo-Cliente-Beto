/* =========================================================
   Confere a configuração da cópia de segurança, item por item,
   antes de copiar. Só LÊ os bancos e nunca mostra senhas nem
   endereços.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const copy = require('./copia.js');

const toolVersion = (tool, pgBin) => new Promise((resolve, reject) => {
  execFile(pgBin ? path.join(pgBin, tool) : tool, ['--version'], { windowsHide: true }, (error, stdout) => {
    const match = !error && String(stdout).match(/(\d+)(?:\.\d+)?/);
    if (match) resolve(Number(match[1]));
    else reject(new Error(`não encontrei o ${tool}. Aponte PG_BIN para a pasta "bin" do PostgreSQL.`));
  });
});

/** Tira de uma mensagem de erro qualquer pedaço secreto da configuração. */
function redact(message, env) {
  const secrets = [env.BACKUP_SENHA];
  for (const value of [env.DATABASE_URL, env.VERIFICAR_URL, env.DESTINO_URL]) {
    if (!value) continue;
    secrets.push(value);
    try {
      const url = new URL(value);
      secrets.push(url.password, decodeURIComponent(url.password), url.hostname, url.username);
    } catch { /* endereço inválido: o texto inteiro já está na lista */ }
  }
  return secrets
    .filter((s) => s && s.length > 2 && !['localhost', '127.0.0.1', 'postgres'].includes(s))
    .sort((a, b) => b.length - a.length)
    .reduce((text, secret) => text.split(secret).join('***'), String(message));
}

function parseUrl(value, name) {
  if (!value) throw new Error(`${name} está vazio.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} não é um endereço válido (deve começar com postgresql://).`); }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.pathname.slice(1)) {
    throw new Error(`${name} precisa ser como postgresql://usuario:senha@servidor/banco.`);
  }
  return url;
}

const SSL_HINT = ' Se o erro for de certificado, acrescente no backup.env a linha PGSSLROOTCERT=C:\\Program Files\\Git\\mingw64\\etc\\ssl\\certs\\ca-bundle.crt';

/** Devolve true quando está tudo pronto. `print` recebe cada linha do resultado. */
async function check({ env, folder, print }) {
  const pgBin = (env.PG_BIN || '').trim();
  let ready = true;
  const step = async (title, work) => {
    try {
      const detail = await work();
      print(`  ok     ${title}${detail ? `: ${detail}` : ''}`);
      return true;
    } catch (e) {
      ready = false;
      print(`  FALTA  ${title}: ${redact(e.message || e.code || e, env)}`);
      return false;
    }
  };

  await step('Senha das cópias', () => {
    if (String(env.BACKUP_SENHA || '').length < copy.MIN_PASSWORD) {
      throw new Error(`BACKUP_SENHA precisa ter ${copy.MIN_PASSWORD} caracteres ou mais.`);
    }
    return 'preenchida';
  });

  await step('Pasta das cópias', () => {
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.teste-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe);
    return folder;
  });

  let dump = null;
  await step('Ferramentas do PostgreSQL', async () => {
    dump = await toolVersion('pg_dump', pgBin);
    const restore = await toolVersion('pg_restore', pgBin);
    return `pg_dump ${dump}, pg_restore ${restore}`;
  });

  let source = null;
  await step('Banco que será copiado (DATABASE_URL)', async () => {
    const url = parseUrl(env.DATABASE_URL, 'DATABASE_URL');
    if (url.hostname.split('.')[0].endsWith('-pooler')) {
      throw new Error('use o endereço direto do Neon: desligue "Connection pooling" (sem "-pooler" no nome).');
    }
    try {
      source = await copy.inspect(env.DATABASE_URL, pgBin);
    } catch (e) {
      throw new Error(`${e.message}${env.PGSSL === 'disable' ? '' : SSL_HINT}`);
    }
    if (dump && source.version > dump) {
      throw new Error(`o banco é PostgreSQL ${source.version} e o pg_dump é ${dump}. Instale uma versão igual ou mais nova.`);
    }
    const names = source.tables.length ? source.tables.join(', ') : 'nenhuma';
    return `PostgreSQL ${source.version}; tabelas: ${names}`;
  });

  await step('Postgres para conferir as cópias (VERIFICAR_URL)', async () => {
    parseUrl(env.VERIFICAR_URL, 'VERIFICAR_URL');
    const local = await copy.inspect(env.VERIFICAR_URL, pgBin, { toolCheck: false });
    if (!local.canCreateDatabase) throw new Error('esse usuário não pode criar bancos.');
    if (source && local.version < source.version) {
      throw new Error(`é PostgreSQL ${local.version}, mais antigo que o banco copiado (${source.version}).`);
    }
    return `PostgreSQL ${local.version}`;
  });

  return ready;
}

module.exports = { check, redact };
