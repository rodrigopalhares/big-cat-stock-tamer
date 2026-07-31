import type { Db } from '../../config/db.js'
import { defaultClassNameForType } from '../../domain/asset-class.js'
import type { AssetClass } from '../../generated/prisma/client.js'
import { HttpError } from '../../shared/http-error.js'
import type { AssetClassForm } from './allocation.schema.js'

/** CRUD das classes de alocação e a classificação padrão de ativo novo. */
export class AssetClassService {
  constructor(private readonly db: Db) {}

  list(): Promise<AssetClass[]> {
    return this.db.assetClass.findMany({ orderBy: { name: 'asc' } })
  }

  async create(form: AssetClassForm): Promise<AssetClass> {
    if (await this.existsByName(form.name)) {
      throw HttpError.conflict(`Já existe uma classe chamada '${form.name}'.`)
    }
    return this.db.assetClass.create({
      data: { name: form.name, targetPercent: form.target_percent, color: form.color },
    })
  }

  async update(id: number, form: AssetClassForm): Promise<AssetClass> {
    await this.findOrFail(id)
    if (await this.existsByName(form.name, id)) {
      throw HttpError.conflict(`Já existe uma classe chamada '${form.name}'.`)
    }
    return this.db.assetClass.update({
      where: { id },
      data: { name: form.name, targetPercent: form.target_percent, color: form.color },
    })
  }

  /** Só a meta — é o campo que a tela edita direto na linha, sem abrir modal. */
  async updateTarget(id: number, targetPercent: number): Promise<AssetClass> {
    await this.findOrFail(id)
    return this.db.assetClass.update({ where: { id }, data: { targetPercent } })
  }

  /**
   * Apaga a classe, desde que esteja vazia.
   *
   * A FK é ON DELETE SET NULL, então apagar com ativos dentro funcionaria — e é
   * justamente por isso que barramos aqui: a classificação sumiria em silêncio e os
   * ativos reapareceriam no balde "Sem classe" sem ninguém ter pedido.
   */
  async delete(id: number): Promise<void> {
    const assetClass = await this.findOrFail(id)
    const assets = await this.db.asset.count({ where: { assetClassId: id } })
    if (assets > 0) {
      throw HttpError.conflict(
        `A classe '${assetClass.name}' tem ${assets} ativo(s). Mova-os antes de excluir.`,
      )
    }
    await this.db.assetClass.delete({ where: { id } })
  }

  /** Move o ativo para outra classe; null tira a classe. */
  async assignAsset(ticker: string, classId: number | null): Promise<void> {
    const normalized = ticker.trim().toUpperCase()
    const asset = await this.db.asset.findUnique({ where: { ticker: normalized } })
    if (asset === null) throw HttpError.notFound('Asset not found')
    if (classId !== null) await this.findOrFail(classId)

    await this.db.asset.update({ where: { ticker: normalized }, data: { assetClassId: classId } })
  }

  /**
   * Classe padrão do tipo, resolvida contra o que está cadastrado.
   *
   * Devolve null quando o tipo não tem palpite ou quando a classe foi renomeada/apagada —
   * ativo sem classe aparece na tela e é corrigível, enquanto criar classe sozinho
   * encheria o cadastro de nome duplicado a cada import.
   */
  async defaultClassIdForType(type: string | null | undefined): Promise<number | null> {
    const name = defaultClassNameForType(type)
    if (name === null) return null
    const assetClass = await this.db.assetClass.findUnique({ where: { name } })
    return assetClass?.id ?? null
  }

  private async findOrFail(id: number): Promise<AssetClass> {
    const assetClass = await this.db.assetClass.findUnique({ where: { id } })
    if (assetClass === null) throw HttpError.notFound('Classe não encontrada')
    return assetClass
  }

  private async existsByName(name: string, exceptId?: number): Promise<boolean> {
    const found = await this.db.assetClass.findUnique({ where: { name } })
    return found !== null && found.id !== exceptId
  }
}
