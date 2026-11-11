/* =========================================================
   Planilha Excel (.xlsx) com tudo de cada cliente
   Gerada aqui mesmo, sem bibliotecas externas (funciona offline).
   Abas:
     - Clientes  -> um cliente por linha, com resumo do consumo
     - Pedidos   -> cada pedido com data e hora (com segundos)
     - Produtos  -> total pedido de cada produto
   ========================================================= */

(function (root) {
  /* ---------- Formatos de célula (índices de styles.xml) ---------- */
  const S = { text: 0, header: 1, dateTime: 2, date: 3, time: 4, bold: 5, number: 6, open: 7, closed: 8 };

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm:ss"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="166" formatCode="hh:mm:ss"/>
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
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="top"/></xf>
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

  function situation(client) {
    return client.closedAt ? txt('Encerrada', S.closed) : txt('Aberta', S.open);
  }

  function ordersOf(client, item) {
    return item.orders && item.orders.length
      ? item.orders
      : [{ qty: item.qty, at: item.addedAt || client.createdAt }];
  }

  function buildSheets(state) {
    const clients = state.clients.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Aba 1: Clientes
    const clientRows = clients.map((c) => {
      const total = c.items.reduce((s, i) => s + i.qty, 0);
      const firstOrder = c.items.flatMap((i) => ordersOf(c, i)).map((o) => o.at).sort()[0];
      return [
        txt(c.name, S.bold),
        tableCell(c),
        txt(formatCPF(c.cpf)),
        when(c.createdAt, S.dateTime),
        situation(c),
        when(c.closedAt, S.dateTime),
        num(total),
        when(firstOrder, S.dateTime),
        txt(c.items.map((i) => `${i.qty} ${i.product}`).join('\n'))
      ];
    });

    // Aba 2: Pedidos (cada pedido com data e hora)
    const orders = [];
    clients.forEach((c) => c.items.forEach((item) => ordersOf(c, item).forEach((o) => {
      orders.push({ at: o.at, client: c, product: item.product, qty: o.qty });
    })));
    orders.sort((a, b) => a.at.localeCompare(b.at));
    const orderRows = orders.map((o) => [
      when(o.at, S.date),
      when(o.at, S.time),
      txt(o.client.name, S.bold),
      tableCell(o.client),
      txt(o.product),
      num(o.qty),
      txt(formatCPF(o.client.cpf)),
      situation(o.client)
    ]);

    // Aba 3: Produtos
    const products = {};
    orders.forEach((o) => {
      const key = o.product.toLowerCase();
      products[key] ||= { name: o.product, qty: 0, clients: new Set() };
      products[key].qty += o.qty;
      products[key].clients.add(o.client.name);
    });
    const productRows = Object.values(products)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'))
      .map((p) => [txt(p.name, S.bold), num(p.qty), num(p.clients.size), txt([...p.clients].join(', '))]);

    return [
      {
        name: 'Clientes',
        headers: ['Cliente', 'Mesa', 'CPF', 'Cadastro', 'Situação', 'Encerrada em', 'Itens', 'Primeiro pedido', 'Consumo'],
        widths: [24, 8, 16, 21, 12, 21, 8, 21, 42],
        rows: clientRows
      },
      {
        name: 'Pedidos',
        headers: ['Data', 'Hora', 'Cliente', 'Mesa', 'Produto', 'Quantidade', 'CPF', 'Situação da conta'],
        widths: [12, 10, 24, 8, 30, 12, 16, 18],
        rows: orderRows
      },
      {
        name: 'Produtos',
        headers: ['Produto', 'Quantidade total', 'Nº de clientes', 'Clientes'],
        widths: [30, 17, 15, 50],
        rows: productRows
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
  function build(state) {
    return zip(workbookFiles(buildSheets(state)));
  }

  const Excel = {
    build,
    MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  root.Excel = Excel;
  if (typeof module !== 'undefined') module.exports = Excel;
})(typeof window !== 'undefined' ? window : globalThis);
