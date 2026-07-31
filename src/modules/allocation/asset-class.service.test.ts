import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, createTestDb, type TestDb } from '../../../tests/db.js'
import { createAsset, createAssetClass, seedDefaultAssetClasses } from '../../../tests/factories.js'
import { AssetClassForm } from './allocation.schema.js'
import { AssetClassService } from './asset-class.service.js'

describe('AssetClassService', () => {
  let db: TestDb
  let service: AssetClassService

  beforeAll(async () => {
    db = await createTestDb()
    service = new AssetClassService(db)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  beforeEach(async () => {
    await clearAllData(db)
  })

  function form(name: string, targetPercent = 20, color = '#36a2eb'): AssetClassForm {
    return AssetClassForm.parse({ name, target_percent: String(targetPercent), color })
  }

  describe('create', () => {
    it('cria com nome, meta e cor', async () => {
      const created = await service.create(form('Ações', 40))

      expect(created).toMatchObject({ name: 'Ações', targetPercent: 40, color: '#36a2eb' })
    })

    it('rejeita nome duplicado com 409', async () => {
      await service.create(form('Ações'))

      await expect(service.create(form('Ações'))).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  describe('update', () => {
    it('altera nome e meta', async () => {
      const created = await service.create(form('Acoes'))

      const updated = await service.update(created.id, form('Ações', 35))

      expect(updated).toMatchObject({ name: 'Ações', targetPercent: 35 })
    })

    it('manter o próprio nome não colide consigo mesma', async () => {
      const created = await service.create(form('Ações', 40))

      await expect(service.update(created.id, form('Ações', 45))).resolves.toMatchObject({
        targetPercent: 45,
      })
    })

    it('rejeita o nome de outra classe', async () => {
      await service.create(form('Fii'))
      const acoes = await service.create(form('Ações'))

      await expect(service.update(acoes.id, form('Fii'))).rejects.toMatchObject({ statusCode: 409 })
    })

    it('classe inexistente dá 404', async () => {
      await expect(service.update(999, form('Ações'))).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('updateTarget', () => {
    it('mexe só na meta', async () => {
      const created = await service.create(form('Ações', 20, '#36a2eb'))

      const updated = await service.updateTarget(created.id, 42.5)

      expect(updated).toMatchObject({ name: 'Ações', targetPercent: 42.5, color: '#36a2eb' })
    })
  })

  describe('delete', () => {
    it('apaga classe vazia', async () => {
      const created = await service.create(form('Ações'))

      await service.delete(created.id)

      expect(await db.assetClass.count()).toBe(0)
    })

    it('recusa apagar classe com ativo dentro', async () => {
      const created = await service.create(form('Ações'))
      await createAsset(db, 'PETR4', { assetClassId: created.id })

      await expect(service.delete(created.id)).rejects.toMatchObject({ statusCode: 409 })
      expect(await db.assetClass.count()).toBe(1)
    })
  })

  describe('assignAsset', () => {
    it('move o ativo de classe', async () => {
      const acoes = await createAssetClass(db, 'Ações')
      const fii = await createAssetClass(db, 'Fii')
      await createAsset(db, 'HGLG11', { assetClassId: acoes.id })

      await service.assignAsset('hglg11', fii.id)

      const asset = await db.asset.findUnique({ where: { ticker: 'HGLG11' } })
      expect(asset?.assetClassId).toBe(fii.id)
    })

    it('null tira a classe', async () => {
      const acoes = await createAssetClass(db, 'Ações')
      await createAsset(db, 'PETR4', { assetClassId: acoes.id })

      await service.assignAsset('PETR4', null)

      const asset = await db.asset.findUnique({ where: { ticker: 'PETR4' } })
      expect(asset?.assetClassId).toBeNull()
    })

    it('ativo inexistente dá 404', async () => {
      await expect(service.assignAsset('XPTO3', null)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('classe inexistente dá 404 e não mexe no ativo', async () => {
      await createAsset(db, 'PETR4')

      await expect(service.assignAsset('PETR4', 999)).rejects.toMatchObject({ statusCode: 404 })
      const asset = await db.asset.findUnique({ where: { ticker: 'PETR4' } })
      expect(asset?.assetClassId).toBeNull()
    })
  })

  describe('defaultClassIdForType', () => {
    it('resolve o tipo contra a classe cadastrada', async () => {
      await seedDefaultAssetClasses(db)

      const id = await service.defaultClassIdForType('REIT')

      const fii = await db.assetClass.findUnique({ where: { name: 'Fii' } })
      expect(id).toBe(fii?.id)
    })

    it('OUTROS não tem classe padrão', async () => {
      await seedDefaultAssetClasses(db)

      expect(await service.defaultClassIdForType('OUTROS')).toBeNull()
    })

    it('classe renomeada some do mapa sem quebrar o cadastro de ativo', async () => {
      await createAssetClass(db, 'Renda Variável')

      expect(await service.defaultClassIdForType('STOCK')).toBeNull()
    })
  })
})
