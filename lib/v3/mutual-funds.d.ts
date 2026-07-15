export type FundQuery = Record<string, unknown>;
export type FundMaster = Record<string, unknown>;
export type FundProfile = Record<string, unknown>;
export type FundShareClass = Record<string, unknown>;
export type NavObservation = Record<string, unknown>;
export type FundDocumentReference = Record<string, unknown>;
export type FundAllocationSnapshot = Record<string, unknown>;

export interface MutualFundDataProvider {
  getFundMaster(query: FundQuery): Promise<FundMaster[]>;
  getFundProfile(fundId: string): Promise<FundProfile>;
  getShareClasses(masterFundId: string): Promise<FundShareClass[]>;
  getNavHistory(fundId: string, startDate: string, endDate: string): Promise<NavObservation[]>;
  getFundDocuments(fundId: string): Promise<FundDocumentReference[]>;
  getFundAllocation(fundId: string, asOf: string): Promise<FundAllocationSnapshot | null>;
  providerStatus?(): ProviderStatus;
}

export type ProviderStatus = {
  mode: string;
  status?: {
    state: 'READY' | 'CACHE_HIT' | 'REFRESHED' | 'STALE_FALLBACK' | 'ERROR' | string;
    at?: string;
    errorCode?: string | null;
    cacheAgeMs?: number | null;
  };
  cache?: {
    cachedEntries: number;
    freshEntries: number;
    staleFallbackEntries: number;
    inFlightRequests: number;
    ttlMs: number;
    staleFallbackMs: number;
  };
};
