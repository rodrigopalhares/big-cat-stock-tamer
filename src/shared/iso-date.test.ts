import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  firstDayOf,
  fromBrazilianDate,
  fromParts,
  isIsoDate,
  isoDate,
  lastDayOf,
  maxDate,
  minDate,
  monthsBetweenInclusive,
  toBrazilianDate,
  today,
  toYearMonth,
  yearMonth,
} from './iso-date.js'

describe('validação', () => {
  it('aceita data ISO válida', () => {
    expect(isIsoDate('2024-01-15')).toBe(true)
  })

  it.each(['2024-1-5', '15/01/2024', '2024-01-15T00:00:00', '', 'abc'])(
    'rejeita formato inválido: %s',
    (value) => {
      expect(isIsoDate(value)).toBe(false)
    },
  )

  it.each(['2024-02-30', '2023-02-29', '2024-13-01', '2024-00-10', '2024-04-31'])(
    'rejeita data que não existe no calendário: %s',
    (value) => {
      expect(isIsoDate(value)).toBe(false)
      expect(() => isoDate(value)).toThrow(RangeError)
    },
  )

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
  })
})

describe('construção', () => {
  it('monta a partir das partes com zero à esquerda', () => {
    expect(fromParts(2024, 1, 5)).toBe('2024-01-05')
  })

  it('today devolve formato ISO no fuso pedido', () => {
    expect(isIsoDate(today('America/Sao_Paulo'))).toBe(true)
  })

  it('today respeita o fuso: Kiritimati nunca está atrás de Niue', () => {
    // Fusos nos extremos (+14 e -11). A data de um nunca é menor que a do outro.
    expect(today('Pacific/Kiritimati') >= today('Pacific/Niue')).toBe(true)
  })
})

describe('aritmética', () => {
  it('soma dias', () => {
    expect(addDays(isoDate('2024-01-15'), 10)).toBe('2024-01-25')
  })

  it('soma dias atravessando o mês', () => {
    expect(addDays(isoDate('2024-01-25'), 10)).toBe('2024-02-04')
  })

  it('soma dias atravessando o ano', () => {
    expect(addDays(isoDate('2024-12-28'), 5)).toBe('2025-01-02')
  })

  it('subtrai dias', () => {
    expect(addDays(isoDate('2024-03-01'), -1)).toBe('2024-02-29')
  })

  it('atravessa o horário de verão sem perder o dia', () => {
    // No Brasil o DST mudava a meia-noite; com aritmética em UTC isso é irrelevante.
    expect(addDays(isoDate('2018-11-03'), 1)).toBe('2018-11-04')
    expect(addDays(isoDate('2019-02-16'), 1)).toBe('2019-02-17')
  })

  it('soma meses clampando o dia', () => {
    expect(addMonths(isoDate('2024-01-31'), 1)).toBe('2024-02-29')
    expect(addMonths(isoDate('2023-01-31'), 1)).toBe('2023-02-28')
  })

  it('soma meses atravessando o ano', () => {
    expect(addMonths(isoDate('2024-11-15'), 3)).toBe('2025-02-15')
    expect(addMonths(isoDate('2024-02-15'), -3)).toBe('2023-11-15')
  })

  it('conta dias entre datas', () => {
    expect(daysBetween(isoDate('2024-01-01'), isoDate('2024-01-31'))).toBe(30)
  })

  it('conta dias negativos quando invertido', () => {
    expect(daysBetween(isoDate('2024-01-31'), isoDate('2024-01-01'))).toBe(-30)
  })

  it('conta o ano bissexto corretamente', () => {
    expect(daysBetween(isoDate('2024-01-01'), isoDate('2025-01-01'))).toBe(366)
    expect(daysBetween(isoDate('2023-01-01'), isoDate('2024-01-01'))).toBe(365)
  })
})

describe('ordenação', () => {
  it('ordena cronologicamente com sort padrão de string', () => {
    const dates = ['2024-12-31', '2023-11-20', '2024-02-29', '2024-01-05'].map(isoDate)
    expect([...dates].sort()).toEqual(['2023-11-20', '2024-01-05', '2024-02-29', '2024-12-31'])
  })

  it('compareDates devolve sinal correto', () => {
    expect(compareDates(isoDate('2024-01-01'), isoDate('2024-06-01'))).toBeLessThan(0)
    expect(compareDates(isoDate('2024-06-01'), isoDate('2024-01-01'))).toBeGreaterThan(0)
    expect(compareDates(isoDate('2024-01-01'), isoDate('2024-01-01'))).toBe(0)
  })

  it('min e max', () => {
    const dates = ['2024-06-01', '2023-01-15', '2025-12-31'].map(isoDate)
    expect(minDate(dates)).toBe('2023-01-15')
    expect(maxDate(dates)).toBe('2025-12-31')
    expect(minDate([])).toBeNull()
    expect(maxDate([])).toBeNull()
  })
})

describe('YearMonth', () => {
  it('extrai o mês de uma data', () => {
    expect(yearMonth(isoDate('2024-03-15'))).toBe('2024-03')
  })

  it('primeiro e último dia do mês', () => {
    expect(firstDayOf(toYearMonth('2024-02'))).toBe('2024-02-01')
    expect(lastDayOf(toYearMonth('2024-02'))).toBe('2024-02-29')
    expect(lastDayOf(toYearMonth('2023-02'))).toBe('2023-02-28')
    expect(lastDayOf(toYearMonth('2024-04'))).toBe('2024-04-30')
  })

  it('rejeita mês inválido', () => {
    expect(() => toYearMonth('2024-13')).toThrow(RangeError)
    expect(() => toYearMonth('2024-00')).toThrow(RangeError)
  })

  it('lista meses inclusive nas duas pontas', () => {
    expect(monthsBetweenInclusive(toYearMonth('2024-11'), toYearMonth('2025-02'))).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
    ])
  })

  it('lista um único mês quando as pontas são iguais', () => {
    expect(monthsBetweenInclusive(toYearMonth('2024-06'), toYearMonth('2024-06'))).toEqual([
      '2024-06',
    ])
  })
})

describe('formato brasileiro', () => {
  it('converte dd/MM/yyyy para ISO', () => {
    expect(fromBrazilianDate('15/01/2024')).toBe('2024-01-15')
  })

  it('ignora espaços em volta', () => {
    expect(fromBrazilianDate('  15/01/2024  ')).toBe('2024-01-15')
  })

  it.each(['2024-01-15', '15-01-2024', '1/1/2024', '', 'abc'])(
    'devolve null para formato inválido: %s',
    (value) => {
      expect(fromBrazilianDate(value)).toBeNull()
    },
  )

  it('devolve null para data que não existe', () => {
    expect(fromBrazilianDate('30/02/2024')).toBeNull()
  })

  it('converte ISO de volta para dd/MM/yyyy', () => {
    expect(toBrazilianDate(isoDate('2024-01-05'))).toBe('05/01/2024')
  })
})
