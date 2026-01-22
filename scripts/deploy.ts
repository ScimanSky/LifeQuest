import { ethers } from "hardhat";

async function main() {
  // 1. Recuperiamo l'account (il tuo wallet)
  const [deployer] = await ethers.getSigners();
  
  console.log("----------------------------------------------------");
  console.log("🚀 Inizio il deploy del NUOVO contratto (RBAC) con:", deployer.address);
  console.log("----------------------------------------------------");

  // 2. Prepariamo il contratto
  // NOTA: Costruttore vuoto, niente argomenti []
  const lifeToken = await ethers.deployContract("LifeToken");

  console.log("⏳ Attendo conferma dalla rete Polygon Amoy...");
  
  // 3. Aspettiamo la conferma
  await lifeToken.waitForDeployment();

  const indirizzoContratto = await lifeToken.getAddress();

  console.log("----------------------------------------------------");
  console.log("🎉 SUCCESSO! Il contratto aggiornato è online!");
  console.log("📍 NUOVO INDIRIZZO:", indirizzoContratto);
  console.log("----------------------------------------------------");
  console.log("⚠️  IMPORTANTE: Vai su Vercel (e nel tuo .env.local) e aggiorna:");
  console.log("NEXT_PUBLIC_LIFE_TOKEN_ADDRESS=" + indirizzoContratto);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});