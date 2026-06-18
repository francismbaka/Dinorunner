export const DINO_LEADERBOARD_ABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "_score", "type": "uint256" }],
    "name": "submitScore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMyBest",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalSubmissions",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "bestScores",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "limit", "type": "uint256" }],
    "name": "getTopScores",
    "outputs": [
      { "internalType": "address[]", "name": "players", "type": "address[]" },
      { "internalType": "uint256[]", "name": "scores", "type": "uint256[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "player",    "type": "address"  },
      { "indexed": false, "internalType": "uint256", "name": "score",     "type": "uint256"  },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"  }
    ],
    "name": "ScoreSubmitted",
    "type": "event"
  }
] as const;

export const DINO_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_DINO_CONTRACT_ADDRESS as `0x${string}`;