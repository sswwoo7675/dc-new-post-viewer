# HTTPS 적용 가이드

이 문서는 VPS에 배포된 `dc-new-post-viewer`에 Nginx와 Let's Encrypt를 이용해 HTTPS를 적용하는 절차를 정리합니다.

현재 운영 구조는 다음을 기준으로 합니다.

- 애플리케이션: Node.js 서버
- 실행 방식: Docker Compose
- 네트워크: `host` 모드
- 앱 포트: `APP_PORT` 환경 변수 값 예시 `3000` 또는 `8741`
- HTTPS 종료 지점: Nginx

## 권장 구조

권장 방식은 앱 포트를 외부에 직접 공개하지 않고, Nginx가 `80`, `443` 포트를 받아 내부 앱 포트로 프록시하는 형태입니다.

예시:

- 외부 사용자 -> `https://app.example.com`
- Nginx -> `http://127.0.0.1:3000`

## 사전 준비

필요한 조건:

- VPS 공인 IP
- 도메인 또는 서브도메인
- DNS `A` 레코드가 VPS를 가리키도록 설정
- Nginx와 Certbot 설치 가능 상태

DNS 예시:

- `app.example.com` -> `123.123.123.123`

## 1. Nginx와 Certbot 설치

Ubuntu 기준:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

설치 후 상태 확인:

```bash
sudo systemctl status nginx
```

## 2. 방화벽 열기

`iptables`를 직접 사용하는 경우 최소한 `80/tcp`, `443/tcp` 인바운드를 허용해야 합니다.

```bash
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

규칙 확인:

```bash
sudo iptables -L -n -v
```

재부팅 후 유지가 필요하면:

```bash
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

주의:

- 클라우드 보안그룹, VPC 방화벽, 호스팅사 네트워크 ACL도 함께 열려 있어야 합니다.
- 앱 포트 `3000`, `8741`은 외부 공개 대신 로컬 바인딩 또는 내부 접근만 유지하는 편이 더 안전합니다.

## 3. 앱 포트 확인

Nginx가 프록시할 실제 앱 포트를 확인합니다.

예시:

```bash
docker ps
docker exec -it dcinside-viewer sh -c 'echo $PORT'
curl -I http://127.0.0.1:3000/healthz
```

앱 포트가 `8741`이면 이후 설정의 `proxy_pass`만 `127.0.0.1:8741`로 바꾸면 됩니다.

## 4. Nginx HTTP 설정

먼저 `80` 포트로 동작하는 설정을 만듭니다.

예시 파일: `/etc/nginx/sites-available/dactest`

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

적용:

```bash
sudo ln -s /etc/nginx/sites-available/dactest /etc/nginx/sites-enabled/dactest
sudo nginx -t
sudo systemctl reload nginx
```

중요:

- `listen 8741`과 `proxy_pass http://127.0.0.1:8741`를 동시에 쓰면 안 됩니다.
- 그 구성은 Nginx가 자기 자신에게 다시 프록시하는 루프를 만들 수 있습니다.
- `listen`은 보통 `80` 또는 `443`, `proxy_pass`는 앱 포트로 분리해야 합니다.

## 5. Let's Encrypt 인증서 발급

도메인이 정상 연결된 상태에서 인증서를 발급합니다.

```bash
sudo certbot --nginx -d app.example.com
```

성공하면 Certbot이 보통 다음을 자동 처리합니다.

- 인증서 발급
- Nginx SSL 설정 추가
- HTTP -> HTTPS 리다이렉트 설정

## 6. HTTPS 최종 설정 예시

Certbot이 자동 구성하지 않거나 수동 조정이 필요할 때는 아래 형태를 기준으로 합니다.

```nginx
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

앱이 `8741` 포트에서 실행 중이라면 `proxy_pass http://127.0.0.1:8741;`로 바꿉니다.

## 7. 동작 확인

설정 후 확인 순서:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I http://app.example.com
curl -I https://app.example.com
curl -I https://app.example.com/healthz
```

브라우저에서 확인할 항목:

- 자물쇠 표시
- `http://` 접속 시 `https://`로 리다이렉트
- 메인 화면 정상 렌더링
- `/api/posts` 호출 정상 응답

## 8. 인증서 자동 갱신 확인

Let's Encrypt 인증서는 자동 갱신이 중요합니다.

테스트:

```bash
sudo certbot renew --dry-run
```

## 9. 문제 해결

### `502 Bad Gateway`

확인:

```bash
curl -I http://127.0.0.1:3000/healthz
docker ps
sudo tail -n 100 /var/log/nginx/error.log
```

원인 예시:

- 앱이 죽어 있음
- Nginx가 잘못된 포트로 프록시 중
- `proxy_pass` 대상 포트와 실제 앱 포트가 다름

### 인증서 발급 실패

확인:

```bash
dig app.example.com
curl -I http://app.example.com
```

원인 예시:

- DNS가 아직 전파되지 않음
- `80/tcp`가 외부에서 막힘
- `server_name`이 실제 도메인과 다름

### Nginx 프록시 루프

잘못된 예:

```nginx
server {
    listen 8741;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:8741;
    }
}
```

이 설정은 Nginx가 받은 요청을 다시 자기 자신에게 보내므로 사용하면 안 됩니다.

## 10. 운영 권장 사항

- 앱 포트는 외부에 직접 열지 말고 Nginx 뒤에 둡니다.
- 공개 서비스라면 라벨 수정 API에 인증을 추가하는 편이 좋습니다.
- Nginx access/error 로그를 함께 확인할 수 있게 운영 절차를 정리해두는 것이 좋습니다.
