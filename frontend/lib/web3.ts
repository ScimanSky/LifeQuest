import { BrowserProvider, Contract, type Eip1193Provider } from "ethers";

export const LIFE_TOKEN_ADDRESS = "0xA0D50427b654857EC90432017Caa64f9A9DBa1a5";
export const AMOY_CHAIN_ID = 80002;
export const AMOY_CHAIN_ID_HEX = "0x13882";
export const AMOY_NETWORK = {
  chainId: AMOY_CHAIN_ID_HEX,
  chainName: "Polygon Amoy",
  nativeCurrency: {
    name: "MATIC",
    symbol: "MATIC",
    decimals: 18
  },
  rpcUrls: ["https://rpc-amoy.polygon.technology/"],
  blockExplorerUrls: ["https://amoy.polygonscan.com/"]
} as const;

export const LIFE_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
  "function owner() view returns (address)",
  "function mint(address to, uint256 amount)"
] as const;

function getEthereum(externalProvider?: Eip1193Provider) {
  if (externalProvider) {
    return externalProvider;
  }
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("Wallet non disponibile nel browser");
  }

  return (window as any).ethereum as Eip1193Provider;
}

export async function switchNetwork(externalProvider?: Eip1193Provider) {
  const ethereum = getEthereum(externalProvider);
  if (!ethereum?.request) {
    throw new Error("Provider non pronto");
  }
  const provider = new BrowserProvider(ethereum);
  const network = await provider.getNetwork();

  if (network.chainId === BigInt(AMOY_CHAIN_ID)) {
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AMOY_CHAIN_ID_HEX }]
    });
  } catch (err) {
    const error = err as { code?: number };
    if (error?.code !== 4902) {
      throw err;
    }

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [AMOY_NETWORK]
    });
  }
}

export async function getContract(externalProvider?: Eip1193Provider) {
  const provider = new BrowserProvider(getEthereum(externalProvider));
  const network = await provider.getNetwork();

  if (network.chainId !== BigInt(AMOY_CHAIN_ID)) {
    throw new Error("Rete non corretta. Passa a Polygon Amoy.");
  }

  const signer = await provider.getSigner();

  return new Contract(LIFE_TOKEN_ADDRESS, LIFE_TOKEN_ABI, signer);
}
