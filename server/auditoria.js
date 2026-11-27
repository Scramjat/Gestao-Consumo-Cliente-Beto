/* =========================================================
   Conferência da gerência: o que foi cancelado e quais
   comandas encerradas foram reabertas

   Tudo sai da tabela de eventos, então continua aparecendo
   mesmo que a comanda tenha sido excluída depois.
   ========================================================= */

const iso = (d) => new Date(d).toISOString();
const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/*
  Eventos do período, com o nome do cliente quando a comanda ainda existe.
  $1 = estabelecimento, $2 = início, $3 = fim
*/
const SQL = `
  SELECT e.id, e.tipo, e.comanda_id, e.garcom_id, e.detalhes, e.criado_em, t.cliente, t.mesa, t.id AS existe
    FROM eventos e
    LEFT JOIN comandas t ON t.estabelecimento_id = e.estabelecimento_id AND t.id = e.comanda_id
   WHERE e.estabelecimento_id = $1 AND e.criado_em >= $2 AND e.criado_em < $3
     AND e.tipo IN ('cancelar', 'encerrar', 'reabrir', 'excluir')
   ORDER BY e.criado_em, e.id`;

/** `rows` vem de SQL, em ordem de horário. */
function summarize(rows) {
  // Nome das comandas excluídas, guardado no próprio evento de exclusão
  const removed = new Map(rows.filter((r) => r.tipo === 'excluir').map((r) => [r.comanda_id, json(r.detalhes)]));

  const base = (r) => ({
    id: r.id,
    quando: iso(r.criado_em),
    garcomId: r.garcom_id,
    comandaId: r.comanda_id,
    cliente: r.cliente ?? removed.get(r.comanda_id)?.cliente ?? '',
    mesa: r.mesa ?? removed.get(r.comanda_id)?.mesa ?? '',
    excluida: !r.existe
  });

  const cancelamentos = [];
  const reaberturas = [];
  const waiting = new Map();   // comanda -> reabertura que ainda não foi encerrada de novo

  for (const r of rows) {
    const details = json(r.detalhes);
    if (r.tipo === 'cancelar') {
      cancelamentos.push({ ...base(r), produto: details.produto, quantidade: details.quantidade });
    } else if (r.tipo === 'reabrir') {
      const reopened = {
        ...base(r),
        totalAntes: details.totalCentavos,
        formaAntes: details.forma,
        totalDepois: null,
        formaDepois: null,
        encerradaDeNovoEm: null,
        encerradaDeNovoPor: null
      };
      reaberturas.push(reopened);
      waiting.set(r.comanda_id, reopened);
    } else if (r.tipo === 'encerrar' && waiting.has(r.comanda_id)) {
      Object.assign(waiting.get(r.comanda_id), {
        totalDepois: details.totalCentavos,
        formaDepois: details.forma,
        encerradaDeNovoEm: iso(r.criado_em),
        encerradaDeNovoPor: r.garcom_id
      });
      waiting.delete(r.comanda_id);
    }
  }
  return { cancelamentos, reaberturas };
}

module.exports = { SQL, summarize };
