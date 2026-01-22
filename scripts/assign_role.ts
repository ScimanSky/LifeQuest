import { ethers } from "hardhat";

async function main() {
  // --- MODIFICA SOLO QUI SOTTO ---
  const CONTRACT_ADDRESS = "0x82a44FF957aEe57Ab96671dc1170C073580bfa6D";
  const SERVER_WALLET_ADDRESS = "0x9ee32F0BE08F7A1B4E40e47A82a355a31aD5077C";
  // -------------------------------

  const [admin] = await ethers.getSigners();
  console.log(`👤 Sei connesso come Admin: ${admin.address}`);

  // Colleghiamoci al contratto
  const lifeToken = await ethers.getContractAt("LifeToken", CONTRACT_ADDRESS);

  // Recuperiamo il codice segreto del ruolo MINTER
  const MINTER_ROLE = await lifeToken.MINTER_ROLE();

  console.log(`👮 Assegno il ruolo di "Impiegato" (Minter) al Server...`);
  
  // Eseguiamo l'assunzione
  const tx = await lifeToken.grantRole(MINTER_ROLE, SERVER_WALLET_ADDRESS);
  
  console.log("⏳ Transazione inviata, attendo conferma...");
  await tx.wait();

  console.log("✅ FATTO! Il Server ora può creare sfide e dare premi.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});