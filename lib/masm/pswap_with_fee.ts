/**
 * PSWAP-WITH-FEE note script — Miden 0.14 fee-extracting variant.
 *
 * Differences from base PSWAP (`./pswap.ts`):
 * - Storage gains 3 items: FEE_BPS, TREASURY_PREFIX, TREASURY_SUFFIX (18 total).
 * - Scratch addresses start at 24 (not 16) because `active_note::get_storage`
 *   pads writes to the next multiple of 8 — with 18 items it zeroes mem[0..23].
 * - On every fill (partial or full) `execute_SWAPp` computes
 *     fee_amount = floor(taker_a_out * FEE_BPS / 10_000)
 *   reduces taker_a_out by `fee_amount`, and emits a fee P2ID note carrying
 *   `fee_amount` units of token_a to the treasury account. The fee P2ID has a
 *   `NetworkAccountTarget` attachment so a Miden network operator
 *   auto-consumes it into the treasury vault.
 * - Reclaim path is unchanged — no fee on reclaim.
 *
 * Asset conservation (partial fill):
 *   offered_in = taker_net + fee + leftover_offered
 * where taker_net = taker_a_out - fee.
 *
 * Treasury account ID and fee_bps are stored per-note (not hardcoded) so
 * they can be set at create time by the FE / backend without recompiling
 * this MASM.
 *
 * Storage (18 felts, scalar layout):
 *   0-3:   REQUESTED_ASSET_WORD [amount, 0, faucet_suffix, faucet_prefix]
 *   4:     SWAPP_TAG
 *   5:     P2ID_TAG
 *   6-7:   PARENT_SERIAL_LO
 *   8:     SWAP_COUNT
 *   9:     EXPIRATION_BLOCK
 *   10-11: PARENT_SERIAL_HI
 *   12:    CREATOR_PREFIX
 *   13:    CREATOR_SUFFIX
 *   14:    NOTE_TYPE_OUTPUT (1=Public, 2=Private — applied to maker P2ID + leftover)
 *   15:    FEE_BPS               (≤ 500 = 5% — bound enforced in MASM)
 *   16:    TREASURY_PREFIX
 *   17:    TREASURY_SUFFIX
 *
 * Fee P2ID note (always Public, regardless of NOTE_TYPE_OUTPUT_ITEM):
 *   - Serial: poseidon2::merge(active_note_serial, [next_swap_count, 1, 0, 0])
 *     The `1` distinguishes the fee P2ID's serial from the maker payback P2ID's
 *     (which uses [next_swap_count, 0, 0, 0]).
 *   - Storage: [treasury_suffix, treasury_prefix]
 *   - Script: standard P2ID
 *   - Tag: NoteTag::with_account_target(treasury_id)
 *   - Attachment: NetworkAccountTarget(treasury_id, ExecHintTag::Always)
 *
 * Mirror of `lumina-rust-example/examples/pswap_with_fee.masm` — both must
 * move together (same rule as base PSWAP per `pswap-0-14-bugs.md` memory).
 */
export const PSWAP_WITH_FEE_MASM = `
use miden::protocol::active_note
use miden::protocol::active_account
use miden::protocol::note
use miden::protocol::output_note
use miden::protocol::tx
use miden::protocol::asset
use miden::standards::wallets::basic->wallet
use miden::standards::attachments::network_account_target
use miden::core::sys
use miden::core::math::u64

# CONSTANTS
# =================================================================================================

const FACTOR=0x000186A0            # 1e5 — fixed-point scaling for partial-fill math
const MAX_U32=0x0000000100000000   # 2^32 — used to recombine u32-split limbs
const BPS_DENOMINATOR=10000        # bps math: fee = floor(amount * fee_bps / BPS_DENOMINATOR)
const MAX_FEE_BPS=500              # 5% upper bound — prevents accidental ops mistakes
const EXEC_HINT_TAG_ALWAYS=1       # NoteExecutionHint::Always encodes to Felt(1)
const PSWAP_NUM_STORAGE_ITEMS=18

# STORAGE ITEM ADDRESSES (get_storage writes to address 0)
# =================================================================================================

const REQUESTED_AMOUNT_ITEM=0
const REQUESTED_ASSET_PAD_ITEM=1
const REQUESTED_FAUCET_SUFFIX_ITEM=2
const REQUESTED_FAUCET_PREFIX_ITEM=3
const SWAPP_TAG_ITEM=4
const P2ID_TAG_ITEM=5
const PARENT_SERIAL_0_ITEM=6
const PARENT_SERIAL_1_ITEM=7
const SWAP_COUNT_ITEM=8
const EXPIRATION_BLOCK_ITEM=9
const PARENT_SERIAL_2_ITEM=10
const PARENT_SERIAL_3_ITEM=11
const CREATOR_PREFIX_ITEM=12
const CREATOR_SUFFIX_ITEM=13
const NOTE_TYPE_OUTPUT_ITEM=14
const FEE_BPS_ITEM=15
const TREASURY_PREFIX_ITEM=16
const TREASURY_SUFFIX_ITEM=17

# SCRATCH ADDRESSES (scalar)
# =================================================================================================
#
# IMPORTANT: \`active_note::get_storage\` pads writes to the next multiple of 8
# (for \`pipe_double_words_to_memory\`). With PSWAP_NUM_STORAGE_ITEMS=18, it
# zeroes memory[0..23]. Scratch MUST start at 24 to avoid being clobbered.

const AMT_TOKENS_A=24         # offered amount (token_a)
const AMT_TOKENS_B=25         # requested amount (token_b)
const AMT_TOKENS_B_IN=26      # fill amount (token_b_in from note args)
const AMT_TOKENS_A_OUT=27     # taker would receive gross of fee (token_a_out)
const IS_PARTIAL_FILL=28
const TOKEN_A_ID_SUFFIX=29
const TOKEN_A_ID_PREFIX=30
const TOKEN_B_ID_SUFFIX=31
const TOKEN_B_ID_PREFIX=32
const FEE_AMOUNT=33           # floor(taker_a_out * FEE_BPS / 10_000)
const TAKER_NET_AMOUNT=34     # taker_a_out - fee
const FEE_NOTE_IDX=35         # output_note::create return slot for fee P2ID

# Word-aligned scratch (multiples of 4) — past the scalar scratch
# =================================================================================================

const OFFERED_ASSET_PTR=40          # get_assets dumps 2 words here (8 felts: KEY+VALUE)
const P2ID_STORAGE_SCRATCH=48       # 2 felts for P2ID storage commitment scratch

# ERRORS
# =================================================================================================

const ERR_SWAP_WRONG_NUMBER_OF_STORAGE_ITEMS="PSWAP wrong number of storage items"
const ERR_SWAP_WRONG_NUMBER_OF_ASSETS="PSWAP wrong number of assets"
const ERR_INVALID_SWAP_AMOUNT_ZERO="PSWAP zero SWAP amount"
const ERR_SWAP_EXPIRED="PSWAP note expired - only creator can reclaim"
const ERR_OVERPAY="PSWAP overpay - taker received more than offered"
const ERR_OVERFILL="PSWAP overfill - fill exceeds requested amount"
const ERR_ZERO_LEFTOVER_OFFERED="PSWAP zero leftover offered amount"
const ERR_ZERO_LEFTOVER_REQUESTED="PSWAP zero leftover requested amount"
const ERR_FEE_BPS_OUT_OF_RANGE="PSWAP fee_bps exceeds MAX_FEE_BPS (500 = 5%)"

# PRICE CALCULATION
# =================================================================================================

#! Returns the amount of tokens_a out given an amount of tokens_b.
#!
#! Uses fixed-point floor division that always rounds in the maker's favor:
#!   scaled = floor(offered * FACTOR / requested)
#!   a_out  = floor(scaled * fill / FACTOR)
#!
#! Inputs:  [tokens_a, tokens_b, tokens_b_in]
#! Outputs: [tokens_a_out]
#!
proc calculate_tokens_a_for_b
    mem_store.AMT_TOKENS_A
    mem_store.AMT_TOKENS_B
    mem_store.AMT_TOKENS_B_IN

    # scaled = floor(offered * FACTOR / requested)
    mem_load.AMT_TOKENS_A
    u32split

    push.FACTOR
    u32split

    exec.u64::wrapping_mul

    mem_load.AMT_TOKENS_B
    u32split

    exec.u64::div

    # a_out = floor(scaled * fill / FACTOR)
    mem_load.AMT_TOKENS_B_IN
    u32split

    exec.u64::wrapping_mul

    push.FACTOR
    u32split

    exec.u64::div

    # u64::div leaves stack as [hi, lo] with lo at top. Recombine to a single
    # felt as \`hi * 2^32 + lo\` -- swap so hi is at top, then mul/add.
    swap
    push.MAX_U32 mul add
end

# SERIAL NUMBER HELPERS
# =================================================================================================

#! Derives the P2ID serial from the parent PSWAP serial + swap_count word.
#!
#! 0.14 hmerge semantics: [A, B] -> hash(A || B).
#! With [SERIAL_NUM, swap_count_word] on top, hmerge hashes (serial || count).
#! TS side mirrors this with Poseidon2.hashElements([...serial, ...count]).
#!
#! Inputs:  [SERIAL_NUM, swap_count_word, ...]
#! Outputs: [P2ID_SERIAL_NUM, ...]
#!
proc get_p2id_serial_num
    hmerge
end

#! Returns parent_serial with serial[3] incremented by 1.
#! Used to derive the leftover-PSWAP serial so it differs from the original.
#!
#! Inputs:  []
#! Outputs: [NEW_SERIAL_NUM]
#!
proc get_new_swap_serial_num
    exec.active_note::get_serial_number
    push.1
    add
end

#! Increments the in-memory SWAP_COUNT by 1.
proc increment_swap_count
    mem_load.SWAP_COUNT_ITEM
    push.1
    add
    mem_store.SWAP_COUNT_ITEM
end

# CONDITION CHECKS
# =================================================================================================

#! Loads the PSWAP storage items into memory so helpers can scalar-load them.
#! Must be called before any is_consumer_is_creator / is_note_expired / execute_SWAPp.
#!
#! Inputs:  []
#! Outputs: []
#!
proc load_storage_to_memory
    push.0 exec.active_note::get_storage
    # => [num_storage_items, storage_ptr]

    eq.PSWAP_NUM_STORAGE_ITEMS assert.err=ERR_SWAP_WRONG_NUMBER_OF_STORAGE_ITEMS
    # => [storage_ptr]

    drop
    # => []
end

#! Returns 1 if the consuming account matches the PSWAP creator, 0 otherwise.
#!
#! Inputs:  []
#! Outputs: [is_creator]
#!
proc is_consumer_is_creator
    exec.active_account::get_id
    # 0.14: [acct_id_suffix, acct_id_prefix] (suffix at top)

    mem_load.CREATOR_PREFIX_ITEM mem_load.CREATOR_SUFFIX_ITEM
    # => [creator_suffix, creator_prefix, acct_id_suffix, acct_id_prefix]

    movup.2
    # => [acct_id_suffix, creator_suffix, creator_prefix, acct_id_prefix]

    eq
    # => [suffix_eq, creator_prefix, acct_id_prefix]

    if.true
        eq
    else
        drop drop push.0
    end
    # => [is_creator]
end

#! Returns 1 if the note has expired (and the consumer is not the creator).
#!
#! Expired iff expiration_block > 0 AND current_block >= expiration_block.
#!
#! Inputs:  []
#! Outputs: [is_expired]
#!
proc is_note_expired
    mem_load.EXPIRATION_BLOCK_ITEM
    # => [expiration_block]

    dup push.0 eq
    # => [is_zero, expiration_block]

    if.true
        drop push.0
    else
        exec.tx::get_block_number
        # => [current_block, expiration_block]

        swap
        # => [expiration_block, current_block]

        gte
        # => [is_expired]  (current_block >= expiration_block)
    end
end

# RECLAIM
# =================================================================================================

#! Returns the PSWAP's offered asset to the creator's account with no output notes.
#! No fee is collected on reclaim.
#!
#! Inputs:  []
#! Outputs: []
#!
proc handle_reclaim
    push.OFFERED_ASSET_PTR exec.active_note::get_assets
    # => [num_assets, asset_ptr]

    assert.err=ERR_SWAP_WRONG_NUMBER_OF_ASSETS
    # => [asset_ptr]

    drop
    # => []

    # receive_asset needs [ASSET_KEY, ASSET_VALUE, pad(8)] -> build pad first, then load asset on top.
    padw padw
    # => [pad(8)]

    push.OFFERED_ASSET_PTR exec.asset::load
    # => [ASSET_KEY, ASSET_VALUE, pad(8)]

    call.wallet::receive_asset
    # => [pad(16)]

    repeat.4
        dropw
    end
    # => []
end

# MAIN SWAP LOGIC
# =================================================================================================

#! Executes the partial-fill swap with fee extraction:
#! 1. Compute taker_receives based on fill_amount and exact-fill shortcut.
#! 2. Compute fee_amount = floor(taker_a_out * FEE_BPS / 10_000) and taker_net.
#! 3. Send P2ID to maker for fill_amount of requested asset.
#! 4. Receive FULL offered asset into consumer vault.
#! 5. If partial fill: emit a leftover PSWAP note with remaining liquidity.
#! 6. If fee > 0: emit a fee P2ID note targeting the treasury (NetworkAccountTarget).
#!
#! Inputs:  []
#! Outputs: []
#!
proc execute_SWAPp
    # Load offered asset into memory at OFFERED_ASSET_PTR, assert exactly 1 asset
    push.OFFERED_ASSET_PTR exec.active_note::get_assets
    # => [num_assets, asset_ptr]

    assert.err=ERR_SWAP_WRONG_NUMBER_OF_ASSETS
    # => [asset_ptr]

    drop
    # => []

    push.OFFERED_ASSET_PTR exec.asset::load
    # => [ASSET_KEY, ASSET_VALUE]

    exec.asset::fungible_to_amount
    # => [offered_amount, ASSET_KEY, ASSET_VALUE]

    mem_store.AMT_TOKENS_A
    # => [ASSET_KEY, ASSET_VALUE]

    exec.asset::key_to_faucet_id
    # => [token_a_suffix, token_a_prefix, ASSET_KEY, ASSET_VALUE]

    mem_store.TOKEN_A_ID_SUFFIX
    mem_store.TOKEN_A_ID_PREFIX
    # => [ASSET_KEY, ASSET_VALUE]

    dropw dropw
    # => []

    # Extract requested-asset scalars from storage items 0, 2, 3
    mem_load.REQUESTED_AMOUNT_ITEM mem_store.AMT_TOKENS_B
    mem_load.REQUESTED_FAUCET_SUFFIX_ITEM mem_store.TOKEN_B_ID_SUFFIX
    mem_load.REQUESTED_FAUCET_PREFIX_ITEM mem_store.TOKEN_B_ID_PREFIX
    # => []

    # If the taker didn't supply fill_amount via note args, default to their full balance
    mem_load.AMT_TOKENS_B_IN push.0 eq
    # => [no_fill_supplied]

    if.true
        mem_load.TOKEN_B_ID_SUFFIX mem_load.TOKEN_B_ID_PREFIX
        # => [token_b_prefix, token_b_suffix]

        exec.active_account::get_balance
        # => [token_b_balance]

        dup push.0 neq assert.err=ERR_INVALID_SWAP_AMOUNT_ZERO
        # => [token_b_balance]

        mem_store.AMT_TOKENS_B_IN
        # => []
    end
    # => []

    # Exact-fill shortcut: avoid dust from integer rounding
    mem_load.AMT_TOKENS_B_IN mem_load.AMT_TOKENS_B eq
    # => [is_exact_fill]

    if.true
        mem_load.AMT_TOKENS_A
        mem_store.AMT_TOKENS_A_OUT
        push.0 mem_store.IS_PARTIAL_FILL
    else
        mem_load.AMT_TOKENS_B_IN
        mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_A
        # => [offered, requested, fill]

        exec.calculate_tokens_a_for_b
        # => [a_out]

        dup mem_store.AMT_TOKENS_A_OUT
        # => [a_out]

        mem_load.AMT_TOKENS_A
        # => [offered, a_out]

        lt
        # => [is_partial]

        if.true
            push.1 mem_store.IS_PARTIAL_FILL
        else
            push.0 mem_store.IS_PARTIAL_FILL
        end
    end
    # => []

    # Asset-conservation asserts
    mem_load.AMT_TOKENS_A mem_load.AMT_TOKENS_A_OUT
    gte assert.err=ERR_OVERPAY
    # => []

    mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_B_IN
    gte assert.err=ERR_OVERFILL
    # => []

    # --- Fee math: fee = floor(AMT_TOKENS_A_OUT * FEE_BPS / BPS_DENOMINATOR)
    # Mirrors the validated u64 combine pattern from \`calculate_tokens_a_for_b\`:
    # \`u64::div\` returns \`[hi, lo]\` with \`lo\` at top, so swap before mul/add.

    # Bound check on fee_bps (defensive — the FE shouldn't send out-of-range values, but
    # treat the note storage as untrusted input).
    mem_load.FEE_BPS_ITEM
    dup lte.MAX_FEE_BPS assert.err=ERR_FEE_BPS_OUT_OF_RANGE
    u32split

    mem_load.AMT_TOKENS_A_OUT
    u32split

    exec.u64::wrapping_mul

    push.BPS_DENOMINATOR
    u32split

    exec.u64::div

    swap
    push.MAX_U32 mul add
    mem_store.FEE_AMOUNT
    # => []

    # taker_net = AMT_TOKENS_A_OUT - fee  (consumer keeps net amount; fee is moved to treasury below)
    mem_load.AMT_TOKENS_A_OUT mem_load.FEE_AMOUNT sub
    mem_store.TAKER_NET_AMOUNT
    # => []

    # --- 1. P2ID payback to maker for fill_amount of requested asset ------------------------------

    exec.increment_swap_count
    # => []

    # Build P2ID recipient = build_recipient_hash(P2ID_SERIAL, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT)
    #
    # P2ID_SERIAL = hmerge(active_note_serial, [swap_count, 0, 0, 0])
    # P2ID storage = 2 items [creator_suffix, creator_prefix] — compute its commitment via a
    # dedicated scratch region.

    # Write P2ID storage items to scratch at pointer P2ID_STORAGE_SCRATCH (word-aligned)
    mem_load.CREATOR_SUFFIX_ITEM mem_store.P2ID_STORAGE_SCRATCH
    mem_load.CREATOR_PREFIX_ITEM mem_store.49
    # => []

    push.2 push.P2ID_STORAGE_SCRATCH
    # => [storage_ptr=P2ID_STORAGE_SCRATCH, num_items=2]

    exec.note::compute_storage_commitment
    # => [P2ID_STORAGE_COMMITMENT]

    procref.::miden::standards::notes::p2id::main
    # => [P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

    # Build P2ID_SERIAL on stack
    mem_load.SWAP_COUNT_ITEM push.0.0.0
    # => [SWAP_COUNT_WORD, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

    exec.active_note::get_serial_number
    # => [SWAP_SERIAL, SWAP_COUNT_WORD, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

    exec.get_p2id_serial_num
    # => [P2ID_SERIAL, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

    exec.note::build_recipient_hash
    # => [P2ID_RECIPIENT]

    mem_load.NOTE_TYPE_OUTPUT_ITEM
    mem_load.P2ID_TAG_ITEM
    # => [tag, note_type, P2ID_RECIPIENT]

    exec.output_note::create
    # => [note_idx]

    # Move fill_amount of requested asset into the P2ID note
    padw push.0.0.0 dup.7
    # => [note_idx, pad(7), note_idx]

    mem_load.AMT_TOKENS_B_IN
    mem_load.TOKEN_B_ID_PREFIX
    mem_load.TOKEN_B_ID_SUFFIX
    push.0
    exec.asset::create_fungible_asset
    # => [ASSET_KEY, ASSET_VALUE, note_idx, pad(7), note_idx]

    call.wallet::move_asset_to_note
    # => [pad(16), note_idx]

    repeat.4
        dropw
    end
    # => [note_idx]

    drop
    # => []

    # --- 2. Receive the FULL offered asset from the note into the consumer's vault.
    # The taker keeps \`AMT_TOKENS_A_OUT - FEE_AMOUNT\` net; the fee is moved out to
    # the treasury fee P2ID below; any leftover is moved out to the leftover PSWAP.

    padw padw
    # => [pad(8)]

    mem_load.AMT_TOKENS_A
    mem_load.TOKEN_A_ID_PREFIX
    mem_load.TOKEN_A_ID_SUFFIX
    push.0
    exec.asset::create_fungible_asset
    # => [ASSET_KEY, ASSET_VALUE, pad(8)]

    call.wallet::receive_asset
    # => [pad(16)]

    repeat.4
        dropw
    end
    # => []

    # --- 3. If partial fill, emit leftover PSWAP note with remaining liquidity --------------------

    mem_load.IS_PARTIAL_FILL
    # => [is_partial]

    if.true
        # Update storage items for the leftover note (memory is the source of truth for
        # compute_storage_commitment below).
        #
        # Update REQUESTED_AMOUNT_ITEM (slot 0) = requested - fill
        mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_B_IN sub
        # => [leftover_requested]

        dup push.0 gt assert.err=ERR_ZERO_LEFTOVER_REQUESTED
        # => [leftover_requested]

        mem_store.REQUESTED_AMOUNT_ITEM
        # => []

        # Record the current PSWAP serial as the parent for the leftover (provenance)
        exec.active_note::get_serial_number
        # => [serial[3], serial[2], serial[1], serial[0]]

        mem_store.PARENT_SERIAL_3_ITEM
        mem_store.PARENT_SERIAL_2_ITEM
        mem_store.PARENT_SERIAL_1_ITEM
        mem_store.PARENT_SERIAL_0_ITEM
        # => []

        # Compute leftover storage commitment from memory (storage items still at 0..17;
        # leftover preserves FEE_BPS, TREASURY_PREFIX, TREASURY_SUFFIX so subsequent fills
        # keep collecting fees on the same terms).
        push.PSWAP_NUM_STORAGE_ITEMS push.0
        # => [storage_ptr=0, num_items=18]

        exec.note::compute_storage_commitment
        # => [LEFTOVER_STORAGE_COMMITMENT]

        exec.active_note::get_script_root
        # => [SCRIPT_ROOT, LEFTOVER_STORAGE_COMMITMENT]

        exec.get_new_swap_serial_num
        # => [LEFTOVER_SERIAL, SCRIPT_ROOT, LEFTOVER_STORAGE_COMMITMENT]

        exec.note::build_recipient_hash
        # => [LEFTOVER_RECIPIENT]

        mem_load.NOTE_TYPE_OUTPUT_ITEM
        mem_load.SWAPP_TAG_ITEM
        # => [tag, note_type, LEFTOVER_RECIPIENT]

        exec.output_note::create
        # => [note_idx]

        # Move leftover_offered of offered asset into the new PSWAP note
        padw push.0.0.0 dup.7
        # => [note_idx, pad(7), note_idx]

        mem_load.AMT_TOKENS_A mem_load.AMT_TOKENS_A_OUT sub
        # => [leftover_offered, note_idx, pad(7), note_idx]

        dup push.0 gt assert.err=ERR_ZERO_LEFTOVER_OFFERED
        # => [leftover_offered, note_idx, pad(7), note_idx]

        mem_load.TOKEN_A_ID_PREFIX
        mem_load.TOKEN_A_ID_SUFFIX
        push.0
        exec.asset::create_fungible_asset
        # => [ASSET_KEY, ASSET_VALUE, note_idx, pad(7), note_idx]

        call.wallet::move_asset_to_note
        # => [pad(16), note_idx]

        repeat.4
            dropw
        end
        # => [note_idx]

        drop
        # => []
    end

    # --- 4. Fee P2ID to treasury with NetworkAccountTarget attachment ------------------------------
    # Skipped if fee is zero (e.g. fee_bps=0 or amounts too small to extract a unit).
    # The treasury is a Network-mode account, so the operator auto-consumes the fee
    # P2ID and the asset accumulates in the treasury vault without manual consume.

    mem_load.FEE_AMOUNT push.0 neq
    # => [fee_nonzero]

    if.true
        # P2ID storage = [treasury_suffix, treasury_prefix] at the same P2ID
        # scratch pointer used for the maker payback above. Reuse is safe — by
        # this point the maker P2ID has already been emitted and the scratch
        # is no longer referenced.
        mem_load.TREASURY_SUFFIX_ITEM mem_store.P2ID_STORAGE_SCRATCH
        mem_load.TREASURY_PREFIX_ITEM mem_store.49
        # => []

        push.2 push.P2ID_STORAGE_SCRATCH
        # => [storage_ptr=P2ID_STORAGE_SCRATCH, num_items=2]

        exec.note::compute_storage_commitment
        # => [P2ID_STORAGE_COMMITMENT]

        procref.::miden::standards::notes::p2id::main
        # => [P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

        # Fee P2ID serial = hmerge(active_note_serial, [swap_count, 1, 0, 0])
        # The "1" in the second slot distinguishes the fee P2ID's serial from the
        # maker payback P2ID's (which uses [swap_count, 0, 0, 0]). Recipient hashes
        # would already differ via storage, but using distinct serials keeps every
        # output note's identity well-isolated from the maker payback.
        mem_load.SWAP_COUNT_ITEM push.1 push.0.0
        # => [SWAP_COUNT_FEE_WORD, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

        exec.active_note::get_serial_number
        # => [SWAP_SERIAL, SWAP_COUNT_FEE_WORD, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

        hmerge
        # => [FEE_P2ID_SERIAL, P2ID_SCRIPT_ROOT, P2ID_STORAGE_COMMITMENT]

        exec.note::build_recipient_hash
        # => [FEE_P2ID_RECIPIENT]

        # Fee P2ID is ALWAYS NoteType::Public (=1) regardless of
        # NOTE_TYPE_OUTPUT_ITEM. Network operators only consume Public notes
        # carrying NetworkAccountTarget; a Private fee note would never be
        # auto-consumed into the treasury vault.
        push.1
        mem_load.P2ID_TAG_ITEM
        # => [tag, note_type=Public, FEE_P2ID_RECIPIENT]

        exec.output_note::create
        # => [note_idx]

        mem_store.FEE_NOTE_IDX
        # => []

        # Set NetworkAccountTarget attachment so the network operator auto-consumes
        # this note into the treasury network account.
        push.EXEC_HINT_TAG_ALWAYS
        mem_load.TREASURY_PREFIX_ITEM
        mem_load.TREASURY_SUFFIX_ITEM
        # => [suffix, prefix, exec_hint_tag]

        exec.network_account_target::new
        # => [scheme, kind, ATTACHMENT]

        mem_load.FEE_NOTE_IDX
        # => [note_idx, scheme, kind, ATTACHMENT]

        exec.output_note::set_attachment
        # => []

        # Move FEE_AMOUNT of token_a from consumer's vault into the fee P2ID note
        mem_load.FEE_NOTE_IDX
        # => [note_idx]

        padw push.0.0.0 dup.7
        # => [note_idx, pad(7), note_idx]

        mem_load.FEE_AMOUNT
        mem_load.TOKEN_A_ID_PREFIX
        mem_load.TOKEN_A_ID_SUFFIX
        push.0
        exec.asset::create_fungible_asset
        # => [ASSET_KEY, ASSET_VALUE, note_idx, pad(7), note_idx]

        call.wallet::move_asset_to_note
        # => [pad(16), note_idx]

        repeat.4
            dropw
        end
        # => [note_idx]

        drop
        # => []
    end

    exec.sys::truncate_stack
end

# ENTRY POINT
# =================================================================================================

@note_script
@locals(0)
pub proc main
    # => [NOTE_ARGS]

    # fill_amount is note_args[3] (top after the previous three elements).
    # Our existing TS builds note_args as [0, 0, 0, fill_amount] -> on stack top to bottom that's
    # [fill_amount, 0, 0, 0]. Store fill_amount and drop the rest.
    mem_store.AMT_TOKENS_B_IN drop drop drop
    # => []

    exec.load_storage_to_memory
    # => []

    exec.is_consumer_is_creator
    # => [is_creator]

    if.true
        exec.handle_reclaim
    else
        exec.is_note_expired
        # => [is_expired]

        if.true
            push.0 assert.err=ERR_SWAP_EXPIRED
        else
            exec.execute_SWAPp
        end
    end
end
`;

/**
 * Maximum fee in basis points enforced by the MASM. Mirrored here so the FE
 * can validate user input before submitting to avoid kernel reverts.
 *
 * 500 bps = 5%.
 */
export const PSWAP_WITH_FEE_MAX_BPS = 500;
