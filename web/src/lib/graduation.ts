// The three steps that turn a full token into a Meteora trading pool. Anyone can run them.
// Kept free of app imports so the same code can be run from a script and from the website.
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@anchor-lang/core";

export const DAMM_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

const Q128 = 1n << 128n;
const SQRT_MIN = 4295048016n; // Meteora's lowest price
const SQRT_MAX = 79226673521066979257578248091n; // and highest: the pool uses the whole range

const isqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** the opening price and the most liquidity the funds can support (same maths as Meteora's pool creation) */
export function poolNumbers(tokens: bigint, sol: bigint) {
  const sp = isqrt((sol * Q128) / tokens);
  const La = (tokens * sp * SQRT_MAX) / (SQRT_MAX - sp);
  const Lb = (sol * Q128) / (sp - SQRT_MIN);
  let L = La < Lb ? La : Lb;
  const need = (l: bigint) => [ceilDiv(l * (SQRT_MAX - sp), sp * SQRT_MAX), ceilDiv(l * (sp - SQRT_MIN), Q128)];
  let [na, nb] = need(L);
  while (na > tokens || nb > sol) {
    L -= 1n;
    [na, nb] = need(L);
  }
  return { sqrtPrice: sp, liquidity: L };
}

export type GradStep = "prepare" | "pool" | "lock";

/** which step is next for a token, given its graduation stage (0 = not started, 3 = done) */
export function nextStep(stage: number): GradStep | null {
  return stage === 0 ? "prepare" : stage === 1 ? "pool" : stage === 2 ? "lock" : null;
}

export function graduationAddresses(programId: PublicKey, mint: PublicKey, positionNft: PublicKey) {
  const pda = (seeds: Buffer[], pid: PublicKey) => PublicKey.findProgramAddressSync(seeds, pid)[0];
  const curve = pda([Buffer.from("curve"), mint.toBuffer()], programId);
  const grad = pda([Buffer.from("grad"), mint.toBuffer()], programId);
  const a = mint.toBuffer();
  const b = NATIVE_MINT.toBuffer();
  const pool = pda([Buffer.from("cpool"), Buffer.compare(a, b) > 0 ? a : b, Buffer.compare(a, b) > 0 ? b : a], DAMM_PROGRAM_ID);
  return {
    curve,
    grad,
    vault: getAssociatedTokenAddressSync(mint, curve, true, TOKEN_2022_PROGRAM_ID),
    gradToken: getAssociatedTokenAddressSync(mint, grad, true, TOKEN_2022_PROGRAM_ID),
    gradWsol: getAssociatedTokenAddressSync(NATIVE_MINT, grad, true, TOKEN_PROGRAM_ID),
    pool,
    position: pda([Buffer.from("position"), positionNft.toBuffer()], DAMM_PROGRAM_ID),
    positionNftAccount: pda([Buffer.from("position_nft_account"), positionNft.toBuffer()], DAMM_PROGRAM_ID),
    vaultA: pda([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DAMM_PROGRAM_ID),
    vaultB: pda([Buffer.from("token_vault"), NATIVE_MINT.toBuffer(), pool.toBuffer()], DAMM_PROGRAM_ID),
    eventAuthority: pda([Buffer.from("__event_authority")], DAMM_PROGRAM_ID),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** run whatever steps are left, one transaction each. `program` is the HODL program connected to the caller's wallet. */
export async function runGraduation(program: any, mint: PublicKey, onStep?: (step: GradStep, done: number, total: number) => void): Promise<void> {
  const caller: PublicKey = program.provider.wallet.publicKey;
  const stageOf = async (): Promise<number> => {
    const c = await program.account.curve.fetch(graduationAddresses(program.programId, mint, PublicKey.default).curve);
    return c.graduatedStage as number;
  };
  // reads can lag one moment behind a transaction that just confirmed: wait until the stage moves on
  const waitForStage = async (atLeast: number) => {
    for (let i = 0; i < 40; i++) {
      if ((await stageOf()) >= atLeast) return;
      await sleep(250);
    }
    throw new Error("The network is slow to show the last step. Try again in a moment.");
  };

  const start = await stageOf();
  const steps = (["prepare", "pool", "lock"] as GradStep[]).slice(start);
  let done = 0;
  for (const step of steps) {
    onStep?.(step, done, steps.length);
    if (step === "prepare") {
      const a = graduationAddresses(program.programId, mint, PublicKey.default);
      await program.methods
        .graduatePrepare()
        .accountsPartial({ caller, mint, vault: a.vault, grad: a.grad, gradToken: a.gradToken, gradWsol: a.gradWsol })
        .rpc();
      await waitForStage(1);
    } else if (step === "pool") {
      const curve = await program.account.curve.fetch(graduationAddresses(program.programId, mint, PublicKey.default).curve);
      const { sqrtPrice, liquidity } = poolNumbers(BigInt(curve.lpTokens.toString()), BigInt(curve.lpSol.toString()));
      const nft = Keypair.generate();
      const a = graduationAddresses(program.programId, mint, nft.publicKey);
      await program.methods
        .graduateCreatePool(new BN(sqrtPrice.toString()), new BN(liquidity.toString()))
        .accountsPartial({
          caller,
          mint,
          grad: a.grad,
          gradToken: a.gradToken,
          gradWsol: a.gradWsol,
          positionNftMint: nft.publicKey,
          positionNftAccount: a.positionNftAccount,
          pool: a.pool,
          position: a.position,
          tokenAVault: a.vaultA,
          tokenBVault: a.vaultB,
          eventAuthority: a.eventAuthority,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })])
        .signers([nft])
        .rpc();
      await waitForStage(2);
    } else {
      const curve = await program.account.curve.fetch(graduationAddresses(program.programId, mint, PublicKey.default).curve);
      const a = graduationAddresses(program.programId, mint, curve.positionNftMint as PublicKey);
      await program.methods
        .graduateLock()
        .accountsPartial({ caller, mint, grad: a.grad, pool: curve.pool, position: a.position, positionNftAccount: a.positionNftAccount, eventAuthority: a.eventAuthority })
        .rpc();
      await waitForStage(3);
    }
    done += 1;
  }
  onStep?.("lock", steps.length, steps.length);
}
