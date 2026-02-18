"use client";

/**
 * PSWAP Private Partial Fill Test Page
 *
 * This test runs two PSWAP flows back-to-back:
 *   1. Flow 1: full fill (1000 SILVER)
 *   2. Flow 2: partial fill (250 SILVER)
 *   3. Mints/consumes top-up notes between flows
 *
 * Key difference from /partial:
 *   - Uses PSWAP_PRIVATE_MASM with 15 inputs (includes NOTE_TYPE_OUTPUT)
 *   - Controls output note type via input[14]
 */

import { useState, useCallback } from "react";
import { AccountId } from "@miden-sdk/miden-sdk";

const OFFERED_AMOUNT = BigInt(1000);
const REQUESTED_AMOUNT = BigInt(1000);
const FILL_AMOUNT = BigInt(250); // 25% fill

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
  pswapNoteId: string | null;
  p2idNoteId: string | null;
  leftoverNoteId: string | null;
}

export default function PrivatePartialFillTestPage() {
  const [state, setState] = useState<TestState>({
    phase: "idle",
    logs: [],
    goldFaucetId: null,
    silverFaucetId: null,
    makerId: null,
    takerId: null,
    pswapNoteId: null,
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

  /**
   * Log prefix and suffix for an AccountId (matches Rust log_prefix_suffix)
   */
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

  /**
   * Run full-fill then partial-fill flows against PSWAP.
   */
  const runTest = useCallback(async () => {
    setState({
      phase: "init",
      logs: [],
      goldFaucetId: null,
      silverFaucetId: null,
      makerId: null,
      takerId: null,
      pswapNoteId: null,
      p2idNoteId: null,
      leftoverNoteId: null,
    });

    try {
      log("============================================================");
      log("PSWAP FLOW TEST (FULL + PARTIAL)");
      log("============================================================");
      log("");
      log("This run executes two public-mode flows with the same script:");
      log("  1. Flow 1: maker creates SWAPP, taker FULL fills 1000 SILVER");
      log(
        "  2. Flow 2: maker creates new SWAPP, taker PARTIAL fills 250 SILVER",
      );
      log("  3. Tokens are topped up between flows via faucet mints");
      log("");
      log("Key: Uses PSWAP_PRIVATE_MASM with NOTE_TYPE_OUTPUT input");

      // Import SDK
      const {
        WebClient,
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
        TransactionRequestBuilder,
        MidenArrays,
      } = await import("@miden-sdk/miden-sdk");

      // =========================================================================
      // PHASE 1: Initialize Client
      // =========================================================================
      setPhase("init");
      log("");
      log("============================================================");
      log("PHASE 1: INITIALIZE CLIENT");
      log("============================================================");

      const rpcUrl =
        process.env.NEXT_PUBLIC_MIDEN_NODE_URI ||
        "https://rpc.testnet.miden.io:443";
      log(`RPC URL: ${rpcUrl}`);

      // Use an isolated store per run to avoid IndexedDB schema/data residue
      // across SDK upgrades (e.g. 0.12 -> 0.13).
      const storeName = `private-partial-${Date.now()}`;
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

      // ====================================================== ===================
      // PHASE 2: Create Faucets (still PUBLIC accounts - only notes are private)
      // =========================================================================
      setPhase("create-faucets");
      log("");
      log("============================================================");
      log("PHASE 2: CREATE FAUCETS");
      log("============================================================");

      // Helper: Convert hex string to AccountId (avoids WASM GC issues)
      const { AccountId } = await import("@miden-sdk/miden-sdk");
      const toAccountId = (hex: string) => AccountId.fromHex(hex);

      // GOLD faucet (offered token)
      log("");
      log("Creating GOLD faucet...");
      const goldFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false, // fungible
        "GOLD",
        0, // decimals
        BigInt(1_000_000_000),
        0,
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
        0,
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

      // =========================================================================
      // PHASE 3: Create Wallets (PRIVATE storage mode for privacy)
      // =========================================================================
      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 3: CREATE WALLETS (PRIVATE STORAGE)");
      log("============================================================");

      // Maker wallet - PRIVATE for full privacy
      log("");
      log("Creating Maker wallet (PRIVATE storage)...");
      const makerWallet = await client.newWallet(
        AccountStorageMode.private(), // PRIVATE wallet
        true, // mutable
        0,
      );
      const makerId = makerWallet.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerId: makerIdHex }));

      log("");
      log("=== MAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Maker", toAccountId(makerIdHex));

      // Taker wallet - PRIVATE for full privacy
      log("");
      log("Creating Taker wallet (PRIVATE storage)...");
      const takerWallet = await client.newWallet(
        AccountStorageMode.private(), // PRIVATE wallet
        true, // mutable
        0,
      );
      const takerId = takerWallet.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerId: takerIdHex }));

      log("");
      log("=== TAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Taker", toAccountId(takerIdHex));

      // =========================================================================
      // PHASE 4: Mint Tokens (PUBLIC notes for minting - tokens need to arrive)
      // =========================================================================
      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 4: MINT TOKENS");
      log("============================================================");
      log("(Mint uses PUBLIC notes so tokens can be discovered)");

      // Mint GOLD to maker
      log("");
      log(`Minting ${OFFERED_AMOUNT} GOLD to Maker...`);
      const mintGoldReq = client.newMintTransactionRequest(
        makerId,
        goldFaucetId,
        NoteType.Public, // Mint as PUBLIC so it can be consumed
        OFFERED_AMOUNT,
      );
      const mintGoldResult = await client.executeTransaction(
        goldFaucetId,
        mintGoldReq,
      );
      const mintGoldProven = await client.proveTransaction(mintGoldResult);
      const mintGoldHeight = await client.submitProvenTransaction(
        mintGoldProven,
        mintGoldResult,
      );
      await client.applyTransaction(mintGoldResult, mintGoldHeight);
      log("  GOLD mint transaction submitted");

      // Mint enough SILVER for both partial and full-fill diagnostics
      log(`Minting ${REQUESTED_AMOUNT} SILVER to Taker...`);
      const mintSilverReq = client.newMintTransactionRequest(
        takerId,
        silverFaucetId,
        NoteType.Public, // Mint as PUBLIC so it can be consumed
        REQUESTED_AMOUNT,
      );
      const mintSilverResult = await client.executeTransaction(
        silverFaucetId,
        mintSilverReq,
      );
      const mintSilverProven = await client.proveTransaction(mintSilverResult);
      const mintSilverHeight = await client.submitProvenTransaction(
        mintSilverProven,
        mintSilverResult,
      );
      await client.applyTransaction(mintSilverResult, mintSilverHeight);
      log("  SILVER mint transaction submitted");

      // Wait for mints to commit
      log("");
      log("Waiting for mints to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Consume minted notes
      log("");
      log("--- Consuming Minted Notes ---");

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
        const makerConsumeResult = await client.executeTransaction(
          toAccountId(makerIdHex),
          makerConsumeReq,
        );
        const makerConsumeProven =
          await client.proveTransaction(makerConsumeResult);
        const makerConsumeHeight = await client.submitProvenTransaction(
          makerConsumeProven,
          makerConsumeResult,
        );
        await client.applyTransaction(makerConsumeResult, makerConsumeHeight);
        log("  Maker consumed mint note(s)");
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
        const takerConsumeResult = await client.executeTransaction(
          toAccountId(takerIdHex),
          takerConsumeReq,
        );
        const takerConsumeProven =
          await client.proveTransaction(takerConsumeResult);
        const takerConsumeHeight = await client.submitProvenTransaction(
          takerConsumeProven,
          takerConsumeResult,
        );
        await client.applyTransaction(takerConsumeResult, takerConsumeHeight);
        log("  Taker consumed mint note(s)");
      }

      // Wait for consumption
      log("");
      log("Waiting for consumption to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // =========================================================================
      // Shared helpers for flow creation and fills
      // =========================================================================
      const { PSWAP_PRIVATE_MASM, NOTE_TYPE } =
        await import("@/lib/masm/pswap-private");
      const builder = client.createCodeBuilder();
      const noteScript = builder.compileNoteScript(PSWAP_PRIVATE_MASM);
      const makerIdFresh = toAccountId(makerIdHex);
      const goldFaucetIdFresh = toAccountId(goldFaucetIdHex);
      const silverFaucetIdFresh = toAccountId(silverFaucetIdHex);
      const creatorPrefix = makerIdFresh.prefix().asInt();
      const creatorSuffix = makerIdFresh.suffix().asInt();
      const reqSuffix = silverFaucetIdFresh.suffix().asInt();
      const reqPrefix = silverFaucetIdFresh.prefix().asInt();
      let swappSerialCounter = BigInt(10);

      const consumeAllConsumable = async (
        accountHex: string,
        label: string,
      ) => {
        const consumable = await client.getConsumableNotes(
          toAccountId(accountHex),
        );
        log(`  ${label} has ${consumable.length} consumable notes`);
        if (consumable.length === 0) return;
        const notes = consumable.map((n) => n.inputNoteRecord().toNote());
        const consumeReq = client.newConsumeTransactionRequest(notes);
        const consumeResult = await client.executeTransaction(
          toAccountId(accountHex),
          consumeReq,
        );
        const consumeProven = await client.proveTransaction(consumeResult);
        const consumeHeight = await client.submitProvenTransaction(
          consumeProven,
          consumeResult,
        );
        await client.applyTransaction(consumeResult, consumeHeight);
        log(`  ${label} consumed note(s)`);
      };

      const createSwappNote = async (
        flowLabel: string,
        swappNoteType: any,
        outputNoteType: bigint,
      ) => {
        const noteTypeLabel =
          swappNoteType === NoteType.Public ? "PUBLIC" : "PRIVATE";
        log("");
        log(`--- ${flowLabel}: create ${noteTypeLabel} SWAPP note ---`);
        const swappTag = WebClient.buildSwapTag(
          swappNoteType,
          goldFaucetIdFresh,
          OFFERED_AMOUNT,
          silverFaucetIdFresh,
          REQUESTED_AMOUNT,
        );
        const p2idTag = NoteTag.withAccountTarget(makerIdFresh);
        const noteInputs = new NoteInputs(
          new MidenArrays.FeltArray([
            new Felt(REQUESTED_AMOUNT), // 0: requested_amount
            new Felt(BigInt(0)), // 1: zero
            new Felt(BigInt(reqSuffix)), // 2: faucet_suffix
            new Felt(BigInt(reqPrefix)), // 3: faucet_prefix
            new Felt(BigInt(swappTag.asU32())), // 4: swapp_tag
            new Felt(BigInt(p2idTag.asU32())), // 5: p2id_tag
            new Felt(BigInt(0)), // 6: empty
            new Felt(BigInt(0)), // 7: empty
            new Felt(BigInt(0)), // 8: swap_count
            new Felt(BigInt(0)), // 9: expiration_block
            new Felt(BigInt(0)), // 10: empty
            new Felt(BigInt(0)), // 11: empty
            new Felt(BigInt(creatorPrefix)), // 12: creator_prefix
            new Felt(BigInt(creatorSuffix)), // 13: creator_suffix
            new Felt(outputNoteType), // 14: NOTE_TYPE_OUTPUT
          ]),
        );

        swappSerialCounter = swappSerialCounter + BigInt(1);
        const serialNum = new Word(
          new BigUint64Array([
            BigInt(1),
            BigInt(2),
            BigInt(3),
            swappSerialCounter,
          ]),
        );

        const swappNote = new Note(
          new NoteAssets([
            new FungibleAsset(goldFaucetIdFresh, OFFERED_AMOUNT),
          ]),
          new NoteMetadata(makerIdFresh, swappNoteType, swappTag),
          new NoteRecipient(serialNum, noteScript, noteInputs),
        );
        const swappNoteId = swappNote.id().toString();
        setState((prev) => ({ ...prev, pswapNoteId: swappNoteId }));
        log(`  Note ID: ${swappNoteId}`);
        log(
          `  NOTE_TYPE_OUTPUT: ${outputNoteType} (${outputNoteType === NOTE_TYPE.PUBLIC ? "PUBLIC" : "PRIVATE"})`,
        );

        const createReq = new TransactionRequestBuilder()
          .withOwnOutputNotes(
            new MidenArrays.OutputNoteArray([OutputNote.full(swappNote)]),
          )
          .build();
        const createResult = await client.executeTransaction(
          toAccountId(makerIdHex),
          createReq,
        );
        const createProven = await client.proveTransaction(createResult);
        const createHeight = await client.submitProvenTransaction(
          createProven,
          createResult,
        );
        await client.applyTransaction(createResult, createHeight);
        log(`  ${flowLabel}: SWAPP note submitted`);
        log("  Waiting for SWAPP creation to commit (12s)...");
        await new Promise((r) => setTimeout(r, 12000));
        await client.syncState();
        return swappNote;
      };

      const executeFill = async (
        flowLabel: string,
        swappNote: any,
        fillAmount: bigint,
      ) => {
        const { NoteAndArgs } = (await import("@miden-sdk/miden-sdk")) as any;
        const noteArgs = new Word(
          new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), fillAmount]),
        );
        log("");
        log(`--- ${flowLabel}: execute fill (${fillAmount} SILVER) ---`);
        const takerBefore = await client.getAccount(toAccountId(takerIdHex));
        if (takerBefore) {
          log("  Taker balances before fill:");
          for (const asset of takerBefore.vault().fungibleAssets()) {
            log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
          }
        }

        const noteAndArgs = new NoteAndArgs(
          Note.deserialize(swappNote.serialize()),
          noteArgs,
        );
        const fillReq = new TransactionRequestBuilder()
          .withInputNotes(new MidenArrays.NoteAndArgsArray([noteAndArgs]))
          .build();
        const fillResult = await client.executeTransaction(
          toAccountId(takerIdHex),
          fillReq,
        );
        const fillProven = await client.proveTransaction(fillResult);
        const fillHeight = await client.submitProvenTransaction(
          fillProven,
          fillResult,
        );
        await client.applyTransaction(fillResult, fillHeight);
        log(`  ${flowLabel}: tx submitted (${fillResult.id().toHex()})`);
        log("  Waiting for fill transaction to commit (12s)...");
        await new Promise((r) => setTimeout(r, 12000));
        await client.syncState();

        const takerAfter = await client.getAccount(toAccountId(takerIdHex));
        if (takerAfter) {
          log("  Taker balances after fill:");
          for (const asset of takerAfter.vault().fungibleAssets()) {
            log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
          }
        }
      };

      // =========================================================================
      // PHASE 5: Flow 1 - PUBLIC full fill
      // =========================================================================
      setPhase("create-swapp");
      log("");
      log("============================================================");
      log("PHASE 5: FLOW 1 - CREATE PUBLIC SWAPP NOTE");
      log("============================================================");
      const flow1Swapp = await createSwappNote(
        "Flow 1 (public full fill)",
        NoteType.Public,
        NOTE_TYPE.PUBLIC,
      );

      setPhase("fill-swapp");
      log("");
      log("============================================================");
      log("PHASE 6: FLOW 1 - FULL FILL (1000)");
      log("============================================================");
      await executeFill(
        "Flow 1 (public full fill)",
        flow1Swapp,
        REQUESTED_AMOUNT,
      );

      // =========================================================================
      // PHASE 7: Top up balances for partial-flow run
      // =========================================================================
      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 7: TOP UP TOKENS FOR PARTIAL FLOW");
      log("============================================================");
      log(`Minting ${OFFERED_AMOUNT} GOLD to Maker...`);
      const topupGoldReq = client.newMintTransactionRequest(
        toAccountId(makerIdHex),
        goldFaucetIdFresh,
        NoteType.Public,
        OFFERED_AMOUNT,
      );
      const topupGoldResult = await client.executeTransaction(
        goldFaucetIdFresh,
        topupGoldReq,
      );
      const topupGoldProven = await client.proveTransaction(topupGoldResult);
      const topupGoldHeight = await client.submitProvenTransaction(
        topupGoldProven,
        topupGoldResult,
      );
      await client.applyTransaction(topupGoldResult, topupGoldHeight);
      log("  GOLD top-up submitted");

      log(`Minting ${FILL_AMOUNT} SILVER to Taker...`);
      const topupSilverReq = client.newMintTransactionRequest(
        toAccountId(takerIdHex),
        silverFaucetIdFresh,
        NoteType.Public,
        FILL_AMOUNT,
      );
      const topupSilverResult = await client.executeTransaction(
        silverFaucetIdFresh,
        topupSilverReq,
      );
      const topupSilverProven =
        await client.proveTransaction(topupSilverResult);
      const topupSilverHeight = await client.submitProvenTransaction(
        topupSilverProven,
        topupSilverResult,
      );
      await client.applyTransaction(topupSilverResult, topupSilverHeight);
      log("  SILVER top-up submitted");

      log("Waiting for top-up mints to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      log("--- Consuming top-up notes ---");
      await consumeAllConsumable(makerIdHex, "Maker");
      await consumeAllConsumable(takerIdHex, "Taker");
      log("Waiting for top-up consumption to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // =========================================================================
      // PHASE 8: Flow 2 - PUBLIC partial fill
      // =========================================================================
      setPhase("create-swapp");
      log("");
      log("============================================================");
      log("PHASE 8: FLOW 2 - CREATE PUBLIC SWAPP NOTE");
      log("============================================================");
      const flow2Swapp = await createSwappNote(
        "Flow 2 (public partial fill)",
        NoteType.Public,
        NOTE_TYPE.PUBLIC,
      );

      setPhase("fill-swapp");
      log("");
      log("============================================================");
      log("PHASE 9: FLOW 2 - PARTIAL FILL (250)");
      log("============================================================");
      const takerReceives = (FILL_AMOUNT * OFFERED_AMOUNT) / REQUESTED_AMOUNT;
      const leftoverOffered = OFFERED_AMOUNT - takerReceives;
      const leftoverRequested = REQUESTED_AMOUNT - FILL_AMOUNT;
      log(`  Fill amount:        ${FILL_AMOUNT} SILVER`);
      log(`  Taker receives:     ${takerReceives} GOLD`);
      log(`  Leftover offered:   ${leftoverOffered} GOLD`);
      log(`  Leftover requested: ${leftoverRequested} SILVER`);
      await executeFill(
        "Flow 2 (public partial fill)",
        flow2Swapp,
        FILL_AMOUNT,
      );

      // =========================================================================
      // PHASE 10: Maker Consumes P2ID Notes
      // =========================================================================
      setPhase("consume-p2id");
      log("");
      log("============================================================");
      log("PHASE 10: MAKER CONSUMES P2ID NOTES");
      log("============================================================");
      log("(P2ID notes should exist from full + partial fills)");

      log("");
      log("Waiting for P2ID note to be consumable (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Get P2ID note for maker
      const makerP2idNotes = await client.getConsumableNotes(
        toAccountId(makerIdHex),
      );
      log(`  Maker has ${makerP2idNotes.length} consumable notes`);

      // Consume P2ID
      if (makerP2idNotes.length > 0) {
        const p2idNoteIds = makerP2idNotes.map((n) =>
          n.inputNoteRecord().toNote(),
        );
        log(`  Consuming P2ID notes: ${p2idNoteIds.join(", ")}`);
        const p2idConsumeReq = client.newConsumeTransactionRequest(p2idNoteIds);
        const p2idConsumeResult = await client.executeTransaction(
          toAccountId(makerIdHex),
          p2idConsumeReq,
        );
        const p2idConsumeProven =
          await client.proveTransaction(p2idConsumeResult);
        const p2idConsumeHeight = await client.submitProvenTransaction(
          p2idConsumeProven,
          p2idConsumeResult,
        );
        await client.applyTransaction(p2idConsumeResult, p2idConsumeHeight);
        log("  Maker consumed P2ID note(s)");
      }

      // =========================================================================
      // PHASE 11: Verify Final Balances
      // =========================================================================
      setPhase("verify");
      log("");
      log("============================================================");
      log("PHASE 11: VERIFY FINAL BALANCES");
      log("============================================================");

      // Get account balances
      const makerAccount = await client.getAccount(toAccountId(makerIdHex));
      const takerAccount = await client.getAccount(toAccountId(takerIdHex));

      if (makerAccount && takerAccount) {
        const makerVault = makerAccount.vault();
        const takerVault = takerAccount.vault();

        const makerAssets = makerVault.fungibleAssets();
        const takerAssets = takerVault.fungibleAssets();

        log("");
        log("=== FINAL BALANCES ===");
        log("");
        log(`  MAKER (${makerIdHex}):`);
        for (const asset of makerAssets) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }

        log("");
        log(`  TAKER (${takerIdHex}):`);
        for (const asset of takerAssets) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      setPhase("done");
      log("");
      log("============================================================");
      log("TEST COMPLETE");
      log("============================================================");
      log("");
      log("KEY VERIFICATION POINTS:");
      log("  1. Flow 1 (PUBLIC): full fill at 1000 completed");
      log("  2. Flow 2 (PUBLIC): partial fill at 250 completed");
      log("  3. Top-up minting/consumption between flows completed");
      log("  4. PSWAP_PRIVATE_MASM NOTE_TYPE_OUTPUT was set to PUBLIC");
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
      console.error("Test error:", error);
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
      <div style={{ maxWidth: "896px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: "bold",
            marginBottom: "16px",
          }}
        >
          PSWAP Full + Partial Flow Test
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          Full-fill then partial-fill using dynamic NOTE_TYPE_OUTPUT
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
            {state.makerId && <div>Maker (PRIVATE): {state.makerId}</div>}
            {state.takerId && <div>Taker (PRIVATE): {state.takerId}</div>}
            {state.pswapNoteId && (
              <div>Latest SWAPP Note: {state.pswapNoteId}</div>
            )}
            {state.p2idNoteId && <div>P2ID Note: {state.p2idNoteId}</div>}
            {state.leftoverNoteId && (
              <div>Leftover Note: {state.leftoverNoteId}</div>
            )}
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
