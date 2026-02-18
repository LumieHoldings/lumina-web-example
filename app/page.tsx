"use client";

import { useCallback, useState } from "react";
import { AccountId } from "@miden-sdk/miden-sdk";
import { PSWAP_PRIVATE_MASM } from "@/lib/masm/pswap";

const OFFERED_AMOUNT = BigInt(100_000);
const REQUESTED_AMOUNT = BigInt(100_000);
const FILL_AMOUNT = BigInt(25_000);
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 24;

type TestPhase =
  | "idle"
  | "init"
  | "create-faucets"
  | "create-wallets"
  | "mint-tokens"
  | "create-pswap"
  | "fill-pswap"
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const injectP2idRoot = (masm: string, rootWords: BigUint64Array): string => {
  const marker = "mem_storew_be.P2ID_SCRIPT_ROOT_WORD dropw";
  const lines = masm.split("\n");

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].includes(marker)) {
      continue;
    }

    const previous = lines[i - 1];
    if (!previous.trimStart().startsWith("push.")) {
      break;
    }

    const indent = previous.match(/^\s*/)?.[0] ?? "";
    lines[i - 1] =
      `${indent}push.${rootWords[0]}.${rootWords[1]}.${rootWords[2]}.${rootWords[3]}`;
    return lines.join("\n");
  }

  throw new Error(
    "Failed to inject P2ID root (could not find push before P2ID root store)",
  );
};

export default function HomePage() {
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
    (name: string, id: AccountId) => {
      const hex = id.toString();
      const prefix = id.prefix().asInt();
      const suffix = id.suffix().asInt();
      log(`  ${name} ID:     ${hex}`);
      log(`  ${name} prefix:  ${prefix} (0x${prefix.toString(16).padStart(16, "0")})`);
      log(`  ${name} suffix:  ${suffix} (0x${suffix.toString(16).padStart(16, "0")})`);
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
      swappNoteId: null,
      p2idNoteId: null,
      leftoverNoteId: null,
    });

    try {
      const sdk = (await import("@miden-sdk/miden-sdk")) as any;
      const {
        WebClient,
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
        NoteScript,
        NoteAndArgs,
        NoteDetails,
        NoteDetailsAndTag,
        NoteDetailsAndTagArray,
        NoteRecipientArray,
        OutputNote,
        TransactionRequestBuilder,
        Rpo256,
        MidenArrays,
      } = sdk;

      const toAccountId = (hex: string) => AccountId.fromHex(hex);

      const submitAndApply = async (
        accountId: any,
        request: any,
        label: string,
      ) => {
        const txResult = await client.executeTransaction(accountId, request);
        const txProven = await client.proveTransaction(txResult);
        const txHeight = await client.submitProvenTransaction(txProven, txResult);
        await client.applyTransaction(txResult, txHeight);
        log(label);
        return txResult;
      };

      const createPswapNote = ({
        creatorId,
        lastConsumerId,
        offeredFaucetId,
        offeredAmount,
        requestedFaucetId,
        requestedAmount,
        serialNum,
        swapCount,
        noteScript,
        noteType,
        parentSerial,
      }: {
        creatorId: AccountId;
        lastConsumerId: AccountId;
        offeredFaucetId: AccountId;
        offeredAmount: bigint;
        requestedFaucetId: AccountId;
        requestedAmount: bigint;
        serialNum: any;
        swapCount: bigint;
        noteScript: any;
        noteType: any;
        parentSerial?: any;
      }) => {
        const swappTag = WebClient.buildSwapTag(
          noteType,
          offeredFaucetId,
          offeredAmount,
          requestedFaucetId,
          requestedAmount,
        );
        const p2idTag = NoteTag.withAccountTarget(creatorId);

        const creatorPrefix = creatorId.prefix().asInt();
        const creatorSuffix = creatorId.suffix().asInt();
        const requestedPrefix = requestedFaucetId.prefix().asInt();
        const requestedSuffix = requestedFaucetId.suffix().asInt();

        const parent = parentSerial
          ? parentSerial.toU64s()
          : new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), BigInt(0)]);

        const inputs = new NoteInputs(
          new MidenArrays.FeltArray([
            new Felt(requestedAmount), // 0
            new Felt(BigInt(0)), // 1
            new Felt(requestedSuffix), // 2
            new Felt(requestedPrefix), // 3
            new Felt(BigInt(swappTag.asU32())), // 4
            new Felt(BigInt(p2idTag.asU32())), // 5
            new Felt(parent[0]), // 6
            new Felt(parent[1]), // 7
            new Felt(swapCount), // 8
            new Felt(BigInt(0)), // 9
            new Felt(parent[2]), // 10
            new Felt(parent[3]), // 11
            new Felt(creatorPrefix), // 12
            new Felt(creatorSuffix), // 13
          ]),
        );

        const assets = new NoteAssets([
          new FungibleAsset(offeredFaucetId, offeredAmount),
        ]);
        const metadata = new NoteMetadata(lastConsumerId, noteType, swappTag);
        const recipient = new NoteRecipient(serialNum, noteScript, inputs);
        return new Note(assets, metadata, recipient);
      };

      const computeP2idSerialNum = (swapSerialNum: any, swapCount: bigint) => {
        const swapCountWord = new Word(
          new BigUint64Array([swapCount, BigInt(0), BigInt(0), BigInt(0)]),
        );
        const felts = [...swapSerialNum.toFelts(), ...swapCountWord.toFelts()];
        return Rpo256.hashElements(new MidenArrays.FeltArray(felts));
      };

      const createLeftoverPswapNote = ({
        creatorId,
        consumerId,
        offeredFaucetId,
        offeredAmount,
        requestedFaucetId,
        requestedAmount,
        swapCount,
        noteScript,
        originalSerial,
        noteType,
      }: {
        creatorId: AccountId;
        consumerId: AccountId;
        offeredFaucetId: AccountId;
        offeredAmount: bigint;
        requestedFaucetId: AccountId;
        requestedAmount: bigint;
        swapCount: bigint;
        noteScript: any;
        originalSerial: any;
        noteType: any;
      }) => {
        const originalU64s = originalSerial.toU64s();
        const leftoverSerial = new Word(
          new BigUint64Array([
            originalU64s[0],
            originalU64s[1],
            originalU64s[2],
            originalU64s[3] + BigInt(1),
          ]),
        );

        return createPswapNote({
          creatorId,
          lastConsumerId: consumerId,
          offeredFaucetId,
          offeredAmount,
          requestedFaucetId,
          requestedAmount,
          serialNum: leftoverSerial,
          swapCount,
          noteScript,
          noteType,
          parentSerial: originalSerial,
        });
      };

      const createP2idNoteWithSerial = ({
        senderId,
        targetId,
        faucetId,
        amount,
        serialNum,
      }: {
        senderId: AccountId;
        targetId: AccountId;
        faucetId: AccountId;
        amount: bigint;
        serialNum: any;
      }) => {
        const targetSuffix = targetId.suffix().asInt();
        const targetPrefix = targetId.prefix().asInt();
        const p2idInputs = new NoteInputs(
          new MidenArrays.FeltArray([
            new Felt(targetSuffix),
            new Felt(targetPrefix),
          ]),
        );
        const recipient = new NoteRecipient(serialNum, NoteScript.p2id(), p2idInputs);
        const metadata = new NoteMetadata(
          senderId,
          NoteType.Public,
          NoteTag.withAccountTarget(targetId),
        );
        const assets = new NoteAssets([new FungibleAsset(faucetId, amount)]);
        return new Note(assets, metadata, recipient);
      };

      log("============================================================");
      log("PSWAP SIMPLE PARTIAL FILL (NO FEES, v0.13)");
      log("============================================================");

      setPhase("init");
      log("");
      log("============================================================");
      log("PHASE 0: INITIALIZE CLIENT");
      log("============================================================");

      const rpcUrl =
        process.env.NEXT_PUBLIC_MIDEN_NODE_URI ||
        "https://rpc.testnet.miden.io:443";
      const storeName = `pswap-simple-${Date.now()}`;
      log(`RPC URL: ${rpcUrl}`);
      log(`Store: ${storeName}`);

      const client = await WebClient.createClient(
        rpcUrl,
        undefined,
        undefined,
        storeName,
      );
      await client.syncState();
      log(`Block: ${await client.getSyncHeight()}`);

      setPhase("create-faucets");
      log("");
      log("============================================================");
      log("PHASE 1: CREATE FAUCETS");
      log("============================================================");

      const goldFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false,
        "GOLD",
        0,
        BigInt(1_000_000_000),
        AuthScheme.AuthRpoFalcon512,
      );
      const goldFaucetId = goldFaucet.id();
      const goldFaucetIdHex = goldFaucetId.toString();
      setState((prev) => ({ ...prev, goldFaucetId: goldFaucetIdHex }));
      log("");
      log("=== GOLD FAUCET ===");
      logPrefixSuffix("GOLD", goldFaucetId);

      const silverFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false,
        "SILVER",
        0,
        BigInt(1_000_000_000),
        AuthScheme.AuthRpoFalcon512,
      );
      const silverFaucetId = silverFaucet.id();
      const silverFaucetIdHex = silverFaucetId.toString();
      setState((prev) => ({ ...prev, silverFaucetId: silverFaucetIdHex }));
      log("");
      log("=== SILVER FAUCET ===");
      logPrefixSuffix("SILVER", silverFaucetId);

      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 2: CREATE WALLETS");
      log("============================================================");

      const makerWallet = await client.newWallet(
        AccountStorageMode.public(),
        true,
        AuthScheme.AuthRpoFalcon512,
      );
      const makerId = makerWallet.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerId: makerIdHex }));
      log("");
      log("=== MAKER ===");
      logPrefixSuffix("Maker", makerId);

      const takerWallet = await client.newWallet(
        AccountStorageMode.public(),
        true,
        AuthScheme.AuthRpoFalcon512,
      );
      const takerId = takerWallet.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerId: takerIdHex }));
      log("");
      log("=== TAKER ===");
      logPrefixSuffix("Taker", takerId);

      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 3: MINT TOKENS");
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
        "  GOLD mint submitted",
      );

      log(`Minting ${FILL_AMOUNT} SILVER to Taker...`);
      const mintSilverReq = client.newMintTransactionRequest(
        toAccountId(takerIdHex),
        toAccountId(silverFaucetIdHex),
        NoteType.Public,
        FILL_AMOUNT,
      );
      await submitAndApply(
        toAccountId(silverFaucetIdHex),
        mintSilverReq,
        "  SILVER mint submitted",
      );

      log("");
      log("Waiting for mints to commit (30s)...");
      await sleep(30_000);
      await client.syncState();

      log("");
      log("--- Consuming Minted Notes ---");

      const makerConsumable = await client.getConsumableNotes(
        toAccountId(makerIdHex),
      );
      if (makerConsumable.length > 0) {
        const makerNotes = makerConsumable.map((n: any) => n.inputNoteRecord().toNote());
        const req = client.newConsumeTransactionRequest(makerNotes);
        await submitAndApply(
          toAccountId(makerIdHex),
          req,
          "  Maker consumed mint note(s)",
        );
      }

      const takerConsumable = await client.getConsumableNotes(
        toAccountId(takerIdHex),
      );
      if (takerConsumable.length > 0) {
        const takerNotes = takerConsumable.map((n: any) => n.inputNoteRecord().toNote());
        const req = client.newConsumeTransactionRequest(takerNotes);
        await submitAndApply(
          toAccountId(takerIdHex),
          req,
          "  Taker consumed mint note(s)",
        );
      }

      log("");
      log("Waiting for consumption to commit (30s)...");
      await sleep(30_000);
      await client.syncState();

      setPhase("create-pswap");
      log("");
      log("============================================================");
      log("PHASE 4: CREATE PSWAP NOTE");
      log("============================================================");
      log(`Offer: ${OFFERED_AMOUNT} GOLD for ${REQUESTED_AMOUNT} SILVER (1:1 ratio)`);

      const p2idRoot = NoteScript.p2id().root().toU64s();
      log(
        `SDK P2ID root words: [${p2idRoot[0]} ${p2idRoot[1]} ${p2idRoot[2]} ${p2idRoot[3]}]`,
      );

      const pswapCodeWithInjectedRoot = injectP2idRoot(PSWAP_PRIVATE_MASM, p2idRoot);
      const noteScript = client
        .createCodeBuilder()
        .compileNoteScript(pswapCodeWithInjectedRoot);

      const swapSerialNum = new Word(
        new BigUint64Array([BigInt(1), BigInt(2), BigInt(3), BigInt(4)]),
      );

      const swappNote = createPswapNote({
        creatorId: toAccountId(makerIdHex),
        lastConsumerId: toAccountId(makerIdHex),
        offeredFaucetId: toAccountId(goldFaucetIdHex),
        offeredAmount: OFFERED_AMOUNT,
        requestedFaucetId: toAccountId(silverFaucetIdHex),
        requestedAmount: REQUESTED_AMOUNT,
        serialNum: swapSerialNum,
        swapCount: BigInt(0),
        noteScript,
        noteType: NoteType.Public,
      });

      const swappNoteId = swappNote.id().toString();
      setState((prev) => ({ ...prev, swappNoteId }));
      log("");
      log("=== PSWAP NOTE CREATED ===");
      log(`  Note ID: ${swappNoteId}`);
      log(`  Tag: ${swappNote.metadata().tag().asU32()}`);

      await client.addTag(String(swappNote.metadata().tag().asU32()));
      await client.addTag(
        String(NoteTag.withAccountTarget(toAccountId(makerIdHex)).asU32()),
      );

      const createReq = new TransactionRequestBuilder()
        .withOwnOutputNotes(
          new MidenArrays.OutputNoteArray([OutputNote.full(swappNote)]),
        )
        .build();
      await submitAndApply(
        toAccountId(makerIdHex),
        createReq,
        "  SWAPP transaction submitted",
      );

      log("");
      log("--- Waiting for SWAPP note to be consumable ---");
      let foundSwapp = false;
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        await client.syncState();
        const consumable = await client.getConsumableNotes();
        const found = consumable.find(
          (n: any) => n.inputNoteRecord().id().toString() === swappNoteId,
        );
        if (found) {
          log(`  Note consumable after ${attempt} attempts`);
          foundSwapp = true;
          break;
        }
        log(`  Polling ${attempt}/${MAX_POLL_ATTEMPTS}...`);
        await sleep(POLL_INTERVAL_MS);
      }

      if (!foundSwapp) {
        throw new Error(
          `SWAPP note not consumable after ${MAX_POLL_ATTEMPTS} attempts`,
        );
      }

      setPhase("fill-pswap");
      log("");
      log("============================================================");
      log("PHASE 5: TAKER FILLS 25%");
      log("============================================================");

      await client.syncState();
      log(`  Block: ${await client.getSyncHeight()}`);

      const takerReceives = (FILL_AMOUNT * OFFERED_AMOUNT) / REQUESTED_AMOUNT;
      const leftoverOffered = OFFERED_AMOUNT - takerReceives;
      const leftoverRequested = REQUESTED_AMOUNT - FILL_AMOUNT;

      log("");
      log("Fill calculation:");
      log(`  Fill amount:        ${FILL_AMOUNT} SILVER (taker sends)`);
      log(`  Maker receives:     ${FILL_AMOUNT} SILVER`);
      log(`  Taker receives:     ${takerReceives} GOLD`);
      log(`  Leftover offered:   ${leftoverOffered} GOLD (in new SWAPP)`);
      log(`  Leftover requested: ${leftoverRequested} SILVER (in new SWAPP)`);

      const noteArgs = new Word(
        new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), FILL_AMOUNT]),
      );

      const nextSwapCount = BigInt(1);
      const p2idSerial = computeP2idSerialNum(swapSerialNum, nextSwapCount);

      const expectedP2id = createP2idNoteWithSerial({
        senderId: toAccountId(takerIdHex),
        targetId: toAccountId(makerIdHex),
        faucetId: toAccountId(silverFaucetIdHex),
        amount: FILL_AMOUNT,
        serialNum: p2idSerial,
      });
      const expectedP2idId = expectedP2id.id().toString();
      setState((prev) => ({ ...prev, p2idNoteId: expectedP2idId }));
      log(`Expected Maker P2ID Note ID: ${expectedP2idId}`);

      const expectedLeftover = createLeftoverPswapNote({
        creatorId: toAccountId(makerIdHex),
        consumerId: toAccountId(takerIdHex),
        offeredFaucetId: toAccountId(goldFaucetIdHex),
        offeredAmount: leftoverOffered,
        requestedFaucetId: toAccountId(silverFaucetIdHex),
        requestedAmount: leftoverRequested,
        swapCount: nextSwapCount,
        noteScript,
        originalSerial: swapSerialNum,
        noteType: NoteType.Public,
      });
      const expectedLeftoverId = expectedLeftover.id().toString();
      setState((prev) => ({ ...prev, leftoverNoteId: expectedLeftoverId }));
      log(`Expected Leftover Note ID: ${expectedLeftoverId}`);

      const noteAndArgs = new NoteAndArgs(
        Note.deserialize(swappNote.serialize()),
        noteArgs,
      );

      const expectedFutureNotes = new NoteDetailsAndTagArray([
        new NoteDetailsAndTag(
          new NoteDetails(expectedP2id.assets(), expectedP2id.recipient()),
          expectedP2id.metadata().tag(),
        ),
        new NoteDetailsAndTag(
          new NoteDetails(expectedLeftover.assets(), expectedLeftover.recipient()),
          expectedLeftover.metadata().tag(),
        ),
      ]);

      const expectedRecipients = new NoteRecipientArray([
        expectedP2id.recipient(),
        expectedLeftover.recipient(),
      ]);

      const fillReq = new TransactionRequestBuilder()
        .withInputNotes(new MidenArrays.NoteAndArgsArray([noteAndArgs]))
        .withExpectedFutureNotes(expectedFutureNotes)
        .withExpectedOutputRecipients(expectedRecipients)
        .build();

      log("");
      log("--- Submitting Fill Transaction ---");
      const fillResult = await submitAndApply(
        toAccountId(takerIdHex),
        fillReq,
        "  Fill transaction submitted",
      );
      log(`  Transaction ID: ${fillResult.id().toHex()}`);

      log("");
      log("============================================================");
      log("MIDENSCAN LINKS");
      log("============================================================");
      log(`  Maker:    https://testnet.midenscan.com/account/${makerIdHex}`);
      log(`  Taker:    https://testnet.midenscan.com/account/${takerIdHex}`);
      log(`  P2ID:     https://testnet.midenscan.com/note/${expectedP2idId}`);
      log(`  Leftover: https://testnet.midenscan.com/note/${expectedLeftoverId}`);

      log("");
      log("Waiting for fill to commit (45s)...");
      await sleep(45_000);
      await client.syncState();

      setPhase("consume-p2id");
      log("");
      log("============================================================");
      log("PHASE 6: MAKER CONSUMES P2ID");
      log("============================================================");

      let p2idConsumed = false;
      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        await client.syncState();
        const consumable = await client.getConsumableNotes(
          toAccountId(makerIdHex),
        );
        const p2idRecord = consumable.find(
          (n: any) => n.inputNoteRecord().id().toString() === expectedP2idId,
        );
        if (p2idRecord) {
          log(`  P2ID consumable after ${attempt} attempts`);
          const consumeReq = client.newConsumeTransactionRequest([
            p2idRecord.inputNoteRecord().toNote(),
          ]);
          await submitAndApply(
            toAccountId(makerIdHex),
            consumeReq,
            "  Maker consumed P2ID note",
          );
          p2idConsumed = true;
          break;
        }
        log(`  Polling ${attempt}/${MAX_POLL_ATTEMPTS}...`);
        await sleep(POLL_INTERVAL_MS);
      }

      if (p2idConsumed) {
        log("");
        log("Waiting for P2ID consumption (30s)...");
        await sleep(30_000);
        await client.syncState();
      }

      setPhase("verify");
      log("");
      log("============================================================");
      log("FINAL BALANCES");
      log("============================================================");

      const makerAccount = await client.getAccount(toAccountId(makerIdHex));
      if (makerAccount) {
        const makerVault = makerAccount.vault();
        log(
          `  Maker:  GOLD=${makerVault.getBalance(toAccountId(goldFaucetIdHex))}, SILVER=${makerVault.getBalance(toAccountId(silverFaucetIdHex))} (expected 0, ${FILL_AMOUNT})`,
        );
      }

      const takerAccount = await client.getAccount(toAccountId(takerIdHex));
      if (takerAccount) {
        const takerVault = takerAccount.vault();
        log(
          `  Taker:  GOLD=${takerVault.getBalance(toAccountId(goldFaucetIdHex))}, SILVER=${takerVault.getBalance(toAccountId(silverFaucetIdHex))} (expected ${takerReceives}, 0)`,
        );
      }

      log(`  Leftover SWAPP: ${leftoverOffered} GOLD (note ${expectedLeftoverId})`);
      log("");
      log("Done.");
      setPhase("done");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
      log("");
      log("============================================================");
      log("ERROR");
      log("============================================================");
      log(message);
      setPhase("error");
    }
  }, [log, logPrefixSuffix, setPhase]);

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
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "12px" }}>
          PSWAP Simple (Rust Port)
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "20px" }}>
          Port of <code>examples/pswap_simple.rs</code> to WebClient TypeScript.
        </p>

        <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
          <button
            onClick={runTest}
            disabled={isRunning}
            style={{
              padding: "8px 16px",
              backgroundColor: isRunning ? "#374151" : "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.phase === "idle"
              ? "Run PSWAP Simple"
              : state.phase === "done"
                ? "Run Again"
                : state.phase === "error"
                  ? "Retry"
                  : "Running..."}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Phase:</span>
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

        {(state.goldFaucetId || state.makerId || state.swappNoteId) && (
          <div
            style={{
              marginBottom: "20px",
              padding: "14px",
              backgroundColor: "#111827",
              borderRadius: "8px",
              fontSize: "0.875rem",
            }}
          >
            <div>GOLD Faucet: {state.goldFaucetId ?? "-"}</div>
            <div>SILVER Faucet: {state.silverFaucetId ?? "-"}</div>
            <div>Maker: {state.makerId ?? "-"}</div>
            <div>Taker: {state.takerId ?? "-"}</div>
            <div>PSWAP Note: {state.swappNoteId ?? "-"}</div>
            <div>P2ID Note: {state.p2idNoteId ?? "-"}</div>
            <div>Leftover Note: {state.leftoverNoteId ?? "-"}</div>
          </div>
        )}

        <div
          style={{
            backgroundColor: "#111827",
            borderRadius: "8px",
            padding: "16px",
            fontSize: "0.875rem",
            maxHeight: "68vh",
            overflow: "auto",
          }}
        >
          <h2 style={{ fontSize: "1.05rem", marginBottom: "8px" }}>Console Output</h2>
          {state.logs.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              Click &quot;Run PSWAP Simple&quot; to start.
            </p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {state.logs.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
