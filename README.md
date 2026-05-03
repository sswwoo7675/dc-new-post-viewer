# DCInside 새 글 뷰어

정보처리기사 미니 갤러리의 최신 글을 주기적으로 확인하고, 선택한 글의 본문과 댓글을 한 화면에서 보는 작은 웹 앱입니다.

## 실행

```powershell
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 열면 됩니다.

상단 `Windows 알림` 토글을 켜고 브라우저 권한을 허용하면, 자동 갱신 중 새 글이 발견될 때 Windows 토스트 알림이 표시됩니다.

## 설정

- `PORT`: 서버 포트, 기본값 `3000`
- `GALLERY_ID`: 갤러리 ID, 기본값 `dataprocessing`

예시:

```powershell
$env:PORT=4000
$env:GALLERY_ID="dataprocessing"
npm start
```
