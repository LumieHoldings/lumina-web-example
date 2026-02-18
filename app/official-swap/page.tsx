"use client";

import { useState, useCallback } from "react";
import { AccountId } from "@miden-sdk/miden-sdk";

const OFFERED_AMOUNT = BigInt(1000);
const REQUESTED_AMOUNT = BigInt(1000);

type TestPhase =
  | "idle"
  | "init"
  | "create-faucets"
  | "create-wallets"
  | "mint-tokens"
  | "create-swapp"
  | "fill-swapp"
  | "consume-p2id"
  | "verify"
  | "done"
  | "error";

interface TestState {
  phase: TestPhase;
  logs: string[];
  goldFaucetId: string | null;
  silverFaucetId: string | null;
  makerId: string | null;
  takerId: string | null;
  swappNoteId: string | null;
  p2idNoteId: string | null;
  leftoverNoteId: string | null;
}

export default function OfficialSwapPage() {
  const [state, setState] = useState<TestState>({
    phase: "idle",
    logs: [],
    goldFaucetId: null,
    silverFaucetId: null,
    makerId: null,
    takerId: null,
    swappNoteId: null,
    p2idNoteId: null,
    leftoverNoteId: null,
  });

  const log = useCallback((message: string) => {
    console.log(message);
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        `[${new Date().toISOString().slice(11, 19)}] ${message}`,
      ],
    }));
  }, []);

  const setPhase = useCallback((phase: TestPhase) => {
    setState((prev) => ({ ...prev, phase }));
  }, []);

  const logPrefixSuffix = useCallback(
    async (name: string, accountId: unknown) => {
      const id = accountId as AccountId;
      const hex = id.toString();
      const hexLen = hex.replace("0x", "").length;
      const prefix = id.prefix().asInt();
      const suffix = id.suffix().asInt();

      log(`  ${name} ID:     ${hex}`);
      log(`  ${name} hex len: ${hexLen} chars`);
      log(
        `  ${name} prefix:  ${prefix} (0x${prefix.toString(16).padStart(16, "0")})`,
      );
      log(
        `  ${name} suffix:  ${suffix} (0x${suffix.toString(16).padStart(16, "0")})`,
      );
    },
    [log],
  );

  const runTest = useCallback(async () => {
    const {
      WebClient,
      AccountId,
      AuthScheme,
      AccountStorageMode,
      NoteType,
      Word,
      Felt,
      FungibleAsset,
      Note,
      NoteAssets,
      NoteMetadata,
      NoteRecipient,
      NoteTag,
      NoteInputs,
      OutputNote,
      TransactionFilter,
      TransactionRequestBuilder,
      MidenArrays,
    } = await import("@miden-sdk/miden-sdk");

    try {
      setPhase("init");
      log("");
      log("============================================================");
      log("PHASE 1: INITIALIZE CLIENT");
      log("============================================================");

      const rpcUrl = "https://rpc.testnet.miden.io:443";
      const storeName = `official-swap-${Date.now()}`;
      log(`RPC URL: ${rpcUrl}`);
      const client = await WebClient.createClient(
        rpcUrl,
        undefined,
        undefined,
        storeName,
      );
      log("WebClient created");

      await client.syncState();
      const syncHeight = await client.getSyncHeight();
      log(`Synced to block: ${syncHeight}`);

      const accountStorageMode = AccountStorageMode.private();
      const mutable = true;
      const toAccountId = (hex: string) => AccountId.fromHex(hex);

      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 2: CREATE WALLETS (PRIVATE STORAGE)");
      log("============================================================");
      const makerAccount = await client.newWallet(
        accountStorageMode,
        mutable,
        AuthScheme.AuthRpoFalcon512,
      );
      const makerId = makerAccount.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerId: makerIdHex }));
      log("");
      log("=== MAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Maker", toAccountId(makerIdHex));

      const takerAccount = await client.newWallet(
        accountStorageMode,
        mutable,
        AuthScheme.AuthRpoFalcon512,
      );

      const takerId = takerAccount.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerId: takerIdHex }));

      log("");
      log("=== TAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Taker", toAccountId(takerIdHex));

      setPhase("create-faucets");
      log("");
      log("============================================================");
      log("PHASE 3: CREATE FAUCETS");
      log("============================================================");

      // GOLD faucet (offered token)
      log("");
      log("Creating GOLD faucet...");
      const goldFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false, // fungible
        "GOLD",
        0, // decimals
        BigInt(1_000_000_000),
        AuthScheme.AuthRpoFalcon512,
      );
      const goldFaucetId = goldFaucet.id();
      const goldFaucetIdHex = goldFaucetId.toString();
      setState((prev) => ({ ...prev, goldFaucetId: goldFaucetIdHex }));

      log("");
      log("=== GOLD FAUCET (OFFERED TOKEN) ===");
      await logPrefixSuffix("GOLD", toAccountId(goldFaucetIdHex));

      // SILVER faucet (requested token)
      log("");
      log("Creating SILVER faucet...");
      const silverFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false, // fungible
        "SILVER",
        0, // decimals
        BigInt(1_000_000_000),
        AuthScheme.AuthRpoFalcon512,
      );
      const silverFaucetId = silverFaucet.id();
      const silverFaucetIdHex = silverFaucetId.toString();
      setState((prev) => ({
        ...prev,
        silverFaucetId: silverFaucetIdHex,
      }));

      log("");
      log("=== SILVER FAUCET (REQUESTED TOKEN) ===");
      await logPrefixSuffix("SILVER", toAccountId(silverFaucetIdHex));

      await client.syncState();

      log("Minting Gold to Maker");
      const goldMintTxRequest = client.newMintTransactionRequest(
        makerAccount.id(), // Target account (who receives the tokens)
        goldFaucet.id(), // Faucet account (who mints the tokens)
        NoteType.Public, // Note visibility (public = onchain)
        OFFERED_AMOUNT, // Amount to mint (in base units)
      );

      await client.submitNewTransaction(goldFaucet.id(), goldMintTxRequest);

      log("Minting Silver to Taker");
      const silverMintTxRequest = client.newMintTransactionRequest(
        takerAccount.id(), // Target account (who receives the tokens)
        silverFaucet.id(), // Faucet account (who mints the tokens)
        NoteType.Public, // Note visibility (public = onchain)
        REQUESTED_AMOUNT, // Amount to mint (in base units)
      );

      await client.submitNewTransaction(silverFaucet.id(), silverMintTxRequest);

      // Wait for the transaction to be processed
      // Wait for mints to commit
      log("");
      log("Waiting for mints to commit (10s)...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await client.syncState();

      // Consuming notes
      // Get consumable notes for maker
      const makerConsumable = await client.getConsumableNotes(
        toAccountId(makerIdHex),
      );
      log(`  Maker has ${makerConsumable.length} consumable notes`);

      if (makerConsumable.length > 0) {
        const makerNotes = makerConsumable.map((n) =>
          n.inputNoteRecord().toNote(),
        );
        const makerConsumeReq = client.newConsumeTransactionRequest(makerNotes);
        const makerConsumeTxId = await client.submitNewTransaction(
          toAccountId(makerIdHex),
          makerConsumeReq,
        );
        log(`Maker Consumption ID: ${makerConsumeTxId.toHex()}`);
        await client.syncState();
      }

      // Consume for taker
      const takerConsumable = await client.getConsumableNotes(
        toAccountId(takerIdHex),
      );
      log(`  Taker has ${takerConsumable.length} consumable notes`);

      if (takerConsumable.length > 0) {
        const takerNoteIds = takerConsumable.map((n) =>
          n.inputNoteRecord().toNote(),
        );
        const takerConsumeReq =
          client.newConsumeTransactionRequest(takerNoteIds);
        const takerConsumeTxId = await client.submitNewTransaction(
          toAccountId(takerIdHex),
          takerConsumeReq,
        );

        log(`Taker Consumption ID: ${takerConsumeTxId.toHex()}`);
        await client.syncState();

        const swapTag = WebClient.buildSwapTag(
          NoteType.Public,
          goldFaucet.id(),
          OFFERED_AMOUNT,
          silverFaucet.id(),
          REQUESTED_AMOUNT,
        );
        log(
          `Registering swap discovery tag: ${swapTag.asU32()} (0x${swapTag.asU32().toString(16)})`,
        );
        await client.addTag(String(swapTag.asU32()));
        const trackedTags = await client.listTags();
        log(`Tracked tags: ${JSON.stringify(trackedTags)}`);

        const swapRequest = await client.newSwapTransactionRequest(
          toAccountId(makerAccount.id().toString()),
          toAccountId(goldFaucet.id().toString()),
          OFFERED_AMOUNT,
          toAccountId(silverFaucet.id().toString()),
          REQUESTED_AMOUNT,
          NoteType.Public,
          NoteType.Public,
        );
        const expectedOutputNotes = swapRequest.expectedOutputOwnNotes();
        if (expectedOutputNotes.length === 0) {
          throw new Error("Swap request has no expected output notes");
        }
        const expectedSwapNoteId = expectedOutputNotes[0].id().toString();
        setState((prev) => ({ ...prev, swappNoteId: expectedSwapNoteId }));
        log(`Expected swap note ID => ${expectedSwapNoteId}`);

        const swapTxId = await client.submitNewTransaction(
          toAccountId(makerIdHex),
          swapRequest,
        );

        await client.syncState();
        log(`Swap TransactionID => ${swapTxId.toHex()}`);
        log("");
        log("Polling for expected swap note by ID (up to 60s)...");
        let inputNoteRecord = undefined as Awaited<
          ReturnType<typeof client.getInputNote>
        >;
        for (let i = 1; i <= 12; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await client.syncState();

          const txRecords = await client.getTransactions(
            TransactionFilter.all(),
          );
          const txRecord = txRecords.find(
            (record) => record.id().toHex() === swapTxId.toHex(),
          );
          let txStatus = "unknown";
          if (txRecord) {
            const status = txRecord.transactionStatus();
            if (status.isCommitted()) {
              txStatus = `COMMITTED@${status.getBlockNum()}`;
            } else if (status.isPending()) {
              txStatus = "PENDING";
            } else if (status.isDiscarded()) {
              txStatus = "DISCARDED";
            }
          }

          let outputById = false;
          try {
            await client.getOutputNote(expectedSwapNoteId);
            outputById = true;
          } catch {
            outputById = false;
          }

          inputNoteRecord = await client.getInputNote(expectedSwapNoteId);
          const takerConsumableNow = await client.getConsumableNotes(
            toAccountId(takerIdHex),
          );
          log(
            `  Poll ${i}/12 -> tx=${txStatus}, outputById=${outputById ? "FOUND" : "missing"}, inputById=${inputNoteRecord ? "FOUND" : "missing"}, taker consumable=${takerConsumableNow.length}`,
          );
          if (inputNoteRecord) break;
        }

        log("Attempt to consume swap transaction");
        if (inputNoteRecord) {
          const newNote = inputNoteRecord.toNote();
          const newNoteConsumeRequest = client.newConsumeTransactionRequest([
            newNote,
          ]);
          log("Setup New Note Consume Request");
          const newNoteTxId = await client.submitNewTransaction(
            toAccountId(takerIdHex),
            newNoteConsumeRequest,
          );
          await client.syncState();
          log(`New Swap Consume Tx ID => ${newNoteTxId.toHex()}`);
        } else {
          log("Expected swap note not found by note ID!");
        }
      }
    } catch (swapError: unknown) {
      if (swapError instanceof Error) {
        throw new Error(`Swap Error => ${swapError.message}`);
      }
      throw new Error(`Unknown Swap Error: ${swapError}`);
    }
  }, []);

  const isRunning =
    state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#000",
        color: "#fff",
        padding: "24px",
        fontFamily: "monospace",
      }}
    >
      <div style={{ maxWidth: "896px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: "bold",
            marginBottom: "16px",
          }}
        >
          Official Swap Test
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          Official Full-fill
        </p>

        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "24px",
            alignItems: "center",
          }}
        >
          <button
            onClick={runTest}
            disabled={isRunning}
            style={{
              padding: "8px 16px",
              backgroundColor: isRunning ? "#374151" : "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.phase === "idle"
              ? "Run Flow Test"
              : state.phase === "done"
                ? "Run Again"
                : state.phase === "error"
                  ? "Retry"
                  : "Running..."}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#6b7280" }}>Phase:</span>
            <span
              style={{
                fontFamily: "monospace",
                color:
                  state.phase === "error"
                    ? "#ef4444"
                    : state.phase === "done"
                      ? "#22c55e"
                      : "#eab308",
              }}
            >
              {state.phase}
            </span>
          </div>
        </div>

        {/* Account IDs */}
        {(state.goldFaucetId || state.makerId) && (
          <div
            style={{
              marginBottom: "24px",
              padding: "16px",
              backgroundColor: "#111827",
              borderRadius: "8px",
              fontFamily: "monospace",
              fontSize: "0.875rem",
            }}
          >
            <h2
              style={{
                fontSize: "1.125rem",
                fontWeight: "bold",
                marginBottom: "8px",
              }}
            >
              Accounts Created
            </h2>
            {state.goldFaucetId && <div>GOLD Faucet: {state.goldFaucetId}</div>}
            {state.silverFaucetId && (
              <div>SILVER Faucet: {state.silverFaucetId}</div>
            )}
            {state.makerId && <div>Maker: {state.makerId}</div>}
            {state.takerId && <div>Taker: {state.takerId}</div>}
            {state.swappNoteId && (
              <div>Latest SWAP Note: {state.swappNoteId}</div>
            )}
            {state.p2idNoteId && <div>P2ID Note: {state.p2idNoteId}</div>}
          </div>
        )}

        {/* Logs */}
        <div
          style={{
            backgroundColor: "#111827",
            borderRadius: "8px",
            padding: "16px",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            overflow: "auto",
            maxHeight: "600px",
          }}
        >
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: "bold",
              marginBottom: "8px",
            }}
          >
            Console Output
          </h2>
          {state.logs.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              Click &quot;Run Flow Test&quot; to start
            </p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {state.logs.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
