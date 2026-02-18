/**
 * PSWAP note script used by the current web tests.
 *
 * Current behavior:
 * 1. Expects 14 note inputs.
 * 2. Uses hardcoded `PUBLIC_NOTE` for output note creation.
 * 3. Supports full fills and partial fills (with leftover PSWAP note).
 *
 * Inputs (14 felts):
 *   0-3:   REQUESTED_ASSET_WORD [amount, 0, suffix, prefix] (FungibleAsset format)
 *   4:     SWAPP_TAG - NoteTag for the SWAPP note (for discoverability)
 *   5:     P2ID_TAG - NoteTag for P2ID payback notes to creator
 *   6-7:   PARENT_SERIAL_0..1 (or zero for root PSWAP)
 *   8:     SWAP_COUNT
 *   9:     EXPIRATION_BLOCK (0 = no expiration)
 *   10-11: PARENT_SERIAL_2..3 (or zero for root PSWAP)
 *   12:    CREATOR_PREFIX
 *   13:    CREATOR_SUFFIX
 *
 * Note args:
 *   [0, 0, 0, fill_amount]
 *
 * Outputs:
 *   - Reclaim path: assets returned to creator
 *   - Partial fill: P2ID note to creator + leftover PSWAP note
 *   - Full fill: P2ID note only (no leftover)
 *
 * Note: The constant name `PSWAP_PRIVATE_MASM` is legacy; this script currently
 * emits PUBLIC output notes via `push.PUBLIC_NOTE`.
 */
export const PSWAP_MASM = `
use miden::protocol::active_note
use miden::protocol::output_note
use miden::protocol::note
use miden::standards::wallets::basic->wallet
use miden::core::sys
use miden::protocol::active_account
use miden::core::math::u64
use miden::protocol::tx
use miden::core::crypto::hashes::rpo256

# CONSTANTS
# =================================================================================================

const PUBLIC_NOTE = 1
const EXECUTION_HINT_ALWAYS = 1
const FACTOR = 0x000186A0 # 1e5
const MAX_U32 = 0x0000000100000000

# Memory Addresses
# =================================================================================================

# Memory Address Layout:
# - PSWAP Note Inputs: General input addresses (0 - 0xD)
# - Reserved Input Memory Addresses: 0 to 40 (not explicitly listed)
# - Price Calculation Procedure: Addresses 41 to 60 (0x29 to 0x2D)
# - TokenId Addresses: Addresses 60 to 70 (0x2D to 0x30)
# - Boolean Addresses: Addresses 70 to 80 (0x35)
# - Full Word Addresses: Addresses 80 to 120, must be divisible by 4 (0x50 to 0x64)

# PSWAP Note Inputs (0 to 40)
const REQUESTED_ASSET_WORD_INPUT = 0x0000
const REQUESTED_ASSET_INPUT_1 = 0x0001
const REQUESTED_ASSET_INPUT_2 = 0x0002
const REQUESTED_ASSET_INPUT_3 = 0x0003
const SWAPP_TAG_INPUT = 0x0004
const P2ID_TAG_INPUT = 0x0005
# Parent serial number for audit trail (slots 6-7 and 10-11)
# These store the serial number of the parent note (or zeros for root PSWAP)
const PARENT_SERIAL_0 = 0x0006  # serial[0] - bottom of original word
const PARENT_SERIAL_1 = 0x0007  # serial[1]
const SWAPP_COUNT_INPUT = 0x0008
const EXPIRATION_BLOCK_INPUT = 0x0009  # Block number after which only creator can reclaim (0 = no expiration)
const PARENT_SERIAL_2 = 0x000A  # serial[2]
const PARENT_SERIAL_3 = 0x000B  # serial[3] - top of original word
const SWAPP_CREATOR_PREFIX_INPUT = 0x000C
const SWAPP_CREATOR_SUFFIX_INPUT = 0x000D

# RESERVED INPUT MEMORY ADDRESSES 0 to 40

# Memory Addresses for Price Calculation Procedure (41 to 60)
const AMT_TOKENS_A = 0x0028
const AMT_TOKENS_B = 0x0029
const AMT_TOKENS_B_IN = 0x002A
const AMT_TOKENS_A_OUT = 0x002B
const RATIO = 0x002C

# TokenId Memory Addresses (60 to 70)
const TOKEN_A_ID_PREFIX = 0x002D
const TOKEN_A_ID_SUFFIX = 0x002E
const TOKEN_B_ID_PREFIX = 0x002F
const TOKEN_B_ID_SUFFIX = 0x0030

# Boolean Memory Addresses (70 to 80)
const IS_PARTIAL_FILL = 0x0035

# Full Word Memory Addresses (80 to 120, must be divisible by 4)
const SWAPP_SCRIPT_HASH_WORD = 0x0050
const P2ID_SCRIPT_ROOT_WORD = 0x0054
const SWAP_SERIAL_NUM_WORD = 0x0058
const P2ID_SERIAL_NUM_WORD = 0x005C
const P2ID_OUTPUT_RECIPIENT_WORD = 0x0060
const OFFERED_ASSET_WORD = 0x0064

# Temporary Memory Addresses

const NEW_ASSET_A = 0x0078

# ERRORS
# =================================================================================================

# SWAP script expects exactly 9 note inputs
const ERR_SWAP_WRONG_NUMBER_OF_INPUTS = "PSWAP wrong number of inputs"

# SWAP script requires exactly one note asset
const ERR_SWAP_WRONG_NUMBER_OF_ASSETS = "PSWAP wrong number of assets"

# SWAP amount must not exceed 184467440694145
const ERR_INVALID_SWAP_AMOUNT = "PSWAP invalid SWAP amount"

# SWAPp amount must not be 0
const ERR_INVALID_SWAP_AMOUNT_ZERO = "PSWAP zero SWAP amount"

# SWAP note has expired - only creator can reclaim
const ERR_SWAP_EXPIRED = "PSWAP note expired - only creator can reclaim"

# PRICE CALCULATION
# =================================================================================================

#! Returns the amount of tokens_a out given an amount of tokens_b
#!
#! Inputs: [tokens_a, tokens_b, tokens_b_in]
#! Outputs: [tokens_a_out]
#!
proc calculate_tokens_a_for_b
    mem_store.AMT_TOKENS_A
    mem_store.AMT_TOKENS_B
    mem_store.AMT_TOKENS_B_IN

    mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_A

    gt
    if.true
        mem_load.AMT_TOKENS_B
        u32split

        push.FACTOR
        u32split

        exec.u64::wrapping_mul

        mem_load.AMT_TOKENS_A
        u32split

        exec.u64::div
        push.MAX_U32 mul add

        mem_store.RATIO

        mem_load.AMT_TOKENS_B_IN
        u32split

        push.FACTOR
        u32split

        exec.u64::wrapping_mul

        mem_load.RATIO
        u32split

        exec.u64::div
        push.MAX_U32 mul add

    else
        mem_load.AMT_TOKENS_A
        u32split

        push.FACTOR
        u32split

        exec.u64::wrapping_mul

        mem_load.AMT_TOKENS_B
        u32split

        exec.u64::div

        mem_load.AMT_TOKENS_B_IN
        u32split

        exec.u64::wrapping_mul

        push.FACTOR
        u32split

        exec.u64::div
        push.MAX_U32 mul add

    end
end

# HASHING PROCEDURES
# =================================================================================================

#! Returns the P2ID RECIPIENT for a specified SERIAL_NUM, SCRIPT_HASH, and account_id
#!
#! Inputs: [SERIAL_NUM, SCRIPT_HASH]
#! Outputs: [P2ID_RECIPIENT]
#!
proc build_p2id_recipient_hash
    # Input: [SERIAL_NUM, SCRIPT_HASH]
    # Output: [P2ID_RECIPIENT]

    # Store P2ID note inputs (creator suffix, prefix) packed into a word at address 4000
    # Same layout as get_inputs: input[0]=suffix at elem[0], input[1]=prefix at elem[1]
    mem_load.SWAPP_CREATOR_SUFFIX_INPUT
    mem_load.SWAPP_CREATOR_PREFIX_INPUT
    push.0.0
    push.4000 mem_storew_be dropw
    # => [SERIAL_NUM, SCRIPT_HASH]

    # build_recipient: [inputs_ptr, num_inputs, SERIAL_NUM, SCRIPT_ROOT] => [RECIPIENT]
    push.2 push.4000
    exec.note::build_recipient
    # => [P2ID_RECIPIENT]
end

#! Returns the NOTE RECIPIENT for a specified SERIAL_NUM, SCRIPT_HASH, and INPUT_HASH
#!
#! Inputs: [SERIAL_NUM, SCRIPT_HASH, INPUT_HASH]
#! Outputs: [P2ID_RECIPIENT]
#!
proc build_recipient_hash
    padw hmerge
    # => [SERIAL_NUM_HASH, SCRIPT_HASH, INPUT_HASH]

    swapw hmerge
    # => [SERIAL_SCRIPT_HASH, INPUT_HASH]

    swapw hmerge
    # => [P2ID_RECIPIENT]
end

# SWAP COUNT INCREMENT PROCEDURE
# =================================================================================================

#! Returns the incremented SWAP count value
#!
#! Inputs: []
#! Outputs: []
#!
proc increment_swap_count
    mem_load.SWAPP_COUNT_INPUT
    push.1
    add
    mem_store.SWAPP_COUNT_INPUT
end

# input: [SERIAL_NUM, swap_count, ...]
# ouput: [P2ID_SERIAL_NUM, ...]
proc get_p2id_serial_num
    swapw
    hmerge
end

# input: []
# output: [get_serial_number + 1]
proc get_new_swap_serial_num
    exec.active_note::get_serial_number
    push.1
    add
end

#! Returns if the currently consuming account is the creator of the note
#!
#! Inputs: []
#! Outputs: [is_creator]
#!
proc is_consumer_is_creator
    push.0 exec.active_note::get_inputs drop drop
    # => []

    exec.active_account::get_id
    # => [acct_id_prefix, acct_id_suffix]

    mem_load.SWAPP_CREATOR_SUFFIX_INPUT mem_load.SWAPP_CREATOR_PREFIX_INPUT
    # => [acct_id_prefix_input, acct_id_suffix_input, acct_id_prefix, acct_id_suffix]

    movup.2
    # => [acct_id_prefix, acct_id_prefix_input, acct_id_suffix_input, acct_id_suffix]

    eq
    # => [is_eq, acct_id_suffix_input, acct_id_suffix]

    if.true
        # => [acct_id_suffix_input, acct_id_suffix]
        eq
    else
        # => [acct_id_suffix_input, acct_id_suffix]
        drop drop push.0
    end
    # => [is_creator]
end

#! Checks if the PSWAP note has expired
#!
#! A note is expired if:
#!   - expiration_block > 0 AND
#!   - current_block >= expiration_block
#!
#! Inputs: []
#! Outputs: [is_expired] (1 if expired, 0 if not)
#!
proc is_note_expired
    # Load inputs to memory first
    push.0 exec.active_note::get_inputs drop drop
    # => []

    mem_load.EXPIRATION_BLOCK_INPUT
    # => [expiration_block]

    # If expiration_block == 0, no expiration
    dup push.0 eq
    # => [is_zero, expiration_block]

    if.true
        # No expiration set
        drop push.0
        # => [0] (not expired)
    else
        # Check if current block >= expiration_block (i.e., is expired)
        exec.tx::get_block_number
        # => [current_block, expiration_block]
        #
        # gte pops [b, a] and returns (a >= b)
        # With [current_block, expiration_block]:
        #   b = current_block (top), a = expiration_block (below)
        #   Returns: expiration_block >= current_block - WRONG!
        #
        # We need: current_block >= expiration_block
        # So swap first to get [expiration_block, current_block]
        # Then gte: a = current_block, b = expiration_block
        # Returns: current_block >= expiration_block - CORRECT!

        swap
        # => [expiration_block, current_block]

        gte
        # => [current_block >= expiration_block] = [is_expired]
    end
    # => [is_expired]
end

#! Sends Assets in Note to Consuming Account
#!
#! Inputs: []
#! Outputs: []
#!
proc handle_reclaim
    push.0 exec.active_note::get_assets

    mem_loadw_be.0

    call.wallet::receive_asset

    dropw
end

# Partially Fillable Swap Script (PSWAP)
# =================================================================================================
#
# Partially Fillable Swap Script (PSWAP): adds an asset from the note into consumers account and
# creates a note consumable by note issuer containing requested ASSET.
#
# If the consuming account does not have sufficient liquidity to completely
# fill the amount of the PSWAP creator's requested asset, then the PSWAP note:
#  1) Computes the ratio of token_a to token_b, where token_a is the offered asset,
#     and where token_b is the requested asset
#  2) Calculates the amount of token_a to send to the consumer based on the the
#     amount of token_b sent via P2ID to the creator
#  3) Outputs a new PSWAP note with the remaining liquidity of token_a, and the updated
#     amount of token_b
#
# If the consuming account completely fills the amount requested by the PSWAP creator,
# only a single P2ID note is outputted.
#
# Definitions:
# 1) the offered asset is referred to as token_a,
# 2) the requested asset is referred to as token_b,
# 3) token_b_in is the amount of token_b sent to the PSWAP creator via P2ID from the consuming account
# 4) token_a_out is the amount of token_a sent to the consuming account
#

# => []
proc execute_SWAPp
    push.OFFERED_ASSET_WORD exec.active_note::get_assets assert.err=ERR_SWAP_WRONG_NUMBER_OF_ASSETS drop
    # => []

    mem_loadw_be.OFFERED_ASSET_WORD
    # => [OFFERED_ASSET]

    mem_store.TOKEN_A_ID_PREFIX
    # => [offered_asset_id_suffix, 0, token_a_AMT]

    mem_store.TOKEN_A_ID_SUFFIX
    # => [0, token_a_AMT]

    drop
    # => [token_a_AMT]

    # store token_a_AMT to mem
    mem_store.AMT_TOKENS_A
    # => []

    # store note inputs into memory starting at address 0
    push.0 exec.active_note::get_inputs
    # => [num_inputs, inputs_ptr]

    # make sure the number of inputs is N
    eq.14 assert.err=ERR_SWAP_WRONG_NUMBER_OF_INPUTS
    # => [inputs_ptr]

    mem_loadw_be.REQUESTED_ASSET_WORD_INPUT
    # => [REQUESTED_ASSET]

    mem_store.TOKEN_B_ID_PREFIX
    # => [token_b_suffix, 0, AMT_TOKENS_B]

    mem_store.TOKEN_B_ID_SUFFIX drop
    # => [AMT_TOKENS_B]

    # store token_b_AMT to mem
    mem_store.AMT_TOKENS_B
    # => []

    # Users can supply the amount of token B they would like to sell
    # via note args. If they don't supply AMT_TOKENS_B_IN via note args
    # by default we read the balance of token B in the consuming account

    # get token_b_AMT_IN, if supplied via note args
    mem_load.AMT_TOKENS_B_IN push.0
    eq
    # => [is_AMT_TOKENS_B_IN_USER_BAL]

    # if amount to swap is user wallet balance
    if.true
        mem_load.TOKEN_B_ID_SUFFIX mem_load.TOKEN_B_ID_PREFIX
        # => [token_b_id_prefix, token_b_id_suffix]

        call.active_account::get_balance
        # => [token_b_AMT_IN]

        # token_b_AMT_IN must not be 0
        dup push.0 neq assert.err=ERR_INVALID_SWAP_AMOUNT_ZERO
        # => [token_b_AMT_IN]

        mem_store.AMT_TOKENS_B_IN
        # => []
    else
        # no need to verify that amount tokens b via note args is
        # valid bc if it isn't call.wallet::send_asset will fail
    end
    # = []

    mem_load.AMT_TOKENS_B_IN
    # => [token_b_AMT_IN]

    mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_A
    # => [token_a_AMT, token_b_AMT, token_b_AMT_IN]

    exec.calculate_tokens_a_for_b
    # => [token_a_AMT_out]

    # store token_a_AMT_out in mem
    dup mem_store.AMT_TOKENS_A_OUT
    # => [token_a_AMT_out]

    mem_load.AMT_TOKENS_A
    # => [token_a_AMT, token_a_AMT_out]

    lt
    # => [is_lt]

    # if amount_out < amount_a
    if.true
        # partial order fill
        # mem_load.AMT_TOKENS_A_OUT
        push.1 mem_store.IS_PARTIAL_FILL
    else
        # complete order fill
        # mem_load.AMT_TOKENS_A
        push.0 mem_store.IS_PARTIAL_FILL
    end
    # => []

    # 1) send token_b_in amt in to creator
    # 2) send token_a_out amt to consumer
    #
    # If Partial Fill:
    # 3) create SWAPp' and calculate token_a' & token_b'
    # 4) add token_a' and token_b' to SWAPp'

    padw mem_loadw_be.P2ID_SCRIPT_ROOT_WORD
    # => [P2ID_SCRIPT_HASH]

    exec.increment_swap_count
    # => [P2ID_SCRIPT_HASH]

    # Build SWAP_COUNT word from single felt (don't use mem_loadw_be which would
    # pick up parent serial data from slots 10-11)
    mem_load.SWAPP_COUNT_INPUT push.0.0.0
    # => [0, 0, 0, swap_count] = [SWAP_COUNT_WORD] with swap_count at Word[0]
    # => [SWAP_COUNT_WORD, P2ID_SCRIPT_HASH]

    exec.active_note::get_serial_number
    # => [SWAP_SERIAL_NUM, SWAP_COUNT_WORD, P2ID_SCRIPT_HASH]

    exec.get_p2id_serial_num
    # => [P2ID_SERIAL_NUM, P2ID_SCRIPT_HASH]

    exec.build_p2id_recipient_hash
    # => [P2ID_RECIPIENT]

    push.PUBLIC_NOTE
    # => [note_type, P2ID_RECIPIENT]

    mem_load.P2ID_TAG_INPUT
    # => [tag, note_type, P2ID_RECIPIENT]

    # v0.13 API: [tag, note_type, RECIPIENT] => [note_idx]
    call.output_note::create
    # => [note_idx, pad(15) ...]

    mem_load.AMT_TOKENS_B_IN
    push.0
    mem_load.TOKEN_B_ID_SUFFIX
    mem_load.TOKEN_B_ID_PREFIX
    # => [ASSET, note_idx]

    call.wallet::move_asset_to_note
    # => [ASSET, note_ix, pad(11)]

    dropw drop
    # => []

    mem_load.AMT_TOKENS_A_OUT
    push.0
    mem_load.TOKEN_A_ID_SUFFIX
    mem_load.TOKEN_A_ID_PREFIX
    # => [ASSET]

    call.wallet::receive_asset
    # => []

    # check if partial fill
    mem_load.IS_PARTIAL_FILL
    # => [is_partial_fill]

    if.true
        mem_load.AMT_TOKENS_B mem_load.AMT_TOKENS_B_IN sub
        # => [token_b_AMT']

        push.0
        mem_load.TOKEN_B_ID_SUFFIX
        mem_load.TOKEN_B_ID_PREFIX
        # => [REQUESTED_ASSET_REMAINING]

        # overwrite memory!
        mem_storew_be.REQUESTED_ASSET_WORD_INPUT dropw
        # => []

        # Store current serial as parent serial for audit trail in leftover note
        # get_serial_number returns [serial[3], serial[2], serial[1], serial[0]] with serial[3] on TOP
        exec.active_note::get_serial_number
        # => [serial[3], serial[2], serial[1], serial[0]]
        mem_store.PARENT_SERIAL_3  # slot 11 <- serial[3]
        mem_store.PARENT_SERIAL_2  # slot 10 <- serial[2]
        mem_store.PARENT_SERIAL_1  # slot 7  <- serial[1]
        mem_store.PARENT_SERIAL_0  # slot 6  <- serial[0]
        # => []

        push.14.0
        # => [num_inputs, ptr]

        exec.note::compute_inputs_commitment
        # => [INPUTS_COMMITMENT]

        exec.active_note::get_script_root
        # => [SCRIPT_HASH, INPUTS_HASH]

        exec.get_new_swap_serial_num
        # => [SERIAL_NUM, SCRIPT_HASH, INPUTS_HASH]

        exec.note::build_recipient_hash
        # => [RECIPIENT_SWAPP]

        push.PUBLIC_NOTE
        # => [note_type, SWAPp_RECIPIENT]

        mem_load.SWAPP_TAG_INPUT
        # => [tag, note_type, SWAPp_RECIPIENT]

        mem_load.AMT_TOKENS_A mem_load.AMT_TOKENS_A_OUT sub
        # => [token_a_amt', tag, note_type, SWAPp_RECIPIENT]

        push.0
        mem_load.TOKEN_A_ID_SUFFIX
        mem_load.TOKEN_A_ID_PREFIX
        # => [ASSET, tag, note_type, SWAPp_RECIPIENT]

        dupw call.wallet::receive_asset
        # => [ASSET, tag, note_type, SWAPp_RECIPIENT]

        mem_storew_be.NEW_ASSET_A dropw
        # => [tag, note_type, RECIPIENT]

        # SWAPp' creation - v0.13 API: [tag, note_type, RECIPIENT] => [note_idx]
        call.output_note::create
        # => [note_idx, pad(15) ...]

        padw
        # => [EMPTY_WORD, note_idx, pad(15) ...]

        mem_loadw_be.NEW_ASSET_A
        # => [ASSET, note_idx, pad(15) ...]

        call.wallet::move_asset_to_note
        # => [ASSET, note_idx, pad(11)]

        dropw drop
        # => []

    else
        # do not output SWAPp'
        # P2ID already created
        nop
    end

    # clean stack
    exec.sys::truncate_stack
end

begin
    # => [NOTE_ARGS]

    # can provide amount B in as note args
    mem_store.AMT_TOKENS_B_IN drop drop drop
    # => []

    push.3558201871398422326.444910447169617901.15090726097241769395.13362761878458161062
    mem_storew_be.P2ID_SCRIPT_ROOT_WORD dropw
    # => []

    exec.is_consumer_is_creator
    # => [is_creator]

    if.true
        # Creator can always reclaim (regardless of expiration)
        exec.handle_reclaim
    else
        # Non-creator: check if note has expired
        exec.is_note_expired
        # => [is_expired]

        if.true
            # Note is expired - only creator can reclaim, fail transaction
            push.0 assert.err=ERR_SWAP_EXPIRED
        else
            # Note is not expired - allow fill
            exec.execute_SWAPp
        end
    end

end
`;

/**
 * P2ID Script Root Hash (from miden-lib)
 * Used for creating P2ID payback notes
 */
export const P2ID_SCRIPT_ROOT = [
  BigInt("15783632360113277539"),
  BigInt("7403765918285273520"),
  BigInt("15691985194755641846"),
  BigInt("10399643920503194563"),
];
