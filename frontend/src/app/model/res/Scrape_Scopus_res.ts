export interface ScrapeScopusRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    issn:                   string;
    eissn:                  null;
    journal_name:           string;
    journal_name_th:        null;
    publisher:              string;
    publisher_th:           null;
    database_source:        string;
    website:                null;
    abbrev_name:            null;
    tci_tier:               null;
    tci_status:             null;
    tci_inactive:           null;
    main_area:              null;
    major_area:             null;
    minor_area:             null;
    volume_per_year:        null;
    issue_per_volume:       null;
    prev_name:              null;
    prev_name_th:           null;
    scopus_quartile_data:   ScopusQuartileDatum[];
    scopus_best_quartile:   string;
    scopus_best_percentile: number;
    scopus_h_index:         null;
    scopus_citescore:       number;
    scopus_sjr:             number;
    scopus_snip:            number;
    scopus_discontinued:    boolean;
    subject_areas:          null;
    coverage_start_year:    string;
    coverage_end_year:      string;
    fetch_method:           string;
    fromCache:              boolean;
}

export interface ScopusQuartileDatum {
    rank:       string;
    year:       string;
    field:      string;
    asjcCode:   null;
    quartile:   string;
    percentile: number;
}
