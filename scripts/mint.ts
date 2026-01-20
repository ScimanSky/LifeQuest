import { ethers } from "hardhat";

async function main() {
  const contractAddress = "0xA0D50427b654857EC90432017Caa64f9A9DBa1a5";
  const [owner] = await ethers.getSigners();
  
  // Connettiti al contratto
  const lifeToken = await ethers.getContractAt("LifeToken", contractAddress);

  console.log("Stando stampando 1.000 LIFE per l'indirizzo:", owner.address);

  // Trasformiamo 1000 in formato blockchain (con 18 zeri)
  const amount = ethers.parseUnits("1000", 18);

  // Eseguiamo il mint
  const tx = await lifeToken.mint(owner.address, amount);
  await tx.wait();

  console.log("✅ Mint completato! Controlla il tuo MetaMask.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});