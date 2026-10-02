# Putting HODL under a multisig

A multisig is a shared wallet that needs several people to approve before it can do anything.
Squads is the usual choice on Solana. Three things should end up controlled by it:

| What | Why it matters | Who controls it today |
|---|---|---|
| **Upgrade authority** of the program | Whoever has it can replace the program's code, so it can do anything. This is the most powerful key. | The wallet that deployed it |
| **Admin** in the HODL config | Can pause new buys and new tokens, change the platform fee for NEW tokens, change the treasury | The same deployer wallet |
| **Treasury** | Where platform fees are sent | Whatever address was set at setup |

Nothing is moved yet. This is the plan for when you are ready.

## 1. Pick the signers

- Recommended: **2 of 3**. Your main wallet (a hardware wallet if you can), a second wallet on another device, and one person you trust.
- Never keep all the keys on one laptop. Then it is not a multisig, just a slower single key.
- Each signer needs a little SOL for fees.
- Think about the pause button: pausing needs the threshold of people. Pick signers who can respond quickly in an emergency.

## 2. Create the multisig

1. Open the Squads app (app.squads.so) and connect a signer wallet.
2. Create a new multisig: add the signer addresses, set the threshold (2), and confirm.
3. Write down the **vault address** (the address that holds funds and signs). That is the address you will hand control to. Do not confuse it with the multisig account address.
4. Send the vault a small amount of SOL so it can pay rent and fees.

**Rehearse first.** One search result claimed Squads does not offer a devnet option. I could not confirm that. Look for a network switch in the app. If there is no devnet, do the rehearsal with a throwaway multisig and a throwaway token on mainnet-free tools, or do the first handover with very small amounts. Do not hand over the real program key without a rehearsal.

## 3. Hand over the pieces (in this order)

### a) Treasury (lowest risk, do first)
Point the treasury at the vault address, so fees land there:

```bash
node scripts/admin.cjs set-treasury <VAULT_ADDRESS> --yes
```

### b) Admin (two steps, so a typo cannot lock you out)
1. The current admin proposes the vault:
   ```bash
   node scripts/admin.cjs propose-admin <VAULT_ADDRESS> --yes
   ```
2. The vault accepts. In Squads, create a transaction that calls `accept_admin` on the HODL program: use the program interaction / custom instruction option, add the program id, and upload the IDL file `target/idl/hold_launchpad.json`. Pick `accept_admin`, add the `config` account (the address `node scripts/admin.cjs show` prints under the program) and the vault as `new_admin`. Approve it with the required signers and execute.
3. Check:
   ```bash
   node scripts/admin.cjs show
   ```
   The admin line must now be the vault address.

Until step 2 succeeds, the old admin keeps control. If the proposed address is wrong, just propose again.

### c) Upgrade authority (the big one, last)
Use Squads' own "Safe Authority Transfer" flow for the program (it needs both the current authority and the vault to sign, which proves the vault works before the old key lets go). Avoid the plain command line version unless you triple-check the address. A wrong address here means nobody can ever upgrade the program again.

After the transfer, confirm:

```bash
solana program show <PROGRAM_ID> --url <cluster>
```

The `Authority` line must be the vault address.

## 4. After the handover

- Pause, fee changes, treasury changes, and program upgrades now all go through the multisig: someone proposes in Squads, the others approve.
- The command line tool still works for **reading** (`show`). Changes now need the multisig.
- After an audit and a long quiet period, you can consider making the program **immutable** (no upgrade authority at all). That is permanent and irreversible, so only when you are sure.

## What the multisig can and cannot do

- Can: pause new buys and new tokens, change the platform fee for new tokens (max 2%), change the treasury, hand over admin, upgrade the program.
- Cannot: take anyone's tokens, block selling, block reward claims, or change a token's fees after it launched. (An upgrade could change the rules, which is why the upgrade key matters most and why it belongs in the multisig.)

## Checklist before mainnet

- [ ] Multisig created, rehearsed, signers can all sign
- [ ] Treasury set to the vault
- [ ] Admin handed over and `show` confirms it
- [ ] Upgrade authority handed over and `solana program show` confirms it
- [ ] Everyone knows the emergency steps for pausing
- [ ] Professional audit and legal review done
