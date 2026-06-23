"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { useAccount, useWriteContract } from "wagmi";
import { ConnectWallet, Wallet } from "@coinbase/onchainkit/wallet";
import { DINO_LEADERBOARD_ABI, DINO_CONTRACT_ADDRESS } from "@/lib/dinoAbi";
import Leaderboard from "@/components/Leaderboard";

const GRAVITY = 0.6;
const JUMP_FORCE = -13;
const MAX_LIVES = 3;
const INVINCIBILITY_FRAMES = 60;
const GROUND_RATIO = 0.78;
const WIN_DISTANCE = 252000;
const DUCK_FRAMES = 25;

const STAGE_SPEEDS     = [5.0, 6.5, 8.0, 9.5, 11.0, 12.5, 14.0];
const STAGE_THRESHOLDS = [0, 25200, 50400, 75600, 100800, 126000, 151200];
const STAGE_SPAWN_GAPS = [180, 150, 110, 80, 55, 38, 25];
const STAGE_JITTER     = [20,  20,  18,  15, 12,  8,  6];
const STAGE_COIN_GAPS  = [160, 160, 140, 120, 100, 90, 80];

const STAGE_STYLES = [
  { sky1: "#87CEEB", sky2: "#B0E2FF", label: "🌤 CHILL"     },
  { sky1: "#FF8C42", sky2: "#FFD166", label: "🌅 DUSK"      },
  { sky1: "#6A0572", sky2: "#C77DFF", label: "🌙 NIGHT"     },
  { sky1: "#0A0A1A", sky2: "#1A1A2E", label: "💀 CHAOS"     },
  { sky1: "#7B0000", sky2: "#FF4500", label: "🌋 DANGER"    },
  { sky1: "#3D0000", sky2: "#8B0000", label: "☠️ NIGHTMARE" },
  { sky1: "#000000", sky2: "#0D0D2B", label: "👾 INSANE"    },
];

const STAGE_PATTERNS = [
  [60, 20, 20,  0,  0,  0,  0,  0,  0,  0,  0],
  [35, 15, 15, 10,  5,  5,  0,  0,  0, 10,  5],
  [20, 12, 12, 12, 10,  8,  5,  5,  0,  9,  7],
  [12,  8,  8, 12, 12, 10,  8, 12,  0,  8, 10],
  [ 8,  6,  6, 10, 13, 10, 12, 12,  5,  8, 10],
  [ 4,  4,  4,  8, 15, 13, 13, 14,  8,  8,  9],
  [ 0,  4,  4,  6, 16, 14, 15, 12, 12,  8,  9],
];

function pickPattern(stage: number): string {
  const weights = STAGE_PATTERNS[Math.min(stage - 1, 6)];
  const labels  = ["A","B","C","D","E","F","G","H","I","J","K"];
  const total   = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return labels[i];
  }
  return "A";
}

interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "cactus" | "bat_low" | "bat_skim" | "bat_high";
}

interface Coin {
  x: number;
  y: number;
  size: number;
  collected: boolean;
  frame: number;
}

interface GameState {
  dinoY: number;
  dinoVY: number;
  isJumping: boolean;
  jumpCount: number;
  ducking: boolean;
  duckTimer: number;
  obstacles: Obstacle[];
  coins: Coin[];
  score: number;
  distance: number;
  speed: number;
  gameOver: boolean;
  started: boolean;
  frameCount: number;
  stage: number;
  lives: number;
  totalCoins: number;
  invincible: number;
  won: boolean;
  nextSpawnFrame: number;
  nextCoinFrame: number;
  seenBatHigh: boolean;
}

function makeInitialState(groundY: number): GameState {
  return {
    dinoY: groundY - 60,
    dinoVY: 0,
    isJumping: false,
    jumpCount: 0,
    ducking: false,
    duckTimer: 0,
    obstacles: [],
    coins: [],
    score: 0,
    distance: 0,
    speed: STAGE_SPEEDS[0],
    gameOver: false,
    started: false,
    frameCount: 0,
    stage: 1,
    lives: MAX_LIVES,
    totalCoins: 0,
    invincible: 0,
    won: false,
    nextSpawnFrame: 80,
    nextCoinFrame: 160,
    seenBatHigh: false,
  };
}

// ─── Audio ────────────────────────────────────────────────────────────────────
class AudioEngine {
  private ctx: AudioContext | null = null;
  private getCtx(): AudioContext {
    if (!this.ctx) {
      const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new AudioCtor();
    }
    return this.ctx;
  }
  resume() { try { this.ctx?.resume(); } catch {} }
  playJump() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }
  playDuck() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
    } catch {}
  }
  playCoin() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
    } catch {}
  }
  playHit() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }
  playGameOver() {
    try {
      const ctx = this.getCtx();
      [440, 330, 220, 110].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.1);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.12);
      });
    } catch {}
  }
  playStageChange(stage: number) {
    try {
      const ctx = this.getCtx();
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.setValueAtTime(freq * (stage / 2), ctx.currentTime + i * 0.08);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.1);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.12);
      });
    } catch {}
  }
  playWin() {
    try {
      const ctx = this.getCtx();
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.15);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.18);
      });
    } catch {}
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const { setMiniAppReady, context } = useMiniKit();
  const { isConnected } = useAccount();

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // ─── No more receipt polling/timeout guessing. The instant the wallet
  //     returns a hash, we consider it "submitted" and point the player to
  //     BaseScan for the real confirmation status. This is the honest version:
  //     we know it was sent, we don't pretend to know exactly when it lands. ──
  const [isSubmitted, setIsSubmitted] = useState(false);

  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const animFrameRef   = useRef<number | undefined>(undefined);
  const isRunningRef   = useRef(false);
  const displaySyncRef = useRef(0);
  const jumpRef        = useRef<() => void>(() => {});
  const duckStartRef   = useRef<() => void>(() => {});
  const duckEndRef     = useRef<() => void>(() => {});
  const audioRef       = useRef<AudioEngine | null>(null);
  const mutedRef       = useRef(false);

  const touchStartY    = useRef(0);
  const touchStartTime = useRef(0);
  const touchActedRef  = useRef(false);

  const canvasW = useRef(0);
  const canvasH = useRef(0);
  const groundY = useRef(0);
  const dinoX   = useRef(0);

  const gameStateRef = useRef<GameState>(makeInitialState(0));

  const [displayScore,      setDisplayScore]      = useState(0);
  const [displayStage,      setDisplayStage]      = useState(1);
  const [displayDist,       setDisplayDist]       = useState("0m");
  const [displayLives,      setDisplayLives]      = useState(MAX_LIVES);
  const [displayCoins,      setDisplayCoins]      = useState(0);
  const [displayStageLabel, setDisplayStageLabel] = useState("🌤 CHILL");
  const [, setTick]   = useState(0);
  const [muted,           setMuted]           = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const isGameOver = gameStateRef.current.gameOver;
  const isWon      = gameStateRef.current.won;

  useEffect(() => {
    setMiniAppReady();
    audioRef.current = new AudioEngine();
  }, [setMiniAppReady]);

  useEffect(() => {
  const container = containerRef.current;
  const canvas    = canvasRef.current;
  if (!container || !canvas) return;

  function resize() {
    if (!container || !canvas) return;
    const insets = context?.client?.safeAreaInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const W    = container.offsetWidth || window.innerWidth;
    const rawH = window.innerHeight || document.documentElement.clientHeight;
    const maxH = Math.max(rawH - insets.top - insets.bottom - 60, 200); // never collapse to 0
    const H    = Math.min(maxH, Math.floor(W * 0.55));
    canvas.width  = W;
    canvas.height = H;
    canvasW.current = W;
    canvasH.current = H;
    groundY.current = Math.floor(H * GROUND_RATIO);
    dinoX.current   = Math.floor(W * 0.1);
    gameStateRef.current = makeInitialState(groundY.current);
  }

  resize();
  // Retry once shortly after — covers the case where Base App's native
  // context/layout data arrives a beat after first paint
  const retryTimer = setTimeout(resize, 300);
  window.addEventListener("resize", resize);

  return () => {
    clearTimeout(retryTimer);
    window.removeEventListener("resize", resize);
  };
}, [context]);

  // ─── Schedule helpers ──────────────────────────────────────────────────────
  const scheduleNextSpawn = useCallback((g: GameState) => {
    const idx    = Math.min(g.stage - 1, 6);
    const base   = STAGE_SPAWN_GAPS[idx];
    const jitter = STAGE_JITTER[idx];
    g.nextSpawnFrame = g.frameCount + base +
      Math.floor((Math.random() * 2 - 1) * jitter);
  }, []);

  const scheduleNextCoin = useCallback((g: GameState) => {
    const gap = STAGE_COIN_GAPS[Math.min(g.stage - 1, 6)];
    g.nextCoinFrame = g.frameCount + gap + Math.floor(Math.random() * 30);
  }, []);

  // ─── Arc helpers ────────────────────────────────────────────────────────────
  const getArcGaps = useCallback(() => {
    const g  = gameStateRef.current;
    const jv = Math.abs(JUMP_FORCE) * (canvasH.current / 600);
    const singleArc = (2 * jv) / GRAVITY;
    return {
      shortGap:   singleArc * g.speed * 0.55,
      landingGap: singleArc * g.speed * 1.05,
    };
  }, []);

  // ─── Draw helpers ──────────────────────────────────────────────────────────
  const drawDino = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, s: number, invincible: number, ducking: boolean
  ) => {
    if (invincible > 0 && Math.floor(invincible / 8) % 2 === 0) return;
    if (ducking) {
      ctx.fillStyle = "#1E88E5";
      ctx.fillRect(x - 5*s,  y + 28*s, 50*s, 28*s);
      ctx.fillRect(x + 18*s, y + 14*s, 32*s, 18*s);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(x + 38*s, y + 17*s, 7*s, 7*s);
      ctx.fillStyle = "#000";
      ctx.fillRect(x + 40*s, y + 19*s, 3*s, 3*s);
      ctx.fillStyle = "#1565C0";
      ctx.fillRect(x - 18*s, y + 32*s, 16*s, 10*s);
      ctx.fillStyle = "#42A5F5";
      ctx.fillRect(x + 2*s,  y + 32*s, 22*s, 14*s);
      return;
    }
    ctx.fillStyle = "#1E88E5";
    ctx.fillRect(x,        y + 20*s, 40*s, 35*s);
    ctx.fillRect(x + 15*s, y,        30*s, 25*s);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x + 35*s, y + 5*s,  8*s,  8*s);
    ctx.fillStyle = "#000";
    ctx.fillRect(x + 37*s, y + 7*s,  4*s,  4*s);
    ctx.fillStyle = "#1565C0";
    ctx.fillRect(x - 15*s, y + 25*s, 18*s, 12*s);
    ctx.fillRect(x + 5*s,  y + 52*s, 10*s, 12*s);
    ctx.fillRect(x + 22*s, y + 52*s, 10*s, 12*s);
    ctx.fillStyle = "#42A5F5";
    ctx.fillRect(x + 8*s,  y + 25*s, 20*s, 18*s);
  }, []);

  const drawCactus = useCallback((
    ctx: CanvasRenderingContext2D, x: number, y: number, s: number
  ) => {
    ctx.fillStyle = "#2E7D32";
    ctx.fillRect(x + 10*s, y,        15*s, 55*s);
    ctx.fillRect(x,        y + 10*s, 12*s, 10*s);
    ctx.fillRect(x,        y,         8*s, 18*s);
    ctx.fillRect(x + 22*s, y + 15*s, 12*s, 10*s);
    ctx.fillRect(x + 26*s, y + 5*s,   8*s, 18*s);
    ctx.fillStyle = "#43A047";
    ctx.fillRect(x + 13*s, y + 3*s,   5*s, 48*s);
  }, []);

  const drawBatLow = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, frame: number, s: number
  ) => {
    const wingUp = Math.sin(frame * 0.2) > 0;
    ctx.fillStyle = "#6A0080";
    ctx.fillRect(x + 10*s, y + 8*s, 20*s, 14*s);
    if (wingUp) {
      ctx.fillRect(x,        y,        12*s, 16*s);
      ctx.fillRect(x + 28*s, y,        12*s, 16*s);
    } else {
      ctx.fillRect(x,        y + 10*s, 12*s, 16*s);
      ctx.fillRect(x + 28*s, y + 10*s, 12*s, 16*s);
    }
    ctx.fillStyle = "#FF1744";
    ctx.fillRect(x + 12*s, y + 10*s, 4*s, 4*s);
    ctx.fillRect(x + 22*s, y + 10*s, 4*s, 4*s);
  }, []);

  const drawBatSkim = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, frame: number, s: number
  ) => {
    const wingUp = Math.sin(frame * 0.2) > 0;
    ctx.fillStyle = "#D84315";
    ctx.fillRect(x + 10*s, y + 8*s, 20*s, 14*s);
    if (wingUp) {
      ctx.fillRect(x,        y,        12*s, 16*s);
      ctx.fillRect(x + 28*s, y,        12*s, 16*s);
    } else {
      ctx.fillRect(x,        y + 10*s, 12*s, 16*s);
      ctx.fillRect(x + 28*s, y + 10*s, 12*s, 16*s);
    }
    ctx.fillStyle = "#FFEB3B";
    ctx.fillRect(x + 12*s, y + 10*s, 4*s, 4*s);
    ctx.fillRect(x + 22*s, y + 10*s, 4*s, 4*s);
  }, []);

  const drawBatHigh = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, frame: number, s: number, glow: boolean
  ) => {
    const wingUp = Math.sin(frame * 0.25) > 0;
    if (glow) {
      const pulse = Math.sin(frame * 0.3) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(0,229,255,${0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(x + 25*s, y + 12*s, 30*s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#00E5FF";
    ctx.fillRect(x + 8*s, y + 8*s, 24*s, 12*s);
    if (wingUp) {
      ctx.fillRect(x - 6*s,  y - 2*s, 16*s, 18*s);
      ctx.fillRect(x + 30*s, y - 2*s, 16*s, 18*s);
    } else {
      ctx.fillRect(x - 6*s,  y + 8*s, 16*s, 18*s);
      ctx.fillRect(x + 30*s, y + 8*s, 16*s, 18*s);
    }
    ctx.fillStyle = "#001A1A";
    ctx.fillRect(x + 11*s, y + 11*s, 4*s, 4*s);
    ctx.fillRect(x + 23*s, y + 11*s, 4*s, 4*s);
  }, []);

  const drawCoin = useCallback((
    ctx: CanvasRenderingContext2D,
    coin: Coin, frame: number, s: number
  ) => {
    if (coin.collected) return;
    const pulse = Math.sin(frame * 0.1 + coin.x) * 0.15 + 0.85;
    const r = coin.size * s * pulse;
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(coin.x + r, coin.y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFF176";
    ctx.beginPath();
    ctx.arc(coin.x + r * 0.65, coin.y + r * 0.65, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F9A825";
    ctx.font = `bold ${Math.floor(r * 1.2)}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText("$", coin.x + r, coin.y + r * 1.4);
  }, []);

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    const g          = gameStateRef.current;
    const W          = canvasW.current;
    const H          = canvasH.current;
    const GY         = groundY.current;
    const DX         = dinoX.current;
    const s          = H / 600;
    const stageStyle = STAGE_STYLES[g.stage - 1] ?? STAGE_STYLES[0];

    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, stageStyle.sky1);
    grad.addColorStop(1, stageStyle.sky2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (g.stage >= 4) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 137 + g.frameCount * 0.2) % W);
        const sy = ((i * 97) % (GY * 0.8));
        ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
      }
    }

    ctx.fillStyle = "#43A047";
    ctx.fillRect(0, GY, W, 4);
    ctx.fillStyle = "#6D4C41";
    ctx.fillRect(0, GY + 4, W, H - GY - 4);
    ctx.fillStyle = "#5D4037";
    ctx.fillRect(0, GY + 8, W, 2);

    g.coins.forEach(coin => drawCoin(ctx, coin, g.frameCount, s));
    g.obstacles.forEach(obs => {
      if (obs.type === "cactus")        drawCactus(ctx, obs.x, obs.y, s);
      else if (obs.type === "bat_low")  drawBatLow(ctx, obs.x, obs.y, g.frameCount, s);
      else if (obs.type === "bat_skim") drawBatSkim(ctx, obs.x, obs.y, g.frameCount, s);
      else                              drawBatHigh(ctx, obs.x, obs.y, g.frameCount, s, !g.seenBatHigh);
    });
    drawDino(ctx, DX, g.dinoY, s, g.invincible, g.ducking);

    if (g.won || g.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      return;
    }

    if (!g.started) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${Math.floor(30 * s)}px Arial`;
      ctx.fillText("🦖 DINO RUNNER", W / 2, H / 2 - 36*s);
      ctx.font = `${Math.floor(13 * s)}px Arial`;
      ctx.fillStyle = "#FFD700";
      ctx.fillText("🟣 Low bat: JUMP   🟠 Skim bat: DUCK or JUMP", W / 2, H / 2 - 10*s);
      ctx.fillStyle = "#00E5FF";
      ctx.fillText("🔵 High bat: single jump or duck — NEVER double jump", W / 2, H / 2 + 12*s);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `${Math.floor(14 * s)}px Arial`;
      ctx.fillText("Tap / Space to start & jump", W / 2, H / 2 + 38*s);
      ctx.fillText("Swipe down / ↓ / S to duck", W / 2, H / 2 + 58*s);
    }
  }, [drawDino, drawCactus, drawBatLow, drawBatSkim, drawBatHigh, drawCoin]);

  // ─── Spawn obstacle ────────────────────────────────────────────────────────
  const spawnObstacle = useCallback(() => {
    const g  = gameStateRef.current;
    const W  = canvasW.current;
    const GY = groundY.current;
    const s  = canvasH.current / 600;

    const last   = g.obstacles[g.obstacles.length - 1];
    const minGap = W * (g.stage <= 3 ? 0.55 : g.stage <= 5 ? 0.42 : 0.32);
    if (last && last.x > W - minGap) { scheduleNextSpawn(g); return; }

    const { shortGap, landingGap } = getArcGaps();
    const pattern = pickPattern(g.stage);

    switch (pattern) {
      case "A":
        g.obstacles.push({ x: W, y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus" });
        break;
      case "B":
        g.obstacles.push({ x: W, y: GY - 25*s, width: 40*s, height: 22*s, type: "bat_low" });
        break;
      case "C":
        g.obstacles.push({ x: W, y: GY - 50*s, width: 40*s, height: 22*s, type: "bat_skim" });
        break;
      case "D":
        g.obstacles.push({ x: W,        y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus" });
        g.obstacles.push({ x: W + 65*s, y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus" });
        break;
      case "E":
        g.obstacles.push({ x: W,            y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus"  });
        g.obstacles.push({ x: W + shortGap, y: GY - 25*s, width: 40*s, height: 22*s, type: "bat_low" });
        break;
      case "F":
        g.obstacles.push({ x: W,              y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus"   });
        g.obstacles.push({ x: W + landingGap, y: GY - 50*s, width: 40*s, height: 22*s, type: "bat_skim" });
        break;
      case "G":
        g.obstacles.push({ x: W,        y: GY - 25*s, width: 40*s, height: 22*s, type: "bat_low"  });
        g.obstacles.push({ x: W + 50*s, y: GY - 50*s, width: 40*s, height: 22*s, type: "bat_skim" });
        break;
      case "H":
        g.obstacles.push({ x: W,              y: GY - 50*s, width: 40*s, height: 22*s, type: "bat_skim" });
        g.obstacles.push({ x: W + landingGap, y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus"   });
        break;
      case "I":
        g.obstacles.push({ x: W,                 y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus"   });
        g.obstacles.push({ x: W + shortGap,       y: GY - 25*s, width: 40*s, height: 22*s, type: "bat_low"  });
        g.obstacles.push({ x: W + shortGap * 1.6, y: GY - 50*s, width: 40*s, height: 22*s, type: "bat_skim" });
        break;
      case "J":
        g.obstacles.push({ x: W,            y: GY - 55*s,  width: 35*s, height: 55*s, type: "cactus"   });
        g.obstacles.push({ x: W + shortGap, y: GY - 120*s, width: 44*s, height: 22*s, type: "bat_high" });
        break;
      case "K":
        g.obstacles.push({ x: W,        y: GY - 25*s,  width: 40*s, height: 22*s, type: "bat_low"  });
        g.obstacles.push({ x: W + 40*s, y: GY - 120*s, width: 44*s, height: 22*s, type: "bat_high" });
        break;
      default:
        g.obstacles.push({ x: W, y: GY - 55*s, width: 35*s, height: 55*s, type: "cactus" });
    }

    if (pattern === "J" || pattern === "K") g.seenBatHigh = true;
    scheduleNextSpawn(g);
  }, [scheduleNextSpawn, getArcGaps]);

  // ─── Spawn coin ────────────────────────────────────────────────────────────
  const spawnCoin = useCallback(() => {
    const g  = gameStateRef.current;
    const W  = canvasW.current;
    const GY = groundY.current;
    const s  = canvasH.current / 600;
    let coinY: number;
    if (g.stage <= 3) {
      const r = Math.random();
      coinY = r < 0.5 ? GY - 30*s : r < 0.8 ? GY - 80*s : GY - 130*s;
    } else {
      coinY = Math.random() < 0.6 ? GY - 130*s : GY - 30*s;
    }
    g.coins.push({ x: W, y: coinY, size: 14, collected: false, frame: g.frameCount });
    scheduleNextCoin(g);
  }, [scheduleNextCoin]);

  // ─── Hitbox ────────────────────────────────────────────────────────────────
  const getDinoHitbox = useCallback(() => {
    const g  = gameStateRef.current;
    const s  = canvasH.current / 600;
    const DX = dinoX.current;
    if (g.ducking) return { x: DX - 5*s, y: g.dinoY + 28*s, w: 50*s, h: 28*s };
    return { x: DX, y: g.dinoY, w: 40*s, h: 60*s };
  }, []);

  const checkObstacleCollision = useCallback((obs: Obstacle) => {
    const s   = canvasH.current / 600;
    const pad = 8 * s;
    const hb  = getDinoHitbox();
    return (
      hb.x + pad < obs.x + obs.width - pad &&
      hb.x + hb.w - pad > obs.x + pad &&
      hb.y + pad < obs.y + obs.height - pad &&
      hb.y + hb.h - pad > obs.y + pad
    );
  }, [getDinoHitbox]);

  const checkCoinCollision = useCallback((coin: Coin) => {
    const g  = gameStateRef.current;
    const DX = dinoX.current;
    const s  = canvasH.current / 600;
    const r  = coin.size * s;
    const dinoCY = g.ducking ? g.dinoY + 42*s : g.dinoY + 30*s;
    const dx = (coin.x + r) - (DX + 20*s);
    const dy = (coin.y + r) - dinoCY;
    return Math.sqrt(dx*dx + dy*dy) < r + 20*s;
  }, []);

  // ─── Game loop ─────────────────────────────────────────────────────────────
  const gameLoop = useCallback(() => {
    if (!isRunningRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g  = gameStateRef.current;
    const GY = groundY.current;
    const s  = canvasH.current / 600;

    if (g.started && !g.gameOver && !g.won) {
      g.frameCount++;
      g.distance += g.speed;
      g.score    += 0.1;

      if (g.distance >= WIN_DISTANCE) {
        g.won = true;
        setDisplayScore(Math.floor(g.score));
        setDisplayDist(`${Math.floor(g.distance / 25.2)}m`);
        setDisplayCoins(g.totalCoins);
        setTick(t => t + 1);
        if (!mutedRef.current) audioRef.current?.playWin();
      }

      const prevStage = g.stage;
      let newStage = 1;
      for (let i = STAGE_THRESHOLDS.length - 1; i >= 0; i--) {
        if (g.distance >= STAGE_THRESHOLDS[i]) { newStage = i + 1; break; }
      }
      g.stage = Math.min(newStage, 7);
      g.speed = STAGE_SPEEDS[g.stage - 1];
      if (g.stage !== prevStage && !mutedRef.current) audioRef.current?.playStageChange(g.stage);

      if (g.invincible > 0) g.invincible--;
      if (g.duckTimer > 0) { g.duckTimer--; if (g.duckTimer === 0) g.ducking = false; }

      g.dinoVY += GRAVITY;
      g.dinoY  += g.dinoVY;
      if (g.dinoY >= GY - 60*s) {
        g.dinoY = GY - 60*s; g.dinoVY = 0;
        g.isJumping = false; g.jumpCount = 0;
      }

      if (g.frameCount >= g.nextSpawnFrame) spawnObstacle();
      if (g.frameCount >= g.nextCoinFrame)  spawnCoin();

      g.obstacles = g.obstacles.map(o => ({ ...o, x: o.x - g.speed })).filter(o => o.x > -100);
      g.coins     = g.coins.map(c => ({ ...c, x: c.x - g.speed })).filter(c => c.x > -50);

      g.coins.forEach(coin => {
        if (!coin.collected && checkCoinCollision(coin)) {
          coin.collected = true;
          g.totalCoins++;
          g.score += 5;
          if (!mutedRef.current) audioRef.current?.playCoin();
        }
      });

      if (g.invincible === 0 && g.obstacles.some(checkObstacleCollision)) {
        g.lives--;
        if (g.lives <= 0) {
          g.gameOver = true;
          setDisplayScore(Math.floor(g.score));
          setDisplayDist(`${Math.floor(g.distance / 25.2)}m`);
          setDisplayCoins(g.totalCoins);
          setTick(t => t + 1);
          if (!mutedRef.current) audioRef.current?.playGameOver();
        } else {
          g.invincible = INVINCIBILITY_FRAMES;
          if (!mutedRef.current) audioRef.current?.playHit();
        }
      }

      displaySyncRef.current++;
      if (displaySyncRef.current % 10 === 0) {
        setDisplayScore(Math.floor(g.score));
        setDisplayStage(g.stage);
        setDisplayDist(`${Math.floor(g.distance / 25.2)}m`);
        setDisplayLives(g.lives);
        setDisplayCoins(g.totalCoins);
        setDisplayStageLabel(STAGE_STYLES[g.stage - 1]?.label ?? "");
      }
    }

    draw(ctx);
    animFrameRef.current = requestAnimationFrame(gameLoop);
  }, [draw, spawnObstacle, spawnCoin, checkObstacleCollision, checkCoinCollision]);

  // ─── Jump / Duck ───────────────────────────────────────────────────────────
  useEffect(() => {
    jumpRef.current = () => {
      const g  = gameStateRef.current;
      const GY = groundY.current;
      audioRef.current?.resume();
      if (g.gameOver || g.won) {
        gameStateRef.current = makeInitialState(GY);
        setDisplayScore(0); setDisplayStage(1); setDisplayDist("0m");
        setDisplayLives(MAX_LIVES); setDisplayCoins(0);
        setDisplayStageLabel("🌤 CHILL");
        resetWrite();
        setIsSubmitted(false);
        setTick(t => t + 1);
        return;
      }
      if (!g.started) g.started = true;
      if (g.jumpCount < 2) {
        g.ducking = false; g.duckTimer = 0;
        g.dinoVY = JUMP_FORCE * (canvasH.current / 600);
        g.isJumping = true; g.jumpCount++;
        if (!mutedRef.current) audioRef.current?.playJump();
      }
    };
    duckStartRef.current = () => {
      const g = gameStateRef.current;
      if (g.gameOver || g.won || !g.started) return;
      if (!g.ducking && !mutedRef.current) audioRef.current?.playDuck();
      g.ducking = true; g.duckTimer = 0;
    };
    duckEndRef.current = () => {
      const g = gameStateRef.current;
      if (g.duckTimer === 0) g.ducking = false;
    };
  }, [resetWrite]);

  // ─── Keyboard ──────────────────────────────────────────────────────────────
useEffect(() => {
  isRunningRef.current = true;

  // Wait for canvas to be measured before starting loop (fixes mobile blank screen)
  const waitForCanvas = () => {
    if (canvasH.current === 0) {
      requestAnimationFrame(waitForCanvas);
      return;
    }
    animFrameRef.current = requestAnimationFrame(gameLoop);
  };
  waitForCanvas();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space")                          { e.preventDefault(); jumpRef.current(); }
    if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); duckStartRef.current(); }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); duckEndRef.current(); }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup",   onKeyUp);
  return () => {
    isRunningRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup",   onKeyUp);
  };
}, [gameLoop]);

// ─── Touch ─────────────────────────────────────────────────────────────────
const handleTouchStart = useCallback((e: React.TouchEvent) => {
  // Don't preventDefault here — lets scroll and gestures work naturally
  const t = e.touches[0];
  touchStartY.current    = t.clientY;
  touchStartTime.current = Date.now();
  touchActedRef.current  = false;
}, []);

const handleTouchMove = useCallback((e: React.TouchEvent) => {
  e.preventDefault(); // Prevent page scroll while swiping down to duck
  if (touchActedRef.current) return;
  const t  = e.touches[0];
  const dy = t.clientY - touchStartY.current;
  const dx = Math.abs(t.clientX - touchStartY.current); // ignore horizontal swipes
  const dt = Date.now() - touchStartTime.current;
  // Only trigger duck on deliberate downward swipe, not accidental touch drift
  if (dy > 25 && dy > dx && dt < 350) {
    touchActedRef.current = true;
    const g = gameStateRef.current;
    if (!g.ducking && !mutedRef.current) audioRef.current?.playDuck();
    g.ducking   = true;
    g.duckTimer = DUCK_FRAMES;
  }
}, []);

const handleTouchEnd = useCallback((e: React.TouchEvent) => {
  e.preventDefault();
  if (!touchActedRef.current) jumpRef.current();
  touchActedRef.current = false;
}, []);

const handleClick = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  jumpRef.current();
}, []);

const toggleMute = useCallback(() => {
  const next = !mutedRef.current;
  mutedRef.current = next;
  setMuted(next);
}, []);

  // ─── Submit score — fire the write, show "Submitted" the instant the
  //     wallet returns a hash. No more in-app receipt detection. ─────────────
  const handleSubmitScore = useCallback(() => {
    writeContract(
      {
        address: DINO_CONTRACT_ADDRESS,
        abi: DINO_LEADERBOARD_ABI,
        functionName: "submitScore",
        args: [BigInt(displayScore)],
      },
      {
        onSuccess: () => {
          setIsSubmitted(true);
        },
      }
    );
  }, [writeContract, displayScore]);

  const insets = context?.client?.safeAreaInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const heartsDisplay = Array.from({ length: MAX_LIVES }, (_, i) =>
    i < displayLives ? "❤️" : "🖤"
  ).join("");

  const submitLabel = isWritePending ? "Confirm in wallet..." : "Submit Score Onchain";

  return (
    <div className="game-root" style={{
  width: "100%", display: "flex", flexDirection: "column",
      background: "linear-gradient(160deg, #0f0c29 0%, #302b63 60%, #24243e 100%)",
      paddingTop: insets.top, paddingBottom: insets.bottom,
      paddingLeft: insets.left, paddingRight: insets.right,
      boxSizing: "border-box", overflow: "hidden", fontFamily: "Arial, sans-serif",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", flexDirection: "row", justifyContent: "space-between",
        alignItems: "center", padding: "8px 14px", flexShrink: 0,
        background: "rgba(0,0,0,0.35)", borderBottom: "1px solid rgba(255,255,255,0.08)", gap: 8,
      }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 80 }}>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>🦖 DINO</span>
          <span style={{ color: "#FFD700", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{displayStageLabel}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "center", flex: 1, justifyContent: "center" }}>
          {([["SCORE", displayScore], ["DIST", displayDist], ["STG", displayStage]] as [string, string | number][]).map(([label, val]) => (
            <div key={label} style={{ textAlign: "center", minWidth: 36 }}>
              <div style={{ color: "#FFD700", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
              <div style={{ color: "#fff", fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{val}</div>
            </div>
          ))}
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#FFD700", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>LIVES</div>
            <div style={{ fontSize: 13, lineHeight: 1.3 }}>{heartsDisplay}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 44 }}>
            <div style={{ color: "#FFD700", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>COINS</div>
            <div style={{ color: "#FFD700", fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>🪙{displayCoins}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setShowLeaderboard(true)} style={{
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8, color: "#fff", fontSize: 14, width: 30, height: 30,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>🏆</button>
          <button onClick={toggleMute} style={{
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8, color: "#fff", fontSize: 14, width: 30, height: 30,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        style={{ flex: 1, width: "100%", overflow: "hidden", touchAction: "none", position: "relative" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%", cursor: "pointer" }}
          onClick={handleClick}
        />

        {/* ── Game Over / Win overlay ── */}
        {(isGameOver || isWon) && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              pointerEvents: "auto",
              background: "rgba(20,20,40,0.92)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16, padding: "24px 28px",
              textAlign: "center", maxWidth: 320, width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: isWon ? "#FFD700" : "#FF1744", marginBottom: 8 }}>
                {isWon ? "🏆 YOU WIN!" : "GAME OVER"}
              </div>
              <div style={{ color: "#fff", fontSize: 18, marginBottom: 4 }}>
                Score: <strong>{displayScore}</strong>
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginBottom: 4 }}>
                Distance: {displayDist}
              </div>
              <div style={{ color: "#FFD700", fontSize: 14, marginBottom: 16 }}>
                Coins: {displayCoins} 🪙
              </div>

              {!isSubmitted ? (
                !isConnected ? (
                  <div style={{ marginBottom: 12 }}>
                    <Wallet><ConnectWallet /></Wallet>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <button
                      onClick={handleSubmitScore}
                      disabled={isWritePending}
                      style={{
                        background: isWritePending ? "#555" : "#1E88E5",
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        padding: "12px 20px",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: isWritePending ? "default" : "pointer",
                        width: "100%",
                      }}
                    >
                      {submitLabel}
                    </button>
                    {writeError && (
                      <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 8 }}>
                        {writeError.message?.includes("User rejected")
                          ? "Cancelled in wallet"
                          : "Couldn't send — try again"}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#4CAF50", fontSize: 14, marginBottom: 4 }}>
                    ✅ Score submitted!
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginBottom: 6 }}>
                    Check your wallet or BaseScan to confirm it landed.
                  </div>
                  {txHash && (
                    <a
                      href={`https://basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#64B5F6", fontSize: 12 }}
                    >
                      View transaction
                    </a>
                  )}
                </div>
              )}

              <button
                onClick={() => jumpRef.current()}
                style={{
                  background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8, color: "#fff", padding: "10px 20px",
                  fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%",
                }}
              >
                🔄 Play Again
              </button>
            </div>
          </div>
        )}

        {/* ── Leaderboard modal ── */}
        {showLeaderboard && (
          <Leaderboard onClose={() => setShowLeaderboard(false)} />
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        textAlign: "center", padding: "5px 0 8px",
        color: "rgba(255,255,255,0.3)", fontSize: 11, flexShrink: 0, letterSpacing: 1,
      }}>
        TAP/SPACE: JUMP • SWIPE DOWN / ↓ / S: DUCK
      </div>
    </div>
  );
}