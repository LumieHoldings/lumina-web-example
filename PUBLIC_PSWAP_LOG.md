# PUBLIC PSWAP Log

```text
Console Output
[17:16:12] ============================================================
[17:16:12] PSWAP SIMPLE PARTIAL FILL (NO FEES, v0.13)
[17:16:12] ============================================================
[17:16:12] 
[17:16:12] ============================================================
[17:16:12] PHASE 0: INITIALIZE CLIENT
[17:16:12] ============================================================
[17:16:12] RPC URL: https://rpc.testnet.miden.io:443
[17:16:12] Store: private-pswap-1771434972925
[17:16:14] Block: 256265
[17:16:14] 
[17:16:14] ============================================================
[17:16:14] PHASE 1: CREATE FAUCETS
[17:16:14] ============================================================
[17:16:14] 
[17:16:14] === GOLD FAUCET ===
[17:16:14]   GOLD ID:     0xbdd46dee170a3f201251289b94efa1
[17:16:14]   GOLD prefix:  13678678837587230496 (0xbdd46dee170a3f20)
[17:16:14]   GOLD suffix:  1319880814480040192 (0x1251289b94efa100)
[17:16:15] 
[17:16:15] === SILVER FAUCET ===
[17:16:15]   SILVER ID:     0xbcfe64bfcda763202f94857a284e10
[17:16:15]   SILVER prefix:  13618433098166788896 (0xbcfe64bfcda76320)
[17:16:15]   SILVER suffix:  3428511976044498944 (0x2f94857a284e1000)
[17:16:15] 
[17:16:15] ============================================================
[17:16:15] PHASE 2: CREATE WALLETS
[17:16:15] ============================================================
[17:16:15] 
[17:16:15] === MAKER ===
[17:16:15]   Maker ID:     0x399bf67e2f2625101f6bd3ac9a6f83
[17:16:15]   Maker prefix:  4151182503369385232 (0x399bf67e2f262510)
[17:16:15]   Maker suffix:  2264135975962641152 (0x1f6bd3ac9a6f8300)
[17:16:15] 
[17:16:15] === TAKER ===
[17:16:15]   Taker ID:     0x59f1b84df2acf6103136b061e07336
[17:16:15]   Taker prefix:  6481163983686268432 (0x59f1b84df2acf610)
[17:16:15]   Taker suffix:  3546215691024807424 (0x3136b061e0733600)
[17:16:15] 
[17:16:15] ============================================================
[17:16:15] PHASE 3: MINT TOKENS
[17:16:15] ============================================================
[17:16:15] Minting 100000 GOLD to Maker...
[17:16:24]   GOLD mint submitted
[17:16:24] Minting 25000 SILVER to Taker...
[17:16:29]   SILVER mint submitted
[17:16:29] 
[17:16:29] Waiting for mints to commit (30s)...
[17:17:01] 
[17:17:01] --- Consuming Minted Notes ---
[17:17:07]   Maker consumed mint note(s)
[17:17:13]   Taker consumed mint note(s)
[17:17:13] 
[17:17:13] Waiting for consumption to commit (30s)...
[17:17:43] 
[17:17:43] ============================================================
[17:17:43] PHASE 4: CREATE PSWAP NOTE
[17:17:43] ============================================================
[17:17:43] Offer: 100000 GOLD for 100000 SILVER (1:1 ratio)
[17:17:43] SDK P2ID root words: [13362761878458161062 15090726097241769395 444910447169617901 3558201871398422326]
[17:17:43] 
[17:17:43] === PSWAP NOTE CREATED ===
[17:17:43]   Note ID: 0x2a2b177f83e564befd5433193ec70aa23fcc389cc4b82522a12aaa4a4fe29ebf
[17:17:43]   Tag: 1321582012
[17:17:50]   PSWAP transaction submitted
[17:17:50] 
[17:17:50] --- Waiting for PSWAP note to be consumable ---
[17:17:51]   Polling 1/24...
[17:17:56]   Note consumable after 2 attempts
[17:17:56] 
[17:17:56] ============================================================
[17:17:56] PHASE 5: TAKER FILLS 25%
[17:17:56] ============================================================
[17:17:57]   Block: 256300
[17:17:57] 
[17:17:57] Fill calculation:
[17:17:57]   Fill amount:        25000 SILVER (taker sends)
[17:17:57]   Maker receives:     25000 SILVER
[17:17:57]   Taker receives:     25000 GOLD
[17:17:57]   Leftover offered:   75000 GOLD (in new PSWAP)
[17:17:57]   Leftover requested: 75000 SILVER (in new PSWAP)
[17:17:57] Expected Maker P2ID Note ID: 0x933005ea4a0331a768cbd499bd89fc5bc394dc32461fa8296beeb559d707a3c0
[17:17:57] Expected Leftover Note ID: 0xbdccd1d6cd4f3d9b44aa7fc8b54cda95a6cc2519600cfb5688d6be154004f563
[17:17:57] 
[17:17:57] --- Submitting Fill Transaction ---
[17:18:03]   Fill transaction submitted
[17:18:03]   Transaction ID: 0xea54aa97fa17067c8b96b6f433ffdb2f8786d8b1f6b8edd310c56e4abe6bf509
[17:18:03] 
[17:18:03] ============================================================
[17:18:03] MIDENSCAN LINKS
[17:18:03] ============================================================
[17:18:03]   Maker:    https://testnet.midenscan.com/account/0x399bf67e2f2625101f6bd3ac9a6f83
[17:18:03]   Taker:    https://testnet.midenscan.com/account/0x59f1b84df2acf6103136b061e07336
[17:18:03]   P2ID:     https://testnet.midenscan.com/note/0x933005ea4a0331a768cbd499bd89fc5bc394dc32461fa8296beeb559d707a3c0
[17:18:03]   Leftover: https://testnet.midenscan.com/note/0xbdccd1d6cd4f3d9b44aa7fc8b54cda95a6cc2519600cfb5688d6be154004f563
[17:18:03] 
[17:18:03] Waiting for fill to commit (45s)...
[17:18:49] 
[17:18:49] ============================================================
[17:18:49] PHASE 6: MAKER CONSUMES P2ID
[17:18:49] ============================================================
[17:18:49]   P2ID consumable after 1 attempts
[17:18:55]   Maker consumed P2ID note
[17:18:55] 
[17:18:55] Waiting for P2ID consumption (30s)...
[17:19:26] 
[17:19:26] ============================================================
[17:19:26] FINAL BALANCES
[17:19:26] ============================================================
[17:19:26]   Maker:  GOLD=0, SILVER=25000 (expected 0, 25000)
[17:19:26]   Taker:  GOLD=25000, SILVER=0 (expected 25000, 0)
[17:19:26]   Leftover PSWAP: 75000 GOLD (note 0xbdccd1d6cd4f3d9b44aa7fc8b54cda95a6cc2519600cfb5688d6be154004f563)
[17:19:26] 
[17:19:26] Done.
```
