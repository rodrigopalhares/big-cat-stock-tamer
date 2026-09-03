import { describe, expect, it } from 'vitest'
import { escapeHtml } from './escape-html.js'

describe('escapeHtml', () => {
  it('neutraliza uma tag executável', () => {
    expect(escapeHtml('<svg onload=alert(1)>')).toBe('&lt;svg onload=alert(1)&gt;')
  })

  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('escapa %s', (raw, escaped) => {
    expect(escapeHtml(raw)).toBe(escaped)
  })

  it('escapa o & primeiro, para não gerar entidade dupla', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('deixa texto comum intacto', () => {
    expect(escapeHtml('Já existe uma classe chamada Ações.')).toBe(
      'Já existe uma classe chamada Ações.',
    )
  })

  it('escapa todas as ocorrências, não só a primeira', () => {
    expect(escapeHtml('<a><b>')).toBe('&lt;a&gt;&lt;b&gt;')
  })

  it('string vazia continua vazia', () => {
    expect(escapeHtml('')).toBe('')
  })
})
