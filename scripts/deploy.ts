import { ethers } from "hardhat";

async function main() {
  // 1. Recuperiamo l'account che sta facendo l'operazione (il tuo wallet 0x9ee...)
  const [deployer] = await ethers.getSigners();
  
  console.log("----------------------------------------------------");
  console.log("🚀 Inizio la pubblicazione con l'account:", deployer.address);
  console.log("----------------------------------------------------");

  // 2. Prepariamo il contratto
  // NOTA: Passiamo 'deployer.address' tra parentesi quadre perché 
  // il tuo contratto LifeToken richiede un 'initialOwner' nel costruttore.
  const lifeToken = await ethers.deployContract("LifeToken", [deployer.address]);

  console.log("⏳ Attendo che la rete Polygon confermi la transazione...");
  
  // 3. Aspettiamo che la blockchain confermi (ci vuole qualche secondo)
  await lifeToken.waitForDeployment();

  const indirizzoContratto = await lifeToken.getAddress();

  console.log("----------------------------------------------------");
  console.log("🎉 SUCCESSO! Il tuo LifeQuest Token è online!");
  console.log("📍 INDIRIZZO DEL CONTRATTO:", indirizzoContratto);
  console.log("----------------------------------------------------");
  console.log("Copia l'indirizzo qui sopra, ti servirà per MetaMask!");
}

// Gestione errori standard
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});