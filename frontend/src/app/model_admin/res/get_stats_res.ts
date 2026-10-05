export interface GetStatsRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    users:         Users;
    pre_t3:        PreT3;
    t3:            PreT3;
    journal_cache: JournalCache;
    msu_unwanted:  MsuUnwanted;
    api_keys:      APIKey[];
}

export interface APIKey {
    index:       number;
    weeklyUsage: number;
    weeklyLimit: number;
    remaining:   number;
    isAvailable: boolean;
    lastResetAt: Date;
    keyPreview:  string;
}

export interface JournalCache {
    total:        number;
    scopus:       number;
    tci:          number;
    via_api:      number;
    via_scraping: number;
}

export interface MsuUnwanted {
    total: number;
}

export interface PreT3 {
    total:    number;
    pending:  number;
    approved: number;
    rejected: number;
}

export interface Users {
    total:       number;
    students:    number;
    supervisors: number;
    staff:       number;
    admins:      number;
    pending:     number;
    active:      number;
    suspended:   number;
}
