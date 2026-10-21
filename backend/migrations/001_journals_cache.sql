-- ================================================================================
-- Migration 001: journals_cache  (คืนระบบ caching — TTL 6 ชั่วโมง)
-- รันกับ DB ที่มีข้อมูลอยู่แล้วได้ปลอดภัย (IF NOT EXISTS, ไม่แตะตารางอื่น)
-- backup ก่อนรันเสมอ · แถวหมดอายุถูกลบอัตโนมัติโดย JournalCache (ไม่มี job แยก)
-- ================================================================================
USE journal_watch_v2;

CREATE TABLE IF NOT EXISTS journals_cache (
    issn                    VARCHAR(20)   NOT NULL COMMENT 'p-ISSN ไม่มีขีด',
    database_source         ENUM('Scopus','TCI') NOT NULL,
    eissn                   VARCHAR(20)   NULL COMMENT 'ไม่มีขีด · ใช้ค้นด้วย e-ISSN',
    journal_name            VARCHAR(255)  NOT NULL,
    journal_name_th         VARCHAR(255)  NULL,
    publisher               VARCHAR(255)  NULL,
    publisher_th            VARCHAR(255)  NULL,
    website                 VARCHAR(255)  NULL,
    abbrev_name             VARCHAR(100)  NULL,
    prev_name               VARCHAR(255)  NULL,
    prev_name_th            VARCHAR(255)  NULL,

    -- Scopus
    scopus_quartile_data    JSON          NULL COMMENT 'array of {subject_area, quartile, ...}',
    scopus_best_quartile    VARCHAR(10)   NULL,
    scopus_best_percentile  INT           NULL,
    scopus_h_index          INT           NULL,
    scopus_total_docs       INT           NULL,
    open_access             VARCHAR(50)   NULL,
    open_access_type        VARCHAR(100)  NULL,
    scopus_citescore        DECIMAL(10,2) NULL,
    scopus_sjr              DECIMAL(10,4) NULL,
    scopus_snip             DECIMAL(10,4) NULL,
    scopus_discontinued     BOOLEAN       NOT NULL DEFAULT FALSE,
    subject_areas           JSON          NULL,
    coverage_start_year     VARCHAR(10)   NULL,
    coverage_end_year       VARCHAR(10)   NULL,

    -- TCI
    tci_tier                TINYINT       NULL,
    tci_status              VARCHAR(50)   NULL,
    tci_inactive            BOOLEAN       NOT NULL DEFAULT FALSE,
    main_area               VARCHAR(100)  NULL,
    major_area              VARCHAR(255)  NULL,
    minor_area              VARCHAR(255)  NULL,
    volume_per_year         VARCHAR(50)   NULL,
    issue_per_volume        VARCHAR(50)   NULL,

    -- Meta
    fetch_method            ENUM('API','Scraping') NOT NULL,
    last_updated            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'เวลาดึงข้อมูล (UTC) · TTL นับจากนี้ · อ่านจาก cache ไม่ต่ออายุ',

    PRIMARY KEY (issn, database_source),
    INDEX idx_jc_eissn   (eissn),
    INDEX idx_jc_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
