const anchor=require("@anchor-lang/core");const {BN}=anchor;
const {Connection,PublicKey,Keypair,SystemProgram,Transaction,ComputeBudgetProgram,sendAndConfirmTransaction}=require("@solana/web3.js");
const spl=require("@solana/spl-token");const fs=require("fs");
const T22=spl.TOKEN_2022_PROGRAM_ID, TOKEN=spl.TOKEN_PROGRAM_ID, WSOL=spl.NATIVE_MINT;
const idl=JSON.parse(fs.readFileSync("/private/tmp/claude-501/-Users-danny-Documents-hodl/d3e222a2-2c21-472d-a867-49baa741c305/scratchpad/meteora/damm_v2.json"));
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME+"/.config/solana/id.json"))));
const Q=1n<<64n, Q128=1n<<128n;
const SMIN=4295048016n, SMAX=79226673521066979257578248091n;
const isqrt=n=>{if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n}return x};
const ceilDiv=(a,b)=>(a+b-1n)/b;
(async()=>{
const c=new Connection("http://127.0.0.1:8899","confirmed");
const prov=new anchor.AnchorProvider(c,new anchor.Wallet(payer),{commitment:"confirmed",preflightCommitment:"confirmed"});
const damm=new anchor.Program(idl,prov);
console.log("DAMM v2 program:",damm.programId.toBase58());
// 1. our stand-in token (Token-2022, no hook) with the amounts a graduated token would bring
const A=206_900_000_000_000n, B=85_000_000_000n;
const mint=await spl.createMint(c,payer,payer.publicKey,null,6,undefined,{commitment:"confirmed"},T22);
const aAta=await spl.createAssociatedTokenAccountIdempotent(c,payer,mint,payer.publicKey,{commitment:"confirmed"},T22);
await spl.mintTo(c,payer,mint,aAta,payer,A,[],{commitment:"confirmed"},T22);
const bAta=await spl.createAssociatedTokenAccountIdempotent(c,payer,WSOL,payer.publicKey,{commitment:"confirmed"},TOKEN);
await sendAndConfirmTransaction(c,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:bAta,lamports:Number(B)}),spl.createSyncNativeInstruction(bAta,TOKEN)),[payer]);
// 2. price and liquidity from the amounts
const sp=isqrt(B*Q128/A);
const La=A*sp*SMAX/(SMAX-sp), Lb=B*Q128/(sp-SMIN);
let L=La<Lb?La:Lb;
const need=(L)=>[ceilDiv(L*(SMAX-sp),sp*SMAX), ceilDiv(L*(sp-SMIN),Q128)];
let [na,nb]=need(L); while(na>A||nb>B){L-=1n;[na,nb]=need(L)}
console.log("sqrt price:",sp.toString(),"liquidity:",L.toString(),"| uses tokens",na.toString(),"of",A.toString(),"and lamports",nb.toString(),"of",B.toString());
// 3. fee schedule: 30% fading by steps to about 1% over 7 days (28 steps of 6 hours), linear, time based
const base=Buffer.alloc(27); base.writeBigUInt64LE(300_000_000n,0); base.writeUInt16LE(28,8); base.writeBigUInt64LE(21600n,10); base.writeBigUInt64LE(10_357_142n,18); base.writeUInt8(0,26);
const params={poolFees:{baseFee:{data:[...base]},compoundingFeeBps:0,padding:0,dynamicFee:null},sqrtMinPrice:new BN(SMIN.toString()),sqrtMaxPrice:new BN(SMAX.toString()),hasAlphaVault:false,liquidity:new BN(L.toString()),sqrtPrice:new BN(sp.toString()),activationType:1,collectFeeMode:1,activationPoint:null};
const nft=Keypair.generate();
const [ka,kb]=[mint.toBuffer(),WSOL.toBuffer()];
const cmp=Buffer.compare(ka,kb)>0; const maxK=cmp?ka:kb, minK=cmp?kb:ka;
const [pool]=PublicKey.findProgramAddressSync([Buffer.from("cpool"),maxK,minK],damm.programId);
const ix=await damm.methods.initializeCustomizablePool(params).accountsPartial({creator:payer.publicKey,positionNftMint:nft.publicKey,payer:payer.publicKey,pool,tokenAMint:mint,tokenBMint:WSOL,payerTokenA:aAta,payerTokenB:bAta,tokenAProgram:T22,tokenBProgram:TOKEN}).instruction();
const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),ix);
let sig=await sendAndConfirmTransaction(c,tx,[payer,nft]);
const info=await c.getTransaction(sig,{commitment:"confirmed",maxSupportedTransactionVersion:0});
console.log("pool created:",pool.toBase58(),"| compute units:",info.meta.computeUnitsConsumed,"| tx accounts:",info.transaction.message.getAccountKeys? info.transaction.message.getAccountKeys().length:"?");
console.log("leftover tokens in payer account:",(await spl.getAccount(c,aAta,"confirmed",T22)).amount.toString(),"| leftover WSOL:",(await spl.getAccount(c,bAta,"confirmed",TOKEN)).amount.toString());
// 4. lock the liquidity for good
const posNft=await spl.getAssociatedTokenAddressSync? null:null;
const [position]=PublicKey.findProgramAddressSync([Buffer.from("position"),nft.publicKey.toBuffer()],damm.programId);
const [nftAcc]=PublicKey.findProgramAddressSync([Buffer.from("position_nft_account"),nft.publicKey.toBuffer()],damm.programId);
sig=await damm.methods.permanentLockPosition(new BN(L.toString())).accountsPartial({pool,position,positionNftAccount:nftAcc,owner:payer.publicKey}).rpc();
console.log("liquidity locked for good");
const pos=await damm.account.position.fetch(position);
console.log("position: unlocked",pos.unlockedLiquidity.toString(),"permanent locked",pos.permanentLockedLiquidity.toString());
// 5. a trade from another wallet, then claim the fees
const trader=Keypair.generate();
await sendAndConfirmTransaction(c,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:trader.publicKey,lamports:6e9})),[payer]);
const tIn=await spl.createAssociatedTokenAccountIdempotent(c,payer,WSOL,trader.publicKey,{commitment:"confirmed"},TOKEN);
const tOut=await spl.createAssociatedTokenAccountIdempotent(c,payer,mint,trader.publicKey,{commitment:"confirmed"},T22);
await sendAndConfirmTransaction(c,new Transaction().add(SystemProgram.transfer({fromPubkey:trader.publicKey,toPubkey:tIn,lamports:2e9}),spl.createSyncNativeInstruction(tIn,TOKEN)),[trader]);
const [vA]=PublicKey.findProgramAddressSync([Buffer.from("token_vault"),mint.toBuffer(),pool.toBuffer()],damm.programId);
const [vB]=PublicKey.findProgramAddressSync([Buffer.from("token_vault"),WSOL.toBuffer(),pool.toBuffer()],damm.programId);
const before=(await spl.getAccount(c,bAta,"confirmed",TOKEN)).amount;
await damm.methods.swap2({amount0:new BN(1e9),amount1:new BN(0),swapMode:0}).accountsPartial({pool,inputTokenAccount:tIn,outputTokenAccount:tOut,tokenAVault:vA,tokenBVault:vB,tokenAMint:mint,tokenBMint:WSOL,payer:trader.publicKey,tokenAProgram:T22,tokenBProgram:TOKEN,referralTokenAccount:null}).signers([trader]).rpc();
console.log("trader got tokens:",(await spl.getAccount(c,tOut,"confirmed",T22)).amount.toString());
await damm.methods.claimPositionFee().accountsPartial({pool,position,tokenAAccount:aAta,tokenBAccount:bAta,tokenAVault:vA,tokenBVault:vB,tokenAMint:mint,tokenBMint:WSOL,positionNftAccount:nftAcc,owner:payer.publicKey,tokenAProgram:T22,tokenBProgram:TOKEN}).rpc();
const after=(await spl.getAccount(c,bAta,"confirmed",TOKEN)).amount;
console.log("fees claimed in WSOL (lamports):",(after-before).toString(),"| fee on a 1 SOL trade at the opening 30% schedule would be about 300000000");
})().catch(e=>{console.error("FAILED:",String(e.message||e).slice(0,400));if(e.logs)console.error(e.logs.slice(-8).join("\n"));process.exit(1)});
