import { describe, expect, it } from 'vitest'
import { type JsonToken, prettyJson, tokenizeJson } from './json-view.js'

/** Só os tokens coloridos, na ordem — o `plain` é pontuação e espaço. */
const colored = (text: string): Array<[string, string]> =>
  tokenizeJson(text)
    .filter((t: JsonToken) => t.type !== 'plain')
    .map((t) => [t.type, t.text])

describe('prettyJson', () => {
  it('identa com duas casas', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('devolve o texto original quando não é JSON', () => {
    expect(prettyJson('desculpe, não consegui ler')).toBe('desculpe, não consegui ler')
  })

  it('não perde a resposta quando o JSON vem truncado', () => {
    expect(prettyJson('{"tradeDate": "2026-07-15", "trades": [')).toBe(
      '{"tradeDate": "2026-07-15", "trades": [',
    )
  })
})

describe('tokenizeJson', () => {
  it('separa chave, string, número e literal', () => {
    expect(colored('{\n  "ticker": "XPLG11",\n  "price": 91.6,\n  "ok": true\n}')).toEqual([
      ['key', '"ticker"'],
      ['string', '"XPLG11"'],
      ['key', '"price"'],
      ['number', '91.6'],
      ['key', '"ok"'],
      ['literal', 'true'],
    ])
  })

  it('não confunde número dentro de string com número', () => {
    expect(colored('{"security": "CSU DIGITAL 3 ON"}')).toEqual([
      ['key', '"security"'],
      ['string', '"CSU DIGITAL 3 ON"'],
    ])
  })

  it('não confunde literal dentro de string com literal', () => {
    expect(colored('{"nota": "valor null e true"}')).toEqual([
      ['key', '"nota"'],
      ['string', '"valor null e true"'],
    ])
  })

  it('entende negativo e notação científica', () => {
    expect(colored('[-2.14, 1e-7]')).toEqual([
      ['number', '-2.14'],
      ['number', '1e-7'],
    ])
  })

  it('não se perde com aspas escapadas dentro da string', () => {
    expect(colored('{"a": "diz \\"oi\\"", "b": 1}')).toEqual([
      ['key', '"a"'],
      ['string', '"diz \\"oi\\""'],
      ['key', '"b"'],
      ['number', '1'],
    ])
  })

  it('preserva o texto inteiro na concatenação dos tokens', () => {
    const text = prettyJson('{"a":[1,null,"x"],"b":{"c":false}}')

    expect(
      tokenizeJson(text)
        .map((t) => t.text)
        .join(''),
    ).toBe(text)
  })

  it('trata texto que não é JSON como texto puro', () => {
    expect(tokenizeJson('erro de leitura')).toEqual([{ text: 'erro de leitura', type: 'plain' }])
  })
})
