"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, cookieStorage, createStorage } from "wagmi";
import { polygonAmoy } from "wagmi/chains";

const config = getDefaultConfig({
  appName: "LifeQuest",
  projectId: "4dc9878d4994507d4a30e03ee7f10b2b",
  chains: [polygonAmoy],
  ssr: true,
  storage: createStorage({ storage: cookieStorage })
});

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={polygonAmoy}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
