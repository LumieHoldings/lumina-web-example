# PSWAP Simple Partial Fill - Successful Run

**Date:** 2026-02-18
**SDK:** v0.13
**Network:** Miden Testnet (`https://rpc.testnet.miden.io:443`)

## Result: PASSED

Maker offered 100,000 GOLD for 100,000 SILVER (1:1 ratio). Taker filled 25%. Final balances match expected values.

## Console Output

```
[15:42:23] ============================================================
[15:42:23] PSWAP SIMPLE PARTIAL FILL (NO FEES, v0.13)
[15:42:23] ============================================================
[15:42:23]
[15:42:23] ============================================================
[15:42:23] PHASE 0: INITIALIZE CLIENT
[15:42:23] ============================================================
[15:42:23] RPC URL: https://rpc.testnet.miden.io:443
[15:42:23] Store: pswap-simple-1771429343539
[15:42:24] Block: 254389
[15:42:24]
[15:42:24] ============================================================
[15:42:24] PHASE 1: CREATE FAUCETS
[15:42:24] ============================================================
[15:42:24]
[15:42:24] === GOLD FAUCET ===
[15:42:24]   GOLD ID:     0x8bca55d49e2069206e1f94e4617e08
[15:42:24]   GOLD prefix:  10072957888241887520 (0x8bca55d49e206920)
[15:42:24]   GOLD suffix:  7935224777059207168 (0x6e1f94e4617e0800)
[15:42:25]
[15:42:25] === SILVER FAUCET ===
[15:42:25]   SILVER ID:     0x2e5c380d5963252075b52c3e5e53df
[15:42:25]   SILVER prefix:  3340606653587465504 (0x2e5c380d59632520)
[15:42:25]   SILVER suffix:  8481734119604346624 (0x75b52c3e5e53df00)
[15:42:25]
[15:42:25] ============================================================
[15:42:25] PHASE 2: CREATE WALLETS
[15:42:25] ============================================================
[15:42:25]
[15:42:25] === MAKER ===
[15:42:25]   Maker ID:     0x00fff6aed074341035b5f97ba09ef0
[15:42:25]   Maker prefix:  72047349743236112 (0x00fff6aed0743410)
[15:42:25]   Maker suffix:  3870273764165873664 (0x35b5f97ba09ef000)
[15:42:26]
[15:42:26] === TAKER ===
[15:42:26]   Taker ID:     0x4e369e17bfaf8f103f2ea33430d351
[15:42:26]   Taker prefix:  5635865808538144528 (0x4e369e17bfaf8f10)
[15:42:26]   Taker suffix:  4552755717870932224 (0x3f2ea33430d35100)
[15:42:26]
[15:42:26] ============================================================
[15:42:26] PHASE 3: MINT TOKENS
[15:42:26] ============================================================
[15:42:26] Minting 100000 GOLD to Maker...
[15:42:33]   GOLD mint submitted
[15:42:33] Minting 25000 SILVER to Taker...
[15:43:11]   SILVER mint submitted
[15:43:11]
[15:43:11] Waiting for mints to commit (30s)...
[15:43:42]
[15:43:42] --- Consuming Minted Notes ---
[15:43:48]   Maker consumed mint note(s)
[15:43:54]   Taker consumed mint note(s)
[15:43:54]
[15:43:54] Waiting for consumption to commit (30s)...
[15:44:24]
[15:44:24] ============================================================
[15:44:24] PHASE 4: CREATE PSWAP NOTE
[15:44:24] ============================================================
[15:44:24] Offer: 100000 GOLD for 100000 SILVER (1:1 ratio)
[15:44:24] SDK P2ID root words: [13362761878458161062 15090726097241769395 444910447169617901 3558201871398422326]
[15:44:24]
[15:44:24] === PSWAP NOTE CREATED ===
[15:44:24]   Note ID: 0x5a5812793981820fc6d61c87fcd87295e4b9bbfb219bc230aa0b91f89a45a800
[15:44:24]   Tag: 1321569070
[15:44:30]   SWAPP transaction submitted
[15:44:30]
[15:44:30] --- Waiting for SWAPP note to be consumable ---
[15:44:30]   Polling 1/24...
[15:44:36]   Note consumable after 2 attempts
[15:44:36]
[15:44:36] ============================================================
[15:44:36] PHASE 5: TAKER FILLS 25%
[15:44:36] ============================================================
[15:44:37]   Block: 254433
[15:44:37]
[15:44:37] Fill calculation:
[15:44:37]   Fill amount:        25000 SILVER (taker sends)
[15:44:37]   Maker receives:     25000 SILVER
[15:44:37]   Taker receives:     25000 GOLD
[15:44:37]   Leftover offered:   75000 GOLD (in new SWAPP)
[15:44:37]   Leftover requested: 75000 SILVER (in new SWAPP)
[15:44:37] Expected Maker P2ID Note ID: 0x84cd93f33c1d36c7a55efa63339aae00d8856d7bc21986a8adf3bbe9ef9b256f
[15:44:37] Expected Leftover Note ID: 0x841b12d5e099ef4eef1a41406fcd3ce5262eb9e3b295c62ddc31615151877bb4
[15:44:37]
[15:44:37] --- Submitting Fill Transaction ---
[15:44:43]   Fill transaction submitted
[15:44:43]   Transaction ID: 0x19f87ca28dc07a3ea5c5095ce5ea6224e83e6acec2d174a778fc41ff56673a1b
[15:44:43]
[15:44:43] ============================================================
[15:44:43] MIDENSCAN LINKS
[15:44:43] ============================================================
[15:44:43]   Maker:    https://testnet.midenscan.com/account/0x00fff6aed074341035b5f97ba09ef0
[15:44:43]   Taker:    https://testnet.midenscan.com/account/0x4e369e17bfaf8f103f2ea33430d351
[15:44:43]   P2ID:     https://testnet.midenscan.com/note/0x84cd93f33c1d36c7a55efa63339aae00d8856d7bc21986a8adf3bbe9ef9b256f
[15:44:43]   Leftover: https://testnet.midenscan.com/note/0x841b12d5e099ef4eef1a41406fcd3ce5262eb9e3b295c62ddc31615151877bb4
[15:44:43]
[15:44:43] Waiting for fill to commit (45s)...
[15:45:29]
[15:45:29] ============================================================
[15:45:29] PHASE 6: MAKER CONSUMES P2ID
[15:45:29] ============================================================
[15:45:29]   P2ID consumable after 1 attempts
[15:45:35]   Maker consumed P2ID note
[15:45:35]
[15:45:35] Waiting for P2ID consumption (30s)...
[15:46:05]
[15:46:05] ============================================================
[15:46:05] FINAL BALANCES
[15:46:05] ============================================================
[15:46:05]   Maker:  GOLD=0, SILVER=25000 (expected 0, 25000)
[15:46:05]   Taker:  GOLD=25000, SILVER=0 (expected 25000, 0)
[15:46:05]   Leftover SWAPP: 75000 GOLD (note 0x841b12d5e099ef4eef1a41406fcd3ce5262eb9e3b295c62ddc31615151877bb4)
[15:46:05]
[15:46:05] Done.
```

## Final Balances

| Account | GOLD | SILVER | Expected |
|---------|------|--------|----------|
| Maker | 0 | 25,000 | 0 GOLD, 25,000 SILVER |
| Taker | 25,000 | 0 | 25,000 GOLD, 0 SILVER |
| Leftover SWAPP | 75,000 | — | 75,000 GOLD remaining |
