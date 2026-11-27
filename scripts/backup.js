#!/usr/bin/env node
/* =========================================================
   Cópia de segurança pela linha de comando

     node scripts/backup.js checar          confere a configuração (só lê)
     npm run backup                         cria (e confere) uma cópia
     npm run backup:conferir -- ARQUIVO     testa se um arquivo restaura
     npm run backup:restaurar -- ARQUIVO    restaura num banco VAZIO

   A configuração vem do ambiente ou do arquivo backup.env na
   pasta do projeto (que nunca vai para o Git):
     DATABASE_URL     banco que será copiado
     BACKUP_SENHA     senha que protege os arquivos (12+). Sem ela
                      NÃO há como abrir as cópias: guarde em outro lugar
     BACKUP_PASTA     onde salvar (padrão: pasta "backups")
     BACKUP_DIAS      por quantos dias guardar (padrão: 30)
     VERIFICAR_URL    Postgres de testes para conferir cada cópia
     DESTINO_URL      banco vazio que vai receber a restauração
     PG_BIN           pasta "bin" do PostgreSQL, se não estiver no PATH
     PGSSL=disable    desliga o SSL (localhost já não usa; o resto sempre usa)
     PGSSLROOTCERT    arquivo de certificados, se os do sistema não servirem
   ========================================================= */

const fs = require('fs');
const path = require('path');
const copy = require('./copia.js');
const { check, redact } = require('./checar.js');

const ROOT = path.resolve(__dirname, '..');

/** Lê linhas NOME=valor. O que já está no ambiente tem prioridade. */
function loadConfig(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

function need(name, why) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Defina ${name} (${why}).`);
  return value;
}

const describe = (counts) => Object.entries(counts).map(([table, total]) => `${table}: ${total}`).join(', ');

async function main(command, file) {
  loadConfig(path.join(ROOT, 'backup.env'));
  if (command === 'checar') {
    const ready = await check({
      env: process.env,
      folder: path.resolve(ROOT, process.env.BACKUP_PASTA || 'backups'),
      print: (line) => console.log(line)
    });
    console.log(ready ? 'Tudo pronto para a primeira cópia.' : 'Ajuste o que está marcado com FALTA e rode de novo.');
    if (!ready) process.exitCode = 1;
    return;
  }
  const password = need('BACKUP_SENHA', 'senha que protege os arquivos de cópia');
  const pgBin = (process.env.PG_BIN || '').trim();
  const folder = path.resolve(ROOT, process.env.BACKUP_PASTA || 'backups');
  fs.mkdirSync(folder, { recursive: true });

  // Tudo fica registrado: uma tarefa agendada não tem ninguém olhando a tela
  const log = (message) => {
    console.log(message);
    fs.appendFileSync(path.join(folder, 'backup.log'), `${new Date().toLocaleString('pt-BR')}  ${message}\n`);
  };

  try {
    if (command === 'criar') {
      const databaseUrl = need('DATABASE_URL', 'banco que será copiado');
      const days = Number(process.env.BACKUP_DIAS || 30);
      if (!Number.isInteger(days) || days < 1) throw new Error('BACKUP_DIAS precisa ser um número inteiro de dias.');

      const made = await copy.create({ databaseUrl, password, folder, pgBin });
      log(`Cópia criada: ${made.file} (${Math.ceil(made.bytes / 1024)} KB)`);

      let verified = false;
      if (process.env.VERIFICAR_URL) {
        // Se a conferência falhar, a cópia fica guardada, mas nada antigo é apagado
        log(`Conferida (restaurou num banco temporário). ${describe(await copy.verify({
          file: made.file, password, adminUrl: process.env.VERIFICAR_URL, pgBin
        }))}`);
        verified = true;
      } else {
        log('Atenção: cópia NÃO conferida (defina VERIFICAR_URL).');
      }

      try {
        await copy.register(databaseUrl, { bytes: made.bytes, verified });
      } catch (e) {
        log(`Atenção: não consegui anotar a cópia no banco (o painel não vai mostrá-la): ${e.message}`);
      }
      const removed = copy.prune({ folder, days });
      if (removed.length) log(`Cópias antigas apagadas: ${removed.length}`);
      return;
    }

    if (!file) throw new Error('Informe o arquivo da cópia.');
    if (command === 'conferir') {
      const adminUrl = need('VERIFICAR_URL', 'Postgres de testes onde criar um banco temporário');
      log(`A cópia ${path.resolve(file)} restaura. ${describe(await copy.verify({ file, password, adminUrl, pgBin }))}`);
      return;
    }
    if (command === 'restaurar') {
      // Variável própria, para nunca restaurar sem querer no banco que está em uso
      const databaseUrl = need('DESTINO_URL', 'banco VAZIO que vai receber os dados');
      log(`Restaurado. ${describe(await copy.restore({ file, password, databaseUrl, pgBin }))}`);
      return;
    }
    throw new Error('Use: checar, criar, conferir ARQUIVO ou restaurar ARQUIVO.');
  } catch (e) {
    log(`FALHOU: ${redact(e.message, process.env)}`);
    process.exitCode = 1;
  }
}

main(process.argv[2], process.argv[3]).catch((e) => {
  console.error(`FALHOU: ${e.message}`);
  process.exitCode = 1;
});
