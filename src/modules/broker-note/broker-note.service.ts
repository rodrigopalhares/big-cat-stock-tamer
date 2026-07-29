import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../../config/db.js'
import {
  type BrokerNoteData,
  checkTotal,
  checkWarning,
  matchSecurity,
  type NoteCheck,
  type NoteFee,
  type NoteGroup,
  type NoteTrade,
  summarizeNote,
  toCsv,
} from '../../domain/broker-note.js'
import type { BrokerNote } from '../../generated/prisma/client.js'
import type { AnthropicClient } from '../../integrations/anthropic/anthropic.client.js'
import { HttpError } from '../../shared/http-error.js'

/**
 * Importação de nota de negociação em PDF.
 *
 * O arquivo enviado fica em `${notesDir}/<ano>/<yyyyMMdd>_<id>.<ext>` e o retorno da
 * Anthropic é arquivado como CSV na própria linha da nota — é esse CSV que vira
 * transação, então guardá-lo é o que permite conferir depois o que foi importado.
 *
 * O nome do arquivo depende do id, que só existe depois do insert: por isso grava-se a
 * linha primeiro e o arquivo em seguida. Se a gravação falhar, a linha é desfeita — nota
 * sem arquivo seria um link de download quebrado para sempre.
 */

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export type BrokerNoteUpload = {
  readonly file: Buffer
  readonly fileName: string
  readonly contentType: string
}

/** O que a rota devolve para a prévia. */
export type BrokerNoteImport = {
  readonly id: number
  readonly note: BrokerNoteData
  readonly groups: readonly NoteGroup[]
  readonly fees: readonly NoteFee[]
  readonly check: NoteCheck
  readonly checkedTotal: number
  readonly checkNotes: string
  readonly csv: string
  readonly fileName: string
}

export type BrokerNoteFile = {
  readonly content: Buffer
  readonly fileName: string
  readonly contentType: string
}

export class BrokerNoteService {
  constructor(
    private readonly db: Db,
    private readonly anthropic: AnthropicClient,
    private readonly notesDir: string,
  ) {}

  get enabled(): boolean {
    return this.anthropic.enabled
  }

  async importNote(upload: BrokerNoteUpload): Promise<BrokerNoteImport> {
    // Rede antes de qualquer escrita: o SQLite tem escritor único e segurar o lock
    // durante uma chamada HTTP travaria a aplicação inteira.
    const extracted = await this.anthropic.extractBrokerNote(upload.file, upload.contentType)

    const note = { ...extracted.note, trades: await this.resolveTickers(extracted.note.trades) }
    const groups = summarizeNote(note)
    const check = checkTotal(groups, note)
    const csv = toCsv(note, groups)

    const saved = await this.db.brokerNote.create({
      data: {
        date: note.date,
        broker: note.broker || null,
        noteNumber: note.noteNumber || null,
        fileName: '',
        originalName: upload.fileName,
        totalAmount: note.totalAmount,
        totalFees: note.totalFees,
        aiResponse: extracted.rawResponse,
        warning: checkWarning(check),
      },
    })

    const fileName = await this.storeFile(saved, upload)

    return {
      id: saved.id,
      note,
      groups,
      fees: extracted.fees,
      check,
      checkedTotal: extracted.checkedTotal,
      checkNotes: extracted.checkNotes,
      csv,
      fileName,
    }
  }

  /**
   * Completa o ticker das operações que a nota não identificou, pelo nome do papel contra
   * os ativos já cadastrados: "METAL LEVE" acha "MAHLE Metal Leve S.A." e vira LEVE3.
   *
   * Nome ambíguo ou desconhecido fica sem ticker de propósito — a linha entra na revisão
   * em branco, que é ruído de menos do que importar a empresa errada em silêncio.
   */
  private async resolveTickers(trades: readonly NoteTrade[]): Promise<NoteTrade[]> {
    if (trades.every((t) => t.ticker !== '')) return [...trades]

    const assets = await this.db.asset.findMany({ select: { ticker: true, name: true } })
    const resolved = new Map<string, string | null>()

    return trades.map((trade) => {
      if (trade.ticker !== '') return trade

      const key = trade.security.toUpperCase()
      if (!resolved.has(key)) resolved.set(key, matchSecurity(trade.security, assets))

      const ticker = resolved.get(key) ?? null
      return ticker === null ? trade : { ...trade, ticker, tickerSource: 'NAME' as const }
    })
  }

  async findNote(id: number): Promise<BrokerNote> {
    const note = await this.db.brokerNote.findUnique({ where: { id } })
    if (note === null) throw HttpError.notFound('Nota não encontrada')
    return note
  }

  /** O PDF (ou imagem) original. */
  async readFile(id: number): Promise<BrokerNoteFile> {
    const note = await this.findNote(id)
    if (note.fileName === '') throw HttpError.notFound('Arquivo da nota não encontrado')

    const path = join(this.notesDir, yearOf(note.date), note.fileName)
    let content: Buffer
    try {
      content = readFileSync(path)
    } catch {
      throw HttpError.notFound('Arquivo da nota não encontrado')
    }

    return {
      content,
      fileName: note.fileName,
      contentType: CONTENT_TYPES[extensionOf(note.fileName)] ?? 'application/octet-stream',
    }
  }

  /** A resposta da Anthropic como o modelo devolveu, servida para download. */
  async readAiResponse(id: number): Promise<BrokerNoteFile> {
    const note = await this.findNote(id)
    return {
      content: Buffer.from(note.aiResponse, 'utf8'),
      fileName: `${baseName(note.fileName) || String(note.id)}.json`,
      contentType: 'application/json; charset=utf-8',
    }
  }

  private async storeFile(note: BrokerNote, upload: BrokerNoteUpload): Promise<string> {
    const extension = EXTENSIONS[upload.contentType] ?? 'bin'
    const fileName = `${note.date.replaceAll('-', '')}_${note.id}.${extension}`
    const folder = join(this.notesDir, yearOf(note.date))

    try {
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, fileName), upload.file)
    } catch (error) {
      await this.db.brokerNote.delete({ where: { id: note.id } })
      const message = error instanceof Error ? error.message : String(error)
      throw HttpError.badGateway(`Não foi possível salvar o arquivo da nota: ${message}`)
    }

    try {
      await this.db.brokerNote.update({ where: { id: note.id }, data: { fileName } })
    } catch (error) {
      rmSync(join(folder, fileName), { force: true })
      throw error
    }
    return fileName
  }
}

function yearOf(date: string): string {
  return date.slice(0, 4)
}

function extensionOf(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? fileName : fileName.slice(0, dot)
}
