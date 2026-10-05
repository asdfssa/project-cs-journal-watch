/**
 * ScopusService
 * ดึงข้อมูลวารสารจาก Scopus API
 * Port มาจาก Python script + Key Rotation
 */
const axios = require('axios');
const config = require('../config');
const scopusProxy = require('./ScopusProxyService');

class ScopusService {

  static async getJournalByIssn(issn) {
    const cleanIssn = issn.replace('-', '').trim();
    return ScopusService._fetchFromApi(cleanIssn);
  }

  static async _fetchFromApi(issn) {
    const keyObj = await scopusProxy.getNextKey();

    try {
      const response = await axios.get(
        `${config.scopus.baseUrl}/content/serial/title/issn/${issn}`,
        {
          headers: {
            'X-ELS-APIKey': keyObj.key,
            'Accept': 'application/json',
          },
          params: {
            view: 'STANDARD',
            field: 'dc:title,prism:issn,prism:eIssn,dc:publisher,prism:aggregationType,openaccess,SNIP,SJR,citeScoreYearInfo,subject-area,coverageStartYear,coverageEndYear,H-Index',
          },
          timeout: 15000,
        }
      );

      await scopusProxy.incrementUsage(keyObj.index, response.headers);
      const data = response.data['serial-metadata-response'];

      if (!data || !data.entry || !data.entry[0]) {
        return null;
      }

      return ScopusService._parseApiResponse(data.entry[0], issn);

    } catch (err) {
      if (err.response?.status === 429) {
        await scopusProxy.markKeyUnavailable(keyObj.index, err.response.headers);
        return ScopusService._fetchFromApi(issn);
      }
      if (err.response?.status === 404) {
        return null;
      }
      throw new Error(`Scopus API error: ${err.message}`);
    }
  }

  // ===== Helpers (port จาก Python) =====

  static _computeQuartile(percentile) {
    if (percentile === null || percentile === undefined) return null;
    const p = parseFloat(percentile);
    if (isNaN(p)) return null;
    if (p >= 75) return 'Q1';
    if (p >= 50) return 'Q2';
    if (p >= 25) return 'Q3';
    return 'Q4';
  }

  static _safeGetCiteScoreYearInfoList(entry) {
    const raw = entry?.citeScoreYearInfoList;
    const result = [];

    if (!raw) return result;

    const extractCs = (cs) => {
      if (Array.isArray(cs)) result.push(...cs);
      else if (cs && typeof cs === 'object') result.push(cs);
    };

    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item?.citeScoreYearInfo) extractCs(item.citeScoreYearInfo);
      });
    } else if (typeof raw === 'object') {
      extractCs(raw.citeScoreYearInfo);
    }

    return result;
  }

  static _safeGetCiteScoreInfoList(csy) {
    const raw = csy?.citeScoreInformationList;
    const result = [];

    if (!raw) return result;

    const extractCs = (cs) => {
      if (Array.isArray(cs)) result.push(...cs);
      else if (cs && typeof cs === 'object') result.push(cs);
    };

    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item?.citeScoreInfo) extractCs(item.citeScoreInfo);
      });
    } else if (typeof raw === 'object') {
      extractCs(raw.citeScoreInfo);
    }

    return result;
  }

  static _parseApiResponse(entry, issn) {
    // Subject Areas
    const saRaw = entry['subject-area'] || [];
    const subjectAreas = (Array.isArray(saRaw) ? saRaw : [saRaw])
      .filter(a => a && a['$'])
      .map(a => ({
        abbrev: a['@abbrev'],
        code: a['@code'],
        area: a['$'],
      }));

    // SJR
    const sjrList = entry['SJRList']?.SJR || [];
    const sjrArr = Array.isArray(sjrList) ? sjrList : [sjrList];
    const sjrValue = sjrArr.length > 0 ? parseFloat(sjrArr[sjrArr.length - 1]['$']) : null;

    // SNIP
    const snipList = entry['SNIPList']?.SNIP || [];
    const snipArr = Array.isArray(snipList) ? snipList : [snipList];
    const snipValue = snipArr.length > 0 ? parseFloat(snipArr[snipArr.length - 1]['$']) : null;

    // Coverage + Discontinued
    const coverageStartYear = entry['coverageStartYear'] || null;
    const coverageEndYear = entry['coverageEndYear'] || null;
    const currentYear = new Date().getFullYear();
    const isDiscontinued = coverageEndYear ? parseInt(coverageEndYear) < currentYear - 1 : false;

    // CiteScore + Quartile
    let citeScore = null;
    let bestQuartile = null;
    let bestPercentile = null;
    let rankings = [];

    const csyList = ScopusService._safeGetCiteScoreYearInfoList(entry);
    if (csyList.length > 0) {
      const completeYears = csyList.filter(y => String(y['@status'] || '').toLowerCase() === 'complete');
      const targetYear = completeYears.length > 0 ? completeYears[0] : csyList[0];
      const year = targetYear['@year'];
      citeScore = targetYear['citeScore'] || null;

      const csInfoList = ScopusService._safeGetCiteScoreInfoList(targetYear);

      if (csInfoList.length > 0) {
        const csInfo = csInfoList[0];
        citeScore = csInfo['citeScore'] || targetYear['citeScore'] || null;
        let csrList = csInfo['citeScoreSubjectRank'] || [];
        if (!Array.isArray(csrList)) csrList = [csrList];

        const codeToArea = {};
        subjectAreas.forEach(sa => {
          if (sa.code) {
            codeToArea[sa.code] = sa.area;
            codeToArea[String(parseInt(sa.code))] = sa.area;
          }
        });

        rankings = csrList
          .filter(r => r && typeof r === 'object')
          .map(r => {
            const code = r['subjectCode'] || r['asjcCode'];
            const percentile = r['percentile'] !== undefined ? parseFloat(r['percentile']) : null;
            return {
              year,
              asjcCode: code,
              field: codeToArea[code] || null,
              rank: r['rank'] || null,
              percentile: isNaN(percentile) ? null : percentile,
              quartile: ScopusService._computeQuartile(percentile),
            };
          });

        if (rankings.length > 0) {
          const best = rankings.reduce((prev, curr) => {
            const pp = prev.percentile ?? -1;
            const cp = curr.percentile ?? -1;
            return cp > pp ? curr : prev;
          });
          bestPercentile = best.percentile;
          bestQuartile = best.quartile;
        }
      }
    }

    return {
      issn,
      journal_name: entry['dc:title'] || '',
      publisher: entry['dc:publisher'] || null,
      database_source: 'Scopus',
      scopus_quartile_data: rankings.length > 0 ? rankings : null,
      scopus_best_quartile: bestQuartile,
      scopus_best_percentile: bestPercentile,
      scopus_h_index: null,
      scopus_citescore: citeScore ? parseFloat(citeScore) : null,
      scopus_sjr: sjrValue,
      scopus_snip: snipValue,
      scopus_discontinued: isDiscontinued,
      subject_areas: subjectAreas.length > 0 ? subjectAreas : null,
      coverage_start_year: coverageStartYear,
      coverage_end_year: coverageEndYear,
      fetch_method: 'API',
    };
  }

}

module.exports = ScopusService;