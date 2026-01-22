"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

export function useAuthSync() {
  const { address, isConnected } = useAccount();
  const [hasSynced, setHasSynced] = useState(false);
  const syncingRef = useRef(false);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setHasSynced(false);
      lastSyncedRef.current = null;
      syncingRef.current = false;
      return;
    }

    const normalized = address.toLowerCase();
    if (lastSyncedRef.current === normalized || syncingRef.current) {
      return;
    }

    syncingRef.current = true;

    const run = async () => {
      try {
        const response = await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet_address: normalized })
        });
        if (!response.ok) {
          return;
        }
        lastSyncedRef.current = normalized;
        setHasSynced(true);
      } catch {
        // Silenzioso: l'utente può ritentare al prossimo render.
      } finally {
        syncingRef.current = false;
      }
    };

    run();
  }, [address, isConnected]);

  return { hasSynced };
}
