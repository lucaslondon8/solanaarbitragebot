import { Market } from './types';
import { PublicKey } from '@solana/web3.js';

// Represents an edge in our trading graph.
interface Edge {
  source: string;       // Source token mint address
  target: string;       // Target token mint address
  weight: number;       // The -log(price) of the trade
  market: Market;       // The market data for this edge
}

export interface ArbitrageOpportunity {
  cycle: string[];
  markets: Market[];
  profitPercentage: number;
}

/**
 * The core arbitrage discovery logic using the Bellman-Ford algorithm.
 * * How it works:
 * 1. We model the DEX markets as a directed graph where tokens are nodes
 * and a potential trade (e.g., SOL -> USDC on Orca) is a directed edge.
 * 2. The "weight" of an edge is the negative logarithm of the price (-log(price)).
 * 3. A profitable arbitrage cycle exists if there is a "negative cycle" in the graph.
 * Why? A cycle A -> B -> C -> A is profitable if price(A->B) * price(B->C) * price(C->A) > 1.
 * Taking the logarithm: log(p1) + log(p2) + log(p3) > 0.
 * Multiplying by -1: -log(p1) + -log(p2) + -log(p3) < 0.
 * This means the sum of our edge weights is negative. Bellman-Ford is excellent at finding such cycles.
 */
export function findArbitrage(markets: Market[]): ArbitrageOpportunity | null {
  const { graph, nodes } = buildGraph(markets);
  
  for (const sourceNode of nodes) {
    const distances: { [node: string]: number } = {};
    const predecessor: { [node: string]: Edge | null } = {};

    nodes.forEach(node => {
      distances[node] = Infinity;
      predecessor[node] = null;
    });
    distances[sourceNode] = 0;

    // Relax edges repeatedly
    for (let i = 0; i < nodes.length - 1; i++) {
      graph.forEach(edge => {
        if (distances[edge.source] + edge.weight < distances[edge.target]) {
          distances[edge.target] = distances[edge.source] + edge.weight;
          predecessor[edge.target] = edge;
        }
      });
    }

    // Check for negative cycles
    for (const edge of graph) {
      if (distances[edge.source] + edge.weight < distances[edge.target]) {
        // Negative cycle detected!
        let path: Edge[] = [];
        let current = edge;
        const cycleNodes = new Set<string>();

        // Backtrack to find the cycle
        for(let i=0; i < nodes.length; i++) {
          if (cycleNodes.has(current.source)) {
            // Found the start of the cycle
            path.unshift(current);
            break;
          }
          cycleNodes.add(current.source);
          path.unshift(current);
          const pred = predecessor[current.source];
          if (!pred) break;
          current = pred;
        }

        // Only consider simple 3-hop triangular arbitrage for now
        if (path.length === 3) {
            const profitFactor = Math.exp(-path.reduce((sum, p) => sum + p.weight, 0));
            return {
                cycle: path.map(p => p.source),
                markets: path.map(p => p.market),
                profitPercentage: (profitFactor - 1) * 100,
            };
        }
      }
    }
  }

  return null; // No arbitrage opportunity found
}

function buildGraph(markets: Market[]): { graph: Edge[], nodes: string[] } {
  const graph: Edge[] = [];
  const nodes = new Set<string>();

  markets.forEach(market => {
    const mintA = market.mintA.toBase58();
    const mintB = market.mintB.toBase58();
    nodes.add(mintA);
    nodes.add(mintB);

    // Edge A -> B
    graph.push({
      source: mintA,
      target: mintB,
      weight: -Math.log(market.priceBPerA),
      market: market,
    });
    
    // Edge B -> A
    graph.push({
      source: mintB,
      target: mintA,
      weight: -Math.log(market.priceAPerB),
      market: market,
    });
  });

  return { graph, nodes: Array.from(nodes) };
}
