# 분탕글 판별 2차 MVP 설계서

## 1. 문서 목적

이 문서는 1차 MVP 이후의 다음 단계인 2차 MVP를 실제 개발 가능한 수준으로 구체화한다.

현재 프로젝트는 이미 아래 기능을 갖춘 상태를 전제로 한다.

- 목록 화면에 분탕 위험도 배지 표시
- 상세 화면에 분탕 점수와 근거 표시
- 규칙 기반 분류기 운영

2차 MVP의 핵심 목적은 `사용자 라벨 수집`, `판별 이력 저장`, `오탐/누락 보정 흐름 마련`이다.

## 2. 2차 MVP 목표

2차 MVP의 목표는 “모델 자동 학습”이 아니라 아래 세 가지다.

1. 사용자가 분탕글/정상글을 직접 분류할 수 있게 한다
2. 서버가 예측 결과와 사용자 라벨을 영속 저장한다
3. 이후 3차 단계의 재학습에 쓸 수 있는 품질 좋은 데이터셋을 축적한다

즉, 2차 MVP는 `학습 준비 단계`이자 `운영 피드백 수집 단계`다.

## 3. 2차 MVP 범위

### 포함

- SQLite 저장소 도입
- 게시글 스냅샷 저장
- 분탕 예측 결과 저장
- 사용자 라벨 저장 API 추가
- 상세 화면에 `분탕글`, `정상글`, `라벨 취소` 버튼 추가
- 사용자가 이미 라벨링한 상태 표시
- 최근 라벨 통계 조회 API 추가

### 제외

- 자동 재학습
- ML 모델 서빙
- 관리자 다계정 권한 체계
- 라벨 충돌 해결 고급 워크플로우
- 규칙 엔진 웹 UI 편집기

## 4. 현재 코드 기준 전제

현재 구조상 2차 MVP를 붙일 주요 지점은 명확하다.

- 서버 엔트리: [server.js](/C:/project/dactest/server.js:1)
- 규칙 기반 분류기: [lib/troll-risk.js](/C:/project/dactest/lib/troll-risk.js:1)
- 목록 렌더링: [public/app.js](/C:/project/dactest/public/app.js:53)
- 상세 렌더링: [public/app.js](/C:/project/dactest/public/app.js:93)

현재는 서버 메모리 캐시만 있고 영속 저장소가 없다. 따라서 2차 MVP의 첫 번째 기술 변화는 `DB 도입`이다.

## 5. 2차 MVP 핵심 사용자 흐름

### 흐름 A. 자동 판별 확인

1. 사용자가 글 목록을 본다
2. 글 상세에서 자동 판별 점수와 근거를 본다
3. 점수가 맞는지 판단한다

### 흐름 B. 사용자 라벨링

1. 사용자가 상세 화면에서 `분탕글` 또는 `정상글` 버튼을 누른다
2. 서버는 현재 글의 스냅샷, 당시 자동 판별 결과, 사용자 라벨을 저장한다
3. UI는 현재 라벨 상태를 즉시 반영한다

### 흐름 C. 오탐 보정

1. 자동 판별은 `medium` 이상인데 사용자가 `정상글`로 표시한다
2. 해당 라벨은 오탐 보정용 데이터로 저장된다
3. 이후 규칙 튜닝 또는 ML 학습 데이터로 사용한다

## 6. 기술 목표

2차 MVP의 기술 목표는 아래다.

- 라벨 데이터가 브라우저를 닫아도 보존될 것
- 글이 삭제되거나 수정되어도 당시 학습용 텍스트를 재현할 수 있을 것
- 자동 판별 결과와 사용자 라벨이 함께 저장될 것
- 같은 글에 대한 라벨 수정이 가능할 것

## 7. 저장소 설계

## 7.1 저장소 선택

2차 MVP에서는 SQLite를 권장한다.

이유:

- 단일 실행 서버 구조와 잘 맞음
- 별도 DB 서버가 필요 없음
- 구현과 백업이 단순함
- 이후 PostgreSQL로 이관도 가능함

권장 라이브러리:

- `better-sqlite3`

이유:

- Node 단일 서버 구조에서 단순함
- 동기 API라서 작업 흐름이 명확함
- 마이그레이션 없이 시작하기 편함

## 7.2 파일 위치

권장 경로:

- `data/app.db`

## 7.3 테이블 설계

### `posts_snapshot`

자동 수집 시점의 글 원문 스냅샷 저장용 테이블이다.

컬럼:

- `post_no` TEXT PRIMARY KEY
- `source_url` TEXT NOT NULL
- `category` TEXT
- `title` TEXT NOT NULL
- `author` TEXT
- `date_text` TEXT
- `views_text` TEXT
- `recommend_text` TEXT
- `reply_count` INTEGER NOT NULL DEFAULT 0
- `content_text` TEXT NOT NULL
- `content_html` TEXT NOT NULL
- `fetched_at` TEXT NOT NULL

### `post_prediction`

자동 판별 결과 저장용 테이블이다.

컬럼:

- `post_no` TEXT PRIMARY KEY
- `score` INTEGER NOT NULL
- `level` TEXT NOT NULL
- `summary` TEXT NOT NULL
- `reasons_json` TEXT NOT NULL
- `signals_json` TEXT NOT NULL
- `predictor_version` TEXT NOT NULL
- `predicted_at` TEXT NOT NULL

### `post_label`

사용자 라벨 저장용 테이블이다.

컬럼:

- `post_no` TEXT PRIMARY KEY
- `label` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

`label` 값:

- `troll`
- `normal`

초기 2차 MVP에서는 다중 사용자 지원 없이 최종 라벨 1개만 관리해도 충분하다.

### `label_event`

라벨 수정 이력 저장용 테이블이다.

컬럼:

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `post_no` TEXT NOT NULL
- `action` TEXT NOT NULL
- `from_label` TEXT
- `to_label` TEXT
- `created_at` TEXT NOT NULL

`action` 값:

- `set`
- `clear`

이 테이블은 “최종 상태”보다 “라벨링 이력”을 보존하기 위한 것이다.

## 8. 서버 구조 변경안

## 8.1 신규 모듈

권장 파일:

- `lib/db.js`
- `lib/post-store.js`
- `lib/label-service.js`

### `lib/db.js`

역할:

- SQLite 연결 생성
- 테이블 초기화
- 공용 DB 핸들 노출

### `lib/post-store.js`

역할:

- 게시글 스냅샷 upsert
- 자동 판별 결과 upsert
- 게시글 번호 기준 조회

### `lib/label-service.js`

역할:

- 라벨 저장
- 라벨 변경 이력 기록
- 현재 라벨 조회
- 최근 라벨 통계 조회

## 8.2 기존 API 저장 연동

현재 `/api/posts/:no`에서 상세를 가져올 때, 아래 순서로 저장을 수행한다.

1. 글 상세 HTML 파싱
2. `content_text` 생성
3. `trollRisk` 계산
4. `posts_snapshot` upsert
5. `post_prediction` upsert
6. 현재 라벨 조회
7. 응답에 `userLabel` 포함

## 9. API 설계

## 9.1 상세 응답 확장

현재 상세 API 응답에 `userLabel`을 추가한다.

예시:

```json
{
  "fetchedAt": "2026-05-03T04:00:00.000Z",
  "post": {},
  "comments": [],
  "trollRisk": {
    "score": 46,
    "level": "medium",
    "summary": "정처기 폄하 패턴이 감지되었습니다.",
    "reasons": [],
    "signals": []
  },
  "userLabel": "troll"
}
```

또는:

```json
{
  "userLabel": null
}
```

## 9.2 라벨 저장 API

엔드포인트:

- `POST /api/posts/:no/label`

요청 예시:

```json
{
  "label": "troll"
}
```

허용값:

- `troll`
- `normal`

응답 예시:

```json
{
  "ok": true,
  "postNo": "131551",
  "label": "troll",
  "savedAt": "2026-05-03T04:10:00.000Z"
}
```

## 9.3 라벨 취소 API

엔드포인트:

- `DELETE /api/posts/:no/label`

응답 예시:

```json
{
  "ok": true,
  "postNo": "131551",
  "label": null,
  "savedAt": "2026-05-03T04:11:00.000Z"
}
```

## 9.4 통계 API

엔드포인트:

- `GET /api/labels/stats`

응답 예시:

```json
{
  "totalLabeled": 124,
  "trollCount": 47,
  "normalCount": 77,
  "updatedAt": "2026-05-03T04:12:00.000Z"
}
```

## 10. UI 설계

## 10.1 상세 화면 버튼

현재 위험도 패널 아래에 라벨 영역을 추가한다.

예시:

```html
<div class="label-actions">
  <button type="button" data-label="troll">분탕글</button>
  <button type="button" data-label="normal">정상글</button>
  <button type="button" data-label-clear>라벨 취소</button>
</div>
```

## 10.2 현재 라벨 상태 표시

버튼 아래 또는 패널 하단에 현재 상태를 보여준다.

예시:

- `현재 라벨: 분탕글`
- `현재 라벨: 정상글`
- `현재 라벨 없음`

## 10.3 목록 화면 라벨 표시

2차 MVP에서는 목록에도 사용자가 라벨링한 상태를 얕게 보여주는 것이 좋다.

예시:

- `내 라벨: 분탕`
- `내 라벨: 정상`

단, 시각적 우선순위는 자동 판별 배지보다 낮아야 한다.

## 11. 프론트 상태 관리 변경안

현재 [public/app.js](/C:/project/dactest/public/app.js:13)의 `state`에는 게시글 목록과 선택 글 정보만 있다.

2차 MVP에서는 아래 상태가 추가된다.

- `currentArticleLabel`
- `isSavingLabel`
- `labelStats`

추가 역할:

- 라벨 저장 중 버튼 비활성화
- 저장 완료 후 즉시 UI 반영
- 통계 표시 가능

## 12. 추천 UX 문구

버튼 문구:

- `분탕글`
- `정상글`
- `라벨 취소`

저장 성공:

- `라벨이 저장되었습니다.`

저장 실패:

- `라벨 저장에 실패했습니다. 다시 시도해주세요.`

설명 문구:

- `이 라벨은 이후 판별 기준 개선에 사용됩니다.`

## 13. 스냅샷 저장 기준

2차 MVP에서 가장 중요한 결정 중 하나는 언제 스냅샷을 저장하느냐다.

권장 기준:

- 사용자가 상세 화면을 연 시점에 저장

이유:

- 목록만 본 글은 스냅샷 저장 비용을 줄일 수 있음
- 실제로 사람이 보고 라벨링할 가능성이 있는 글 위주로 데이터 축적 가능

다만 추후 확장을 위해 아래도 고려 가능하다.

- 목록 수집 시 제목/메타만 저장
- 상세 조회 시 본문/예측 상세 저장

## 14. 예측 버전 관리

2차 MVP에서도 `predictor_version`은 꼭 저장하는 것이 좋다.

예시:

- `rule-v1`
- `rule-v2`

이유:

- 라벨은 같아도 어떤 규칙 버전에서 오탐이 났는지 추적 가능
- 이후 규칙 튜닝 성과 비교 가능

## 15. 오탐/누락 운영 흐름

### 오탐

- 자동 판별 `medium` 이상
- 사용자 라벨 `normal`

활용:

- 과한 키워드/가중치 탐지
- 감점 규칙 강화 후보

### 누락

- 자동 판별 `low`
- 사용자 라벨 `troll`

활용:

- 새 키워드 발굴
- 새 조합 규칙 추가

## 16. 구현 순서

### 1단계. DB 도입

- `better-sqlite3` 추가
- `data/app.db` 초기화
- 테이블 생성 로직 작성

### 2단계. 서버 저장 계층 추가

- `lib/db.js`
- `lib/post-store.js`
- `lib/label-service.js`

### 3단계. 상세 API 저장 연동

- 상세 조회 시 스냅샷 저장
- 예측 결과 저장
- 현재 라벨 조회 응답 추가

### 4단계. 라벨 API 추가

- `POST /api/posts/:no/label`
- `DELETE /api/posts/:no/label`
- `GET /api/labels/stats`

### 5단계. 프론트 상세 버튼 추가

- 라벨 버튼 렌더링
- 클릭 시 API 호출
- 성공/실패 UI 처리

### 6단계. 목록 라벨 표시 추가

- 현재 라벨 상태를 목록에 반영
- 자동 판별 배지와 충돌하지 않게 정리

### 7단계. 운영 검증

- 라벨 저장/수정/취소 확인
- DB 데이터 확인
- 오탐/누락 샘플 20건 정도 수집

## 17. 테스트 시나리오

### 시나리오 A. 분탕글 라벨 저장

1. 글 상세 열기
2. `분탕글` 클릭
3. UI에 `현재 라벨: 분탕글` 표시
4. DB에 `posts_snapshot`, `post_prediction`, `post_label`, `label_event` 확인

### 시나리오 B. 정상글 라벨 저장

1. 글 상세 열기
2. `정상글` 클릭
3. UI에 `현재 라벨: 정상글` 표시

### 시나리오 C. 라벨 변경

1. `정상글` 저장
2. 다시 `분탕글` 저장
3. 최종 라벨은 `troll`
4. 이벤트 이력에는 변경 전/후 기록

### 시나리오 D. 라벨 취소

1. 라벨 저장
2. `라벨 취소` 클릭
3. 최종 라벨은 `null`
4. 이력에는 `clear` 기록

## 18. 3차 단계로의 연결 포인트

2차 MVP가 끝나면 아래 데이터가 확보된다.

- 글 원문 스냅샷
- 자동 판별 점수
- 사용자 최종 라벨
- 라벨 이력
- 규칙 버전별 예측 결과

이 데이터는 3차에서 아래로 연결된다.

- 오탐/누락 분석 리포트
- TF-IDF 기반 경량 모델 학습
- 규칙 점수와 ML 점수 결합

## 19. 주요 리스크

### DB 파일 잠금/손상

대응:

- 단일 프로세스 접근 유지
- 정기 백업

### 라벨 남발

대응:

- 저장/취소만 지원하고 복잡한 협업 기능은 제외
- 운영자 1인 기준 단순 흐름 유지

### 스냅샷 누락

대응:

- 라벨 저장 전에 스냅샷이 없으면 먼저 저장
- 상세 API에서 스냅샷 확보를 기본화

## 20. 최종 권고

2차 MVP는 `사용자 라벨 저장 + 예측 이력 저장 + 운영 피드백 수집`까지를 확실히 끝내는 단계로 보는 것이 맞다.

즉, 2차 MVP의 완료 기준은 아래다.

1. 사용자가 글을 `분탕글/정상글`로 저장할 수 있다
2. 서버가 글 원문, 예측 결과, 라벨 이력을 DB에 저장한다
3. 오탐/누락 사례를 이후 3차 학습 단계로 넘길 수 있다

이 단계까지 끝나면 3차에서는 더 이상 “데이터를 어떻게 모을지”가 아니라 “모인 데이터를 어떻게 학습에 쓸지”로 논의를 옮길 수 있다.
