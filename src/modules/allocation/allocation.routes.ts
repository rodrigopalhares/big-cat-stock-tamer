import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Container } from '../../container.js'
import { HttpError } from '../../shared/http-error.js'
import { AllocationBody, AllocationPage } from '../../views/pages/allocation.js'
import { AssetClassForm, AssignClassForm } from './allocation.schema.js'

const TargetForm = z.object({
  target_percent: z.coerce.number().min(0, 'Meta não pode ser negativa').max(100),
})

export function allocationRoutes(c: Container): FastifyPluginAsync {
  return async (app) => {
    // --- HTML ---

    app.get('/allocation/', async (_req, reply) => {
      const data = await c.allocation.getAllocation()
      return reply.html(AllocationPage(data))
    })

    app.post('/allocation/classes/new', async (req, reply) => {
      await c.assetClasses.create(AssetClassForm.parse(req.body))
      return reply.redirect('/allocation/', 302)
    })

    app.post<{ Params: { id: string } }>('/allocation/classes/:id/edit', async (req, reply) => {
      await c.assetClasses.update(classId(req.params.id), AssetClassForm.parse(req.body))
      return reply.redirect('/allocation/', 302)
    })

    // --- HTMX ---
    //
    // Os três devolvem o bloco inteiro, não a linha mexida: mudar meta ou classe muda
    // percentual, distância e a ordem dos cards. E sem buscar cotação de novo — a página
    // acabou de gravar o preço do dia, e o valor de mercado sai do que está no banco.

    app.post<{ Params: { id: string } }>('/allocation/classes/:id/target', async (req, reply) => {
      const form = TargetForm.parse(req.body)
      await c.assetClasses.updateTarget(classId(req.params.id), form.target_percent)
      return reply.partial(AllocationBody(await c.allocation.getAllocation(false)))
    })

    app.delete<{ Params: { id: string } }>('/allocation/classes/:id', async (req, reply) => {
      await c.assetClasses.delete(classId(req.params.id))
      return reply.partial(AllocationBody(await c.allocation.getAllocation(false)))
    })

    app.post<{ Params: { ticker: string } }>(
      '/allocation/assets/:ticker/class',
      async (req, reply) => {
        const form = AssignClassForm.parse(req.body)
        await c.assetClasses.assignAsset(req.params.ticker, form.class_id)
        return reply.partial(AllocationBody(await c.allocation.getAllocation(false)))
      },
    )

    // --- JSON ---

    app.get('/allocation/api', async () => (await c.allocation.getAllocation()).allocation)

    app.get('/allocation/api/classes', async () => c.assetClasses.list())
  }
}

function classId(value: string): number {
  const id = Number(value)
  if (!Number.isInteger(id)) throw HttpError.badRequest('Classe inválida')
  return id
}
