import { describe, expect, it } from 'vitest'
import { internalPath } from './safe-redirect.js'

const FALLBACK = '/transactions/'

describe('internalPath', () => {
  it.each([
    '/assets/',
    '/assets/PETR4',
    '/transactions/?ticker=PETR4',
    '/assets/?prices=none&ticker=TD%3AIPCA2026',
    '/dividends/#topo',
  ])('aceita o caminho interno %s', (path) => {
    expect(internalPath(path, FALLBACK)).toBe(path)
  })

  it.each([
    ['URL absoluta', 'https://evil.example.com/phish'],
    ['URL absoluta sem TLS', 'http://evil.example.com'],
    ['protocol-relative', '//evil.example.com/'],
    ['protocol-relative com contrabarra', '/\\evil.example.com'],
    ['contrabarra dupla', '\\\\evil.example.com'],
    ['esquema com uma barra só', 'http:/evil.example.com'],
    ['javascript:', 'javascript:alert(1)'],
    ['caminho relativo sem barra', 'assets/PETR4'],
    ['quebra de linha', '/assets/\nLocation: https://evil.example.com'],
    ['retorno de carro', '/assets/\r\nSet-Cookie: x=1'],
    ['caractere de controle', '/assets/\u0001x'],
    ['NUL', '/assets/\u0000'],
  ])('recusa %s e cai no padrão', (_label, path) => {
    expect(internalPath(path, FALLBACK)).toBe(FALLBACK)
  })

  it.each([undefined, null, '', '   '])('trata %s como ausente', (value) => {
    expect(internalPath(value, FALLBACK)).toBe(FALLBACK)
  })

  it('apara espaço em volta de um destino válido', () => {
    expect(internalPath('  /assets/PETR4  ', FALLBACK)).toBe('/assets/PETR4')
  })
})
