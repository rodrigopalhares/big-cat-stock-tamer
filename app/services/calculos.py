from typing import List, Optional, Tuple
import numpy_financial as npf
from app.models import Transacao


def calcular_posicao(transacoes: List[Transacao]) -> dict:
    """
    Calcula preço médio ponderado, quantidade atual, lucro realizado
    e fluxos de caixa a partir das transações de um ativo.

    Retorna dict com:
      - quantidade: posição atual
      - preco_medio: preço médio ponderado
      - custo_total: custo total da posição atual
      - lucro_realizado: lucro/prejuízo de todas as vendas
      - fluxos: lista de (data, valor) para cálculo de TIR
    """
    quantidade = 0.0
    custo_acumulado = 0.0
    lucro_realizado = 0.0
    fluxos: List[Tuple] = []

    for t in sorted(transacoes, key=lambda x: x.data):
        if t.tipo == "COMPRA":
            custo_total_compra = t.quantidade * t.preco + t.taxas
            custo_acumulado += custo_total_compra
            quantidade += t.quantidade
            fluxos.append((t.data, -custo_total_compra))
        elif t.tipo == "VENDA" and quantidade > 0:
            preco_medio_atual = custo_acumulado / quantidade if quantidade > 0 else 0
            receita_venda = t.quantidade * t.preco - t.taxas
            custo_vendido = preco_medio_atual * t.quantidade
            lucro_realizado += receita_venda - custo_vendido
            custo_acumulado -= custo_vendido
            quantidade -= t.quantidade
            fluxos.append((t.data, receita_venda))

    if quantidade < 0:
        quantidade = 0.0

    preco_medio = custo_acumulado / quantidade if quantidade > 0 else 0.0

    return {
        "quantidade": quantidade,
        "preco_medio": preco_medio,
        "custo_total": custo_acumulado,
        "lucro_realizado": lucro_realizado,
        "fluxos": fluxos,
    }


def calcular_tir(fluxos: List[Tuple], valor_atual: Optional[float] = None) -> Optional[float]:
    """
    Calcula a TIR (IRR) a partir dos fluxos de caixa.
    Se valor_atual for fornecido, adiciona como fluxo positivo final.
    Retorna a TIR como percentual (ex: 0.15 = 15%) ou None se não convergir.
    """
    if not fluxos:
        return None

    valores = [v for _, v in fluxos]

    if valor_atual is not None and valor_atual > 0:
        valores.append(valor_atual)

    if len(valores) < 2:
        return None

    try:
        tir = npf.irr(valores)
        if tir is None or (hasattr(tir, '__float__') and (tir != tir)):  # NaN check
            return None
        return float(tir)
    except Exception:
        return None


def calcular_lucro_nao_realizado(
    quantidade: float,
    preco_medio: float,
    preco_atual: float,
) -> float:
    """Lucro/prejuízo não realizado com base no preço de mercado atual."""
    return (preco_atual - preco_medio) * quantidade
