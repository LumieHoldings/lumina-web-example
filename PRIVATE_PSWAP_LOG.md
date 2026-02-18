# PRIVATE PSWAP Log

```text
Console Output
[17:25:38] ============================================================
[17:25:38] PSWAP SIMPLE PARTIAL FILL (NO FEES, v0.13)
[17:25:38] ============================================================
[17:25:38] 
[17:25:38] ============================================================
[17:25:38] PHASE 0: INITIALIZE CLIENT
[17:25:38] ============================================================
[17:25:38] RPC URL: https://rpc.testnet.miden.io:443
[17:25:38] Store: private-pswap-1771435538955
[17:25:40] Block: 256454
[17:25:40] 
[17:25:40] ============================================================
[17:25:40] PHASE 1: CREATE FAUCETS
[17:25:40] ============================================================
[17:25:40] 
[17:25:40] === GOLD FAUCET ===
[17:25:40]   GOLD ID:     0x77818e1abaabe7206a12ec122d7d57
[17:25:40]   GOLD prefix:  8611320207961220896 (0x77818e1abaabe720)
[17:25:40]   GOLD suffix:  7643431080417908480 (0x6a12ec122d7d5700)
[17:25:40] 
[17:25:40] === SILVER FAUCET ===
[17:25:40]   SILVER ID:     0xa6876d7b60b00d200cf6f29fdafea4
[17:25:40]   SILVER prefix:  11999680108822531360 (0xa6876d7b60b00d20)
[17:25:40]   SILVER suffix:  934200741113799680 (0x0cf6f29fdafea400)
[17:25:40] 
[17:25:40] ============================================================
[17:25:40] PHASE 2: CREATE WALLETS
[17:25:40] ============================================================
[17:25:41] 
[17:25:41] === MAKER ===
[17:25:41]   Maker ID:     0xbba212777544fd106ed9beda9cc85e
[17:25:41]   Maker prefix:  13520389335597514000 (0xbba212777544fd10)
[17:25:41]   Maker suffix:  7987625260260810240 (0x6ed9beda9cc85e00)
[17:25:41] 
[17:25:41] === TAKER ===
[17:25:41]   Taker ID:     0x9939de397633fa104d9e4b87915131
[17:25:41]   Taker prefix:  11041100299853101584 (0x9939de397633fa10)
[17:25:41]   Taker suffix:  5592990832871420160 (0x4d9e4b8791513100)
[17:25:41] 
[17:25:41] ============================================================
[17:25:41] PHASE 3: MINT TOKENS
[17:25:41] ============================================================
[17:25:41] Minting 100000 GOLD to Maker...
[17:25:48]   GOLD mint submitted
[17:25:48] Minting 25000 SILVER to Taker...
[17:25:55]   SILVER mint submitted
[17:25:55] 
[17:25:55] Waiting for mints to commit (30s)...
[17:26:26] 
[17:26:26] --- Consuming Minted Notes ---
[17:26:32]   Maker consumed mint note(s)
[17:26:38]   Taker consumed mint note(s)
[17:26:38] 
[17:26:38] Waiting for consumption to commit (30s)...
[17:27:11] 
[17:27:11] ============================================================
[17:27:11] PHASE 4: CREATE PSWAP NOTE
[17:27:11] ============================================================
[17:27:11] Offer: 100000 GOLD for 100000 SILVER (1:1 ratio)
[17:27:11] SDK P2ID root words: [13362761878458161062 15090726097241769395 444910447169617901 3558201871398422326]
[17:27:11] 
[17:27:11] === PSWAP NOTE CREATED ===
[17:27:11]   Note ID: 0xa3c4e6f50a1513593ca649db2c7b3f7c19d9feac20be1999c5c04b5589cd6de4
[17:27:11]   Tag: 2395305894
[17:27:17]   PSWAP transaction submitted
[17:27:17] 
[17:27:17] --- Waiting for PSWAP note to be consumable ---
[17:27:18]   Polling 1/24...
[17:27:23]   Note consumable after 2 attempts
[17:27:23] 
[17:27:23] ============================================================
[17:27:23] PHASE 5: TAKER FILLS 25%
[17:27:23] ============================================================
[17:27:23]   Block: 256489
[17:27:23] 
[17:27:23] Fill calculation:
[17:27:23]   Fill amount:        25000 SILVER (taker sends)
[17:27:23]   Maker receives:     25000 SILVER
[17:27:23]   Taker receives:     25000 GOLD
[17:27:23]   Leftover offered:   75000 GOLD (in new PSWAP)
[17:27:23]   Leftover requested: 75000 SILVER (in new PSWAP)
[17:27:23] Expected Maker P2ID Note ID: 0x47af7065e8293a341effc227c1e830cf428f009680b32812227d2676e30a6a81
[17:27:23] Expected Leftover Note ID: 0x2858bd14cd104cee3142686e7a81963a86e40e2e2635f9c4c12330a689bc1303
[17:27:23] 
[17:27:23] --- Submitting Fill Transaction ---
[17:27:29]   Fill transaction submitted
[17:27:29]   Transaction ID: 0x643d83b071a956ecc2bd86d1add5a390e05658a7ef00cbf8a38427059232d4c7
[17:27:29] 
[17:27:29] ============================================================
[17:27:29] MIDENSCAN LINKS
[17:27:29] ============================================================
[17:27:29]   Maker:    https://testnet.midenscan.com/account/0xbba212777544fd106ed9beda9cc85e
[17:27:29]   Taker:    https://testnet.midenscan.com/account/0x9939de397633fa104d9e4b87915131
[17:27:29]   P2ID:     https://testnet.midenscan.com/note/0x47af7065e8293a341effc227c1e830cf428f009680b32812227d2676e30a6a81
[17:27:29]   Leftover: https://testnet.midenscan.com/note/0x2858bd14cd104cee3142686e7a81963a86e40e2e2635f9c4c12330a689bc1303
[17:27:29] 
[17:27:29] Waiting for fill to commit (45s)...
[17:28:15] 
[17:28:15] ============================================================
[17:28:15] PHASE 6: MAKER CONSUMES P2ID
[17:28:15] ============================================================
[17:28:16]   P2ID consumable after 1 attempts
[17:28:21]   Maker consumed P2ID note
[17:28:21] 
[17:28:21] Waiting for P2ID consumption (30s)...
[17:28:52] 
[17:28:52] ============================================================
[17:28:52] FINAL BALANCES
[17:28:52] ============================================================
[17:28:52]   Maker:  GOLD=0, SILVER=25000 (expected 0, 25000)
[17:28:52]   Taker:  GOLD=25000, SILVER=0 (expected 25000, 0)
[17:28:52]   Leftover PSWAP: 75000 GOLD (note 0x2858bd14cd104cee3142686e7a81963a86e40e2e2635f9c4c12330a689bc1303)
[17:28:52] 
[17:28:52] Done.
```
