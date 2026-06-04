import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(DATA_DIR, 'deals.json');
const DEBUG_FILE = path.join(DATA_DIR, 'debug.json');

const SOURCES = {
  oneday: 'https://www.e-himart.co.kr/app/displayPlan/listPlanDetail?spdpNo=7630',
  unopened: 'https://www.e-himart.co.kr/app/display/unopenedHall'
};

const BASE = 'https://www.e-himart.co.kr';

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const previous = await readJsonSafe(OUT_FILE);
  const debug = {
    startedAt: new Date().toISOString(),
    sources: {},
    counts: {},
    errors: []
  };

  let items = [];
  let warning = '';

  try {
    const onedayHtml = await fetchHtml(SOURCES.oneday);
    const oneday = parseOneDay(onedayHtml, SOURCES.oneday);
    debug.sources.oneday = {
      url: SOURCES.oneday,
      htmlLength: onedayHtml.length,
      parsed: oneday.length,
      withImage: oneday.filter(x => x.imageUrl).length,
      withGoodsNo: oneday.filter(x => x.goodsNo).length,
      withRemainingQty: oneday.filter(x => Number.isFinite(x.remainingQty)).length
    };
    items.push(...oneday);
  } catch (error) {
    debug.errors.push({ source: 'oneday', message: error.message });
  }

  try {
    const unopenedHtml = await fetchHtml(SOURCES.unopened);
    const unopened = parseUnopened(unopenedHtml, SOURCES.unopened);
    debug.sources.unopened = {
      url: SOURCES.unopened,
      htmlLength: unopenedHtml.length,
      parsed: unopened.length,
      withImage: unopened.filter(x => x.imageUrl).length,
      withGoodsNo: unopened.filter(x => x.goodsNo).length
    };
    items.push(...unopened);
  } catch (error) {
    debug.errors.push({ source: 'unopened', message: error.message });
  }

  items = dedupe(items);

  if (items.length === 0 && previous?.items?.length) {
    items = previous.items;
    warning = '이번 실행에서 상품을 새로 수집하지 못해 기존 데이터를 보존했습니다.';
  }

  const payload = {
    meta: {
      updatedAt: new Date().toISOString(),
      timezone: 'Asia/Seoul',
      sample: false,
      warning,
      sourceUrls: SOURCES,
      version: 'fresh-rebuild-v1'
    },
    items
  };

  debug.counts = {
    total: items.length,
    oneday: items.filter(x => x.section === 'oneday').length,
    unopened: items.filter(x => x.section === 'unopened').length
  };
  debug.finishedAt = new Date().toISOString();

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(DEBUG_FILE, JSON.stringify(debug, null, 2), 'utf8');
  console.log(`Collected ${items.length} products`, debug.counts);
}

async function readJsonSafe(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function toLines(html) {
  const $ = cheerio.load(html, { decodeEntities: true });
  $('script, style, noscript, svg').remove();
  let body = $('body').html() || html;
  body = body
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(li|p|div|section|article|ul|ol|dl|dd|dt|tr|td|th|h[1-6]|a|span|strong|em|button)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')');
  return body.split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^닫기$|^확인$|^검색$|^내용$/.test(line));
}

function imageRecords(html) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const records = [];
  $('img').each((_, node) => {
    const img = $(node);
    const src = pickImageSrc(img);
    const alt = img.attr('alt') || '';
    const parentHref = img.closest('a').attr('href') || '';
    const around = `${alt} ${src || ''} ${parentHref}`;
    const goodsNo = extractGoodsNo(around);
    if (goodsNo || src) {
      records.push({
        goodsNo,
        imageUrl: normalizeUrl(src),
        linkUrl: goodsNo ? productUrl(goodsNo) : normalizeUrl(parentHref)
      });
    }
  });
  return records.filter(r => r.goodsNo || r.imageUrl);
}

function pickImageSrc(img) {
  const attrs = ['data-src', 'data-original', 'data-lazy', 'src', 'lazy-src'];
  for (const attr of attrs) {
    const value = img.attr(attr);
    if (value && !value.startsWith('data:')) return value;
  }
  const srcset = img.attr('srcset');
  if (srcset) return srcset.split(',')[0].trim().split(' ')[0];
  return '';
}

function parseOneDay(html, sourceUrl) {
  const lines = toLines(html);
  const records = imageRecords(html).filter(r => r.goodsNo);
  const items = [];
  const starts = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/남은\s*수량\s*(\d+)\s*개|남은수량\s*(\d+)\s*개/);
    if (match) starts.push({ index: i, qty: Number(match[1] || match[2]) });
  }

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = starts[s + 1]?.index ?? lines.length;
    const block = lines.slice(start.index, end);
    const titleLine = findTitleLine(block);
    if (!titleLine) continue;
    const priceText = block.filter(line => /원|%|최대혜택가/.test(line) && !/L\.POINT/.test(line)).join(' ');
    const lpointText = block.find(line => /L\.POINT/.test(line)) || '';
    const price = parsePriceInfo(priceText);
    const brand = extractBrand(titleLine);
    const name = cleanTitle(titleLine);
    const rec = records[s] || {};
    const goodsNo = rec.goodsNo || extractGoodsNo(block.join(' '));

    items.push(normalizeItem({
      section: 'oneday',
      source: '원데이핫딜',
      sourceUrl,
      goodsNo,
      brand,
      name,
      category: inferCategory(`${brand} ${name}`),
      remainingQty: start.qty,
      lpoint: parseNumber(lpointText.match(/L\.POINT\s*([\d,]+)/)?.[1]),
      originalPrice: price.originalPrice,
      salePrice: price.salePrice,
      bestPrice: price.bestPrice,
      discountRate: price.discountRate,
      imageUrl: rec.imageUrl,
      url: goodsNo ? productUrl(goodsNo) : searchUrl(name),
      rawPriceText: priceText
    }));
  }

  return items;
}

function findTitleLine(block) {
  const cleaned = block.map(line => line.replace(/^Image:\s*하이라이트\s*/i, '').trim());
  return cleaned.find(line => /^\[[^\]]+\]/.test(line) && !/L\.POINT|최대혜택가|남은수량|남은\s*수량/.test(line));
}

function parseUnopened(html, sourceUrl) {
  const lines = toLines(html);
  const records = imageRecords(html).filter(r => r.goodsNo || r.imageUrl);
  const items = [];
  let imageIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const priceLine = lines[i];
    if (!/판매가/.test(priceLine) || !/원/.test(priceLine)) continue;
    const title = previousMeaningful(lines, i - 1);
    const brand = previousMeaningful(lines, i - 2);
    if (!title || !brand) continue;
    if (isNoiseTitle(title) || isNoiseTitle(brand)) continue;
    const price = parsePriceInfo(priceLine);
    if (!price.salePrice && !price.bestPrice) continue;
    const rec = records[imageIndex++] || {};
    const name = title.replace(/^Image:\s*[^\s]+\s*/, '').trim();
    const goodsNo = rec.goodsNo || extractGoodsNo(`${name} ${priceLine}`);

    items.push(normalizeItem({
      section: 'unopened',
      source: '미개봉상품 특가',
      sourceUrl,
      goodsNo,
      brand: cleanupBrand(brand),
      name,
      category: inferCategory(`${brand} ${name}`),
      originalPrice: price.originalPrice,
      salePrice: price.salePrice,
      bestPrice: price.bestPrice || price.salePrice,
      discountRate: price.discountRate,
      imageUrl: rec.imageUrl,
      url: goodsNo ? productUrl(goodsNo) : searchUrl(name),
      rawPriceText: priceLine
    }));
  }

  return items;
}

function previousMeaningful(lines, index) {
  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (/^\*+$/.test(line)) continue;
    if (/^Image/.test(line) && !/\[/.test(line)) continue;
    if (/국내 최대|놀라운 가격|가성비템|반품 상품|모아봤어요|최대혜택가|판매가|할인율|카테고리|고객센터|상단으로/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    return line;
  }
  return '';
}

function isNoiseTitle(line) {
  return /디지털\/게임|PC\/주변기기|주방가전|청소기|공청기|계절|이미용|TV\/영상|50% 이상|40~50|30~40|20~30|노트북\/모니터|게임|겨울가전|여름가전|생활가전|캠핑/.test(line);
}

function parsePriceInfo(text) {
  const discountRate = parseNumber(text.match(/(\d{1,3})\s*%/)?.[1]);
  const priceText = text.replace(/L\.POINT\s*[\d,]+/g, '');
  const numbers = [...priceText.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:원)?~?/g)]
    .map(m => parseNumber(m[1]))
    .filter(n => Number.isFinite(n) && n > 0);

  let originalPrice = null;
  let salePrice = null;
  let bestPrice = null;

  if (numbers.length >= 3) {
    originalPrice = numbers[0];
    salePrice = numbers[numbers.length - 2];
    bestPrice = numbers[numbers.length - 1];
  } else if (numbers.length === 2) {
    originalPrice = /할인율|%|↓/.test(text) ? numbers[0] : null;
    salePrice = numbers[0];
    bestPrice = numbers[1];
  } else if (numbers.length === 1) {
    salePrice = numbers[0];
    bestPrice = numbers[0];
  }

  let computedDiscount = discountRate;
  if (!computedDiscount && originalPrice && salePrice && originalPrice > salePrice) {
    computedDiscount = Math.round((1 - salePrice / originalPrice) * 100);
  }

  return { originalPrice, salePrice, bestPrice, discountRate: computedDiscount || null };
}

function extractBrand(title) {
  return title.match(/^\[([^\]]+)\]/)?.[1]?.trim() || '';
}

function cleanTitle(title) {
  return title.replace(/^Image:\s*하이라이트\s*/i, '').replace(/^\[[^\]]+\]/, '').trim();
}

function cleanupBrand(brand) {
  return brand.replace(/^Image:\s*[^\s]+\s*/i, '').trim();
}

function inferCategory(text) {
  const t = text.toLowerCase();
  if (/그램|노트북|pc|태블릿|아이패드|ipad|맥북|모니터|키보드|마우스|ssd|스위치 2구|스마트 스위치/.test(t)) return 'PC/주변기기';
  if (/tv|oled|qled|영상|오디세이|디스플레이|스튜디오 디스플레이/.test(t)) return 'TV/영상가전';
  if (/switch|닌텐도|ps5|xbox|게임|조이콘|듀얼센스|오즈모|dji|카메라|짐벌/.test(t)) return '디지털/게임';
  if (/밥솥|쿠쿠|쿠첸|김치냉장고|냉장고|블렌더|두유|커피머신|정수|와인오프너|주방|음식물처리기/.test(t)) return '주방가전';
  if (/청소기|가습기|멀티탭|클리너|생활백서|바디드라이어|건조기|의류|세탁|리모컨|하수구|전해수기/.test(t)) return '생활가전';
  if (/에어컨|서큘레이터|선풍기|히터|카본매트|공기청정|제습|계절/.test(t)) return '계절가전';
  if (/안마|마사지|세라젬|뷰티|클렌저|드라이어|다운펌|미용|헤드폰|이어폰|보스|음향/.test(t)) return '이미용/건강/음향';
  if (/침대|매트리스|시몬스|씰리/.test(t)) return '가구/침구';
  return '기타';
}

function normalizeItem(item) {
  return {
    id: `${item.section}-${item.goodsNo || hashCode(item.name + item.salePrice)}`,
    section: item.section,
    source: item.source,
    sourceUrl: item.sourceUrl,
    goodsNo: item.goodsNo || '',
    brand: item.brand || '',
    name: item.name || '',
    category: item.category || '기타',
    remainingQty: Number.isFinite(item.remainingQty) ? item.remainingQty : null,
    lpoint: Number.isFinite(item.lpoint) ? item.lpoint : null,
    originalPrice: Number.isFinite(item.originalPrice) ? item.originalPrice : null,
    salePrice: Number.isFinite(item.salePrice) ? item.salePrice : null,
    bestPrice: Number.isFinite(item.bestPrice) ? item.bestPrice : null,
    discountRate: Number.isFinite(item.discountRate) ? item.discountRate : null,
    imageUrl: item.imageUrl || '',
    url: item.url || item.sourceUrl,
    rawPriceText: item.rawPriceText || ''
  };
}

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.goodsNo ? `${item.section}-${item.goodsNo}` : item.id;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function productUrl(goodsNo) {
  return `${BASE}/app/goods/goodsDetail?goodsNo=${encodeURIComponent(goodsNo)}`;
}

function searchUrl(keyword) {
  return `${BASE}/app/search/totalSearch?searchTerm=${encodeURIComponent(keyword)}`;
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${BASE}${url}`;
  if (url.startsWith('http')) return url;
  return `${BASE}/${url.replace(/^\/+/, '')}`;
}

function extractGoodsNo(text) {
  if (!text) return '';
  return text.match(/goodsNo[=:\/"'\s]+(\d{6,15})/)?.[1]
    || text.match(/(?:^|[^\d])(\d{10})(?:[^\d]|$)/)?.[1]
    || '';
}

function parseNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

main().catch(async error => {
  console.error(error);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DEBUG_FILE, JSON.stringify({ fatal: error.message, at: new Date().toISOString() }, null, 2), 'utf8');
  process.exit(1);
});
