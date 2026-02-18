# Lumina Web Miden Playground

WebClient playground for reproducing swap and partial-swap behavior on Miden testnet.

## Current Page

- `/`
  - Main PSWAP simple runner.
  - Port of Rust example flow (`pswap_simple.rs`) to WebClient TypeScript.
  - Uses `lib/masm/pswap.ts`.
  - Runs: create faucets/wallets, mint, consume mints, create PSWAP, taker 25% fill, maker consume P2ID, verify balances.

## MASM Files

- `lib/masm/pswap.ts`
  - Current PSWAP script used by `/`.
  - Expects **14 note inputs**.
  - Output notes are currently hardcoded to `PUBLIC_NOTE`.
  - The export name `PSWAP_PRIVATE_MASM` is legacy naming.

## PSWAP Input Layout (Current `pswap.ts`)

`14` felts:

1. `0-3`: requested asset word `[amount, 0, faucet_suffix, faucet_prefix]`
2. `4`: SWAPP tag
3. `5`: P2ID tag
4. `6-7`: parent serial words 0..1 (or zero for root)
5. `8`: swap count
6. `9`: expiration block
7. `10-11`: parent serial words 2..3 (or zero for root)
8. `12`: creator prefix
9. `13`: creator suffix

Note args for fill:

- `[0, 0, 0, fill_amount]`

## Setup

```bash
npm install
npm run dev
```

Or with pnpm:

```bash
pnpm install
pnpm dev
```

Then open:

- [http://localhost:3000](http://localhost:3000)

## Environment

- Node.js 18+
- Next.js 16
- `@miden-sdk/miden-sdk@0.13.1`

## Notes

- The page uses an isolated store name per run to avoid IndexedDB residue across experiments.
- Swap discovery depends on registering/using correct note tags.
- Waits/polling are intentionally included for testnet commit/discovery timing.
