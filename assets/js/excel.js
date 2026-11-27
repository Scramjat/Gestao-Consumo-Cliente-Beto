/* =========================================================
   Planilha Excel (.xlsx) de um período
   Gerada aqui mesmo, sem bibliotecas externas.
   Abas:
     - Garçons   -> mesas, faturamento e itens de cada um
     - Contas    -> uma conta por linha, com quem atendeu
     - Pedidos   -> cada pedido com data, hora e quem lançou
     - Produtos  -> total pedido de cada produto
     - Reaberturas   -> comandas encerradas que foram reabertas
     - Cancelamentos -> o que foi cancelado, por quem e quando
   Contas: as que tiveram pedido ou foram encerradas no período.
   Pedidos e Produtos: só os pedidos feitos no período.
   ========================================================= */

(function (root) {
  /* ---------- Formatos de célula (índices de styles.xml) ---------- */
  const S = { text: 0, header: 1, dateTime: 2, date: 3, time: 4, bold: 5, number: 6, open: 7, closed: 8, money: 9 };

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm:ss"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="166" formatCode="hh:mm:ss"/>
<numFmt numFmtId="167" formatCode="&quot;R$&quot;\ #,##0.00"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF2F9E44"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8590C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF0E5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE6E1D8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* ---------- Utilitários ---------- */
  const enc = new TextEncoder();

  function esc(text) {
    return String(text)
      // remove caracteres de controle que o Excel não aceita
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  /** Data no formato do Excel (dias desde 1900), no horário local. */
  function excelDate(iso) {
    const d = new Date(iso);
    return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  }

  function formatCPF(cpf) {
    return cpf && cpf.length === 11
      ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`
      : '';
  }

  /* ---------- Planilhas ---------- */
  // Célula: { v: valor, s: estilo, t: 'n' (número) | 's' (texto) }
  const txt = (v, s = S.text) => ({ v: v ?? '', s, t: 's' });
  const num = (v, s = S.number) => ({ v, s, t: 'n' });
  const when = (iso, s) => (iso ? num(excelDate(iso), s) : txt(''));

  function cellXml(cell, ref) {
    if (cell.t === 'n') return `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`;
    if (cell.v === '') return `<c r="${ref}" s="${cell.s}"/>`;
    return `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
  }

  function sheetXml({ headers, widths, rows }) {
    const all = [headers.map((h) => txt(h, S.header)), ...rows];
    const lastCol = colName(headers.length - 1);
    const body = all.map((row, r) => {
      const height = r === 0 ? ' ht="22" customHeight="1"' : '';
      const cells = row.map((cell, c) => cellXml(cell, `${colName(c)}${r + 1}`)).join('');
      return `<row r="${r + 1}"${height}>${cells}</row>`;
    }).join('');
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
<autoFilter ref="A1:${lastCol}${all.length}"/>
</worksheet>`;
  }

  /** Mesa só com números vira número (ordena certo no Excel); "Balcão" etc. fica como texto. */
  function tableCell(client) {
    const t = client.table || '';
    return /^\d+$/.test(t) ? num(Number(t)) : txt(t);
  }

  /** Valor em reais (célula numérica com formato de moeda); vazio quando não tem preço. */
  const money = (cents) => (cents == null ? txt('') : num(cents / 100, S.money));

  function situation(client) {
    return client.closedAt ? txt('Encerrada', S.closed) : txt('Aberta', S.open);
  }

  const billing = () => root.Billing || require('./billing.js');
  const waiterStats = () => root.WaiterStats || require('./waiter-stats.js');

  /** state: { clients, products, employees }; start: início do período (ms). */
  function buildSheets(state, start = 0) {
    const Billing = billing();
    const inPeriod = (iso) => !!iso && new Date(iso).getTime() >= start;
    const names = new Map(state.employees.map((e) => [e.id, e.name]));
    const who = (id) => (id ? names.get(id) || '—' : '');
    const ordersOf = (c) => c.items.flatMap((item) => item.orders.map((o) => ({ ...o, product: item.product, client: c })));

    const clients = state.clients
      .filter((c) => inPeriod(c.closedAt) || ordersOf(c).some((o) => inPeriod(o.at)) || (!c.closedAt && inPeriod(c.createdAt)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Conta de cada cliente (encerrada: valores guardados no pagamento; aberta: preços atuais)
    const bills = new Map(clients.map((c) => [c, Billing.bill(c, state.products || [])]));
    const unitOf = (client, product) => {
      const key = Billing.norm(product);
      return bills.get(client).lines.find((l) => Billing.norm(l.product) === key)?.unitCents ?? null;
    };

    // Aba: Garçons
    const waiterRows = waiterStats().compute(state, start).map((w) => [
      txt(w.name, S.bold),
      num(w.paidTabs),
      money(w.revenueCents),
      money(w.avgTicketCents),
      num(w.openTabs),
      num(w.items),
      num(w.tabsServed),
      money(w.launchedCents),
      num(w.unpricedItems)
    ]);

    // Aba: Contas
    const clientRows = clients.map((c) => {
      const all = ordersOf(c).sort((a, b) => a.at.localeCompare(b.at));
      const total = c.items.reduce((sum, i) => sum + i.qty, 0);
      return [
        txt(c.name, S.bold),
        tableCell(c),
        txt(who(c.waiterId)),
        txt([...new Set(all.map((o) => who(o.waiterId)))].join(', ')),
        txt(formatCPF(c.cpf)),
        when(c.createdAt, S.dateTime),
        situation(c),
        when(c.closedAt, S.dateTime),
        txt(who(c.closedBy)),
        num(total),
        money(c.items.length ? bills.get(c).totalCents : null),
        txt(Billing.methodLabel(bills.get(c).method)),
        when(all[0]?.at, S.dateTime),
        txt(c.items.map((i) => `${i.qty} ${i.product}`).join('\n'))
      ];
    });

    // Aba: Pedidos (cada pedido com data e hora)
    const orders = clients.flatMap(ordersOf).filter((o) => inPeriod(o.at)).sort((a, b) => a.at.localeCompare(b.at));
    const orderRows = orders.map((o) => {
      const unit = unitOf(o.client, o.product);
      return [
        when(o.at, S.date),
        when(o.at, S.time),
        txt(o.client.name, S.bold),
        tableCell(o.client),
        txt(who(o.waiterId)),
        txt(who(o.client.waiterId)),
        txt(o.product),
        num(o.qty),
        money(unit),
        money(unit == null ? null : unit * o.qty),
        txt(formatCPF(o.client.cpf)),
        situation(o.client)
      ];
    });

    // Aba: Produtos
    const products = new Map();
    orders.forEach((o) => {
      const key = Billing.norm(o.product);
      const unit = unitOf(o.client, o.product);
      if (!products.has(key)) products.set(key, { name: o.product, qty: 0, cents: 0, priced: false, clients: new Map() });
      const product = products.get(key);
      product.qty += o.qty;
      if (unit != null) { product.cents += unit * o.qty; product.priced = true; }
      product.clients.set(o.client.id, o.client.name);
    });
    const productRows = [...products.values()]
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'))
      .map((p) => {
        const listed = Billing.findProduct(state.products || [], p.name);
        return [
          txt(p.name, S.bold),
          num(p.qty),
          money(listed ? Billing.toCents(listed.price) : null),
          money(p.priced ? p.cents : null),
          num(p.clients.size),
          txt([...p.clients.values()].join(', '))
        ];
      });

    // Abas de conferência: quem reabriu e quem cancelou
    const audit = (e) => [txt(e.name, S.bold), tableCell(e), txt(e.removed ? 'Sim' : 'Não')];
    const method = (id) => txt(id ? Billing.methodLabel(id) : '');
    const reopenRows = waiterStats().since(state.reopens, start).map((e) => {
      const result = waiterStats().reopenResult(e);
      return [
        when(e.at, S.dateTime),
        txt(who(e.waiterId)),
        ...audit(e),
        money(e.beforeCents),
        method(e.beforeMethod),
        money(e.afterCents),
        method(e.afterMethod),
        when(e.closedAgainAt, S.dateTime),
        txt(who(e.closedAgainBy)),
        money(e.afterCents == null ? null : e.afterCents - e.beforeCents),
        txt(result.text),
        txt(result.lowered ? 'Sim' : 'Não')
      ];
    });
    const cancelRows = waiterStats().since(state.cancels, start).map((e) => [
      when(e.at, S.dateTime),
      txt(who(e.waiterId)),
      ...audit(e),
      txt(e.product),
      num(e.qty)
    ]);

    return [
      {
        name: 'Garçons',
        headers: ['Garçom', 'Mesas pagas (responsável)', 'Faturamento (responsável)', 'Ticket médio', 'Contas abertas agora', 'Itens lançados', 'Contas em que lançou', 'Valor lançado', 'Itens lançados sem preço'],
        widths: [24, 26, 26, 15, 21, 15, 21, 16, 24],
        rows: waiterRows
      },
      {
        name: 'Contas',
        headers: ['Cliente', 'Mesa', 'Garçom responsável', 'Lançaram pedidos', 'CPF', 'Abertura', 'Situação', 'Encerrada em', 'Encerrada por', 'Itens', 'Valor da conta', 'Pagamento', 'Primeiro pedido', 'Consumo'],
        widths: [24, 8, 22, 28, 16, 21, 12, 21, 18, 8, 16, 13, 21, 42],
        rows: clientRows
      },
      {
        name: 'Pedidos',
        headers: ['Data', 'Hora', 'Cliente', 'Mesa', 'Lançado por', 'Garçom responsável', 'Produto', 'Quantidade', 'Valor unitário', 'Valor total', 'CPF', 'Situação da conta'],
        widths: [12, 10, 24, 8, 18, 20, 30, 12, 15, 14, 16, 18],
        rows: orderRows
      },
      {
        name: 'Produtos',
        headers: ['Produto', 'Quantidade total', 'Valor unitário atual', 'Valor total', 'Nº de contas', 'Clientes'],
        widths: [30, 17, 20, 15, 15, 50],
        rows: productRows
      },
      {
        name: 'Reaberturas',
        headers: ['Reaberta em', 'Reaberta por', 'Cliente', 'Mesa', 'Comanda excluída', 'Pago antes', 'Forma antes', 'Valor depois', 'Forma depois', 'Encerrada de novo em', 'Encerrada de novo por', 'Diferença', 'Resultado', 'Conferir'],
        widths: [21, 18, 24, 8, 17, 14, 13, 14, 13, 21, 22, 12, 24, 10],
        rows: reopenRows
      },
      {
        name: 'Cancelamentos',
        headers: ['Cancelado em', 'Cancelado por', 'Cliente', 'Mesa', 'Comanda excluída', 'Produto', 'Quantidade'],
        widths: [21, 18, 24, 8, 17, 30, 12],
        rows: cancelRows
      }
    ];
  }

  /* ---------- Pacote .xlsx (é um .zip com arquivos XML) ---------- */
  function workbookFiles(sheets) {
    const sheetEntries = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const filters = sheets.map((s, i) =>
      `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.name}'!$A$1:$${colName(s.headers.length - 1)}$${s.rows.length + 1}</definedName>`).join('');
    const rels = sheets.map((s, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
    const overrides = sheets.map((s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');

    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheetEntries}</sheets>
<definedNames>${filters}</definedNames>
</workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      'xl/styles.xml': STYLES
    };
    sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
    return files;
  }

  /* ---------- ZIP sem compressão ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const parts = [];
    const central = [];
    let offset = 0;

    Object.entries(files).forEach(([name, content]) => {
      const nameBytes = enc.encode(name);
      const data = enc.encode(content);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);   // nomes em UTF-8
      local.setUint16(8, 0, true);        // sem compressão
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    all.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  /** Bytes do arquivo .xlsx */
  function build(state, start = 0) {
    return zip(workbookFiles(buildSheets(state, start)));
  }

  const Excel = {
    build,
    buildSheets,
    MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  root.Excel = Excel;
  if (typeof module !== 'undefined') module.exports = Excel;
})(typeof window !== 'undefined' ? window : globalThis);
