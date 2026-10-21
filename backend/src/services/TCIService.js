/**
 * TCIService
 * ดึงข้อมูลวารสารจาก TCI API
 */
const axios = require('axios');
const JournalCache = require('./JournalCache');

/**
 * ดึงข้อมูลวารสารจาก TCI (Thai-Journal Citation Index) ผ่าน API ของ tci-thailand.org
 * เรียกจาก: JournalController.searchTci เท่านั้น · เส้นสำรองคือ TCIScraper (ผลรูปแบบเดียวกัน ต่างที่ fetch_method)
 */
class TCIService {

  /**
   * @param {string} issn
   * @returns {Promise<object|null>} null = ไม่พบหรือไม่มี ISSN ตรงเป๊ะ
   */
  static async getJournalByIssn(issn) {
    const cleanIssn = issn.trim();
    const cache = JournalCache.shared();

    // hit = ไม่ยิง TCI · cache พัง/ไม่พบ → ดึงสดตามปกติ
    const cached = await cache.get(cleanIssn, 'TCI');
    if (cached) return cached;

    const result = await TCIService._fetchFromApi(cleanIssn);
    if (!result) return null; // ไม่พบ → ไม่ cache
    await cache.save(result);
    return { ...result, fromCache: false };
  }

  /**
   * เรียกจาก: getJournalByIssn · POST list_all_journal ค้นด้วย ISSN → เลือกเฉพาะรายการที่ ISSN (issn หรือ eissn) ตรงกันเป๊ะ → _parseApiResponse
   * error เครือข่าย/HTTP → throw 'TCI API error: ...'
   */
  static async _fetchFromApi(issn) {
    try {
      const response = await axios.post(
        'https://tci-thailand.org/backend/journal/list_all_journal',
        {
          start_item: 0,
          offset: 10,
          tiers: [],
          status: [],
          area: [],
          main_area: [],
          option: 'ssn',
          search: issn,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 15000,
        }
      );

      const journals = response.data?.journals || [];
      if (journals.length === 0) return null;

      // หา exact match ของ ISSN ก่อน (ทั้ง issn และ eissn)
      const normalizedIssn = issn.replace(/-/g, '').toLowerCase();
      const exact = journals.find(j => {
        const print = (j.issn || '').replace(/-/g, '').toLowerCase();
        const online = (j.eissn || '').replace(/-/g, '').toLowerCase();
        return print === normalizedIssn || online === normalizedIssn;
      });

      // ไม่เจอ exact match → ถือว่าไม่พบวารสารนี้ ดีกว่าเดาวารสารอื่นที่ผลค้นหาใกล้เคียงมา
      if (!exact) return null;
      return TCIService._parseApiResponse(exact, issn);

    } catch (err) {
      throw new Error(`TCI API error: ${err.message}`);
    }
  }

  /**
   * แปลงรายการวารสารดิบของ TCI เป็น object ที่ระบบใช้ (tci_tier, tci_status, tci_inactive = สถานะที่ไม่ใช่ active/name_changed ฯลฯ)
   * เรียกจาก: _fetchFromApi · โครงสร้างผลเหมือน TCIScraper._parseJournal
   * @param {object} journal รายการจาก response.data.journals
   * @param {string} issn ISSN ที่ผู้ใช้ค้น (ค่าสำรองของ issn)
   */
  static _parseApiResponse(journal, issn) {
    const tier = journal['tci_tier'] ? parseInt(journal['tci_tier']) : null;
    const status = journal['status'] || null;
    const isInactive = status ? !['active', 'name_changed'].includes(status) : false;

    const printIssn = (journal['issn'] || '').replace(/-/g, '').trim();
    const onlineIssn = (journal['eissn'] || '').replace(/-/g, '').trim();
    const fallbackIssn = issn.replace(/-/g, '').trim();

    return {
      issn: printIssn || fallbackIssn,
      eissn: onlineIssn || null,
      journal_name: journal['name_eng'] || journal['name_local'] || '',
      journal_name_th: journal['name_local'] || null,
      publisher: journal['publisher_eng'] || null,
      publisher_th: journal['publisher_loc'] || null,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: status,
      tci_inactive: isInactive,
      website: journal['website'] || null,
      main_area: journal['main_area'] || null,
      major_area: journal['area'] || null,
      minor_area: journal['minor_area'] || null,
      abbrev_name: journal['abbrev_name'] || null,
      volume_per_year: journal['volume_per_year'] || null,
      issue_per_volume: journal['issue_per_volume'] || null,
      prev_name: journal['prev_name'] || null,
      prev_name_th: journal['prev_name_th'] || null,
      fetch_method: 'API',
    };
  }

}

module.exports = TCIService;