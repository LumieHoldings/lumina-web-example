"use client";

/**
 * Full end-to-end fee-PSWAP creation test.
 *
 * Flow:
 *   1. Spin up MidenClient on testnet (fresh per click).
 *   2. Create GOLD + SILVER faucets, maker wallet, fake treasury wallet.
 *   3. Mint 1000 GOLD to maker and consume the mint note.
 *   4. Compile PSWAP-with-fee MASM.
 *   5. Build the 18-storage-item note (offered=1000 GOLD, requested=500 SILVER,
 *      fee=50 bps, treasury=fake treasury wallet).
 *   6. Submit via `client.transactions.submit(maker, request)`.
 *   7. Log the note id on success.
 *
 * "Treasury" here is just a placeholder MutableWallet — we're testing the
 * maker-side note construction, not the auto-consume path.
 */

import { useCallback, useState } from "react";
import { PSWAP_WITH_FEE_MASM } from "@/lib/masm/pswap_with_fee";

const OFFERED_AMOUNT = BigInt(1000);
const REQUESTED_AMOUNT = BigInt(500);
const FILL_AMOUNT = BigInt(200);
const FEE_BPS = BigInt(50);
const BPS_DENOMINATOR = BigInt(10000);

// Expected derived amounts for partial fill (200/500):
//   gross = (200 * 1000) / 500 = 400 GOLD
//   fee   = floor(400 * 50 / 10_000) = 2 GOLD
//   net   = 400 - 2 = 398 GOLD (to taker)
//   leftover_gold     = 1000 - 400 = 600 (carried in leftover PSWAP)
//   leftover_silver   = 500 - 200 = 300 (requested in leftover PSWAP)

export default function FeeSwapCreatePage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const append = (line: string) =>
    setLog((prev) => [
      ...prev,
      `${new Date().toISOString().slice(11, 23)} ${line}`,
    ]);

  const handleRun = useCallback(async () => {
    setLog([]);
    setRunning(true);
    try {
      append(`Loading SDK…`);
      const sdk = await import("@miden-sdk/miden-sdk");
      const {
        MidenClient,
        AccountType,
        AccountId,
        Note,
        NoteAndArgs,
        NoteAndArgsArray,
        NoteAssets,
        NoteDetails,
        NoteDetailsAndTag,
        NoteDetailsAndTagArray,
        NoteMetadata,
        NoteRecipient,
        NoteRecipientArray,
        NoteScript,
        NoteStorage,
        NoteTag,
        NoteType,
        Poseidon2,
        TransactionRequestBuilder,
        FungibleAsset,
        Felt,
        Word,
        MidenArrays,
      } = sdk as unknown as Record<string, any>;
      const asId = (hex: string) => AccountId.fromHex(hex);

      const storeName = `fee-swap-create-${Date.now()}`;
      append(`Creating MidenClient.createTestnet (store=${storeName})…`);
      const client = await MidenClient.createTestnet({ storeName });
      await client.sync();
      append(`Synced. Block=${await client.getSyncHeight()}`);

      // ── Phase 1: faucets ────────────────────────────────────────────
      append(`Creating GOLD faucet…`);
      const goldFaucet = await client.accounts.create({
        type: AccountType.FungibleFaucet,
        symbol: "GOLD",
        decimals: 0,
        maxSupply: 1_000_000_000n,
        storage: "public",
      });
      const goldFaucetHex = goldFaucet.id().toString();
      append(`GOLD faucet id: ${goldFaucetHex}`);

      append(`Creating SILVER faucet…`);
      const silverFaucet = await client.accounts.create({
        type: AccountType.FungibleFaucet,
        symbol: "SILVER",
        decimals: 0,
        maxSupply: 1_000_000_000n,
        storage: "public",
      });
      const silverFaucetHex = silverFaucet.id().toString();
      append(`SILVER faucet id: ${silverFaucetHex}`);

      // ── Phase 2: wallets ────────────────────────────────────────────
      append(`Creating maker wallet…`);
      const maker = await client.accounts.create({
        type: AccountType.MutableWallet,
        storage: "public",
      });
      const makerHex = maker.id().toString();
      append(`Maker id: ${makerHex}`);

      append(`Creating placeholder treasury wallet…`);
      const treasury = await client.accounts.create({
        type: AccountType.MutableWallet,
        storage: "public",
      });
      const treasuryHex = treasury.id().toString();
      append(`Treasury id: ${treasuryHex}`);

      // ── Phase 3: mint + consume so maker holds 1000 GOLD ────────────
      append(`Minting ${OFFERED_AMOUNT} GOLD to maker…`);
      await client.transactions.mint({
        account: asId(goldFaucetHex),
        to: asId(makerHex),
        amount: OFFERED_AMOUNT,
        type: "public",
        waitForConfirmation: true,
      });
      await client.sync();
      append(`Consuming consumable mint notes for maker…`);
      const consumed = await client.transactions.consumeAll({
        account: asId(makerHex),
        waitForConfirmation: true,
      });
      append(`Consumed mint notes. Remaining: ${consumed?.remaining ?? "?"}`);
      await client.sync();

      // ── Phase 4: compile fee MASM ───────────────────────────────────
      append(`Compiling PSWAP-with-fee MASM…`);
      const pswapScript = await client.compile.noteScript({
        code: PSWAP_WITH_FEE_MASM,
      });
      append(`Script root: ${pswapScript.root().toHex()}`);

      // ── Phase 5: build 18-storage-item note ────────────────────────
      append(`Building fee PSWAP note (18 storage items)…`);
      // Match pswap_with_fee_mockchain.rs: maker PSWAP, maker P2ID, and
      // leftover PSWAP are all Private. Only the fee P2ID (emitted by MASM
      // with fixed NoteType::Public) needs its recipient registered in the
      // advice provider so the kernel's before_created event can validate.
      const noteTypeValue = NoteType.Private;

      // Resolve prefix/suffix from fresh AccountId instances. Each call
      // creates+drops the WASM proxy in-line to avoid aliasing reuse.
      // All these are plain BigInts/numbers — safe to reuse across phases.
      const silverPrefix = BigInt(asId(silverFaucetHex).prefix().asInt());
      const silverSuffix = BigInt(asId(silverFaucetHex).suffix().asInt());
      const makerPrefix = BigInt(asId(makerHex).prefix().asInt());
      const makerSuffix = BigInt(asId(makerHex).suffix().asInt());
      const treasuryPrefix = BigInt(asId(treasuryHex).prefix().asInt());
      const treasurySuffix = BigInt(asId(treasuryHex).suffix().asInt());

      // Capture u32 tag values as plain numbers BEFORE the WASM tag objects
      // get moved into NoteMetadata. Same value used in storage + consume.
      const swappTagU32 = NoteTag.withAccountTarget(asId(makerHex)).asU32();
      const p2idTagU32 = NoteTag.withAccountTarget(asId(makerHex)).asU32();

      // Pre-pick a serial as plain BigInts. Each Note build re-wraps in Word.
      const serialBuf = new BigUint64Array(4);
      crypto.getRandomValues(serialBuf);
      const swapSerialU64s = [
        serialBuf[0],
        serialBuf[1],
        serialBuf[2],
        serialBuf[3],
      ];

      // Helper: build a fresh Note from plain bigint inputs. Every WASM
      // object inside (Felts, FeltArray, NoteStorage, FungibleAsset,
      // NoteAssets, NoteMetadata, NoteScript, NoteRecipient, Note) is
      // constructed new each call so the maker submit and the consume input
      // can both have live handles. NoteScript also has to be re-compiled.
      const buildMakerPswapNote = async () => {
        const script = await client.compile.noteScript({
          code: PSWAP_WITH_FEE_MASM,
        });
        const items = [
          new Felt(REQUESTED_AMOUNT),
          new Felt(0n),
          new Felt(silverSuffix),
          new Felt(silverPrefix),
          new Felt(BigInt(swappTagU32)),
          new Felt(BigInt(p2idTagU32)),
          new Felt(0n), new Felt(0n), // PARENT_SERIAL_LO
          new Felt(0n),               // SWAP_COUNT
          new Felt(0n),               // EXPIRATION_BLOCK
          new Felt(0n), new Felt(0n), // PARENT_SERIAL_HI
          new Felt(makerPrefix),
          new Felt(makerSuffix),
          new Felt(BigInt(noteTypeValue)),
          new Felt(FEE_BPS),
          new Felt(treasuryPrefix),
          new Felt(treasurySuffix),
        ];
        const storage = new NoteStorage(new MidenArrays.FeltArray(items));
        const assets = new NoteAssets([
          new FungibleAsset(asId(goldFaucetHex), OFFERED_AMOUNT),
        ]);
        const metadata = new NoteMetadata(
          asId(makerHex),
          noteTypeValue,
          NoteTag.withAccountTarget(asId(makerHex)),
        );
        const serial = new Word(new BigUint64Array(swapSerialU64s));
        const rcpt = new NoteRecipient(serial, script, storage);
        return new Note(assets, metadata, rcpt);
      };

      const makerNoteForSubmit = await buildMakerPswapNote();
      const expectedNoteId = makerNoteForSubmit.id().toString();
      append(`Built note. Expected note id: ${expectedNoteId}`);

      // ── Phase 6: register tags + submit ────────────────────────────
      append(`Registering note tags before submit…`);
      await client.tags.add(swappTagU32);

      append(`Submitting via client.transactions.submit(maker, req)…`);
      const submitReq = new TransactionRequestBuilder()
        .withOwnOutputNotes(new MidenArrays.NoteArray([makerNoteForSubmit]))
        .build();
      await client.transactions.submit(asId(makerHex), submitReq, {
        waitForConfirmation: true,
      });
      append(`Maker PSWAP submitted. Note id: ${expectedNoteId}`);
      await client.sync();

      // ── Phase 7: create taker wallet, mint SILVER, consume mint ─────
      append("");
      append(`=== TAKER SIDE ===`);
      append(`Creating taker wallet…`);
      const taker = await client.accounts.create({
        type: AccountType.MutableWallet,
        storage: "public",
      });
      const takerHex = taker.id().toString();
      append(`Taker id: ${takerHex}`);

      append(`Minting ${REQUESTED_AMOUNT} SILVER to taker…`);
      await client.transactions.mint({
        account: asId(silverFaucetHex),
        to: asId(takerHex),
        amount: REQUESTED_AMOUNT,
        type: "public",
        waitForConfirmation: true,
      });
      await client.sync();
      await client.transactions.consumeAll({
        account: asId(takerHex),
        waitForConfirmation: true,
      });
      await client.sync();
      append(`Taker has SILVER.`);

      // ── Phase 8: build consume request with all 3 expected outputs ─
      append("");
      append(`Computing expected outputs for partial fill of ${FILL_AMOUNT}…`);
      const grossTakerOut = (FILL_AMOUNT * OFFERED_AMOUNT) / REQUESTED_AMOUNT;
      const feeAmount = (grossTakerOut * FEE_BPS) / BPS_DENOMINATOR;
      const takerNet = grossTakerOut - feeAmount;
      const leftoverOffered = OFFERED_AMOUNT - grossTakerOut;
      const leftoverRequested = REQUESTED_AMOUNT - FILL_AMOUNT;
      append(`Expected: gross=${grossTakerOut} fee=${feeAmount} net=${takerNet} leftoverGold=${leftoverOffered} leftoverSilver=${leftoverRequested}`);

      const nextSwapCount = BigInt(1);
      // WASM Felts are move-once — every FeltArray construction must wrap a
      // fresh set; reusing the same Felt instances triggers
      // `array contains a value of the wrong type`.
      const freshSerialFelts = () => swapSerialU64s.map((u) => new Felt(u));

      // Maker P2ID serial: poseidon2.hashElements([swap_serial, next_count, 0, 0, 0])
      const makerP2idSerial = Poseidon2.hashElements(
        new MidenArrays.FeltArray([
          ...freshSerialFelts(),
          new Felt(nextSwapCount),
          new Felt(0n),
          new Felt(0n),
          new Felt(0n),
        ]),
      );

      // Fee P2ID serial: poseidon2.hashElements([swap_serial, 0, 0, 1, next_count])
      const feeP2idSerial = Poseidon2.hashElements(
        new MidenArrays.FeltArray([
          ...freshSerialFelts(),
          new Felt(0n),
          new Felt(0n),
          new Felt(1n),
          new Felt(nextSwapCount),
        ]),
      );

      // Maker P2ID expected note
      const p2idScript = NoteScript.p2id();
      const makerP2idStorage = new NoteStorage(
        new MidenArrays.FeltArray([
          new Felt(makerSuffix),
          new Felt(makerPrefix),
        ]),
      );
      const makerP2idRecipient = new NoteRecipient(
        makerP2idSerial,
        p2idScript,
        makerP2idStorage,
      );
      const makerP2idAsset = new FungibleAsset(
        asId(silverFaucetHex),
        FILL_AMOUNT,
      );
      const makerP2idAssets = new NoteAssets([makerP2idAsset]);
      const makerP2idTag = NoteTag.withAccountTarget(asId(makerHex));
      const makerP2idDetails = new NoteDetails(makerP2idAssets, makerP2idRecipient);
      const makerP2idDetailsAndTag = new NoteDetailsAndTag(makerP2idDetails, makerP2idTag);

      // Fee P2ID expected note (always Public, no attachment in expected — MASM
      // sets attachment via output_note::set_attachment AFTER create, so the
      // expected metadata mirrors create-time state only)
      const feeP2idStorage = new NoteStorage(
        new MidenArrays.FeltArray([
          new Felt(treasurySuffix),
          new Felt(treasuryPrefix),
        ]),
      );
      const feeP2idRecipient = new NoteRecipient(
        feeP2idSerial,
        NoteScript.p2id(),
        feeP2idStorage,
      );
      const feeP2idAsset = new FungibleAsset(asId(goldFaucetHex), feeAmount);
      const feeP2idAssets = new NoteAssets([feeP2idAsset]);
      const feeP2idTag = NoteTag.withAccountTarget(asId(treasuryHex));
      const feeP2idDetails = new NoteDetails(feeP2idAssets, feeP2idRecipient);
      const feeP2idDetailsAndTag = new NoteDetailsAndTag(feeP2idDetails, feeP2idTag);

      // Leftover PSWAP expected note: serial = parent_serial with [3]+1
      const leftoverSerialNum = new Word(
        new BigUint64Array([
          swapSerialU64s[0],
          swapSerialU64s[1],
          swapSerialU64s[2],
          swapSerialU64s[3] + 1n,
        ]),
      );
      const leftoverStorageItems = [
        new Felt(leftoverRequested),
        new Felt(0n),
        new Felt(silverSuffix),
        new Felt(silverPrefix),
        new Felt(BigInt(swappTagU32)),
        new Felt(BigInt(p2idTagU32)),
        new Felt(swapSerialU64s[0]), // PARENT_SERIAL_LO[0]
        new Felt(swapSerialU64s[1]), // PARENT_SERIAL_LO[1]
        new Felt(nextSwapCount),     // SWAP_COUNT
        new Felt(0n),                // EXPIRATION_BLOCK
        new Felt(swapSerialU64s[2]), // PARENT_SERIAL_HI[0]
        new Felt(swapSerialU64s[3]), // PARENT_SERIAL_HI[1]
        new Felt(makerPrefix),
        new Felt(makerSuffix),
        new Felt(BigInt(noteTypeValue)),
        new Felt(FEE_BPS),
        new Felt(treasuryPrefix),
        new Felt(treasurySuffix),
      ];
      const leftoverStorage = new NoteStorage(
        new MidenArrays.FeltArray(leftoverStorageItems),
      );
      const leftoverPswapScript = await client.compile.noteScript({
        code: PSWAP_WITH_FEE_MASM,
      });
      const leftoverRecipient = new NoteRecipient(
        leftoverSerialNum,
        leftoverPswapScript,
        leftoverStorage,
      );
      const leftoverAsset = new FungibleAsset(asId(goldFaucetHex), leftoverOffered);
      const leftoverAssets = new NoteAssets([leftoverAsset]);
      const leftoverTag = NoteTag.withAccountTarget(asId(makerHex));
      const leftoverDetails = new NoteDetails(leftoverAssets, leftoverRecipient);
      const leftoverDetailsAndTag = new NoteDetailsAndTag(leftoverDetails, leftoverTag);

      // Note args: [fill_amount, 0, 0, 0]. Matches pswap_with_fee_mockchain.rs
      // `fill_args` — index 0 is the top of the stack when the kernel pushes
      // NOTE_ARGS, so MASM's `mem_store.AMT_TOKENS_B_IN` reads fill_amount.
      const noteArgs = new Word(
        new BigUint64Array([FILL_AMOUNT, 0n, 0n, 0n]),
      );

      append(`Building consume request — only fee P2ID needs recipient registered (Public)…`);
      const makerNoteForConsume = await buildMakerPswapNote();
      const consumeReq = new TransactionRequestBuilder()
        .withInputNotes(
          new NoteAndArgsArray([new NoteAndArgs(makerNoteForConsume, noteArgs)]),
        )
        .withExpectedOutputRecipients(
          new NoteRecipientArray([feeP2idRecipient]),
        )
        .build();

      append(`Submitting consume tx (taker)…`);
      const consumeResult = await client.transactions.submit(
        asId(takerHex),
        consumeReq,
        { waitForConfirmation: true },
      );
      append(`✅ Consume submitted. txId=${consumeResult.txId.toHex()}`);

      // ── Phase 9: verify output notes directly from the executed tx ─
      // Mirrors pswap_with_fee_mockchain.rs — inspect executed.output_notes()
      // and identify each by asset shape rather than querying getBalance
      // (which requires a freshly-synced Merkle witness for the account).
      append("");
      append(`=== VERIFY (executed tx output notes) ===`);
      const executed = consumeResult.result.executedTransaction();
      const outputs = executed.outputNotes();
      const outCount = outputs.numNotes();
      append(`Output note count: ${outCount} (expected 3)`);

      const notesArr = outputs.notes();
      let found = { makerP2id: false, feeP2id: false, leftover: false };
      let feeNoteIdHex: string | null = null;
      for (let i = 0; i < notesArr.length; i++) {
        const note = notesArr[i];
        const id = note.id().toString();
        const assets = note.assets();
        const fungibles = assets ? assets.fungibleAssets() : [];
        const lines = fungibles.map((fa) => {
          const fId = fa.faucetId().toString();
          const symbol =
            fId === goldFaucetHex ? "GOLD"
            : fId === silverFaucetHex ? "SILVER"
            : fId.slice(0, 10) + "…";
          return `${symbol}=${fa.amount()}`;
        }).join(", ");
        const meta = note.metadata();
        append(`  [${i}] id=${id.slice(0, 22)}… assets=[${lines}] type=${meta.noteType()}`);

        for (const fa of fungibles) {
          const fId = fa.faucetId().toString();
          const amt = fa.amount();
          if (fId === silverFaucetHex && amt === FILL_AMOUNT) found.makerP2id = true;
          if (fId === goldFaucetHex && amt === feeAmount) {
            found.feeP2id = true;
            feeNoteIdHex = id;
          }
          if (fId === goldFaucetHex && amt === leftoverOffered) found.leftover = true;
        }
      }

      append("");
      append(`Maker P2ID (SILVER ${FILL_AMOUNT}): ${found.makerP2id ? "✅" : "❌"}`);
      append(`Fee P2ID   (GOLD ${feeAmount}):   ${found.feeP2id ? "✅" : "❌"}`);
      append(`Leftover   (GOLD ${leftoverOffered}): ${found.leftover ? "✅" : "❌"}`);

      const allOk = outCount === 3 && found.makerP2id && found.feeP2id && found.leftover;
      append(allOk ? "✅ Partial fill emitted all 3 expected notes" : "❌ Output mismatch");

      // ── Phase 10: treasury consumes the fee P2ID ─────────────────
      // Real flow: a network operator with the treasury account auto-consumes
      // the fee P2ID via its NetworkAccountTarget attachment. For this test,
      // we manually consume it from the treasury wallet to prove the +2 GOLD
      // credit lands.
      if (feeNoteIdHex) {
        append("");
        append(`=== FEE CONSUME ===`);
        append(`Fee note id: ${feeNoteIdHex}`);

        // Fee P2ID is tagged with NoteTag::withAccountTarget(maker) per MASM.
        // We already registered swappTagU32 (== p2idTagU32 in this setup), so
        // sync should pick it up. Sync a few times to give the network time
        // to commit and our local store to fetch the note + witness.
        for (let i = 0; i < 3; i++) {
          await client.sync();
          await new Promise((r) => setTimeout(r, 1500));
        }
        append(`Synced. Attempting treasury consumeAll…`);

        const feeConsume = await client.transactions.consumeAll({
          account: asId(treasuryHex),
          waitForConfirmation: true,
        });
        append(`Treasury consumed ${feeConsume.consumed} note(s), ${feeConsume.remaining} remaining.`);

        if (feeConsume.result) {
          const feeExec = feeConsume.result.executedTransaction();
          const delta = feeExec.accountDelta();
          const vault = delta.vault();
          const added = vault.addedFungibleAssets();
          append(`Treasury vault added ${added.length} asset(s):`);
          let treasuryGotFee = false;
          for (const fa of added) {
            const fId = fa.faucetId().toString();
            const symbol = fId === goldFaucetHex ? "GOLD"
              : fId === silverFaucetHex ? "SILVER"
              : fId.slice(0, 10) + "…";
            const amt = fa.amount();
            append(`  +${amt} ${symbol} (faucet=${fId})`);
            if (fId === goldFaucetHex && amt === feeAmount) treasuryGotFee = true;
          }
          append(treasuryGotFee
            ? `✅ Treasury vault credited with ${feeAmount} GOLD from fee P2ID`
            : `❌ Treasury did not receive expected ${feeAmount} GOLD`);
        } else {
          append(`❌ No tx result from treasury consumeAll`);
        }
      } else {
        append(`(skipping fee consume — fee note id not captured)`);
      }

      append(`Done.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? err.stack : "";
      append(`❌ ${msg}`);
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
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <h1>Fee PSWAP — full create test</h1>
      <p style={{ color: "#555", fontSize: 14, lineHeight: 1.5 }}>
        End-to-end: spin a fresh MidenClient, create faucets + wallets, mint
        GOLD, compile the fee MASM, build an 18-storage-item PSWAP note, and
        submit it. Treasury is a placeholder MutableWallet. Each click uses a
        fresh store.
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
        {running ? "Running…" : "Run create"}
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
          minHeight: 320,
        }}
      >
        {log.length === 0 ? "(click Run create)" : log.join("\n")}
      </pre>
    </div>
  );
}
