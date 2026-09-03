#!/usr/bin/env python3
"""
Gera docs/security-audit/relatorio-auditoria-seguranca.pdf a partir de findings.py e issues.py.

Uso (a partir da raiz do repositório):

    docs/security-audit/.venv/bin/python docs/security-audit/gerar_relatorio.py

O venv é local ao diretório e não é versionado; para recriá-lo:

    python3 -m venv docs/security-audit/.venv
    docs/security-audit/.venv/bin/pip install reportlab matplotlib
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from findings import (  # noqa: E402
    COLORS,
    COMMIT,
    DATE,
    FINDINGS,
    METHODOLOGY,
    PROJECT,
    RECOMMENDATIONS,
    SEVERITIES,
    STACK,
    STRENGTHS,
)
from issues import ISSUES  # noqa: E402

OUT = HERE / "relatorio-auditoria-seguranca.pdf"
ASSETS = HERE / "assets"
REPORT_NAME = f"Auditoria de Segurança — {PROJECT}"

INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
RULE = colors.HexColor("#CBD5E1")
PANEL = colors.HexColor("#F1F5F9")
CODEBG = colors.HexColor("#F8FAFC")

PAGE_W, PAGE_H = A4
MARGIN = 2 * cm
CONTENT_W = PAGE_W - 2 * MARGIN


# ---------------------------------------------------------------------------------------
# Estilos
# ---------------------------------------------------------------------------------------
def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s: dict[str, ParagraphStyle] = {}

    s["body"] = ParagraphStyle(
        "body", parent=base["BodyText"], fontName="Helvetica", fontSize=9.5,
        leading=14, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7,
    )
    s["small"] = ParagraphStyle(
        "small", parent=s["body"], fontSize=8.5, leading=12, spaceAfter=4,
    )
    s["muted"] = ParagraphStyle(
        "muted", parent=s["small"], textColor=MUTED, alignment=0,
    )
    s["h1"] = ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=17,
        leading=21, textColor=INK, spaceBefore=0, spaceAfter=10,
    )
    s["h2"] = ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12.5,
        leading=16, textColor=INK, spaceBefore=13, spaceAfter=6,
    )
    s["h3"] = ParagraphStyle(
        "h3", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=10,
        leading=13, textColor=INK, spaceBefore=8, spaceAfter=3,
    )
    s["cover_title"] = ParagraphStyle(
        "cover_title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=25,
        leading=30, textColor=INK, alignment=TA_CENTER, spaceAfter=4,
    )
    s["cover_sub"] = ParagraphStyle(
        "cover_sub", parent=base["Normal"], fontName="Helvetica", fontSize=12.5,
        leading=17, textColor=MUTED, alignment=TA_CENTER,
    )
    s["code"] = ParagraphStyle(
        "code", parent=base["Code"], fontName="Courier", fontSize=7.3, leading=9.6,
        textColor=colors.HexColor("#1E293B"), backColor=CODEBG,
        borderPadding=(5, 6, 5, 6), leftIndent=0, spaceBefore=2, spaceAfter=5,
    )
    # Preformatted (não Table) para que uma issue longa possa quebrar entre páginas —
    # célula de tabela não divide, e um bloco de issue passa de uma página inteira.
    s["issue"] = ParagraphStyle(
        "issue", parent=base["Code"], fontName="Courier", fontSize=7.0, leading=9.2,
        textColor=colors.HexColor("#1E293B"), backColor=colors.HexColor("#F8FAFC"),
        # Sem borda: uma issue que quebra entre páginas desenharia a moldura só no primeiro
        # pedaço. Quem delimita o bloco são as linhas --- ISSUE n --- / --- FIM ISSUE n ---.
        borderPadding=(7, 8, 7, 8), spaceBefore=0, spaceAfter=0,
    )
    s["cell"] = ParagraphStyle(
        "cell", parent=s["small"], alignment=0, spaceAfter=0,
    )
    s["cellmono"] = ParagraphStyle(
        "cellmono", parent=s["cell"], fontName="Courier", fontSize=7.4, leading=10,
    )
    s["chip"] = ParagraphStyle(
        "chip", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.5,
        leading=10, textColor=colors.white, alignment=TA_CENTER,
    )
    s["th"] = ParagraphStyle(
        "th", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
        leading=11, textColor=colors.white,
    )
    return s


ST = build_styles()


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def chip(sev: str) -> Table:
    """Etiqueta colorida de severidade, com largura fixa para alinhar na coluna."""
    t = Table(
        [[Paragraph(sev.upper(), ST["chip"])]],
        colWidths=[2.05 * cm], rowHeights=[0.46 * cm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(COLORS[sev])),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


# ---------------------------------------------------------------------------------------
# Gráficos
# ---------------------------------------------------------------------------------------
def counts_by_severity() -> dict[str, int]:
    return {s: sum(1 for f in FINDINGS if f["sev"] == s) for s in SEVERITIES}


def counts_by_category() -> dict[str, int]:
    out: dict[str, int] = {}
    for f in FINDINGS:
        key = f["cat"].split(" (")[0]
        out[key] = out.get(key, 0) + 1
    return out


def donut_chart(path: Path) -> None:
    data = {k: v for k, v in counts_by_severity().items() if v}
    fig, ax = plt.subplots(figsize=(4.3, 4.7), dpi=220)
    wedges, _ = ax.pie(
        list(data.values()),
        colors=[COLORS[k] for k in data],
        startangle=90,
        counterclock=False,
        wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 2.2},
    )
    total = sum(data.values())
    ax.text(0, 0.09, str(total), ha="center", va="center",
            fontsize=27, fontweight="bold", color="#0F172A")
    ax.text(0, -0.25, "achados", ha="center", va="center", fontsize=10, color="#64748B")
    ax.legend(
        wedges, [f"{k}  ({v})" for k, v in data.items()],
        loc="upper center", bbox_to_anchor=(0.5, 0.02), ncol=3,
        frameon=False, fontsize=8.5, handlelength=1.0,
        columnspacing=1.2, labelspacing=0.5,
    )
    ax.set_aspect("equal")
    fig.tight_layout(pad=0.3)
    fig.savefig(path, transparent=True, bbox_inches="tight")
    plt.close(fig)


def bar_chart(path: Path) -> None:
    data = counts_by_category()
    labels = ["\n".join(textwrap.wrap(k, 20)) for k in data]
    values = list(data.values())
    # Cor da barra = severidade mais grave daquela categoria.
    order = {s: i for i, s in enumerate(SEVERITIES)}
    bar_colors = []
    for cat in data:
        worst = min((f["sev"] for f in FINDINGS if f["cat"].split(" (")[0] == cat),
                    key=lambda s: order[s])
        bar_colors.append(COLORS[worst])

    fig, ax = plt.subplots(figsize=(4.9, 4.8), dpi=220)
    bars = ax.barh(labels, values, color=bar_colors, height=0.6)
    ax.invert_yaxis()
    ax.set_xlim(0, max(values) + 1)
    ax.set_xticks(range(0, max(values) + 2))
    ax.tick_params(axis="y", labelsize=8.2, length=0)
    ax.tick_params(axis="x", labelsize=8.5, colors="#64748B", length=0)
    for spine in ("top", "right", "left", "bottom"):
        ax.spines[spine].set_visible(False)
    ax.xaxis.grid(True, color="#E2E8F0", linewidth=0.9)
    ax.set_axisbelow(True)
    for bar, v in zip(bars, values):
        ax.text(v + 0.09, bar.get_y() + bar.get_height() / 2, str(v),
                va="center", fontsize=9, fontweight="bold", color="#0F172A")
    fig.tight_layout(pad=0.3)
    fig.savefig(path, transparent=True, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------------------------------
# Cabeçalho e rodapé
# ---------------------------------------------------------------------------------------
def decorate(canvas, doc) -> None:
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, PAGE_H - MARGIN + 0.62 * cm, REPORT_NAME)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 0.62 * cm, DATE)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - MARGIN + 0.42 * cm,
                    PAGE_W - MARGIN, PAGE_H - MARGIN + 0.42 * cm)

        canvas.line(MARGIN, MARGIN - 0.55 * cm, PAGE_W - MARGIN, MARGIN - 0.55 * cm)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(MARGIN, MARGIN - 1.0 * cm, "Documento interno")
        canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 1.0 * cm, f"Página {doc.page}")
    canvas.restoreState()


# ---------------------------------------------------------------------------------------
# Blocos de conteúdo
# ---------------------------------------------------------------------------------------
def panel(flowables: list, bg=PANEL, border=RULE) -> Table:
    t = Table([[flowables]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.6, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def kv_table(rows: list[tuple[str, str]], col1=5.0 * cm) -> Table:
    data = [
        [Paragraph(f"<b>{esc(k)}</b>", ST["cell"]), Paragraph(esc(v), ST["cell"])]
        for k, v in rows
    ]
    t = Table(data, colWidths=[col1, CONTENT_W - col1])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def cover() -> list:
    out: list = [Spacer(1, 4.2 * cm)]
    out.append(Paragraph("Relatório de Auditoria de Segurança", ST["cover_title"]))
    out.append(Paragraph(f"<b>{esc(PROJECT)}</b>", ST["cover_sub"]))
    out.append(Spacer(1, 0.5 * cm))

    line = Table([[""]], colWidths=[4.5 * cm], rowHeights=[3])
    line.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(COLORS["crítica"])),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    out.append(Table([[line]], colWidths=[CONTENT_W],
                     style=TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")])))
    out.append(Spacer(1, 0.5 * cm))
    out.append(Paragraph(DATE, ST["cover_sub"]))
    out.append(Spacer(1, 1.6 * cm))

    c = counts_by_severity()
    summary = (
        f"<b>{len(FINDINGS)}</b> achados · "
        f"<font color='{COLORS['crítica']}'><b>{c['crítica']} crítica</b></font> · "
        f"<font color='{COLORS['alta']}'><b>{c['alta']} altas</b></font> · "
        f"<font color='{COLORS['média']}'><b>{c['média']} média</b></font> · "
        f"<font color='{COLORS['baixa']}'><b>{c['baixa']} baixa</b></font> · "
        f"<font color='{COLORS['informativa']}'><b>{c['informativa']} informativa</b></font>"
        f"<br/><font color='{COLORS['forte']}'><b>{len(STRENGTHS)} pontos fortes verificados</b></font>"
    )
    out.append(panel([Paragraph(summary, ParagraphStyle(
        "cs", parent=ST["body"], alignment=TA_CENTER, fontSize=10.5, leading=17, spaceAfter=0))]))
    out.append(Spacer(1, 1.0 * cm))

    out.append(Paragraph("Escopo auditado", ST["h3"]))
    out.append(Paragraph(
        f"Todo o repositório na revisão <b>{esc(COMMIT)}</b> do branch <b>master</b>: os 58 handlers "
        "de rota registrados, os services e schemas de cada módulo, as camadas domain/, "
        "integrations/, plugins/, infra/, shared/ e client/, o schema do Prisma e suas migrations, "
        "os arquivos de configuração e de deploy (systemd, GitHub Actions, .env.example) e o "
        "histórico completo do git. Excluídos da revisão: <i>src/generated/</i> (client do Prisma, "
        "gerado) e <i>node_modules/</i>.",
        ST["body"]))
    out.append(Spacer(1, 0.25 * cm))
    out.append(Paragraph(
        "Os achados foram verificados no código real. Os marcados como reproduzidos foram "
        "confirmados por requisição contra a aplicação montada com <font face='Courier'>"
        "app.inject()</font>, e as sondagens usadas foram removidas ao final — a árvore de "
        "trabalho ficou limpa.",
        ST["body"]))
    out.append(PageBreak())
    return out


def methodology() -> list:
    out = [Paragraph("Nota metodológica: as categorias nesta stack", ST["h1"])]
    out.append(Paragraph(
        "Antes da revisão, a stack foi detectada a partir de package.json, prisma/schema.prisma, "
        "src/app.ts e dos arquivos de deploy. Cada categoria do roteiro foi então traduzida para o "
        "equivalente real deste projeto — quando não há equivalente, isso está dito, em vez de "
        "forçar um achado.",
        ST["body"]))
    out.append(Spacer(1, 0.2 * cm))
    out.append(Paragraph("Stack detectada", ST["h2"]))
    out.append(kv_table(STACK, col1=5.4 * cm))
    out.append(Spacer(1, 0.35 * cm))
    out.append(Paragraph("Mapeamento das categorias", ST["h2"]))
    for title, text in METHODOLOGY:
        out.append(KeepTogether([
            Paragraph(esc(title), ST["h3"]),
            Paragraph(esc(text), ST["body"]),
        ]))
    out.append(PageBreak())
    return out


def executive_summary() -> list:
    ASSETS.mkdir(exist_ok=True)
    donut = ASSETS / "severidade.png"
    bars = ASSETS / "categorias.png"
    donut_chart(donut)
    bar_chart(bars)

    from reportlab.platypus import Image

    out = [Paragraph("Resumo executivo", ST["h1"])]
    c = counts_by_severity()
    out.append(Paragraph(
        f"A auditoria registrou <b>{len(FINDINGS)}</b> achados e <b>{len(STRENGTHS)}</b> pontos "
        "fortes verificados. O achado crítico é único e tem uma causa só: a autenticação da "
        "aplicação pode ficar inteiramente desligada por omissão de uma variável de ambiente, sem "
        "que o boot recuse subir. Ele não é apenas o mais grave — é também o que transforma o XSS "
        "refletido de um self-XSS num ataque explorável a partir de outro site. Duas das três "
        "falhas altas (open redirect e ausência de limite de tentativas no login) são "
        "independentes e corrigíveis em poucas linhas cada.",
        ST["body"]))
    out.append(Paragraph(
        "O contraponto importa: o portão de sessão é sólido e resistiu a doze tentativas de "
        "bypass por prefixo de URL, não há SQL cru com entrada do usuário, as views escapam por "
        "padrão, o download de notas não tem path traversal e não há um único segredo embutido no "
        "código, nos configs, no CI ou no histórico do git. As falhas encontradas são de "
        "<i>configuração e de bordas</i>, não de arquitetura.",
        ST["body"]))
    out.append(Spacer(1, 0.3 * cm))

    counters = [
        Paragraph(f"<font color='{COLORS[s]}' size=15><b>{c[s]}</b></font><br/>"
                  f"<font size=7.5 color='#64748B'>{s.upper()}</font>",
                  ParagraphStyle("n", parent=ST["small"], alignment=TA_CENTER, leading=17))
        for s in SEVERITIES
    ] + [
        Paragraph(f"<font color='{COLORS['forte']}' size=15><b>{len(STRENGTHS)}</b></font><br/>"
                  f"<font size=7.5 color='#64748B'>PONTOS FORTES</font>",
                  ParagraphStyle("n2", parent=ST["small"], alignment=TA_CENTER, leading=17))
    ]
    tt = Table([counters], colWidths=[CONTENT_W / 6] * 6, rowHeights=[1.5 * cm])
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    out.append(tt)
    out.append(Spacer(1, 0.55 * cm))

    def scaled(path: Path, width: float) -> Image:
        """Ler imageWidth/imageHeight ANTES de mexer em drawWidth.

        O Image do reportlab carrega o arquivo por preguiça: o primeiro acesso a
        imageWidth dispara o setup, que reescreve drawWidth/drawHeight com o tamanho
        natural — e apagaria a escala definida antes dele.
        """
        img = Image(str(path))
        ratio = img.imageHeight / img.imageWidth
        img.drawWidth = width
        img.drawHeight = width * ratio
        img.hAlign = "CENTER"
        return img

    # Lado a lado: empilhados, o segundo gráfico transbordava para uma página quase vazia.
    col = CONTENT_W / 2
    charts = Table(
        [[Paragraph("Achados por severidade", ST["h2"]),
          Paragraph("Achados por categoria", ST["h2"])],
         [scaled(donut, col - 0.5 * cm), scaled(bars, col - 0.5 * cm)]],
        colWidths=[col, col],
    )
    charts.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 1), (-1, 1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 6),
    ]))
    out.append(charts)
    out.append(Spacer(1, 0.3 * cm))
    out.append(Paragraph(
        "A cor da barra indica a severidade mais grave daquela categoria. As categorias "
        "1 (isolamento de inquilino) e 2 (permissão definida no navegador) não produziram achados "
        "e não aparecem no gráfico — o motivo está na nota metodológica.",
        ST["muted"]))
    out.append(PageBreak())
    return out


def strengths_section() -> list:
    out = [Paragraph("Pontos fortes verificados", ST["h1"])]
    out.append(Paragraph(
        "O que segue não é elogio genérico: cada item foi verificado no arquivo e na linha "
        "citados, e vários foram confirmados por requisição real contra a aplicação. Esta seção "
        "também é a prova de cobertura da auditoria.",
        ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    rows = []
    for i, (title, where, text) in enumerate(STRENGTHS, 1):
        mark = Paragraph(
            f"<font color='{COLORS['forte']}'><b>OK</b></font>",
            ParagraphStyle("ok", parent=ST["small"], alignment=TA_CENTER, spaceAfter=0))
        body = [
            Paragraph(f"<b>{i}. {esc(title)}</b>", ST["cell"]),
            Paragraph(f"<font face='Courier' size=7.2 color='#64748B'>{esc(where)}</font>",
                      ST["cell"]),
            Spacer(1, 2),
            Paragraph(esc(text), ST["cell"]),
        ]
        rows.append([mark, body])

    t = Table(rows, colWidths=[1.15 * cm, CONTENT_W - 1.15 * cm], repeatRows=0)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    out.append(t)

    out.append(Spacer(1, 0.5 * cm))
    weak = [
        ("Um interruptor de segurança que se desliga sozinho",
         "A autenticação não é uma camada que falha em partes: ela está ligada ou desligada, e o "
         "que decide é uma variável vazia. Um controle de tudo-ou-nada cujo estado \"nada\" é o "
         "default e não interrompe o boot é o risco estrutural deste projeto (F1)."),
        ("O escape de HTML tem uma saída lateral",
         "Todo o resto do projeto renderiza por JSX, que escapa. O handler de erro não — e é "
         "exatamente por onde a entrada do usuário volta ao navegador declarada como HTML (F2)."),
        ("Destino de navegação tratado como dado inócuo",
         "O campo returnTo atravessa sete handlers sem validação. É um dado que o usuário controla "
         "e que decide para onde o navegador vai depois de uma operação bem-sucedida — o momento "
         "de maior confiança para um phishing (F3)."),
        ("Uma senha só, sem fricção nenhuma na tentativa",
         "Com credencial única, ausência de limite de tentativas não é detalhe operacional: é a "
         "diferença entre um segredo e um segredo enumerável em rede local (F4)."),
    ]
    for i, (title, text) in enumerate(weak):
        block = [Paragraph(esc(title), ST["h3"]), Paragraph(esc(text), ST["body"])]
        # O h1 acompanha o primeiro item, para não sobrar sozinho no rodapé.
        if i == 0:
            block.insert(0, Paragraph("Pontos fracos: os riscos centrais", ST["h1"]))
        out.append(KeepTogether(block))
    out.append(PageBreak())
    return out


def findings_section() -> list:
    out = [Paragraph("Achados detalhados", ST["h1"])]
    out.append(Paragraph(
        "Agrupados por categoria, em ordem de severidade. Cada achado traz arquivo e linha "
        "exatos, o trecho do código, por que é explorável, a condição de explorabilidade e a "
        "correção sugerida.",
        ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    # Tabela-resumo
    head = [
        Paragraph("Severidade", ST["th"]),
        Paragraph("Arquivo:linha", ST["th"]),
        Paragraph("Descrição", ST["th"]),
    ]
    rows = [head]
    for f in FINDINGS:
        rows.append([
            chip(f["sev"]),
            Paragraph(esc(f["where"]), ST["cellmono"]),
            Paragraph(f"<b>{f['id']}</b> — {esc(f['title'])}<br/>"
                      f"<font size=7.2 color='#64748B'>{esc(f['cat'])}</font>", ST["cell"]),
        ])
    w = [2.35 * cm, 5.0 * cm, CONTENT_W - 7.35 * cm]
    t = Table(rows, colWidths=w, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    out.append(t)
    out.append(Spacer(1, 0.15 * cm))
    out.append(Paragraph(
        "F7 é informativa e prospectiva: não é falha na arquitetura atual. Está registrada porque "
        "é a superfície que vira IDOR imediatamente se o projeto ganhar uma segunda identidade.",
        ST["muted"]))
    out.append(PageBreak())

    for f in FINDINGS:
        out.extend(finding_detail(f))
    return out


def finding_detail(f: dict) -> list:
    out: list = []
    header = Table(
        [[chip(f["sev"]),
          Paragraph(f"<b>{f['id']} — {esc(f['title'])}</b>",
                    ParagraphStyle("ft", parent=ST["body"], fontSize=11.5, leading=15,
                                   alignment=0, spaceAfter=0))]],
        colWidths=[2.35 * cm, CONTENT_W - 2.35 * cm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 1.2, colors.HexColor(COLORS[f["sev"]])),
    ]))
    evidence: list = []
    for path, line, snippet in f["refs"]:
        evidence.append(Paragraph(
            f"<font face='Courier' size=7.6 color='#B91C1C'>{esc(path)}:{esc(line)}</font>",
            ST["cell"]))
        wrapped = "\n".join(
            "\n".join(textwrap.wrap(ln, 108, subsequent_indent="    ")) or ""
            for ln in snippet.splitlines()
        )
        evidence.append(Preformatted(wrapped, ST["code"]))

    # O título do achado nunca fica sozinho no rodapé: vai colado à categoria e à primeira
    # referência de código.
    out.append(KeepTogether([
        header,
        Spacer(1, 5),
        Paragraph(f"<b>Categoria:</b> {esc(f['cat'])}", ST["muted"]),
        Spacer(1, 5),
        Paragraph("Evidência", ST["h3"]),
        *evidence[:2],
    ]))
    out.extend(evidence[2:])

    out.append(Paragraph("Por que é explorável", ST["h3"]))
    out.append(Paragraph(esc(f["why"]), ST["body"]))

    out.append(Paragraph("Verificação", ST["h3"]))
    proof = "<br/>".join(esc(ln) for ln in f["proof"].split("\n"))
    out.append(panel([Paragraph(proof, ParagraphStyle(
        "pf", parent=ST["small"], alignment=0, spaceAfter=0))], bg=colors.HexColor("#F0FDF4"),
        border=colors.HexColor("#BBF7D0")))
    out.append(Spacer(1, 6))

    out.append(Paragraph("Condição de explorabilidade", ST["h3"]))
    out.append(Paragraph(esc(f["cond"]), ST["body"]))

    out.append(Paragraph("Correção sugerida", ST["h3"]))
    out.append(Paragraph(esc(f["fix"]), ST["body"]))
    out.append(Spacer(1, 0.55 * cm))
    return out


def recommendations_section() -> list:
    out = [PageBreak(), Paragraph("Recomendações priorizadas", ST["h1"])]
    out.append(Paragraph(
        "A ordem reflete impacto sobre esforço. As duas de P1 fecham a exposição total da base e "
        "o único caminho de XSS confirmado, e nenhuma passa de algumas dezenas de linhas.",
        ST["body"]))
    out.append(Spacer(1, 0.2 * cm))

    head = [Paragraph(h, ST["th"]) for h in ("Prio", "Ação", "Achado", "Por quê")]
    rows = [head]
    prio_color = {"P1": COLORS["crítica"], "P2": COLORS["alta"], "P3": COLORS["média"]}
    for prio, action, ref, why in RECOMMENDATIONS:
        rows.append([
            Paragraph(f"<font color='{prio_color[prio]}'><b>{prio}</b></font>",
                      ParagraphStyle("p", parent=ST["cell"], alignment=TA_CENTER)),
            Paragraph(f"<b>{esc(action)}</b>", ST["cell"]),
            Paragraph(f"<font face='Courier' size=7.6>{ref}</font>",
                      ParagraphStyle("r", parent=ST["cell"], alignment=TA_CENTER)),
            Paragraph(esc(why), ST["cell"]),
        ])
    w = [1.35 * cm, 5.3 * cm, 1.5 * cm, CONTENT_W - 8.15 * cm]
    t = Table(rows, colWidths=w, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    out.append(t)
    out.append(Spacer(1, 0.4 * cm))
    out.append(Paragraph(
        "Uma observação de sequência: corrigir F1 sem corrigir F2 deixa o XSS refletido como "
        "self-XSS — aceitável. Corrigir F2 sem corrigir F1 não adianta quase nada, porque a base "
        "continua aberta a quem estiver na rede. Se só houver fôlego para uma, comece por F1.",
        ST["body"]))
    return out


def issues_section() -> list:
    out = [PageBreak(), Paragraph("Issues para o GitHub", ST["h1"])]
    out.append(Paragraph(
        "Texto completo em Markdown, pronto para copiar e colar. Achados triviais do mesmo tema "
        "foram agrupados numa issue só — a issue 5 reúne cookie, cabeçalhos e SRI; a issue 3 "
        "reúne os sete redirects — para não gerar spam. F7 não vira issue por ser informativa e "
        "não acionável hoje.",
        ST["body"]))
    out.append(Spacer(1, 0.25 * cm))

    for issue in ISSUES:
        header = Table(
            [[chip(issue["sev"]),
              Paragraph(f"<b>ISSUE {issue['n']}</b> — labels: {issue['labels']}",
                        ParagraphStyle("il", parent=ST["small"], alignment=0, spaceAfter=0))]],
            colWidths=[2.35 * cm, CONTENT_W - 2.35 * cm],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))

        raw = f"--- ISSUE {issue['n']} ---\n\n# {issue['title']}\n\nLabels: {issue['labels']}\n\n"
        raw += issue["body"].rstrip() + f"\n\n--- FIM ISSUE {issue['n']} ---"

        lines: list[str] = []
        for ln in raw.split("\n"):
            if len(ln) <= 96:
                lines.append(ln)
            else:
                indent = " " * (len(ln) - len(ln.lstrip()))
                lines.extend(textwrap.wrap(
                    ln, 96, subsequent_indent=indent + "  ",
                    break_long_words=False, break_on_hyphens=False) or [ln])
        out.append(KeepTogether([header, Spacer(1, 1)]))
        out.append(Preformatted("\n".join(lines), ST["issue"]))
        out.append(Spacer(1, 0.5 * cm))
    return out


def main() -> None:
    doc = BaseDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
        title=f"Relatório de Auditoria de Segurança — {PROJECT}",
        author="Auditoria de segurança", subject=REPORT_NAME,
    )
    frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id="body",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=decorate)])

    story: list = []
    story += cover()
    story += methodology()
    story += executive_summary()
    story += strengths_section()
    story += findings_section()
    story += recommendations_section()
    story += issues_section()

    doc.build(story)
    print(f"PDF gerado: {OUT}")


if __name__ == "__main__":
    main()
