export interface SendPreT3Req {
    journal_snapshot: JournalSnapshot;
    article_info:     ArticleInfo;
    checklist_data:   { [key: string]: boolean };
}

export interface ArticleInfo {
    title_en: string;
    title_th: string;
}

export interface JournalSnapshot {
    issn:             string;
    journal_name:     string;
    journal_url:      string;
    indexed_database: string;
    quartile_or_tier: string;
    is_discontinued:  boolean;
    is_hijacked:      boolean;
    eissn:            string;
    sjr_score:        number;
    cite_score:       number;
}
