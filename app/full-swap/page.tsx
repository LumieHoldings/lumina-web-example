"use client";

import { useCallback, useState } from "react";
import { AccountId } from "@miden-sdk/miden-sdk";

const OFFERED_AMOUNT = BigInt(1000);
const REQUESTED_AMOUNT = BigInt(1000);
type SwapMode = "public" | "private";

// Copied from miden-standards official notes/swap.masm (v0.13.x) for isolation testing.
const OFFICIAL_SWAP_MASM = `
use miden::protocol::active_note
use miden::protocol::output_note
use miden::standards::wallets::basic->wallet

const SWAP_NOTE_INPUTS_NUMBER=16

const PAYBACK_NOTE_TYPE_ADDRESS=0
const PAYBACK_NOTE_TAG_ADDRESS=1
const ATTACHMENT_KIND_ADDRESS=2
const ATTACHMENT_SCHEME_ADDRESS=3
const ATTACHMENT_ADDRESS=4
const REQUESTED_ASSET_ADDRESS=8
const PAYBACK_RECIPIENT_ADDRESS=12

const ERR_SWAP_WRONG_NUMBER_OF_INPUTS="SWAP script expects exactly 16 note inputs"
const ERR_SWAP_WRONG_NUMBER_OF_ASSETS="SWAP script requires exactly 1 note asset"

begin
    dropw

    push.0 exec.active_note::get_inputs
    eq.SWAP_NOTE_INPUTS_NUMBER assert.err=ERR_SWAP_WRONG_NUMBER_OF_INPUTS
    drop

    mem_loadw_be.REQUESTED_ASSET_ADDRESS
    padw mem_loadw_be.PAYBACK_RECIPIENT_ADDRESS

    mem_load.PAYBACK_NOTE_TYPE_ADDRESS
    mem_load.PAYBACK_NOTE_TAG_ADDRESS
    exec.output_note::create

    movdn.4
    repeat.11
        push.0
        movdn.5
    end
    call.wallet::move_asset_to_note
    dropw

    mem_loadw_be.ATTACHMENT_ADDRESS
    mem_load.ATTACHMENT_KIND_ADDRESS
    mem_load.ATTACHMENT_SCHEME_ADDRESS
    movup.6
    exec.output_note::set_attachment

    push.0 exec.active_note::get_assets
    assert.err=ERR_SWAP_WRONG_NUMBER_OF_ASSETS
    mem_loadw_be
    call.wallet::receive_asset

    repeat.4
        dropw
    end
end
`;

type TestPhase =
  | "idle"
  | "init"
  | "create-faucets"
  | "create-wallets"
  | "mint-tokens"
  | "consume-mints"
  | "create-swap"
  | "fill-swap"
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
  swapNoteId: string | null;
  p2idNoteIds: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function FullSwapPage() {
  const [mode, setMode] = useState<SwapMode>("public");
  const [state, setState] = useState<TestState>({
    phase: "idle",
    logs: [],
    goldFaucetId: null,
    silverFaucetId: null,
    makerId: null,
    takerId: null,
    swapNoteId: null,
    p2idNoteIds: [],
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

  const toAccountId = useCallback((hex: string) => AccountId.fromHex(hex), []);

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
    setState({
      phase: "init",
      logs: [],
      goldFaucetId: null,
      silverFaucetId: null,
      makerId: null,
      takerId: null,
      swapNoteId: null,
      p2idNoteIds: [],
    });

    try {
      const {
        WebClient,
        AccountStorageMode,
        NoteType,
        Word,
        Felt,
        FungibleAsset,
        Note,
        NoteAssets,
        NoteAttachment,
        NoteMetadata,
        NoteRecipient,
        NoteScript,
        NoteTag,
        NoteInputs,
        OutputNote,
        TransactionRequestBuilder,
        MidenArrays,
        NoteAndArgs,
      } = await import("@miden-sdk/miden-sdk");
      const isPrivateMode = mode === "private";
      const swapNoteType = isPrivateMode ? NoteType.Private : NoteType.Public;
      const outputNoteType = isPrivateMode ? BigInt(2) : BigInt(1);
      const modeLabel = isPrivateMode ? "PRIVATE" : "PUBLIC";

      log("============================================================");
      log(`FULL SWAP ONLY TEST (${modeLabel}) - OFFICIAL SWAP.MASM`);
      log("============================================================");
      log("");
      log("Goal:");
      log("  1. Maker creates one swap note: 1000 GOLD for 1000 SILVER");
      log("  2. Taker fully fills it with 1000 SILVER");
      log("  3. Script body is copied from official swap.masm");
      log("  4. Inputs use official 16-field layout");
      log(`  5. Swap/payback note mode: ${modeLabel}`);

      setPhase("init");
      log("");
      log("============================================================");
      log("PHASE 1: INITIALIZE CLIENT");
      log("============================================================");

      const rpcUrl =
        process.env.NEXT_PUBLIC_MIDEN_NODE_URI ||
        "https://rpc.testnet.miden.io:443";
      const storeName = `full-swap-${mode}-${Date.now()}`;
      log(`RPC URL: ${rpcUrl}`);
      log(`Store: ${storeName}`);

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

      const submitAndApply = async (
        accountId: any,
        request: any,
        label: string,
      ) => {
        const txResult = await client.executeTransaction(accountId, request);
        const txProven = await client.proveTransaction(txResult);
        const txHeight = await client.submitProvenTransaction(
          txProven,
          txResult,
        );
        await client.applyTransaction(txResult, txHeight);
        log(`  ${label}`);
        return txResult;
      };

      const consumeAllConsumable = async (
        accountHex: string,
        label: string,
      ) => {
        const consumable = await client.getConsumableNotes(
          toAccountId(accountHex),
        );
        log(`  ${label} has ${consumable.length} consumable notes`);

        if (consumable.length === 0) {
          return [] as string[];
        }

        const notes = consumable.map((n) => n.inputNoteRecord().toNote());
        const noteIds = notes.map((n) => n.id().toString());
        const consumeReq = client.newConsumeTransactionRequest(notes);
        await submitAndApply(
          toAccountId(accountHex),
          consumeReq,
          `${label} consumed note(s)`,
        );
        return noteIds;
      };

      setPhase("create-faucets");
      log("");
      log("============================================================");
      log("PHASE 2: CREATE FAUCETS");
      log("============================================================");

      log("");
      log("Creating GOLD faucet...");
      const goldFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false,
        "GOLD",
        0,
        BigInt(1_000_000_000),
        0,
      );
      const goldFaucetId = goldFaucet.id();
      const goldFaucetIdHex = goldFaucetId.toString();
      setState((prev) => ({ ...prev, goldFaucetId: goldFaucetIdHex }));
      log("");
      log("=== GOLD FAUCET ===");
      await logPrefixSuffix("GOLD", toAccountId(goldFaucetIdHex));

      log("");
      log("Creating SILVER faucet...");
      const silverFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false,
        "SILVER",
        0,
        BigInt(1_000_000_000),
        0,
      );
      const silverFaucetId = silverFaucet.id();
      const silverFaucetIdHex = silverFaucetId.toString();
      setState((prev) => ({ ...prev, silverFaucetId: silverFaucetIdHex }));
      log("");
      log("=== SILVER FAUCET ===");
      await logPrefixSuffix("SILVER", toAccountId(silverFaucetIdHex));

      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 3: CREATE WALLETS");
      log("============================================================");

      log("");
      log("Creating Maker wallet (PRIVATE storage)...");
      const makerWallet = await client.newWallet(
        AccountStorageMode.private(),
        true,
        0,
      );
      const makerId = makerWallet.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerId: makerIdHex }));
      log("");
      log("=== MAKER WALLET ===");
      await logPrefixSuffix("Maker", toAccountId(makerIdHex));

      log("");
      log("Creating Taker wallet (PRIVATE storage)...");
      const takerWallet = await client.newWallet(
        AccountStorageMode.private(),
        true,
        0,
      );
      const takerId = takerWallet.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerId: takerIdHex }));
      log("");
      log("=== TAKER WALLET ===");
      await logPrefixSuffix("Taker", toAccountId(takerIdHex));

      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 4: MINT TOKENS");
      log("============================================================");

      log(`Minting ${OFFERED_AMOUNT} GOLD to Maker...`);
      const mintGoldReq = client.newMintTransactionRequest(
        toAccountId(makerIdHex),
        toAccountId(goldFaucetIdHex),
        NoteType.Public,
        OFFERED_AMOUNT,
      );
      await submitAndApply(
        toAccountId(goldFaucetIdHex),
        mintGoldReq,
        "GOLD mint submitted",
      );

      log(`Minting ${REQUESTED_AMOUNT} SILVER to Taker...`);
      const mintSilverReq = client.newMintTransactionRequest(
        toAccountId(takerIdHex),
        toAccountId(silverFaucetIdHex),
        NoteType.Public,
        REQUESTED_AMOUNT,
      );
      await submitAndApply(
        toAccountId(silverFaucetIdHex),
        mintSilverReq,
        "SILVER mint submitted",
      );

      log("Waiting for mints to commit (12s)...");
      await sleep(7000);
      await client.syncState();

      setPhase("consume-mints");
      log("");
      log("============================================================");
      log("PHASE 5: CONSUME MINT NOTES");
      log("============================================================");
      await consumeAllConsumable(makerIdHex, "Maker");
      await consumeAllConsumable(takerIdHex, "Taker");

      log("Waiting for mint consumption to commit (12s)...");
      await sleep(7000);
      await client.syncState();

      setPhase("create-swap");
      log("");
      log("============================================================");
      log("PHASE 6: CREATE FULL SWAP NOTE");
      log("============================================================");

      const builder = client.createCodeBuilder();
      const noteScript = builder.compileNoteScript(OFFICIAL_SWAP_MASM);

      const makerIdObj = toAccountId(makerIdHex);
      const goldFaucetIdObj = toAccountId(goldFaucetIdHex);
      const silverFaucetIdObj = toAccountId(silverFaucetIdHex);
      const creatorPrefix = makerIdObj.prefix().asInt();
      const creatorSuffix = makerIdObj.suffix().asInt();
      const requestedSuffix = silverFaucetIdObj.suffix().asInt();
      const requestedPrefix = silverFaucetIdObj.prefix().asInt();

      const swapTag = WebClient.buildSwapTag(
        swapNoteType,
        goldFaucetIdObj,
        OFFERED_AMOUNT,
        silverFaucetIdObj,
        REQUESTED_AMOUNT,
      );

      console.log("swapTag => ", swapTag.asU32());
      const paybackTag = NoteTag.withAccountTarget(makerIdObj);

      const paybackAttachment = new NoteAttachment();
      const attachmentKind = BigInt(paybackAttachment.attachmentKind());
      const attachmentScheme = BigInt(
        paybackAttachment.attachmentScheme().asU32(),
      );
      const attachmentWord =
        paybackAttachment.asWord() ??
        new Word(
          new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), BigInt(0)]),
        );
      const attachmentFelts = attachmentWord.toFelts();

      // Official SWAP expects PAYBACK_RECIPIENT as an input word. Build it explicitly
      // as P2ID(target=maker) recipient digest.
      const paybackRecipientInputs = new NoteInputs(
        new MidenArrays.FeltArray([
          new Felt(BigInt(creatorSuffix)),
          new Felt(BigInt(creatorPrefix)),
        ]),
      );
      const paybackRecipient = new NoteRecipient(
        new Word(
          new BigUint64Array([BigInt(11), BigInt(22), BigInt(33), BigInt(44)]),
        ),
        NoteScript.p2id(),
        paybackRecipientInputs,
      );
      const paybackRecipientDigest = paybackRecipient.digest();
      const paybackRecipientFelts = paybackRecipientDigest.toFelts();
      const paybackRecipientU64s = paybackRecipientDigest.toU64s();

      const noteInputs = new NoteInputs(
        new MidenArrays.FeltArray([
          // 0..3: PAYBACK metadata + attachment header
          new Felt(outputNoteType), // payback_note_type
          new Felt(BigInt(paybackTag.asU32())), // payback_note_tag
          new Felt(attachmentKind), // attachment_kind
          new Felt(attachmentScheme), // attachment_scheme
          // 4..7: ATTACHMENT word
          attachmentFelts[0],
          attachmentFelts[1],
          attachmentFelts[2],
          attachmentFelts[3],
          // 8..11: REQUESTED_ASSET word [amount, 0, suffix, prefix]
          new Felt(REQUESTED_AMOUNT),
          new Felt(BigInt(0)),
          new Felt(BigInt(requestedSuffix)),
          new Felt(BigInt(requestedPrefix)),
          // 12..15: PAYBACK_RECIPIENT digest word
          paybackRecipientFelts[0],
          paybackRecipientFelts[1],
          paybackRecipientFelts[2],
          paybackRecipientFelts[3],
        ]),
      );

      log(`  Offered:   ${OFFERED_AMOUNT} GOLD`);
      log(`  Requested: ${REQUESTED_AMOUNT} SILVER`);
      log(`  Swap note type: ${modeLabel}`);
      log(
        `  SWAP tag:  ${swapTag.asU32()} (0x${swapTag.asU32().toString(16)})`,
      );
      log(
        `  PAYBACK tag: ${paybackTag.asU32()} (0x${paybackTag.asU32().toString(16)})`,
      );
      log(`  PAYBACK note type: ${outputNoteType} (${modeLabel})`);
      log(
        `  PAYBACK recipient digest (u64s): [${paybackRecipientU64s[0]}, ${paybackRecipientU64s[1]}, ${paybackRecipientU64s[2]}, ${paybackRecipientU64s[3]}]`,
      );
      log("  Official input layout:");
      log(`    [0] payback_note_type: ${outputNoteType}`);
      log(`    [1] payback_note_tag: ${paybackTag.asU32()}`);
      log(`    [2] attachment_kind: ${attachmentKind}`);
      log(`    [3] attachment_scheme: ${attachmentScheme}`);
      log(
        `    [8..11] requested_asset: [${REQUESTED_AMOUNT}, 0, ${requestedSuffix}, ${requestedPrefix}]`,
      );

      const swapSerialNum = new Word(
        new BigUint64Array([BigInt(1), BigInt(2), BigInt(3), BigInt(4)]),
      );

      const swapNote = new Note(
        new NoteAssets([new FungibleAsset(goldFaucetIdObj, OFFERED_AMOUNT)]),
        new NoteMetadata(makerIdObj, swapNoteType, swapTag),
        new NoteRecipient(swapSerialNum, noteScript, noteInputs),
      );

      const swapNoteId = swapNote.id().toString();
      setState((prev) => ({ ...prev, swapNoteId }));
      log(`  Swap note ID: ${swapNoteId}`);

      const createSwapReq = new TransactionRequestBuilder()
        .withOwnOutputNotes(
          new MidenArrays.OutputNoteArray([OutputNote.full(swapNote)]),
        )
        .build();

      await submitAndApply(
        toAccountId(makerIdHex),
        createSwapReq,
        "Swap note submitted",
      );

      log("Waiting for swap note creation to commit (12s)...");
      await sleep(12000);
      await client.syncState();

      setPhase("fill-swap");
      log("");
      log("============================================================");
      log("PHASE 7: FULL FILL (1000)");
      log("============================================================");

      const takerBefore = await client.getAccount(toAccountId(takerIdHex));
      if (takerBefore) {
        log("  Taker balances BEFORE fill:");
        for (const asset of takerBefore.vault().fungibleAssets()) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      // Use canonical consume path for parity with standard swap behavior.
      const fillReq = client.newConsumeTransactionRequest([
        Note.deserialize(swapNote.serialize()),
      ]);

      await submitAndApply(
        toAccountId(takerIdHex),
        fillReq,
        "Full fill transaction submitted",
      );

      log("Waiting for full fill to commit (12s)...");
      await sleep(12000);
      await client.syncState();

      const takerAfter = await client.getAccount(toAccountId(takerIdHex));
      if (takerAfter) {
        log("  Taker balances AFTER fill:");
        for (const asset of takerAfter.vault().fungibleAssets()) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      setPhase("consume-p2id");
      log("");
      log("============================================================");
      log("PHASE 8: CONSUME MAKER P2ID NOTES");
      log("============================================================");

      const makerP2idNoteIds = await consumeAllConsumable(makerIdHex, "Maker");
      setState((prev) => ({ ...prev, p2idNoteIds: makerP2idNoteIds }));
      if (makerP2idNoteIds.length > 0) {
        log(`  Maker consumed P2ID note IDs: ${makerP2idNoteIds.join(", ")}`);
      }

      log("Waiting for P2ID consumption to commit (12s)...");
      await sleep(12000);
      await client.syncState();

      setPhase("verify");
      log("");
      log("============================================================");
      log("PHASE 9: VERIFY FINAL BALANCES");
      log("============================================================");

      const makerFinal = await client.getAccount(toAccountId(makerIdHex));
      const takerFinal = await client.getAccount(toAccountId(takerIdHex));

      if (makerFinal) {
        log(`  Maker final balances (${makerIdHex}):`);
        for (const asset of makerFinal.vault().fungibleAssets()) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      if (takerFinal) {
        log(`  Taker final balances (${takerIdHex}):`);
        for (const asset of takerFinal.vault().fungibleAssets()) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      setPhase("done");
      log("");
      log("============================================================");
      log("FULL SWAP TEST COMPLETE");
      log("============================================================");
      log(`  - Mode: ${modeLabel}`);
      log("  - Single full-fill flow executed");
      log("  - Script path emits only P2ID output note");
      log("  - No leftover-note branch exists in this MASM");
    } catch (error) {
      setPhase("error");
      log("");
      log("============================================================");
      log("ERROR");
      log("============================================================");
      log(`${error}`);
      if (error instanceof Error && error.stack) {
        log(error.stack);
      }
      console.error("Full swap test error:", error);
    }
  }, [log, logPrefixSuffix, mode, setPhase, toAccountId]);

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
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: "bold",
            marginBottom: "16px",
          }}
        >
          Full Swap Test (Official swap.masm Copy)
        </h1>

        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          Full-fill harness with selectable mode (public/private) using copied
          official swap.masm logic and official 16-input layout.
        </p>

        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "24px",
            alignItems: "center",
            flexWrap: "wrap",
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
              ? "Run Full Swap Test"
              : state.phase === "done"
                ? "Run Again"
                : state.phase === "error"
                  ? "Retry"
                  : "Running..."}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#6b7280" }}>Mode:</span>
            <button
              onClick={() => setMode("public")}
              disabled={isRunning}
              style={{
                padding: "6px 10px",
                backgroundColor: mode === "public" ? "#2563eb" : "#1f2937",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: isRunning ? "not-allowed" : "pointer",
                fontFamily: "monospace",
              }}
            >
              Public
            </button>
            <button
              onClick={() => setMode("private")}
              disabled={isRunning}
              style={{
                padding: "6px 10px",
                backgroundColor: mode === "private" ? "#2563eb" : "#1f2937",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: isRunning ? "not-allowed" : "pointer",
                fontFamily: "monospace",
              }}
            >
              Private
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#6b7280" }}>Phase:</span>
            <span
              style={{
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

        {(state.goldFaucetId || state.makerId || state.swapNoteId) && (
          <div
            style={{
              marginBottom: "24px",
              padding: "16px",
              backgroundColor: "#111827",
              borderRadius: "8px",
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
              Run Context
            </h2>
            {state.goldFaucetId && <div>GOLD Faucet: {state.goldFaucetId}</div>}
            {state.silverFaucetId && (
              <div>SILVER Faucet: {state.silverFaucetId}</div>
            )}
            <div>Mode: {mode === "private" ? "PRIVATE" : "PUBLIC"}</div>
            {state.makerId && <div>Maker: {state.makerId}</div>}
            {state.takerId && <div>Taker: {state.takerId}</div>}
            {state.swapNoteId && <div>Swap Note: {state.swapNoteId}</div>}
            {state.p2idNoteIds.length > 0 && (
              <div>P2ID Notes: {state.p2idNoteIds.join(", ")}</div>
            )}
          </div>
        )}

        <div
          style={{
            backgroundColor: "#111827",
            borderRadius: "8px",
            padding: "16px",
            fontSize: "0.875rem",
            overflow: "auto",
            maxHeight: "640px",
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
              Click "Run Full Swap Test" to start
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
