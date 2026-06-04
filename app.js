const DATA_URL = `data/deals.json?v=${Date.now()}`;
const state = {
  tab: 'oneday',
  items: [],
  meta: {},
  query: '',
  category: 'all',
  discount: 'all',
  price: 'all',
  sort: 'remainingAsc'
};

const el = {
  updatedAt: document.getElementById('updatedAt'),
  notice: document.getElementById('notice'),
  statCount: document.getElementById('statCount'),
  statDiscount: document.getElementById('statDiscount'),
  statLowest: document.getElementById('statLowest'),
  statQty: document.getElementById('statQty'),
  tabs: document.querySelectorAll('.tab'),
  dashboardHero: document.getElementById('dashboardHero'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  discountFilter: document.getElementById('discountFilter'),
  priceFilter: document.getElementById('priceFilter'),
  sortSelect: document.getElementById('sortSelect'),
  resultTitle: document.getElementById('resultTitle'),
  dealGrid: document.getElementById('dealGrid'),
  emptyState: document.getElementById('emptyState')
};

const KRW = new Intl.NumberFormat('ko-KR');

function money(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${KRW.format(value)}원`;
}

function qtyText(value) {
  if (!Number.isFinite(value)) return '-';
  return `${KRW.format(value)}개`;
}

function formatDate(value) {
  if (!value) return '수집 시간 확인 필요';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Asia/Seoul'
  }).format(date) + ' 수집';
}

function endOfTodayKstCountdown() {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const end = new Date(kstNow);
  end.setHours(23, 59, 59, 999);
  const diff = Math.max(0, end.getTime() - kstNow.getTime());
  const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function sourceItems() {
  return state.items.filter(item => item.section === state.tab);
}

function itemPrice(item) {
  return item.bestPrice || item.salePrice || item.originalPrice || 0;
}

function pricePass(item) {
  const price = itemPrice(item);
  if (!price) return true;
  switch (state.price) {
    case 'under10000': return price <= 10000;
    case '10000-50000': return price >= 10000 && price <= 50000;
    case '50000-100000': return price >= 50000 && price <= 100000;
    case '100000-300000': return price >= 100000 && price <= 300000;
    case '300000-700000': return price >= 300000 && price <= 700000;
    case 'over700000': return price >= 700000;
    default: return true;
  }
}

function filteredItems() {
  const q = state.query.trim().toLowerCase();
  const minDiscount = state.discount === 'all' ? 0 : Number(state.discount);
  return sourceItems()
    .filter(item => !q || `${item.brand || ''} ${item.name || ''}`.toLowerCase().includes(q))
    .filter(item => state.category === 'all' || item.category === state.category)
    .filter(item => !minDiscount || (item.discountRate || 0) >= minDiscount)
    .filter(pricePass)
    .sort((a, b) => {
      switch (state.sort) {
        case 'remainingAsc': return (a.remainingQty ?? 999999) - (b.remainingQty ?? 999999);
        case 'priceAsc': return itemPrice(a) - itemPrice(b);
        case 'priceDesc': return itemPrice(b) - itemPrice(a);
        case 'discountDesc': return (b.discountRate || 0) - (a.discountRate || 0);
        case 'benefitAsc': return (a.bestPrice || itemPrice(a)) - (b.bestPrice || itemPrice(b));
        case 'brandAsc': return (a.brand || '').localeCompare(b.brand || '', 'ko');
        default: return 0;
      }
    });
}

function updateCategoryOptions() {
  const categories = [...new Set(sourceItems().map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  el.categoryFilter.innerHTML = '<option value="all">전체</option>' + categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
  state.category = 'all';
  el.categoryFilter.value = 'all';
}

function renderStats(items) {
  const discounts = items.map(item => item.discountRate || 0).filter(Boolean);
  const prices = items.map(itemPrice).filter(Boolean);
  const qtys = items.map(item => item.remainingQty).filter(Number.isFinite);
  el.statCount.textContent = `${KRW.format(items.length)}개`;
  el.statDiscount.textContent = discounts.length ? `${Math.max(...discounts)}%` : '-';
  el.statLowest.textContent = prices.length ? money(Math.min(...prices)) : '-';
  el.statQty.textContent = qtys.length ? qtyText(qtys.reduce((a, b) => a + b, 0)) : '-';
}

function renderDashboard(items) {
  const source = sourceItems();
  const featured = items[0] || source[0];
  if (!featured) {
    el.dashboardHero.innerHTML = '';
    return;
  }

  const type = state.tab === 'oneday' ? 'TODAY SPECIAL' : 'UNOPENED DEAL';
  const subtitle = state.tab === 'oneday'
    ? '원데이핫딜 전용 페이지를 기준으로 이미지, 가격, 남은수량을 대시보드처럼 재구성했습니다.'
    : '미개봉상품 특가 전용관의 상품을 카테고리·할인율·가격순으로 재구성했습니다.';
  const metric1Label = state.tab === 'oneday' ? '남은수량' : '할인율';
  const metric1Value = state.tab === 'oneday' ? (Number.isFinite(featured.remainingQty) ? qtyText(featured.remainingQty) : '-') : (featured.discountRate ? `${featured.discountRate}%` : '-');
  const metric3Label = state.tab === 'oneday' ? '종료까지' : '카테고리';
  const metric3Value = state.tab === 'oneday' ? endOfTodayKstCountdown() : (featured.category || '-');

  el.dashboardHero.innerHTML = `
    <article class="dashboard-card">
      <div class="dashboard-media">${imageOrPlaceholder(featured)}</div>
      <div class="dashboard-info">
        <div class="type">${type}</div>
        <h2>${escapeHtml(featured.name || '상품명 확인 필요')}</h2>
        <div class="dashboard-metrics">
          <div class="metric-box"><span>판매가</span><strong>${money(featured.salePrice || featured.bestPrice)}</strong></div>
          <div class="metric-box"><span>${metric1Label}</span><strong>${metric1Value}</strong></div>
          <div class="metric-box"><span>${metric3Label}</span><strong>${metric3Value}</strong></div>
        </div>
        <p>${subtitle}</p>
      </div>
    </article>`;
}

function imageOrPlaceholder(item) {
  if (item.imageUrl) {
    return `<img loading="lazy" src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.name || '상품 이미지')}" onerror="this.remove(); this.parentElement.insertAdjacentHTML('beforeend','<div class=&quot;placeholder&quot;>이미지 없음</div>')" />`;
  }
  return '<div class="placeholder">이미지 없음</div>';
}

function renderCards(items) {
  el.dealGrid.innerHTML = items.map(item => {
    const discount = item.discountRate ? `<span class="badge blue">${item.discountRate}% 할인</span>` : '';
    const remaining = Number.isFinite(item.remainingQty) ? `<span class="badge red">남은수량 ${KRW.format(item.remainingQty)}개</span>` : '';
    const lpoint = item.lpoint ? `<span class="badge dark">L.POINT ${KRW.format(item.lpoint)}</span>` : '';
    const qtyPercent = Number.isFinite(item.remainingQty) ? Math.max(8, Math.min(100, item.remainingQty * 10)) : 0;
    const bar = Number.isFinite(item.remainingQty) ? `<div class="remaining-bar"><span style="width:${qtyPercent}%"></span></div>` : '';
    return `
      <article class="product-card">
        <div class="product-media">${imageOrPlaceholder(item)}</div>
        <div class="badges">
          ${remaining}
          ${discount}
          <span class="badge">${escapeHtml(item.category || '기타')}</span>
          ${lpoint}
        </div>
        <div class="product-body">
          <div class="brand">${escapeHtml(item.brand || '브랜드 확인 필요')}</div>
          <div class="product-name">${escapeHtml(item.name || '상품명 확인 필요')}</div>
          <div class="price-grid">
            <div class="price-cell"><span>정상가</span><strong>${money(item.originalPrice)}</strong></div>
            <div class="price-cell"><span>판매가</span><strong class="red-text">${money(item.salePrice)}</strong></div>
            <div class="price-cell"><span>최대혜택가</span><strong class="blue-text">${money(item.bestPrice)}</strong></div>
            <div class="price-cell"><span>상품번호</span><strong>${escapeHtml(item.goodsNo || '-')}</strong></div>
          </div>
          ${bar}
          <div class="card-actions">
            <a href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener">하이마트몰 바로가기</a>
          </div>
        </div>
      </article>`;
  }).join('');
  el.emptyState.classList.toggle('hidden', items.length > 0);
}

function render() {
  const items = filteredItems();
  renderStats(items);
  renderDashboard(items);
  renderCards(items);
  const label = state.tab === 'oneday' ? '오늘의 특가' : '미개봉상품 특가';
  el.resultTitle.textContent = `${label} ${KRW.format(items.length)}개 표시 중`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function escapeAttr(value) { return escapeHtml(value); }

function bindEvents() {
  el.tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      el.tabs.forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      state.tab = btn.dataset.tab;
      state.sort = state.tab === 'oneday' ? 'remainingAsc' : 'discountDesc';
      el.sortSelect.value = state.sort;
      updateCategoryOptions();
      render();
    });
  });
  el.searchInput.addEventListener('input', e => { state.query = e.target.value; render(); });
  el.categoryFilter.addEventListener('change', e => { state.category = e.target.value; render(); });
  el.discountFilter.addEventListener('change', e => { state.discount = e.target.value; render(); });
  el.priceFilter.addEventListener('change', e => { state.price = e.target.value; render(); });
  el.sortSelect.addEventListener('change', e => { state.sort = e.target.value; render(); });
}

async function init() {
  bindEvents();
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`데이터 파일을 읽지 못했습니다. ${response.status}`);
    const data = await response.json();
    state.items = Array.isArray(data.items) ? data.items : [];
    state.meta = data.meta || {};
    el.updatedAt.textContent = formatDate(state.meta.updatedAt);
    if (state.meta.sample) {
      el.notice.textContent = '현재 화면은 업로드용 초기 데이터입니다. GitHub Actions에서 Update Himart Deals를 실행하면 최신 하이마트 데이터로 교체됩니다.';
      el.notice.classList.remove('hidden');
    } else if (state.meta.warning) {
      el.notice.textContent = state.meta.warning;
      el.notice.classList.remove('hidden');
    }
    updateCategoryOptions();
    render();
    setInterval(() => {
      if (state.tab === 'oneday') renderDashboard(filteredItems());
    }, 1000);
  } catch (error) {
    console.error(error);
    el.notice.textContent = `데이터를 불러오지 못했습니다. ${error.message}`;
    el.notice.classList.remove('hidden');
  }
}

init();
