"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { DINO_CONTRACT_ADDRESS } from "@/lib/dinoAbi";
import { parseAbiItem } from "viem";

interface Entry {
  address: string;
  score: number;
}

export default function Leaderboard({ onClose }: { onClose: () => void }) {
  const publicClient = usePublicClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function fetchScores() {
      try {
        setLoading(true);
        const logs = await publicClient.getLogs({
          address: DINO_CONTRACT_ADDRESS,
          event: parseAbiItem(
            "event ScoreSubmitted(address indexed player, uint256 score, uint256 timestamp)"
          ),
          fromBlock: "earliest",
          toBlock: "latest",
        });

        const best: Record<string, number> = {};
        for (const log of logs) {
          const player = (log.args.player as string).toLowerCase();
          const score = Number(log.args.score);
          if (!best[player] || score > best[player]) {
            best[player] = score;
          }
        }

        const sorted = Object.entries(best)
          .map(([address, score]) => ({ address, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        if (!cancelled) {
          setEntries(sorted);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Couldn't load leaderboard");
          setLoading(false);
        }
      }
    }

    fetchScores();
    return () => { cancelled = true; };
  }, [publicClient]);

  const shorten = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div style={{
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(10,10,20,0.92)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
    }}>
      <div style={{
        background: "rgba(30,30,50,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        padding: "20px 24px",
        width: "90%",
        maxWidth: 340,
        maxHeight: "80%",
        overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 16,
        }}>
          <span style={{ color: "#FFD700", fontWeight: 800, fontSize: 18 }}>
            🏆 TOP SCORES
          </span>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8, color: "#fff",
            width: 28, height: 28, cursor: "pointer",
            fontSize: 14,
          }}>
            ✕
          </button>
        </div>

        {loading && (
          <div style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", padding: 20 }}>
            Loading scores...
          </div>
        )}

        {error && (
          <div style={{ color: "#FF6B6B", textAlign: "center", padding: 20 }}>
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", padding: 20 }}>
            No scores yet. Be the first! 🦖
          </div>
        )}

        {!loading && !error && entries.map((entry, i) => (
          <div key={entry.address} style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 4px",
            borderBottom: i < entries.length - 1
              ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, minWidth: 24 }}>
                {medals[i] ?? `#${i + 1}`}
              </span>
              <span style={{ color: "#fff", fontSize: 13, fontFamily: "monospace" }}>
                {shorten(entry.address)}
              </span>
            </div>
            <span style={{ color: "#FFD700", fontWeight: 800, fontSize: 15 }}>
              {entry.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}