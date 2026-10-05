export interface ScrapeTCIRes {
    success: boolean;
    data:    Data;
}

export interface Data {
    issn:                   string;
    eissn:                  null;
    journal_name:           string;
    journal_name_th:        null;
    publisher:              string;
    publisher_th:           string;
    database_source:        string;
    website:                string;
    abbrev_name:            string;
    tci_tier:               number;
    tci_status:             string;
    tci_inactive:           boolean;
    main_area:              null;
    major_area:             string;
    minor_area:             null;
    volume_per_year:        null;
    issue_per_volume:       string;
    prev_name:              null;
    prev_name_th:           null;
    scopus_quartile_data:   null;
    scopus_best_quartile:   null;
    scopus_best_percentile: null;
    scopus_h_index:         null;
    scopus_citescore:       null;
    scopus_sjr:             null;
    scopus_snip:            null;
    scopus_discontinued:    null;
    subject_areas:          null;
    coverage_start_year:    null;
    coverage_end_year:      null;
    fetch_method:           string;
    fromCache:              boolean;
}
