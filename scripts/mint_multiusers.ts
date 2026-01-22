import { ethers } from "hardhat";

async function main() {
  // --- CONFIGURAZIONE ---
  const CONTRACT_ADDRESS = "0x82a44FF957aEe57Ab96671dc1170C073580bfa6D";
  const AMOUNT_TO_MINT = "1000"; // Quanti token a testa?

  // 👇 INSERISCI QUI GLI INDIRIZZI DEI DESTINATARI (Tra virgolette, separati da virgola)
  const recipients = [
    "0x9ee32F0BE08F7A1B4E40e47A82a355a31aD5077C",
    "0xCBc8560a8EBf56b6Bf45BD7Db798ddC253863588"
    // Puoi aggiungerne altri se vuoi: "0xIndirizzo3",
  ];
  // ----------------------

  const [admin] = await ethers.getSigners();
  console.log(`👤 Sei connesso come Admin: ${admin.address}`);

  const lifeToken = await ethers.getContractAt("LifeToken", CONTRACT_ADDRESS);

  console.log(`🚀 Inizio la distribuzione di ${AMOUNT_TO_MINT} LIFE a ${recipients.length} utenti...`);

  // Ciclo che invia i soldi a tutti gli indirizzi della lista
  for (const recipient of recipients) {
    console.log(`💸 Invio a: ${recipient}...`);
    
    const tx = await lifeToken.mint(recipient, ethers.parseEther(AMOUNT_TO_MINT));
    await tx.wait();
    
    console.log(`   ✅ Inviato!`);
  }

  console.log("----------------------------------------------------");
  console.log("🎉 Distribuzione completata!");
  console.log("----------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});