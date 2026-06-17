# sail-dashboard 작업 규칙

## 작업 시작 전 필수
모든 작업을 시작하기 전에 반드시 아래 명령어를 먼저 실행할 것:
```bash
git pull
```

## 작업 완료 후
수정이 끝나면 반드시 push할 것:
```bash
git add .
git commit -m "작업 내용 설명"
git push
```

## 배포
push하면 Vercel이 자동으로 배포합니다. 별도 배포 명령 불필요.
