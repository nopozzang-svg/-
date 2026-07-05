// telegram-chatid.mjs — 텔레그램 chat_id 찾기 도우미
//
// 사용법:
//   1) @BotFather 로 봇 만들고 받은 토큰을 hermes/.env 의 TELEGRAM_BOT_TOKEN 에 넣기
//   2) 텔레그램에서 그 봇을 찾아 아무 메시지나 한 번 보내기 (예: "안녕")
//   3) 아래 실행 → 나온 chat_id 를 hermes/.env 의 TELEGRAM_CHAT_ID 에 넣기
//        node --env-file=hermes/.env hermes/telegram-chatid.mjs

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN 이 없습니다. hermes/.env 에 봇 토큰을 넣고 실행하세요.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const j = await res.json();
if (!j.ok) {
  console.error("실패:", JSON.stringify(j));
  console.error("→ 토큰이 맞는지 확인하세요.");
  process.exit(1);
}

const chats = new Map();
for (const u of j.result) {
  const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
  if (c) chats.set(c.id, c);
}

if (!chats.size) {
  console.log("메시지가 안 보입니다. 텔레그램에서 그 봇에게 아무 메시지나 보낸 뒤 다시 실행하세요.");
  process.exit(0);
}

console.log("발견된 chat_id (이 값을 hermes/.env 의 TELEGRAM_CHAT_ID 에 넣으세요):\n");
for (const [id, c] of chats) {
  const who = c.title || c.username && `@${c.username}` || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.type;
  console.log(`  TELEGRAM_CHAT_ID=${id}   (${c.type}: ${who})`);
}
