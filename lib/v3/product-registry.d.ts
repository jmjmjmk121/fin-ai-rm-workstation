import type { GovernedFact, ProductRecord, SourceReference } from './product-contracts';

export type ListedMarketData = {
  asOf: string;
  adjustedPriceFlag: 'Y' | 'N';
  priceReturnBasis: 'CLOSE_PRICE';
  returnType: 'PRICE_RETURN';
  totalReturnAvailable: false;
  prior: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  average: number | null;
  totalVolume: number | null;
  totalValue: number | null;
  marketCap: number | null;
  bvps: number | null;
  nav: number | null;
  navField: 'bvps' | null;
  navSemantics: string;
  source: SourceReference;
};

export type ListedProduct = ProductRecord & {
  productId: `SETSMART:${string}`;
  family: 'LISTED_SECURITY';
  symbol: string;
  securityType: string;
  marketData: ListedMarketData;
};

export type ProductQuery = {
  source?: 'SETSMART';
  q?: string;
  search?: string;
  text?: string;
  securityType?: string | string[];
  securityTypes?: string[];
  symbols?: string | string[];
  asOfDate?: string;
  lookbackDays?: number;
  adjustedPriceFlag?: 'Y' | 'N';
  minClose?: number;
  maxClose?: number;
  minMarketCap?: number;
  minTotalValue?: number;
  sortBy?: 'symbol' | 'securityType' | 'close' | 'marketCap' | 'totalValue' | 'totalVolume';
  sortDirection?: 'asc' | 'desc';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type ProductSearchResult = {
  provider: 'SETSMART';
  products: ReadonlyArray<ListedProduct>;
  total: number;
  returned: number;
  offset: number;
  limit: number;
  countsBySecurityType: Readonly<Record<string, number>>;
  requestedAsOf: string | null;
  marketAsOf: string | null;
  adjustedPriceFlag: 'Y' | 'N';
  returnType: 'PRICE_RETURN';
  totalReturnAvailable: boolean;
  source: Readonly<Record<string, unknown>>;
};

export type PriceObservation = {
  productId: `SETSMART:${string}`;
  symbol: string;
  securityType: string;
  date: string;
  asOf: string;
  close: number | null;
  returnType: 'PRICE_RETURN';
  totalReturnAvailable: false;
  source: SourceReference;
};

export type UnsupportedCorporateActions = GovernedFact<never> & {
  availability: 'NOT_SUPPORTED';
  value: null;
};

export declare class SetSmartListedProductDataProvider {
  constructor(options?: Record<string, unknown>);
  searchProducts(query?: ProductQuery): Promise<Readonly<ProductSearchResult>>;
  getProduct(productId: string): Promise<Readonly<ListedProduct>>;
  getHistory(productId: string, startDate: string, endDate?: string): Promise<ReadonlyArray<Readonly<PriceObservation>>>;
  getCorporateActions(productId: string, startDate?: string, endDate?: string): Promise<Readonly<UnsupportedCorporateActions>>;
  providerStatus(): Readonly<Record<string, unknown>>;
}

export declare class ProductDataProviderRegistry {
  constructor(options?: Record<string, unknown>);
  searchProducts(query?: ProductQuery): Promise<Readonly<ProductSearchResult>>;
  getProduct(productId: string): Promise<Readonly<ListedProduct>>;
  getHistory(productId: string, startDate: string, endDate?: string): Promise<ReadonlyArray<Readonly<PriceObservation>>>;
  getCorporateActions(productId: string, startDate?: string, endDate?: string): Promise<Readonly<UnsupportedCorporateActions>>;
  providerStatus(source?: string): Readonly<Record<string, unknown>> | null;
}

export declare function createProductDataProviderRegistry(options?: Record<string, unknown>): ProductDataProviderRegistry;
export declare function productIdForSymbol(symbol: string): `SETSMART:${string}`;
export declare function symbolFromProductId(productId: string): string;
