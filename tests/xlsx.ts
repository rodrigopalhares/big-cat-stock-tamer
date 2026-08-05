import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Planilhas `.xlsx` de teste geradas na hora, pelo mesmo motivo de `tests/pdf.ts`: um
 * binário no versionamento seria opaco, e daqui a um ano ninguém saberia o que tem dentro.
 * Aqui as células estão escritas na chamada.
 *
 * O conteúdo é sempre fictício — ticker inventado e valor redondo. Extrato de verdade não
 * entra no repositório.
 */

const HEADER_MOVIMENTACAO = [
  'Entrada/Saída',
  'Data',
  'Movimentação',
  'Produto',
  'Instituição',
  'Quantidade',
  'Preço unitário',
  'Valor da Operação',
] as const

/** Extrato de Movimentação com o cabeçalho certo e as linhas que o teste pedir. */
export function movimentacaoXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  return buildXlsx([[...HEADER_MOVIMENTACAO], ...rows.map((row) => [...row])])
}

/**
 * `.xlsx` mínimo: um zip com `sharedStrings.xml` e uma planilha. Texto vira índice de
 * shared string e número vai como valor cru, que é exatamente o que a B3 emite.
 */
export function buildXlsx(rows: readonly (readonly string[])[], sheetName = 'sheet1'): Uint8Array {
  const shared: string[] = []
  const indexOf = (value: string): number => {
    const found = shared.indexOf(value)
    if (found !== -1) return found
    shared.push(value)
    return shared.length - 1
  }

  const sheetRows = rows
    .map((cells, rowIndex) => {
      const xml = cells
        .map((value, columnIndex) => {
          const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`
          if (value === '') return ''
          return isNumeric(value)
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${xml}</row>`
    })
    .join('')

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetRows}</sheetData></worksheet>`

  const sharedXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    `${shared.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}</sst>`

  return zip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: 'xl/sharedStrings.xml', content: sharedXml },
    { name: `xl/worksheets/${sheetName}.xml`, content: sheetXml },
  ])
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/></Types>'

// --- zip ---

type ZipFile = { readonly name: string; readonly content: string }

/**
 * Zip mínimo, com um arquivo comprimido e o resto guardado sem compressão — os dois métodos
 * que o leitor aceita ficam exercitados sem precisar de dois fixtures.
 */
function zip(files: readonly ZipFile[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const [index, file] of files.entries()) {
    const name = encoder.encode(file.name)
    const raw = encoder.encode(file.content)
    const deflate = index === 0
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const method = deflate ? 8 : 0
    const checksum = crc32(Buffer.from(raw))

    const local = new Uint8Array(30 + name.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, raw.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, raw.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, files.length, true)
  eocdView.setUint16(10, files.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)

  return concat([...locals, ...centrals, eocd])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function columnLetter(index: number): string {
  let letters = ''
  let remaining = index
  do {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return letters
}

function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
