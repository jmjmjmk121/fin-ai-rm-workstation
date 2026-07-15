export type ProductSource =
  | 'SETSMART'
  | 'BANK_PRODUCT_CATALOG'
  | 'BANK_POLICY'
  | 'FIXTURE';

export type FactAvailability = 'AVAILABLE' | 'MISSING' | 'NOT_SUPPORTED';

export type SourceReference = {
  type: ProductSource;
  sourceRef: string;
  asOf: string;
  version?: string;
};

export type GovernedFact<T = unknown> = {
  availability: FactAvailability;
  value: T | null;
  reasonCode?: string;
  source?: SourceReference | null;
};

export type ProductRecord = {
  productId: string;
  name: string;
  family: string;
  source: SourceReference;
  facts: {
    issuerOrProvider: GovernedFact;
    currency: GovernedFact;
    risk: GovernedFact;
    tenorOrLiquidity: GovernedFact;
    minimumInvestment: GovernedFact;
    fees: GovernedFact;
    payoffType: GovernedFact;
    capitalProtection: GovernedFact;
    eligibility: GovernedFact;
    requiredAccounts: GovernedFact;
    approvedShelfStatus: GovernedFact;
  };
};

export declare function validateProductRecord(product: ProductRecord): Readonly<ProductRecord>;
