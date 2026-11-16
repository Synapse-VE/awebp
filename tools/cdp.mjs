#!/usr/bin/env node
/** Abre una URL en Chrome headless, espera y devuelve el texto visible. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const espera = Number(process.argv[3] ?? 5000);
const puerto = 9444;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const perfil = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`, url,
], { stdio: "ignore" });

try {
  let lista;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${puerto}/json/list`);
      if (res.ok) { lista = await res.json(); break; }
    } catch { /* esperando */ }
    await dormir(250);
  }
  const pagina = lista.find((t) => t.type === "page");
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));

  let id = 0;
  const pendientes = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const p = pendientes.get(m.id);
    if (!p) return;
    pendientes.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  });
  const enviar = (method, params = {}) => new Promise((resolve, reject) => {
    pendientes.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await dormir(espera);
  const { result } = await enviar("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  console.log(result.value);
} finally {
  chrome.kill("SIGKILL");
}
