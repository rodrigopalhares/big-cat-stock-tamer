import { describe, expect, it } from 'vitest'
import { encryptedPdf, needsPassword, ownerLockedPdf, plainPdf } from '../../tests/pdf.js'
import { decryptPdf } from './pdf-password.js'

describe('decryptPdf', () => {
  it('abre o PDF protegido e devolve um arquivo que não pede mais senha', () => {
    const result = decryptPdf(encryptedPdf('1234'), '1234')

    expect(result.decrypted).toBe(true)
    expect(needsPassword(result.file)).toBe(false)
  })

  it('não altera o buffer que recebeu', () => {
    const original = encryptedPdf('1234')
    const copy = Buffer.from(original)

    decryptPdf(original, '1234')

    expect(original).toEqual(copy)
  })

  it('recusa a senha errada', () => {
    expect(() => decryptPdf(encryptedPdf('1234'), 'outra')).toThrowError(/senha da nota incorreta/i)
  })

  it('avisa quando a nota pede senha e nenhuma foi informada', () => {
    expect(() => decryptPdf(encryptedPdf('1234'), '')).toThrowError(/protegida por senha/i)
  })

  it('erro de senha é pedido malfeito, não falha do servidor', () => {
    expect(() => decryptPdf(encryptedPdf('1234'), 'outra')).toThrowError(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('devolve intacto o PDF sem criptografia, mesmo com senha informada', () => {
    const file = plainPdf()
    const result = decryptPdf(file, 'sobrando')

    expect(result.decrypted).toBe(false)
    expect(result.file).toBe(file)
  })

  it('deixa passar o PDF que só tem senha de dono — ele já abre sozinho', () => {
    const file = ownerLockedPdf()
    const result = decryptPdf(file, '')

    expect(result.decrypted).toBe(false)
    expect(result.file).toBe(file)
  })

  it('deixa o arquivo que nem é PDF seguir — quem reclama do tipo é a Anthropic', () => {
    // Traz `/Encrypt` de propósito: sem isso o atalho de bytes nem chega no mupdf.
    const file = Buffer.from('%PDF-1.4 /Encrypt mas o resto é lixo')
    const result = decryptPdf(file, '1234')

    expect(result.decrypted).toBe(false)
    expect(result.file).toBe(file)
  })
})
