# 하이마트 특가 대시보드

기존 핫딜 레이더 방식이 아니라, 하이마트 전용 페이지 2개를 독립적으로 수집해 상담용 대시보드로 보여주는 구조입니다.

## 수집 대상

1. 원데이핫딜
   - https://www.e-himart.co.kr/app/displayPlan/listPlanDetail?spdpNo=7630
   - 이미지, 상품명, 남은수량, L.POINT, 판매가, 최대혜택가 중심 수집

2. 미개봉상품 특가
   - https://www.e-himart.co.kr/app/display/unopenedHall
   - 브랜드, 상품명, 할인율, 정상가, 판매가, 최대혜택가 중심 수집

## 구조

```text
index.html
style.css
app.js
package.json
scripts/collect-himart.js
data/deals.json
data/debug.json
.github/workflows/update-himart-deals.yml
.nojekyll
```

## 업로드 방법

1. ZIP 압축을 풉니다.
2. GitHub 저장소로 이동합니다.
3. `Add file → Upload files`를 누릅니다.
4. 압축을 푼 폴더 안의 모든 파일과 폴더를 업로드합니다.
5. `Commit changes`를 누릅니다.
6. `Settings → Pages`에서 `Deploy from a branch`, `main`, `/root`로 설정합니다.
7. `Actions → Update Himart Deals → Run workflow`를 한 번 실행합니다.

## 확인할 파일

수집 후에는 아래 파일을 확인하세요.

```text
data/debug.json
```

중요한 값은 다음과 같습니다.

```json
{
  "counts": {
    "oneday": 20,
    "unopened": 60
  }
}
```

`oneday`가 20개 이상이면 원데이핫딜 전용 페이지의 상품 리스트가 제대로 들어온 것입니다.

## 핵심 설계 변경

- 여러 버전에서 덧붙이던 구조를 버리고 새로 작성했습니다.
- 데이터 파일을 `data/deals.json` 하나로 통합했습니다.
- 원데이핫딜과 미개봉특가의 파서를 완전히 분리했습니다.
- 원데이핫딜은 `남은수량`을 기준으로 상품 블록을 나눕니다.
- 미개봉특가는 `판매가` 문구를 기준으로 상품 블록을 나눕니다.
- 수집 실패 시 기존 데이터를 보존합니다.
