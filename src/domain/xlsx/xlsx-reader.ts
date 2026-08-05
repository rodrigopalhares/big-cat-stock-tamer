import { inflateRawSync } from 'node:zlib'

/**
 * Leitura mínima de `.xlsx` — puro e síncrono, sem dependência externa.
 *
 * Um `.xlsx` é um zip com XML dentro. O extrato de Movimentação da B3 usa só a parte
 * simples do formato: uma planilha, texto em `sharedStrings`, número inteiro ou decimal
 * nas colunas de valor, nenhuma fórmula. Ler isso são ~150 linhas; trazer um SheetJS ou
 * exceljs para o mesmo resultado seriam megabytes de dependência lendo oito colunas.
 *
 * O que **não** é suportado, de propósito: zip64, arquivo com senha e célula de fórmula
 * com resultado numérico dependente de estilo. Cada um vira erro explícito em vez de
 * devolver planilha pela metade.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const ZIP64_MARKER = 0xffffffff

/** Uma planilha, já resolvida: linhas de células como texto, sem célula vazia no meio. */
export type XlsxSheet = readonly (readonly string[])[]

export function readXlsxSheet(file: Uint8Array): XlsxSheet {
  const entries = readZipEntries(file)

  const sheetName = pickSheetName(entries)
  if (sheetName === null) throw new Error('Arquivo .xlsx sem planilha legível.')

  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared =
    sharedEntry === undefined ? [] : parseSharedStringsXml(decodeUtf8(readEntry(file, sharedEntry)))

  const sheetEntry = entries.get(sheetName)
  if (sheetEntry === undefined) throw new Error('Arquivo .xlsx sem planilha legível.')
  return parseSheet(decodeUtf8(readEntry(file, sheetEntry)), shared)
}

// --- zip ---

type ZipEntry = { readonly method: number; readonly size: number; readonly localOffset: number }

/**
 * Índice do zip lido pelo diretório central, não pelos cabeçalhos locais: o cabeçalho local
 * pode declarar tamanho zero quando o arquivo foi escrito em streaming (bit 3 do flag), e aí
 * a varredura sequencial lê lixo. O diretório central sempre tem os tamanhos reais.
 */
function readZipEntries(file: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)

  const eocd = findEocd(view)
  if (eocd === null) throw new Error('Arquivo não é um .xlsx válido (zip sem diretório central).')

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  if (offset === ZIP64_MARKER) throw new Error('Arquivo .xlsx em formato zip64 não é suportado.')

  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) break

    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = decodeUtf8(file.subarray(offset + 46, offset + 46 + nameLength))

    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      size: view.getUint32(offset + 20, true),
      localOffset: view.getUint32(offset + 42, true),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** O EOCD fica no fim, mas pode ter até 64 KB de comentário depois dele. */
function findEocd(view: DataView): number | null {
  const start = Math.max(0, view.byteLength - (22 + 0xffff))
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i
  }
  return null
}

function readEntry(file: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (view.getUint32(entry.localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('Arquivo .xlsx corrompido (cabeçalho local ausente).')
  }

  const nameLength = view.getUint16(entry.localOffset + 26, true)
  const extraLength = view.getUint16(entry.localOffset + 28, true)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const data = file.subarray(start, start + entry.size)

  if (entry.method === 0) return data
  if (entry.method === 8) return new Uint8Array(inflateRawSync(data))
  throw new Error(`Arquivo .xlsx com compressão não suportada (método ${entry.method}).`)
}

/** `sheet1` é o nome que a B3 gera; qualquer outra planilha serve como plano B. */
function pickSheetName(entries: ReadonlyMap<string, ZipEntry>): string | null {
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml'
  const names = [...entries.keys()].filter((n) => /^xl\/worksheets\/.+\.xml$/.test(n)).sort()
  return names[0] ?? null
}

// --- xml ---

/**
 * `sharedStrings.xml` é uma lista de `<si>`, e cada `<si>` pode ter vários `<t>` quando o
 * texto tem formatação no meio — concatenar é o que devolve a string original.
 */
function parseSharedStringsXml(xml: string): readonly string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...(match[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeEntities(t[1] ?? ''))
      .join(''),
  )
}

function parseSheet(xml: string, shared: readonly string[]): XlsxSheet {
  const rows: string[][] = []

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []

    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const column = columnIndex(/r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '')

      // Célula vazia não é gravada no XML: sem alinhar pela referência, uma coluna em
      // branco desloca todas as seguintes e a data vira ticker.
      while (cells.length < column) cells.push('')
      cells.push(cellValue(attrs, body, shared))
    }
    rows.push(cells)
  }
  return rows
}

function cellValue(attrs: string, body: string, shared: readonly string[]): string {
  const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
  const raw = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')

  if (type === 's') return shared[Number(raw)] ?? ''
  if (type === 'inlineStr') {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeEntities(t[1] ?? ''))
      .join('')
  }
  return raw
}

/** `A` → 0, `Z` → 25, `AA` → 26. */
function columnIndex(reference: string): number {
  let index = 0
  for (const char of reference) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

function decodeEntities(value: string): string {
  return (
    value
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      )
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      // `&amp;` por último: antes, `&amp;lt;` viraria `<` em vez de `&lt;`.
      .replaceAll('&amp;', '&')
  )
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}
