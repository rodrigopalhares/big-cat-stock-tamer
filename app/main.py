from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.database import engine
from app import models
from app.routers import ativos, transacoes, carteira

# Cria tabelas no banco automaticamente na inicialização
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Gestão de Carteira de Ações",
    description="Acompanhe seus investimentos em ações brasileiras",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(carteira.router)
app.include_router(ativos.router)
app.include_router(transacoes.router)


@app.get("/")
def root():
    return RedirectResponse(url="/carteira/")
