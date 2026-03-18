import {
  ContractLabel,
  ContractLabelSchema,
  ContractRegistry,
  ContractRegistrySchema,
  ContractCategory,
  RegistryStats,
} from './types.js';
import registryData from './data/registry.json' with { type: 'json' };

// ── Lookup Class ──────────────────────────────────────────────────

export class ContractRegistryLookup {
  private readonly entries: ContractLabel[];
  private readonly version: string;

  // address+chain → entry (for chain-specific lookups)
  private readonly byAddressChain = new Map<string, ContractLabel>();
  // address → entry (for any-chain fallback)
  private readonly byAddress = new Map<string, ContractLabel>();
  // protocol → entries
  private readonly byProtocol = new Map<string, ContractLabel[]>();
  // category → entries
  private readonly byCategory = new Map<string, ContractLabel[]>();

  constructor(raw: ContractRegistry) {
    const parsed = ContractRegistrySchema.parse(raw);
    this.version = parsed.version;
    this.entries = parsed.entries;
    this.buildIndexes();
  }

  private buildIndexes(): void {
    for (const entry of this.entries) {
      const addr = entry.address; // already lowercased by Zod transform
      const key = `${addr}:${entry.chain}`;

      this.byAddressChain.set(key, entry);

      // byAddress stores first seen — chain-specific lookup takes priority
      if (!this.byAddress.has(addr)) {
        this.byAddress.set(addr, entry);
      }

      // Index by protocol
      if (entry.protocol) {
        const existing = this.byProtocol.get(entry.protocol) ?? [];
        existing.push(entry);
        this.byProtocol.set(entry.protocol, existing);
      }

      // Index by category
      if (entry.category) {
        const existing = this.byCategory.get(entry.category) ?? [];
        existing.push(entry);
        this.byCategory.set(entry.category, existing);
      }
    }
  }

  /**
   * Look up a contract by address. If chain is provided, tries chain-specific
   * match first, then falls back to any-chain match.
   */
  lookup(address: string, chain?: string): ContractLabel | null {
    const addr = address.toLowerCase();

    if (chain) {
      const chainSpecific = this.byAddressChain.get(`${addr}:${chain}`);
      if (chainSpecific) return chainSpecific;
    }

    return this.byAddress.get(addr) ?? null;
  }

  /**
   * Look up multiple addresses at once. Returns a Map of address → entry.
   */
  batchLookup(addresses: string[], chain?: string): Map<string, ContractLabel> {
    const results = new Map<string, ContractLabel>();
    for (const addr of addresses) {
      const entry = this.lookup(addr, chain);
      if (entry) {
        results.set(addr.toLowerCase(), entry);
      }
    }
    return results;
  }

  /**
   * Check if a contract is flagged as high or critical risk.
   */
  isHighRisk(address: string, chain?: string): boolean {
    const entry = this.lookup(address, chain);
    if (!entry?.riskLevel) return false;
    return entry.riskLevel === 'high' || entry.riskLevel === 'critical';
  }

  /**
   * Get all entries for a protocol (e.g., "Uniswap", "Aave").
   */
  getByProtocol(name: string): ContractLabel[] {
    return this.byProtocol.get(name) ?? [];
  }

  /**
   * Get all entries in a category (e.g., "dex", "lending").
   */
  getByCategory(cat: ContractCategory): ContractLabel[] {
    return this.byCategory.get(cat) ?? [];
  }

  /**
   * Get all registry entries (for bulk operations like pre-compute).
   */
  getAllEntries(): ContractLabel[] {
    return [...this.entries];
  }

  /**
   * Get registry statistics.
   */
  getStats(): RegistryStats {
    const uniqueAddresses = new Set(this.entries.map((e) => e.address));
    const chains = [...new Set(this.entries.map((e) => e.chain))];
    const categoryCounts: Record<string, number> = {};
    for (const [cat, entries] of this.byCategory) {
      categoryCounts[cat] = entries.length;
    }

    return {
      version: this.version,
      totalEntries: this.entries.length,
      uniqueAddresses: uniqueAddresses.size,
      chains,
      categoryCounts,
      protocolCount: this.byProtocol.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────

let instance: ContractRegistryLookup | null = null;

export function getRegistry(): ContractRegistryLookup {
  if (!instance) {
    instance = new ContractRegistryLookup(registryData as ContractRegistry);
  }
  return instance;
}
