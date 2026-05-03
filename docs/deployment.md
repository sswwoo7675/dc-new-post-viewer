# Docker + CI/CD 배포 가이드

이 프로젝트는 Docker 컨테이너로 패키징하고, GitHub Actions로 이미지 빌드와 배포를 자동화하는 구성을 기준으로 운영할 수 있습니다.

## 배포 구조

1. GitHub Actions CI가 `npm ci`와 서버 스모크 테스트를 수행합니다.
2. `main` 브랜치에 푸시되면 Docker 이미지를 GHCR에 업로드합니다.
3. 같은 워크플로우가 VPS에 SSH로 접속해 `docker compose pull`과 `up -d`를 실행합니다.
4. SQLite 데이터는 서버의 `data/` 디렉터리에 남겨서 컨테이너 재배포 후에도 유지합니다.
5. 외부 사이트로 나가는 통신이 Docker bridge에서 막히는 환경을 피하기 위해 운영 컨테이너는 `host` 네트워크를 사용합니다.

## 저장소에 추가된 파일

- `Dockerfile`
- `.dockerignore`
- `docker-compose.prod.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`

## VPS 준비

Ubuntu 서버 기준으로 아래가 먼저 준비되어 있어야 합니다.

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
mkdir -p ~/apps/dactest/data
```

로그아웃 후 다시 접속해서 Docker 그룹 권한을 반영합니다.

## GitHub Secrets

저장소 `Settings > Secrets and variables > Actions` 에 아래 값을 등록합니다.

- `VPS_HOST`: 배포 대상 서버 주소
- `VPS_USER`: SSH 접속 계정
- `VPS_SSH_KEY`: 배포용 개인키
- `VPS_PORT`: SSH 포트, 보통 `22`
- `VPS_APP_DIR`: 서버 내 앱 디렉터리 예시 `~/apps/dactest`
- `APP_PORT`: 외부에 노출할 포트 예시 `3000`
- `GALLERY_ID`: 운영 대상 갤러리 ID
- `GHCR_USERNAME`: GHCR 이미지를 pull 할 GitHub 사용자명
- `GHCR_READ_TOKEN`: GHCR read 권한이 있는 PAT

## GHCR 토큰 권장 권한

- `GHCR_READ_TOKEN`: `read:packages`

비공개 저장소이거나 패키지 접근 정책이 제한되어 있으면 서버에서 이미지를 pull 하기 위해 별도 PAT가 필요합니다.

## 서버 방화벽과 리버스 프록시

운영 환경에서는 앱 포트를 직접 노출하기보다 Nginx 같은 리버스 프록시 뒤에 두는 편이 좋습니다.

예시:

- 앱 컨테이너: `127.0.0.1:3000`
- Nginx: `80`, `443`
- HTTPS: Let's Encrypt

`host` 네트워크 모드에서는 Docker의 `ports:` 매핑 대신 애플리케이션이 호스트 포트에 직접 바인딩됩니다.

## 배포 동작 방식

`main` 브랜치에 푸시되면:

1. CI 스모크 테스트 실행
2. Docker 이미지 빌드
3. `ghcr.io/<owner>/<repo>:latest` 푸시
4. VPS에서 최신 이미지 pull
5. 컨테이너 재시작

## 운영 시 주의점

- 현재 앱은 라벨 저장 API에 인증이 없습니다.
- 공개 서비스로 운영할 때는 관리자 인증이나 VPN, IP 제한 중 하나를 두는 편이 안전합니다.
- SQLite는 단일 인스턴스 운영에는 적합하지만 다중 서버 확장에는 맞지 않습니다.
- 특정 VPS에서는 Docker bridge 네트워크의 outbound가 제한될 수 있습니다. 이런 경우 현재 구성처럼 `network_mode: host`가 더 안정적입니다.
