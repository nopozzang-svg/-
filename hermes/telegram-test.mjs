// telegram-test.mjs — .env 의 토큰+chat_id 로 테스트 메시지 1건 발송해 연결 확인
//   node --env-file=hermes/.env hermes/telegram-test.mjs
const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 hermes/.env 에 없습니다.");
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: chat, text: "✅ 일보 미도착 알림 연결 테스트 — 이 메시지가 보이면 설정 완료!" }),
});
const j = await res.json();
if (j.ok) console.log("전송 성공 — 텔레그램 채팅을 확인하세요.");
else { console.error("전송 실패:", JSON.stringify(j)); process.exit(1); }
