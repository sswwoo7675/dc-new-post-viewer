# DCInside 새 글 뷰어

정보처리기사 미니 갤러리의 최신 글을 주기적으로 확인하고, 선택한 글의 본문과 댓글을 한 화면에서 볼 수 있는 작은 웹 앱입니다.

새 글 감지, Windows 알림, 분탕 가능성 점수 표시, 수동 라벨링까지 한 번에 확인할 수 있도록 구성되어 있습니다.

## 주요 기능

- 최신 글 목록 자동 새로고침
- 선택한 글의 본문과 댓글 조회
- 새 글 발견 시 브라우저 기반 Windows 알림
- 글 내용 기반 분탕 가능성 점수 표시
- `분탕글` / `일반글` 라벨 저장

## 빠른 시작

### 요구 사항

- Node.js 20 이상
- npm

### 설치

```powershell
npm install
```

### 실행

```powershell
npm start
```

실행 후 브라우저에서 [http://127.0.0.1:3000](http://127.0.0.1:3000) 을 열면 됩니다.

상단 `Windows 알림` 토글을 켜고 브라우저 권한을 허용하면, 자동 갱신 중 새 글이 발견될 때 알림이 표시됩니다.

## 환경 변수

기본값이 있으므로 별도 설정 없이 바로 실행할 수 있습니다.

- `PORT`: 서버 포트, 기본값 `3000`
- `HOST`: 서버 바인딩 주소, 기본값 `127.0.0.1`
- `GALLERY_ID`: 대상 미니 갤러리 ID, 기본값 `dataprocessing`

예시:

```powershell
$env:PORT=4000
$env:HOST="127.0.0.1"
$env:GALLERY_ID="dataprocessing"
npm start
```

Docker에서 실행할 때는 외부 접근을 위해 `HOST=0.0.0.0` 으로 설정하는 것을 권장합니다.

예시:

```powershell
docker build -t dcinside-viewer .
docker run --rm -p 3000:3000 -e HOST=0.0.0.0 -e PORT=3000 -v ${PWD}\data:/app/data dcinside-viewer
```

## 프로젝트 구조

```text
public/   클라이언트 UI
lib/      DB, 라벨, 분탕 판별 로직
docs/     기획 및 기능 문서
data/     로컬 SQLite 데이터 파일
server.js 서버 진입점
```

## 데이터 저장

앱은 실행 중 수집한 정보와 라벨 데이터를 로컬 SQLite 파일로 저장합니다.

- `data/app.db`
- `data/app.db-shm`
- `data/app.db-wal`

이 파일들은 로컬 실행용 데이터이므로 Git에는 포함하지 않도록 설정되어 있습니다.

## 현재 상태

이 프로젝트는 단일 Node.js 서버와 정적 프런트엔드로 동작하는 실험용 도구입니다. 현재는 기본 실행과 수동 확인 중심으로 구성되어 있으며, 테스트 코드와 CI는 아직 포함되어 있지 않습니다.

## 배포

Docker와 GitHub Actions 기반 CI/CD 예시는 `docs/deployment.md`에 정리되어 있습니다.

HTTPS와 Nginx 리버스 프록시 적용 절차는 `docs/https.md`에 정리되어 있습니다.
