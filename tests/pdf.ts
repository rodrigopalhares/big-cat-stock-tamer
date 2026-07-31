import * as mupdf from 'mupdf'

/**
 * PDFs de teste gerados na hora.
 *
 * Um `.pdf` criptografado no versionamento seria um binário opaco e daqui a um ano ninguém
 * saberia a senha dele. Aqui a senha está escrita na chamada.
 */

function onePage(): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument()
  const content = 'BT /F1 12 Tf 10 100 Td (nota de negociacao) Tj ET'
  doc.insertPage(-1, doc.addPage([0, 0, 200, 200], 0, doc.newDictionary(), content))
  return doc
}

function save(doc: mupdf.PDFDocument, options: string): Buffer {
  try {
    return Buffer.from(doc.saveToBuffer(options).asUint8Array())
  } finally {
    doc.destroy()
  }
}

/** PDF válido, sem criptografia nenhuma. */
export function plainPdf(): Buffer {
  return save(onePage(), '')
}

/** PDF que só abre com `password` — a senha de abertura, que é a das notas de corretagem. */
export function encryptedPdf(password: string): Buffer {
  return save(onePage(), `encrypt=aes-256,user-password=${password},owner-password=${password}`)
}

/** PDF com senha só de dono: restringe impressão e cópia, mas abre sem pedir nada. */
export function ownerLockedPdf(): Buffer {
  return save(onePage(), 'encrypt=aes-256,owner-password=dono,permissions=-4')
}

/** Se o arquivo ainda pede senha para abrir. */
export function needsPassword(file: Buffer): boolean {
  const doc = new mupdf.PDFDocument(file)
  try {
    return doc.needsPassword()
  } finally {
    doc.destroy()
  }
}
