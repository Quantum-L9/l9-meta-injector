"""Fixture FastAPI surface. Route decorators only; wiring is deliberately incomplete."""
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="example-service")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/v1/execute")
async def execute(payload: dict) -> JSONResponse:
    action = payload.get("action")
    # TODO: route to the engine handler
    return JSONResponse({"status": "ok", "action": action})
