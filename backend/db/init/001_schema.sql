-- ================================================================================
-- JOURNAL WATCH — REDESIGNED SCHEMA (proposal, not yet applied to any real DB)
-- Goal stated by the team: make Pre-T3 / T3 submission and review AS SIMPLE AS
-- POSSIBLE for (a) students submitting and (b) staff reviewing.
-- This file is a from-scratch redesign for COMPARISON against the current
-- production schema (DB_SCHEMA_Final.sql) — not a migration script.
-- ================================================================================
--
-- DESIGN PRINCIPLES (why this looks different from the current schema)
-- --------------------------------------------------------------------
-- 1. No JSON blobs for approval workflow. The current schema stores every
--    approver's decision as a JSON object (advisor_approval, co_advisor_1_approval,
--    program_chair_approval, faculty_com_approval, grad_school_approval...) and then
--    had to bolt on STORED generated columns later (migrations 001/002) just to be
--    able to index/query "who approved what". Here, approvals are one row per step
--    in a single normalized table (`request_approvals`). Indexing is native, no
--    generated columns needed, and adding/removing an approval step is a data
--    change, not a schema change.
--
-- 2. No 'N/A' status hack. In the current schema, co_advisor_1_approval/
--    co_advisor_2_approval carry a status of 'N/A' when a student has no co-advisor.
--    Here we simply don't INSERT a row for a step that doesn't apply. A missing
--    row means "not applicable"; a Pending row means "waiting"; no fake enum value
--    needed.
--
-- 3. Snapshots become plain columns, not JSON. journal_snapshot/student_snapshot/
--    paper_and_research_details/publication_details/journal_metrics were all JSON
--    objects with a fixed, known shape (documented only in SQL comments). Since the
--    shape never actually varies, they are just normal typed columns here — easier
--    to validate, index, and query, and self-documenting via DESCRIBE.
--
-- 4. Two token tables merged into one. `refresh_tokens` and `password_reset_tokens`
--    were structurally identical (user_id, token_hash, expires_at, a "consumed"
--    timestamp, ip/user-agent). Merged into `auth_tokens` with a `token_type` enum.
--
-- 5. Evidence files become one row per file, not one JSON object per request.
--    T3 requires up to 6 supporting files; modeling that as a JSON object with
--    fixed keys forces every consumer to know the key names. A file table with a
--    `file_type` enum is equally fixed but query/joinable, and trivially extends if
--    the university ever adds a 7th required document.
--
-- 6. Pre-T3 checklist is 9 fixed booleans, not JSON. The paper form has exactly
--    9 fixed checklist items (see Pre-T3 form, page 1-2) — that never changes
--    per-request, so it is 9 real columns, not a JSON object with keys item1..item9.
--
-- 7. Reflects the REAL approval flow (per team clarification), not a maximal one:
--    Pre-T3  : Advisor -> Program_Chair -> Faculty_Committee
--              (+ Co_Advisor_1 / Co_Advisor_2 only if the student has them)
--    T3      : Advisor (+ Co-Advisors if any) -> Faculty_Committee -> Grad_School
--              Grad_School is not an in-system user — it is Staff relaying the
--              Graduate School's emailed decision (researchpublication@msu.ac.th)
--              back into the system, so its "approver" is an email, not a user_id.
--
-- Everything else (users, advisor_assignments,
-- msu_unwanted_journals, otp_requests) is conceptually the same as the current schema — those tables
-- were never the source of complexity, so they are carried over with only
-- light cleanup.
-- ================================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS journal_watch_v2
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE journal_watch_v2;

DROP TABLE IF EXISTS otp_requests;
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS t3_evidence_files;
DROP TABLE IF EXISTS request_approvals;
DROP TABLE IF EXISTS t3_requests;
DROP TABLE IF EXISTS pre_t3_requests;
DROP TABLE IF EXISTS msu_unwanted_journals;
DROP TABLE IF EXISTS advisor_assignments;
DROP TABLE IF EXISTS users;

-- ================================================================================
-- 1. users
-- ================================================================================
-- Same split as the current schema: Admin/SuperAdmin log in with username +
-- password, everyone else logs in with Google OAuth via MSU Mail. Kept because
-- it is a real invariant worth enforcing at the DB level, not because it was
-- copied — the CHECK constraint genuinely prevents a bad row from ever existing.
-- ================================================================================
CREATE TABLE users (
    user_id             INT             NOT NULL AUTO_INCREMENT,

    username            VARCHAR(50)     NULL COMMENT 'Admin/SuperAdmin login only',
    password_hash       VARCHAR(255)    NULL COMMENT 'bcrypt, NULL for OAuth users',

    msu_mail            VARCHAR(100)    NOT NULL COMMENT 'OAuth match key + contact email',

    role                ENUM('Student','Supervisor','Program_Chair','Staff','Admin','SuperAdmin')
                                        NOT NULL COMMENT 'Program_Chair signs Pre-T3 approvals per the paper form',
    prefix              VARCHAR(50)     NULL,
    first_name          VARCHAR(100)    NOT NULL,
    last_name           VARCHAR(100)    NOT NULL,
    department          VARCHAR(150)    NULL,

    -- Student-only academic info. Kept nullable on the shared table rather than
    -- a separate `student_profiles` table — one extra JOIN on every single
    -- request/list screen is exactly the kind of friction the team wants to cut.
    degree_level        ENUM('Master','Doctoral')                  NULL,
    curriculum_year     ENUM('2560','2566')                        NULL,
    study_plan_code     ENUM(
                            'Master_A1','Master_A2','Master_B',
                            'Master_P1A1','Master_P1A2','Master_P2B',
                            'Doc_1_1','Doc_1_2','Doc_2_1','Doc_2_2',
                            'Doc_P1_1_1','Doc_P1_1_2','Doc_P2_2_1','Doc_P2_2_2'
                        )                                           NULL,

    phone               VARCHAR(20)     NULL,
    facebook_id         VARCHAR(100)    NULL,
    line_id             VARCHAR(100)    NULL,

    account_status      ENUM('Pending','Active','Suspended') NOT NULL DEFAULT 'Pending',

    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_username      (username),
    UNIQUE KEY uq_users_msu_mail      (msu_mail),
    INDEX      idx_users_role         (role),
    INDEX      idx_users_status       (account_status),

    CONSTRAINT chk_login_method CHECK (
        (role IN ('Admin','SuperAdmin')
            AND username IS NOT NULL AND password_hash IS NOT NULL)
        OR
        (role NOT IN ('Admin','SuperAdmin')
            AND username IS NULL AND password_hash IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note (A6): dropped `oauth_provider_id` — it was written on create but never
-- actually read back to verify a Google sub match; login only ever matched on
-- `msu_mail`, so the column carried no real guarantee. `faculty` dropped too
-- (dead field, `department` is the one actually used/kept — see A10 decision).


-- ================================================================================
-- 2. advisor_assignments
-- ================================================================================
CREATE TABLE advisor_assignments (
    assignment_id  INT       NOT NULL AUTO_INCREMENT,
    student_id     INT       NOT NULL,
    advisor_id     INT       NOT NULL,
    advisor_type   ENUM('Major','Co_1','Co_2') NOT NULL,
    is_active      BOOLEAN   NOT NULL DEFAULT TRUE,

    PRIMARY KEY (assignment_id),
    UNIQUE KEY uq_advisor_assignment (student_id, advisor_id, advisor_type),
    INDEX      idx_aa_student  (student_id),
    INDEX      idx_aa_advisor  (advisor_id, is_active),

    CONSTRAINT fk_aa_student FOREIGN KEY (student_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_aa_advisor FOREIGN KEY (advisor_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================================================================================
-- 3. msu_unwanted_journals
-- ================================================================================
CREATE TABLE msu_unwanted_journals (
    unwanted_id         INT          NOT NULL AUTO_INCREMENT,
    issn                VARCHAR(20)  NULL,
    journal_name        VARCHAR(255) NOT NULL,
    publisher           VARCHAR(255) NULL,
    note                TEXT         NULL,
    evidence_file_path  VARCHAR(255) NULL,
    recorded_date       DATE         NOT NULL,
    created_by          INT          NOT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (unwanted_id),
    INDEX idx_muj_issn         (issn),
    INDEX idx_muj_journal_name (journal_name),

    CONSTRAINT fk_muj_created_by FOREIGN KEY (created_by) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================================================================================
-- 4. pre_t3_requests
-- ================================================================================
-- The 7 JSON columns from the current schema (journal_snapshot, student_snapshot,
-- checklist_data, advisor_approval, co_advisor_1_approval, co_advisor_2_approval,
-- program_chair_approval, faculty_com_approval) collapse into:
--   - plain snapshot columns below (fixed shape, known at submit time)
--   - 9 checklist booleans (fixed shape, from the paper form)
--   - rows in `request_approvals` (variable per student, see table 7)
-- ================================================================================
CREATE TABLE pre_t3_requests (
    pre_t3_id           INT          NOT NULL AUTO_INCREMENT,
    student_id          INT          NOT NULL,

    -- Journal snapshot (copied at submit time so later journal_cache changes
    -- don't rewrite history)
    issn                VARCHAR(20)  NOT NULL,
    journal_name        VARCHAR(255) NOT NULL,
    journal_url         VARCHAR(255) NULL,
    indexed_database    ENUM('Scopus','TCI') NOT NULL,
    quartile_or_tier    VARCHAR(10)  NULL,
    is_discontinued     BOOLEAN      NOT NULL DEFAULT FALSE,
    is_hijacked         BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Article info
    article_title_en    VARCHAR(500) NULL,
    article_title_th    VARCHAR(500) NULL,
    article_authors     VARCHAR(500) NULL,
    article_doi         VARCHAR(150) NULL,

    -- Checklist (Pre-T3 form items 1-9, see form for full wording)
    chk_scope_match          BOOLEAN NOT NULL DEFAULT FALSE COMMENT '1. manuscript matches journal scope',
    chk_website_verified     BOOLEAN NOT NULL DEFAULT FALSE COMMENT '2. journal has a real, MSU-recognized website',
    chk_publication_regular  BOOLEAN NOT NULL DEFAULT FALSE COMMENT '3. clear & regular publication schedule',
    chk_publisher_stated     BOOLEAN NOT NULL DEFAULT FALSE COMMENT '4. publisher/scope/field clearly stated',
    chk_editorial_board_intl BOOLEAN NOT NULL DEFAULT FALSE COMMENT '5. editorial board from multiple countries',
    chk_peer_review          BOOLEAN NOT NULL DEFAULT FALSE COMMENT '6. peer review, no conflict of interest',
    chk_standard_template     BOOLEAN NOT NULL DEFAULT FALSE COMMENT '7. consistent article template',
    chk_not_hijacked          BOOLEAN NOT NULL DEFAULT FALSE COMMENT '8. not on the Hijacked Journals list',
    chk_still_indexed         BOOLEAN NOT NULL DEFAULT FALSE COMMENT '9. still indexed as of submission date',

    overall_status      ENUM('Pending','Approved','Rejected','Cancelled')
                                     NOT NULL DEFAULT 'Pending',
    resubmit_count      INT          NOT NULL DEFAULT 0,
    last_rejected_at    TIMESTAMP    NULL,

    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                               ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (pre_t3_id),
    INDEX idx_pt3_student  (student_id),
    INDEX idx_pt3_status   (overall_status),
    INDEX idx_pt3_issn     (issn),
    INDEX idx_pt3_created  (created_at),

    CONSTRAINT fk_pt3_student FOREIGN KEY (student_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No generated columns and no issn_virtual needed here: issn is a real column,
-- and approval status lives in `request_approvals`, already indexable natively.


-- ================================================================================
-- 5. t3_requests
-- ================================================================================
CREATE TABLE t3_requests (
    t3_id                   INT          NOT NULL AUTO_INCREMENT,
    pre_t3_id               INT          NOT NULL COMMENT 'must reference an Approved pre_t3_requests row',
    student_id              INT          NOT NULL,

    -- Paper & research details
    title_thai              VARCHAR(500) NOT NULL,
    title_english           VARCHAR(500) NOT NULL,
    first_author            VARCHAR(255) NOT NULL,
    corresponding_author     VARCHAR(255) NOT NULL,
    innovation_type          ENUM('Commercial','Social_Economic','Policy_Public','None')
                                          NOT NULL DEFAULT 'None',
    innovation_detail        VARCHAR(500) NULL,

    -- Publication details (matches the weight-score checkboxes on the T3 form)
    publication_type        ENUM(
                                 'Intl_Journal_Faculty_Recognized',  -- weight 0.1, Master only
                                 'National_Conference',              -- weight 0.2, Master Plan B only
                                 'International_Conference',         -- weight 0.4, Master only
                                 'National_TCI_Tier2',               -- weight 0.6, Master only
                                 'National_TCI_Tier1',               -- weight 0.8
                                 'International_Journal'             -- weight 1.0
                             )                          NOT NULL,
    weight_score             DECIMAL(3,2)               NOT NULL,
    specified_database        VARCHAR(255)               NULL,
    publication_status        ENUM('Published','Accepted')  NOT NULL,
    volume                    VARCHAR(50)  NULL,
    issue                     VARCHAR(50)  NULL,
    publish_year              VARCHAR(10)  NULL,

    -- Journal metrics
    has_impact_score           BOOLEAN       NOT NULL DEFAULT FALSE,
    impact_factor               DECIMAL(10,4) NULL,
    citescore                   DECIMAL(10,2) NULL,
    score_year                  VARCHAR(10)   NULL,

    overall_status               ENUM('Pending','Approved','Rejected','Cancelled')
                                              NOT NULL DEFAULT 'Pending',

    created_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                       ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (t3_id),
    INDEX idx_t3_student           (student_id),
    INDEX idx_t3_pre_t3            (pre_t3_id),
    INDEX idx_t3_status            (overall_status),

    CONSTRAINT fk_t3_pre_t3  FOREIGN KEY (pre_t3_id)   REFERENCES pre_t3_requests (pre_t3_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_t3_student FOREIGN KEY (student_id)  REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================================================================================
-- 6. request_approvals  —  the core simplification
-- ================================================================================
-- One row per (request, approval step). Replaces 5 JSON columns across two
-- tables plus the 11 generated columns/indexes that migrations 001 and 002 had
-- to add on top of them.
--
--   * Applicable steps are inserted when the request is created (e.g. no row
--     for Co_Advisor_2 if the student only has one co-advisor).
--   * `approver_id` is a user (advisor/staff); left NULL only if the step is a
--     committee decision recorded by staff on the committee's behalf.
--   * Querying "show me everything pending my approval" is one indexed WHERE,
--     not a JSON_EXTRACT scan.
-- ================================================================================
CREATE TABLE request_approvals (
    approval_id     INT       NOT NULL AUTO_INCREMENT,
    request_type    ENUM('Pre_T3','T3')                NOT NULL,
    request_id      INT                                 NOT NULL COMMENT 'pre_t3_id or t3_id depending on request_type',
    step            ENUM('Advisor','Co_Advisor_1','Co_Advisor_2',
                          'Faculty_Committee')
                                                         NOT NULL,
    approver_id     INT       NULL COMMENT 'user_id of the advisor/staff who decides this step',
    status          ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    remark          VARCHAR(500) NULL,
    meeting_no      VARCHAR(50)  NULL COMMENT 'used by Faculty_Committee step only',
    meeting_date    DATE         NULL COMMENT 'used by Faculty_Committee step only',
    decided_at      TIMESTAMP    NULL,

    PRIMARY KEY (approval_id),
    UNIQUE KEY uq_request_step        (request_type, request_id, step),
    INDEX      idx_ra_approver_status (approver_id, status),
    INDEX      idx_ra_request          (request_type, request_id),

    CONSTRAINT fk_ra_approver FOREIGN KEY (approver_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: request_id has no FK (it is polymorphic across pre_t3_requests/t3_requests)
-- — enforced at the app layer.


-- ================================================================================
-- 7. t3_evidence_files
-- ================================================================================
-- Replaces the journal_evidence_files JSON object. One row per required
-- document instead of one JSON object with 6 fixed keys.
-- ================================================================================
CREATE TABLE t3_evidence_files (
    file_id     INT     NOT NULL AUTO_INCREMENT,
    t3_id       INT     NOT NULL,
    file_type   ENUM('Acceptance_Letter','Full_Paper','Journal_Cover',
                      'Table_Of_Contents','Database_Evidence','Peer_Review_Result')
                        NOT NULL,
    file_path   VARCHAR(255) NOT NULL,

    PRIMARY KEY (file_id),
    UNIQUE KEY uq_t3_file_type (t3_id, file_type),

    CONSTRAINT fk_tef_t3 FOREIGN KEY (t3_id) REFERENCES t3_requests (t3_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================================================================================
-- 8. otp_requests
-- ================================================================================
CREATE TABLE otp_requests (
    otp_id         INT          NOT NULL AUTO_INCREMENT,
    user_id        INT          NOT NULL,
    otp_hash       VARCHAR(255) NOT NULL,
    purpose        ENUM('login_2fa','password_reset','email_verify') NOT NULL,
    expires_at     TIMESTAMP    NOT NULL,
    used_at        TIMESTAMP    NULL,
    attempt_count  INT          NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (otp_id),
    INDEX idx_otp_user_purpose (user_id, purpose, used_at),
    INDEX idx_otp_expires_at   (expires_at),

    CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================================================================================
-- 9. auth_tokens  (merges refresh_tokens + password_reset_tokens)
-- ================================================================================
-- Both tables were: user_id, token_hash, expires_at, one "consumed" timestamp,
-- ip/user-agent, created_at. Same shape, different lifetimes/purpose — modeled
-- here as one table with a `token_type` discriminator instead of two near-
-- identical tables to maintain.
-- ================================================================================
CREATE TABLE auth_tokens (
    token_id     INT          NOT NULL AUTO_INCREMENT,
    user_id      INT          NOT NULL,
    token_type   ENUM('Refresh','Password_Reset') NOT NULL,
    token_hash   VARCHAR(255) NOT NULL,
    expires_at   TIMESTAMP    NOT NULL,
    consumed_at  TIMESTAMP    NULL COMMENT 'used_at (password reset) or revoked_at (refresh); NULL = still valid',

    PRIMARY KEY (token_id),
    UNIQUE KEY uq_at_token_hash (token_hash),
    INDEX      idx_at_user_type (user_id, token_type),
    INDEX      idx_at_expires   (expires_at),

    CONSTRAINT fk_at_user FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- ================================================================================
-- SCORECARD vs. current production schema
-- --------------------------------------------------------------------------------
-- Removed entirely : JSON-based approval columns (5x), the 'N/A' status value,
--                     STORED generated columns + their indexes (11x, migrations
--                     001/002), issn_virtual VIRTUAL column, oauth_provider column,
--                     duplicate refresh_tokens/password_reset_tokens tables,
--                     journals_cache (A1), bug_reports/system_logs/email_notifications
--                     (A3 — out of proposal scope).
-- Added             : request_approvals (normalized approvals, 1 table replaces
--                     the JSON+generated-column approach across 2 tables),
--                     t3_evidence_files (1 table replaces 1 JSON object).
-- Net effect        : approval status for any step, on any request, by any
--                     approver is a single indexed lookup — no JSON_EXTRACT,
--                     no generated column, no migration needed to add a new
--                     approval step in the future (e.g. if the university adds
--                     a 6th signer next year, that's an INSERT, not an ALTER).
-- ================================================================================
-- END OF FILE
-- ================================================================================
