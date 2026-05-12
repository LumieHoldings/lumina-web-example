"use client";

/**
 * Isolated compile-only test for PSWAP-with-fee MASM.
 *
 * Reproduces a WASM-side assembler error: the same MASM compiles fine in the
 * Rust playground (`miden-assembly 0.22.3`) but fails in the WASM SDK 0.14.4
 * with `Diagnostic { message: "syntax error" }`. This page strips everything
 * except the compile step so the error message is unambiguous.
 *
 * Flow:
 *   1. Create a WebClient.
 *   2. Call `client.createCodeBuilder().compileNoteScript(PSWAP_WITH_FEE_MASM)`.
 *   3. Show the script root on success, or the full error stack on failure.
 *
 * Run: `pnpm dev` → http://localhost:3000/compile-test → click Compile.
 */

import { useCallback, useState } from "react";
import { PSWAP_WITH_FEE_MASM } from "@/lib/masm/pswap_with_fee";

export default function CompileTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const append = (line: string) =>
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)} ${line}`]);

  const handleRun = useCallback(async () => {
    setLog([]);
    setRunning(true);
    try {
      append(`MASM length: ${PSWAP_WITH_FEE_MASM.length} chars`);
      append(`Loading @miden-sdk/miden-sdk…`);
      const { MidenClient } = await import("@miden-sdk/miden-sdk");
      const storeName = `compile-test-${Date.now()}`;
      append(`Creating MidenClient.createTestnet (store=${storeName})…`);
      const client = await MidenClient.createTestnet({ storeName });
      append(`MidenClient ready.`);

      append(`Calling client.compile.noteScript({ code: PSWAP_WITH_FEE_MASM })…`);
      const script = await client.compile.noteScript({ code: PSWAP_WITH_FEE_MASM });
      const root = script.root().toHex();
      append(`✅ Compile succeeded — script root: ${root}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? err.stack : "";
      append(`❌ Compile failed: ${msg}`);
      if (stack) append(`Stack:\n${stack}`);
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <h1>PSWAP-with-fee compile-only test</h1>
      <p style={{ color: "#555", fontSize: 14, lineHeight: 1.5 }}>
        Isolates the <code>compileNoteScript</code> call so the WASM
        assembler error has no surrounding noise. If it fails here it&apos;ll
        fail in any consumer; if it succeeds here we know the
        bug is downstream.
      </p>
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        style={{
          background: "#111",
          color: "#fff",
          padding: "10px 18px",
          borderRadius: 8,
          border: 0,
          cursor: running ? "not-allowed" : "pointer",
          fontSize: 14,
          marginBottom: 16,
        }}
      >
        {running ? "Compiling…" : "Compile"}
      </button>
      <pre
        style={{
          background: "#0d0d0d",
          color: "#eaeaea",
          padding: 14,
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          minHeight: 220,
        }}
      >
        {log.length === 0 ? "(click Compile)" : log.join("\n")}
      </pre>
    </div>
  );
}
