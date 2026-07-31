import * as mupdf from 'mupdf'
import { HttpError } from './http-error.js'

/**
 * Remoção de senha de PDF.
 *
 * A Messages API só aceita PDF sem criptografia — "Standard PDF (no passwords/encryption)"
 * na tabela de requisitos —, então nota protegida tem que ser aberta aqui antes de subir
 * para a Anthropic. Mandar o arquivo criptografado não dá erro claro: volta uma reclamação
 * genérica sobre o documento.
 *
 * A senha só atravessa esta função. Não vai para o banco, para o disco nem para o log.
 */

export type PdfDecryption = {
  /** O arquivo pronto para ler — o próprio original quando não havia o que abrir. */
  readonly file: Buffer
  /** Verdadeiro só quando a senha foi de fato usada; é o que decide guardar o original. */
  readonly decrypted: boolean
}

/**
 * Devolve o PDF sem senha. Arquivo que não é PDF, ou que não está criptografado, volta
 * intacto — quem valida o tipo é o cliente da Anthropic, não este módulo.
 */
export function decryptPdf(file: Buffer, password: string): PdfDecryption {
  // O dicionário de criptografia é referenciado pelo trailer, que nunca vem comprimido:
  // sem `/Encrypt` nos bytes não há o que abrir. Evita carregar todo PDF — e todo arquivo
  // que nem é PDF — no WASM do mupdf só para descobrir isso.
  if (!file.includes('/Encrypt')) return { file, decrypted: false }

  let doc: mupdf.PDFDocument
  try {
    doc = new mupdf.PDFDocument(file)
  } catch {
    // Não abriu como PDF: segue como está e a Anthropic reclama do arquivo.
    return { file, decrypted: false }
  }

  try {
    // Nota que só tem senha de dono (restringe impressão, não a abertura) cai aqui: abre
    // sozinha, e reescrevê-la só perderia o original sem ganhar nada.
    if (!doc.needsPassword()) return { file, decrypted: false }

    if (password === '') {
      throw HttpError.badRequest(
        'Esta nota está protegida por senha. Informe a senha para importar.',
      )
    }
    if (doc.authenticatePassword(password) === 0) {
      throw HttpError.badRequest('Senha da nota incorreta.')
    }

    return { file: Buffer.from(doc.saveToBuffer('encrypt=none').asUint8Array()), decrypted: true }
  } finally {
    doc.destroy()
  }
}
