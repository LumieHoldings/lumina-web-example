# Lumina PSWAP — Web Examples for Miden

A browser-based playground for testing **Partial Swap (PSWAP)** on [Miden](https://polygon.technology/miden) testnet, built by [Lumina Engine](https://luminaengine.ai).

Run full swap flows directly in your browser — create wallets, mint test tokens, execute partial swaps, and verify balances on-chain. No backend required.

> Built by [Lumina Engine](https://luminaengine.ai) — privacy-first settlement infrastructure for digital assets.

---

## What's Inside

Four test pages demonstrating different swap approaches on Miden:

| Page | Route | What it does |
|------|-------|-------------|
| **Public PSWAP** | `/` | Full partial swap flow with public notes — maker offers GOLD, taker fills 25% |
| **Private PSWAP** | `/private-pswap` | Same flow using private notes (only note hash stored on-chain) |
| **Full Swap** | `/full-swap` | Complete swap using custom MASM script |
| **Official Swap** | `/official-swap` | Swap using Miden SDK's built-in `submitNewTransaction` method |

Each page runs an end-to-end flow:

1. **Create faucets** (GOLD and SILVER test tokens)
2. **Create wallets** (Maker and Taker)
3. **Mint tokens** to each wallet
4. **Create a PSWAP note** — Maker offers 100,000 GOLD for 100,000 SILVER
5. **Taker fills 25%** — sends 25,000 SILVER, receives 25,000 GOLD
6. **Maker claims** the P2ID payback note
7. **Verify final balances**

---

## Prerequisites

- **Node.js 18+** — [install here](https://nodejs.org/)
- **pnpm** (recommended) or npm
- **Internet connection** — connects to Miden testnet

---

## Getting Started

```bash
git clone https://github.com/LuminaEngine/lumina-web-example.git
cd lumina-web-example

# Copy environment config
cp .env.example .env

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and click **"Run Test"** on any page.

Each test takes ~3-5 minutes (testnet transactions need time to commit). Progress is displayed step-by-step in the browser.

---

## Project Structure

```
├── app/
│   ├── page.tsx                 # Public PSWAP test page
│   ├── private-pswap/page.tsx   # Private PSWAP test page
│   ├── full-swap/page.tsx       # Full swap test page
│   └── official-swap/page.tsx   # SDK-native swap test page
├── lib/
│   └── masm/
│       ├── pswap.ts             # PSWAP note script (Miden Assembly)
│       ├── private-pswap.ts     # Private PSWAP note script
│       └── swap-full.ts         # Full swap MASM script
└── .env.example                 # Environment config template
```

---

## PSWAP Note Format

### 14 Note Inputs

```
Index  Name               Description
-----  ----               -----------
 0     requested_amount   Amount of token B requested
 1     zero               Always 0
 2     faucet_suffix      Token B faucet ID suffix
 3     faucet_prefix      Token B faucet ID prefix
 4     swapp_tag          NoteTag for SWAPP note discovery
 5     p2id_tag           NoteTag for P2ID payback notes
 6     parent_serial_0    Parent note serial element 0 (0 for initial)
 7     parent_serial_1    Parent note serial element 1 (0 for initial)
 8     swap_count         Number of partial fills so far
 9     expiration_block   Block height for expiration (0 = no expiry)
10     parent_serial_2    Parent note serial element 2 (0 for initial)
11     parent_serial_3    Parent note serial element 3 (0 for initial)
12     creator_prefix     Creator account ID prefix
13     creator_suffix     Creator account ID suffix
```

### Note Args (for fill)

```
[0, 0, 0, fill_amount]
```

---

## Tech Stack

- [Next.js](https://nextjs.org/) 16 (with webpack for WASM support)
- [React](https://react.dev/) 19
- [@miden-sdk/miden-sdk](https://polygon.technology/miden) 0.13.1 (Miden WebClient)
- TypeScript

---

## Notes

- Each test run creates an isolated IndexedDB store to avoid state conflicts between runs
- Swap discovery relies on correct note tag registration
- Wait/polling loops are intentional — testnet needs time for transaction commitment

---

## About Lumina Engine

[Lumina Engine](https://luminaengine.ai) is building privacy-first trading and settlement infrastructure on Miden's zkVM. We use zero-knowledge proofs to let users trade, transfer, and settle digital assets without exposing their positions, balances, or intent.

- Website: [luminaengine.ai](https://luminaengine.ai)
- GitHub: [github.com/LuminaEngine](https://github.com/LuminaEngine)
- Beta: [beta.luminaengine.ai](https://beta.luminaengine.ai)

---

## License

MIT — see [LICENSE](./LICENSE).
