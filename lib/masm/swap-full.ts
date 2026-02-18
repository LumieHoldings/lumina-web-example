/**
 * FULL SWAP Note Script (No Partial/Leftover Path)
 *
 * This script is intentionally minimal for full-fill testing:
 * 1. Creates a single payback P2ID note to the maker with REQUESTED_ASSET
 * 2. Transfers the offered asset from the swap note to the taker
 * 3. Does NOT create any leftover swap note
 *
 * Inputs (8 felts):
 *   0-3: REQUESTED_ASSET_WORD [amount, 0, faucet_suffix, faucet_prefix]
 *   4:   P2ID_TAG
 *   5:   CREATOR_PREFIX
 *   6:   CREATOR_SUFFIX
 *   7:   NOTE_TYPE_OUTPUT (1 = public, 2 = private)
 */
export const SWAP_FULL_MASM = `
use miden::protocol::active_note
use miden::protocol::output_note
use miden::protocol::note
use miden::standards::wallets::basic->wallet
use miden::core::sys

# CONSTANTS
# =================================================================================================

const SWAP_FULL_INPUTS = 8

const REQUESTED_ASSET_WORD_INPUT = 0x0000
const REQUESTED_ASSET_INPUT_1 = 0x0001
const REQUESTED_ASSET_INPUT_2 = 0x0002
const REQUESTED_ASSET_INPUT_3 = 0x0003
const P2ID_TAG_INPUT = 0x0004
const CREATOR_PREFIX_INPUT = 0x0005
const CREATOR_SUFFIX_INPUT = 0x0006
const NOTE_TYPE_OUTPUT_INPUT = 0x0007

const P2ID_SCRIPT_ROOT_WORD = 0x0010
const OFFERED_ASSET_WORD = 0x0014

# ERRORS
# =================================================================================================

const ERR_SWAP_WRONG_NUMBER_OF_INPUTS="SWAP full script expects exactly 8 note inputs"
const ERR_SWAP_WRONG_NUMBER_OF_ASSETS="SWAP full script requires exactly 1 note asset"

# HELPERS
# =================================================================================================

#! Builds a P2ID recipient from:
#! - active note serial
#! - P2ID script hash
#! - creator account (suffix,prefix) packed as two inputs
proc build_p2id_recipient_hash
    # Input stack: [SERIAL_NUM, SCRIPT_HASH]

    mem_load.CREATOR_SUFFIX_INPUT
    mem_load.CREATOR_PREFIX_INPUT
    push.0.0
    push.4000 mem_storew_be dropw

    # build_recipient: [inputs_ptr, num_inputs, SERIAL_NUM, SCRIPT_ROOT] => [RECIPIENT]
    push.2 push.4000
    exec.note::build_recipient
end

proc execute_swap_full
    # Store offered asset into memory
    push.OFFERED_ASSET_WORD exec.active_note::get_assets assert.err=ERR_SWAP_WRONG_NUMBER_OF_ASSETS drop

    # Store note inputs into memory and validate count
    push.0 exec.active_note::get_inputs
    eq.SWAP_FULL_INPUTS assert.err=ERR_SWAP_WRONG_NUMBER_OF_INPUTS
    drop

    # Build P2ID recipient from active note serial + P2ID script root + maker account inputs
    padw mem_loadw_be.P2ID_SCRIPT_ROOT_WORD
    exec.active_note::get_serial_number
    exec.build_p2id_recipient_hash
    # => [P2ID_RECIPIENT]

    # Create output note: [tag, note_type, recipient]
    mem_load.NOTE_TYPE_OUTPUT_INPUT
    mem_load.P2ID_TAG_INPUT
    exec.output_note::create
    # => [note_idx, pad(15)]

    # Move requested asset to created P2ID note
    mem_load.REQUESTED_ASSET_WORD_INPUT
    mem_load.REQUESTED_ASSET_INPUT_1
    mem_load.REQUESTED_ASSET_INPUT_2
    mem_load.REQUESTED_ASSET_INPUT_3
    call.wallet::move_asset_to_note
    dropw drop

    # Transfer offered asset from swap note to the taker account
    mem_loadw_be.OFFERED_ASSET_WORD
    call.wallet::receive_asset

    exec.sys::truncate_stack
end

begin
    # NOTE_ARGS are ignored for full-swap script
    dropw

    # P2ID script root
    push.3558201871398422326.444910447169617901.15090726097241769395.13362761878458161062
    mem_storew_be.P2ID_SCRIPT_ROOT_WORD dropw

    exec.execute_swap_full
end
`;

/**
 * Note type values for NOTE_TYPE_OUTPUT input.
 * - Public = 1
 * - Private = 2
 */
export const NOTE_TYPE = {
  PUBLIC: BigInt(1),
  PRIVATE: BigInt(2),
} as const;
