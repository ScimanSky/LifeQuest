const { ethers } = require("ethers");
const {
  POLYGON_RPC_URL,
  OWNER_PRIVATE_KEY,
  CONTRACT_ADDRESS
} = require("../config/env");

const CONTRACT_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)"
];

function getContractAddress() {
  return CONTRACT_ADDRESS || "";
}

function ensureContractAddress() {
  const address = getContractAddress();
  if (!address) {
    throw new Error("CONTRACT_ADDRESS non configurato");
  }
  return address;
}

async function getMinterContract() {
  const address = ensureContractAddress();
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(address, CONTRACT_ABI, wallet);
  const minterRole = await contract.MINTER_ROLE();
  const isMinter = await contract.hasRole(minterRole, wallet.address);
  if (!isMinter) {
    throw new Error("Server non autorizzato a mintare (MINTER_ROLE mancante)");
  }
  return contract;
}

async function fetchBalance(address) {
  const contractAddress = ensureContractAddress();
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
  return contract.balanceOf(address);
}

async function mintReward(totalReward, recipient) {
  const contract = await getMinterContract();
  const tx = await contract.mint(
    recipient,
    ethers.parseUnits(totalReward.toString(), 18),
    { gasLimit: 200000n }
  );
  return tx.wait();
}

async function mintArenaReward(amount, recipient) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Importo non valido");
  }
  const contract = await getMinterContract();
  const rounded = Math.round(normalized * 10000) / 10000;
  const tx = await contract.mint(
    recipient,
    ethers.parseUnits(rounded.toString(), 18),
    { gasLimit: 200000n }
  );
  return tx.wait();
}

module.exports = {
  fetchBalance,
  mintReward,
  mintArenaReward
};
